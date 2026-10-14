import { describe, expect, test } from "vitest";
import { assetRect, assetText } from "@/features/assets/builtin";
import { renderProjectRaw } from "@/features/export-image/export-png";
import { Rasterize } from "@/lib/image/vector-raster";
import { getPixel, setPixel, solid } from "./helpers";
import { storeWith } from "./fixtures";

/** a stand-in for the canvas: a vector layer is a solid block of its own size, coloured by its fill */
const raster: Rasterize = (content, t, frame) => {
  const fill = (content as { fill?: string | null }).fill ?? "#000000";
  const c = [parseInt(fill.slice(1, 3), 16), parseInt(fill.slice(3, 5), 16), parseInt(fill.slice(5, 7), 16)] as const;
  const x = Math.round(t.x), y = Math.round(t.y);
  const w = Math.ceil(content.width), h = Math.ceil(content.height);
  const x0 = Math.max(x, 0), y0 = Math.max(y, 0), x1 = Math.min(x + w, frame.width), y1 = Math.min(y + h, frame.height);
  if (x1 <= x0 || y1 <= y0) return null;
  return { image: solid(x1 - x0, y1 - y0, [c[0], c[1], c[2], 255]), x: x0, y: y0 };
};
const page = () => storeWith(solid(300, 200, [240, 240, 240, 255]), "capture.png", { rasterize: raster });
type Ctx = ReturnType<typeof page>;
const sc = (c: Ctx) => c.get().history!.present.screens[0];
const L = (c: Ctx, id: string) => sc(c).layers.find((l) => l.id === id)!;
const rect = (c: Ctx, x: number, y: number, w: number, h: number, fill = "#ff0000") => c.get().addVectorLayer(assetRect("r", 0, 0, w, h, { fill }).content!, x, y)!;
const png = (c: Ctx) => renderProjectRaw(c.get().snapshotProject()!, c.get().images, raster);

describe("rasterize", () => {
  test("a shape becomes a bitmap with the same look in the PNG; same id and place in the stack; one undo step", () => {
    const c = page();
    const a = rect(c, 20, 30, 40, 20, "#336699");
    const b = rect(c, 100, 30, 10, 10, "#00ff00");
    const before = png(c);
    const z = L(c, a).zIndex;
    const past = c.get().history!.past.length;
    expect(c.get().rasterizeLayer(a)).toBe(true);
    expect(c.get().history!.past).toHaveLength(past + 1);
    const l = L(c, a);
    expect(l.content).toBeUndefined();
    expect(l.imageId).toBeTruthy();
    expect(l.zIndex).toBe(z);
    expect(l.transform).toMatchObject({ x: 20, y: 30, scaleX: 1, scaleY: 1, rotation: 0 });
    expect(Buffer.from(png(c).data).equals(Buffer.from(before.data))).toBe(true);
    expect(L(c, b).content).toBeTruthy(); // the other one is untouched
    c.get().undo();
    expect(L(c, a).content).toBeTruthy();
    expect(L(c, a).imageId).toBeUndefined();
  });

  test("effects are baked in: the result shows the shadow and the layer has no effects any more", () => {
    const c = page();
    const a = rect(c, 50, 50, 20, 20, "#ff0000");
    c.get().setLayerEffects(a, { shadow: { on: true, color: "#0000ff", dx: 15, dy: 0, blur: 0, opacity: 1 } });
    const before = png(c);
    expect(getPixel(before, 80, 60)).toEqual([0, 0, 255, 255]);
    c.get().rasterizeLayer(a);
    expect(L(c, a).effects).toBeUndefined();
    const after = png(c);
    expect(Buffer.from(after.data).equals(Buffer.from(before.data))).toBe(true);
    const raw = c.get().images.get(L(c, a).imageId!)!.raw;
    expect(raw.width).toBeGreaterThan(20); // it is bigger than the shape: the shadow is part of it
  });

  test("opacity and blend stay on the layer (they are not baked twice); a bitmap without effects, a locked layer, comparing are refused", () => {
    const c = page();
    const a = rect(c, 50, 50, 20, 20);
    c.get().setLayerOpacity(a, 0.5);
    c.get().setLayerBlend(a, "multiply");
    const before = png(c);
    c.get().rasterizeLayer(a);
    expect(L(c, a)).toMatchObject({ opacity: 0.5, blend: "multiply" });
    expect(Buffer.from(png(c).data).equals(Buffer.from(before.data))).toBe(true);
    expect(c.get().rasterizeLayer(a)).toBe(false); // already a bitmap
    expect(c.get().notice).toContain("이미 이미지");
    const b = rect(c, 5, 5, 10, 10);
    c.get().setLayerLocked(b, true);
    expect(c.get().rasterizeLayer(b)).toBe(false);
    c.get().setLayerLocked(b, false);
    c.get().setCompareMode("original");
    expect(c.get().rasterizeLayer(b)).toBe(false);
  });

  test("a layer wholly outside the page cannot be rasterized; a layer partly outside keeps the part on the page", () => {
    const c = page();
    const out = rect(c, 400, 400, 20, 20);
    expect(c.get().rasterizeLayer(out)).toBe(false);
    const half = rect(c, 290, 190, 40, 40);
    expect(c.get().rasterizeLayer(half)).toBe(true);
    const raw = c.get().images.get(L(c, half).imageId!)!.raw;
    expect([raw.width, raw.height]).toEqual([10, 10]);
    const left = rect(c, -10, 5, 40, 20);
    expect(c.get().rasterizeLayer(left)).toBe(true);
    expect(L(c, left).transform.x).toBe(0);
    expect(c.get().images.get(L(c, left).imageId!)!.raw.width).toBe(30);
  });
});

describe("merge", () => {
  test("merging two layers gives one bitmap with the same PNG, at the front one's place in the stack, selected; one undo step", () => {
    const c = page();
    const a = rect(c, 20, 30, 40, 20, "#ff0000");
    const mid = rect(c, 200, 100, 10, 10, "#ffff00");
    const b = rect(c, 40, 40, 40, 20, "#0000ff");
    const before = png(c);
    c.store.setState({ selectedLayerIds: [a, b] });
    const past = c.get().history!.past.length;
    expect(c.get().mergeSelected()).toBe(2);
    expect(c.get().history!.past).toHaveLength(past + 1);
    const layers = sc(c).layers;
    expect(layers).toHaveLength(2);
    expect(Buffer.from(png(c).data).equals(Buffer.from(before.data))).toBe(true);
    const merged = layers.find((l) => l.id !== mid)!;
    expect(merged.imageId).toBeTruthy();
    expect(merged.zIndex).toBeGreaterThan(L(c, mid).zIndex); // the front-most merged layer was above the middle one
    expect(c.get().selectedLayerIds).toEqual([merged.id]);
    expect(merged.name).toContain("병합");
    c.get().undo();
    expect(sc(c).layers).toHaveLength(3);
    expect(Buffer.from(png(c).data).equals(Buffer.from(before.data))).toBe(true);
  });

  test("the layers' own opacity, blend and effects are applied inside the merge, so the result looks the same", () => {
    const c = page();
    const a = rect(c, 20, 30, 40, 20, "#ff0000");
    const b = rect(c, 30, 35, 40, 20, "#0000ff");
    c.get().setLayerOpacity(b, 0.5);
    c.get().setLayerEffects(a, { shadow: { on: true, color: "#000000", dx: 10, dy: 10, blur: 0, opacity: 1 } });
    const before = png(c);
    c.store.setState({ selectedLayerIds: [a, b] });
    c.get().mergeSelected();
    expect(Buffer.from(png(c).data).equals(Buffer.from(before.data))).toBe(true);
  });

  test("merge down joins the selected layer with the visible one right below it, skipping a hidden one", () => {
    const c = page();
    const a = rect(c, 20, 30, 40, 20, "#ff0000");
    const hidden = rect(c, 25, 35, 40, 20, "#00ff00");
    const top = rect(c, 30, 40, 40, 20, "#0000ff");
    c.get().setLayerVisible(hidden, false);
    const before = png(c);
    c.get().selectLayer(top);
    expect(c.get().mergeDown()).toBe(2);
    expect(sc(c).layers.map((l) => l.id)).toContain(hidden); // the hidden layer stayed
    expect(sc(c).layers).toHaveLength(2);
    expect(Buffer.from(png(c).data).equals(Buffer.from(before.data))).toBe(true);
    expect(sc(c).layers.some((l) => l.id === a)).toBe(false);
  });

  test("merge down with nothing below, or with several selected, says so; merge all joins every visible unlocked layer", () => {
    const c = page();
    const a = rect(c, 20, 30, 40, 20);
    c.get().selectLayer(a);
    expect(c.get().mergeDown()).toBe(0);
    expect(c.get().notice).toContain("아래에");
    const b = rect(c, 100, 30, 40, 20, "#00ff00");
    const d = rect(c, 150, 100, 20, 20, "#0000ff");
    c.get().setLayerLocked(d, true);
    c.store.setState({ selectedLayerIds: [a, b] });
    expect(c.get().mergeDown()).toBe(0);
    expect(c.get().notice).toContain("하나만");
    const before = png(c);
    expect(c.get().mergeAll()).toBe(2); // the locked one stays
    expect(sc(c).layers).toHaveLength(2);
    expect(L(c, d).locked).toBe(true);
    expect(Buffer.from(png(c).data).equals(Buffer.from(before.data))).toBe(true);
  });

  test("locked layers, one layer only, comparing: refused with a reason; nothing changes", () => {
    const c = page();
    const a = rect(c, 20, 30, 40, 20);
    const b = rect(c, 60, 30, 40, 20);
    c.get().setLayerLocked(a, true);
    c.store.setState({ selectedLayerIds: [a, b] });
    const history = c.get().history;
    expect(c.get().mergeSelected()).toBe(0);
    expect(c.get().notice).toContain("잠긴");
    c.get().setLayerLocked(a, false);
    c.store.setState({ selectedLayerIds: [a] });
    expect(c.get().mergeSelected()).toBe(0);
    c.store.setState({ selectedLayerIds: [a, b] });
    c.get().setCompareMode("original");
    const h2 = c.get().history;
    expect(c.get().mergeSelected()).toBe(0);
    expect(c.get().history).toBe(h2);
    expect(history).toBeTruthy();
  });

  test("a bitmap and text merge with the shapes; a group left with fewer than two layers dissolves; the result saves", () => {
    const c = page();
    const bm = c.get().addImageLayer({ raw: solid(30, 30, [255, 0, 255, 255]), name: "bm" })!;
    const t = c.get().addVectorLayer(assetText("t", 0, 0, 60, "hi", 14, "#000000").content!, 100, 100)!;
    const r1 = rect(c, 150, 20, 20, 20);
    const r2 = rect(c, 180, 20, 20, 20);
    c.store.setState({ selectedLayerIds: [r1, r2] });
    c.get().groupSelected();
    const before = png(c);
    c.store.setState({ selectedLayerIds: [bm, t, r1] });
    expect(c.get().mergeSelected()).toBe(3);
    expect(sc(c).groups).toBeUndefined(); // r2 was alone in the group after r1 left it
    expect(L(c, r2).groupId).toBeUndefined();
    expect(Buffer.from(png(c).data).equals(Buffer.from(before.data))).toBe(true);
    expect(JSON.parse(JSON.stringify(c.get().snapshotProject())).screens[0].layers.every((l: { imageId?: string; content?: unknown }) => l.imageId || l.content)).toBe(true);
    expect(getPixel(png(c), 110, 105)[3]).toBe(255);
    expect(setPixel).toBeTruthy();
  });
});