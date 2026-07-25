const $ = (id) => document.getElementById(id);
const history = [];
const cpuHistory = [];
let processes = [];
let loading = false;
let currentSettings = { whitelist:[], targets:[], games:[] };
const translations={
  tr:{welcome:"Walker RAMMap'e hoş geldiniz",welcomeText:"Görünümü ve temel otomasyonu birkaç saniyede ayarlayın.",language:"Dil",theme:"Tema",autoSetup:"RAM %85'i aşınca otomatik optimize et",start:"BAŞLA"},
  en:{welcome:"Welcome to Walker RAMMap",welcomeText:"Configure appearance and basic automation in seconds.",language:"Language",theme:"Theme",autoSetup:"Automatically optimize when RAM exceeds 85%",start:"GET STARTED"}
};
function applyAppearance(theme,language){
  const actual=theme==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):theme;
  document.documentElement.dataset.theme=actual;document.documentElement.lang=language;
  $("quickTheme").value=theme;$("quickLanguage").value=language;
  document.querySelectorAll("[data-i18n]").forEach(el=>{const value=translations[language]?.[el.dataset.i18n];if(value)el.textContent=value});
  localStorage.setItem("walkerAppearance",JSON.stringify({theme,language}));
}
const appearance=JSON.parse(localStorage.getItem("walkerAppearance")||'{"theme":"dark","language":"tr"}');
applyAppearance(appearance.theme,appearance.language);

const bytes = (n) => {
  if (!Number.isFinite(Number(n))) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(n), i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(i >= 3 ? 2 : i === 2 ? 1 : 0)} ${units[i]}`;
};

function renderProcesses() {
  const query = $("search").value.toLocaleLowerCase("tr");
  const list = processes.filter(p => String(p.Name).toLocaleLowerCase("tr").includes(query));
  const max = Math.max(...processes.map(p => Number(p.WorkingSetPrivate)), 1);
  $("processList").innerHTML = list.length ? list.map(p => `
    <div class="process-row">
      <div class="process-name"><strong>${escapeHtml(p.Name)}</strong><small>${Number(p.ThreadCount || 0)} thread · ${Number(p.HandleCount || 0)} handle</small></div>
      <span>${p.IDProcess}</span><span>${bytes(p.WorkingSetPrivate)}</span><button class="process-action" data-process="${escapeHtml(p.Name)}">KAPAT</button>
      <i class="bar-bg" style="width:${Math.max(1, Number(p.WorkingSetPrivate) / max * 100)}%"></i>
    </div>`).join("") : '<div class="empty">Eşleşen süreç bulunamadı.</div>';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function drawChart() {
  const canvas = $("chart"), rect = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#222831"; ctx.lineWidth = 1;
  for (let i=0;i<5;i++){const y=i*h/4;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
  if (history.length < 2) return;
  const pts = history.map((v,i) => [i/(Math.max(history.length-1,59))*w, h-(v/100*h)]);
  const grad = ctx.createLinearGradient(0,0,0,h); grad.addColorStop(0,"rgba(200,255,61,.28)");grad.addColorStop(1,"rgba(200,255,61,0)");
  ctx.beginPath();ctx.moveTo(pts[0][0],h);pts.forEach(p=>ctx.lineTo(...p));ctx.lineTo(pts.at(-1)[0],h);ctx.closePath();ctx.fillStyle=grad;ctx.fill();
  ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.strokeStyle="#c8ff3d";ctx.lineWidth=2;ctx.stroke();
  if (cpuHistory.length > 1) {
    const cpuPts=cpuHistory.map((v,i)=>[i/(Math.max(cpuHistory.length-1,59))*w,h-(v/100*h)]);
    ctx.beginPath();cpuPts.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.strokeStyle="#7b61ff";ctx.lineWidth=2;ctx.stroke();
  }
}

function update(data) {
  const pct = data.total ? data.used / data.total * 100 : 0;
  $("machine").textContent = data.machine || "YEREL MAKİNE";
  $("usedPercent").textContent = `${pct.toFixed(0)}%`;
  $("ring").style.setProperty("--p", pct);
  $("total").textContent = bytes(data.total);
  $("used").textContent = bytes(data.used);
  $("cached").textContent = bytes(data.cached);
  $("free").textContent = bytes(data.free);
  $("memoryBar").innerHTML = `
    <div class="used" style="width:${data.used/data.total*100}%"></div>
    <div class="cached" style="width:${data.cached/data.total*100}%"></div>
    <div class="free" style="width:${data.free/data.total*100}%"></div>`;
  $("commit").textContent = bytes(data.committed);
  $("commitLimit").textContent = `limit ${bytes(data.commitLimit)}`;
  $("paged").textContent = bytes(data.pagedPool);
  $("nonPaged").textContent = bytes(data.nonPagedPool);
  $("pageIo").textContent = Number(data.pageReads || 0) + Number(data.pageWrites || 0);
  $("compressed").textContent = bytes(data.compressed);
  $("standbyRam").textContent = bytes(data.standby);
  $("modifiedRam").textContent = bytes(data.modified);
  $("gpu").textContent = `%${Number(data.gpu || 0)}`;
  $("temperature").textContent = data.temperature == null ? "sensör yok" : `${data.temperature} °C`;
  $("gameStatus").textContent=data.gameActive?"OYUN MODU AKTİF":"OYUN BEKLENİYOR";
  $("gameStatus").classList.toggle("active",Boolean(data.gameActive));
  renderInsights(data);
  if (currentSettings.compressedThreshold && data.compressed > currentSettings.compressedThreshold*1024*1024 && !update.compressedWarned) {
    update.compressedWarned=true; toast("Sıkıştırılmış bellek eşiği aşıldı. Optimizasyon önerilir.");
  }
  $("time").textContent = new Date(data.timestamp).toLocaleTimeString("tr-TR") + " / CANLI";
  processes = Array.isArray(data.processes) ? data.processes : data.processes ? [data.processes] : [];
  renderProcesses();
  history.push(pct); if(history.length > 60) history.shift();
  cpuHistory.push(Number(data.cpu || 0)); if(cpuHistory.length > 60) cpuHistory.shift();
  $("cpuValue").textContent = `%${Number(data.cpu || 0)}`;
  drawChart();
  document.querySelector(".status").classList.remove("error");
  $("statusText").textContent = "CANLI VERİ";
}

async function refresh() {
  if (loading) return; loading = true; $("refresh").style.transform = "rotate(180deg)";
  try {
    const response = await fetch("/api/memory", { cache: "no-store" });
    if (!response.ok) throw new Error((await response.json()).detail);
    update(await response.json());
  } catch (error) {
    document.querySelector(".status").classList.add("error");
    $("statusText").textContent = "VERİ ALINAMADI";
    console.error(error);
  } finally { loading = false; $("refresh").style.transform = ""; }
}

$("search").addEventListener("input", renderProcesses);
$("refresh").addEventListener("click", refresh);
addEventListener("resize", drawChart);
refresh();
setInterval(refresh, 3000);

function toast(message, error=false) {
  $("toast").textContent=message; $("toast").className=`toast show${error?" error":""}`;
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>$("toast").className="toast",4000);
}
async function runAction(id, endpoint) {
  if (id==="optimize" && !confirm("Seçtiğiniz uygulamaların çalışma belleği azaltılacak. İlk kullanımlarında kısa süreli yavaşlama olabilir. Beyaz listedeki uygulamalara dokunulmaz. Devam edilsin mi?")) return;
  const button=$(id); button.disabled=true; button.classList.add("working");
  try {
    const response=await fetch(endpoint,{method:"POST"}), data=await response.json();
    if(!response.ok) throw new Error(data.error);
    const detail=data.released ? `${bytes(data.released)} kullanılabilir alan kazanıldı.` : data.stopped ? `${data.stopped.length} arka plan uygulaması durduruldu.` : "İşlem tamamlandı.";
    if(id==="optimize"){
      $("lastReleased").textContent=bytes(data.released||0);
      $("lastAffected").textContent=`${data.affected||0} süreç etkilendi`;
      fetch("http://127.0.0.1:4174/api/audit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"optimization",released:data.released||0,affected:data.affected||0,names:data.names||[]})}).catch(()=>{});
    }
    toast(detail); setTimeout(refresh,600);
  } catch(error) { toast(error.message || "İşlem başarısız.",true); }
  finally { button.disabled=false; button.classList.remove("working"); }
}
async function saveSettings() {
  try {
    const response=await fetch("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...currentSettings,autoClean:$("autoClean").checked,threshold:Number($("threshold").value),startup:$("startup").checked})});
    const data=await response.json(); if(!response.ok) throw new Error(data.error); currentSettings=data; renderLists(); toast("Ayarlar kaydedildi.");
  } catch(error) { toast(error.message,true); loadSettings(); }
}
async function loadSettings() {
  const s=await fetch("/api/settings").then(r=>r.json());
  currentSettings=s;
  $("autoClean").checked=s.autoClean; $("startup").checked=s.startup;
  $("threshold").value=s.threshold; $("thresholdValue").textContent=`%${s.threshold}`;
  renderLists();
}
function renderLists() {
  for (const [key,id] of [["whitelist","whitelistChips"],["targets","targetChips"],["games","gameChips"]]) {
    $(id).innerHTML=(currentSettings[key]||[]).map(name=>`<button class="chip" data-remove="${key}" data-name="${escapeHtml(name)}">${escapeHtml(name)} <b>×</b></button>`).join("")||"<small>Henüz eklenmedi</small>";
  }
}
document.querySelectorAll("[data-add]").forEach(button=>button.addEventListener("click",()=>{
  const key=button.dataset.add, input=$(key==="targets"?"targetInput":key==="games"?"gameInput":"whitelistInput"), name=input.value.trim().replace(/\.exe$/i,"");
  if(!name)return; currentSettings[key]=[...new Set([...(currentSettings[key]||[]),name])];input.value="";saveSettings();
}));
document.querySelector(".list-editor").addEventListener("click",event=>{
  const button=event.target.closest("[data-remove]");if(!button)return;
  currentSettings[button.dataset.remove]=currentSettings[button.dataset.remove].filter(x=>x!==button.dataset.name);saveSettings();
});
$("optimize").addEventListener("click",()=>runAction("optimize","/api/optimize"));
$("gameMode").addEventListener("click",()=>runAction("gameMode","/api/game-mode"));
$("standby").addEventListener("click",()=>runAction("standby","/api/standby"));
$("autoClean").addEventListener("change",saveSettings);
$("startup").addEventListener("change",saveSettings);
$("threshold").addEventListener("input",()=>$("thresholdValue").textContent=`%${$("threshold").value}`);
$("threshold").addEventListener("change",saveSettings);
loadSettings();
$("quickTheme").addEventListener("change",()=>applyAppearance($("quickTheme").value,$("quickLanguage").value));
$("quickLanguage").addEventListener("change",()=>applyAppearance($("quickTheme").value,$("quickLanguage").value));
if(!localStorage.getItem("walkerSetupComplete")){$("setupWizard").hidden=false;$("setupTheme").value=appearance.theme;$("setupLanguage").value=appearance.language}
$("finishSetup").addEventListener("click",async()=>{
  applyAppearance($("setupTheme").value,$("setupLanguage").value);
  if($("setupAuto").checked){$("autoClean").checked=true;await saveSettings()}
  localStorage.setItem("walkerSetupComplete","1");$("setupWizard").hidden=true;
});
function renderInsights(data) {
  const leaks=data.leaks||[], suggestions=data.suggestions||[];
  const items=[
    ...leaks.map(x=>`<div class="insight danger"><strong>${escapeHtml(x.name)}</strong><span>${x.minutes} dakikada +${bytes(x.growth)} — olası bellek kaçağı</span></div>`),
    ...suggestions.map(x=>`<div class="insight"><strong>${escapeHtml(x.name)}</strong><span>${bytes(x.memory)} kullanıyor</span><button data-suggest="${escapeHtml(x.name)}">HEDEFLE</button></div>`)
  ];
  $("insights").innerHTML=items.join("")||'<div class="empty">Şu anda kritik bir bulgu yok.</div>';
}
$("insights").addEventListener("click",event=>{
  const button=event.target.closest("[data-suggest]");if(!button)return;
  currentSettings.targets=[...new Set([...currentSettings.targets,button.dataset.suggest])];saveSettings();
});
$("processList").addEventListener("click",async event=>{
  const button=event.target.closest("[data-process]");if(!button)return;
  const name=button.dataset.process;
  if(!confirm(`${name} uygulamasına normal kapatma isteği gönderilecek. Kaydedilmemiş verileriniz varsa önce kaydedin. Devam edilsin mi?`))return;
  try{const r=await fetch("/api/process/close",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,force:false})});const d=await r.json();if(!r.ok)throw new Error(d.error);toast(d.requested?`${name} için kapatma isteği gönderildi.`:`${name} pencereli bir uygulama değil; zorla kapatılmadı.`)}catch(e){toast(e.message,true)}
});
async function loadHistory(){
  const rows=await fetch("/api/history").then(r=>r.json()).catch(()=>[]),canvas=$("historyChart"),ctx=canvas.getContext("2d"),rect=canvas.getBoundingClientRect(),dpr=devicePixelRatio||1;
  canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;ctx.scale(dpr,dpr);const w=rect.width,h=rect.height;ctx.clearRect(0,0,w,h);ctx.strokeStyle="#222831";
  for(let i=0;i<5;i++){ctx.beginPath();ctx.moveTo(0,i*h/4);ctx.lineTo(w,i*h/4);ctx.stroke()}
  if(rows.length<2)return;const recent=rows.slice(-2880),pts=recent.map((x,i)=>[i/(recent.length-1)*w,h-x.ram/100*h]);ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.strokeStyle="#35d7c8";ctx.lineWidth=2;ctx.stroke();
}
$("versionCheck").addEventListener("click",async()=>{const v=await fetch("/api/version").then(r=>r.json());toast(v.updateConfigured?`Sürüm ${v.version}`:`Sürüm ${v.version} güncel. Yayın kanalı henüz yapılandırılmadı.`)});
$("restoreButton").addEventListener("click",()=>$("restoreFile").click());
$("restoreFile").addEventListener("change",async event=>{
  try{const backup=JSON.parse(await event.target.files[0].text());const r=await fetch("/api/restore",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(backup)}),d=await r.json();if(!r.ok)throw new Error(d.error);toast("Ayar yedeği geri yüklendi.");loadSettings()}catch(e){toast(`Yedek yüklenemedi: ${e.message}`,true)}event.target.value="";
});
loadHistory();setInterval(loadHistory,60000);

let advancedState;
const advancedUrl="http://127.0.0.1:4174/api";
async function saveAdvanced(patch){
  advancedState={...advancedState,...patch};
  await fetch(`${advancedUrl}/state`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(advancedState)});
  renderAdvanced();
}
function renderAdvanced(){
  if(!advancedState)return;
  $("profileSelect").innerHTML=advancedState.profiles.map(p=>`<option ${p.name===advancedState.activeProfile?"selected":""}>${escapeHtml(p.name)}</option>`).join("");
  $("rulesList").innerHTML=advancedState.schedules.map((r,i)=>`<div>${escapeHtml(r.name)} · ${r.time} <button data-rule-remove="${i}">×</button></div>`).join("")||"<div>Kural yok</div>";
  $("quietEnabled").checked=advancedState.quietHours.enabled;$("quietStart").value=advancedState.quietHours.start;$("quietEnd").value=advancedState.quietHours.end;$("batteryDisable").checked=advancedState.disableOnBattery;
  $("totalReleased").textContent=bytes(advancedState.totalReleased||0);
}
async function loadAdvanced(){
  try{
    const data=await fetch(`${advancedUrl}/state`).then(r=>r.json());advancedState=data.state;renderAdvanced();
    const t=data.telemetry;$("ioDisk").textContent=`${bytes(t.diskRead)}/s · ${bytes(t.diskWrite)}/s`;$("ioNetwork").textContent=`${bytes(t.network)}/s`;$("ioPagefile").textContent=`${bytes(t.pagefileUsed)} / ${bytes(t.pagefileAllocated)}`;
    $("auditList").innerHTML=data.audit.slice(0,6).map(x=>`<div>${new Date(x.time).toLocaleTimeString("tr-TR")} · ${escapeHtml(x.action)}</div>`).join("")||"<div>Kayıt yok</div>";
  }catch{}
}
$("addProfile").addEventListener("click",()=>{const name=prompt("Profil adı");if(!name)return;advancedState.profiles.push({name,threshold:Number($("threshold").value),whitelist:[...currentSettings.whitelist],targets:[...currentSettings.targets]});saveAdvanced({activeProfile:name})});
$("deleteProfile").addEventListener("click",()=>{if(advancedState.profiles.length===1)return toast("En az bir profil kalmalı.",true);advancedState.profiles=advancedState.profiles.filter(p=>p.name!==advancedState.activeProfile);saveAdvanced({activeProfile:advancedState.profiles[0].name})});
$("profileSelect").addEventListener("change",async()=>{const p=advancedState.profiles.find(x=>x.name===$("profileSelect").value);await saveAdvanced({activeProfile:p.name});currentSettings.whitelist=[...p.whitelist];currentSettings.targets=[...p.targets];$("threshold").value=p.threshold;await saveSettings()});
$("addRule").addEventListener("click",()=>{const name=$("ruleName").value.trim()||"Optimizasyon";advancedState.schedules.push({name,time:$("ruleTime").value,days:[0,1,2,3,4,5,6],enabled:true});$("ruleName").value="";saveAdvanced({schedules:advancedState.schedules})});
$("rulesList").addEventListener("click",e=>{const b=e.target.closest("[data-rule-remove]");if(!b)return;advancedState.schedules.splice(Number(b.dataset.ruleRemove),1);saveAdvanced({schedules:advancedState.schedules})});
for(const id of["quietEnabled","quietStart","quietEnd","batteryDisable"])$(id).addEventListener("change",()=>saveAdvanced({quietHours:{enabled:$("quietEnabled").checked,start:$("quietStart").value,end:$("quietEnd").value},disableOnBattery:$("batteryDisable").checked}));
$("factoryReset").addEventListener("click",async()=>{if(!confirm("Gelişmiş ayarlar fabrika değerlerine döndürülsün mü?"))return;advancedState=await fetch(`${advancedUrl}/reset`,{method:"POST"}).then(r=>r.json());renderAdvanced();toast("Gelişmiş ayarlar sıfırlandı.")});
$("settingsSearch").addEventListener("input",()=>{const q=$("settingsSearch").value.toLowerCase();document.querySelectorAll(".advanced-card").forEach(x=>x.hidden=!x.dataset.setting.includes(q))});
document.addEventListener("keydown",e=>{if(e.ctrlKey&&e.shiftKey&&e.key.toLowerCase()==="o"){$("optimize").click();e.preventDefault()}});
document.querySelectorAll(".advanced-card").forEach(x=>{x.draggable=true;x.addEventListener("dragstart",()=>x.classList.add("dragging"));x.addEventListener("dragend",()=>x.classList.remove("dragging"))});
document.querySelector(".advanced-grid").addEventListener("dragover",e=>{e.preventDefault();const active=document.querySelector(".advanced-card.dragging"),after=[...document.querySelectorAll(".advanced-card:not(.dragging)")].find(x=>e.clientY<x.getBoundingClientRect().top+x.offsetHeight/2);document.querySelector(".advanced-grid").insertBefore(active,after||null);localStorage.setItem("walkerDashboard",JSON.stringify([...document.querySelectorAll(".advanced-card")].map(x=>x.dataset.setting)))});
loadAdvanced();setInterval(loadAdvanced,10000);
