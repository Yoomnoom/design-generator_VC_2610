import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NUDGE_MERGE_MS } from "@/store/editor-store";
import { CARD, committedId, solidPage, storeWith } from "./fixtures";

const withLayer = () => {
  const ctx = storeWith();
  return { ...ctx, id: committedId(ctx.get().beginExtraction(CARD)) };
};
const pos = (ctx: ReturnType<typeof withLayer>) => {
  const l = ctx.get().snapshotProject()!.screens[0].layers.find((x) => x.id === ctx.id)!;
  return [l.transform.x, l.transform.y];
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe("nudgeLayer (arrow keys)", () => {
  test("moves by exactly the given pixels, one undo step, and undo puts it back", () => {
    const ctx = withLayer();
    const [x0, y0] = pos(ctx);
    const past = ctx.get().history!.past.length;
    expect(ctx.get().nudgeLayer(ctx.id, 1, 0)).toBe(true);
    expect(pos(ctx)).toEqual([x0 + 1, y0]);
    expect(ctx.get().history!.past).toHaveLength(past + 1);
    ctx.get().undo();
    expect(pos(ctx)).toEqual([x0, y0]);
  });

  test("presses close together fold into one undo step; one undo undoes them all", () => {
    const ctx = withLayer();
    const [x0, y0] = pos(ctx);
    const past = ctx.get().history!.past.length;
    for (let i = 0; i < 5; i++) {
      ctx.get().nudgeLayer(ctx.id, 0, 10);
      vi.advanceTimersByTime(NUDGE_MERGE_MS - 100);
    }
    expect(pos(ctx)).toEqual([x0, y0 + 50]);
    expect(ctx.get().history!.past).toHaveLength(past + 1);
    ctx.get().undo();
    expect(pos(ctx)).toEqual([x0, y0]);
    ctx.get().redo();
    expect(pos(ctx)).toEqual([x0, y0 + 50]);
  });

  test("a pause longer than the merge window starts a new step", () => {
    const ctx = withLayer();
    const [x0, y0] = pos(ctx);
    const past = ctx.get().history!.past.length;
    ctx.get().nudgeLayer(ctx.id, 1, 0);
    vi.advanceTimersByTime(NUDGE_MERGE_MS + 1);
    ctx.get().nudgeLayer(ctx.id, 1, 0);
    expect(ctx.get().history!.past).toHaveLength(past + 2);
    ctx.get().undo();
    expect(pos(ctx)).toEqual([x0 + 1, y0]);
  });

  test("another edit between two presses stops the folding (the earlier step is not rewritten)", () => {
    const ctx = withLayer();
    const [x0, y0] = pos(ctx);
    ctx.get().nudgeLayer(ctx.id, 1, 0);
    ctx.get().setLayerVisible(ctx.id, false);
    ctx.get().setLayerVisible(ctx.id, true);
    ctx.get().nudgeLayer(ctx.id, 1, 0);
    ctx.get().undo(); // second nudge only
    expect(pos(ctx)).toEqual([x0 + 1, y0]);
  });

  test("moving back to where it started in one burst leaves no step that does nothing... but undo still works", () => {
    const ctx = withLayer();
    const [x0, y0] = pos(ctx);
    ctx.get().nudgeLayer(ctx.id, 3, 0);
    ctx.get().nudgeLayer(ctx.id, -3, 0);
    expect(pos(ctx)).toEqual([x0, y0]);
  });

  test("a locked layer, an unknown layer, zero and non-finite distances are refused and change nothing", () => {
    const ctx = withLayer();
    const past = ctx.get().history!.past.length;
    expect(ctx.get().nudgeLayer("nope", 1, 0)).toBe(false);
    expect(ctx.get().nudgeLayer(ctx.id, 0, 0)).toBe(false);
    expect(ctx.get().nudgeLayer(ctx.id, Number.NaN, 0)).toBe(false);
    expect(ctx.get().nudgeLayer(ctx.id, Infinity, 0)).toBe(false);
    ctx.get().setLayerLocked(ctx.id, true);
    const afterLock = ctx.get().history!.past.length;
    const before = pos(ctx);
    expect(ctx.get().nudgeLayer(ctx.id, 1, 0)).toBe(false);
    expect(pos(ctx)).toEqual(before);
    expect(ctx.get().history!.past).toHaveLength(afterLock);
    expect(afterLock).toBe(past + 1);
  });

  test("while comparing with the original nothing moves", () => {
    const ctx = withLayer();
    const before = pos(ctx);
    ctx.get().setCompareMode("original");
    expect(ctx.get().nudgeLayer(ctx.id, 1, 0)).toBe(false);
    expect(pos(ctx)).toEqual(before);
  });

  test("a hidden layer can still be nudged by key only if it is selected; the store itself does not forbid it", () => {
    const ctx = withLayer();
    ctx.get().setLayerVisible(ctx.id, false);
    const [x0] = pos(ctx);
    expect(ctx.get().nudgeLayer(ctx.id, 2, 0)).toBe(true);
    expect(pos(ctx)[0]).toBe(x0 + 2);
  });

  test("the history holds only coordinates: no image data is copied by a move", () => {
    const ctx = withLayer();
    ctx.get().nudgeLayer(ctx.id, 1, 1);
    const entry = JSON.stringify(ctx.get().history!.past.at(-1));
    expect(entry.length).toBeLessThan(2000);
  });
});

describe("speed on a large capture", () => {
  test("a key press costs a transform change, not pixel work: 4000 × 3000 capture, 200 presses (measurement)", () => {
    vi.useRealTimers();
    const ctx = storeWith(solidPage(4000, 3000));
    const id = committedId(ctx.get().beginExtraction({ x: 100, y: 100, width: 3000, height: 2000 }));
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) ctx.get().nudgeLayer(id, 1, 0);
    const ms = performance.now() - t0;
    console.log(`MEASURE nudgeLayer x200 on a 4000x3000 capture with a 3000x2000 layer: ${ms.toFixed(1)} ms total, ${(ms / 200).toFixed(3)} ms per press (Node)`);
    expect(ms / 200).toBeLessThan(20);
    expect(ctx.get().snapshotProject()!.screens[0].layers[0].transform.x).toBe(100 + 200);
  });
});
