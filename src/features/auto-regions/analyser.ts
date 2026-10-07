import { Candidate, CandidateOptions } from "@/lib/image/candidates";
import { RawImage } from "@/lib/image/raw-image";
import type { WorkerReply, WorkerRequest } from "./candidates.worker";

export type Analysis = { candidates: Candidate[]; ms: number };

/** Something that can analyse a picture, somewhere other than the page's own thread. The real one is a Web Worker; tests use their own. */
export type Analyser = { analyse(raw: RawImage, options?: CandidateOptions): Promise<Analysis>; terminate(): void };

/** A single Web Worker, started on first use. A newer request makes an older one that has not finished irrelevant: its answer is dropped. */
export function createWorkerAnalyser(makeWorker: () => Worker = () => new Worker(new URL("./candidates.worker.ts", import.meta.url), { type: "module" })): Analyser {
  let worker: Worker | null = null;
  let counter = 0;
  const waiting = new Map<number, { resolve: (a: Analysis) => void; reject: (e: Error) => void }>();

  const start = () => {
    const w = makeWorker();
    w.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      const slot = waiting.get(reply.id);
      if (!slot) return; // superseded or cancelled
      waiting.delete(reply.id);
      if (reply.ok) slot.resolve({ candidates: reply.candidates, ms: reply.ms });
      else slot.reject(new Error(reply.error));
    };
    w.onerror = (event) => {
      const error = new Error(event.message || "분석 작업을 시작하지 못했습니다");
      for (const [, slot] of waiting) slot.reject(error);
      waiting.clear();
    };
    return w;
  };

  return {
    analyse(raw, options) {
      worker ??= start();
      const id = ++counter;
      for (const [oldId, slot] of waiting) {
        waiting.delete(oldId);
        slot.reject(new Error("superseded")); // a newer request replaces it
      }
      return new Promise<Analysis>((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        // the pixels are copied, not handed over: the editor goes on using the original
        const buffer = raw.data.slice().buffer;
        worker!.postMessage({ id, width: raw.width, height: raw.height, buffer, options } satisfies WorkerRequest, [buffer]);
      });
    },
    terminate() {
      worker?.terminate();
      worker = null;
      for (const [, slot] of waiting) slot.reject(new Error("cancelled"));
      waiting.clear();
    },
  };
}
