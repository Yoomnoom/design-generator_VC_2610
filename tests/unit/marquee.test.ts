import { describe, expect, test } from "vitest";
import { assetRect } from "@/features/assets/builtin";
import { layerBox } from "@/features/snap/layer-box";
import { MARQUEE_MIN_SCREEN_DRAG, boxFromPoints, combineSelection, marqueeHits, reaches } from "@/features/marquee/marquee";
import { clientToImage, imageToClient } from "@/lib/geometry/coords";
import { solid } from "./helpers";
import { storeWith } from "./fixtures";

const page = () => storeWith(solid(600, 400, [240, 240, 240, 255]));
function scene() {
  const ctx = page();
  const add = (x: number, y: number, w: number, h: number) => ctx.get().addVectorLayer(assetRect("r", 0, 0, w, h, { fill: "#112233" }).content!, x, y)!;
  const a = add(20, 20, 100, 60); // 20..120 × 20..80
  const b = add(200, 20, 100, 60); // 200..300
  const c = add(20, 200, 100, 60); // 20..120 × 200..260
  return { ctx, a, b, c };
}
const layersOf = (ctx: ReturnType<typeof page>) => ctx.get().history!.present.screens[0].layers;
const hits = (ctx: ReturnType<typeof page>, box: { x: number; y: number; width: number; height: number }, mode: "touch" | "contain" = "touch", whole = true) =>
  marqueeHits(layersOf(ctx), (l) => layerBox(l, l.imageId ? ctx.get().images.get(l.imageId)?.raw : undefined), box, mode, whole);

describe("touch and contain", () => {
  test("touch: sharing any point selects, including just an edge; contain: only layers completely inside", () => {
    const box = { x: 0, y: 0, width: 100, height: 50 }; // cuts layer a (20..120 × 20..80)
    expect(reaches({ x: 20, y: 20, width: 100, height: 60 }, box, "touch")).toBe(true);
    expect(reaches({ x: 20, y: 20, width: 100, height: 60 }, box, "contain")).toBe(false);
    expect(reaches({ x: 100, y: 0, width: 10, height: 10 }, box, "touch")).toBe(true); // an edge touches
    expect(reaches({ x: 101, y: 0, width: 10, height: 10 }, box, "touch")).toBe(false);
    expect(reaches({ x: 10, y: 10, width: 90, height: 40 }, box, "contain")).toBe(true);
    expect(reaches({ x: 10, y: 10, width: 91, height: 40 }, box, "contain")).toBe(false);
    expect(reaches({ x: 10, y: 10, width: 20, height: 20 }, { x: 11, y: 0, width: 100, height: 50 }, "contain")).toBe(false); // one pixel outside on the left
  });

  test("a box over the empty page and the original picture selects nothing; the box can be dragged from any corner", () => {
    const { ctx, a, b } = scene();
    expect(hits(ctx, boxFromPoints({ x: 400, y: 300 }, { x: 500, y: 380 }))).toEqual([]);
    expect(hits(ctx, boxFromPoints({ x: 130, y: 90 }, { x: 0, y: 0 }))).toEqual([a]); // from the bottom-right up to the top-left
    expect(new Set(hits(ctx, boxFromPoints({ x: 0, y: 0 }, { x: 320, y: 100 })))).toEqual(new Set([a, b]));
    expect(boxFromPoints({ x: 9, y: 9 }, { x: 3, y: 5 })).toEqual({ x: 3, y: 5, width: 6, height: 4 });
  });

  test("hidden layers are never selected; locked layers are (selecting is not editing: they still do not move)", () => {
    const { ctx, a, b } = scene();
    ctx.get().setLayerVisible(a, false);
    ctx.get().setLayerLocked(b, true);
    const all = hits(ctx, { x: 0, y: 0, width: 400, height: 100 });
    expect(all).toEqual([b]);
    ctx.store.setState({ selectedLayerIds: all });
    const x = layersOf(ctx).find((l) => l.id === b)!.transform.x;
    ctx.get().nudgeLayers(all, 10, 0);
    expect(layersOf(ctx).find((l) => l.id === b)!.transform.x).toBe(x); // locked: stays
  });

  test("a layer of a group brings the whole group; Ctrl (whole = false) only the layers the box reaches", () => {
    const { ctx, a, b, c } = scene();
    ctx.store.setState({ selectedLayerIds: [a, c] });
    ctx.get().groupSelected();
    const box = { x: 0, y: 0, width: 130, height: 100 }; // reaches a only
    expect(new Set(hits(ctx, box))).toEqual(new Set([a, c]));
    expect(hits(ctx, box, "touch", false)).toEqual([a]);
    expect(hits(ctx, { x: 0, y: 0, width: 130, height: 100 }, "contain")).toEqual(expect.arrayContaining([a, c]));
    expect(b).toBeTruthy();
  });

  test("a turned layer is judged by the box around its real outline", () => {
    const ctx = page();
    const id = ctx.get().addVectorLayer(assetRect("bar", 0, 0, 200, 20, { fill: "#000" }).content!, 100, 100)!;
    const t = layersOf(ctx)[0].transform;
    ctx.get().transformLayer(id, { ...t, rotation: 90 }); // the bar now stands (turned about its top-left corner): 20 wide, 200 tall, x 80..100, y 100..300
    const box = layerBox(layersOf(ctx)[0], undefined)!;
    expect(Math.round(box.width)).toBe(20);
    expect(Math.round(box.height)).toBe(200);
    expect(hits(ctx, { x: 85, y: 290, width: 10, height: 20 })).toEqual([id]); // the lower end of the standing bar: not where the flat one was
    expect(hits(ctx, { x: 290, y: 100, width: 5, height: 5 })).toEqual([]); // where its flat outline would have reached
  });
});

describe("combining with the selection", () => {
  test("plain replaces, Shift adds, Ctrl toggles", () => {
    expect(combineSelection(["a", "b"], ["c"], "replace")).toEqual(["c"]);
    expect(combineSelection(["a", "b"], ["b", "c"], "add")).toEqual(["a", "b", "c"]);
    expect(combineSelection(["a", "b"], ["b", "c"], "toggle")).toEqual(["a", "c"]);
    expect(combineSelection([], [], "replace")).toEqual([]);
  });
});

describe("the same box at any zoom, pan or devicePixelRatio", () => {
  test("the hits come from image pixels, so the screen pixels that produced the box do not matter", () => {
    const { ctx, a, b } = scene();
    const target = { a: { x: 150, y: 10 }, b: { x: 250, y: 90 } }; // reaches b only
    const origin = { x: 330, y: 54 };
    for (const view of [{ zoom: 1, panX: 40, panY: 30 }, { zoom: 2, panX: -120, panY: 10 }, { zoom: 0.5, panX: 200, panY: 90 }, { zoom: 2, panX: 0, panY: 0 }]) {
      const ca = imageToClient(target.a, origin, view, { x: 0, y: 0 });
      const cb = imageToClient(target.b, origin, view, { x: 0, y: 0 });
      const ia = clientToImage(ca, origin, view, { x: 0, y: 0 });
      const ib = clientToImage(cb, origin, view, { x: 0, y: 0 });
      expect(hits(ctx, boxFromPoints(ia, ib)), JSON.stringify(view)).toEqual([b]);
    }
    expect(a).toBeTruthy();
    expect(MARQUEE_MIN_SCREEN_DRAG).toBeGreaterThan(0);
  });
});

describe("setLayerSelection", () => {
  test("sets exactly those layers, drops unknown ids, and the selection is not history", () => {
    const { ctx, a, b } = scene();
    const before = ctx.get().history;
    ctx.get().setLayerSelection([b, "nope", b, a]);
    expect(ctx.get().selectedLayerIds).toEqual([b, a]);
    expect(ctx.get().history).toBe(before);
    ctx.get().setLayerSelection([]);
    expect(ctx.get().selectedLayerIds).toEqual([]);
  });
});