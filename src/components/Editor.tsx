import { useEffect, useMemo, useRef, memo } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import "./Editor.css";

interface EditorProps {
  isRunning: boolean;
  code: string;
  hasFile: boolean;
  onCodeChange: (code: string) => void;
}

function Editor({ isRunning, code, onCodeChange, hasFile }: EditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const suppressChangeRef = useRef(false);
  const readOnlyCompartmentRef = useRef(new Compartment());

  // Initialize CodeMirror editor
  useEffect(() => {
    if (!containerRef.current || viewRef.current) return;

    const state = EditorState.create({
      doc: code,
      extensions: [
        lineNumbers({
          formatNumber: (lineNo) => String(lineNo - 1).padStart(4, "0"), // 0-indexed line numbers
        }),
        oneDark,
        readOnlyCompartmentRef.current.of(EditorState.readOnly.of(isRunning || !hasFile)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            suppressChangeRef.current = true;
            onCodeChange(update.state.doc.toString());
            suppressChangeRef.current = false;
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Update read-only state and sync code when props change
  useEffect(() => {
    if (!viewRef.current) return;
    const view = viewRef.current;
    
    // Update read-only state using compartment
    const readOnly = isRunning || !hasFile;
    view.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });

    // Sync code if changed externally
    if (!suppressChangeRef.current && view.state.doc.toString() !== code) {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: code,
        },
      });
    }
  }, [isRunning, hasFile, code]);

  const lines = useMemo(() => code.split("\n").length, [code]);

  return (
    <div className="editor-container">
      <div className="editor-body" ref={containerRef} />
      <div className="editor-info">
        <small>Lines: {lines}</small>
        <small>Characters: {code.length}</small>
      </div>
    </div>
  );
}

export default memo(Editor);

