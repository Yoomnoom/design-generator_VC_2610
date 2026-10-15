import { adjustedPicture } from "@/lib/image/adjust";
import { RawImage } from "@/lib/image/raw-image";
import { LayerAdjust } from "@/lib/project/schema";
import type { AdjustReply, AdjustRequest } from "./adjust.worker";

/** The original picture with the adjustments baked in, made in a Web Worker (the same adjustedPicture as everywhere else), so a big
 *  picture does not freeze the editor. Without Workers (tests, old browsers) it is made on the spot. `ms` is the time in the worker. */
let worker: Worker | null = null;
let counter = 0;
const waiting = new Map<number, { resolve: (r: { image: RawImage; ms: number }) => void; reject: (e: Error) => void }>();

export const adjustWorkerAvailable = () => typeof Worker !== "undefined";

export function adjustPictureAsync(image: RawImage, adjust: LayerAdjust): Promise<{ image: RawImage; ms: number }> {
  if (!adjustWorkerAvailable()) {
    const t0 = Date.now();
    return Promise.resolve({ image: adjustedPicture(image, adjust), ms: Date.now() - t0 });
  }
  if (!worker) {
    worker = new Worker(new URL("./adjust.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<AdjustReply>) => {
      const reply = event.data;
      const slot = waiting.get(reply.id);
      if (!slot) return;
      waiting.delete(reply.id);
      if (!reply.ok) return slot.reject(new Error(reply.error));
      slot.resolve({ image: { width: reply.width, height: reply.height, data: new Uint8ClampedArray(reply.buffer) }, ms: reply.ms });
    };
    worker.onerror = (e) => {
      for (const slot of waiting.values()) slot.reject(new Error(e.message || "adjust worker failed"));
      waiting.clear();
    };
  }
  const id = ++counter;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    const buffer = image.data.slice().buffer; // copied: the editor goes on using the picture
    worker!.postMessage({ id, width: image.width, height: image.height, buffer, adjust } satisfies AdjustRequest, [buffer]);
  });
}
