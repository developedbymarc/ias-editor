const { contextBridge, ipcRenderer } = require("electron");

// Create managed listeners map for proper cleanup
const listeners = {
  response: null,
  output: null,
  error: null,
  exit: null
};

contextBridge.exposeInMainWorld("emulatorAPI", {
    startEmulator: (programPath, debugMode = false) => 
        ipcRenderer.invoke("emulator:start", programPath, debugMode),
    stopEmulator: () => 
        ipcRenderer.invoke("emulator:stop"),
    sendCommand: (command) => 
        ipcRenderer.invoke("emulator:command", command),
    onResponse: (callback) => {
        if (listeners.response) {
            ipcRenderer.off("emulator:response", listeners.response);
        }
        listeners.response = (event, data) => callback(data);
        ipcRenderer.on("emulator:response", listeners.response);
    },
    onOutput: (callback) => {
        if (listeners.output) {
            ipcRenderer.off("emulator:output", listeners.output);
        }
        listeners.output = (event, data) => callback(data);
        ipcRenderer.on("emulator:output", listeners.output);
    },
    onError: (callback) => {
        if (listeners.error) {
            ipcRenderer.off("emulator:error", listeners.error);
        }
        listeners.error = (event, error) => callback(error);
        ipcRenderer.on("emulator:error", listeners.error);
    },
    onExit: (callback) => {
        if (listeners.exit) {
            ipcRenderer.off("emulator:exit", listeners.exit);
        }
        listeners.exit = (event, code) => callback(code);
        ipcRenderer.on("emulator:exit", listeners.exit);
    },
    removeListeners: () => {
        if (listeners.response) ipcRenderer.off("emulator:response", listeners.response);
        if (listeners.output) ipcRenderer.off("emulator:output", listeners.output);
        if (listeners.error) ipcRenderer.off("emulator:error", listeners.error);
        if (listeners.exit) ipcRenderer.off("emulator:exit", listeners.exit);
        listeners.response = null;
        listeners.output = null;
        listeners.error = null;
        listeners.exit = null;
    }
});

// expose menu actions from main process
contextBridge.exposeInMainWorld("menuAPI", {
    onAction: (callback) => ipcRenderer.on('menu:action', (event, action) => callback(action)),
});

contextBridge.exposeInMainWorld("fileAPI", {
    openFile: () => 
        ipcRenderer.invoke("file:open"),
    createFile: () => 
        ipcRenderer.invoke("file:create"),
    saveFile: (filePath, content) => 
        ipcRenderer.invoke("file:save", filePath, content),
});
