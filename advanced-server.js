const http=require("http"),fs=require("fs"),path=require("path"),{execFile}=require("child_process");
const DATA=process.env.WALKER_DATA_DIR||__dirname;
const FILE=path.join(DATA,"advanced-settings.json"),AUDIT=path.join(DATA,"audit.jsonl");
const defaults={profiles:[{name:"Dengeli",threshold:85,whitelist:[],targets:[]}],activeProfile:"Dengeli",schedules:[],quietHours:{enabled:false,start:"23:00",end:"08:00"},disableOnBattery:true,protectedPaths:[],dashboard:["telemetry","processes","history","insights"],totalReleased:0};
let state=load(),lastRule="";
function load(){try{return{...defaults,...JSON.parse(fs.readFileSync(FILE,"utf8"))}}catch{return structuredClone(defaults)}}
function save(){fs.mkdirSync(DATA,{recursive:true});fs.writeFileSync(FILE,JSON.stringify(state,null,2))}
function log(action,detail={}){fs.mkdirSync(DATA,{recursive:true});fs.appendFileSync(AUDIT,JSON.stringify({time:Date.now(),action,detail})+"\n")}
function logs(){try{return fs.readFileSync(AUDIT,"utf8").trim().split(/\r?\n/).filter(Boolean).slice(-300).map(JSON.parse).reverse()}catch{return[]}}
function ps(script){return new Promise((ok,no)=>execFile("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{windowsHide:true,timeout:15000,maxBuffer:2e6},(e,o,r)=>e?no(new Error(r.trim()||e.message)):ok(o.trim())))}
async function telemetry(){
 const raw=await ps(`$d=Get-CimInstance Win32_PerfFormattedData_PerfDisk_LogicalDisk -Filter "Name='_Total'";$n=Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface|Measure-Object BytesTotalPersec -Sum;$p=Get-CimInstance Win32_PageFileUsage;$b=Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue;[ordered]@{diskRead=[int64]$d.DiskReadBytesPersec;diskWrite=[int64]$d.DiskWriteBytesPersec;network=[int64]$n.Sum;pagefileAllocated=[int64](($p|Measure-Object AllocatedBaseSize -Sum).Sum)*1MB;pagefileUsed=[int64](($p|Measure-Object CurrentUsage -Sum).Sum)*1MB;onBattery=[bool]($b -and $b.BatteryStatus -notin @(2,6,7,8,9));startup=@(Get-CimInstance Win32_StartupCommand|Select Name,Command,Location)}|ConvertTo-Json -Depth 4 -Compress`);
 return JSON.parse(raw);
}
async function simulation(){
 const [memory,base]=await Promise.all([fetch("http://127.0.0.1:4173/api/memory").then(r=>r.json()),fetch("http://127.0.0.1:4173/api/settings").then(r=>r.json())]);
 const white=new Set((base.whitelist||[]).map(x=>x.toLowerCase())),targets=new Set((base.targets||[]).map(x=>x.toLowerCase()));
 const affected=(memory.processes||[]).filter(p=>targets.has(String(p.Name).toLowerCase())&&!white.has(String(p.Name).toLowerCase())).map(p=>({name:p.Name,pid:p.IDProcess,memory:p.WorkingSetPrivate}));
 return{affected,total:affected.reduce((s,x)=>s+Number(x.memory||0),0),warning:"Working Set küçültme sonrası uygulamalar ilk kullanımda kısa süreli yavaşlayabilir."};
}
async function processDetails(pid){
 if(!Number.isInteger(pid)||pid<1)throw new Error("Geçersiz PID");
 const raw=await ps(`$p=Get-Process -Id ${pid} -ErrorAction Stop;$path=$p.Path;$sig=if($path){Get-AuthenticodeSignature $path};$hash=if($path){(Get-FileHash $path -Algorithm SHA256).Hash};[ordered]@{name=$p.ProcessName;pid=$p.Id;path=$path;publisher=if($sig.SignerCertificate){$sig.SignerCertificate.Subject}else{$null};signature=if($sig){$sig.Status.ToString()}else{'Unknown'};sha256=$hash;started=try{$p.StartTime.ToString('o')}catch{$null}}|ConvertTo-Json -Compress`);
 return JSON.parse(raw);
}
function weekly(){
 const file=path.join(DATA,"history.jsonl"),since=Date.now()-7*864e5;let rows=[];
 try{rows=fs.readFileSync(file,"utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse).filter(x=>x.timestamp>=since)}catch{}
 if(!rows.length)return{samples:0};
 return{samples:rows.length,averageRam:Math.round(rows.reduce((s,x)=>s+x.ram,0)/rows.length),peakRam:Math.max(...rows.map(x=>x.ram)),averageCpu:Math.round(rows.reduce((s,x)=>s+x.cpu,0)/rows.length),totalReleased:state.totalReleased};
}
function inQuietHours(){if(!state.quietHours.enabled)return false;const now=new Date().toTimeString().slice(0,5),{start,end}=state.quietHours;return start<end?now>=start&&now<end:now>=start||now<end}
async function rulesTick(){
 const now=new Date(),key=now.toISOString().slice(0,16);if(key===lastRule)return;
 const rule=state.schedules.find(x=>x.enabled&&x.time===key.slice(11)&&(!x.days||x.days.includes(now.getDay())));if(!rule)return;
 const t=await telemetry().catch(()=>({}));if(state.disableOnBattery&&t.onBattery)return;lastRule=key;
 fetch("http://127.0.0.1:4173/api/optimize",{method:"POST"}).then(r=>r.json()).then(x=>{state.totalReleased+=Number(x.released||0);save();log("scheduled-optimize",{rule:rule.name,released:x.released||0})}).catch(()=>{});
}
setInterval(rulesTick,30000);
function body(req){return new Promise((ok,no)=>{let b="";req.on("data",c=>b+=c);req.on("end",()=>{try{ok(b?JSON.parse(b):{})}catch(e){no(e)}})})}
function send(res,status,data){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"http://127.0.0.1:4173","Cache-Control":"no-store"});res.end(JSON.stringify(data))}
const server=http.createServer(async(req,res)=>{
 if(req.method==="OPTIONS"){res.writeHead(204,{"Access-Control-Allow-Origin":"http://127.0.0.1:4173","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"GET,POST"});return res.end()}
 try{
  if(req.url==="/api/state"&&req.method==="GET")return send(res,200,{state,audit:logs(),quiet:inQuietHours(),telemetry:await telemetry()});
  if(req.url==="/api/state"&&req.method==="POST"){const b=await body(req);state={...state,...b};save();log("settings-updated");return send(res,200,state)}
  if(req.url==="/api/simulate")return send(res,200,await simulation());
  if(req.url.startsWith("/api/process/"))return send(res,200,await processDetails(Number(req.url.split("/").pop())));
  if(req.url==="/api/weekly")return send(res,200,weekly());
  if(req.url==="/api/audit"&&req.method==="POST"){const b=await body(req);if(b.action==="optimization")state.totalReleased+=Number(b.released||0);save();log(b.action||"event",b);return send(res,200,{success:true})}
  if(req.url==="/api/reset"&&req.method==="POST"){state=structuredClone(defaults);save();log("factory-reset");return send(res,200,state)}
  if(req.url==="/api/diagnostics"){return send(res,200,{generatedAt:new Date().toISOString(),platform:process.platform,arch:process.arch,version:require("./package.json").version,state:{...state,protectedPaths:state.protectedPaths.map(()=>"REDACTED")},telemetry:await telemetry(),audit:logs().slice(0,50)})}
  send(res,404,{error:"Not found"});
 }catch(e){send(res,500,{error:e.message})}
});
server.listen(4174,"127.0.0.1");
module.exports={server};
