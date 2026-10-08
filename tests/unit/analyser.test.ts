import { describe, expect, test } from "vitest";
import { createWorkerAnalyser } from "@/features/auto-regions/analyser";
import type { WorkerReply, WorkerRequest } from "@/features/auto-regions/candidates.worker";
import { createRawImage } from "@/lib/image/raw-image";

/** a stand-in for a Web Worker that records what it is sent and answers when told to */
class FakeWorker {
  sent: { request: WorkerRequest; transfer: Transferable[] }[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<WorkerReply>) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  postMessage(request: WorkerRequest, transfer: Transferable[] = []) {
    this.sent.push({ request, transfer });
  }
  terminate() {
    this.terminated = true;
  }
  reply(r: WorkerReply) {
    this.onmessage?.({ data: r } as MessageEvent<WorkerReply>);
  }
}
const setup = () => {
  const workers: FakeWorker[] = [];
  const analyser = createWorkerAnalyser(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w as unknown as Worker;
  });
  return { analyser, workers };
};
const img = () => createRawImage(4, 3, [10, 20, 30, 255]);
const ok = (id: number, n = 1): WorkerReply => ({ id, ok: true, ms: 7, candidates: Array.from({ length: n }, (_, i) => ({ x: i, y: 0, width: 8, height: 8, pixels: 64 })) });

describe("createWorkerAnalyser", () => {
  test("the worker is started on the first request, once, and answers come back as results", async () => {
    const { analyser, workers } = setup();
    expect(workers).toHaveLength(0);
    const p = analyser.analyse(img());
    expect(workers).toHaveLength(1);
    workers[0].reply(ok(workers[0].sent[0].request.id, 2));
    await expect(p).resolves.toMatchObject({ ms: 7, candidates: [{ x: 0 }, { x: 1 }] });
    const q = analyser.analyse(img());
    expect(workers).toHaveLength(1);
    workers[0].reply(ok(workers[0].sent[1].request.id));
    await q;
  });

  test("the picture's pixels are sent as a copy: the editor's own picture is untouched and still usable", async () => {
    const { analyser, workers } = setup();
    const raw = img();
    const before = Array.from(raw.data);
    const p = analyser.analyse(raw);
    const { request, transfer } = workers[0].sent[0];
    expect(request).toMatchObject({ width: 4, height: 3 });
    expect(request.buffer.byteLength).toBe(4 * 3 * 4);
    expect(request.buffer).not.toBe(raw.data.buffer);
    expect(transfer).toEqual([request.buffer]);
    expect(Array.from(raw.data)).toEqual(before);
    expect(raw.data.byteLength).toBe(48); // not detached
    workers[0].reply(ok(request.id));
    await p;
  });

  test("the options go along with the request", async () => {
    const { analyser, workers } = setup();
    const p = analyser.analyse(img(), { tolerance: 9, minSide: 12 });
    expect(workers[0].sent[0].request.options).toEqual({ tolerance: 9, minSide: 12 });
    workers[0].reply(ok(workers[0].sent[0].request.id));
    await p;
  });

  test("a newer request replaces an older one that has not finished: the old one is rejected, and its late answer is ignored", async () => {
    const { analyser, workers } = setup();
    const first = analyser.analyse(img());
    const second = analyser.analyse(img());
    await expect(first).rejects.toThrow("superseded");
    const [a, b] = workers[0].sent.map((s) => s.request.id);
    workers[0].reply(ok(a, 5)); // the answer to the old one arrives late: nobody is waiting for it
    workers[0].reply(ok(b, 1));
    await expect(second).resolves.toMatchObject({ candidates: [{ x: 0 }] });
  });

  test("an error reply rejects with its message", async () => {
    const { analyser, workers } = setup();
    const p = analyser.analyse(img());
    workers[0].reply({ id: workers[0].sent[0].request.id, ok: false, error: "out of memory" });
    await expect(p).rejects.toThrow("out of memory");
  });

  test("a worker that cannot start rejects everything waiting, with its message", async () => {
    const { analyser, workers } = setup();
    const p = analyser.analyse(img());
    workers[0].onerror?.({ message: "script failed to load" });
    await expect(p).rejects.toThrow("script failed to load");
  });

  test("terminate cancels what is waiting, stops the worker, and the next request starts a fresh one", async () => {
    const { analyser, workers } = setup();
    const p = analyser.analyse(img());
    analyser.terminate();
    await expect(p).rejects.toThrow("cancelled");
    expect(workers[0].terminated).toBe(true);
    const q = analyser.analyse(img());
    expect(workers).toHaveLength(2);
    workers[1].reply(ok(workers[1].sent[0].request.id));
    await expect(q).resolves.toBeDefined();
  });

  test("terminate with nothing running is harmless", () => {
    const { analyser } = setup();
    expect(() => analyser.terminate()).not.toThrow();
  });
});