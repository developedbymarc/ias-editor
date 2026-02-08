const { BrowserWindow, app, ipcMain, dialog, Menu } = require("electron");
const { join } = require("node:path");
const { spawn } = require("child_process");
const { writeFileSync, readFileSync, existsSync } = require("fs");
const { convertAnsiToHtml } = require("./ansi-to-html.cjs");

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
    // Disable Dev Tools in production
    mainWindow.webContents.openDevTools();
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
          label: "Step",
          accelerator: "F10",
          click: () =>
            mainWindow && mainWindow.webContents.send("menu:action", "step"),
        },
      ],
    },
    {
      ...(isDev && ({label: "DevTools",
      submenu: [
        {
          label: "Toggle DevTools",
          accelerator: "CmdOrCtrl+Shift+I",
          click: () => mainWindow.webContents.toggleDevTools(),
        },
      ]})),
    }
  ];

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

  if (existsSync(p)) return p;
  // fallback for asarUnpack
  const alt = resourcePath("app.asar.unpacked", "bin", platformDir, fileName);
  if (existsSync(alt)) return alt;
  return null;
}

const spawnEmulator = (programPath, debugMode = false) => {
  const emulatorPath = getEmulatorPath();

  if (!emulatorPath) {
    dialog.showErrorBox(
      "Unsupported Platform",
      "Your platform is not supported.",
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
    // Ensure child process inherits environment (important for Windows PATH)
    env: { ...process.env },
  });

  let buffer = "";
  let outputBuffer = ""; // For capturing PRINT and other output

  
  let totalOutput = 0;
    
  const MAX_TOTAL_OUTPUT = 64 * 1024; // 64 KB

  // Ensure encoding is set (helps with Windows line ending handling)
  emulatorProcess.stdout.setEncoding('utf8');
  emulatorProcess.stderr.setEncoding('utf8');

  emulatorProcess.stdout.on("data", (data) => {
    const dataStr = data.toString();
    totalOutput += dataStr.length;

    // If total output exceeds limit, kill process and show error
    if (totalOutput > MAX_TOTAL_OUTPUT) {
      console.warn("Emulator output exceeded limit, killing process.", totalOutput);
      emulatorProcess.kill();
      mainWindow.webContents.send(
        "emulator:error",
        "Emulator output exceeded limit. Process killed.",
      );
      return;
    }
    buffer += dataStr;
    outputBuffer += dataStr;

    // Split on both \n and \r\n for Windows compatibility
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    lines.forEach((line) => {
      if (line.startsWith("{")) {
        try {
          const json = JSON.parse(line);
          mainWindow.webContents.send("emulator:response", json);
        } catch (e) {
          // Not JSON, treat as output
          mainWindow.webContents.send("emulator:output", line);
        }
      } else if (line.trim()) {
        // Non-JSON output (PRINT statements, etc.)
        mainWindow.webContents.send("emulator:output", convertAnsiToHtml(line));
      }
    });
  });

  emulatorProcess.stderr.on("data", (data) => {
    const errorStr = data.toString();
    if (errorStr.includes("Error parsing")) {
      mainWindow.webContents.send("emulator:output", convertAnsiToHtml(errorStr));
    }
    mainWindow.webContents.send("emulator:error", errorStr);
    outputBuffer += "[ERROR] " + errorStr;
  });

  emulatorProcess.on("error", (err) => {
    console.error("Failed to spawn emulator:", err);
    mainWindow.webContents.send(
      "emulator:error",
      `Failed to start emulator: ${err.message}`,
    );
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
      const content = readFileSync(filePath, "utf-8");
      return { path: filePath, content };
    } catch (err) {
      throw new Error("Failed to read file: " + err.message);
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
      writeFileSync(result.filePath, "");
      return { path: result.filePath };
    } catch (err) {
      throw new Error("Failed to create file: " + err.message);
    }
  }
  return null;
});

ipcMain.handle("file:save", async (event, filePath, content) => {
  try {
    writeFileSync(filePath, content);
    return { success: true };
  } catch (err) {
    throw new Error("Failed to save file: " + err.message);
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
