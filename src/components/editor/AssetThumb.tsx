"use client";

import { useEffect, useRef, useState } from "react";
import { PreviewOptions, previewCache, renderBundle, shrinkToFit } from "@/features/assets/preview";
import { AssetBundle } from "@/features/assets/types";
import { canvasMeasureFor } from "@/lib/image/text-measure";
import { RawImage } from "@/lib/image/raw-image";

/* One preview picture: the bundle drawn by the export's own renderer (renderBundle), shrunk to fit, on a checkerboard that is only a
 * display aid. It is drawn when it scrolls into view, one at a time, so a long list never blocks the panel. */

let queue: Promise<void> = Promise.resolve();
/** runs jobs one after another, each in its own task, so the page keeps painting between them */
const later = <T,>(job: () => T): Promise<T> => {
  const run = queue.then(() => new Promise<T>((resolve, reject) => setTimeout(() => { try { resolve(job()); } catch (e) { reject(e); } }, 0)));
  queue = run.then(() => undefined, () => undefined);
  return run;
};

/** the full-size preview of an item, drawn once per key */
async function previewOf(key: string, build: () => Promise<AssetBundle | null> | AssetBundle | null, options: PreviewOptions): Promise<RawImage | null> {
  const hit = previewCache.get(key);
  if (hit) return hit.value;
  let raw: RawImage | null = null;
  try {
    const bundle = await build();
    raw = bundle ? await later(() => renderBundle(bundle, { measure: canvasMeasureFor, ...options })) : null;
  } catch {
    raw = null; // a damaged saved source gets the "no preview" mark; it never breaks the list
  }
  previewCache.set(key, raw);
  return raw;
}

function paint(canvas: HTMLCanvasElement, raw: RawImage) {
  canvas.width = raw.width;
  canvas.height = raw.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const tile = 6;
  for (let y = 0; y < raw.height; y += tile) for (let x = 0; x < raw.width; x += tile) {
    ctx.fillStyle = ((x / tile + y / tile) & 1) === 0 ? "#ffffff" : "#e5e7eb";
    ctx.fillRect(x, y, tile, tile);
  }
  const layer = document.createElement("canvas");
  layer.width = raw.width;
  layer.height = raw.height;
  layer.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(raw.data), raw.width, raw.height), 0, 0);
  ctx.drawImage(layer, 0, 0);
}

type Props = {
  /** identifies the picture: a new key (an item changed) draws it again */
  cacheKey: string;
  build: () => Promise<AssetBundle | null> | AssetBundle | null;
  options?: PreviewOptions;
  width: number;
  height: number;
  /** size of the larger preview shown on hover */
  bigSide?: number;
  label: string;
  testId?: string;
};

export default function AssetThumb({ cacheKey, build, options = {}, width, height, bigSide = 280, label, testId = "asset-thumb" }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const small = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"waiting" | "ready" | "none">("waiting");
  const [visible, setVisible] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || typeof IntersectionObserver === "undefined") return setVisible(true);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "80px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    setState("waiting");
    void previewOf(cacheKey, build, options).then(async (raw) => {
      if (!live) return;
      if (!raw || !small.current) return setState("none");
      paint(small.current, shrinkToFit(raw, width, height));
      setState("ready");
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key says when the item changed
  }, [visible, cacheKey, width, height]);

  return (
    <div
      ref={host}
      data-testid={testId}
      data-state={state}
      title={label}
      className="relative flex items-center justify-center overflow-hidden rounded border border-[var(--line)] bg-[#f3f4f6]"
      style={{ width, height }}
      onMouseEnter={(e) => state === "ready" && setHover({ x: e.currentTarget.getBoundingClientRect().right + 8, y: e.currentTarget.getBoundingClientRect().top })}
      onMouseLeave={() => setHover(null)}
    >
      <canvas ref={small} aria-label={`${label} 미리보기`} className={state === "ready" ? "block max-h-full max-w-full" : "hidden"} />
      {state === "waiting" && <span className="text-[10px] text-[var(--muted)]">…</span>}
      {state === "none" && <span className="px-1 text-center text-[10px] leading-tight text-[var(--muted)]">미리보기 없음</span>}
      {hover && <BigPreview cacheKey={cacheKey} at={hover} side={bigSide} label={label} />}
    </div>
  );
}

/** the larger preview next to the card: the same cached full-size picture, shrunk less */
function BigPreview({ cacheKey, at, side, label }: { cacheKey: string; at: { x: number; y: number }; side: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const raw = previewCache.get(cacheKey)?.value;
    if (!raw || !ref.current) return;
    paint(ref.current, shrinkToFit(raw, side, side));
    // a small source is shown larger (up to 4x) so the hover preview is worth looking at
    const k = Math.min(4, side / raw.width, side / raw.height);
    ref.current.style.width = k > 1 ? `${Math.round(raw.width * k)}px` : "";
  }, [cacheKey, side]);
  const top = Math.max(8, Math.min(at.y, (typeof window === "undefined" ? 800 : window.innerHeight) - side - 48));
  return (
    <div data-testid="asset-big-preview" role="presentation" className="pointer-events-none fixed z-50 rounded border border-[var(--line)] bg-white p-1.5 shadow-lg" style={{ left: at.x, top }}>
      <canvas ref={ref} aria-label={`${label} 큰 미리보기`} className="block" />
      <div className="mt-1 max-w-[280px] truncate text-[11px] text-[var(--muted)]">{label}</div>
    </div>
  );
}
