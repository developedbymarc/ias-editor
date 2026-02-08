import { useEffect, useRef, useState, useCallback, useMemo, Suspense } from "react";
import DebuggerWindow from "./components/DebuggerWindow";
import VirtualizedOutput from "./components/VirtualizedOutput";

import Debug from "./assets/Debug.svg";
import Run from "./assets/Run.svg";
import Stop from "./assets/Stop.svg";
import StepOver from "./assets/StepOver.svg";

import "./App.css";
import useDebounce from "./lib/useDebounce";

import { lazy } from "react";

interface EmulatorAPI {
  startEmulator: (path: string, debugMode?: boolean) => Promise<void>;
  stopEmulator: () => Promise<void>;
  sendCommand: (command: string) => Promise<void>;
  onResponse: (callback: (data: any) => void) => void;
  onOutput: (callback: (data: string) => void) => void;
  onError: (callback: (error: string) => void) => void;
  onExit: (callback: (code: number) => void) => void;
  removeListeners: () => void;
}

interface FileAPI {
  openFile: () => Promise<{ path: string; content: string } | null>;
  createFile: () => Promise<{ path: string } | null>;
  saveFile: (path: string, content: string) => Promise<{ success: boolean }>;
}

declare global {
  interface Register {
    int: string;
    bits: string;
    instr?: string;
  }

  interface CPUState {
    REGISTERS: {
      PC: Register;
      AC: Register;
      MQ: Register;
      IR: Register;
      MAR: Register;
      MBR: Register;
    };
  }

  interface MemoryDump {
    addr: string;
    raw: string;
    signed: string;
    instr: string;
  }

  interface Window {
    emulatorAPI: EmulatorAPI;
    fileAPI: FileAPI;
    menuAPI?: { onAction: (cb: (action: string) => void) => void };
  }
}

interface DebugData {
  type: "step" | "dump";
  REGISTERS?: CPUState["REGISTERS"];
  RAM?: {
    range: { start: number; end: number };
    memory: MemoryDump[];
  };
}

function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [savedCode, setSavedCode] = useState("");
  const [cpuState, setCpuState] = useState<CPUState | null>(null);
  const [memoryDump, setMemoryDump] = useState<MemoryDump[]>([]);
  const outputEndRef = useRef<HTMLDivElement>(null);
  const responseHandlerRef = useRef<((data: any) => void) | null>(null);

  // Layout state for resizable panels
  const [leftWidth, setLeftWidth] = useState<number>(60); // percent
  const [rightTopHeight, setRightTopHeight] = useState<number>(60); // percent

  const Editor = useMemo(() => lazy(() => import("./components/Editor")), []);

  // Clean up on unmount: stop emulator and remove listeners
  useEffect(() => {
    return () => {
      window.emulatorAPI.stopEmulator().catch(() => {
        /* ignore errors during cleanup */
      });
      window.emulatorAPI.removeListeners();
    };
  }, []);

  useEffect(() => {
    const handleResponse = (data: DebugData) => {
      console.log("Emulator response:", data);

      // Parse response type and extract data
      if (data.type === "step") {
        // Step response contains CPU state
        if (data.REGISTERS) {
          setCpuState({ REGISTERS: data.REGISTERS });
        }
      } else if (data.type === "dump") {
        // Dump response contains memory data
        if (Array.isArray(data.RAM?.memory)) {
          setMemoryDump(data.RAM?.memory);
        }
      }

      responseHandlerRef.current?.(data);
    };

    const handleOutput = (data: string) => {
      console.log("Emulator output:", data);
      setOutput((prev) => [...prev, data]);
    };

    const handleError = (error: string) => {
      console.error("Emulator error:", error);
      setError(error);
    };

    const handleExit = (code: number) => {
      console.log("Emulator exited with code:", code);
      setIsRunning(false);
      if (code !== 0) {
        setError(`Emulator exited with code ${code}`);
      }
    };

    window.emulatorAPI.onResponse(handleResponse);
    window.emulatorAPI.onOutput(handleOutput);
    window.emulatorAPI.onError(handleError);
    window.emulatorAPI.onExit(handleExit);

    return () => {
      window.emulatorAPI.removeListeners();
    };
  }, []);

  useEffect(() => {
    if (error) {
      setIsRunning(false);
      setError(null);
    }
  }, [error]);

  // Per-drag mouse handlers: attach listeners on mousedown for reliable capture
  const attachVerticalDrag = (startX: number, startLeftPct: number) => {
    const parent = document.querySelector(".app-main") as HTMLElement | null;
    if (!parent) return;
    const width = parent.clientWidth;
    const startLeftPx = (startLeftPct * width) / 100;

    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newLeft = Math.min(
        90,
        Math.max(10, ((startLeftPx + delta) / width) * 100),
      );
      setLeftWidth(newLeft);
    };

    const onUp = () => {
      document.body.style.cursor = "default";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const attachHorizontalDrag = (startY: number, startTopPct: number) => {
    const rightPanel = document.querySelector(
      ".right-panel",
    ) as HTMLElement | null;
    if (!rightPanel) return;
    const height = rightPanel.clientHeight;
    const startTopPx = (startTopPct * height) / 100;

    const onMove = (e: MouseEvent) => {
      const delta = e.clientY - startY;
      const newTop = Math.min(
        90,
        Math.max(10, ((startTopPx + delta) / height) * 100),
      );
      setRightTopHeight(newTop);
    };

    const onUp = () => {
      document.body.style.cursor = "default";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleOpenFile = useCallback(async () => {
    try {
      const result = await window.fileAPI.openFile();
      if (result) {
        setCurrentFile(result.path);
        setCode(result.content);
        setSavedCode(result.content);
        setError(null);
      }
    } catch (err) {
      setError("Failed to open file: " + String(err));
    }
  }, []);

  const handleCreateFile = useCallback(async () => {
    try {
      const result = await window.fileAPI.createFile();
      if (result) {
        setCurrentFile(result.path);
        setCode("");
        setSavedCode("");
        setError(null);
      }
    } catch (err) {
      setError("Failed to create file: " + String(err));
    }
  }, []);

  const handleSaveFile = useCallback(async (fileContent?: string) => {
    const contentToSave = fileContent !== undefined ? fileContent : code;
    if (!currentFile) {
      setError("No file selected");
      return;
    }

    try {
      await window.fileAPI.saveFile(currentFile, contentToSave);
      setSavedCode(contentToSave);
      setError(null);
    } catch (err) {
      setError("Failed to save file: " + String(err));
    }
  }, [currentFile, code]);

  const handleStep = useCallback(async () => {
    try {
      await window.emulatorAPI.sendCommand("step");
    } catch (err) {
      setError("Failed to execute step: " + String(err));
    }
  }, []);

  const handleMemoryDump = useCallback(async (start: number, lines: number) => {
    try {
      await window.emulatorAPI.sendCommand(`dump ${start} ${lines}`);
    } catch (err) {
      setError("Failed to dump memory: " + String(err));
    }
  }, []);

  const handleRunProgram = useCallback(async (debugMode: boolean) => {
    if (!currentFile) {
      setError("Please open or create a file before running");
      return;
    }

    try {
      setError(null);
      setOutput([]);

      // Save before running
      await window.fileAPI.saveFile(currentFile, code);

      setIsRunning(true);

      await window.emulatorAPI.startEmulator(currentFile, debugMode);
    } catch (err) {
      setError("Failed to start emulator: " + String(err));
      setIsRunning(false);
    }
  }, [currentFile, code]);

  const handleStopProgram = useCallback(async () => {
    try {
      await window.emulatorAPI.stopEmulator();
    } catch (err) {
      console.warn("Error stopping emulator:", err);
    } finally {
      setIsRunning(false);
    }
  }, []);

  // Start vertical splitter drag
  const startVerticalResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    document.body.style.cursor = "col-resize";
    attachVerticalDrag(e.clientX, leftWidth);
  }, [leftWidth]);

  // Start horizontal splitter drag (within right panel)
  const startHorizontalResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    document.body.style.cursor = "row-resize";
    attachHorizontalDrag(e.clientY, rightTopHeight);
  }, [rightTopHeight]);

  // Create debounced IPC handlers at top-level so hooks are called consistently
  const debouncedOpenFile = useDebounce(handleOpenFile, {
    wait: 500,
    leading: true,
    trailing: false,
  });

  const debouncedCreateFile = useDebounce(handleCreateFile, {
    wait: 500,
    leading: true,
    trailing: false,
  });

  const debouncedSaveFile = useDebounce(handleSaveFile, {
    wait: 500,
    leading: true,
    trailing: false,
  });

  const debouncedRunProgram = useDebounce(handleRunProgram, {
    wait: 500,
    leading: true,
    trailing: false,
  });

  const debouncedStopProgram = useDebounce(handleStopProgram, {
    wait: 500,
    leading: true,
    trailing: false,
  });

  const debouncedStep = useDebounce(handleStep, {
    wait: 150,
    leading: true,
    trailing: false,
  });

  const debouncedMemoryDump = useDebounce(handleMemoryDump, {
    wait: 500,
    leading: true,
    trailing: false,
  });

  const ipcDebouncedEventHandlers = useMemo(
    () => ({
      openFile: debouncedOpenFile,
      createFile: debouncedCreateFile,
      saveFile: debouncedSaveFile,
      runProgram: debouncedRunProgram,
      stopProgram: debouncedStopProgram,
      step: debouncedStep,
      memoryDump: debouncedMemoryDump,
    }),
    [
      debouncedOpenFile,
      debouncedCreateFile,
      debouncedSaveFile,
      debouncedRunProgram,
      debouncedStopProgram,
      debouncedStep,
      debouncedMemoryDump,
    ],
  );

  // Listen for native menu actions from main process
  useEffect(() => {
    if (!window.menuAPI || !window.menuAPI.onAction) return;
    const handler = (action: string) => {
      switch (action) {
        case "open":
          ipcDebouncedEventHandlers.openFile();
          break;
        case "new":
          ipcDebouncedEventHandlers.createFile();
          break;
        case "save":
          ipcDebouncedEventHandlers.saveFile();
          break;
        case "run":
          ipcDebouncedEventHandlers.runProgram(false);
          break;
        case "stop":
          handleStopProgram();
          break;
        case "step":
          ipcDebouncedEventHandlers.step();
          break;
      }
    };
    window.menuAPI.onAction(handler);
    return () => {
      /* no-op: ipcRenderer handles removal when window closed */
    };
  }, [ipcDebouncedEventHandlers, handleStopProgram]);

  const getFileName = useMemo(() => {
    if (!currentFile) return "No file selected";
    return currentFile.split("/").pop() || currentFile;
  }, [currentFile]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1>IAS Program Editor</h1>
          <span className="file-name-display">
            {getFileName}
            {code !== savedCode && (
              <span className="unsaved-indicator" title="Unsaved changes">
                ●
              </span>
            )}
          </span>
        </div>
        <div className="toolbar-icons header-right">
          <button
            onClick={() => {
              handleRunProgram(false);
            }}
            disabled={isRunning || !currentFile}
            title="Run"
          >
            <img src={Run} alt="Run" width={16} height={16} />
          </button>

          <button
            onClick={() => {
              handleRunProgram(true);
            }}
            title="Run with Debugger"
            disabled={isRunning || !currentFile}
          >
            <img src={Debug} alt="Run Debug" width={16} height={16} />
          </button>

          <button onClick={handleStep} disabled={!isRunning} title="Step">
            <img src={StepOver} alt="Step Over" width={16} height={16} />
          </button>

          <button
            onClick={handleStopProgram}
            disabled={!isRunning}
            title="Stop"
          >
            <img src={Stop} alt="Stop" width={16} height={16} />
          </button>
        </div>
      </header>

      {error && (
        <div key={error} className="error-bar">
          {error}
        </div>
      )}

         <main
        className="app-main"
        style={{ gridTemplateColumns: `${leftWidth}% 6px ${100 - leftWidth}%` }}
      >
        <div
          className="left-column"
          style={{ gridTemplateRows: `${rightTopHeight}% 6px ${100 - rightTopHeight}%` }}
        >
          <section className="editor-section">
            <Suspense fallback={<div>Loading editor...</div>}>
              <Editor
                isRunning={isRunning}
                code={code}
                onCodeChange={setCode}
                hasFile={!!currentFile}
              />
            </Suspense>
          </section>

          <div
            className="horizontal-splitter"
            onMouseDown={startHorizontalResize}
          />

          <section className="output-section">
            <h3>Output Console</h3>
            {output.length === 0 ? (
              <div className="output-container">
                <p className="no-output">
                  No output yet. Run a program to see output here.
                </p>
              </div>
            ) : (
              <VirtualizedOutput lines={output} scrollEndRef={outputEndRef} />
            )}
          </section>
        </div>

        <div className="vertical-splitter" onMouseDown={startVerticalResize} />

        <div className="right-panel">
          <section className="debugger-section">
            <DebuggerWindow
              onStep={handleStep}
              onMemoryDump={handleMemoryDump}
              isRunning={isRunning}
              cpuState={cpuState}
              memoryDump={memoryDump}
            />
          </section>
        </div>
      </main>
    </div>
  );
}

export default App;
