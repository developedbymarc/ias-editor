import { useEffect, useRef, useMemo, useState } from "react";

interface VirtualizedOutputProps {
  lines: string[];
  scrollEndRef: React.RefObject<HTMLDivElement | null>;
}

const LINE_HEIGHT = 20; // pixels
const BUFFER_SIZE = 5; // extra lines above/below viewport

function VirtualizedOutput({ lines, scrollEndRef }: VirtualizedOutputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const scrollTop = container.scrollTop;
      const containerHeight = container.clientHeight;

      const start = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - BUFFER_SIZE);
      const end = Math.min(
        lines.length,
        Math.ceil((scrollTop + containerHeight) / LINE_HEIGHT) + BUFFER_SIZE
      );

      setVisibleRange({ start, end });
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [lines.length]);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [lines.length, scrollEndRef]);

  const visibleLines = useMemo(
    () => lines.slice(visibleRange.start, visibleRange.end),
    [lines, visibleRange]
  );

  const offsetTop = visibleRange.start * LINE_HEIGHT;

  return (
    <div
      ref={containerRef}
      style={{
        height: "100%",
        overflowY: "auto",
        position: "relative",
        fontFamily: "monospace",
        fontSize: "13px",
        lineHeight: `${LINE_HEIGHT}px`,
      }}
    >
      {/* Spacer for lines above visible range */}
      <div style={{ height: offsetTop }} />

      {/* Visible lines */}
      {visibleLines.map((line, idx) => (
        <div
          key={visibleRange.start + idx}
          style={{ height: LINE_HEIGHT }}
          dangerouslySetInnerHTML={{ __html: line }}
        />
      ))}

      {/* Spacer for lines below visible range */}
      <div style={{ height: (lines.length - visibleRange.end) * LINE_HEIGHT }} />

      {/* Auto-scroll anchor */}
      <div ref={scrollEndRef} />
    </div>
  );
}

export default VirtualizedOutput;
