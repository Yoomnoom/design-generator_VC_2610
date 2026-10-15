"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BubbleAnchor, bubbleRoom, placeBubble } from "@/features/assets/bubble";
import { GROUND_LIGHT, PreviewCache, PreviewOptions, groundFor, previewCache, renderBundle, shrinkToFit } from "@/features/assets/preview";
import { AssetBundle } from "@/features/assets/types";
import { canvasMeasureFor } from "@/lib/image/text-measure";
import { RawImage } from "@/lib/image/raw-image";

/* One preview picture: the bundle drawn by the export's own renderer (renderBundle), shrunk to fit, on a plain light grey that is only a
 * display aid (no checkerboard: it was noisy, and nothing is ever added to the pixels). It is drawn when it scrolls into view, one at a
 * time, so a long list never blocks the panel. The large preview is drawn again at its own size by the same renderer (not a stretched
 * thumbnail), in a card of its own that is placed beside the panel (see bubble.ts). */

/** a thumbnail canvas is at least this big (CSS px), so a thin line or underline stays a visible, centred mark */
const MIN_THUMB = 14;
const dprNow = () => (typeof window === "undefined" ? 1 : Math.max(1, window.devicePixelRatio || 1));
const bigCache = new PreviewCache(24);

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

/** puts `raw` in the middle of a canvas of at least minCss CSS px, one canvas pixel per device pixel; the canvas has no background */
function paint(canvas: HTMLCanvasElement, raw: RawImage, dpr: number, minCss = 0) {
  const cw = Math.max(raw.width, Math.ceil(minCss * dpr)), ch = Math.max(raw.height, Math.ceil(minCss * dpr));
  canvas.width = cw;
  canvas.height = ch;
  canvas.style.width = `${cw / dpr}px`;
  canvas.style.height = `${ch / dpr}px`;
  canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(raw.data), raw.width, raw.height), Math.floor((cw - raw.width) / 2), Math.floor((ch - raw.height) / 2));
}

type Props = {
  /** identifies the picture: a new key (an item changed) draws it again */
  cacheKey: string;
  build: () => Promise<AssetBundle | null> | AssetBundle | null;
  options?: PreviewOptions;
  width: number;
  height: number;
  /** longer side (CSS px) of the large preview shown on hover */
  bigSide?: number;
  label: string;
  testId?: string;
};

export default function AssetThumb({ cacheKey, build, options = {}, width, height, bigSide = 320, label, testId = "asset-thumb" }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const small = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"waiting" | "ready" | "none">("waiting");
  const [visible, setVisible] = useState(false);
  const [hover, setHover] = useState<BubbleAnchor | null>(null);
  const [ground, setGround] = useState(GROUND_LIGHT);

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
      const dpr = dprNow();
      paint(small.current, shrinkToFit(raw, width * dpr, height * dpr), dpr, MIN_THUMB);
      setGround(groundFor(raw));
      setState("ready");
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key says when the item changed
  }, [visible, cacheKey, width, height]);

  const open = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const panel = el.closest("aside")?.getBoundingClientRect(); // beside the panel when the card is in one, else beside the card itself
    setHover({ left: panel?.left ?? r.left, right: panel?.right ?? r.right, top: r.top });
  };

  return (
    <div
      ref={host}
      data-testid={testId}
      data-state={state}
      title={label}
      className="relative flex items-center justify-center overflow-hidden rounded border border-[var(--line)]"
      data-ground={ground} style={{ width, height, background: ground }}
      onMouseEnter={(e) => state === "ready" && open(e.currentTarget)}
      onMouseLeave={() => setHover(null)}
    >
      <canvas ref={small} aria-label={`${label} 미리보기`} className={state === "ready" ? "block" : "hidden"} />
      {state === "waiting" && <span className="text-[10px] text-[var(--muted)]">…</span>}
      {state === "none" && <span className="px-1 text-center text-[10px] leading-tight text-[var(--muted)]">미리보기 없음</span>}
      {hover && <BigPreview cacheKey={cacheKey} build={build} options={options} ground={ground} anchor={hover} side={bigSide} label={label} onClose={() => setHover(null)} />}
    </div>
  );
}

const TEXT_BLOCK = 40; // name line + size line under the picture
const PAD = 8;

/** the large preview, in a card of its own on the page (a portal: it is not a child of the list card, so it takes nothing from it: no
 *  clipping, no dimming of a disabled button), opaque, fully inside the window, closed as soon as the pointer leaves the thumbnail */
function BigPreview({ cacheKey, build, options, ground, anchor, side, label, onClose }: { cacheKey: string; build: Props["build"]; options: PreviewOptions; ground: string; anchor: BubbleAnchor; side: number; label: string; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [made, setMade] = useState<{ width: number; height: number; size: string } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number; side: string } | null>(null);

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("blur", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const raw = previewCache.get(cacheKey)?.value;
      if (!raw) return;
      const dpr = dprNow();
      const margin = options.margin ?? 4;
      const logical = options.frame ? { w: options.frame.width, h: options.frame.height } : { w: raw.width - 2 * margin, h: raw.height - 2 * margin };
      // the card always fits the window, and in a narrow one it is made smaller so that it fits beside the panel instead of lying over it
      const target = Math.max(60, Math.min(side, window.innerHeight - 2 * PAD - TEXT_BLOCK - 16, window.innerWidth / 2, bubbleRoom(anchor, { width: window.innerWidth }) - 2 * PAD)) * dpr;
      const k = Math.min(8, target / Math.max(raw.width, raw.height));
      let big: RawImage | null = null;
      if (k > 1.001) {
        // drawn again at the preview's own size with the same renderer, so it is sharp (a thumbnail stretched would be soft)
        const key = `${cacheKey}|${k.toFixed(3)}`;
        const hit = bigCache.get(key);
        if (hit) big = hit.value;
        else {
          try {
            const bundle = await build();
            big = bundle ? await later(() => renderBundle(bundle, { measure: canvasMeasureFor, ...options, scale: k })) : null;
          } catch {
            big = null;
          }
          bigCache.set(key, big);
        }
      } else big = shrinkToFit(raw, target, target);
      if (!live || !big || !canvas.current) return;
      paint(canvas.current, big, dpr);
      setMade({ width: big.width / dpr, height: big.height / dpr, size: `${logical.w}×${logical.h}` });
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drawn once per hover
  }, [cacheKey, side]);

  const cardW = made ? Math.max(made.width, Math.min(132, bubbleRoom(anchor, { width: typeof window === "undefined" ? 1280 : window.innerWidth }) - 2 * PAD)) + 2 * PAD : 0;
  const cardH = made ? made.height + 2 * PAD + TEXT_BLOCK : 0;
  useLayoutEffect(() => {
    if (!made) return;
    setPos(placeBubble(anchor, { width: cardW, height: cardH }, { width: window.innerWidth, height: window.innerHeight }));
  }, [made, anchor, cardW, cardH]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      data-testid="asset-big-preview"
      data-side={pos?.side}
      role="presentation"
      className="pointer-events-none fixed z-50 rounded-[10px] border border-[var(--line)] bg-white shadow-lg"
      style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, width: cardW || undefined, padding: PAD, visibility: pos ? "visible" : "hidden", opacity: 1 }}
    >
      <div className="grid place-items-center rounded" data-ground={ground} style={{ background: ground, minHeight: made?.height }}>
        <canvas ref={canvas} aria-label={`${label} 큰 미리보기`} className="block" />
      </div>
      <div className="mt-1.5 truncate text-xs font-bold text-[var(--text,#111)]">{label}</div>
      <div data-testid="asset-big-size" className="text-[11px] text-[var(--muted)]">{made?.size}</div>
    </div>,
    document.body,
  );
}