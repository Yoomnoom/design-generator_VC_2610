import { IDBFactory } from "fake-indexeddb";
import { describe, expect, test } from "vitest";
import { BUILTIN_ASSETS } from "@/features/assets/builtin";
import { captureBundle } from "@/features/assets/capture";
import { openAssetLibrary } from "@/features/assets/library";
import { PreviewCache, previewFrame, renderBundle, shrinkToFit } from "@/features/assets/preview";
import { TEMPLATES, buildTemplate, templateBundle, templateFrame } from "@/features/assets/templates";
import { renderProjectRaw } from "@/features/export-image/export-png";
import { Rasterize } from "@/lib/image/vector-raster";
import { createRawImage } from "@/lib/image/raw-image";
import { fakeCodec, storeWith } from "./fixtures";
import { getPixel, solid } from "./helpers";

/** a stand-in for the canvas rasteriser: a block as big as the shape, its colour decided by the shape's own numbers, so any
 *  difference in placement, size, order or colour between two renderings shows up in the pixels */
const fake: Rasterize = (content, t) => {
  const key = JSON.stringify(content);
  let h = 7;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { image: solid(Math.max(1, Math.ceil(content.width)), Math.max(1, Math.ceil(content.height)), [h & 255, (h >> 8) & 255, (h >> 16) & 255, 255]), x: Math.round(t.x), y: Math.round(t.y) };
};

describe("source previews match what inserting gives", () => {
  test("every built-in: the preview equals the screen after inserting it (same renderer, same pixels)", () => {
    for (const a of BUILTIN_ASSETS) {
      const bundle = a.build();
      const f = previewFrame(bundle)!;
      expect(f, a.id).not.toBeNull();
      const preview = renderBundle(bundle, { rasterize: fake })!;
      expect([preview.width, preview.height]).toEqual([f.width, f.height]);

      // the real path: a transparent page of the preview's size, the bundle inserted at the same place, then the export's renderer
      const ctx = storeWith(createRawImage(f.width, f.height));
      const shifted = { ...bundle, layers: bundle.layers.map((l) => ({ ...l, transform: { ...l.transform, x: Math.round((l.transform.x + f.dx) * 100) / 100, y: Math.round((l.transform.y + f.dy) * 100) / 100 } })) };
      expect(ctx.get().insertAsset(shifted, "keep"), a.id).not.toBeNull();
      const real = renderProjectRaw(ctx.get().snapshotProject()!, ctx.get().images, fake);
      expect(real.width).toBe(preview.width);
      expect(Buffer.from(preview.data).equals(Buffer.from(real.data)), a.id).toBe(true);
      expect(preview.data.some((v, i) => i % 4 === 3 && v > 0), `${a.id} is not blank`).toBe(true);
    }
  });

  test("a template's preview is its whole screen: the size of the frame, page colour included, equal to the project it opens", () => {
    for (const t of TEMPLATES) {
      const frame = templateFrame(t.id);
      const preview = renderBundle(templateBundle(t.id), { frame, rasterize: fake })!;
      const { project, images } = buildTemplate(t.id);
      const real = renderProjectRaw(project, images, fake);
      expect([preview.width, preview.height]).toEqual([390, 844]);
      expect(Buffer.from(preview.data).equals(Buffer.from(real.data)), t.id).toBe(true);
    }
  });

  test("a bitmap source (my sources) previews with its picture, in the stacking order it has", async () => {
    const ctx = storeWith(solid(100, 80, [240, 240, 240, 255]));
    const a = ctx.get().addImageLayer({ raw: solid(20, 10, [255, 0, 0, 255]), name: "a" })!;
    expect(a).toBeTruthy();
    const layers = ctx.get().history!.present.screens[0].layers;
    const bundle = captureBundle("x", layers, ctx.get().images)!;
    const p = renderBundle(bundle, { rasterize: fake, margin: 0 })!;
    expect([p.width, p.height]).toEqual([20, 10]);
    expect(Array.from(getPixel(p, 5, 5))).toEqual([255, 0, 0, 255]);
  });

  test("the preview is transparent where the source is: no checkerboard and no page colour in the pixels", () => {
    const p = renderBundle(BUILTIN_ASSETS.find((a) => a.id === "divider")!.build(), { rasterize: fake, margin: 6 })!;
    expect(Array.from(getPixel(p, 0, 0))).toEqual([0, 0, 0, 0]);
    expect(Array.from(getPixel(p, 8, 6))[3]).toBe(255);
  });

  test("unusable bundles give null instead of throwing: no layers, a bitmap without its picture, an empty picture", () => {
    expect(renderBundle({ name: "x", layers: [], images: {} })).toBeNull();
    const base = BUILTIN_ASSETS[0].build();
    const bitmap = { name: "b", crop: { x: 0, y: 0, width: 5, height: 5 }, imageKey: "k", transform: base.layers[0].transform, opacity: 1 };
    expect(renderBundle({ name: "x", layers: [bitmap], images: {} })).toBeNull();
    expect(renderBundle({ name: "x", layers: [bitmap], images: { k: { width: 0, height: 0, data: new Uint8ClampedArray(0) } } })).toBeNull();
    expect(renderBundle({ name: "x", layers: [bitmap], images: { k: { width: 5, height: 5, data: new Uint8ClampedArray(3) } } })).toBeNull(); // damaged data
  });
});

describe("shrinkToFit", () => {
  test("keeps the proportions, never enlarges, and keeps a thin line visible without dark edges", () => {
    const wide = createRawImage(400, 100);
    expect(shrinkToFit(wide, 100, 100)).toMatchObject({ width: 100, height: 25 });
    const small = createRawImage(10, 10);
    expect(shrinkToFit(small, 100, 100)).toBe(small);
    // a 1px opaque coloured line on transparent: shrinking 8x must keep its colour (premultiplied), only fainter
    const line = createRawImage(80, 80, [255, 255, 255, 0]); // the invisible pixels carry a colour that must not leak in
    for (let x = 0; x < 80; x++) line.data.set([200, 100, 50, 255], (40 * 80 + x) * 4);
    const s = shrinkToFit(line, 10, 10);
    const px = Array.from(getPixel(s, 4, 5));
    expect(px.slice(0, 3)).toEqual([200, 100, 50]);
    expect(px[3]).toBeGreaterThan(0);
    expect(px[3]).toBeLessThan(255);
  });
});

describe("preview cache", () => {
  test("remembers by key, forgets by prefix, and holds a bounded number", () => {
    const c = new PreviewCache(3);
    const img = createRawImage(1, 1);
    c.set("mine:1:5", img);
    c.set("mine:2:5", null);
    expect(c.get("mine:1:5")?.value).toBe(img);
    expect(c.get("mine:2:5")?.value).toBeNull(); // a failed draw is remembered too
    expect(c.get("other")).toBeUndefined();
    c.drop("mine:1:");
    expect(c.get("mine:1:5")).toBeUndefined();
    c.set("a", img); c.set("b", img); c.set("c", img);
    expect(c.size).toBe(3);
    expect(c.get("mine:2:5")).toBeUndefined(); // the oldest went
  });
});

describe("my sources: previews follow the library", () => {
  test("saved, listed and drawn; deleted ones are gone; an empty library has nothing to draw; a damaged record is a null, not an error", async () => {
    const lib = await openAssetLibrary(fakeCodec(), "t", new IDBFactory());
    expect(await lib.list()).toEqual([]);
    const bundle = BUILTIN_ASSETS.find((a) => a.id === "tag")!.build();
    const rec = await lib.add(bundle, "Tag");
    const loaded = (await lib.load(rec.id))!;
    expect(renderBundle(loaded, { rasterize: fake })).not.toBeNull();
    await lib.remove(rec.id);
    expect(await lib.list()).toEqual([]);
    expect(await lib.load(rec.id)).toBeNull();
    // a record whose picture is missing cannot be previewed: renderBundle says so with null
    const broken = { ...bundle, layers: [{ ...bundle.layers[0], content: undefined, imageKey: "gone" }] };
    expect(renderBundle(broken, { rasterize: fake })).toBeNull();
    lib.close();
  });
});
