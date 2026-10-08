import fs from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, test } from "vitest";
import { renderProjectRaw } from "@/features/export-image/export-png";
import { applyStroke, strokeTargetProblem } from "@/features/brush/brush";
import { loadProjectText, saveProjectText } from "@/features/project-persistence/project-io";
import { referencedImageIds } from "@/features/project-persistence/sync-images";
import { IRect, MAX_STROKE_POINTS, PaintStroke, Pt, intersectRect, strokeBounds, unionRect } from "@/lib/image/brush-raster";
import { createRawImage } from "@/lib/image/raw-image";
import { hexToRgb } from "@/lib/image/color";
import { parseProject, serializeProject } from "@/lib/project/parse";
import { openBlobStore } from "@/lib/storage/blob-store";
import { CARD, GRAY, committedId, fakeCodec, storeWith } from "./fixtures";
import { getPixel } from "./helpers";
import { migrate } from "@/lib/project/migrate";
import { Project } from "@/lib/project/schema";

/** a stand-in for the canvas: fills the stroke's box (clipped to the frame) with the colour; an eraser clears alpha across the whole bitmap */
const fakePaint: PaintStroke & { calls: { size: number; color: string; erase: boolean; points: number }[] } = Object.assign(
  (base: { raw: { width: number; height: number; data: Uint8ClampedArray }; x: number; y: number } | null, stroke: { points: Pt[]; size: number; color: string; erase: boolean }, frame: { width: number; height: number }) => {
    fakePaint.calls.push({ size: stroke.size, color: stroke.color, erase: stroke.erase, points: stroke.points.length });
    const sb = strokeBounds(stroke.points, stroke.size)!;
    const baseRect: IRect | null = base && { x: base.x, y: base.y, width: base.raw.width, height: base.raw.height };
    let target: IRect;
    if (stroke.erase) {
      if (!baseRect || !intersectRect(baseRect, sb)) return null;
      target = baseRect;
    } else {
      const inFrame = intersectRect(sb, { x: 0, y: 0, width: frame.width, height: frame.height });
      if (!inFrame) return null;
      target = baseRect ? unionRect(baseRect, inFrame) : inFrame;
    }
    const raw = createRawImage(target.width, target.height);
    if (base && baseRect) for (let y = 0; y < base.raw.height; y++) raw.data.set(base.raw.data.subarray(y * base.raw.width * 4, (y + 1) * base.raw.width * 4), ((baseRect.y - target.y + y) * raw.width + (baseRect.x - target.x)) * 4);
    const c = hexToRgb(stroke.color)!;
    const inside = intersectRect(sb, target)!;
    for (let y = inside.y; y < inside.y + inside.height; y++) for (let x = inside.x; x < inside.x + inside.width; x++) raw.data.set(stroke.erase ? [0, 0, 0, 0] : [c.r, c.g, c.b, 255], ((y - target.y) * raw.width + (x - target.x)) * 4);
    return { raw, x: target.x, y: target.y };
  },
  { calls: [] as { size: number; color: string; erase: boolean; points: number }[] },
);

const line = (x0: number, y0: number, x1: number, y1: number): Pt[] => [{ x: x0, y: y0 }, { x: x1, y: y1 }];
const stroke = (ctx: ReturnType<typeof storeWith>, tool: "brush" | "eraser", pts: Pt[]) => applyStroke({ store: ctx.store, tool, points: pts, paint: fakePaint });
const sel = (ctx: ReturnType<typeof storeWith>) => ctx.layers().find((l) => l.id === ctx.get().selectedLayerIds[0])!;
const hash = (raw: { data: Uint8ClampedArray }) => Buffer.from(raw.data).toString("base64");

describe("stroke geometry", () => {
  test("a stroke's box is its points plus half the brush and a pixel for the soft edge", () => {
    expect(strokeBounds(line(10, 20, 30, 40), 6)).toEqual({ x: 6, y: 16, width: 28, height: 28 }); // pad = 3 + 1: from 10 - 4 to 30 + 4
    expect(strokeBounds([{ x: 5.4, y: 5.6 }], 1)).toEqual({ x: 3, y: 3, width: 5, height: 5 }); // pad = 1 + 1
    expect(strokeBounds([], 5)).toBeNull();
  });
  test("intersection and union of boxes", () => {
    expect(intersectRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toEqual({ x: 5, y: 5, width: 5, height: 5 });
    expect(intersectRect({ x: 0, y: 0, width: 4, height: 4 }, { x: 4, y: 0, width: 4, height: 4 })).toBeNull(); // only touching
    expect(unionRect({ x: 0, y: 0, width: 4, height: 4 }, { x: 10, y: 10, width: 2, height: 2 })).toEqual({ x: 0, y: 0, width: 12, height: 12 });
  });
});

describe("the brush", () => {
  test("with no brush layer selected a stroke makes a new bitmap layer, as one undo step, and the capture is untouched", () => {
    const ctx = storeWith();
    const source = ctx.get().images.get(ctx.get().history!.present.screens[0].source.imageId)!.raw;
    const before = hash(source);
    const r = stroke(ctx, "brush", line(10, 10, 40, 30));
    expect(r.status).toBe("painted");
    expect(ctx.layers()).toHaveLength(1);
    const l = ctx.layers()[0];
    expect(l).toMatchObject({ name: "브러시 1", drawn: true, visible: true, locked: false, transform: { scaleX: 1, scaleY: 1, rotation: 0 } });
    expect(l.content).toBeUndefined();
    expect(l.imageId).toBeDefined();
    expect(ctx.get().history!.past).toHaveLength(1);
    expect(ctx.get().history!.past[0].label).toBe("브러시 획");
    expect(ctx.get().selectedLayerIds).toEqual([l.id]);
    expect(hash(source)).toBe(before); // never modified
    expect(ctx.get().images.get(ctx.get().history!.present.screens[0].source.imageId)!.raw).toBe(source);
  });

  test("the next stroke continues the same layer: the bitmap grows to take it and a new image replaces the old, which stays for undo", () => {
    const ctx = storeWith();
    stroke(ctx, "brush", line(10, 10, 20, 20));
    const first = ctx.layers()[0];
    const firstImage = first.imageId!;
    const firstBox = ctx.get().images.get(firstImage)!.raw;
    stroke(ctx, "brush", line(40, 25, 50, 35));
    expect(ctx.layers()).toHaveLength(1);
    const l = ctx.layers()[0];
    expect(l.imageId).not.toBe(firstImage);
    expect(ctx.get().images.has(firstImage)).toBe(true); // undo needs it
    expect(ctx.get().images.get(firstImage)!.raw).toBe(firstBox); // and it was not edited in place
    const grown = ctx.get().images.get(l.imageId!)!.raw;
    expect(grown.width).toBeGreaterThan(firstBox.width);
    expect(l.crop).toEqual({ x: 0, y: 0, width: grown.width, height: grown.height });
    expect(ctx.get().history!.past).toHaveLength(2);
  });

  test("undo and redo step one stroke at a time, restoring the layer's image, size and place", () => {
    const ctx = storeWith();
    stroke(ctx, "brush", line(10, 10, 20, 20));
    const afterFirst = { ...ctx.layers()[0], transform: { ...ctx.layers()[0].transform } };
    stroke(ctx, "brush", line(40, 25, 50, 35));
    const afterSecond = ctx.layers()[0].imageId;
    ctx.get().undo();
    expect(ctx.layers()[0]).toMatchObject({ imageId: afterFirst.imageId, crop: afterFirst.crop, transform: afterFirst.transform });
    ctx.get().undo();
    expect(ctx.layers()).toHaveLength(0);
    ctx.get().redo();
    ctx.get().redo();
    expect(ctx.layers()[0].imageId).toBe(afterSecond);
  });

  test("the history holds a few changed fields, never pixels", () => {
    const ctx = storeWith();
    stroke(ctx, "brush", line(10, 10, 50, 30));
    stroke(ctx, "brush", line(20, 5, 55, 35));
    const entry = ctx.get().history!.past[1];
    const text = JSON.stringify(entry);
    expect(text.length).toBeLessThan(700);
    expect(text).not.toMatch(/blob:|data:|base64|Uint8/i);
  });

  test("a stroke that falls wholly outside the frame paints nothing and records nothing", () => {
    const ctx = storeWith();
    const history = ctx.get().history;
    expect(stroke(ctx, "brush", line(500, 500, 600, 600)).status).toBe("nothing");
    expect(ctx.get().history).toBe(history);
  });

  test("a stroke that only partly leaves the frame is cut at the frame", () => {
    const ctx = storeWith();
    stroke(ctx, "brush", line(50, 30, 200, 100));
    const raw = ctx.get().images.get(ctx.layers()[0].imageId!)!.raw;
    const t = ctx.layers()[0].transform;
    expect(t.x + raw.width).toBeLessThanOrEqual(60);
    expect(t.y + raw.height).toBeLessThanOrEqual(40);
  });

  test("it uses the drawing colour and size, held between 1 and 200", () => {
    const ctx = storeWith();
    fakePaint.calls.length = 0;
    ctx.get().setDrawStyle({ stroke: "#336699", strokeWidth: 0 });
    stroke(ctx, "brush", line(10, 10, 20, 20));
    ctx.get().setDrawStyle({ strokeWidth: 999 });
    stroke(ctx, "brush", line(10, 10, 20, 20));
    ctx.get().setDrawStyle({ strokeWidth: 7.6 });
    stroke(ctx, "brush", line(10, 10, 20, 20));
    expect(fakePaint.calls.map((c) => c.size)).toEqual([1, 200, 8]);
    expect(fakePaint.calls.every((c) => c.color === "#336699" && !c.erase)).toBe(true);
  });

  test("a stroke longer than the limit is cut to it", () => {
    const ctx = storeWith();
    fakePaint.calls.length = 0;
    stroke(ctx, "brush", Array.from({ length: MAX_STROKE_POINTS + 500 }, (_, i) => ({ x: 5 + (i % 40), y: 5 + (i % 20) })));
    expect(fakePaint.calls[0].points).toBe(MAX_STROKE_POINTS);
  });

  test.each([
    ["the selected layer is an extracted bitmap, not a brush layer", () => { const c = storeWith(); committedId(c.get().beginExtraction(CARD)); return c; }],
    ["the selected brush layer is locked", () => { const c = storeWith(); stroke(c, "brush", line(10, 10, 20, 20)); c.get().setLayerLocked(sel(c).id, true); return c; }],
    ["the selected brush layer is hidden", () => { const c = storeWith(); stroke(c, "brush", line(10, 10, 20, 20)); c.get().setLayerVisible(sel(c).id, false); return c; }],
    ["the selected brush layer was resized or turned", () => { const c = storeWith(); stroke(c, "brush", line(10, 10, 20, 20)); const l = sel(c); c.get().transformLayer(l.id, { x: l.transform.x, y: l.transform.y, scaleX: 1.5, scaleY: 1.5, rotation: 20 }); return c; }],
  ])("a brush stroke starts a NEW layer and leaves the old one alone when %s", (_n, make) => {
    const ctx = make();
    const old = ctx.layers().map((l) => ({ id: l.id, imageId: l.imageId, transform: { ...l.transform } }));
    expect(stroke(ctx, "brush", line(30, 20, 45, 30)).status).toBe("painted");
    expect(ctx.layers()).toHaveLength(old.length + 1);
    for (const o of old) expect(ctx.layers().find((l) => l.id === o.id)).toMatchObject({ imageId: o.imageId, transform: o.transform });
  });

  test("while comparing it does nothing", () => {
    const ctx = storeWith();
    ctx.get().setCompareMode("original");
    const history = ctx.get().history;
    expect(stroke(ctx, "brush", line(10, 10, 20, 20)).status).toBe("nothing");
    expect(ctx.get().history).toBe(history);
  });

  test("commitBitmapEdit refuses a locked or non-brush layer and an empty bitmap, whatever called it", () => {
    const ctx = storeWith();
    const bmp = committedId(ctx.get().beginExtraction(CARD));
    const history = ctx.get().history;
    const raw = createRawImage(5, 5, [1, 2, 3, 255]);
    expect(ctx.get().commitBitmapEdit({ layerId: bmp, raw, x: 0, y: 0, label: "x" })).toBeNull(); // not a brush layer
    expect(ctx.get().commitBitmapEdit({ layerId: null, raw: createRawImage(0, 5), x: 0, y: 0, label: "x" })).toBeNull();
    expect(ctx.get().history).toBe(history);
  });
});

describe("the eraser", () => {
  const painted = () => {
    const ctx = storeWith();
    stroke(ctx, "brush", line(10, 10, 40, 30));
    return ctx;
  };

  test("it clears pixels on the selected brush layer, as one undo step, without changing the bitmap's size", () => {
    const ctx = painted();
    const l0 = sel(ctx);
    const before = ctx.get().images.get(l0.imageId!)!.raw;
    const past = ctx.get().history!.past.length;
    expect(stroke(ctx, "eraser", line(20, 15, 30, 25)).status).toBe("painted");
    const l = sel(ctx);
    const after = ctx.get().images.get(l.imageId!)!.raw;
    expect([after.width, after.height]).toEqual([before.width, before.height]);
    expect(l.transform).toMatchObject({ x: l0.transform.x, y: l0.transform.y });
    expect(getPixel(after, 14, 10)[3]).toBe(0); // erased
    expect(getPixel(before, 14, 10)[3]).toBe(255); // the old bitmap is as it was
    expect(ctx.get().history!.past).toHaveLength(past + 1);
    expect(ctx.get().history!.past.at(-1)!.label).toBe("지우개 획");
    ctx.get().undo();
    expect(ctx.get().images.get(sel(ctx).imageId!)!.raw).toBe(before);
  });

  test("an erase that touches nothing records nothing", () => {
    const ctx = painted();
    const history = ctx.get().history;
    expect(stroke(ctx, "eraser", line(55, 35, 58, 38)).status).toBe("nothing");
    expect(ctx.get().history).toBe(history);
  });

  test.each([
    ["nothing is selected", () => { const c = painted(); c.get().selectLayer(null); return c; }, "브러시로 직접 그린 레이어"],
    ["the layer is an extracted bitmap", () => { const c = storeWith(); committedId(c.get().beginExtraction(CARD)); return c; }, "브러시로 직접 그린 레이어"],
    ["the layer is a vector shape", () => { const c = storeWith(); c.get().addVectorLayer({ kind: "rect", width: 10, height: 10, stroke: "#000000", strokeWidth: 1, fill: null }, 5, 5); return c; }, "브러시로 직접 그린 레이어"],
    ["the layer is locked", () => { const c = painted(); c.get().setLayerLocked(sel(c).id, true); return c; }, "잠긴"],
    ["the layer is hidden", () => { const c = painted(); c.get().setLayerVisible(sel(c).id, false); return c; }, "숨긴"],
    ["the layer was resized or turned", () => { const c = painted(); const l = sel(c); c.get().transformLayer(l.id, { x: l.transform.x, y: l.transform.y, scaleX: 1, scaleY: 1, rotation: 30 }); return c; }, "크기나 회전"],
  ])("it refuses, says why and records nothing when %s", (_n, make, fragment) => {
    const ctx = make();
    const history = ctx.get().history;
    const images = ctx.get().images;
    const r = stroke(ctx, "eraser", line(12, 12, 25, 20));
    expect(r.status).toBe("refused");
    expect(ctx.get().notice).toContain(fragment);
    expect(ctx.get().history).toBe(history);
    expect(ctx.get().images).toBe(images);
  });

  test("it never touches the capture: erasing over it with no brush layer selected changes nothing", () => {
    const ctx = storeWith();
    const source = ctx.get().images.get(ctx.get().history!.present.screens[0].source.imageId)!.raw;
    const before = hash(source);
    stroke(ctx, "eraser", line(5, 5, 55, 35));
    expect(hash(source)).toBe(before);
    expect(ctx.layers()).toHaveLength(0);
  });
});

describe("strokeTargetProblem", () => {
  test("is null only for a visible, unlocked, upright brush layer", () => {
    const ctx = storeWith();
    stroke(ctx, "brush", line(10, 10, 20, 20));
    expect(strokeTargetProblem(sel(ctx))).toBeNull();
    expect(strokeTargetProblem(undefined)).not.toBeNull();
  });
});

describe("a brush layer with the rest of the app", () => {
  test("duplicating keeps the layer a brush layer; a stroke on the copy leaves the original's bitmap alone", () => {
    const ctx = storeWith();
    stroke(ctx, "brush", line(10, 10, 30, 20));
    const original = sel(ctx);
    const dupId = ctx.get().duplicateLayer(original.id)!;
    const dup = ctx.layers().find((l) => l.id === dupId)!;
    expect(dup).toMatchObject({ drawn: true, imageId: original.imageId });
    stroke(ctx, "brush", line(32, 30, 45, 36));
    expect(ctx.layers().find((l) => l.id === original.id)!.imageId).toBe(original.imageId);
    expect(ctx.layers().find((l) => l.id === dup.id)!.imageId).not.toBe(original.imageId);
  });

  test("the finished picture shows it, and hiding it removes it", () => {
    const ctx = storeWith();
    ctx.get().setDrawStyle({ stroke: "#00ff00" });
    stroke(ctx, "brush", line(40, 30, 50, 35));
    const out = () => renderProjectRaw(ctx.get().snapshotProject()!, ctx.get().images);
    expect(getPixel(out(), 45, 32)).toEqual([0, 255, 0, 255]);
    ctx.get().setLayerVisible(sel(ctx).id, false);
    expect(getPixel(out(), 45, 32)).toEqual(GRAY);
  });

  test("the project saves the current bitmap only, and opens again exactly", async () => {
    const ctx = storeWith();
    stroke(ctx, "brush", line(10, 10, 20, 20));
    stroke(ctx, "brush", line(40, 25, 50, 35));
    const project = ctx.get().snapshotProject()!;
    expect(referencedImageIds(project)).toHaveLength(2); // the capture and the layer's CURRENT bitmap, not the one before the second stroke
    const codec = fakeCodec();
    const text = await saveProjectFile(project, ctx, codec);
    const opened = await loadProjectText(text, { blobs: await openBlobStore("b", new IDBFactory()), codec });
    expect(opened.ok && opened.project).toEqual(project);
    expect(opened.ok && opened.project.screens[0].layers[0].drawn).toBe(true);
    expect(parseProject(serializeProject(project)).ok).toBe(true);
  });
});

async function saveProjectFile(project: Project, ctx: ReturnType<typeof storeWith>, codec: ReturnType<typeof fakeCodec>) {
  return saveProjectText(project, ctx.get().images, { blobs: await openBlobStore("a", new IDBFactory()), codec });
}

describe("the file format (version 4)", () => {
  const v3 = fs.readFileSync("tests/fixtures/project-v3.slc.json", "utf8");

  test("the file the previous build saved is version 3, with vector layers and no `drawn`", () => {
    const project = JSON.parse(v3).project;
    expect(project.version).toBe(3);
    expect(project.screens[0].layers.some((l: { content?: unknown }) => l.content)).toBe(true);
    expect(project.screens[0].layers.every((l: { drawn?: unknown }) => l.drawn === undefined)).toBe(true);
  });

  test("it opens as it was, version 4, every layer untouched", async () => {
    const before = JSON.parse(v3).project;
    const codec = { encode: async () => new Blob(), decode: async (blob: Blob) => (await import("./png")).decodePng(Buffer.from(await blob.arrayBuffer())) };
    const r = await loadProjectText(v3, { blobs: await openBlobStore("v3", new IDBFactory()), codec });
    if (!r.ok) throw new Error(r.error);
    expect(r.project.version).toBe(5);
    expect(r.project.screens[0].layers).toEqual(before.screens[0].layers);
    expect(r.project.screens[0].backgroundPatches).toEqual(before.screens[0].backgroundPatches);
  });

  test("migrate takes version 3 to the current version without touching anything else", () => {
    const doc = JSON.parse(v3).project;
    const r = migrate(doc);
    expect(r.ok && r.doc.version).toBe(5);
    expect(r.ok && (r.doc.screens as unknown[])).toEqual(doc.screens);
  });

  test("`drawn` must be a boolean on a bitmap layer, and never on a vector layer", () => {
    const base = JSON.parse(serializeProject(storeWith().get().snapshotProject()!));
    const ctx = storeWith();
    stroke(ctx, "brush", line(10, 10, 20, 20));
    const doc = JSON.parse(serializeProject(ctx.get().snapshotProject()!));
    expect(parseProject(JSON.stringify(doc)).ok).toBe(true);
    doc.screens[0].layers[0].drawn = "yes";
    expect(parseProject(JSON.stringify(doc)).ok).toBe(false);
    doc.screens[0].layers[0].drawn = true;
    doc.screens[0].layers[0].content = { kind: "rect", width: 5, height: 5, stroke: "#000000", strokeWidth: 1, fill: null };
    delete doc.screens[0].layers[0].imageId;
    expect(parseProject(JSON.stringify(doc)).ok).toBe(false);
    void base;
  });
});
