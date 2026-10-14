import { LayerWarp, Rect } from "@/lib/project/schema";
import { RawImage } from "@/lib/image/raw-image";
import { WarpPlacement, WarpRaster } from "@/lib/image/warp-raster";
import type { WarpReply, WarpRequest } from "./warp.worker";

/** One Web Worker, started on first use. A newer request makes an older unfinished one irrelevant: its answer is dropped. */
let worker: Worker | null = null;
let counter = 0;
let pending: { id: number; resolve: (r: WarpRaster | null) => void; reject: (e: Error) => void } | null = null;

export const warpWorkerAvailable = () => typeof Worker !== "undefined";

export function rasterizeWarpedAsync(image: RawImage, placement: WarpPlacement, warp: LayerWarp, clip?: Rect): Promise<WarpRaster | null> {
  if (!worker) {
    worker = new Worker(new URL("./warp.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WarpReply>) => {
      const reply = event.data;
      if (!pending || pending.id !== reply.id) return; // superseded
      const slot = pending;
      pending = null;
      if (!reply.ok) return slot.reject(new Error(reply.error));
      const r = reply.raster;
      slot.resolve(r ? { image: { width: r.width, height: r.height, data: new Uint8ClampedArray(r.buffer) }, x: r.x, y: r.y, step: r.step } : null);
    };
    worker.onerror = (e) => {
      pending?.reject(new Error(e.message || "warp worker failed"));
      pending = null;
    };
  }
  const id = ++counter;
  pending?.reject(new Error("superseded"));
  return new Promise((resolve, reject) => {
    pending = { id, resolve, reject };
    const buffer = image.data.slice().buffer; // copied: the editor goes on using the original
    worker!.postMessage({ id, width: image.width, height: image.height, buffer, placement, warp, clip } satisfies WarpRequest, [buffer]);
  });
}