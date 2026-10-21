const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("node:crypto");
const path = require("node:path");
const { parse } = require("csv-parse/sync");

const app = express();
const db = new Database(process.env.DB_PATH || "mfd.sqlite");
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in production.");
}
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS investors (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sips (
    id INTEGER PRIMARY KEY,
    investor_id INTEGER NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
    scheme TEXT NOT NULL,
    amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
    status TEXT NOT NULL CHECK(status IN ('active','stopped','registered')),
    due_day INTEGER CHECK(due_day BETWEEN 1 AND 28),
    data_source TEXT NOT NULL DEFAULT 'manual',
    source_updated_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
  imgSrc: ["'self'", "data:"], connectSrc: ["'self'"], objectSrc: ["'none'"],
  frameAncestors: ["'none'"], formAction: ["'self'"], upgradeInsecureRequests: isProduction ? [] : null
}}}));
app.use(express.json({ limit: "2mb" }));
app.use(session({
  name: "mfd.sid",
  secret: process.env.SESSION_SECRET || "development-only-change-me",
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({ db: "sessions.sqlite", dir: path.dirname(path.resolve(process.env.DB_PATH || "mfd.sqlite")) }),
  cookie: { httpOnly: true, sameSite: "strict", secure: isProduction, maxAge: 8 * 60 * 60 * 1000 }
}));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false });

const findUser = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?");
app.post("/api/login", loginLimiter, async (req, res, next) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const user = findUser.get(username);
    const valid = user && await require("bcryptjs").compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Username or password is incorrect." });
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.csrf = crypto.randomBytes(32).toString("hex");
      res.json({ username: user.username, csrfToken: req.session.csrf, practice: { arn: process.env.MFD_ARN || "", name: process.env.MFD_NAME || "", mobile: process.env.MFD_MOBILE || "", email: process.env.MFD_EMAIL || "" } });
    });
  } catch (err) { next(err); }
});
app.post("/api/logout", requireAuth, requireCsrf, (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie("mfd.sid", { httpOnly: true, sameSite: "strict", secure: isProduction });
    res.status(204).end();
  });
});
app.get("/api/session", (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Sign in required." });
  res.set("Cache-Control", "no-store").json({
    username: req.session.username,
    csrfToken: req.session.csrf,
    practice: {
      arn: process.env.MFD_ARN || "",
      name: process.env.MFD_NAME || "",
      mobile: process.env.MFD_MOBILE || "",
      email: process.env.MFD_EMAIL || ""
    }
  });
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Sign in required." });
  next();
}
function requireCsrf(req, res, next) {
  const token = req.get("x-csrf-token") || "";
  if (!req.session.csrf || token.length !== req.session.csrf.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(req.session.csrf))) {
    return res.status(403).json({ error: "Request verification failed. Refresh and try again." });
  }
  next();
}
app.use("/api", (req, res, next) => {
  if (["/login", "/session"].includes(req.path)) return next();
  requireAuth(req, res, () => requireCsrf(req, res, next));
});
app.use("/api", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") res.set("Cache-Control", "no-store");
  next();
});

app.get("/api/dashboard", (req, res) => {
  const investors = db.prepare("SELECT COUNT(*) AS count FROM investors").get().count;
  const sips = db.prepare("SELECT COUNT(*) AS count FROM sips").get().count;
  const active = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount_paise),0) AS amount FROM sips WHERE status='active'").get();
  const due = db.prepare("SELECT s.id, i.name AS investor, s.scheme, s.amount_paise, s.due_day FROM sips s JOIN investors i ON i.id=s.investor_id WHERE s.status='active' AND s.due_day IS NOT NULL ORDER BY s.due_day, i.name").all();
  res.json({ investors, sips, activeSips: active.count, monthlyActivePaise: active.amount, due, dataLabel: "Manual/imported records" });
});
app.get("/api/investors", (req, res) => {
  res.json(db.prepare(`SELECT i.*, COUNT(s.id) AS sip_count FROM investors i LEFT JOIN sips s ON s.investor_id=i.id GROUP BY i.id ORDER BY i.name COLLATE NOCASE`).all());
});
app.post("/api/investors", (req, res) => {
  const name = clean(req.body?.name, 120);
  if (!name) return res.status(400).json({ error: "Investor name is required." });
  const result = db.prepare("INSERT INTO investors(name,email,phone,notes) VALUES(?,?,?,?)").run(name, clean(req.body?.email, 254), clean(req.body?.phone, 40), clean(req.body?.notes, 1000));
  res.status(201).json({ id: result.lastInsertRowid });
});
app.put("/api/investors/:id", (req, res) => {
  const name = clean(req.body?.name, 120);
  if (!name) return res.status(400).json({ error: "Investor name is required." });
  const result = db.prepare("UPDATE investors SET name=?,email=?,phone=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(name, clean(req.body?.email,254), clean(req.body?.phone,40), clean(req.body?.notes,1000), Number(req.params.id));
  res.json({ updated: result.changes === 1 });
});
app.delete("/api/investors/:id", (req, res) => {
  const result = db.prepare("DELETE FROM investors WHERE id=?").run(Number(req.params.id));
  res.json({ deleted: result.changes === 1 });
});
app.get("/api/sips", (req, res) => {
  res.json(db.prepare("SELECT s.*, i.name AS investor FROM sips s JOIN investors i ON i.id=s.investor_id ORDER BY i.name COLLATE NOCASE, s.scheme COLLATE NOCASE").all());
});
app.post("/api/sips", (req, res) => {
  const investorId = Number(req.body?.investorId);
  const scheme = clean(req.body?.scheme, 160);
  const amount = Number(req.body?.amount);
  const status = req.body?.status;
  const dueDay = req.body?.dueDay === "" || req.body?.dueDay == null ? null : Number(req.body.dueDay);
  if (!db.prepare("SELECT 1 FROM investors WHERE id=?").get(investorId)) return res.status(400).json({ error: "Choose a valid investor." });
  if (!scheme || !Number.isFinite(amount) || amount <= 0 || !["active","stopped","registered"].includes(status) || (dueDay !== null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28))) return res.status(400).json({ error: "Check scheme, amount, status and due day." });
  const result = db.prepare("INSERT INTO sips(investor_id,scheme,amount_paise,status,due_day,data_source,source_updated_at) VALUES(?,?,?,?,?,'manual',CURRENT_TIMESTAMP)").run(investorId, scheme, Math.round(amount * 100), status, dueDay);
  res.status(201).json({ id: result.lastInsertRowid });
});
app.put("/api/sips/:id", (req,res) => {
  const investorId=Number(req.body?.investorId), scheme=clean(req.body?.scheme,160), amount=Number(req.body?.amount), status=req.body?.status;
  const dueDay=req.body?.dueDay===""||req.body?.dueDay==null?null:Number(req.body.dueDay);
  if (!db.prepare("SELECT 1 FROM investors WHERE id=?").get(investorId)) return res.status(400).json({error:"Choose a valid investor."});
  if(!scheme||!Number.isFinite(amount)||amount<=0||!["active","stopped","registered"].includes(status)||(dueDay!==null&&(!Number.isInteger(dueDay)||dueDay<1||dueDay>28))) return res.status(400).json({error:"Check scheme, amount, status and due day."});
  const out=db.prepare("UPDATE sips SET investor_id=?,scheme=?,amount_paise=?,status=?,due_day=?,data_source='manual',source_updated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(investorId,scheme,Math.round(amount*100),status,dueDay,Number(req.params.id));
  res.json({updated:out.changes===1});
});
app.delete("/api/sips/:id",(req,res)=>{const out=db.prepare("DELETE FROM sips WHERE id=?").run(Number(req.params.id));res.json({deleted:out.changes===1});});
app.post("/api/import", (req, res) => {
  const csv = String(req.body?.csv || "");
  if (!csv || Buffer.byteLength(csv, "utf8") > 1_500_000) return res.status(400).json({ error: "Choose a CSV file smaller than 1.5 MB." });
  let rows;
  try { rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true, bom: true, max_record_size: 10000 }); }
  catch { return res.status(400).json({ error: "CSV format is invalid. Use the exported MFD CSV format." }); }
  const isUtiExport = rows.length && Object.hasOwn(rows[0], "Investor Name") && Object.hasOwn(rows[0], "Installment Amount") && Object.hasOwn(rows[0], "Scheme") && Object.hasOwn(rows[0], "Status");
  const required = ["investor", "email", "phone", "scheme", "monthly_amount_inr", "status", "due_day"];
  if (!rows.length || rows.length > 5000 || (!isUtiExport && required.some(key => !Object.hasOwn(rows[0], key)))) return res.status(400).json({ error: "Use the dashboard CSV format or the UTI active SIP report format." });
  const cleanRows = [];
  for (const row of rows) {
    const name=clean(isUtiExport ? row["Investor Name"] : row.investor,120);
    const scheme=clean(isUtiExport ? row.Scheme : row.scheme,160);
    const email=clean(isUtiExport ? row.Email : row.email,254);
    const phone=clean(isUtiExport ? row.Mobile : row.phone,40);
    const amount=Number(isUtiExport ? row["Installment Amount"] : row.monthly_amount_inr);
    let status=String(isUtiExport ? row.Status : row.status||"").toLowerCase();
    if (isUtiExport) {
      if (/live|active/.test(status)) status="active";
      else if (/stopp|cancel|terminat|discontinu/.test(status)) status="stopped";
      else if (/register|pending/.test(status)) status="registered";
      else status="invalid";
    }
    const dueRaw=isUtiExport ? String(row["Start Date"]||"").trim() : String(row.due_day||"").trim();
    const dateMatch=isUtiExport ? dueRaw.match(/^(\\d{1,2})[-/](\\d{1,2})[-/](\\d{4})$/) : null;
    const dueDay=isUtiExport ? (dateMatch ? Number(dateMatch[1]) : NaN) : (dueRaw ? Number(dueRaw) : null);
    if (!name || !scheme || !Number.isFinite(amount) || amount < 0.01 || !["active","stopped","registered"].includes(status) || (dueDay!==null && (!Number.isInteger(dueDay)||dueDay<1||dueDay>28))) {
      return res.status(400).json({ error: "One or more rows have missing or invalid investor, scheme, amount, status or due day values." });
    }
    cleanRows.push({name,scheme,email,phone,amountPaise:Math.round(amount*100),status,dueDay});
  }
  const importRows=db.transaction(items=>{
    let added=0, skipped=0;
    for(const row of items){
      let investor=db.prepare("SELECT id FROM investors WHERE lower(name)=lower(?) AND lower(email)=lower(?)").get(row.name,row.email);
      if(!investor){
        const out=db.prepare("INSERT INTO investors(name,email,phone) VALUES(?,?,?)").run(row.name,row.email,row.phone);
        investor={id:Number(out.lastInsertRowid)};
      }
      const duplicate=db.prepare("SELECT id FROM sips WHERE investor_id=? AND lower(scheme)=lower(?) AND amount_paise=? AND status=? AND due_day IS ?").get(investor.id,row.scheme,row.amountPaise,row.status,row.dueDay);
      if(duplicate){skipped++;continue;}
      db.prepare("INSERT INTO sips(investor_id,scheme,amount_paise,status,due_day,data_source,source_updated_at) VALUES(?,?,?,?,?,'imported',CURRENT_TIMESTAMP)").run(investor.id,row.scheme,row.amountPaise,row.status,row.dueDay);
      added++;
    }
    return {added,skipped};
  });
  try { res.json(importRows(cleanRows)); }
  catch { res.status(400).json({error:"Import could not be completed. No partial changes were saved."}); }
});

app.get("/api/export", (req,res) => {
  const rows = db.prepare("SELECT i.name AS investor, i.email, i.phone, s.scheme, s.amount_paise/100.0 AS monthly_amount_inr, s.status, s.due_day, s.data_source, s.source_updated_at FROM sips s JOIN investors i ON i.id=s.investor_id ORDER BY i.name,s.scheme").all();
  const headers=["investor","email","phone","scheme","monthly_amount_inr","status","due_day","data_source","source_updated_at"];
  const csv=[headers.join(","),...rows.map(row=>headers.map(h=>csvCell(row[h])).join(","))].join("\r\n");
  res.set({"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=mfd-records.csv","Cache-Control":"no-store"}).send(csv);
});
app.get("/api/health", (req,res)=>res.json({ok:true}));

function clean(value, max) { return String(value || "").trim().slice(0,max); }
function csvCell(value) {
  let s=String(value ?? "");
  if (/^[=+@\-\t\r]/.test(s)) s="'"+s;
  return '"' + s.replaceAll('"','""') + '"';
}
app.use(express.static(path.join(__dirname,"public"), { index: false, maxAge: isProduction ? "1h" : 0 }));
app.get("/", (req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.get("/login", (req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.use((err,req,res,next)=>{ console.error(err.message); res.status(500).json({error:"Something went wrong."}); });
app.listen(PORT, ()=>console.log(`MFD dashboard listening on port ${PORT}`));