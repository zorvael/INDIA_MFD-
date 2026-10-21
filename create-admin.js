const Database=require("better-sqlite3");
const bcrypt=require("bcryptjs");
const readline=require("node:readline/promises");
const {stdin:input,stdout:output}=require("node:process");

(async()=>{
 const rl=readline.createInterface({input,output});
 try{
  const username=(await rl.question("Admin username: ")).trim();
  const password=await rl.question("Admin password (minimum 14 characters): ");
  if(!/^[A-Za-z0-9._-]{3,50}$/.test(username)) throw new Error("Use 3-50 letters, digits, dot, underscore or hyphen for the username.");
  if(password.length<14) throw new Error("Password must be at least 14 characters.");
  const db=new Database(process.env.DB_PATH||"mfd.sqlite");
  db.exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  db.prepare("INSERT INTO users(username,password_hash) VALUES(?,?)").run(username,await bcrypt.hash(password,12));
  db.close();
  console.log("Admin created. Keep the password in a password manager.");
 }catch(e){ console.error(e.message); process.exitCode=1; }
 finally{rl.close();}
})();