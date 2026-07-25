const http=require("http"),fs=require("fs"),path=require("path"),{execFile}=require("child_process");
const DATA=process.env.WALKER_DATA_DIR||__dirname;
const PORT=Number(process.env.ADVANCED_PORT||4174);
const SESSION=process.env.WALKER_SESSION||"";
const UI_ORIGIN=`http://127.0.0.1:${process.env.PORT||4173}`;
const FILE=path.join(DATA,"advanced-settings.json"),AUDIT=path.join(DATA,"audit.jsonl");
const defaults={profiles:[{name:"Dengeli",threshold:85,whitelist:[],targets:[],triggerApps:[]}],activeProfile:"Dengeli",schedules:[],quietHours:{enabled:false,start:"23:00",end:"08:00"},disableOnBattery:true,protectedPaths:[],dashboard:["telemetry","processes","history","insights"],totalReleased:0,safeMode:false,notifications:[],retentionDays:30};
let state=load(),lastRule="";
function load(){try{return{...defaults,...JSON.parse(fs.readFileSync(FILE,"utf8"))}}catch{const clean=structuredClone(defaults);clean.safeMode=fs.existsSync(FILE);return clean}}
function save(){
 fs.mkdirSync(DATA,{recursive:true});
 if(fs.existsSync(FILE)){const versions=path.join(DATA,"settings-versions");fs.mkdirSync(versions,{recursive:true});fs.copyFileSync(FILE,path.join(versions,`${Date.now()}.json`));const files=fs.readdirSync(versions).sort().reverse();for(const old of files.slice(5))fs.unlinkSync(path.join(versions,old))}
 fs.writeFileSync(FILE,JSON.stringify(state,null,2));
}
if(!fs.existsSync(FILE))save();
function notify(title,message,type="info"){state.notifications.unshift({id:Date.now(),time:Date.now(),title,message,type,read:false});state.notifications=state.notifications.slice(0,100)}
function log(action,detail={}){fs.mkdirSync(DATA,{recursive:true});fs.appendFileSync(AUDIT,JSON.stringify({time:Date.now(),action,detail})+"\n")}
function restorePrevious(){const dir=path.join(DATA,"settings-versions");const file=fs.readdirSync(dir).sort().reverse()[0];if(!file)throw new Error("Geri alınacak ayar sürümü yok.");state={...defaults,...JSON.parse(fs.readFileSync(path.join(dir,file),"utf8"))};state.safeMode=false;save();log("settings-restored");return state}
function logs(){try{return fs.readFileSync(AUDIT,"utf8").trim().split(/\r?\n/).filter(Boolean).slice(-300).map(JSON.parse).reverse()}catch{return[]}}
function applyRetention(){
 const cutoff=Date.now()-Math.max(1,Number(state.retentionDays)||30)*864e5;
 state.notifications=(state.notifications||[]).filter(x=>x.time>=cutoff).slice(0,100);
 for(const file of[AUDIT,path.join(DATA,"history.jsonl")]){
  try{const kept=fs.readFileSync(file,"utf8").trim().split(/\r?\n/).filter(Boolean).filter(line=>{try{const x=JSON.parse(line);return Number(x.time||x.timestamp)>=cutoff}catch{return false}});fs.writeFileSync(file,kept.length?kept.join("\n")+"\n":"")}catch{}
 }
 save();
}
setTimeout(applyRetention,3000);setInterval(applyRetention,24*60*60*1000);
function ps(script){return new Promise((ok,no)=>execFile("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{windowsHide:true,timeout:15000,maxBuffer:2e6},(e,o,r)=>e?no(new Error(r.trim()||e.message)):ok(o.trim())))}
async function telemetry(){
 const raw=await ps(`$d=Get-CimInstance Win32_PerfFormattedData_PerfDisk_LogicalDisk -Filter "Name='_Total'";$n=Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface|Measure-Object BytesTotalPersec -Sum;$p=Get-CimInstance Win32_PageFileUsage;$b=Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue;$connections=@{};Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue|Group-Object OwningProcess|ForEach-Object{$connections[[int]$_.Name]=$_.Count};$io=Get-CimInstance Win32_PerfFormattedData_PerfProc_Process|Where-Object{$_.IDProcess -gt 0 -and ($_.IOReadBytesPersec+$_.IOWriteBytesPersec) -gt 0}|Sort-Object {$_.IOReadBytesPersec+$_.IOWriteBytesPersec} -Descending|Select-Object -First 20 Name,IDProcess,IOReadBytesPersec,IOWriteBytesPersec,@{n='TcpConnections';e={[int]$connections[[int]$_.IDProcess]}};[ordered]@{diskRead=[int64]$d.DiskReadBytesPersec;diskWrite=[int64]$d.DiskWriteBytesPersec;network=[int64]$n.Sum;pagefileAllocated=[int64](($p|Measure-Object AllocatedBaseSize -Sum).Sum)*1MB;pagefileUsed=[int64](($p|Measure-Object CurrentUsage -Sum).Sum)*1MB;onBattery=[bool]($b -and $b.BatteryStatus -notin @(2,6,7,8,9));startup=@(Get-CimInstance Win32_StartupCommand|Select Name,Command,Location);processIo=@($io)}|ConvertTo-Json -Depth 5 -Compress`);
 const detail=JSON.parse(raw),lower=String(detail.path||"").toLowerCase();
 detail.protected=(state.protectedPaths||[]).some(p=>lower.startsWith(String(p).toLowerCase()))||/goodbyedpi|splitware|splitwire|wireguard|dnscrypt|openvpn/.test(String(detail.name).toLowerCase());
 detail.classification=detail.protected?"Protected":detail.signature==="Valid"&&/microsoft/i.test(detail.publisher||"")?"Trusted":detail.signature==="Valid"?"Signed":"Unverified";
 return detail;
}
async function health(){
 const [memory,io]=await Promise.all([fetch(`http://127.0.0.1:${process.env.PORT||4173}/api/memory`).then(r=>r.json()),telemetry()]);
 const ram=memory.total?memory.used/memory.total*100:0,page=io.pagefileAllocated?io.pagefileUsed/io.pagefileAllocated*100:0,cpu=Number(memory.cpu||0),temp=Number(memory.temperature||0);
 let score=100;score-=Math.max(0,ram-65)*.7;score-=Math.max(0,cpu-70)*.35;score-=Math.max(0,page-35)*.45;if(temp)score-=Math.max(0,temp-75)*.8;score=Math.max(0,Math.round(score));
 const factors=[{key:"ram",value:ram,label:"RAM kullanımı"},{key:"cpu",value:cpu,label:"CPU kullanımı"},{key:"pagefile",value:page,label:"Pagefile baskısı"},{key:"disk",value:Math.min(100,(io.diskRead+io.diskWrite)/50e6*100),label:"Disk etkinliği"}].sort((a,b)=>b.value-a.value);
 const top=factors[0],severity=top.value>=90?"critical":top.value>=75?"warning":"normal";
 return{score,severity,bottleneck:severity==="normal"?"Belirgin bir darboğaz yok.":`${top.label} sistem üzerindeki en yüksek baskı.`,factors,memory,io};
}
async function simulation(){
 const main=`http://127.0.0.1:${process.env.PORT||4173}`;
 const [memory,base]=await Promise.all([fetch(`${main}/api/memory`).then(r=>r.json()),fetch(`${main}/api/settings`).then(r=>r.json())]);
 const white=new Set((base.whitelist||[]).map(x=>x.toLowerCase())),targets=new Set((base.targets||[]).map(x=>x.toLowerCase()));
 const affected=(memory.processes||[]).filter(p=>targets.has(String(p.Name).toLowerCase())&&!white.has(String(p.Name).toLowerCase())).map(p=>({name:p.Name,pid:p.IDProcess,memory:p.WorkingSetPrivate}));
 return{affected,total:affected.reduce((s,x)=>s+Number(x.memory||0),0),warning:"Working Set küçültme sonrası uygulamalar ilk kullanımda kısa süreli yavaşlayabilir."};
}
async function processDetails(pid){
 if(!Number.isInteger(pid)||pid<1)throw new Error("Geçersiz PID");
 const raw=await ps(`$p=Get-Process -Id ${pid} -ErrorAction Stop;$path=$p.Path;$sig=if($path){Get-AuthenticodeSignature $path};$hash=if($path){(Get-FileHash $path -Algorithm SHA256).Hash};[ordered]@{name=$p.ProcessName;pid=$p.Id;path=$path;publisher=if($sig.SignerCertificate){$sig.SignerCertificate.Subject}else{$null};signature=if($sig){$sig.Status.ToString()}else{'Unknown'};sha256=$hash;started=try{$p.StartTime.ToString('o')}catch{$null}}|ConvertTo-Json -Compress`);
 return JSON.parse(raw);
}
async function foregroundFullscreen(){
 try{return JSON.parse(await ps(`Add-Type -AssemblyName System.Windows.Forms;Add-Type @'
using System;using System.Runtime.InteropServices;public static class WalkerWindow{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out RECT r);public struct RECT{public int Left,Top,Right,Bottom;}}
'@;$h=[WalkerWindow]::GetForegroundWindow();$r=New-Object WalkerWindow+RECT;[void][WalkerWindow]::GetWindowRect($h,[ref]$r);$screen=[Windows.Forms.Screen]::FromHandle($h).Bounds;[ordered]@{fullscreen=($r.Left-le $screen.Left-and$r.Top-le $screen.Top-and$r.Right-ge $screen.Right-and$r.Bottom-ge $screen.Bottom);title=(Get-Process|Where-Object MainWindowHandle -eq $h|Select-Object -First 1 -ExpandProperty ProcessName)}|ConvertTo-Json -Compress`))}catch{return{fullscreen:false,title:null}}
}
async function processTree(){
 try{return JSON.parse(await ps(`$all=Get-CimInstance Win32_Process|Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize;$roots=$all|Where-Object{$_.ProcessId -gt 4}|Sort-Object WorkingSetSize -Descending|Select-Object -First 60;@($roots|ForEach-Object{[ordered]@{pid=$_.ProcessId;parentPid=$_.ParentProcessId;name=$_.Name;memory=[int64]$_.WorkingSetSize}})|ConvertTo-Json -Compress`))}catch{return[]}
}
async function recommendations(){
 const main=`http://127.0.0.1:${process.env.PORT||4173}`,[memory,settings]=await Promise.all([fetch(`${main}/api/memory`).then(r=>r.json()),fetch(`${main}/api/settings`).then(r=>r.json())]),white=new Set((settings.whitelist||[]).map(x=>String(x).toLowerCase()));
 const top=(memory.processes||[]).filter(p=>!white.has(String(p.Name).toLowerCase())).sort((a,b)=>Number(b.WorkingSetPrivate)-Number(a.WorkingSetPrivate)).slice(0,5);
 return top.map(p=>({name:p.Name,memory:Number(p.WorkingSetPrivate||0),reason:Number(p.WorkingSetPrivate||0)>1073741824?"Çok yüksek bellek kullanımı":"Profil hedefi olarak değerlendirilebilir",action:"suggest-target"}));
}
function weekly(){
 const file=path.join(DATA,"history.jsonl"),since=Date.now()-7*864e5;let rows=[];
 try{rows=fs.readFileSync(file,"utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse).filter(x=>x.timestamp>=since)}catch{}
 if(!rows.length)return{samples:0};
 return{samples:rows.length,averageRam:Math.round(rows.reduce((s,x)=>s+x.ram,0)/rows.length),peakRam:Math.max(...rows.map(x=>x.ram)),averageCpu:Math.round(rows.reduce((s,x)=>s+x.cpu,0)/rows.length),totalReleased:state.totalReleased};
}
function htmlReport(data){
 const esc=x=>String(x??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
 return`<!doctype html><meta charset="utf-8"><title>Walker RAMMap Raporu</title><style>body{font:14px system-ui;background:#0b0e12;color:#eef;padding:40px;max-width:900px;margin:auto}h1{color:#c8ff3d}.card{border:1px solid #39414d;padding:18px;margin:12px 0}table{width:100%;border-collapse:collapse}td,th{padding:9px;border-bottom:1px solid #29303a;text-align:left}</style><h1>Walker RAMMap Performans Raporu</h1><p>Developed by akgunwalker · ${new Date().toLocaleString("tr-TR")}</p><div class="card"><h2>Sağlık puanı: ${data.score}/100</h2><p>${esc(data.bottleneck)}</p></div><div class="card"><h2>Sistem</h2><table><tr><th>RAM</th><td>%${Math.round(data.memory.used/data.memory.total*100)}</td></tr><tr><th>CPU</th><td>%${data.memory.cpu}</td></tr><tr><th>GPU</th><td>%${data.memory.gpu}</td></tr><tr><th>Pagefile</th><td>${Math.round(data.io.pagefileUsed/1048576)} / ${Math.round(data.io.pagefileAllocated/1048576)} MB</td></tr></table></div>`;
}
function inQuietHours(){if(!state.quietHours.enabled)return false;const now=new Date().toTimeString().slice(0,5),{start,end}=state.quietHours;return start<end?now>=start&&now<end:now>=start||now<end}
async function rulesTick(){
 const now=new Date(),key=now.toISOString().slice(0,16);if(key===lastRule)return;
 const rule=state.schedules.find(x=>x.enabled&&x.time===key.slice(11)&&(!x.days||x.days.includes(now.getDay())));if(!rule)return;
 const t=await telemetry().catch(()=>({}));if(state.disableOnBattery&&t.onBattery)return;lastRule=key;
 fetch(`http://127.0.0.1:${process.env.PORT||4173}/api/optimize`,{method:"POST"}).then(r=>r.json()).then(x=>{state.totalReleased+=Number(x.released||0);notify("Zamanlanmış optimizasyon",`${rule.name}: ${Math.round(Number(x.released||0)/1048576)} MB kazanıldı.`,"success");save();log("scheduled-optimize",{rule:rule.name,released:x.released||0})}).catch(()=>{});
}
setInterval(rulesTick,30000);
async function profileTick(){
 try{
  const memory=await fetch(`http://127.0.0.1:${process.env.PORT||4173}/api/memory`).then(r=>r.json()),running=new Set((memory.processes||[]).map(x=>String(x.Name).toLowerCase()));
  const matched=state.profiles.find(p=>(p.triggerApps||[]).some(x=>running.has(String(x).toLowerCase())));
  if(matched&&matched.name!==state.activeProfile){state.activeProfile=matched.name;save();notify("Profil etkinleştirildi",`${matched.name} profili çalışan uygulamaya göre seçildi.`);await fetch(`http://127.0.0.1:${process.env.PORT||4173}/api/settings`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({whitelist:matched.whitelist||[],targets:matched.targets||[],threshold:matched.threshold||85})});log("profile-auto-activated",{profile:matched.name})}
 }catch{}
}
setInterval(profileTick,10000);
function body(req){return new Promise((ok,no)=>{let b="";req.on("data",c=>b+=c);req.on("end",()=>{try{ok(b?JSON.parse(b):{})}catch(e){no(e)}})})}
function send(res,status,data){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":UI_ORIGIN,"Cache-Control":"no-store"});res.end(JSON.stringify(data))}
const server=http.createServer(async(req,res)=>{
 if(req.method==="OPTIONS"){res.writeHead(204,{"Access-Control-Allow-Origin":UI_ORIGIN,"Access-Control-Allow-Headers":"Content-Type,X-Walker-Session","Access-Control-Allow-Methods":"GET,POST"});return res.end()}
 const requestUrl=new URL(req.url,`http://127.0.0.1:${PORT}`);
 if(SESSION&&req.headers["x-walker-session"]!==SESSION&&requestUrl.searchParams.get("session")!==SESSION)return send(res,401,{error:"Geçersiz yerel oturum."});
 try{
  if(req.url==="/api/state"&&req.method==="GET"){const[t,foreground]=await Promise.all([telemetry(),foregroundFullscreen()]);return send(res,200,{state,audit:logs(),quiet:inQuietHours()||foreground.fullscreen,foreground,telemetry:t})}
  if(req.url==="/api/state"&&req.method==="POST"){const b=await body(req);state={...state,...b};save();log("settings-updated");return send(res,200,state)}
  if(req.url==="/api/undo"&&req.method==="POST")return send(res,200,restorePrevious());
  if(req.url==="/api/notifications/read"&&req.method==="POST"){state.notifications=state.notifications.map(x=>({...x,read:true}));save();return send(res,200,state.notifications)}
  if(req.url==="/api/notifications/clear"&&req.method==="POST"){state.notifications=[];save();log("notifications-cleared");return send(res,200,[])}
  if(req.url==="/api/simulate")return send(res,200,await simulation());
  if(req.url.startsWith("/api/process/"))return send(res,200,await processDetails(Number(req.url.split("/").pop())));
  if(req.url==="/api/weekly")return send(res,200,weekly());
  if(req.url==="/api/health")return send(res,200,await health());
  if(req.url==="/api/process-tree")return send(res,200,await processTree());
  if(req.url==="/api/recommendations")return send(res,200,await recommendations());
  if(req.url.startsWith("/api/report")){
   const data=await health();if(requestUrl.searchParams.get("format")==="html"){const html=htmlReport(data);res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Content-Disposition":'attachment; filename="walker-rammap-report.html"'});return res.end(html)}
   return send(res,200,data);
  }
  if(req.url==="/api/audit"&&req.method==="POST"){const b=await body(req);if(b.action==="optimization")state.totalReleased+=Number(b.released||0);save();log(b.action||"event",b);return send(res,200,{success:true})}
  if(req.url==="/api/security"){const memory=await fetch(`http://127.0.0.1:${process.env.PORT||4173}/api/memory`).then(r=>r.json());return send(res,200,{safeMode:state.safeMode,sessionProtected:Boolean(SESSION),protectedPaths:state.protectedPaths||[],protectedApplications:["GoodByeDPI","Splitware","SplitWire","WireGuard","dnscrypt-proxy","OpenVPN"],processCount:(memory.processes||[]).length,retentionDays:state.retentionDays})}
  if(req.url==="/api/reset"&&req.method==="POST"){state=structuredClone(defaults);save();log("factory-reset");return send(res,200,state)}
  if(req.url==="/api/diagnostics"){return send(res,200,{application:"Walker RAMMap",developer:"akgunwalker",generatedAt:new Date().toISOString(),platform:process.platform,arch:process.arch,version:require("./package.json").version,state:{...state,protectedPaths:state.protectedPaths.map(()=>"REDACTED")},telemetry:await telemetry(),audit:logs().slice(0,50)})}
  send(res,404,{error:"Not found"});
 }catch(e){send(res,500,{error:e.message})}
});
server.listen(PORT,"127.0.0.1");
module.exports={server};
