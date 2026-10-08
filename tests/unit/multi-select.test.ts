import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NUDGE_MERGE_MS } from "@/store/editor-store";
import { committedId, solidPage, storeWith } from "./fixtures";

type Ctx = ReturnType<typeof storeWith>;
/** three layers on a plain 80 × 60 picture (no question about the background colour), listed back to front: a, b, c */
const three = () => {
  const ctx = storeWith(solidPage(80, 60));
  const a = committedId(ctx.get().beginExtraction({ x: 0, y: 0, width: 8, height: 8 }));
  const b = committedId(ctx.get().beginExtraction({ x: 20, y: 0, width: 8, height: 8 }));
  const c = committedId(ctx.get().beginExtraction({ x: 40, y: 0, width: 8, height: 8 }));
  return { ctx, a, b, c };
};
const pos = (ctx: Ctx, id: string) => {
  const t = ctx.get().snapshotProject()!.screens[0].layers.find((l) => l.id === id)!.transform;
  return [t.x, t.y];
};
const past = (ctx: Ctx) => ctx.get().history!.past.length;
const ids = (ctx: Ctx) => ctx.get().snapshotProject()!.screens[0].layers.map((l) => l.id);
const drag = (ctx: Ctx, id: string, x: number, y: number) => {
  ctx.get().previewLayerDrag(id, x, y);
  return ctx.get().commitLayerDrag();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(2_000_000);
});
afterEach(() => vi.useRealTimers());

describe("selection", () => {
  test("toggling adds a layer, in the order chosen, and takes it out again", () => {
    const { ctx, a, b, c } = three();
    ctx.get().selectLayer(c);
    ctx.get().toggleLayerSelection(a);
    ctx.get().toggleLayerSelection(b);
    expect(ctx.get().selectedLayerIds).toEqual([c, a, b]);
    ctx.get().toggleLayerSelection(a);
    expect(ctx.get().selectedLayerIds).toEqual([c, b]);
    ctx.get().toggleLayerSelection(c);
    ctx.get().toggleLayerSelection(b);
    expect(ctx.get().selectedLayerIds).toEqual([]);
  });
  test("an unknown layer is ignored; toggling takes a selected patch or memo out of the selection", () => {
    const { ctx, a } = three();
    ctx.get().toggleLayerSelection("nope");
    expect(ctx.get().selectedLayerIds).not.toContain("nope");
    const memo = ctx.get().addMemo(5, 5)!;
    expect(ctx.get().selectedMemoId).toBe(memo);
    ctx.get().toggleLayerSelection(a);
    expect(ctx.get().selectedMemoId).toBeNull();
  });
  test("select all takes every layer, back to front; with none it selects nothing", () => {
    const { ctx, a, b, c } = three();
    ctx.get().selectAllLayers();
    expect(ctx.get().selectedLayerIds).toEqual([a, b, c]);
    expect(storeWith().get().selectedLayerIds).toEqual([]);
    const empty = storeWith();
    empty.get().selectAllLayers();
    expect(empty.get().selectedLayerIds).toEqual([]);
  });
  test("selecting a layer by itself drops the rest", () => {
    const { ctx, a, b } = three();
    ctx.get().selectAllLayers();
    ctx.get().selectLayer(b);
    expect(ctx.get().selectedLayerIds).toEqual([b]);
    expect(a).not.toBe(b);
  });
  test("undoing the creation of a selected layer takes it out of the selection", () => {
    const { ctx, a, b, c } = three();
    ctx.get().selectAllLayers();
    ctx.get().undo(); // c is gone
    expect(ctx.get().selectedLayerIds).toEqual([a, b]);
    expect(ids(ctx)).not.toContain(c);
  });
  test("selecting does not touch the history", () => {
    const { ctx, a, b } = three();
    const before = past(ctx);
    ctx.get().toggleLayerSelection(a);
    ctx.get().toggleLayerSelection(b);
    ctx.get().selectAllLayers();
    expect(past(ctx)).toBe(before);
  });
});

describe("dragging a selection", () => {
  test("dragging one selected layer moves all the selected ones by the same distance, as one undo step", () => {
    const { ctx, a, b, c } = three();
    ctx.get().selectLayer(a);
    ctx.get().toggleLayerSelection(b);
    const before = past(ctx);
    const [ax, ay] = pos(ctx, a);
    const [bx, by] = pos(ctx, b);
    const [cx, cy] = pos(ctx, c);
    expect(drag(ctx, a, ax + 7, ay + 4)).toBe(true);
    expect(pos(ctx, a)).toEqual([ax + 7, ay + 4]);
    expect(pos(ctx, b)).toEqual([bx + 7, by + 4]);
    expect(pos(ctx, c)).toEqual([cx, cy]); // not selected: stays
    expect(past(ctx)).toBe(before + 1);
    expect(ctx.get().selectedLayerIds).toEqual([a, b]); // the selection is kept
    ctx.get().undo();
    expect([pos(ctx, a), pos(ctx, b), pos(ctx, c)]).toEqual([[ax, ay], [bx, by], [cx, cy]]);
  });
  test("dragging a layer that is not selected moves only it, and the selection becomes that layer", () => {
    const { ctx, a, b, c } = three();
    ctx.get().selectLayer(a);
    ctx.get().toggleLayerSelection(b);
    const [ax, ay] = pos(ctx, a);
    const [cx, cy] = pos(ctx, c);
    drag(ctx, c, cx + 5, cy + 5);
    expect(pos(ctx, a)).toEqual([ax, ay]);
    expect(pos(ctx, c)).toEqual([cx + 5, cy + 5]);
    expect(ctx.get().selectedLayerIds).toEqual([c]);
  });
  test("a locked layer in the selection stays where it is; the others move", () => {
    const { ctx, a, b } = three();
    ctx.get().selectLayer(a);
    ctx.get().toggleLayerSelection(b);
    ctx.get().setLayerLocked(b, true);
    const [ax, ay] = pos(ctx, a);
    const [bx, by] = pos(ctx, b);
    drag(ctx, a, ax + 3, ay + 3);
    expect(pos(ctx, a)).toEqual([ax + 3, ay + 3]);
    expect(pos(ctx, b)).toEqual([bx, by]);
  });
  test("a locked layer cannot be the one dragged: nothing moves", () => {
    const { ctx, a, b } = three();
    ctx.get().selectLayer(a);
    ctx.get().toggleLayerSelection(b);
    ctx.get().setLayerLocked(a, true);
    const before = past(ctx);
    const pb = pos(ctx, b);
    expect(drag(ctx, a, 30, 30)).toBe(false);
    expect(pos(ctx, b)).toEqual(pb);
    expect(past(ctx)).toBe(before);
  });
  test("a click without movement records nothing", () => {
    const { ctx, a, b } = three();
    ctx.get().selectLayer(a);
    ctx.get().toggleLayerSelection(b);
    const before = past(ctx);
    const [ax, ay] = pos(ctx, a);
    expect(drag(ctx, a, ax, ay)).toBe(false);
    expect(past(ctx)).toBe(before);
  });
  test("the others follow by the dragged layer's own distance, however far", () => {
    const { ctx, a, b } = three();
    ctx.get().selectLayer(a);
    ctx.get().toggleLayerSelection(b);
    const [ax, ay] = pos(ctx, a);
    const [bx, by] = pos(ctx, b);
    drag(ctx, a, ax + 30, ay + 25);
    expect(pos(ctx, b)).toEqual([bx + 30, by + 25]);
  });
  test("nothing moves while comparing", () => {
    const { ctx, a, b } = three();
    ctx.get().selectLayer(a);
    ctx.get().toggleLayerSelection(b);
    const pa = pos(ctx, a);
    ctx.get().setCompareMode("split");
    expect(drag(ctx, a, 50, 50)).toBe(false);
    expect(pos(ctx, a)).toEqual(pa);
  });
  test("the drag preview and the guides are gone after the drop and after a cancel", () => {
    const { ctx, a } = three();
    ctx.get().setSnapGuides([{ x1: 1, y1: 1, x2: 1, y2: 9, kind: "align" }]);
    ctx.get().previewLayerDrag(a, 10, 10);
    ctx.get().commitLayerDrag();
    expect(ctx.get().dragPreview).toBeNull();
    expect(ctx.get().snapGuides).toEqual([]);
    ctx.get().setSnapGuides([{ x1: 1, y1: 1, x2: 1, y2: 9, kind: "align" }]);
    ctx.get().previewLayerDrag(a, 12, 12);
    ctx.get().cancelLayerDrag();
    expect(ctx.get().dragPreview).toBeNull();
    expect(ctx.get().snapGuides).toEqual([]);
  });
  test("the history holds only coordinates", () => {
    const { ctx, a, b } = three();
    ctx.get().selectLayer(a);
    ctx.get().toggleLayerSelection(b);
    drag(ctx, a, 20, 20);
    expect(JSON.stringify(ctx.get().history!.past.at(-1)).length).toBeLessThan(3000);
  });
});

describe("moving a selection with the keys", () => {
  test("moves every selected layer, one step; a burst of presses is still one step", () => {
    const { ctx, a, b, c } = three();
    ctx.get().selectLayer(a);
    ctx.get().toggleLayerSelection(b);
    const before = past(ctx);
    const [ax, ay] = pos(ctx, a);
    const [bx] = pos(ctx, b);
    const [cx] = pos(ctx, c);
    for (let i = 0; i < 4; i++) ctx.get().nudgeLayers([a, b], 10, 0);
    expect(pos(ctx, a)).toEqual([ax + 40, ay]);
    expect(pos(ctx, b)[0]).toBe(bx + 40);
    expect(pos(ctx, c)[0]).toBe(cx);
    expect(past(ctx)).toBe(before + 1);
    ctx.get().undo();
    expect(pos(ctx, a)).toEqual([ax, ay]);
    expect(pos(ctx, b)[0]).toBe(bx);
  });
  test("a locked layer stays; when all are locked nothing moves and no step is made", () => {
    const { ctx, a, b } = three();
    ctx.get().setLayerLocked(b, true);
    const [bx] = pos(ctx, b);
    const [ax] = pos(ctx, a);
    expect(ctx.get().nudgeLayers([a, b], 1, 0)).toBe(true);
    expect(pos(ctx, a)[0]).toBe(ax + 1);
    expect(pos(ctx, b)[0]).toBe(bx);
    ctx.get().setLayerLocked(a, true);
    const before = past(ctx);
    expect(ctx.get().nudgeLayers([a, b], 1, 0)).toBe(false);
    expect(past(ctx)).toBe(before);
  });
  test("presses on a different set of layers are a new step, and so is a pause", () => {
    const { ctx, a, b } = three();
    const before = past(ctx);
    ctx.get().nudgeLayers([a, b], 1, 0);
    ctx.get().nudgeLayers([a], 1, 0);
    expect(past(ctx)).toBe(before + 2);
    vi.advanceTimersByTime(NUDGE_MERGE_MS + 1);
    ctx.get().nudgeLayers([a], 1, 0);
    expect(past(ctx)).toBe(before + 3);
  });
  test("the order the ids are given in does not matter for folding", () => {
    const { ctx, a, b } = three();
    const before = past(ctx);
    ctx.get().nudgeLayers([a, b], 1, 0);
    ctx.get().nudgeLayers([b, a], 1, 0);
    expect(past(ctx)).toBe(before + 1);
  });
  test("unknown ids are ignored; no ids, no distance and a bad distance do nothing; comparing blocks it", () => {
    const { ctx, a } = three();
    expect(ctx.get().nudgeLayers([], 1, 0)).toBe(false);
    expect(ctx.get().nudgeLayers(["nope"], 1, 0)).toBe(false);
    expect(ctx.get().nudgeLayers([a], 0, 0)).toBe(false);
    expect(ctx.get().nudgeLayers([a], Number.NaN, 0)).toBe(false);
    const pa = pos(ctx, a);
    ctx.get().setCompareMode("original");
    expect(ctx.get().nudgeLayers([a], 1, 0)).toBe(false);
    expect(pos(ctx, a)).toEqual(pa);
  });
  test("the single-layer call still works the same", () => {
    const { ctx, a } = three();
    const [ax, ay] = pos(ctx, a);
    expect(ctx.get().nudgeLayer(a, 2, 3)).toBe(true);
    expect(pos(ctx, a)).toEqual([ax + 2, ay + 3]);
    expect(ctx.get().selectedLayerIds).toEqual([a]);
  });
});

describe("deleting a selection", () => {
  test("deletes every selected layer in one undo step; undo brings them all back in their old order", () => {
    const { ctx, a, b, c } = three();
    ctx.get().selectLayer(a);
    ctx.get().toggleLayerSelection(c);
    const before = past(ctx);
    expect(ctx.get().deleteSelectedLayers()).toBe(2);
    expect(ids(ctx)).toEqual([b]);
    expect(past(ctx)).toBe(before + 1);
    expect(ctx.get().selectedLayerIds).toEqual([]);
    ctx.get().undo();
    expect(ids(ctx)).toEqual([a, b, c]);
  });
  test("a locked layer is kept, with a notice, and stays selected", () => {
    const { ctx, a, b } = three();
    ctx.get().selectLayer(a);
    ctx.get().toggleLayerSelection(b);
    ctx.get().setLayerLocked(b, true);
    expect(ctx.get().deleteSelectedLayers()).toBe(1);
    expect(ids(ctx)).toContain(b);
    expect(ids(ctx)).not.toContain(a);
    expect(ctx.get().selectedLayerIds).toEqual([b]);
    expect(ctx.get().notice).toMatch(/잠긴 레이어 1개/);
  });
  test("when all are locked nothing is deleted and no step is made", () => {
    const { ctx, a } = three();
    ctx.get().selectLayer(a);
    ctx.get().setLayerLocked(a, true);
    const before = past(ctx);
    expect(ctx.get().deleteSelectedLayers()).toBe(0);
    expect(past(ctx)).toBe(before);
    expect(ctx.get().notice).toMatch(/잠긴/);
  });
  test("with nothing selected, or while comparing, nothing happens", () => {
    const { ctx, a } = three();
    ctx.get().selectLayer(null);
    expect(ctx.get().deleteSelectedLayers()).toBe(0);
    ctx.get().selectLayer(a);
    ctx.get().setCompareMode("split");
    expect(ctx.get().deleteSelectedLayers()).toBe(0);
    expect(ids(ctx)).toContain(a);
  });
  test("one layer selected: the same as the single delete (one step, called as before)", () => {
    const { ctx, a } = three();
    ctx.get().selectLayer(a);
    expect(ctx.get().deleteSelectedLayers()).toBe(1);
    expect(ctx.get().history!.past.at(-1)).toBeDefined();
  });
});

describe("snap settings", () => {
  test("snapping is on by default, can be switched off and on, and switching off clears the guides", () => {
    const ctx = storeWith();
    expect(ctx.get().snapEnabled).toBe(true);
    ctx.get().setSnapGuides([{ x1: 0, y1: 0, x2: 0, y2: 5, kind: "gap", label: "8" }]);
    ctx.get().setSnapEnabled(false);
    expect(ctx.get().snapEnabled).toBe(false);
    expect(ctx.get().snapGuides).toEqual([]);
    ctx.get().setSnapEnabled(true);
    expect(ctx.get().snapEnabled).toBe(true);
  });
  test("opening another picture clears the guides, and the snap switch is kept", () => {
    const ctx = storeWith();
    ctx.get().setSnapEnabled(false);
    ctx.get().setSnapGuides([{ x1: 0, y1: 0, x2: 0, y2: 5, kind: "align" }]);
    ctx.get().loadProject(ctx.get().snapshotProject()!, ctx.get().images);
    expect(ctx.get().snapGuides).toEqual([]);
    expect(ctx.get().snapEnabled).toBe(false);
  });
});
