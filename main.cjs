const { BrowserWindow, app, ipcMain, dialog, Menu } = require("electron");
const { join } = require("node:path");
const { spawn } = require("child_process");
const fs = require("fs");

const isDev = process.env.NODE_ENV === "development";

let emulatorProcess = null;
let mainWindow = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      // Performance optimizations for older hardware
      v8CacheOptions: 'bypassHeatCheck',
      enableBlinkFeatures: 'ExperimentalProductionUsesV8CodeCache',
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.maximize();

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = join(__dirname, "dist/renderer/index.html");
    mainWindow.loadURL(`file://${indexPath}`);
  }
};

// Build application menu and context menu
const buildMenu = () => {
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "New",
          accelerator: "CmdOrCtrl+N",
          click: () =>
            mainWindow && mainWindow.webContents.send("menu:action", "new"),
        },
        {
          label: "Open",
          accelerator: "CmdOrCtrl+O",
          click: () =>
            mainWindow && mainWindow.webContents.send("menu:action", "open"),
        },
        {
          label: "Save",
          accelerator: "CmdOrCtrl+S",
          click: () =>
            mainWindow && mainWindow.webContents.send("menu:action", "save"),
        },
        { type: "separator" },
        { role: "quit", accelerator: "CmdOrCtrl+Q" },
      ],
    },
    {
      label: "Run",
      submenu: [
        {
          label: "Run",
          accelerator: "F5",
          click: () =>
            mainWindow && mainWindow.webContents.send("menu:action", "run"),
        },
        {
          label: "Stop",
          accelerator: "F8",
          click: () =>
            mainWindow && mainWindow.webContents.send("menu:action", "stop"),
        },
        {
          label: "Debug",
          accelerator: "F9",
          click: () =>
            mainWindow && mainWindow.webContents.send("menu:action", "debug"),
        },
        {
          label: "Step",
          accelerator: "F10",
          click: () =>
            mainWindow && mainWindow.webContents.send("menu:action", "step"),
        },
      ],
    }
  ];

  if (isDev) {
    template.push({label: "DevTools",
      submenu: [
        {
          label: "Toggle DevTools",
          accelerator: "CmdOrCtrl+Shift+I",
          click: () => mainWindow.webContents.toggleDevTools(),
        },
      ]
    });
  }

  const appMenu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(appMenu);
  return appMenu;
};

const isPackaged = app.isPackaged;
function resourcePath(...parts) {
  if (isPackaged) return join(process.resourcesPath, ...parts);
  return join(__dirname, ...parts); // adjust as needed for your dev layout
}

function getEmulatorPath() {
  const platformDir =
    process.platform === "win32"
      ? "win64"
      : process.platform === "linux"
        ? "linux"
        : process.platform === "darwin"
          ? "macos"
          : null;

  const fileName =
    process.platform === "win32" ? "emulator.exe" : "emulator.out";
  const p = resourcePath("bin", platformDir, fileName);

  console.debug(`Looking for emulator at: ${p}`);

  if (fs.existsSync(p)) return p;
  // fallback for asarUnpack
  const alt = resourcePath("app.asar.unpacked", "bin", platformDir, fileName);
  if (fs.existsSync(alt)) return alt;
  return null;
}

const spawnEmulator = (programPath, debugMode = false) => {
  const emulatorPath = getEmulatorPath();

  if (!emulatorPath) {
    dialog.showErrorBox(
      "Emulator Error",
      `Could not find emulator executable at path: ${emulatorPath}.`,
    );
    return;
  }

  console.debug(
    `Spawning emulator with program: ${programPath}, debugMode: ${debugMode}`,
  );

  // Kill existing process if any
  if (emulatorProcess) {
    emulatorProcess.kill();
    emulatorProcess = null;
  }

  // Build arguments
  const args = [programPath];
  if (debugMode) {
    args.push("--debug", "IPC");
  }

  // Spawn with explicit unbuffered output handling
  // On Windows, child processes may buffer output by default
  // Setting up stdio with pipe allows better control
  emulatorProcess = spawn(emulatorPath, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  let outputBuffer = "";
  let stderrBuffer = "";

  // Ensure encoding is set (helps with Windows line ending handling)
  emulatorProcess.stdout.setEncoding('utf8');
  emulatorProcess.stderr.setEncoding('utf8');

  emulatorProcess.stdout.on("data", (data) => {
    const dataStr = data.toString();
    outputBuffer += dataStr;

    // Split on both \n and \r\n for Windows compatibility
    const lines = outputBuffer.split(/\r?\n/);
    outputBuffer = lines.pop() || "";

    lines.forEach((line) => {
      if (!line.trim()) return;

      if (line.startsWith("{")) {
        // Try to parse structured JSON responses, but keep parsing lightweight
        try {
          const json = JSON.parse(line);
          mainWindow.webContents.send("emulator:response", json);
          return;
        } catch (e) {
          // fallthrough to send as plain output
        }
      } else if (line.startsWith("Entering IPC debug mode")) {
        // no need to print this message to output console.
        return;
      }

      // Forward plain text output to renderer; conversion/sanitization happens there
      mainWindow.webContents.send("emulator:output", line);
    });
  });

  emulatorProcess.stderr.on("data", (data) => {
    const dataStr = data.toString();
    stderrBuffer += dataStr;

    // Split on both \n and \r\n for Windows compatibility (same as stdout)
    const lines = stderrBuffer.split(/\r?\n/);
    stderrBuffer = lines.pop() || "";

    lines.forEach((line) => {
      if (!line.trim()) return;

      // Forward parsing errors to renderer output console; other stderr is an error box
      if (line.includes("Error parsing")) {
        mainWindow.webContents.send("emulator:output", line);
      } else {
        try {
          dialog.showErrorBox("Emulator Error", line);
        } catch (err) {
          console.warn("Failed to show error box:", err);
        }
      }
    });
  });

  emulatorProcess.on("error", (err) => {
    console.error("Failed to spawn emulator:", err);
    try {
      dialog.showErrorBox("Emulator Error", `Failed to start emulator: ${err.message}`);
    } catch (e) {
      console.warn("Failed to show error box:", e);
    }
    emulatorProcess = null;
  });

  emulatorProcess.on("exit", (code) => {
    console.log("Emulator process exited with code:", code);
    mainWindow.webContents.send("emulator:exit", code || 0);
    emulatorProcess = null;
  });
};

ipcMain.handle("emulator:command", (event, command) => {
  if (!emulatorProcess) {
    // Show error from main process instead of forwarding to renderer
    try {
      dialog.showErrorBox("Emulator Error", "Emulator not running");
    } catch (e) {
      console.warn("Failed to show error box:", e);
    }
    return { error: "Emulator not running" };
  }

  emulatorProcess.stdin.write(command + "\n");
});

ipcMain.handle("emulator:start", (event, programPath, debugMode = false) => {
  spawnEmulator(programPath, debugMode);
});

ipcMain.handle("file:open", async (event) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "IAS Programs", extensions: ["ias"] }],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      return { path: filePath, content };
    } catch (err) {
      try {
        dialog.showErrorBox("File Error", "Failed to read file: " + err.message);
      } catch (e) {
        console.warn("Failed to show file error box:", e);
      }
      return null;
    }
  }
  return null;
});

ipcMain.handle("file:create", async (event) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: "IAS Programs", extensions: ["ias"] }],
  });

  if (!result.canceled && result.filePath) {
    try {
      await fs.promises.writeFile(result.filePath, "");
      return { path: result.filePath };
    } catch (err) {
      try {
        dialog.showErrorBox("File Error", "Failed to create file: " + err.message);
      } catch (e) {
        console.warn("Failed to show file error box:", e);
      }
      return null;
    }
  }
  return null;
});

ipcMain.handle("file:save", async (event, filePath, content) => {
  try {
    await fs.promises.writeFile(filePath, content);
    return { success: true };
  } catch (err) {
    try {
      dialog.showErrorBox("File Error", "Failed to save file: " + err.message);
    } catch (e) {
      console.warn("Failed to show file error box:", e);
    }
    return { success: false };
  }
});

ipcMain.handle("emulator:stop", (event) => {
  if (emulatorProcess) {
    try {
      emulatorProcess.kill("SIGTERM");
      // Give it a moment to terminate gracefully
      setTimeout(() => {
        if (emulatorProcess) {
          emulatorProcess.kill("SIGKILL");
        }
      }, 1000);
    } catch (err) {
      console.error("Error killing emulator:", err);
    }
    emulatorProcess = null;
  }
});

app.whenReady().then(createWindow);

app.whenReady().then(() => {
  const menu = buildMenu();
  // wire context-menu to popup at cursor
  app.on("browser-window-created", (event, window) => {
    window.webContents.on("context-menu", (e, params) => {
      if (menu && window) menu.popup({ window, x: params.x, y: params.y });
    });
  });
});

// Performance optimization: reduce memory pressure for older hardware
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-device-discovery-notifications');

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (emulatorProcess) {
    try {
      emulatorProcess.kill("SIGTERM");
    } catch (err) {
      console.error("Error terminating emulator on quit:", err);
    }
    emulatorProcess = null;
  }
});
