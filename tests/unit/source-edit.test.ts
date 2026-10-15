import fs from "node:fs";
import { describe, expect, test } from "vitest";
import { applyStroke } from "@/features/brush/brush";
import { startLiquifyStroke } from "@/features/liquify/liquify";
import { parseProjectFile } from "@/features/project-persistence/project-file";
import { pruneBlobStore, referencedImageIds } from "@/features/project-persistence/sync-images";
import { SOURCE_ERASER_MESSAGE, SOURCE_LAYER_ID, SOURCE_LOCKED_MESSAGE, isSourceEdited, isSourceLocked, pureOriginalId, sourceAsLayer, targetLayerOf } from "@/features/source-edit/source-edit";
import { startFingerStroke } from "@/features/smudge/finger";
import { PaintStroke } from "@/lib/image/brush-raster";
import { createRawImage, RawImage } from "@/lib/image/raw-image";
import { parseProjectValue } from "@/lib/project/parse";
import { CURRENT_VERSION } from "@/lib/project/schema";
import { BlobStore } from "@/lib/storage/blob-store";
import { CARD, GRAY, committedId, solidPage, storeWith } from "./fixtures";
import { getPixel, setPixel, solid } from "./helpers";

const RED: [number, number, number, number] = [255, 0, 0, 255];
const bytes = (img: RawImage) => Array.from(img.data);
const copy = (img: RawImage): RawImage => ({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });
const source = (ctx: ReturnType<typeof storeWith>) => ctx.get().history!.present.screens[0].source;
const pictureOf = (ctx: ReturnType<typeof storeWith>) => ctx.get().images.get(source(ctx).imageId)!.raw;
const steps = (ctx: ReturnType<typeof storeWith>) => ctx.get().history!.past.length;
/** a copy of the page with a red square at (5, 5) */
const edited = (ctx: ReturnType<typeof storeWith>) => {
  const raw = copy(pictureOf(ctx));
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) setPixel(raw, x, y, RED);
  return raw;
};
/** a stand-in for the canvas brush: paints a 4×4 square of the colour at the first point, on a copy of the base */
const fakePaint: PaintStroke = (base, stroke) => {
  const raw = copy(base!.raw);
  const p = stroke.points[0];
  for (let y = Math.round(p.y); y < Math.round(p.y) + 4; y++) for (let x = Math.round(p.x); x < Math.round(p.x) + 4; x++) setPixel(raw, x, y, RED);
  return { raw, x: base!.x, y: base!.y };
};

describe("the original picture is locked by default", () => {
  test("a new project: locked, never edited, the original is the source itself", () => {
    const ctx = storeWith();
    const s = source(ctx);
    expect(s.unlocked).toBeUndefined();
    expect(s.originalImageId).toBeUndefined();
    expect(isSourceLocked(s)).toBe(true);
    expect(isSourceEdited(s)).toBe(false);
    expect(pureOriginalId(s)).toBe(s.imageId);
  });

  test("a blank canvas and a template are locked too", () => {
    const ctx = storeWith();
    expect(ctx.get().newBlankProject({ width: 50, height: 40, color: "#ffffff" })).toBeNull();
    expect(isSourceLocked(source(ctx))).toBe(true);
  });

  test("unlocking and locking are undo steps; a lock that changes nothing is not", () => {
    const ctx = storeWith();
    expect(ctx.get().setSourceLocked(true)).toBe(false);
    expect(steps(ctx)).toBe(0);
    expect(ctx.get().setSourceLocked(false)).toBe(true);
    expect(source(ctx).unlocked).toBe(true);
    expect(steps(ctx)).toBe(1);
    expect(ctx.get().setSourceLocked(false)).toBe(false);
    expect(ctx.get().setSourceLocked(true)).toBe(true);
    expect(isSourceLocked(source(ctx))).toBe(true);
    ctx.get().undo();
    expect(source(ctx).unlocked).toBe(true);
    ctx.get().undo();
    expect(isSourceLocked(source(ctx))).toBe(true);
  });

  test("while comparing the lock cannot be changed", () => {
    const ctx = storeWith();
    ctx.get().setCompareMode("original");
    expect(ctx.get().setSourceLocked(false)).toBe(false);
    expect(isSourceLocked(source(ctx))).toBe(true);
  });
});

describe("editing the unlocked original", () => {
  test("locked: nothing is accepted", () => {
    const ctx = storeWith();
    const before = source(ctx).imageId;
    expect(ctx.get().commitSourceEdit(edited(ctx), "x")).toBe(false);
    expect(source(ctx).imageId).toBe(before);
    expect(steps(ctx)).toBe(0);
  });

  test("a new imageId, the uploaded picture kept, ONE undo step, the uploaded pixels untouched", () => {
    const ctx = storeWith();
    const first = source(ctx).imageId;
    const uploaded = bytes(pictureOf(ctx));
    ctx.get().setSourceLocked(false);
    const base = steps(ctx);
    expect(ctx.get().commitSourceEdit(edited(ctx), "원본 수정")).toBe(true);
    const s = source(ctx);
    expect(s.imageId).not.toBe(first);
    expect(s.originalImageId).toBe(first);
    expect(isSourceEdited(s)).toBe(true);
    expect(steps(ctx)).toBe(base + 1);
    expect(getPixel(pictureOf(ctx), 7, 7)).toEqual(RED);
    expect(bytes(ctx.get().images.get(first)!.raw)).toEqual(uploaded); // never changed
    ctx.get().undo();
    expect(source(ctx).imageId).toBe(first);
    expect(source(ctx).originalImageId).toBeUndefined();
    ctx.get().redo();
    expect(source(ctx).originalImageId).toBe(first);
  });

  test("later edits keep the same uploaded picture", () => {
    const ctx = storeWith();
    const first = source(ctx).imageId;
    ctx.get().setSourceLocked(false);
    ctx.get().commitSourceEdit(edited(ctx), "a");
    const second = source(ctx).imageId;
    ctx.get().commitSourceEdit(solid(60, 40, [1, 2, 3, 255]), "b");
    expect(source(ctx).originalImageId).toBe(first);
    expect(source(ctx).imageId).not.toBe(second);
    expect(pureOriginalId(source(ctx))).toBe(first);
  });

  test("a picture of another size, or while comparing, is refused", () => {
    const ctx = storeWith();
    ctx.get().setSourceLocked(false);
    expect(ctx.get().commitSourceEdit(solid(10, 10, GRAY), "x")).toBe(false);
    ctx.get().setCompareMode("split");
    expect(ctx.get().commitSourceEdit(edited(ctx), "x")).toBe(false);
    expect(isSourceEdited(source(ctx))).toBe(false);
  });

  test("locking again keeps the edit; the edit stays refused until it is unlocked", () => {
    const ctx = storeWith();
    ctx.get().setSourceLocked(false);
    ctx.get().commitSourceEdit(edited(ctx), "a");
    ctx.get().setSourceLocked(true);
    expect(isSourceEdited(source(ctx))).toBe(true);
    expect(ctx.get().commitSourceEdit(edited(ctx), "b")).toBe(false);
    expect(ctx.get().revertSource()).toBe(false);
  });

  test("an extraction cuts from the edited original, never from patches or layers", () => {
    const ctx = storeWith();
    ctx.get().setSourceLocked(false);
    const raw = copy(pictureOf(ctx));
    for (let y = CARD.y; y < CARD.y + CARD.height; y++) for (let x = CARD.x; x < CARD.x + CARD.width; x++) setPixel(raw, x, y, RED);
    ctx.get().commitSourceEdit(raw, "a");
    const id = committedId(ctx.get().beginExtraction({ ...CARD }) as never);
    const layer = ctx.layers().find((l) => l.id === id)!;
    expect(getPixel(ctx.get().images.get(layer.imageId!)!.raw, 3, 3)).toEqual(RED);
    // the uploaded picture is still blue there
    expect(getPixel(ctx.get().images.get(source(ctx).originalImageId!)!.raw, CARD.x + 3, CARD.y + 3)).toEqual([0, 0, 255, 255]);
  });
});

describe("back to the original", () => {
  test("restores the uploaded picture in ONE undo step, however many edits there were; undo brings the edits back", () => {
    const ctx = storeWith();
    const first = source(ctx).imageId;
    ctx.get().setSourceLocked(false);
    ctx.get().commitSourceEdit(edited(ctx), "a");
    ctx.get().commitSourceEdit(solid(60, 40, [9, 9, 9, 255]), "b");
    const afterEdits = source(ctx).imageId;
    const base = steps(ctx);
    expect(ctx.get().revertSource()).toBe(true);
    expect(steps(ctx)).toBe(base + 1);
    expect(source(ctx).imageId).toBe(first);
    expect(source(ctx).originalImageId).toBeUndefined(); // unedited again: no second copy
    expect(ctx.get().revertSource()).toBe(false); // nothing to revert
    ctx.get().undo();
    expect(source(ctx).imageId).toBe(afterEdits);
    expect(source(ctx).originalImageId).toBe(first);
  });

  test("not while comparing", () => {
    const ctx = storeWith();
    ctx.get().setSourceLocked(false);
    ctx.get().commitSourceEdit(edited(ctx), "a");
    ctx.get().setCompareMode("original");
    expect(ctx.get().revertSource()).toBe(false);
  });
});

describe("selecting the original", () => {
  test("it is the selection only while no layer or patch is; choosing one lets it go; undo keeps it", () => {
    const ctx = storeWith();
    const id = committedId(ctx.get().beginExtraction({ ...CARD }) as never);
    ctx.get().selectSource();
    expect(ctx.get().sourceSelected).toBe(true);
    expect(ctx.get().selectedLayerIds).toEqual([]);
    ctx.get().undo(); // the extraction goes
    ctx.get().redo();
    expect(ctx.get().sourceSelected).toBe(true);
    ctx.get().selectLayer(id);
    expect(ctx.get().sourceSelected).toBe(false);
    ctx.get().selectSource();
    ctx.get().deselectAll();
    expect(ctx.get().sourceSelected).toBe(false);
    ctx.get().selectSource();
    ctx.get().selectPatch(ctx.patches()[0].id);
    expect(ctx.get().sourceSelected).toBe(false);
  });
});

describe("the tools and the original", () => {
  test("the stand-in layer is the page's size at the origin, locked as the source is", () => {
    const ctx = storeWith();
    const screen = ctx.get().history!.present.screens[0];
    const l = sourceAsLayer(screen);
    expect(l.id).toBe(SOURCE_LAYER_ID);
    expect(l.imageId).toBe(screen.source.imageId);
    expect(l.locked).toBe(true);
    expect(l.transform).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
    expect(targetLayerOf(screen, SOURCE_LAYER_ID)).toBeDefined();
    expect(screen.layers.some((x) => x.id === SOURCE_LAYER_ID)).toBe(false); // never a real layer
  });

  test("finger and liquify refuse the locked original with the lock message, and work on it once unlocked (one step, a new imageId)", () => {
    for (const start of [startFingerStroke, startLiquifyStroke]) {
      const ctx = storeWith(solidPage(80, 60));
      const r = start(ctx.store, SOURCE_LAYER_ID);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toBe(SOURCE_LOCKED_MESSAGE);
      ctx.get().setSourceLocked(false);
      const raw = copy(pictureOf(ctx));
      for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) setPixel(raw, x, y, RED);
      ctx.get().commitSourceEdit(raw, "setup");
      const before = source(ctx).imageId, base = steps(ctx), layersBefore = ctx.layers().length;
      const s = start(ctx.store, SOURCE_LAYER_ID);
      expect(s.ok).toBe(true);
      if (!s.ok) return;
      for (const p of [{ x: 30, y: 30 }, { x: 50, y: 30 }, { x: 70, y: 30 }]) s.stroke.move(p);
      expect(s.stroke.finish()).toBe(true);
      expect(source(ctx).imageId).not.toBe(before);
      expect(steps(ctx)).toBe(base + 1);
      expect(ctx.layers().length).toBe(layersBefore); // no layer was made
      expect(source(ctx).originalImageId).toBeDefined();
      ctx.get().undo();
      expect(source(ctx).imageId).toBe(before);
    }
  });

  test("a stroke that moves nothing leaves no trace on the unlocked original", () => {
    const ctx = storeWith(solidPage(80, 60));
    ctx.get().setSourceLocked(false);
    const base = steps(ctx);
    const s = startFingerStroke(ctx.store, SOURCE_LAYER_ID);
    if (!s.ok) throw new Error("should start");
    s.stroke.move({ x: 10, y: 10 });
    expect(s.stroke.finish()).toBe(false);
    expect(steps(ctx)).toBe(base);
    expect(isSourceEdited(source(ctx))).toBe(false);
  });

  test("the brush: locked refuses with the message; unlocked paints the original as one step; the eraser never works on it", () => {
    const ctx = storeWith(solidPage(80, 60));
    ctx.get().selectSource();
    const points = [{ x: 10, y: 10 }];
    let out = applyStroke({ store: ctx.store, tool: "brush", points, paint: fakePaint });
    expect(out).toMatchObject({ status: "refused", reason: SOURCE_LOCKED_MESSAGE });
    expect(ctx.get().notice).toContain(SOURCE_LOCKED_MESSAGE);
    expect(ctx.layers()).toHaveLength(0); // it did not make a brush layer instead
    ctx.get().setSourceLocked(false);
    const base = steps(ctx);
    out = applyStroke({ store: ctx.store, tool: "brush", points, paint: fakePaint });
    expect(out.status).toBe("painted");
    expect(steps(ctx)).toBe(base + 1);
    expect(getPixel(pictureOf(ctx), 11, 11)).toEqual(RED);
    expect(ctx.layers()).toHaveLength(0);
    const refused = applyStroke({ store: ctx.store, tool: "eraser", points, paint: fakePaint });
    expect(refused).toMatchObject({ status: "refused", reason: SOURCE_ERASER_MESSAGE });
    expect(steps(ctx)).toBe(base + 1);
  });

  test("with no original selected the brush still makes its own layer, as before", () => {
    const ctx = storeWith(solidPage(80, 60));
    const out = applyStroke({ store: ctx.store, tool: "brush", points: [{ x: 10, y: 10 }], paint: (b, s, f) => ({ raw: solid(4, 4, RED), x: 10, y: 10 }) });
    expect(out.status).toBe("painted");
    expect(ctx.layers()).toHaveLength(1);
    expect(isSourceEdited(source(ctx))).toBe(false);
  });
});

describe("memory: the uploaded picture is kept, old steps are dropped by the budget", () => {
  test("with a tiny budget the oldest undo steps go but the uploaded picture and the present one stay", () => {
    const page = solidPage(60, 40); // 9600 bytes a picture
    const ctx = storeWith(page, "capture.png", { imageBudget: 9600 * 2 });
    const first = source(ctx).imageId;
    ctx.get().setSourceLocked(false);
    for (let i = 0; i < 8; i++) ctx.get().commitSourceEdit(solid(60, 40, [i * 10, 0, 0, 255]), `e${i}`);
    expect(ctx.get().images.has(first)).toBe(true); // never freed
    expect(ctx.get().images.has(source(ctx).imageId)).toBe(true);
    const present = [...ctx.get().images.keys()];
    expect(present.length).toBeLessThanOrEqual(1 + 1 + 2 + 1); // uploaded + present + about two replaced pictures
    expect(steps(ctx)).toBeLessThan(10); // some steps were dropped
    expect(ctx.get().revertSource()).toBe(true);
    expect(bytes(ctx.get().images.get(first)!.raw)).toEqual(bytes(page));
  });
});

describe("the canvas size resets the baseline", () => {
  test("after a resize 'the original' is the resized picture (the uploaded one has another size)", () => {
    const ctx = storeWith(solidPage(60, 40));
    ctx.get().setSourceLocked(false);
    ctx.get().commitSourceEdit(edited(ctx), "a");
    expect(ctx.get().resizeCanvas({ width: 80, height: 50, ax: 1, ay: 1, layers: "follow", fill: "#ffffff" })).toBeNull();
    expect(source(ctx).originalImageId).toBeUndefined();
    expect(pictureOf(ctx).width).toBe(80);
    expect(source(ctx).unlocked).toBe(true); // the lock is not changed by it
    ctx.get().undo();
    expect(isSourceEdited(source(ctx))).toBe(true);
  });
});

describe("saving, opening and the blob store", () => {
  test("the uploaded picture is one of the images a project needs, once", () => {
    const ctx = storeWith();
    ctx.get().setSourceLocked(false);
    ctx.get().commitSourceEdit(edited(ctx), "a");
    const project = ctx.get().snapshotProject()!;
    const ids = referencedImageIds(project);
    expect(ids).toContain(project.screens[0].source.imageId);
    expect(ids).toContain(project.screens[0].source.originalImageId);
    expect(new Set(ids).size).toBe(ids.length);
    const plain = storeWith();
    expect(referencedImageIds(plain.get().snapshotProject()!)).toHaveLength(1); // never edited: one image, no duplicate
  });

  test("pruning keeps the uploaded picture and the edited one, and removes only what nothing refers to", async () => {
    const ctx = storeWith();
    ctx.get().setSourceLocked(false);
    ctx.get().commitSourceEdit(edited(ctx), "a");
    const project = ctx.get().snapshotProject()!;
    const map = new Map<string, Blob>();
    const blobs: BlobStore = { has: async (k: string) => map.has(k), get: async (k: string) => map.get(k), put: async (k: string, b: Blob) => void map.set(k, b), delete: async (k: string) => void map.delete(k), keys: async () => [...map.keys()], clear: async () => map.clear(), close: () => {} };
    for (const id of referencedImageIds(project)) await blobs.put(id, new Blob(["x"]));
    await blobs.put("stale", new Blob(["x"]));
    expect(await pruneBlobStore(project, blobs)).toEqual(["stale"]);
    expect(await blobs.has(project.screens[0].source.originalImageId!)).toBe(true);
    expect(await blobs.has(project.screens[0].source.imageId)).toBe(true);
  });

  test("the file format: the new fields round-trip and bad ones are refused", () => {
    const ctx = storeWith();
    ctx.get().setSourceLocked(false);
    ctx.get().commitSourceEdit(edited(ctx), "a");
    const project = JSON.parse(JSON.stringify(ctx.get().snapshotProject()));
    expect(parseProjectValue(project).ok).toBe(true);
    const bad = (mut: (p: any) => void) => {
      const p = JSON.parse(JSON.stringify(project));
      mut(p);
      return parseProjectValue(p);
    };
    expect(bad((p) => (p.screens[0].source.unlocked = "yes")).ok).toBe(false);
    expect(bad((p) => (p.screens[0].source.originalImageId = "blob:abc")).ok).toBe(false);
    expect(bad((p) => (p.screens[0].source.originalImageId = 7)).ok).toBe(false);
  });

  test("a file saved by the previous build (version 12) opens as version 13, locked and never edited", () => {
    const v12 = fs.readFileSync("tests/fixtures/project-v12.slc.json", "utf8");
    const before = JSON.parse(v12).project;
    expect(before.version).toBe(12);
    expect(before.screens[0].source.unlocked).toBeUndefined();
    const r = parseProjectFile(v12);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.project.version).toBe(CURRENT_VERSION);
    expect(CURRENT_VERSION).toBe(14);
    const s = r.file.project.screens[0].source;
    expect(s.unlocked).toBeUndefined();
    expect(s.originalImageId).toBeUndefined();
    expect(isSourceLocked(s)).toBe(true);
    expect(r.file.project.screens[0].layers).toEqual(before.screens[0].layers);
  });
});
