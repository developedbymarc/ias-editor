# IAS Editor - Interactive IDE and Debugger

An Electron-based IDE for editing, debugging, and executing IAS (Institute for Advanced Study) computer programs.

## Notes

This project was fully vibe-coded.

## Dependencies

This editor requires the [IAS Emulator](https://github.com/developedbymarc/ias-emulator) to run programs. Ensure the emulator is built before using the editor.

## Features

- File Management (open, create, and save .ias programs)
- Code Editor
- Interactive Debugger: Step through program execution instruction-by-instruction
- CPU Register & Memory Inspector
- Output Console: Capture and display program output (custom PRINT instructions)
- Auto-save: Automatically saves before running programs
- Error Handling: Clear error messages and diagnostics

## Installation and Setup

### Prerequisites

- Node.js 22 or higher
- npm (comes with Node.js)
- Built emulator binary

### Installation Steps

1. Install dependencies:
```bash
npm install
```

2. Build the emulator (if not already done):

   Clone and build the [IAS Emulator](https://github.com/your-username/ias-emulator) by following its README instructions.

3. Move the emulator binary:

   Move the built emulator binary to the expected location:

   - For Linux: `./bin/linux/`
   - For Windows: `./bin/win64/`
   - For macOS: `./bin/macos/`

4. Start development server:
```bash
npm run dev
```

This will:
- Start Vite dev server on `http://localhost:5173`
- Automatically launch Electron application
- Open DevTools for debugging

### Build Commands

- `npm run build:renderer` - Build React app with Vite
- `npm run build:main` - Compile TypeScript files (if using .ts for main.js)
- `npm run build` - Build both renderer and main process
- `npm start` - Run built application
- `npm run package` - Package as distributable

## Project Structure

```
editor/
├── src/
│   ├── App.tsx                          Main application component
│   ├── App.css                          Application styles
│   ├── main.tsx                         React entry point
│   ├── index.css                        Global styles
│   └── components/
│       ├── Editor.tsx                   Code editor component
│       ├── Editor.css                   Editor styles
│       ├── DebuggerWindow.tsx           Debugger UI component
│       └── DebuggerWindow.css           Debugger styles
├── main.js                              Electron main process
├── preload.js                           Electron preload script (IPC bridge)
├── vite.config.ts                       Vite configuration
├── tsconfig.json                        TypeScript configuration
├── package.json                         Dependencies and scripts
└── index.html                           HTML entry point
```

## User Workflow

### 1. File Management

The application requires an active file before editing or running code.

#### Open Existing File
- Click "Open File" button in toolbar
- Select a .ias program file
- Content loads into editor
- Ready for editing or running

#### Create New File
- Click "New File" button in toolbar
- Choose location and filename (must end with .ias)
- Empty editor opens and file is created
- Ready for editing

#### Save File
- Click "Save" button or use Run button (auto-saves)
- Changes written to disk
- Success/error displayed in error bar

### 2. Editing

- Only active when file is open
- Supports standard text editing
- Line and character count displayed at bottom
- Editor disabled while program is running

### 3. Running and Debugging

#### Run Program
- Click "Run Program" button (only enabled when file is open)
- Automatically saves current file to disk
- Launches emulator in debug mode (IPC)
- Sends initial "step" command
- UI switches to debug view
- Output console clears and ready for output

#### Step Through Execution
- Click "Step" button to execute one instruction
- CPU registers update after each step
- Memory operations reflected in memory viewer
- Output from PRINT instructions appears in console

#### View CPU State
- Register values (decimal)
- Register bit representation (binary)
- Decoded instruction for MBR register

#### Inspect Memory
- Enter start address in memory controls
- Specify number of lines to view
- Click "Dump Memory" button
- Memory contents displayed with addresses, binary, and decoded instructions

### 4. Output Console

- Displays all non-JSON output from program
- PRINT instruction results appear here
- Error messages from emulator logged
- Auto-scrolls to latest output

## API Documentation

### Electron Main Process (main.js)

#### Emulator IPC Handlers

**`emulator:start`**
- Spawns the emulator process with specified program file
- Parameters:
  - `programPath` (string): Full path to .ias file
  - `debugMode` (boolean): Launch in debug mode (default: false)
- Launches with `--debug IPC` flag for IPC communication
- Events sent: `emulator:response`, `emulator:output`, `emulator:error`, `emulator:exit`

**`emulator:command`**
- Sends command to running emulator process
- Parameters:
  - `command` (string): Command to send (e.g., "step", "dump 1 10")
- Returns immediately (responses via IPC events)

**`emulator:stop`**
- Terminates running emulator process
- No parameters

#### File System IPC Handlers

**`file:open`**
- Shows open file dialog for .ias files
- No parameters
- Returns: `{ path: string, content: string }` or null if canceled
- Reads entire file content as UTF-8

**`file:create`**
- Shows save dialog for creating new .ias file
- No parameters
- Returns: `{ path: string }` or null if canceled
- Creates empty file at chosen path

**`file:save`**
- Saves content to file
- Parameters:
  - `filePath` (string): Full path to file
  - `content` (string): File content to write
- Returns: `{ success: boolean }`
- Overwrites existing file content

### Preload Script (preload.js)

Exposes two main APIs to renderer process with context isolation enabled.

#### `window.emulatorAPI`

**Methods:**
```typescript
startEmulator(programPath: string, debugMode?: boolean): Promise<void>
stopEmulator(): Promise<void>
sendCommand(command: string): Promise<void>
onResponse(callback: (data: any) => void): void
onOutput(callback: (data: string) => void): void
onError(callback: (error: string) => void): void
onExit(callback: (code: number) => void): void
removeAllListeners(channel: string): void
```

#### `window.fileAPI`

**Methods:**
```typescript
openFile(): Promise<{ path: string; content: string } | null>
createFile(): Promise<{ path: string } | null>
saveFile(path: string, content: string): Promise<{ success: boolean }>
```

### React Application (App.tsx)

Main orchestrator component managing:
- File state (currentFile, code)
- Execution state (isRunning, debugMode)
- Output display (output array)
- Error messaging
- IPC event listeners

**Key Functions:**
- `handleOpenFile()` - Opens file dialog and loads file
- `handleCreateFile()` - Creates new file
- `handleSaveFile()` - Saves current file
- `handleRunProgram()` - Saves, launches emulator, starts debugging
- `handleStep()` - Executes one instruction
- `handleMemoryDump()` - Queries memory range

## Emulator Communication Protocol

### Message Format

The emulator communicates via stdout using line-delimited JSON in IPC mode.

#### Step Response
```json
{
  "type": "step",
  "REGISTERS": {
    "PC": {"int": "1", "bits": "000000000001"},
    "AC": {"int": "0", "bits": "0000000000000000000000000000000000000000"},
    "MQ": {"int": "0", "bits": "0000000000000000000000000000000000000000"},
    "IR": {"int": "0", "bits": "00000000"},
    "MAR": {"int": "0", "bits": "000000000000"},
    "MBR": {
      "int": "0",
      "bits": "0000000000000000000000000000000000000000",
      "instr": "..."
    }
  }
}
```

#### Memory Dump Response
```json
{
  "type": "dump",
  "RAM": {
    "range": {"start": 1, "end": 10},
    "dump": [
      {
        "addr": "0001",
        "raw": "...",
        "signed": "...",
        "instr": "..."
      }
    ]
  }
}
```

#### Non-JSON Output
Programs using PRINT instruction output plain text (non-JSON lines).
These are captured and sent as `emulator:output` events.

### Emulator Commands

#### Execute One Instruction
```
step
```

#### Dump Memory Range
```
dump <start_address> <number_of_lines>
```

#### Exit Emulator
```
exit
```

## Architecture

### Component Hierarchy

```
App (main state container)
├── Header (file name, debug badge)
├── Toolbar (file and debug controls)
├── Editor (code editing)
└── Right Panel
    ├── DebuggerWindow (registers and memory)
    └── OutputConsole (program output)
```

### Data Flow

```
User Interaction
       ↓
React Event Handler (App.tsx)
       ↓
IPC Call (via window API)
       ↓
Electron Main Process
       ↓
Emulator Process or File System
       ↓
Stdout/Response (IPC events)
       ↓
React State Update
       ↓
UI Render
```

### Process Architecture

```
Electron Main Process (main.js)
├─ Dialog handlers (open, create files)
├─ File I/O operations
└─ Emulator subprocess management

Emulator Subprocess
├─ Reads .ias program file
├─ Executes in --debug IPC mode
└─ Outputs JSON via stdout

Renderer Process (React App)
├─ UI and user interaction
├─ IPC communication via preload
└─ State management
```

## Security Model

- Context Isolation: Enabled (preload bridge)
- Node Integration: Disabled
- Sandbox: Enabled for subprocesses
- IPC: Restricted to specific handlers
- File Access: Via native dialogs only

## Configuration

### Vite (vite.config.ts)
- React plugin enabled
- HMR configured for Electron development
- Dev server on localhost:5173

### TypeScript (tsconfig.json)
- ES2020 target
- React JSX support
- Strict mode enabled

### Electron (main.js)
- Emulator path: `../emulator/bin/linux/output`
- Development mode: Opens DevTools
- Production mode: Loads from dist/

## Development Notes

### Adding New Emulator Commands

1. Update emulator to support new command
2. Modify `emulator:command` handler in main.js if needed
3. Add command handler in debugIPC() in emulator
4. Update response format if returning data
5. Add React state and handler in App.tsx
6. Update UI component to display results

### File Format

IAS programs are plain text files with extension `.ias`:

```
// Load accumulator with value from address 100
LD 100
// Add value from address 101
AD 101
// Print result (custom extension)
PRINT 0
// Halt
HLT 0
```

## Troubleshooting

### Emulator Not Found
- Verify emulator binary exists at `../emulator/bin/linux/output`
- Rebuild emulator: `cd ../emulator && make`

### No File Selected Error
- Open or create a file using toolbar buttons before running

### Emulator Crashes
- Check output console for error messages
- Verify .ias file syntax is correct
- Check memory addresses are within valid range (0-4095)

### File Dialog Not Opening
- Ensure running as Electron app (not web version)
- Check file permissions in directory

## Future Enhancements

- Syntax highlighting for IAS assembly
- Breakpoint support with conditional breaks
- Program execution trace history
- Memory visualization and heatmaps
- Instruction profiler (execution count, timing)
- Batch file processing
- Assembly language reference panel
- Custom instruction extensions
