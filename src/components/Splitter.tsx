import React, { useRef } from "react";

type Orientation = "vertical" | "horizontal";

interface SplitterProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: Orientation;
  /** CSS selector for the container element used to compute percentages */
  containerSelector?: string;
  /** Called with new percent (0-100) when dragging */
  onResize?: (newPercent: number) => void;
  /** Return current percent when drag starts */
  getStartPct?: () => number;
  minPct?: number;
  maxPct?: number;
}

export default function Splitter({
  orientation = "vertical",
  containerSelector,
  onResize,
  getStartPct,
  minPct = 10,
  maxPct = 90,
  className = "",
  ...rest
}: SplitterProps) {
  const draggingRef = useRef(false);

  const baseClass = orientation === "vertical" ? "vertical-splitter" : "horizontal-splitter";

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!onResize || !containerSelector || !getStartPct) return;

    const container = document.querySelector(containerSelector) as HTMLElement | null;
    if (!container) return;

    draggingRef.current = true;
    const isVertical = orientation === "vertical";
    const rect = container.getBoundingClientRect();
    const startPct = getStartPct();

    const startPos = isVertical ? e.clientX : e.clientY;
    const size = isVertical ? rect.width : rect.height;
    const startPx = (startPct / 100) * size;

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const currPos = isVertical ? ev.clientX : ev.clientY;
      const delta = currPos - startPos;
      const newPx = startPx + delta;
      const newPct = Math.min(maxPct, Math.max(minPct, (newPx / size) * 100));
      onResize(newPct);
    };

    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "default";
    };

    document.body.style.cursor = isVertical ? "col-resize" : "row-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation === "vertical" ? "vertical" : "horizontal"}
      className={`${baseClass} ${className}`.trim()}
      onMouseDown={handleMouseDown}
      {...rest}
    />
  );
}
