import { describe, expect, test } from "vitest";
import { bitmapMapper, fingerTargetProblem, startFingerStroke } from "@/features/smudge/finger";
import { createRawImage, RawImage } from "@/lib/image/raw-image";
import { falloff, smudgeStroke, createSmudge } from "@/lib/image/smudge";
import { IMAGE_VERSION_BUDGET, createEditorStore } from "@/store/editor-store";
import { trimImageVersions } from "@/store/image-retention";
import { CARD, committedId, solidPage, storeWith } from "./fixtures";
import { getPixel, setPixel, solid } from "./helpers";

const RED: [number, number, number, number] = [255, 0, 0, 255];
const BLUE: [number, number, number, number] = [0, 0, 255, 255];
const bytes = (img: RawImage) => Array.from(img.data);
const copy = (img: RawImage): RawImage => ({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });
const hard = { size: 10, strength: 1, hardness: 1 };

/** 80×40: red on the left half, blue on the right */
const split = () => {
  const img = solid(80, 40, BLUE);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 30; x++) setPixel(img, x, y, RED);
  return img;
};

describe("the smudge engine", () => {
  test("a stroke that does not move changes nothing, byte for byte (a click, or a drag shorter than one step)", () => {
    const img = split(), before = bytes(img);
    expect(smudgeStroke(img, [{ x: 20, y: 20 }], hard)).toBeNull();
    expect(smudgeStroke(img, [{ x: 20, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 20 }], hard)).toBeNull();
    expect(smudgeStroke(img, [{ x: 20, y: 20 }, { x: 20.4, y: 20 }], { ...hard, size: 40 })).toBeNull(); // spacing is 6px: no dab yet
    expect(bytes(img)).toEqual(before);
  });

  test("the colour at the start is dragged along the stroke, and ends where the stroke ends", () => {
    const img = split();
    const box = smudgeStroke(img, [{ x: 20, y: 20 }, { x: 60, y: 20 }], hard)!;
    expect(box).not.toBeNull();
    // the path runs through blue, and red now lies along it up to the end
    for (const x of [32, 40, 48, 56]) expect(getPixel(img, x, 20)).toEqual(RED);
    // beyond the end of the stroke nothing happened, and neither above nor below the brush
    expect(getPixel(img, 70, 20)).toEqual(BLUE);
    expect(getPixel(img, 40, 8)).toEqual(BLUE);
    expect(getPixel(img, 40, 32)).toEqual(BLUE);
    // the written box covers the stroke and is as tall as the brush
    expect(box.y).toBeGreaterThanOrEqual(14);
    expect(box.y + box.height).toBeLessThanOrEqual(27);
    expect(box.x + box.width).toBeGreaterThan(60);
    expect(box.x + box.width).toBeLessThanOrEqual(66);
  });

  test("the direction follows the stroke: dragging down smears downward, not sideways", () => {
    const img = solid(40, 80, BLUE);
    for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) setPixel(img, x, y, RED);
    smudgeStroke(img, [{ x: 20, y: 20 }, { x: 20, y: 60 }], hard);
    expect(getPixel(img, 20, 48)).toEqual(RED);
    expect(getPixel(img, 6, 48)).toEqual(BLUE);
    expect(getPixel(img, 34, 48)).toEqual(BLUE);
  });

  test("with less strength the paint thins out along the way: it is redder near the start than near the end", () => {
    const img = split();
    smudgeStroke(img, [{ x: 20, y: 20 }, { x: 70, y: 20 }], { size: 10, strength: 0.3, hardness: 1 });
    const redness = (x: number) => getPixel(img, x, 20)[0];
    expect(redness(32)).toBeGreaterThan(redness(36));
    expect(redness(36)).toBeGreaterThan(redness(40));
    expect(redness(40)).toBeGreaterThan(0); // still reaches there
    expect(redness(32)).toBeLessThan(255); // never as solid as a full-strength smear
  });

  test("a soft edge pulls less at the rim than at the centre", () => {
    const sharp = split(), soft = split();
    smudgeStroke(sharp, [{ x: 20, y: 20 }, { x: 60, y: 20 }], { size: 20, strength: 1, hardness: 1 });
    smudgeStroke(soft, [{ x: 20, y: 20 }, { x: 60, y: 20 }], { size: 20, strength: 1, hardness: 0 });
    // near the rim of the path (7 px off the line) the hard brush has smeared red fully, the soft one only partly
    expect(getPixel(sharp, 50, 27)[0]).toBeGreaterThan(getPixel(soft, 50, 27)[0]);
    expect(getPixel(soft, 50, 20)[0]).toBeGreaterThan(getPixel(soft, 50, 27)[0]);
    expect(falloff(0, 0.5)).toBe(1);
    expect(falloff(1, 0.5)).toBe(0);
    expect(falloff(0.75, 0.5)).toBeCloseTo(0.5, 6);
    expect(falloff(0.3, 0)).toBeGreaterThan(falloff(0.7, 0));
  });

  test("alpha is respected: opaque paint smeared into a transparent area gets its alpha from the paint, with the colour kept (no dark fringe)", () => {
    const img = createRawImage(80, 40);
    for (let y = 0; y < 40; y++) for (let x = 40; x < 80; x++) setPixel(img, x, y, [0, 200, 0, 255]);
    smudgeStroke(img, [{ x: 50, y: 20 }, { x: 10, y: 20 }], { size: 12, strength: 0.7, hardness: 1 });
    let seen = 0;
    for (let x = 12; x < 38; x++) {
      const [r, g, b, a] = getPixel(img, x, 20);
      if (a >= 8) {
        seen++;
        expect(Math.abs(r)).toBeLessThanOrEqual(2);
        expect(Math.abs(g - 200)).toBeLessThanOrEqual(3);
        expect(Math.abs(b)).toBeLessThanOrEqual(2);
      }
    }
    expect(seen).toBeGreaterThan(8); // it did reach into the transparent half
    expect(getPixel(img, 12, 6)[3]).toBe(0); // off the brush: still empty
  });

  test("smearing a transparent area into opaque paint thins it, keeping the paint's colour", () => {
    const img = solid(80, 40, [0, 200, 0, 255]);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 30; x++) setPixel(img, x, y, [0, 0, 0, 0]);
    smudgeStroke(img, [{ x: 20, y: 20 }, { x: 60, y: 20 }], { size: 12, strength: 0.5, hardness: 1 });
    let thinned = 0;
    for (let x = 34; x < 60; x++) {
      const [r, g, b, a] = getPixel(img, x, 20);
      if (a < 250 && a >= 8) {
        thinned++;
        expect(r).toBeLessThanOrEqual(2);
        expect(Math.abs(g - 200)).toBeLessThanOrEqual(3);
        expect(b).toBeLessThanOrEqual(2);
      }
    }
    expect(thinned).toBeGreaterThan(0);
  });

  test("one dab, worked out by hand: opaque red carried onto half-transparent green is mixed on premultiplied colour", () => {
    const img = createRawImage(30, 11);
    for (let y = 0; y < 11; y++) for (let x = 0; x < 30; x++) setPixel(img, x, y, x <= 10 ? [255, 0, 0, 255] : [0, 200, 0, 128]);
    // size 4: a dab every 1px. The dab at x = 11 lays what was at x = 10 (red) over x = 11 (green at alpha 128), half and half.
    const s = createSmudge(img, { size: 4, strength: 0.5, hardness: 1 });
    s.add({ x: 10, y: 5 });
    s.add({ x: 11, y: 5 });
    // premultiplied: red 127.5, green 0.5 * 200 * 128/255 = 50.2, alpha 0.5 * 128 + 0.5 * 255 = 191.5; back to straight: ×255/191.5
    const [r, g, b, a] = getPixel(img, 11, 5);
    expect(Math.abs(r - 170)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - 67)).toBeLessThanOrEqual(2);
    expect(b).toBe(0);
    expect(Math.abs(a - 191.5)).toBeLessThanOrEqual(1);
  });

  test("a brush hanging over the right or bottom edge does not read what lies past it (it would be the next row, or nothing)", () => {
    const img = solid(40, 40, [100, 100, 100, 255]);
    for (let y = 0; y < 40; y++) setPixel(img, 0, y, [0, 0, 0, 0]); // the left column is empty: the row after the right edge starts there
    smudgeStroke(img, [{ x: 38, y: 2 }, { x: 38, y: 36 }, { x: 36, y: 39 }], { size: 12, strength: 1, hardness: 1 });
    for (let y = 0; y < 40; y++) for (let x = 1; x < 40; x++) expect(getPixel(img, x, y)).toEqual([100, 100, 100, 255]);
  });

  test("nothing is written outside the bitmap, and a brush at the edge does not pull transparency in", () => {
    const img = solid(40, 40, [100, 100, 100, 255]);
    const before = img.data.length;
    smudgeStroke(img, [{ x: 1, y: 5 }, { x: 1, y: 30 }, { x: -20, y: 30 }, { x: 60, y: -10 }], { size: 14, strength: 1, hardness: 0.5 });
    expect(img.data.length).toBe(before);
    for (let i = 3; i < img.data.length; i += 4) expect(img.data[i]).toBe(255);
  });

  test("the live version reports the box each move wrote", () => {
    const img = split();
    const s = createSmudge(img, hard);
    expect(s.add({ x: 20, y: 20 })).toBeNull(); // picking up writes nothing
    expect(s.add({ x: 20.2, y: 20 })).toBeNull(); // not a full step yet
    const b1 = s.add({ x: 40, y: 20 })!;
    expect(b1.width).toBeGreaterThan(10);
    expect(s.dirty()!.x + s.dirty()!.width).toBe(b1.x + b1.width);
  });
});

describe("where a pointer lands on a placed bitmap", () => {
  const layer = (over: object = {}) => ({ id: "l", name: "l", crop: { x: 0, y: 0, width: 40, height: 20 }, imageId: "i", transform: { x: 100, y: 50, scaleX: 1, scaleY: 1, rotation: 0 }, zIndex: 0, opacity: 1, visible: true, locked: false, ...over });
  const near = (p: { x: number; y: number } | null, x: number, y: number) => {
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(x, 6);
    expect(p!.y).toBeCloseTo(y, 6);
  };
  const size = { width: 40, height: 20 };

  test("moved only", () => near(bitmapMapper(layer() as never, size)({ x: 110, y: 60 }), 10, 10));
  test("scaled 2× and 3×", () => near(bitmapMapper(layer({ transform: { x: 100, y: 50, scaleX: 2, scaleY: 3, rotation: 0 } }) as never, size)({ x: 120, y: 80 }), 10, 10));
  test("rotated 30° about the top-left corner: the bitmap's point (20, 0) is at 100 + 20cos30, 50 + 20sin30", () => {
    const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
    const m = bitmapMapper(layer({ transform: { x: 100, y: 50, scaleX: 1, scaleY: 1, rotation: 30 } }) as never, size);
    near(m({ x: 100 + 20 * c, y: 50 + 20 * s }), 20, 0);
    near(m({ x: 100 - 5 * s, y: 50 + 5 * c }), 0, 5); // (0, 5) turned
  });
  test("scaled and rotated together", () => {
    const r = (45 * Math.PI) / 180;
    const m = bitmapMapper(layer({ transform: { x: 10, y: 10, scaleX: 2, scaleY: 0.5, rotation: 45 } }) as never, size);
    near(m({ x: 10 + Math.cos(r) * 2 * 8 - Math.sin(r) * 0.5 * 6, y: 10 + Math.sin(r) * 2 * 8 + Math.cos(r) * 0.5 * 6 }), 8, 6);
  });
  test("through a warp: a corner moved right is found where the bitmap's corner now is, and a point outside the bent shape is not found", () => {
    const w = layer({ warp: { kind: "quad", points: [{ x: 10, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }] } });
    const m = bitmapMapper(w as never, size);
    const close = (p: { x: number; y: number } | null, x: number, y: number) => (expect(p).not.toBeNull(), expect(Math.hypot(p!.x - x, p!.y - y)).toBeLessThan(0.01));
    close(m({ x: 100 + 40 - 0.001, y: 50 + 20 - 0.001 }), 40, 20); // the unmoved corner (a hair inside)
    close(m({ x: 100 + 10 + 0.001, y: 50 + 0.001 }), 0, 0); // the moved corner (a hair inside)
    expect(m({ x: 100 + 2, y: 50 + 2 })).toBeNull(); // cut off by the bent edge
  });
});

describe("who the finger can work on", () => {
  test("a bitmap layer; not nothing, a vector layer, a locked or hidden layer", () => {
    const ok = { id: "l", name: "l", crop: { x: 0, y: 0, width: 4, height: 4 }, imageId: "i", transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, zIndex: 0, opacity: 1, visible: true, locked: false };
    expect(fingerTargetProblem(ok, true)).toBeNull();
    expect(fingerTargetProblem(undefined, false)).toContain("배경(원본)");
    expect(fingerTargetProblem({ ...ok, imageId: undefined, content: { kind: "rect", width: 1, height: 1, stroke: "#000000", strokeWidth: 1, fill: null } } as never, false)).toContain("이미지(비트맵)");
    expect(fingerTargetProblem({ ...ok, locked: true }, true)).toContain("잠긴");
    expect(fingerTargetProblem({ ...ok, visible: false }, true)).toContain("숨긴");
  });
});

describe("a finger stroke on the store", () => {
  const withLayer = () => {
    const ctx = storeWith();
    return { ...ctx, id: committedId(ctx.get().beginExtraction(CARD)) };
  };
  const layerOf = (ctx: ReturnType<typeof withLayer>) => ctx.get().history!.present.screens[0].layers.find((l) => l.id === ctx.id)!;
  const stroke = (ctx: ReturnType<typeof withLayer>, pts: { x: number; y: number }[]) => {
    const r = startFingerStroke(ctx.store, ctx.id);
    if (!r.ok) return r;
    for (const p of pts) r.stroke.move(p);
    return { ok: true as const, committed: r.stroke.finish() };
  };
  /* the layer is the card: 20×10 blue at frame (10,10). Paint a red patch on its left, then smear it right. */
  const painted = () => {
    const ctx = withLayer();
    const raw = ctx.get().images.get(layerOf(ctx).imageId!)!.raw;
    for (let y = 0; y < 10; y++) for (let x = 0; x < 6; x++) setPixel(raw, x, y, RED);
    return ctx;
  };

  test("a stroke becomes one undo step that swaps the picture for a new one; the old picture is untouched; undo and redo move between them", () => {
    const ctx = painted();
    const oldId = layerOf(ctx).imageId!;
    const oldBytes = bytes(ctx.get().images.get(oldId)!.raw);
    const past = ctx.get().history!.past.length;
    ctx.get().setFingerStyle({ size: 6, strength: 100, softness: 0 });
    const r = stroke(ctx, [{ x: 10 + 3, y: 10 + 5 }, { x: 10 + 17, y: 10 + 5 }]);
    expect(r).toEqual({ ok: true, committed: true });
    expect(ctx.get().history!.past.length).toBe(past + 1);
    const newId = layerOf(ctx).imageId!;
    expect(newId).not.toBe(oldId);
    expect(bytes(ctx.get().images.get(oldId)!.raw)).toEqual(oldBytes);
    expect(getPixel(ctx.get().images.get(newId)!.raw, 14, 5)).toEqual(RED); // smeared right
    // the history holds the id change, not pixels
    expect(JSON.stringify(ctx.get().history!.past.at(-1))).not.toMatch(/data|Uint8/);
    ctx.get().undo();
    expect(layerOf(ctx).imageId).toBe(oldId);
    ctx.get().redo();
    expect(layerOf(ctx).imageId).toBe(newId);
    expect(getPixel(ctx.get().images.get(layerOf(ctx).imageId!)!.raw, 14, 5)).toEqual(RED);
  });

  test("a stroke with no movement leaves no trace: no new picture, no undo step", () => {
    const ctx = painted();
    const id = layerOf(ctx).imageId, past = ctx.get().history!.past.length, count = ctx.get().images.size;
    expect(stroke(ctx, [{ x: 15, y: 15 }])).toEqual({ ok: true, committed: false });
    expect(stroke(ctx, [{ x: 15, y: 15 }, { x: 15, y: 15 }])).toEqual({ ok: true, committed: false });
    expect(layerOf(ctx).imageId).toBe(id);
    expect(ctx.get().history!.past.length).toBe(past);
    expect(ctx.get().images.size).toBe(count);
  });

  test("a locked layer, a vector layer and comparing refuse, saying why", () => {
    const ctx = painted();
    ctx.get().setLayerLocked(ctx.id, true);
    expect(stroke(ctx, [{ x: 13, y: 15 }, { x: 25, y: 15 }])).toMatchObject({ ok: false });
    expect((startFingerStroke(ctx.store, ctx.id) as { reason: string }).reason).toContain("잠긴");
    ctx.get().setLayerLocked(ctx.id, false);
    ctx.get().setCompareMode("split");
    expect(startFingerStroke(ctx.store, ctx.id)).toEqual({ ok: false, reason: null });
    expect(ctx.get().commitSmudge(ctx.id, copy(ctx.get().images.get(layerOf(ctx).imageId!)!.raw))).toBe(false);
    const v = storeWith();
    const vid = v.get().addVectorLayer({ kind: "rect", width: 20, height: 10, stroke: "#000000", strokeWidth: 2, fill: null }, 5, 5)!;
    expect((startFingerStroke(v.store, vid) as { reason: string }).reason).toContain("이미지(비트맵)");
  });

  test("commitSmudge itself refuses a locked layer (not only the tool in front of it)", () => {
    const ctx = painted();
    const raw = copy(ctx.get().images.get(layerOf(ctx).imageId!)!.raw);
    ctx.get().setLayerLocked(ctx.id, true);
    const id = layerOf(ctx).imageId, past = ctx.get().history!.past.length;
    expect(ctx.get().commitSmudge(ctx.id, raw)).toBe(false);
    expect(layerOf(ctx).imageId).toBe(id);
    expect(ctx.get().history!.past.length).toBe(past);
  });

  test("commitSmudge refuses a picture of another size", () => {
    const ctx = painted();
    expect(ctx.get().commitSmudge(ctx.id, solid(3, 3, RED))).toBe(false);
  });

  test("the settings are kept within their limits", () => {
    const ctx = storeWith();
    ctx.get().setFingerStyle({ size: 9999, strength: 0, softness: -5 });
    expect(ctx.get().fingerStyle).toEqual({ size: 300, strength: 1, softness: 0 });
    ctx.get().setFingerStyle({ size: NaN });
    expect(ctx.get().fingerStyle.size).toBe(30);
  });

  test("a warped, scaled and rotated layer is smeared where the pointer is, through the layer's placement", () => {
    const ctx = withLayer();
    ctx.get().setLayerWarp(ctx.id, { kind: "quad", points: [{ x: 4, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }] });
    ctx.get().transformLayer(ctx.id, { x: 10, y: 10, scaleX: 2, scaleY: 2, rotation: 0 });
    const l = layerOf(ctx);
    const raw = ctx.get().images.get(l.imageId!)!.raw;
    for (let y = 0; y < 10; y++) for (let x = 0; x < 4; x++) setPixel(raw, x, y, RED);
    ctx.get().setFingerStyle({ size: 4, strength: 100, softness: 0 });
    // the picture is 2× in the frame: bitmap (2, 5) is at frame (10 + 4 + ..., ...): drive through the mapper instead of guessing
    const map = bitmapMapper(l, raw);
    const from = { x: 10 + 2 * 3.5, y: 10 + 2 * 5 }, to = { x: 10 + 2 * 17, y: 10 + 2 * 5 };
    expect(map(from)).not.toBeNull();
    const r = stroke(ctx, [from, to]);
    expect(r).toMatchObject({ ok: true, committed: true });
    const out = ctx.get().images.get(layerOf(ctx).imageId!)!.raw;
    expect(getPixel(out, 12, 5)[0]).toBeGreaterThan(200); // red carried well to the right of the red patch
    expect(getPixel(out, 12, 5)[2]).toBeLessThan(60);
    expect(getPixel(out, 12, 0)).toEqual(BLUE); // up out of the brush's reach
  });
});

describe("how many old pictures are kept", () => {
  const bigLayer = (w = 600, h = 400, budget?: number) => {
    const ctx = storeWith(solidPage(700, 500), "big.png");
    void budget;
    return { ctx, id: committedId(ctx.get().beginExtraction({ x: 10, y: 10, width: w, height: h })) };
  };
  const smudgeOnce = (ctx: ReturnType<typeof storeWith>, id: string, i: number) => {
    const r = startFingerStroke(ctx.store, id);
    if (!r.ok) throw new Error("no stroke");
    r.stroke.move({ x: 20 + (i % 5), y: 40 });
    r.stroke.move({ x: 120 + (i % 7), y: 90 });
    return r.stroke.finish();
  };

  test("100 strokes on a 600 × 400 layer: every undo step is kept and undo walks back through all of them", () => {
    const { ctx, id } = bigLayer();
    const ids: string[] = [ctx.get().history!.present.screens[0].layers[0].imageId!];
    for (let i = 0; i < 100; i++) {
      ctx.get().setFingerStyle({ size: 20, strength: 80, softness: 30 });
      // make the layer differ so a stroke has something to smear
      const raw = ctx.get().images.get(ctx.get().history!.present.screens[0].layers[0].imageId!)!.raw;
      setPixel(raw, 20 + (i % 5), 40, RED);
      expect(smudgeOnce(ctx, id, i)).toBe(true);
      ids.push(ctx.get().history!.present.screens[0].layers[0].imageId!);
    }
    expect(ctx.get().history!.past.length).toBe(100); // the limit; the extraction step was the one to fall off the end
    const kept = ctx.get().images.size;
    expect(kept).toBeLessThanOrEqual(103); // the page, the pictures of the 100 steps and the present one: nothing else piles up
    for (let i = 99; i >= 0; i--) {
      ctx.get().undo();
      expect(ctx.get().history!.present.screens[0].layers[0].imageId).toBe(ids[i]);
      expect(ctx.get().images.has(ids[i])).toBe(true);
    }
  });

  test("past the budget the oldest undo steps are dropped and the pictures only they needed are freed; the newest steps still work", () => {
    const one = 600 * 400 * 4;
    const store = createEditorStore({ imageBudget: 3 * one });
    store.getState().newProject({ fileName: "big.png", raw: solidPage(700, 500) });
    const id = committedId(store.getState().beginExtraction({ x: 10, y: 10, width: 600, height: 400 }));
    const layerImage = () => store.getState().history!.present.screens[0].layers[0].imageId!;
    const made: string[] = [layerImage()];
    for (let i = 0; i < 8; i++) {
      setPixel(store.getState().images.get(layerImage())!.raw, 30 + i, 40, RED);
      const r = startFingerStroke(store, id);
      if (!r.ok) throw new Error("no stroke");
      r.stroke.move({ x: 20, y: 40 });
      r.stroke.move({ x: 120 + i, y: 90 });
      expect(r.stroke.finish()).toBe(true);
      made.push(layerImage());
    }
    const s = store.getState();
    const sourceId = s.history!.present.screens[0].source.imageId;
    const replaced = [...s.images.keys()].filter((k) => k !== layerImage() && k !== sourceId);
    expect(replaced.length).toBeLessThanOrEqual(3); // the budget
    expect(s.history!.past.length).toBeLessThanOrEqual(3);
    expect(s.history!.past.length).toBeGreaterThanOrEqual(1);
    expect(made.slice(0, 4).some((k) => s.images.has(k))).toBe(false); // the oldest pictures are gone
    // the steps that are left still undo, each to a picture that is still there
    const steps = s.history!.past.length;
    for (let i = 0; i < steps; i++) {
      store.getState().undo();
      expect(store.getState().images.has(layerImage())).toBe(true);
    }
    expect(store.getState().history!.past.length).toBe(0);
  });
  test("trimImageVersions: nothing is freed that history, the present picture or a copied layer still needs; the last step always stays", () => {
    const { ctx, id } = bigLayer(100, 100);
    const copiedImage = ctx.get().history!.present.screens[0].layers[0].imageId!;
    ctx.get().copyLayer(id); // a copy remembers this picture
    for (let i = 0; i < 4; i++) {
      const raw = ctx.get().images.get(ctx.get().history!.present.screens[0].layers[0].imageId!)!.raw;
      setPixel(raw, 30 + i, 40, RED);
      smudgeOnce(ctx, id, i);
    }
    const s = ctx.get();
    const out = trimImageVersions(s.history!, s.images, s.layerClipboard, 0); // no budget at all
    expect(out.history.past.length).toBe(1); // only the last step is kept
    expect(out.images.has(copiedImage)).toBe(true); // the copied layer's picture stays
    expect(out.images.has(s.history!.present.screens[0].layers[0].imageId!)).toBe(true);
    expect(IMAGE_VERSION_BUDGET).toBe(256 * 1024 * 1024);
  });
});