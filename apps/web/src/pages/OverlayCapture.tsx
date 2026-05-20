// Screenshot selection overlay. Rendered standalone (no Auth/router)
// when the page is opened with ?overlay=1 inside the transparent
// Electron overlay window. The user rubber-bands a region; we send it
// back in CSS pixels and main maps it to physical pixels to crop.

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { getDesktop } from "../lib/desktop";

interface Point {
  x: number;
  y: number;
}

export default function OverlayCapture() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const startRef = useRef<Point | null>(null);
  const [sel, setSel] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  // Receive the screenshot, paint it, and (re)draw on selection change.
  useEffect(() => {
    const desktop = getDesktop();
    if (!desktop) return;

    function draw() {
      const canvas = canvasRef.current;
      const img = imgRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      if (img) ctx.drawImage(img, 0, 0, W, H);

      // Dim everything, then punch the bright selection back in.
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.fillRect(0, 0, W, H);

      if (sel && sel.w > 0 && sel.h > 0 && img) {
        const rx = img.naturalWidth / W;
        const ry = img.naturalHeight / H;
        ctx.drawImage(
          img,
          sel.x * rx,
          sel.y * ry,
          sel.w * rx,
          sel.h * ry,
          sel.x,
          sel.y,
          sel.w,
          sel.h,
        );
        // Sapphire-Console accent — matches the rest of the UI.
        ctx.strokeStyle = "#60A5FA";
        ctx.lineWidth = 2;
        ctx.strokeRect(sel.x + 1, sel.y + 1, sel.w - 2, sel.h - 2);
      }
    }

    function resize() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      draw();
    }
    resize();

    const offBg = desktop.overlay.onBackground(({ dataUrl }) => {
      const img = new Image();
      img.onload = () => {
        imgRef.current = img;
        draw();
      };
      img.src = dataUrl;
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") desktop.overlay.cancel();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", resize);

    // `draw` closes over `sel`; re-run the effect when it changes.
    draw();

    return () => {
      offBg();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", resize);
    };
  }, [sel]);

  function toLocal(e: MouseEvent): Point {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) {
      getDesktop()?.overlay.cancel(); // right/middle click = cancel
      return;
    }
    startRef.current = toLocal(e);
    setSel({ x: startRef.current.x, y: startRef.current.y, w: 0, h: 0 });
  }

  function onMouseMove(e: MouseEvent) {
    const s = startRef.current;
    if (!s) return;
    const p = toLocal(e);
    setSel({
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x),
      h: Math.abs(p.y - s.y),
    });
  }

  function onMouseUp() {
    const s = sel;
    startRef.current = null;
    const desktop = getDesktop();
    if (!desktop) return;
    if (!s || s.w < 4 || s.h < 4) {
      desktop.overlay.cancel();
      return;
    }
    desktop.overlay.selectRegion(s);
  }

  return (
    <div className="fixed inset-0 select-none overflow-hidden">
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        className="block h-screen w-screen cursor-crosshair"
      />
      <div className="pointer-events-none fixed left-1/2 top-4 -translate-x-1/2 rounded-sm border border-white/20 bg-[#1E3A8A]/90 px-3 py-1.5 font-mono text-xs uppercase tracking-[0.12em] text-white">
        [ OCR ] · drag to select · esc to cancel
      </div>
    </div>
  );
}
