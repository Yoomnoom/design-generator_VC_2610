"use client";

import { useEffect, useRef } from "react";
import { Candidate } from "@/lib/image/candidates";
import { selectScreen } from "@/store/editor-store";
import { useEditorStore } from "@/store/use-editor-store";

const COLOR = "#ee6f43";
/** a candidate smaller than this on screen is not drawn (it would be a smudge); it can still be picked */
const MIN_DRAWN = 4;
/** at most this many dotted boxes are drawn, the largest first, so a very busy picture stays quick to paint */
const MAX_DRAWN = 1500;

/** The candidate boxes, as dotted outlines over the canvas, plus the one under the pointer and the one chosen. A canvas of its own with
 *  no pointer events: it is only a drawing, and what it shows is decided by the store. */
export default function CandidateOverlay() {
  const tool = useEditorStore((s) => s.activeTool);
  const compare = useEditorStore((s) => s.compareMode);
  const screen = useEditorStore(selectScreen);
  const view = useEditorStore((s) => s.view);
  const candidates = useEditorStore((s) => s.candidates);
  const hover = useEditorStore((s) => s.candidateHover);
  const pick = useEditorStore((s) => s.candidatePick);
  const ref = useRef<HTMLCanvasElement>(null);
  const drawn = useRef<Candidate[]>([]);

  const show = tool === "auto" && compare === "off" && !!screen && candidates?.imageId === screen.source.imageId;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const g = canvas.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (!show || !screen || !candidates) return;
      const at = (c: { x: number; y: number; width: number; height: number }) => ({
        x: Math.round(view.panX + (screen.x + c.x) * view.zoom) + 0.5,
        y: Math.round(view.panY + (screen.y + c.y) * view.zoom) + 0.5,
        w: Math.round(c.width * view.zoom),
        h: Math.round(c.height * view.zoom),
      });
      const visible = candidates.list
        .map((c) => ({ c, r: at(c) }))
        .filter(({ r }) => r.w >= MIN_DRAWN && r.h >= MIN_DRAWN && r.x < w && r.y < h && r.x + r.w > 0 && r.y + r.h > 0)
        .sort((a, b) => b.c.width * b.c.height - a.c.width * a.c.height)
        .slice(0, MAX_DRAWN);
      drawn.current = visible.map((v) => v.c);
      g.lineWidth = 1;
      g.setLineDash([4, 3]);
      g.strokeStyle = "rgba(238,111,67,0.7)";
      g.beginPath();
      for (const { r } of visible) g.rect(r.x, r.y, r.w, r.h);
      g.stroke();
      g.setLineDash([]);
      if (hover && !(pick && sameBox(hover, pick.rect))) {
        const r = at(hover);
        g.fillStyle = "rgba(238,111,67,0.10)";
        g.fillRect(r.x, r.y, r.w, r.h);
        g.strokeStyle = COLOR;
        g.lineWidth = 1;
        g.strokeRect(r.x, r.y, r.w, r.h);
      }
      if (pick) {
        const r = at(pick.rect);
        g.fillStyle = "rgba(238,111,67,0.18)";
        g.fillRect(r.x, r.y, r.w, r.h);
        g.strokeStyle = COLOR;
        g.lineWidth = 2;
        g.strokeRect(r.x, r.y, r.w, r.h);
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [show, screen, candidates, view, hover, pick]);

  return <canvas ref={ref} aria-hidden data-testid="candidate-overlay" data-drawn={show ? "yes" : "no"} className="pointer-events-none absolute inset-0 z-[5] h-full w-full" />;
}

const sameBox = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
