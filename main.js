const {
  app,
  BrowserWindow,
  Menu,
  MenuItem,
  session,
  dialog
} = require("electron");
const path = require("path");

let pluginName;
switch (process.platform) {
  case "win32":
    pluginName =
      process.arch === "x64"
        ? "plugins/pepflashplayer64.dll"
        : "plugins/pepflashplayer32.dll";
    break;
  case "darwin":
    pluginName = "plugins/PepperFlashPlayer.plugin";
    break;
  case "linux":
    pluginName = "plugins/libpepflashplayer.so";
    break;
}

if (pluginName) {
  app.commandLine.appendSwitch(
    "ppapi-flash-path",
    path.join(__dirname, pluginName)
  );
  app.commandLine.appendSwitch("ppapi-flash-version", "32.0.0.465");
}

let windows = [];

function createWindow(startUrl, isMain = false) {
  const win = new BrowserWindow({
    icon: "resources/logo.png",
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

  win.on("close", (event) => {
    if (isMain) {
      event.preventDefault();
      dialog
        .showMessageBox(win, {
          type: "question",
          buttons: ["Cancel", "Exit"],
          defaultId: 0,
          cancelId: 0,
          title: "Confirm Exit",
          message: "Are you sure you want to exit the browser?",
          detail: "WARNING: All open Naruto Online windows will be closed.",
        })
        .then((result) => {
          if (result.response === 1) {
            windows.forEach((w) => {
              if (w !== win && !w.isDestroyed()) w.destroy();
            });
            windows = [];

            win.removeAllListeners("close");
            win.close();
          }
        });
    } else {
      windows = windows.filter((w) => w !== win);
      win.destroy();
    }
  });

  windows.push(win);
  return win;
}

let mainWindow;

function createMainWindow() {
  mainWindow = createWindow(
    "https://naruto.narutowebgame.com/serverlist",
    true
  );

  contextMenu = new Menu();
  contextMenu.append(new MenuItem({ label: "Copy", role: "copy" }));
  contextMenu.append(new MenuItem({ label: "Paste", role: "paste" }));

  mainWindow.webContents.on("context-menu", (_, params) => {
    contextMenu.popup({ window: mainWindow, x: params.x, y: params.y });
  });
}

const runBrowserApp = () => {
  createMainWindow();
  initializeBrowserMenu(mainWindow);

  mainWindow.webContents.on("did-fail-load", () => {
    const errorHTML = `
            <html>
            <body style="background-color: #d4c8b8; color: #3b3732; display:flex; justify-content:center; align-items:center; height:100vh; margin:0;">
                <div style="text-align:center; font-family: Arial, sans-serif;">
                    <h1>Sorry, it seems like the webpage failed to load.</h1>
                </div>
            </body>
            </html>
        `;
    mainWindow.loadURL(
      "data:text/html;charset=utf-8," + encodeURIComponent(errorHTML)
    );
    mainWindow.show();
  });
};

app.on("ready", () => {
  runBrowserApp();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) runBrowserApp();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let appMenu;

function initializeBrowserMenu() {
  const template = [
    {
      label: "View",
      submenu: [
        {
          label: "Force Exit",
          click(_, focusedWindow) {
            if (focusedWindow) app.exit();
          },
        },
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click(_, focusedWindow) {
            if (focusedWindow && !focusedWindow.isDestroyed()) {
              const url = focusedWindow.webContents.getURL();

              focusedWindow.destroy();

              createWindow(url);
            }
          },
        },
        {
          label: "Toggle Developer Tools",
          accelerator: process.platform === "darwin" ? "Command+I" : "Ctrl+I",
          click(_, focusedWindow) {
            if (focusedWindow) focusedWindow.webContents.toggleDevTools();
          },
        },
      ],
    },
    {
      label: "Clean",
      submenu: [
        {
          label: "Clear HTTP Cache (basic)",
          click: () => clearHTTPCache(),
        },
        {
          label: "Clear All Cache and Storage (THIS WILL REFRESH THE BROWSER!)",
          click: () => clearAllCache(),
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

function clearHTTPCache() {
  try {
    session.defaultSession.clearCache();
    console.log("HTTP cache cleared.");
  } catch (err) {
    console.error("Error clearing cache:", err);
  }
}

function clearAllCache() {
  try {
    session.defaultSession.clearStorageData();
    console.log("Storage data cleared.");
    app.relaunch();
    app.exit();
  } catch (error) {
    console.error("Error clearing storage data:", error);
  }
}
