import fs from "node:fs";
import { describe, expect, test } from "vitest";
import { renderProjectRaw } from "@/features/export-image/export-png";
import { parseProjectFile } from "@/features/project-persistence/project-file";
import { NO_ADJUST, adjustedPicture, applyAdjustments, hasAdjust } from "@/lib/image/adjust";
import { createRawImage } from "@/lib/image/raw-image";
import { adjustError, parseProject, serializeProject } from "@/lib/project/parse";
import { LayerAdjust } from "@/lib/project/schema";
import { getPixel, setPixel, solid } from "./helpers";
import { storeWith } from "./fixtures";

const adj = (o: Partial<LayerAdjust>): LayerAdjust => ({ ...NO_ADJUST, ...o });

describe("nothing to do", () => {
  test("all zero is no adjustment: the same picture object comes back", () => {
    const img = solid(4, 4, [10, 20, 30, 40]);
    expect(hasAdjust(undefined)).toBe(false);
    expect(hasAdjust(NO_ADJUST)).toBe(false);
    expect(applyAdjustments(img, undefined)).toBe(img);
    expect(applyAdjustments(img, NO_ADJUST)).toBe(img);
    expect(adjustedPicture(img, NO_ADJUST)).toBe(img);
  });
});

describe("colour", () => {
  test("brightness adds to every channel (clamped) and leaves alpha", () => {
    const out = applyAdjustments(solid(2, 2, [100, 150, 250, 200]), adj({ brightness: 20 }));
    expect(getPixel(out, 0, 0)).toEqual([151, 201, 255, 200]); // + 51, the top clamped
    expect(getPixel(applyAdjustments(solid(1, 1, [30, 30, 30, 255]), adj({ brightness: -50 })), 0, 0)).toEqual([0, 0, 0, 255]);
  });
  test("contrast pushes values away from mid grey (and toward it when negative)", () => {
    const hi = applyAdjustments(solid(1, 1, [200, 100, 128, 255]), adj({ contrast: 50 }));
    expect(getPixel(hi, 0, 0)[0]).toBeGreaterThan(200);
    expect(getPixel(hi, 0, 0)[1]).toBeLessThan(100);
    expect(getPixel(hi, 0, 0)[2]).toBe(128);
    const lo = applyAdjustments(solid(1, 1, [200, 100, 128, 255]), adj({ contrast: -50 }));
    expect(getPixel(lo, 0, 0)[0]).toBeLessThan(200);
    expect(getPixel(lo, 0, 0)[1]).toBeGreaterThan(100);
  });
  test("saturation -100 is grey (equal channels), +100 moves the channels apart; grey stays grey", () => {
    const grey = getPixel(applyAdjustments(solid(1, 1, [200, 60, 30, 255]), adj({ saturation: -100 })), 0, 0);
    expect(grey[0]).toBe(grey[1]);
    expect(grey[1]).toBe(grey[2]);
    const more = getPixel(applyAdjustments(solid(1, 1, [200, 100, 100, 255]), adj({ saturation: 100 })), 0, 0);
    expect(more[0] - more[1]).toBeGreaterThan(100);
    expect(getPixel(applyAdjustments(solid(1, 1, [90, 90, 90, 255]), adj({ saturation: 80 })), 0, 0)).toEqual([90, 90, 90, 255]);
  });
  test("hue turns the colour about the grey axis: red at 120° becomes green, at 240° blue; 0 and 360 are the same; grey is untouched", () => {
    const red = solid(1, 1, [255, 0, 0, 255]);
    const g = getPixel(applyAdjustments(red, adj({ hue: 120 })), 0, 0);
    expect(g[1]).toBeGreaterThan(g[0]);
    expect(g[1]).toBeGreaterThan(g[2]);
    const b = getPixel(applyAdjustments(red, adj({ hue: -120 })), 0, 0);
    expect(b[2]).toBeGreaterThan(b[0]);
    expect(getPixel(applyAdjustments(solid(1, 1, [70, 70, 70, 255]), adj({ hue: 90 })), 0, 0)).toEqual([70, 70, 70, 255]);
  });
  test("the original is never changed", () => {
    const img = solid(3, 3, [100, 100, 100, 255]);
    const copy = Buffer.from(img.data);
    applyAdjustments(img, adj({ brightness: 40, blur: 5, sharpen: 30, hue: 50 }));
    expect(Buffer.from(img.data).equals(copy)).toBe(true);
  });
});

describe("blur and sharpen", () => {
  const edge = () => {
    const r = createRawImage(40, 20, [255, 255, 255, 255]);
    for (let y = 0; y < 20; y++) for (let x = 20; x < 40; x++) setPixel(r, x, y, [0, 0, 0, 255]);
    return r;
  };
  test("blur softens an edge (values between the two sides), keeps the average and leaves a flat area alone", () => {
    const out = applyAdjustments(edge(), adj({ blur: 6 }));
    const mid = getPixel(out, 20, 10)[0];
    expect(mid).toBeGreaterThan(40);
    expect(mid).toBeLessThan(215);
    expect(getPixel(out, 2, 10)).toEqual([255, 255, 255, 255]);
    expect(getPixel(applyAdjustments(solid(10, 10, [50, 60, 70, 255]), adj({ blur: 8 })), 5, 5)).toEqual([50, 60, 70, 255]);
  });
  test("a more blur is a softer edge", () => {
    const a = getPixel(applyAdjustments(edge(), adj({ blur: 3 })), 17, 10)[0];
    const b = getPixel(applyAdjustments(edge(), adj({ blur: 12 })), 17, 10)[0];
    expect(a).toBeGreaterThan(200);
    expect(b).toBeLessThan(a);
  });
  test("blur does not darken a transparent edge: invisible pixels carrying a colour do not leak in", () => {
    const r = createRawImage(40, 20, [0, 255, 0, 0]);
    for (let y = 0; y < 20; y++) for (let x = 10; x < 30; x++) setPixel(r, x, y, [255, 0, 0, 255]);
    const out = applyAdjustments(r, adj({ blur: 6 }));
    let semi = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      const a = out.data[i + 3];
      if (a > 10 && a < 245) { semi++; expect(Math.abs(out.data[i] - 255)).toBeLessThanOrEqual(2); expect(out.data[i + 1]).toBeLessThanOrEqual(2); }
    }
    expect(semi).toBeGreaterThan(5);
  });
  test("sharpen has a strength (more is a stronger overshoot) and does not touch alpha", () => {
    const e = edge();
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) setPixel(e, x, y, [180, 180, 180, 120]);
    for (let y = 0; y < 20; y++) for (let x = 20; x < 40; x++) setPixel(e, x, y, [60, 60, 60, 120]);
    const weak = applyAdjustments(e, adj({ sharpen: 20 })), strong = applyAdjustments(e, adj({ sharpen: 100 }));
    expect(getPixel(strong, 19, 10)[0] - 180).toBeGreaterThan(getPixel(weak, 19, 10)[0] - 180 + 10);
    expect(getPixel(strong, 19, 10)[0]).toBeGreaterThan(195);
    expect(getPixel(strong, 19, 10)[3]).toBe(120);
    expect(getPixel(strong, 5, 10)[3]).toBe(120);
  });  test("sharpen raises the contrast at an edge (overshoot) and leaves flat areas and alpha as they were", () => {
    const e = edge();
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) setPixel(e, x, y, [180, 180, 180, 255]);
    const out = applyAdjustments(e, adj({ sharpen: 100 }));
    expect(getPixel(out, 19, 10)[0]).toBeGreaterThan(180); // brighter beside the edge
    expect(getPixel(out, 20, 10)[0]).toBeLessThan(5); // darker at it
    expect(getPixel(out, 3, 10)).toEqual([180, 180, 180, 255]);
    expect(getPixel(out, 30, 10)[3]).toBe(255);
  });
});

describe("the memory of made pictures", () => {
  test("the same bitmap and values give the same picture object; other values give another; the bitmap is the key", () => {
    const a = solid(8, 8, [10, 20, 30, 255]), b = solid(8, 8, [10, 20, 30, 255]);
    expect(adjustedPicture(a, adj({ brightness: 10 }))).toBe(adjustedPicture(a, adj({ brightness: 10 })));
    expect(adjustedPicture(a, adj({ brightness: 10 }))).not.toBe(adjustedPicture(a, adj({ brightness: 11 })));
    expect(adjustedPicture(a, adj({ brightness: 10 }))).not.toBe(adjustedPicture(b, adj({ brightness: 10 })));
  });
});

describe("the layer setting", () => {
  const page = () => {
    const ctx = storeWith(solid(100, 60, [240, 240, 240, 255]));
    const id = ctx.get().addImageLayer({ raw: solid(20, 20, [100, 50, 50, 255]), name: "bm" })!;
    return { ctx, id };
  };
  const layer = (c: ReturnType<typeof page>["ctx"], id: string) => c.get().history!.present.screens[0].layers.find((l) => l.id === id)!;

  test("one undo step; the same values record nothing; all zero removes the key; the bitmap is untouched; the PNG shows the result", () => {
    const { ctx, id } = page();
    const picture = ctx.get().images.get(layer(ctx, id).imageId!)!.raw;
    const bytes = Buffer.from(picture.data);
    const past = ctx.get().history!.past.length;
    expect(ctx.get().setLayerAdjust(id, adj({ brightness: 50 }))).toBe(true);
    expect(ctx.get().history!.past).toHaveLength(past + 1);
    expect(ctx.get().setLayerAdjust(id, adj({ brightness: 50 }))).toBe(false);
    expect(Buffer.from(picture.data).equals(bytes)).toBe(true);
    const t = layer(ctx, id).transform;
    const out = renderProjectRaw(ctx.get().snapshotProject()!, ctx.get().images);
    expect(getPixel(out, t.x + 5, t.y + 5)).toEqual([228, 178, 178, 255]);
    expect(ctx.get().setLayerAdjust(id, NO_ADJUST)).toBe(true);
    expect("adjust" in layer(ctx, id)).toBe(false);
    ctx.get().undo();
    expect(layer(ctx, id).adjust!.brightness).toBe(50);
    ctx.get().undo();
    expect(layer(ctx, id).adjust).toBeUndefined();
  });
  test("refused: a shape, a locked layer, comparing, values out of range; the preview writes no history", () => {
    const { ctx, id } = page();
    const shape = ctx.get().addVectorLayer({ kind: "rect", width: 10, height: 10, stroke: "#000", strokeWidth: 1, fill: null }, 5, 5)!;
    expect(ctx.get().setLayerAdjust(shape, adj({ hue: 10 }))).toBe(false);
    expect(ctx.get().setLayerAdjust(id, adj({ brightness: 101 }))).toBe(false);
    expect(ctx.get().setLayerAdjust(id, adj({ blur: -1 }))).toBe(false);
    expect(ctx.get().setLayerAdjust(id, adj({ hue: NaN }))).toBe(false);
    const before = ctx.get().history;
    ctx.get().setAdjustPreview({ layerId: id, adjust: adj({ blur: 10 }) });
    expect(ctx.get().history).toBe(before);
    ctx.get().setAdjustPreview(null);
    ctx.get().setLayerLocked(id, true);
    expect(ctx.get().setLayerAdjust(id, adj({ hue: 10 }))).toBe(false);
    ctx.get().setLayerLocked(id, false);
    ctx.get().setCompareMode("original");
    expect(ctx.get().setLayerAdjust(id, adj({ hue: 10 }))).toBe(false);
  });
  test("it is saved and opened again; a bad value or a shape with adjustments is refused in a file", () => {
    const { ctx, id } = page();
    ctx.get().setLayerAdjust(id, adj({ saturation: -30, blur: 4 }));
    const text = serializeProject(ctx.get().snapshotProject()!);
    const back = parseProject(text);
    expect(back.ok && back.project.screens[0].layers[0].adjust).toEqual(layer(ctx, id).adjust);
    const bad = JSON.parse(text);
    bad.screens[0].layers[0].adjust.brightness = 500;
    expect(parseProject(JSON.stringify(bad)).ok).toBe(false);
    const shape = JSON.parse(text);
    shape.screens[0].layers[0].content = { kind: "rect", width: 10, height: 10, fill: "#000000", stroke: null, strokeWidth: 0 };
    delete shape.screens[0].layers[0].imageId;
    expect(parseProject(JSON.stringify(shape)).ok).toBe(false);
    expect(adjustError({ ...NO_ADJUST, extra: 1 })).toContain("알 수 없는");
    expect(adjustError("x")).toContain("객체");
  });
  test("rasterize bakes the adjustments in (the layer keeps none and looks the same)", () => {
    const { ctx, id } = page();
    ctx.get().setLayerAdjust(id, adj({ hue: 90, contrast: 20 }));
    const before = renderProjectRaw(ctx.get().snapshotProject()!, ctx.get().images);
    expect(ctx.get().rasterizeLayer(id)).toBe(true);
    expect(layer(ctx, id).adjust).toBeUndefined();
    const after = renderProjectRaw(ctx.get().snapshotProject()!, ctx.get().images);
    expect(Buffer.from(after.data).equals(Buffer.from(before.data))).toBe(true);
  });
});

describe("the file the previous build saved (version 11)", () => {
  test("opens as the current version with nothing changed", () => {
    const v11 = fs.readFileSync("tests/fixtures/project-v11.slc.json", "utf8");
    const before = JSON.parse(v11).project;
    expect(before.version).toBe(11);
    expect(JSON.stringify(before)).toContain('"effects"');
    expect(JSON.stringify(before)).not.toContain('"adjust"');
    const r = parseProjectFile(v11);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.project.version).toBe(13);
    expect(r.file.project.screens[0].layers).toEqual(before.screens[0].layers);
  });
});