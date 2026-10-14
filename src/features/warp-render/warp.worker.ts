/// <reference lib="webworker" />
import { LayerWarp, Rect } from "@/lib/project/schema";
import { WarpPlacement, rasterizeWarped } from "@/lib/image/warp-raster";

/* Runs rasterizeWarped (the same function the PNG export uses) off the page's thread, so a big warped layer does not freeze the editor. */

export type WarpRequest = { id: number; width: number; height: number; buffer: ArrayBuffer; placement: WarpPlacement; warp: LayerWarp; clip?: Rect };
export type WarpReply =
  | { id: number; ok: true; raster: { width: number; height: number; buffer: ArrayBuffer; x: number; y: number; step: number } | null; ms: number }
  | { id: number; ok: false; error: string };

self.onmessage = (event: MessageEvent<WarpRequest>) => {
  const { id, width, height, buffer, placement, warp, clip } = event.data;
  try {
    const t0 = performance.now();
    const r = rasterizeWarped({ width, height, data: new Uint8ClampedArray(buffer) }, placement, warp, { clip });
    const ms = Math.round(performance.now() - t0);
    if (!r) {
      (self as unknown as Worker).postMessage({ id, ok: true, raster: null, ms } satisfies WarpReply);
      return;
    }
    const out = r.image.data.buffer as ArrayBuffer;
    (self as unknown as Worker).postMessage({ id, ok: true, raster: { width: r.image.width, height: r.image.height, buffer: out, x: r.x, y: r.y, step: r.step }, ms } satisfies WarpReply, [out]);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: e instanceof Error ? e.message : "warp failed" } satisfies WarpReply);
  }
};