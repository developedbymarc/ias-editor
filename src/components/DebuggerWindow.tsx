import { useState, useCallback, memo } from "react";
import "./DebuggerWindow.css";

interface DebuggerWindowProps {
  onStep: () => void;
  onMemoryDump: (start: number, lines: number) => void;
  isRunning: boolean;
  cpuState: CPUState | null;
  memoryDump: MemoryDump[];
}

const clamp = (num: number, min: number, max: number) => Math.min(Math.max(num, min), max);

function DebuggerWindow({
  onMemoryDump,
  cpuState,
  memoryDump,
}: DebuggerWindowProps) {
  const [memoryStart, setMemoryStart] = useState(0);
  const [memoryLines, setMemoryLines] = useState(10);

  const handleMemoryDump = useCallback(() => {
    onMemoryDump(memoryStart, memoryLines);
  }, [memoryStart, memoryLines, onMemoryDump]);

  const handleMemoryStartChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setMemoryStart(clamp(parseInt(e.target.value) || 0, 0, 4095));
  }, []);

  const handleMemoryLinesChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setMemoryLines(clamp(parseInt(e.target.value) || 0, 0, 4096));
  }, []);

  return (
    <div className="debugger-container">
      <div className="debugger-section">
        <h3>CPU Registers</h3>
        {cpuState ? (
          <table className="registers-table">
            <thead>
              <tr>
                <th>Register</th>
                <th>Value</th>
                <th>Binary</th>
                {cpuState.REGISTERS.MBR.instr && <th>Instructions</th>}
              </tr>
            </thead>
            <tbody>
              {Object.entries(cpuState.REGISTERS).map(([name, reg]) => (
                <tr key={name}>
                  <td className="reg-name">{name}</td>
                  <td className="reg-value">{reg.int}</td>
                  <td className="reg-bits">{reg.bits}</td>
                  {reg.instr && <td className="reg-instr">{reg.instr}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="no-data">No CPU state available. Run a program first.</p>
        )}
      </div>

      <div className="debugger-section">
        <h3>Memory</h3>
        <div className="memory-controls">
          <div className="control-group">
            <label>Start Address:</label>
            <input
              type="number"
              value={memoryStart}
              onChange={handleMemoryStartChange}
              min={0}
              max={4095}
            />
          </div>
          <div className="control-group">
            <label>Lines:</label>
            <input
              type="number"
              value={memoryLines}
              onChange={handleMemoryLinesChange}
              min={0}
              max={4096}
            />
          </div>
          <button onClick={handleMemoryDump} className="dump-button">
            Dump Memory
          </button>
        </div>

        {memoryDump.length > 0 ? (
          <table className="memory-table">
            <thead>
              <tr>
                <th>Address</th>
                <th>Raw (Binary)</th>
                <th>Signed</th>
                <th>Instructions</th>
              </tr>
            </thead>
            <tbody>
              {memoryDump.map((cell, idx) => (
                <tr key={idx}>
                  <td className="mem-addr">{cell.addr}</td>
                  <td className="mem-raw">{cell.raw}</td>
                  <td className="mem-signed">{cell.signed}</td>
                  <td className="mem-instr">{cell.instr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="no-data">No memory dump available.</p>
        )}
      </div>
    </div>
  );
}

export default memo(DebuggerWindow);
