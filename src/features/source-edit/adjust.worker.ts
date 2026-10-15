/// <reference lib="webworker" />
import { adjustedPicture } from "@/lib/image/adjust";
import { LayerAdjust } from "@/lib/project/schema";

/* Runs adjustedPicture (the function the layers' adjustments and the PNG use) off the page's thread: the original can be 4000 pixels wide
 * and a blur takes seconds, which would freeze the editor. The same function means the same bytes. */

export type AdjustRequest = { id: number; width: number; height: number; buffer: ArrayBuffer; adjust: LayerAdjust };
export type AdjustReply = { id: number; ok: true; width: number; height: number; buffer: ArrayBuffer; ms: number } | { id: number; ok: false; error: string };

self.onmessage = (event: MessageEvent<AdjustRequest>) => {
  const { id, width, height, buffer, adjust } = event.data;
  try {
    const t0 = performance.now();
    const out = adjustedPicture({ width, height, data: new Uint8ClampedArray(buffer) }, adjust);
    // when nothing is to be done the input itself comes back: send a copy so the transfer below owns its buffer
    const data = out.data.buffer === buffer ? out.data.slice() : out.data;
    const reply: AdjustReply = { id, ok: true, width: out.width, height: out.height, buffer: data.buffer as ArrayBuffer, ms: Math.round(performance.now() - t0) };
    (self as unknown as Worker).postMessage(reply, [reply.buffer]);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: e instanceof Error ? e.message : "adjust failed" } satisfies AdjustReply);
  }
};
