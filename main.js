const {
  app,
  BrowserWindow,
  Menu,
  MenuItem,
  session,
  dialog,
  ipcMain,
} = require("electron");
const path = require("path");
const fs = require("fs");

let pluginName;

switch (process.platform) {
  case "win32":
    pluginName =
      process.arch === "x64" ? "pepflashplayer64.dll" : "pepflashplayer32.dll";
    break;
  case "darwin":
    pluginName = "PepperFlashPlayer.plugin";
    break;
  case "linux":
    pluginName = "libpepflashplayer.so";
    app.commandLine.appendSwitch("no-sandbox");
    break;
}

let pluginDir;

if (app.isPackaged) {
  pluginDir = process.resourcesPath;
} else {
  pluginDir = path.join(__dirname, "resources");
}

const pluginPath = path.join(pluginDir, pluginName);

if (pluginName) {
  app.commandLine.appendSwitch("ppapi-flash-path", pluginPath);
  app.commandLine.appendSwitch("ppapi-flash-version", "32.0.0.363");
}

const SERVER_LIST_URL = "https://naruto.narutowebgame.com/en/serverlist";
let data = {};

app.on("ready", () => {
  try {
    if (fs.existsSync("config.json")) {
      const file = fs.readFileSync("config.json");
      data = JSON.parse(file);
      console.log(data);
    }
  } catch (error) {
    console.error("Fail to read config.json: ", error.message);
  }

  runBrowserApp();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) runBrowserApp();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let totalRetries = new Map();
let mainWindow;

const runBrowserApp = () => {
  createMainWindow();
  initializeBrowserMenu(mainWindow);

  mainWindow.webContents.on("did-fail-load", () => {
    const errorHTML = `
<html><body style="background-color:#d4c8b8;color:#3b3732;display:flex;justify-content:center;align-items:center;height:100vh;margin:0"><div style="text-align:center;font-family:Arial,sans-serif"><h1>Sorry, it seems like the webpage failed to load. Try re-open the browser.</h1></div></body></html>
        `;
    mainWindow.loadURL(
      "data:text/html;charset=utf-8," + encodeURIComponent(errorHTML),
    );
    mainWindow.show();
  });
};

function createMainWindow() {
  const url = data.startUrl ?? SERVER_LIST_URL;
  mainWindow = createWindow(url, true);

  contextMenu = new Menu();
  contextMenu.append(new MenuItem({ label: "Copy", role: "copy" }));
  contextMenu.append(new MenuItem({ label: "Paste", role: "paste" }));

  mainWindow.webContents.on("context-menu", (_, params) => {
    contextMenu.popup({ window: mainWindow, x: params.x, y: params.y });
  });
}

let windows = [];

function createWindow(startUrl, isMain = false) {
  const win = new BrowserWindow({
    icon: "resources/logo.ico",
    width: 1400,
    height: 800,
    title: "Naruto Online Browser",
    parent: this,
    webPreferences: {
      devTools: true,
      nodeIntegration: false,
      contextIsolation: true,
      plugins: true,
    },
  });

  win.loadURL(startUrl);

  win.webContents.on("new-window", (event, url) => {
    event.preventDefault();
    createWindow(url, false);
  });

  installAutoRetry(win);

  win.on("close", (event) => {
    if (isMain) {
      event.preventDefault();
      if (data.warnBeforeClose == null || data.warnBeforeClose == true) {
        dialog
          .showMessageBox(win, {
            type: "question",
            buttons: ["Cancel", "Exit"],
            defaultId: 0,
            cancelId: 0,
            title: "Confirm Exit",
            message: "Are you sure you want to exit the browser?",
            detail: "WARNING: All open Naruto Online windows will be closed.",
            checkboxLabel: "Do not ask me again",
            checkboxChecked: false,
          })
          .then((result) => {
            if (result.response === 1) {
              if (result.checkboxChecked) {
                data.warnBeforeClose = false;
                try {
                  fs.writeFileSync(
                    "config.json",
                    JSON.stringify(data, null, 2),
                  );
                } catch (error) {
                  console.error("Write config.json error: ", error.message);
                }
              }
              closeAllWindows();
            }
          });
      } else {
        closeAllWindows();
      }
    } else {
      windows = windows.filter((w) => w !== win);
      win.destroy();
    }
  });

  windows.push(win);
  return win;
}

function closeAllWindows() {
  windows.forEach((w) => {
    if (w !== mainWindow && !w.isDestroyed()) w.destroy();
  });
  windows = [];

  mainWindow.removeAllListeners("close");
  mainWindow.close();
}

function installAutoRetry(window) {
  window.webContents.on(
    "did-navigate",
    (event, url, httpResponseCode, httpStatusText) => {
      if (httpResponseCode == 403) {
        if (window && !window.isDestroyed()) {
          if (totalRetries.getOrInsert(window, 0) > 5) {
            const errorHTML = `
<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';"></head><body style="background-color:#d4c8b8;color:#3b3732;display:flex;justify-content:center;align-items:center;height:100vh;margin:0"><div style="text-align:center;font-family:Arial,sans-serif"><h1>It seems like the website (probably Cloudflare) blocked our request for more than 5 times. Try going to serverlist from the 'View' menu or re-open the browser. HttpStatusText:${httpStatusText}</h1></div></body></html>
        `;
            window.loadURL(
              "data:text/html;charset=utf-8," + encodeURIComponent(errorHTML),
            );
            window.show();
          } else {
            window.webContents.reload();
            totalRetries.set(window, totalRetries.getOrInsert(window, 0) + 1);
          }
        }
      }
    },
  );
}

let appMenu;

function initializeBrowserMenu() {
  const template = [
    {
      label: "View",
      submenu: [
        {
          label: "Open URL",
          click: () => openUrlPrompt(),
        },
        {
          label: "Go to serverlist",
          click: (_, focusedWindow) => {
            if (focusedWindow && !focusedWindow.isDestroyed()) {
              focusedWindow.loadURL(SERVER_LIST_URL);
              totalRetries = new Map();
            }
          },
        },
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click(_, focusedWindow) {
            if (focusedWindow && !focusedWindow.isDestroyed()) {
              focusedWindow.webContents.reload();
            }
          },
        },
        {
          label: "Force Reload",
          click(_, focusedWindow) {
            if (!focusedWindow || focusedWindow.isDestroyed()) return;
            if (focusedWindow == mainWindow) {
              focusedWindow.webContents.reload();
              return;
            }
            const contents = focusedWindow.webContents;
            if (contents.isCrashed()) {
              contents.reload();
              return;
            }
            contents.forcefullyCrashRenderer();
            contents.reload();
          },
        },
        {
          label: "Toggle Developer Tools",
          accelerator: process.platform === "darwin" ? "Command+I" : "Ctrl+I",
          click(_, focusedWindow) {
            if (focusedWindow) focusedWindow.webContents.toggleDevTools();
          },
        },
        {
          label: "Force Exit",
          click(_, focusedWindow) {
            if (focusedWindow) app.exit();
          },
        },
      ],
    },
    {
      label: "Clean",
      submenu: [
        {
          label: "Clear HTTP Cache",
          click: () => clearHTTPCache(),
        },
        {
          label: "Clear Storage Data (THIS WILL REFRESH THE BROWSER!)",
          click: () => clearStorageData(),
        },
      ],
    },
    {
      label: "Audio",
      submenu: [
        {
          id: "muteWindow",
          label: "Mute",
          type: "checkbox",
          click: (menuItem, focusedWindow) => {
            if (!focusedWindow || focusedWindow.isDestroyed()) return;
            const newMuted = !focusedWindow.webContents.isAudioMuted();
            focusedWindow.webContents.setAudioMuted(newMuted);
            menuItem.checked = newMuted;
          },
        },
      ],
    },
  ];

  appMenu = Menu.buildFromTemplate(template);
  const helpMenuItem = appMenu.getMenuItemById("helpMenu");
  const devToolsMenuItem = new MenuItem({
    label: "Toggle Developer Tools",
    click: () => {
      mainWindow.webContents.toggleDevTools();
    },
  });

  if (helpMenuItem && helpMenuItem.submenu) {
    helpMenuItem.submenu.append(devToolsMenuItem);
  }

  Menu.setApplicationMenu(appMenu);

  const muteItem = appMenu.getMenuItemById("muteWindow");

  app.on("browser-window-focus", (_, window) => {
    if (!muteItem) return;
    if (window && !window.isDestroyed()) {
      muteItem.checked = !!window.webContents.isAudioMuted();
    } else {
      muteItem.checked = false;
    }
  });

  app.on("browser-window-created", (_, window) => {
    window.on("focus", () => {
      if (appMenu)
        appMenu.getMenuItemById("muteWindow").checked =
          window.webContents.isAudioMuted();
    });
    window.on("closed", () => {
      const focused = BrowserWindow.getFocusedWindow();
      if (appMenu)
        appMenu.getMenuItemById("muteWindow").checked = focused
          ? focused.webContents.isAudioMuted()
          : false;
    });
  });
}

function openUrlPrompt() {
  const promptWin = new BrowserWindow({
    width: 400,
    height: 150,
    resizable: false,
    alwaysOnTop: true,
    frame: false,
    modal: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  const html = `<style>body{font-family:sans-serif;margin:12px}input{width:100%;padding:8px;font-size:14px;margin-bottom:12px}.btn-row{display:flex;justify-content:flex-end;gap:8px}</style><h3 style="margin-top:0;font-size:14px;">Enter URL (must starts with http:// or https://)</h3><input id="url" placeholder="https://example.com" value="https://example.com"><div class="btn-row"><button onclick="closeWin()">Cancel</button><button onclick="submit()">OK</button></div><script>const{ipcRenderer:ipcRenderer}=require("electron");function submit(){ipcRenderer.send("url-entered",document.getElementById("url").value),window.close()}function closeWin(){window.close()}</script>`;

  // Load as a data URL
  promptWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));

  // Close the window when data is received
  ipcMain.once("url-entered", (_event, url) => {
    console.log("Entered:", `'${url}'`);
    promptWin.close();

    createWindow(url, false);
  });
}

function clearHTTPCache() {
  try {
    session.defaultSession.clearCache();
    console.log("HTTP cache cleared.");
  } catch (err) {
    console.error("Error clearing cache:", err);
  }
}

function clearStorageData() {
  try {
    session.defaultSession.clearStorageData();
    console.log("Storage data cleared.");
    app.relaunch();
    app.exit();
  } catch (error) {
    console.error("Error clearing storage data:", error);
  }
}

if (!Map.prototype.getOrInsert) {
  Map.prototype.getOrInsert = function (key, defaultValue) {
    if (this.has(key)) {
      return this.get(key);
    }
    this.set(key, defaultValue);
    return defaultValue;
  };
}
