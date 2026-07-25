const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, Notification } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const net = require("net");
const crypto = require("crypto");

let mainWindow, widgetWindow, tray, quitting = false, lastAlert = 0;
let APP_URL = "http://127.0.0.1:4173", ADVANCED_URL = "http://127.0.0.1:4174";
function freePort(){return new Promise((ok,no)=>{const s=net.createServer();s.unref();s.on("error",no);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>ok(p))})})}

function trayIcon() {
  return nativeImage.createFromPath(path.join(__dirname,"assets","icon.png")).resize({ width:16, height:16 });
}
function showWindow() { if (!mainWindow) return; mainWindow.show(); if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
function toggleWidget(){if(!widgetWindow)return;if(widgetWindow.isVisible())widgetWindow.hide();else widgetWindow.showInactive()}
async function post(endpoint) { try { await fetch(`${APP_URL}${endpoint}`, { method:"POST" }); } catch {} }
function rebuildTray(ram, cpu) {
  if (!tray) return;
  tray.setToolTip(`Walker RAMMap • RAM %${ram ?? "—"} • CPU %${cpu ?? "—"}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label:`RAM %${ram ?? "—"}  •  CPU %${cpu ?? "—"}`, enabled:false },
    { type:"separator" },
    { label:"Walker RAMMap'i Aç", click:showWindow },
    { label:"Şimdi Optimize Et", click:()=>post("/api/optimize") },
    { label:"Oyun Modunu Çalıştır", click:()=>post("/api/game-mode") },
    { label:"Mini Performans Paneli", click:toggleWidget },
    { type:"separator" },
    { label:"Yönetici Olarak Yeniden Başlat", click:relaunchAsAdmin },
    { label:"Çıkış", click:()=>{ quitting=true; app.quit(); } }
  ]));
}
function relaunchAsAdmin() {
  const exe=process.execPath.replace(/'/g,"''");
  spawn("powershell.exe",["-NoProfile","-Command",`Start-Process -FilePath '${exe}' -Verb RunAs`],{ detached:true, windowsHide:true });
  quitting=true; app.quit();
}
function monitor() {
  setInterval(async()=>{
    try {
      const [memory,settings,advanced]=await Promise.all([fetch(`${APP_URL}/api/memory`).then(r=>r.json()),fetch(`${APP_URL}/api/settings`).then(r=>r.json()),fetch(`${ADVANCED_URL}/api/state`,{headers:{"X-Walker-Session":process.env.WALKER_SESSION}}).then(r=>r.json()).catch(()=>({quiet:false}))]);
      const ram=Math.round(memory.used/memory.total*100); rebuildTray(ram,memory.cpu);
      if(ram>=settings.threshold && !advanced.quiet && Date.now()-lastAlert>15*60*1000) {
        lastAlert=Date.now();
        new Notification({ title:"Walker RAMMap", body:`RAM kullanımı %${ram}. Optimizasyon öneriliyor.`, icon:trayIcon() }).show();
      }
    } catch {}
  },10000);
}
function configureUpdates() {
  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload=false;
  autoUpdater.autoInstallOnAppQuit=true;
  autoUpdater.on("update-available",info=>{
    const notice=new Notification({title:"Walker RAMMap güncellemesi",body:`${info.version} sürümü hazır. İndirmek için bildirime tıklayın.`,icon:trayIcon()});
    notice.on("click",()=>autoUpdater.downloadUpdate());notice.show();
  });
  autoUpdater.on("update-downloaded",()=>{
    const notice=new Notification({title:"Güncelleme hazır",body:"Kurmak için tıklayın. Walker RAMMap yeniden başlatılacak.",icon:trayIcon()});
    notice.on("click",()=>{quitting=true;autoUpdater.quitAndInstall(false,true)});notice.show();
  });
  setTimeout(()=>autoUpdater.checkForUpdates().catch(()=>{}),8000);
  setInterval(()=>autoUpdater.checkForUpdates().catch(()=>{}),6*60*60*1000);
}
function createWindow() {
  mainWindow=new BrowserWindow({width:1440,height:920,minWidth:960,minHeight:680,backgroundColor:"#090b0f",autoHideMenuBar:true,title:"Walker RAMMap",icon:path.join(__dirname,"assets","icon.png"),webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  mainWindow.loadURL(`${APP_URL}/?advanced=${encodeURIComponent(ADVANCED_URL)}&session=${process.env.WALKER_SESSION}`);
  mainWindow.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/.test(url))shell.openExternal(url);return{action:"deny"}});
  mainWindow.webContents.on("will-navigate",(e,url)=>{if(!url.startsWith(APP_URL))e.preventDefault()});
  mainWindow.on("close",e=>{if(!quitting){e.preventDefault();mainWindow.hide()}});
  mainWindow.webContents.on("render-process-gone",(_event,details)=>{
    new Notification({title:"Walker RAMMap kurtarma",body:`Arayüz beklenmedik şekilde kapandı (${details.reason}). Güvenli biçimde yeniden yükleniyor.`,icon:trayIcon()}).show();
    setTimeout(()=>mainWindow?.reload(),1200);
  });
  mainWindow.webContents.on("unresponsive",()=>{if(!mainWindow?.isDestroyed())mainWindow.reload()});
}
function createWidget(){
 widgetWindow=new BrowserWindow({width:300,height:170,resizable:false,frame:false,transparent:true,alwaysOnTop:true,skipTaskbar:true,show:false,hasShadow:true,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
 widgetWindow.loadURL(`${APP_URL}/widget.html?advanced=${encodeURIComponent(ADVANCED_URL)}&session=${process.env.WALKER_SESSION}`);
 widgetWindow.setAlwaysOnTop(true,"floating");widgetWindow.on("close",e=>{if(!quitting){e.preventDefault();widgetWindow.hide()}});
}

if(!app.requestSingleInstanceLock())app.quit();else{
  app.on("second-instance",showWindow);
  app.whenReady().then(async()=>{
    process.env.WALKER_DESKTOP="1";process.env.WALKER_DATA_DIR=app.getPath("userData");
    process.env.PORT=String(await freePort());process.env.ADVANCED_PORT=String(await freePort());
    process.env.WALKER_SESSION=crypto.randomBytes(32).toString("hex");
    APP_URL=`http://127.0.0.1:${process.env.PORT}`;ADVANCED_URL=`http://127.0.0.1:${process.env.ADVANCED_PORT}`;
    require("./server");
    createWindow();createWidget();tray=new Tray(trayIcon());tray.on("double-click",showWindow);rebuildTray();monitor();if(app.isPackaged)configureUpdates();
  }).catch(e=>{dialog.showErrorBox("Walker RAMMap başlatılamadı",e.message);app.quit()});
  app.on("before-quit",()=>{quitting=true});
  app.on("window-all-closed",()=>{});
}
