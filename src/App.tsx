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
import Splitter from "./components/Splitter";

interface EmulatorAPI {
  // IPC handlers may return an error object when the main process handled the error
  startEmulator: (path: string, debugMode?: boolean) => Promise<{ error?: string } | void>;
  stopEmulator: () => Promise<{ error?: string } | void>;
  sendCommand: (command: string) => Promise<{ error?: string } | void>;
  onResponse: (callback: (data: any) => void) => void;
  onOutput: (callback: (data: string) => void) => void;
  onError: (callback: (error: string) => void) => void;
  onExit: (callback: (code: number) => void) => void;
  removeListeners: () => void;
}

interface FileAPI {
  openFile: () => Promise<{ path: string; content: string } | null>;
  createFile: () => Promise<{ path: string } | null>;
  // saveFile returns a success object, or main may return null on failure
  saveFile: (path: string, content: string) => Promise<{ success: boolean } | null>;
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

/**
 * Fixed-size circular buffer for strings. Push is O(1) and doesn't shift arrays.
 */
class CircularBuffer {
  private buf: (string | null)[];
  private head: number = 0; // index of oldest element
  private len: number = 0; // current number of elements
  private capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buf = new Array(capacity).fill(null);
  }

  setCapacity(newCap: number) {
    if (newCap === this.capacity) return;
    const arr = this.toArray();
    this.capacity = newCap;
    this.buf = new Array(newCap).fill(null);
    this.head = 0;
    this.len = 0;
    // keep newest items up to new capacity
    const start = Math.max(0, arr.length - newCap);
    for (let i = start; i < arr.length; i++) this.push(arr[i]);
  }

  push(item: string) {
    if (this.capacity === 0) return;
    const pos = (this.head + this.len) % this.capacity;
    if (this.len < this.capacity) {
      this.buf[pos] = item;
      this.len++;
    } else {
      // overwrite oldest and advance head
      this.buf[pos] = item;
      this.head = (this.head + 1) % this.capacity;
    }
  }

  clear() {
    this.buf.fill(null);
    this.head = 0;
    this.len = 0;
  }

  toArray(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.len; i++) {
      const idx = (this.head + i) % this.capacity;
      const val = this.buf[idx];
      if (val !== null) out.push(val);
    }
    return out;
  }
}

function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [maxOutputLines] = useState(1000);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeIsSaved, setCodeIsSaved] = useState(true);
  const [cpuState, setCpuState] = useState<CPUState | null>(null);
  const [memoryDump, setMemoryDump] = useState<MemoryDump[]>([]);
  const outputEndRef = useRef<HTMLDivElement>(null);
  const responseHandlerRef = useRef<((data: any) => void) | null>(null);
  const maxOutputLinesRef = useRef(maxOutputLines);
  const outputBufferRef = useRef<CircularBuffer>(new CircularBuffer(maxOutputLines));
  const flushScheduledRef = useRef(false);

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
      // push into buffer and schedule a single flush per animation frame
      const buf = outputBufferRef.current;
      buf.push(data);

      if (!flushScheduledRef.current) {
        flushScheduledRef.current = true;
        requestAnimationFrame(() => {
          flushScheduledRef.current = false;
          setOutput(buf.toArray());
          if (outputEndRef.current) outputEndRef.current.scrollIntoView({ behavior: "auto" });
        });
      }
    };

    const handleError = (error: string) => {
      console.error("Emulator error:", error);
    };

    const handleExit = (code: number) => {
      console.log("Emulator exited with code:", code);
      setIsRunning(false);
      // Non-zero exit errors are handled and displayed by main process.
      // Renderer only needs to update running state.
    };

    window.emulatorAPI.onResponse(handleResponse);
    window.emulatorAPI.onOutput(handleOutput);
    window.emulatorAPI.onError(handleError);
    window.emulatorAPI.onExit(handleExit);

    return () => {
      window.emulatorAPI.removeListeners();
    };
  }, []);

  // keep ref in sync with state so handlers registered once see updates
  useEffect(() => {
    maxOutputLinesRef.current = maxOutputLines;
    // update circular buffer capacity when user changes setting
    outputBufferRef.current.setCapacity(maxOutputLines);
  }, [maxOutputLines]);

  useEffect(() => {
    if (error) {
      setIsRunning(false);
      setError(null);
    }
  }, [error]);

  const handleOpenFile = useCallback(async () => {
    try {
      const result = await window.fileAPI.openFile();
      if (result) {
        setCurrentFile(result.path);
        setCode(result.content);
        setCodeIsSaved(true);
      }
      // If result is null or an error occurred, main has already handled user feedback.
    } catch (err) {
      console.warn("openFile IPC failed:", err);
    }
  }, []);

  const handleCreateFile = useCallback(async () => {
    try {
      const result = await window.fileAPI.createFile();
      if (result) {
        setCurrentFile(result.path);
        setCode("");
        setCodeIsSaved(true);
      }
    } catch (err) {
      console.warn("createFile IPC failed:", err);
    }
  }, []);

  const handleSaveFile = useCallback(async (fileContent?: string) => {
    const contentToSave = fileContent !== undefined ? fileContent : code;
    try {
      if (!currentFile) throw new Error("No file selected");

      const resp = await window.fileAPI.saveFile(currentFile, contentToSave);
      if (resp && resp.success) {
        setCodeIsSaved(true);
      } else {
        // Main process handles showing file save errors to the user.
        console.warn("saveFile returned failure or null", resp);
      }
    } catch (err) {
      console.warn("saveFile IPC failed:", err);
    }
  }, [currentFile, code]);

  const handleStep = useCallback(async () => {
    try {
      const resp = await window.emulatorAPI.sendCommand("step");
      if (resp && resp.error) {
        console.warn("emulator command error:", resp.error);
      }
    } catch (err) {
      console.warn("sendCommand IPC failed:", err);
    }
  }, []);

  const handleMemoryDump = useCallback(async (start: number, lines: number) => {
    try {
      const resp = await window.emulatorAPI.sendCommand(`dump ${start} ${lines}`);
      if (resp && resp.error) {
        console.warn("emulator command error:", resp.error);
      }
    } catch (err) {
      console.warn("sendCommand IPC failed:", err);
    }
  }, []);

  const handleRunProgram = useCallback(async (debugMode: boolean) => {
    if (!currentFile) {
      setError("Please open or create a file before running");
      return;
    }

    try {
      setError(null);
      setOutput([]); // Clear output console on new run
      outputBufferRef.current.clear();

      // Save before running
      const saveResp = await window.fileAPI.saveFile(currentFile, code);
      if (!saveResp || !saveResp.success) {
        // Main shows save errors.
        return;
      }
      
      setCodeIsSaved(true);
      setIsRunning(true);

      const startResp = await window.emulatorAPI.startEmulator(currentFile, debugMode);
      if (startResp && startResp.error) {
        console.warn("emulator start error:", startResp.error);
        setIsRunning(false);
      }
    } catch (err) {
      console.warn("Failed to start emulator (IPC):", err);
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

  const debouncedRunProgram = useDebounce(() => handleRunProgram(false), {
    wait: 500,
    leading: true,
    trailing: false,
  });
  
  const debouncedDebugProgram = useDebounce(() => handleRunProgram(true), {
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
      debugProgram: debouncedDebugProgram,
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
          ipcDebouncedEventHandlers.runProgram();
          break;
        case "debug":
          ipcDebouncedEventHandlers.debugProgram();
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
            {!codeIsSaved && (
              <span className="unsaved-indicator" title="Unsaved changes">
                ●
              </span>
            )}
          </span>
        </div>
        <div className="toolbar-icons header-right">
          <button
            onClick={debouncedRunProgram}
            disabled={isRunning || !currentFile}
            title="Run"
          >
            <img src={Run} alt="Run" width={16} height={16} />
          </button>

          <button
            onClick={debouncedDebugProgram}
            title="Run with Debugger"
            disabled={isRunning || !currentFile}
          >
            <img src={Debug} alt="Run Debug" width={16} height={16} />
          </button>

          <button onClick={debouncedStep} disabled={!isRunning} title="Step">
            <img src={StepOver} alt="Step Over" width={16} height={16} />
          </button>

          <button
            onClick={debouncedStopProgram}
            disabled={!isRunning}
            title="Stop"
          >
            <img src={Stop} alt="Stop" width={16} height={16} />
          </button>
        </div>
      </header>

      <main
        className="app-main"
        style={{ gridTemplateColumns: `${leftWidth}% 2px ${100 - leftWidth}%` }}
      >
        <div
          className="left-panel"
          style={{ gridTemplateRows: `${rightTopHeight}% 2px ${100 - rightTopHeight}%` }}
        >
          <section className="editor-section">
            <Suspense fallback={<div>Loading editor...</div>}>
              <Editor
                isRunning={isRunning}
                code={code}
                onCodeChange={(code: string, hasFile: boolean) => {
                  setCode(code);

                  if (!hasFile) return; // Don't mark as unsaved if no file to save to
                  setCodeIsSaved(false);
                }}
                hasFile={!!currentFile}
              />
            </Suspense>
          </section>

          <Splitter
            orientation="horizontal"
            containerSelector=".right-panel"
            getStartPct={() => rightTopHeight}
            onResize={(p) => setRightTopHeight(p)}
            minPct={10}
            maxPct={90}
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
              <div className="output-console">
                <VirtualizedOutput lines={output} scrollEndRef={outputEndRef} />
              </div>
            )}
          </section>
        </div>

        <Splitter
          orientation="vertical"
          containerSelector=".app-main"
          getStartPct={() => leftWidth}
          onResize={(p) => setLeftWidth(p)}
          minPct={10}
          maxPct={90}
        />

        <div className="right-panel">
          <DebuggerWindow
            onStep={debouncedStep}
            onMemoryDump={debouncedMemoryDump}
            isRunning={isRunning}
            cpuState={cpuState}
            memoryDump={memoryDump}
          />
        </div>
      </main>
    </div>
  );
}

export default App;
