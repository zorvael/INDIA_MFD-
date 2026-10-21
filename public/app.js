const $=s=>document.querySelector(s);
const loginView=$("#loginView"),appView=$("#appView");
let csrfToken="", investors=[], sips=[];
async function api(url,options={}) {
  const headers={...(options.body?{"Content-Type":"application/json"}:{}),...(options.method&&options.method!=="GET"?{"X-CSRF-Token":csrfToken}:{}),...options.headers};
  const response=await fetch(url,{...options,headers,credentials:"same-origin"});
  if(response.status===401){showLogin();throw new Error("Please sign in again.");}
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||"Request failed.");}
  if(response.status===204)return null;
  return response.json();
}
async function start(){
 try{const session=await fetch("/api/session",{credentials:"same-origin"});if(!session.ok)throw new Error();const data=await session.json();csrfToken=data.csrfToken;$("#userLabel").textContent=data.username;loginView.hidden=true;appView.hidden=false;await refresh();}
 catch{showLogin();}
}
function showLogin(){appView.hidden=true;loginView.hidden=false;csrfToken="";}
async function refresh(){
 const [summary,people,plans]=await Promise.all([api("/api/dashboard"),api("/api/investors"),api("/api/sips")]);
 investors=people;sips=plans;
 $("#investorCount").textContent=summary.investors;$("#activeCount").textContent=summary.activeSips;$("#sipCount").textContent=summary.sips;
 $("#monthlyAmount").textContent=money(summary.monthlyActivePaise/100);
 renderInvestors();renderDue(summary.due);populateInvestorOptions();
}
function money(n){return new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(n||0);}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function renderInvestors(){
 const list=$("#investorList"),empty=$("#emptyState");
 empty.hidden=investors.length>0;list.innerHTML="";
 for(const person of investors){
  const items=sips.filter(s=>s.investor_id===person.id);
  const section=document.createElement("article");section.className="investor-card";
  section.innerHTML=`<div class="investor-top"><div class="person"><span class="avatar">${esc(initials(person.name))}</span><div><h3>${esc(person.name)}</h3><p>${person.email?esc(person.email):"Investor record"} ${person.phone?"· "+esc(person.phone):""}</p></div></div><div class="actions"><button class="text-btn" data-edit-investor="${person.id}">Edit</button><button class="text-btn add-sip" data-add-sip="${person.id}">＋ Add SIP</button><button class="icon-btn" title="Delete investor" data-delete-investor="${person.id}">•••</button></div></div>
  <div class="sip-table-wrap"><table><thead><tr><th>SCHEME</th><th>MONTHLY AMOUNT</th><th>STATUS</th><th>DUE DAY</th><th>SOURCE</th><th></th></tr></thead><tbody>${items.length?items.map(s=>sipRow(s)).join(""):'<tr><td class="no-sips" colspan="6">No SIP records yet. Add a SIP to keep this client’s book up to date.</td></tr>'}</tbody></table></div>`;
  list.append(section);
 }
}
function sipRow(s){return `<tr><td class="scheme">${esc(s.scheme)}</td><td>${money(s.amount_paise/100)}</td><td><span class="pill ${esc(s.status)}"><i></i>${esc(cap(s.status))}</span></td><td>${s.due_day?"Day "+s.due_day:"—"}</td><td><span class="source-tag">${esc(cap(s.data_source||"manual"))}</span></td><td><div class="row-actions"><button data-edit-sip="${s.id}">Edit</button><button data-delete-sip="${s.id}" aria-label="Delete SIP">×</button></div></td></tr>`;}
function renderDue(rows){const box=$("#dueList");box.innerHTML="";if(!rows.length){box.innerHTML='<p class="due-empty">No active SIP due days recorded.</p>';return;}for(const row of rows){const item=document.createElement("div");item.className="due-item";item.innerHTML=`<span class="date-box"><b>${String(row.due_day).padStart(2,"0")}</b><small>DAY</small></span><div><strong>${esc(row.investor)}</strong><p>${esc(row.scheme)}</p></div><span class="due-amount">${money(row.amount_paise/100)}</span>`;box.append(item);}}
function initials(s){return s.split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase();}
function cap(s){return s[0].toUpperCase()+s.slice(1);}
function populateInvestorOptions(){const select=$("#sipForm [name=investorId]");select.innerHTML=investors.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("");}
function openInvestor(person){const form=$("#investorForm");form.reset();form.elements.namedItem("id").value=person?.id||"";form.elements.namedItem("name").value=person?.name||"";form.elements.namedItem("email").value=person?.email||"";form.elements.namedItem("phone").value=person?.phone||"";form.elements.namedItem("notes").value=person?.notes||"";$("#investorDialogTitle").textContent=person?"Edit investor":"Add investor";$("#investorError").textContent="";$("#investorDialog").showModal();}
function openSip(sip, investorId){const form=$("#sipForm");form.reset();form.elements.namedItem("id").value=sip?.id||"";populateInvestorOptions();if(investorId)form.elements.namedItem("investorId").value=investorId;else if(sip)form.elements.namedItem("investorId").value=sip.investor_id;form.elements.namedItem("scheme").value=sip?.scheme||"";form.elements.namedItem("amount").value=sip?(sip.amount_paise/100):"";form.elements.namedItem("status").value=sip?.status||"active";form.elements.namedItem("dueDay").value=sip?.due_day||"";$("#sipDialogTitle").textContent=sip?"Edit SIP":"Add SIP";$("#sipError").textContent="";$("#sipDialog").showModal();}
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2500);}
$("#loginForm").addEventListener("submit",async e=>{e.preventDefault();const form=new FormData(e.currentTarget);$("#loginError").textContent="";try{const result=await api("/api/login",{method:"POST",body:JSON.stringify({username:form.get("username"),password:form.get("password")})});csrfToken=result.csrfToken;$("#userLabel").textContent=result.username;loginView.hidden=true;appView.hidden=false;await refresh();}catch(err){$("#loginError").textContent=err.message;}});
$("#logoutBtn").addEventListener("click",async()=>{try{await api("/api/logout",{method:"POST"});}finally{showLogin();}});
["#addInvestorBtn","#addInvestorTop","#emptyAddBtn"].forEach(id=>$(id).addEventListener("click",()=>openInvestor()));
document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>b.closest("dialog").close()));
$("#investorForm").addEventListener("submit",async e=>{e.preventDefault();const f=e.currentTarget,d=Object.fromEntries(new FormData(f));const id=d.id;delete d.id;try{await api(id?"/api/investors/"+id:"/api/investors",{method:id?"PUT":"POST",body:JSON.stringify(d)});$("#investorDialog").close();await refresh();toast(id?"Investor updated":"Investor added");}catch(err){$("#investorError").textContent=err.message;}});
$("#sipForm").addEventListener("submit",async e=>{e.preventDefault();const f=e.currentTarget,d=Object.fromEntries(new FormData(f));const id=d.id;delete d.id;d.amount=Number(d.amount);try{await api(id?"/api/sips/"+id:"/api/sips",{method:id?"PUT":"POST",body:JSON.stringify(d)});$("#sipDialog").close();await refresh();toast(id?"SIP updated":"SIP added");}catch(err){$("#sipError").textContent=err.message;}});
$("#investorList").addEventListener("click",async e=>{
 const b=e.target.closest("button");if(!b)return;
 try{
  if(b.dataset.editInvestor){openInvestor(investors.find(x=>x.id===Number(b.dataset.editInvestor)));}
  if(b.dataset.addSip)openSip(null,Number(b.dataset.addSip));
  if(b.dataset.editSip)openSip(sips.find(x=>x.id===Number(b.dataset.editSip)));
  if(b.dataset.deleteSip&&confirm("Delete this SIP record?")){await api("/api/sips/"+b.dataset.deleteSip,{method:"DELETE"});await refresh();toast("SIP deleted");}
  if(b.dataset.deleteInvestor&&confirm("Delete this investor and all their SIP records?")){await api("/api/investors/"+b.dataset.deleteInvestor,{method:"DELETE"});await refresh();toast("Investor deleted");}
 }catch(err){toast(err.message);}
});
$("#exportBtn").addEventListener("click",async()=>{try{const response=await fetch("/api/export",{headers:{"X-CSRF-Token":csrfToken}});if(!response.ok)throw new Error("Could not export records.");const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="mfd-records.csv";a.click();URL.revokeObjectURL(url);}catch(e){toast(e.message);}});
start();
$("#importBtn").addEventListener("click",()=>$("#importFile").click());
$("#importFile").addEventListener("change",async e=>{
 const file=e.currentTarget.files[0];if(!file)return;
 if(file.size>1500000){toast("CSV must be smaller than 1.5 MB.");e.currentTarget.value="";return;}
 try{const csv=await file.text();const result=await api("/api/import",{method:"POST",body:JSON.stringify({csv})});await refresh();toast(`Import complete: ${result.added} added, ${result.skipped} duplicates skipped`);}
 catch(err){toast(err.message);}
 finally{e.currentTarget.value="";}
});
