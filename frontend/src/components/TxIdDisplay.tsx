'use client';

import { useLayoutEffect, useRef, useState, useMemo, useCallback } from "react";

type TxIdDisplayProps = {
  txid: string;
  className?: string;
  forceFull?: boolean;
};

// Singleton canvas for text measurements
let measureCanvas: HTMLCanvasElement | null = null;
let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!measureCanvas) {
    measureCanvas = document.createElement("canvas");
    measureCtx = measureCanvas.getContext("2d");
  }
  return measureCtx;
}

// Cache character widths per font to avoid repeated measurements
const charWidthCache = new Map<string, number>();

export function TxIdDisplay({ txid, className, forceFull = false }: TxIdDisplayProps) {
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const [truncation, setTruncation] = useState<{ left: number; right: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  const measureTextWidth = useCallback((text: string, font: string): number => {
    const ctx = getMeasureContext();
    if (!ctx) return text.length * 8; // fallback estimate
    ctx.font = font;
    return ctx.measureText(text).width;
  }, []);

  const updateLayout = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const styles = window.getComputedStyle(el);
    const font = `${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
    const containerWidth = el.clientWidth;

    // Get cached char width or measure it
    let charWidth = charWidthCache.get(font);
    if (!charWidth) {
      charWidth = measureTextWidth("0", font) || 8;
      charWidthCache.set(font, charWidth);
    }

    const fullWidth = txid.length * charWidth;

    if (fullWidth <= containerWidth) {
      setTruncation(null);
      return;
    }

    const dotsWidth = measureTextWidth("..", font);
    const available = Math.max(0, containerWidth - dotsWidth);
    const charsTotal = Math.floor(available / charWidth);
    const leftChars = Math.ceil(charsTotal / 2);
    const rightChars = charsTotal - leftChars;

    setTruncation({ left: Math.max(0, leftChars), right: Math.max(0, rightChars) });
  }, [txid, measureTextWidth]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Cancel any pending RAF
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    // Single RAF for initial layout
    rafRef.current = requestAnimationFrame(updateLayout);

    // Use ResizeObserver for resize handling
    const observer = new ResizeObserver(() => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(updateLayout);
    });
    observer.observe(el);

    // Handle font loading
    document.fonts?.ready.then(updateLayout);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      observer.disconnect();
    };
  }, [txid, updateLayout]);

  const displayContent = useMemo(() => {
    if (forceFull || !truncation) {
      return (
        <span
          className={`block ${
            forceFull ? "whitespace-normal break-all" : "whitespace-nowrap overflow-hidden text-clip"
          }`}
        >
          {txid}
        </span>
      );
    }

    return (
      <span className="flex items-center min-w-0 w-full overflow-hidden">
        <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-clip">
          {truncation.left > 0 ? txid.slice(0, truncation.left) : ""}
        </span>
        <span className="shrink-0">..</span>
        <span
          className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-clip text-right"
          style={{ direction: "rtl", unicodeBidi: "plaintext" }}
        >
          {truncation.right > 0 ? txid.slice(-truncation.right) : ""}
        </span>
      </span>
    );
  }, [txid, forceFull, truncation]);

  return (
    <span
      ref={containerRef}
      className={`block w-full min-w-0 overflow-hidden ${className ?? ""}`}
    >
      {displayContent}
    </span>
  );
}
