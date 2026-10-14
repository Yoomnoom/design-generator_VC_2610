import fs from "node:fs";
import { describe, expect, test } from "vitest";
import { renderProjectRaw } from "@/features/export-image/export-png";
import { parseProjectFile } from "@/features/project-persistence/project-file";
import { applyEffects, effectMargin, hasEffects } from "@/lib/image/layer-effects";
import { RenderLayer, renderComposite } from "@/lib/image/render-export";
import { createRawImage } from "@/lib/image/raw-image";
import { effectsError, parseProject, serializeProject } from "@/lib/project/parse";
import { LayerEffects } from "@/lib/project/schema";
import { getPixel, setPixel, solid } from "./helpers";
import { storeWith } from "./fixtures";

/** a transparent tile 60 x 60 with an opaque red block 20 x 20 at (20,20)..(39,39) */
const tile = () => {
  const t = createRawImage(60, 60);
  for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) setPixel(t, x, y, [255, 0, 0, 255]);
  return t;
};
const shadow = (o: Partial<NonNullable<LayerEffects["shadow"]>> = {}): LayerEffects => ({ shadow: { on: true, color: "#000000", dx: 10, dy: 10, blur: 0, opacity: 1, ...o } });
const stroke = (o: Partial<NonNullable<LayerEffects["stroke"]>> = {}): LayerEffects => ({ stroke: { on: true, color: "#00ff00", width: 3, position: "outside", ...o } });

describe("what counts as an effect", () => {
  test("nothing, all switched off, a zero-width outline or a zero-opacity overlay are no effects: the picture is returned as it is", () => {
    const t = tile();
    for (const e of [undefined, {}, { shadow: { ...shadow().shadow!, on: false } }, { stroke: { ...stroke().stroke!, width: 0 } }, { overlay: { on: true, color: "#ffffff", opacity: 0 } }] as (LayerEffects | undefined)[]) {
      expect(hasEffects(e)).toBe(false);
      expect(applyEffects(t, e)).toBe(t);
      expect(effectMargin(e)).toBe(0);
    }
    expect(hasEffects(shadow())).toBe(true);
  });
  test("the margin covers what an effect can reach", () => {
    expect(effectMargin(shadow({ dx: 30, dy: -5, blur: 10 }))).toBeGreaterThanOrEqual(30 + 10);
    expect(effectMargin(stroke({ width: 8, position: "outside" }))).toBeGreaterThanOrEqual(8);
    expect(effectMargin(stroke({ width: 8, position: "inside" }))).toBe(0);
    expect(effectMargin({ overlay: { on: true, color: "#fff", opacity: 1 } })).toBe(0);
  });
});

describe("drop shadow", () => {
  test("a hard shadow is the layer's shape moved by (dx, dy), in the colour, behind the layer", () => {
    const out = applyEffects(tile(), shadow({ color: "#0000ff", dx: 10, dy: 10 }));
    expect(getPixel(out, 25, 25)).toEqual([255, 0, 0, 255]); // the layer stays on top
    expect(getPixel(out, 45, 45)).toEqual([0, 0, 255, 255]); // shadow only
    expect(getPixel(out, 49, 49)).toEqual([0, 0, 255, 255]);
    expect(getPixel(out, 50, 50)[3]).toBe(0); // beyond the moved shape
    expect(getPixel(out, 10, 10)[3]).toBe(0); // nothing on the other side
  });
  test("opacity scales the shadow's alpha; blur spreads it softly and keeps its total", () => {
    const half = applyEffects(tile(), shadow({ opacity: 0.5 }));
    expect(getPixel(half, 45, 45)[3]).toBe(128);
    const soft = applyEffects(tile(), shadow({ blur: 8, dx: 0, dy: 0 }));
    const edge = getPixel(soft, 41, 30)[3]; // just outside the block's right edge
    expect(edge).toBeGreaterThan(10);
    expect(edge).toBeLessThan(200);
    expect(getPixel(soft, 49, 30)[3]).toBeLessThan(edge);
    const sum = (img: ReturnType<typeof tile>) => { let s = 0; for (let i = 3; i < img.data.length; i += 4) s += img.data[i]; return s; };
    const shadowOnly = (img: ReturnType<typeof tile>) => { const c = createRawImage(img.width, img.height); for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (!(x >= 20 && x < 40 && y >= 20 && y < 40)) c.data.set(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4), (y * img.width + x) * 4); return c; };
    expect(sum(shadowOnly(soft))).toBeGreaterThan(0);
  });
  test("a semi-transparent layer casts a lighter shadow (alpha follows alpha)", () => {
    const t = createRawImage(60, 60);
    for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) setPixel(t, x, y, [255, 0, 0, 128]);
    expect(getPixel(applyEffects(t, shadow({ dx: 15, dy: 0 })), 50, 30)[3]).toBe(128); // as opaque as the layer is
    expect(getPixel(applyEffects(t, shadow({ dx: 15, dy: 0, opacity: 0.5 })), 50, 30)[3]).toBe(64);
  });
});

describe("outline", () => {
  const at = (img: ReturnType<typeof tile>, x: number, y = 30) => getPixel(img, x, y);
  test("outside: a ring exactly `width` pixels wide around the shape, behind it", () => {
    const out = applyEffects(tile(), stroke({ width: 3 }));
    expect(at(out, 19)).toEqual([0, 255, 0, 255]);
    expect(at(out, 17)).toEqual([0, 255, 0, 255]);
    expect(at(out, 16)[3]).toBe(0);
    expect(at(out, 20)).toEqual([255, 0, 0, 255]); // the layer itself is not covered
    expect(at(out, 40)).toEqual([0, 255, 0, 255]);
    expect(at(out, 42)).toEqual([0, 255, 0, 255]);
    expect(at(out, 43)[3]).toBe(0);
  });
  test("inside: the rim of the layer takes the colour, the middle is untouched, nothing outside", () => {
    const out = applyEffects(tile(), stroke({ width: 2, position: "inside" }));
    expect(at(out, 20)).toEqual([0, 255, 0, 255]);
    expect(at(out, 21)).toEqual([0, 255, 0, 255]);
    expect(at(out, 22)).toEqual([255, 0, 0, 255]);
    expect(at(out, 19)[3]).toBe(0);
  });
  test("center: half outside, half inside", () => {
    const out = applyEffects(tile(), stroke({ width: 4, position: "center" }));
    expect(at(out, 18)).toEqual([0, 255, 0, 255]);
    expect(at(out, 17)[3]).toBe(0);
    expect(at(out, 21)).toEqual([0, 255, 0, 255]);
    expect(at(out, 22)).toEqual([255, 0, 0, 255]);
  });
  test("the outline follows a round shape, not its bounding box", () => {
    const t = createRawImage(60, 60);
    for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) if (Math.hypot(x + 0.5 - 30, y + 0.5 - 30) <= 12) setPixel(t, x, y, [255, 0, 0, 255]);
    const out = applyEffects(t, stroke({ width: 2 }));
    expect(getPixel(out, 30, 30 - 13)[3]).toBe(255); // just outside the top
    expect(getPixel(out, 30 - 13, 30 - 13)[3]).toBe(0); // the box's corner is far from the circle
  });
});

describe("colour overlay", () => {
  test("mixes the colour into the layer's colour by its opacity and leaves the alpha alone", () => {
    const t = tile();
    setPixel(t, 5, 5, [200, 100, 0, 100]);
    const out = applyEffects(t, { overlay: { on: true, color: "#0000ff", opacity: 0.5 } });
    expect(getPixel(out, 25, 25)).toEqual([128, 0, 128, 255]);
    expect(getPixel(out, 5, 5)).toEqual([100, 50, 128, 100]);
    expect(getPixel(out, 50, 50)[3]).toBe(0);
  });
  test("full opacity gives a flat silhouette in the colour", () => {
    expect(getPixel(applyEffects(tile(), { overlay: { on: true, color: "#00ffff", opacity: 1 } }), 30, 30)).toEqual([0, 255, 255, 255]);
  });
});

describe("in the finished picture", () => {
  const layer = (o: Partial<RenderLayer> = {}): RenderLayer => ({ image: solid(20, 20, [255, 0, 0, 255]), x: 40, y: 40, zIndex: 1, opacity: 1, visible: true, ...o });
  const render = (l: RenderLayer, w = 120, h = 120) => renderComposite({ width: w, height: h, source: solid(w, h, [255, 255, 255, 255]), patches: [], layers: [l] });

  test("an effect that reaches beyond the layer is not cut off at the layer's edge, and is cut at the page", () => {
    const out = render(layer({ effects: shadow({ dx: 25, dy: 0, blur: 0, color: "#0000ff" }) }));
    expect(getPixel(out, 75, 50)).toEqual([0, 0, 255, 255]); // 15 px past the layer's right edge (60)
    expect(getPixel(out, 85, 50)).toEqual([255, 255, 255, 255]);
    const edge = render(layer({ x: 100, effects: shadow({ dx: 25, dy: 0, blur: 0 }) }), 120, 120); // reaches past the page: no crash
    expect(edge.width).toBe(120);
  });
  test("a layer partly outside the page still gets its effect inside the page", () => {
    const out = render(layer({ x: -18, effects: stroke({ width: 4, color: "#00ff00" }) })); // the layer covers x -18..1
    expect(getPixel(out, 3, 50)).toEqual([0, 255, 0, 255]); // the outline beyond the layer's right edge, which is on the page
  });
  test("opacity and blend belong to the finished picture (shadow included), once", () => {
    const out = render(layer({ opacity: 0.5, effects: shadow({ dx: 25, dy: 0, color: "#000000" }) }));
    expect(getPixel(out, 75, 50)).toEqual([128, 128, 128, 255]); // black shadow at half opacity over white
    expect(getPixel(out, 50, 50)).toEqual([255, 128, 128, 255]);
    const mul = render(layer({ blend: "multiply", effects: shadow({ dx: 25, dy: 0, color: "#808080" }) }));
    expect(getPixel(mul, 75, 50)).toEqual([128, 128, 128, 255]);
  });
  test("a turned layer: the effect is made on the turned picture (a quarter turn equals the same picture turned beforehand)", () => {
    const flat = solid(20, 10, [255, 0, 0, 255]);
    const upright = solid(10, 20, [255, 0, 0, 255]);
    const fx = { ...stroke({ width: 3 }), ...shadow({ dx: 8, dy: 6, blur: 0 }) };
    const a = render({ image: flat, x: 60, y: 30, zIndex: 1, opacity: 1, visible: true, rotation: 90, scaleX: 1, scaleY: 1, effects: fx });
    const b = render({ image: upright, x: 50, y: 30, zIndex: 1, opacity: 1, visible: true, effects: fx });
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
  });
  test("a scaled layer works too (the picture is drawn, then the effect is made on it)", () => {
    const out = render({ image: solid(10, 10, [255, 0, 0, 255]), x: 30, y: 30, zIndex: 1, opacity: 1, visible: true, scaleX: 2, scaleY: 2, rotation: 0, effects: stroke({ width: 2 }) });
    expect(getPixel(out, 40, 40)).toEqual([255, 0, 0, 255]);
    expect(getPixel(out, 29, 40)).toEqual([0, 255, 0, 255]);
    expect(getPixel(out, 51, 40)).toEqual([0, 255, 0, 255]); // 30 + 20 = 50 is the edge; 50 and 51 are the ring
  });
  test("a warped layer gets its effect", () => {
    const out = render({ image: solid(20, 20, [255, 0, 0, 255]), x: 40, y: 40, zIndex: 1, opacity: 1, visible: true, warp: { kind: "quad", points: [{ x: 4, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] }, effects: shadow({ dx: 20, dy: 0, color: "#0000ff" }) });
    expect(getPixel(out, 70, 50)).toEqual([0, 0, 255, 255]);
  });
});

describe("the setting", () => {
  const page = () => {
    const ctx = storeWith(solid(200, 100, [240, 240, 240, 255]));
    const id = ctx.get().addImageLayer({ raw: solid(40, 30, [255, 0, 0, 255]), name: "bm" })!;
    return { ctx, id };
  };
  const layer = (c: ReturnType<typeof page>["ctx"], id: string) => c.get().history!.present.screens[0].layers.find((l) => l.id === id)!;

  test("one undo step; the same values record nothing; null removes them all; values are kept when an effect is switched off", () => {
    const { ctx, id } = page();
    const past = ctx.get().history!.past.length;
    expect(ctx.get().setLayerEffects(id, shadow())).toBe(true);
    expect(ctx.get().history!.past).toHaveLength(past + 1);
    expect(ctx.get().setLayerEffects(id, shadow())).toBe(false);
    expect(ctx.get().setLayerEffects(id, shadow({ on: false }))).toBe(true);
    expect(layer(ctx, id).effects!.shadow).toMatchObject({ on: false, dx: 10 });
    expect(hasEffects(layer(ctx, id).effects)).toBe(false);
    expect(ctx.get().setLayerEffects(id, null)).toBe(true);
    expect("effects" in layer(ctx, id)).toBe(false);
    ctx.get().undo();
    ctx.get().undo();
    expect(layer(ctx, id).effects!.shadow!.on).toBe(true);
    expect(ctx.get().setLayerEffects(id, null)).toBe(true);
  });
  test("invalid values, a locked layer and comparing are refused", () => {
    const { ctx, id } = page();
    expect(ctx.get().setLayerEffects(id, shadow({ blur: 500 }))).toBe(false);
    expect(ctx.get().setLayerEffects(id, shadow({ color: "red" }))).toBe(false);
    expect(ctx.get().setLayerEffects(id, stroke({ width: -1 }))).toBe(false);
    expect(ctx.get().setLayerEffects(id, { overlay: { on: true, color: "#ffffff", opacity: 2 } })).toBe(false);
    ctx.get().setLayerLocked(id, true);
    expect(ctx.get().setLayerEffects(id, shadow())).toBe(false);
    ctx.get().setLayerLocked(id, false);
    ctx.get().setCompareMode("original");
    expect(ctx.get().setLayerEffects(id, shadow())).toBe(false);
  });
  test("the preview writes no history; the effect is saved, opened again and drawn in the PNG", () => {
    const { ctx, id } = page();
    const before = ctx.get().history;
    ctx.get().setEffectsPreview({ layerId: id, effects: shadow() });
    expect(ctx.get().history).toBe(before);
    ctx.get().setEffectsPreview(null);
    ctx.get().setLayerEffects(id, shadow({ color: "#0000ff", dx: 15, dy: 0 }));
    const back = parseProject(serializeProject(ctx.get().snapshotProject()!));
    expect(back.ok && back.project.screens[0].layers[0].effects).toEqual(layer(ctx, id).effects);
    const l = layer(ctx, id);
    const png = renderProjectRaw(ctx.get().snapshotProject()!, ctx.get().images);
    expect(getPixel(png, l.transform.x + 40 + 5, l.transform.y + 10)).toEqual([0, 0, 255, 255]); // the shadow, right of the layer
  });
  test("the file format: unknown effects and bad values are refused", () => {
    expect(effectsError(shadow())).toBeNull();
    expect(effectsError({ glow: {} })).toContain("알 수 없는");
    expect(effectsError({ shadow: { on: true } })).toContain("shadow");
    expect(effectsError({ stroke: { on: true, color: "#00ff00", width: 5, position: "middle" } })).toContain("stroke");
    expect(effectsError("x")).toContain("객체");
  });
});

describe("the file the previous build saved (version 10)", () => {
  test("opens as the current version with nothing changed", () => {
    const v10 = fs.readFileSync("tests/fixtures/project-v10.slc.json", "utf8");
    const before = JSON.parse(v10).project;
    expect(before.version).toBe(10);
    expect(JSON.stringify(before)).toContain('"blend":"multiply"');
    expect(JSON.stringify(before)).not.toContain('"effects"');
    const r = parseProjectFile(v10);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.project.version).toBe(12);
    expect(r.file.project.screens[0].layers).toEqual(before.screens[0].layers);
  });
});