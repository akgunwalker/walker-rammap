const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const PORT = Number(process.env.PORT || 4173);
const ROOT = path.join(__dirname, "public");
const SETTINGS_FILE = path.join(process.env.WALKER_DATA_DIR || __dirname, "settings.json");
const HISTORY_FILE = path.join(process.env.WALKER_DATA_DIR || __dirname, "history.jsonl");
const MIME = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"application/javascript; charset=utf-8", ".json":"application/json; charset=utf-8" };
const APP_VERSION = require("./package.json").version;
const defaults = {
  autoClean:false, threshold:85, compressedThreshold:2048, startup:false,
  whitelist:["Discord","Steam","chrome","obs64","Spotify"], targets:[], games:[]
};
const NETWORK_PROTECTED = [
  "goodbyedpi","winws","zapret","blockcheck","xray","sing-box","v2ray",
  "clash","clash-verge","mihomo","splitware","splitwire",
  "warp-svc","cloudflare-warp","tailscale","tailscaled","wireguard",
  "openvpn","openvpnserv","openvpnservice","protonvpn","protonvpn-service",
  "nordvpn","nordvpn-service","mullvad-vpn","mullvad-daemon",
  "surfshark","expressvpn","windscribe","zerotier-one",
  "dnscrypt-proxy","simplednscrypt","dnsjumper","yogadns","acrylicservice",
  "dnsagent","technitiumdnsserver","nextdns","controld","stubby","unbound",
  "adguardsvc","adguard","adguardvpn","adguardvpn-service"
];
let settings = loadSettings(), lastAutoClean = 0, lastHistory = 0, gameActive = false, processSamples = new Map(), previousPowerPlan = "";
function loadSettings(){try{return{...defaults,...JSON.parse(fs.readFileSync(SETTINGS_FILE,"utf8"))}}catch{return{...defaults}}}
function saveSettings(){fs.mkdirSync(path.dirname(SETTINGS_FILE),{recursive:true});fs.writeFileSync(SETTINGS_FILE,JSON.stringify(settings,null,2))}
function runPS(script,timeout=15000){return new Promise((resolve,reject)=>execFile("powershell.exe",["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-Command",script],{windowsHide:true,timeout,maxBuffer:2*1024*1024},(e,out,err)=>e?reject(new Error(err.trim()||e.message)):resolve(out.trim())))}
const snapshotScript=String.raw`
$ErrorActionPreference='Stop';$os=Get-CimInstance Win32_OperatingSystem;$mem=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
$cpu=(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
$compression=Get-Process -Name 'Memory Compression' -ErrorAction SilentlyContinue
$compressed=if($compression){[int64]$compression.WorkingSet64}else{[int64]0}
$gpu=0
try{$samples=(Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop).CounterSamples|Where-Object{$_.CookedValue -gt 0};$gpu=[math]::Min(100,[math]::Round(($samples|Measure-Object CookedValue -Sum).Sum,0))}catch{}
$temperature=$null
try{$temps=Get-CimInstance -Namespace root/wmi -Class MSAcpi_ThermalZoneTemperature -ErrorAction Stop;$valid=@($temps|ForEach-Object{($_.CurrentTemperature/10)-273.15}|Where-Object{$_ -gt 0 -and $_ -lt 120});if($valid.Count){$temperature=[math]::Round(($valid|Measure-Object -Average).Average,0)}}catch{}
$procs=Get-CimInstance Win32_PerfFormattedData_PerfProc_Process|Where-Object{$_.Name -notin @('_Total','Idle') -and $_.IDProcess -gt 0}|Sort-Object WorkingSetPrivate -Descending|Select-Object -First 80 Name,IDProcess,WorkingSet,WorkingSetPrivate,PrivateBytes,PercentProcessorTime,ThreadCount,HandleCount
$total=[int64]$os.TotalVisibleMemorySize*1KB;$available=[int64]$os.FreePhysicalMemory*1KB;$cache=[math]::Min([int64]$mem.CacheBytes,$available);$free=[math]::Max([int64]0,[int64]($available-$cache));$used=[math]::Max([int64]0,[int64]($total-$available))
[ordered]@{timestamp=[DateTimeOffset]::Now.ToUnixTimeMilliseconds();machine=$env:COMPUTERNAME;total=$total;used=$used;available=$available;cached=$cache;standby=[int64]$mem.StandbyCacheNormalPriorityBytes+[int64]$mem.StandbyCacheReserveBytes+[int64]$mem.StandbyCacheCoreBytes;modified=[int64]$mem.ModifiedPageListBytes;compressed=$compressed;free=$free;cpu=[int]$cpu;gpu=[int]$gpu;temperature=$temperature;committed=[int64]$mem.CommittedBytes;commitLimit=[int64]$mem.CommitLimit;pagedPool=[int64]$mem.PoolPagedBytes;nonPagedPool=[int64]$mem.PoolNonpagedBytes;pageReads=[int64]$mem.PageReadsPersec;pageWrites=[int64]$mem.PageWritesPersec;processes=@($procs)}|ConvertTo-Json -Depth 4 -Compress`;
function trimScriptForTargets(){
  const targets=JSON.stringify(settings.targets||[]).replace(/'/g,"''");
  const whitelist=JSON.stringify(settings.whitelist||[]).replace(/'/g,"''");
  const protectedTools=JSON.stringify(NETWORK_PROTECTED).replace(/'/g,"''");
  return String.raw`
$ErrorActionPreference='Stop'
Add-Type @'
using System;using System.Runtime.InteropServices;public static class MemTrim{[DllImport("psapi.dll")]public static extern bool EmptyWorkingSet(IntPtr h);}
'@
$targets=ConvertFrom-Json '${targets}';$whitelist=ConvertFrom-Json '${whitelist}';$protected=ConvertFrom-Json '${protectedTools}'
$before=(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory;$ok=0;$names=@()
Get-Process|Where-Object{$targets -contains $_.ProcessName -and $whitelist -notcontains $_.ProcessName -and $protected -notcontains $_.ProcessName.ToLower()}|ForEach-Object{try{if([MemTrim]::EmptyWorkingSet($_.Handle)){$ok++;$names+=$_.ProcessName}}catch{}}
$after=(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
[ordered]@{success=$true;action='optimize';affected=$ok;names=@($names|Sort-Object -Unique);released=[math]::Max([int64]0,[int64](($after-$before)*1KB))}|ConvertTo-Json -Compress`;}
const standbyScript=String.raw`
$ErrorActionPreference='Stop';$admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if(-not $admin){throw 'Standby listesini temizlemek için uygulamayı yönetici olarak çalıştırın.'}
Add-Type @'
using System;using System.Runtime.InteropServices;public static class NativeMemory{[DllImport("ntdll.dll")]public static extern uint RtlAdjustPrivilege(int p,bool e,bool c,out bool o);[DllImport("ntdll.dll")]public static extern uint NtSetSystemInformation(int c,ref int i,int l);}
'@
$old=$false;[void][NativeMemory]::RtlAdjustPrivilege(13,$true,$false,[ref]$old);$cmd=4;$result=[NativeMemory]::NtSetSystemInformation(80,[ref]$cmd,4);if($result-ne 0){throw "Windows standby temizliğini reddetti (NTSTATUS $result)."};'{"success":true,"action":"standby"}'`;
const gameScript=String.raw`
$names=@('OneDrive','YourPhone','PhoneExperienceHost','Widgets','WidgetService','GameBar','GameBarFTServer','XboxApp','XboxPcApp','Microsoft.Photos');$stopped=@()
foreach($name in $names){Get-Process -Name $name -ErrorAction SilentlyContinue|ForEach-Object{try{$stopped+=$_.ProcessName;Stop-Process -Id $_.Id -Force -ErrorAction Stop}catch{}}}
[ordered]@{success=$true;action='game';stopped=@($stopped|Sort-Object -Unique)}|ConvertTo-Json -Compress`;
function json(res,status,value){res.writeHead(status,{"Content-Type":MIME[".json"],"Cache-Control":"no-store"});res.end(typeof value==="string"?value:JSON.stringify(value))}
async function action(res,script){try{json(res,200,await runPS(script,25000))}catch(e){json(res,500,{success:false,error:e.message})}}
function readBody(req){return new Promise((resolve,reject)=>{let body="";req.on("data",c=>body+=c);req.on("end",()=>{try{resolve(body?JSON.parse(body):{})}catch(e){reject(e)}})})}
function analyze(data){
  const leaks=[],suggestions=[],now=data.timestamp;
  for(const p of data.processes||[]){
    const key=String(p.Name).toLowerCase(), value=Number(p.WorkingSetPrivate||0), old=processSamples.get(key);
    if(old&&now-old.time>=60000&&value-old.value>256*1024*1024)leaks.push({name:p.Name,growth:value-old.value,minutes:Math.round((now-old.time)/60000)});
    if(!old||now-old.time>=60000)processSamples.set(key,{value,time:now});
    if(value>500*1024*1024&&!NETWORK_PROTECTED.includes(key)&&!settings.whitelist.some(x=>x.toLowerCase()===key)&&!settings.targets.some(x=>x.toLowerCase()===key))suggestions.push({name:p.Name,memory:value});
  }
  data.leaks=leaks;data.suggestions=suggestions.slice(0,5);
  if(now-lastHistory>=30000){lastHistory=now;fs.mkdirSync(path.dirname(HISTORY_FILE),{recursive:true});fs.appendFile(HISTORY_FILE,JSON.stringify({timestamp:now,ram:Math.round(data.used/data.total*100),cpu:data.cpu,gpu:data.gpu,used:data.used,compressed:data.compressed,top:(data.processes||[]).slice(0,5).map(p=>({name:p.Name,memory:p.WorkingSetPrivate}))})+"\n",()=>{})}
}
async function setGameMode(active){
  if(active){try{previousPowerPlan=await runPS(`(powercfg /getactivescheme) -replace '.*GUID:\\s*([a-f0-9-]+).*','$1'`);await runPS("powercfg /setactive SCHEME_MIN")}catch{};runPS(trimScriptForTargets(),25000).catch(()=>{})}
  else if(previousPowerPlan){runPS(`powercfg /setactive ${previousPowerPlan}`).catch(()=>{});previousPowerPlan=""}
}
async function snapshot(res){try{const raw=await runPS(snapshotScript),data=JSON.parse(raw);const running=new Set((data.processes||[]).map(p=>String(p.Name).toLowerCase()));const detected=(settings.games||[]).some(g=>running.has(String(g).toLowerCase()));if(detected&&!gameActive){gameActive=true;setGameMode(true)}else if(!detected&&gameActive){gameActive=false;setGameMode(false)}data.gameActive=gameActive;analyze(data);if(settings.autoClean&&data.total&&data.used/data.total*100>=settings.threshold&&Date.now()-lastAutoClean>300000){lastAutoClean=Date.now();runPS(trimScriptForTargets(),25000).catch(()=>{})}json(res,200,data)}catch(e){json(res,500,{error:"Bellek verisi okunamadı",detail:e.message})}}
function history(res){
  try{const rows=fs.readFileSync(HISTORY_FILE,"utf8").trim().split(/\r?\n/).filter(Boolean).slice(-2880).map(JSON.parse);json(res,200,rows)}
  catch{json(res,200,[])}
}
function exportCsv(res){
  let rows=[];try{rows=fs.readFileSync(HISTORY_FILE,"utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)}catch{}
  const csv="timestamp,ram_percent,cpu_percent,gpu_percent,used_bytes,compressed_bytes\n"+rows.map(x=>[new Date(x.timestamp).toISOString(),x.ram,x.cpu,x.gpu,x.used,x.compressed].join(",")).join("\n");
  res.writeHead(200,{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="walker-rammap-history.csv"'});res.end(csv);
}
async function closeProcess(req,res){try{const b=await readBody(req),name=String(b.name||"").replace(/\.exe$/i,"");const protectedNames=["system","idle","registry","smss","csrss","wininit","services","lsass","svchost","winlogon","dwm","explorer",...NETWORK_PROTECTED];if(!name||protectedNames.includes(name.toLowerCase())||settings.whitelist.some(x=>x.toLowerCase()===name.toLowerCase()))return json(res,403,{error:"Bu süreç koruma listesinde ve Walker RAMMap tarafından kapatılamaz."});const safeName=name.replace(/'/g,"''");const command=b.force?`$p=Get-Process -Name '${safeName}' -ErrorAction Stop;$count=@($p).Count;$p|Stop-Process -Force -ErrorAction Stop;[ordered]@{success=$true;closed=$count;forced=$true}|ConvertTo-Json -Compress`:`$p=Get-Process -Name '${safeName}' -ErrorAction Stop;$count=0;foreach($item in $p){if($item.MainWindowHandle -ne 0 -and $item.CloseMainWindow()){$count++}};[ordered]@{success=$true;requested=$count;forced=$false}|ConvertTo-Json -Compress`;const out=await runPS(command);json(res,200,out)}catch(e){json(res,500,{error:e.message})}}
async function updateSettings(req,res){try{const b=await readBody(req);if(typeof b.autoClean==="boolean")settings.autoClean=b.autoClean;if(Number.isFinite(Number(b.threshold)))settings.threshold=Math.min(95,Math.max(50,Number(b.threshold)));if(Number.isFinite(Number(b.compressedThreshold)))settings.compressedThreshold=Math.max(256,Number(b.compressedThreshold));for(const key of["whitelist","targets","games"])if(Array.isArray(b[key]))settings[key]=[...new Set(b[key].map(x=>String(x).trim()).filter(Boolean))].slice(0,100);if(typeof b.startup==="boolean"&&b.startup!==settings.startup){const command=process.env.WALKER_DESKTOP?`"${process.execPath}"`:`"${process.execPath}" "${__filename}"`;const script=b.startup?`$v=${JSON.stringify(command)};New-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Force|Out-Null;Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'WalkerRAMMap' -Value $v`:`Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'WalkerRAMMap' -ErrorAction SilentlyContinue`;await runPS(script);settings.startup=b.startup}saveSettings();json(res,200,settings)}catch(e){json(res,500,{error:e.message})}}
async function restoreSettings(req,res){try{const b=await readBody(req),incoming=b.settings||b;if(!incoming||typeof incoming!=="object")throw new Error("Geçersiz yedek.");settings={...defaults,...incoming,startup:settings.startup};for(const key of["whitelist","targets","games"])settings[key]=Array.isArray(settings[key])?settings[key].map(String).slice(0,100):defaults[key];saveSettings();json(res,200,settings)}catch(e){json(res,400,{error:e.message})}}
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,`http://${req.headers.host||"localhost"}`);if(url.pathname==="/api/memory"&&req.method==="GET")return snapshot(res);if(url.pathname==="/api/history")return history(res);if(url.pathname==="/api/export.csv")return exportCsv(res);if(url.pathname==="/api/version")return json(res,200,{version:APP_VERSION,updateConfigured:true});if(url.pathname==="/api/backup")return json(res,200,{version:1,exportedAt:new Date().toISOString(),settings});if(url.pathname==="/api/restore"&&req.method==="POST")return restoreSettings(req,res);if(url.pathname==="/api/process/close"&&req.method==="POST")return closeProcess(req,res);if(url.pathname==="/api/settings"&&req.method==="GET")return json(res,200,settings);if(url.pathname==="/api/settings"&&req.method==="POST")return updateSettings(req,res);if(url.pathname==="/api/optimize"&&req.method==="POST")return action(res,trimScriptForTargets());if(url.pathname==="/api/standby"&&req.method==="POST")return action(res,standbyScript);if(url.pathname==="/api/game-mode"&&req.method==="POST")return action(res,trimScriptForTargets());const requested=url.pathname==="/"?"/index.html":url.pathname;const file=path.resolve(ROOT,"."+requested);if(!file.startsWith(ROOT)){res.writeHead(403);return res.end("Forbidden")}fs.readFile(file,(e,data)=>{if(e){res.writeHead(404);return res.end("Not found")}res.writeHead(200,{"Content-Type":MIME[path.extname(file)]||"application/octet-stream"});res.end(data)})});
server.listen(PORT,"127.0.0.1",()=>console.log(`Walker RAMMap hazır: http://127.0.0.1:${PORT}`));
if(Number(PORT)===4173) require("./advanced-server");
