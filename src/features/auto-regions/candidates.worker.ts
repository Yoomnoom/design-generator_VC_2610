/// <reference lib="webworker" />
import { CandidateOptions, findCandidates } from "@/lib/image/candidates";

/* Runs findCandidates off the page's thread, so the editor stays responsive however large the capture is. */

export type WorkerRequest = { id: number; width: number; height: number; buffer: ArrayBuffer; options?: CandidateOptions };
export type WorkerReply = { id: number; ok: true; candidates: ReturnType<typeof findCandidates>; ms: number } | { id: number; ok: false; error: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, width, height, buffer, options } = event.data;
  try {
    const t0 = performance.now();
    const candidates = findCandidates({ width, height, data: new Uint8ClampedArray(buffer) }, options);
    (self as unknown as Worker).postMessage({ id, ok: true, candidates, ms: Math.round(performance.now() - t0) } satisfies WorkerReply);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: e instanceof Error ? e.message : "분석에 실패했습니다" } satisfies WorkerReply);
  }
};
