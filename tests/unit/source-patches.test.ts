import fs from "node:fs";
import { describe, expect, test } from "vitest";
import { parseProjectFile } from "@/features/project-persistence/project-file";
import { renderProjectRaw } from "@/features/export-image/export-png";
import { adjustPictureAsync, adjustWorkerAvailable } from "@/features/source-edit/adjust-client";
import { adjustedPicture } from "@/lib/image/adjust";
import { changedBox, patchesOver, visiblePatches } from "@/features/source-edit/source-edit";
import { parseProjectValue } from "@/lib/project/parse";
import { BackgroundPatch, CURRENT_VERSION } from "@/lib/project/schema";
import { CARD, committedId, storeWith } from "./fixtures";
import { createRawImage, RawImage } from "@/lib/image/raw-image";
import { getPixel, setPixel, solid } from "./helpers";

const RED: [number, number, number, number] = [255, 0, 0, 255];
const BLUE: [number, number, number, number] = [0, 0, 255, 255];
const patch = (id: string, x: number, y: number, w: number, h: number, hidden?: boolean): BackgroundPatch => ({ id, rect: { x, y, width: w, height: h }, fill: "#f0f0f0", ...(hidden ? { hidden } : {}) });
const noRaster = () => null;

/** a project with the card extracted (one patch over the card's place) */
const withPatch = () => {
  const ctx = storeWith();
  const id = committedId(ctx.get().beginExtraction({ ...CARD }) as never);
  ctx.get().deleteLayer(id); // the cut-out layer would cover the patch: what is left is the patch over the original
  return ctx;
};
const render = (ctx: ReturnType<typeof storeWith>) => renderProjectRaw(ctx.get().snapshotProject()!, ctx.get().images, noRaster);
const steps = (ctx: ReturnType<typeof storeWith>) => ctx.get().history!.past.length;

describe("hiding and deleting background patches", () => {
  test("they refuse while the original is locked", () => {
    const ctx = withPatch();
    const id = ctx.patches()[0].id;
    expect(ctx.get().setPatchHidden(id, true)).toBe(false);
    expect(ctx.get().deletePatches([id])).toBe(0);
    expect(ctx.patches()).toHaveLength(1);
  });

  test("while comparing they refuse too", () => {
    const ctx = withPatch();
    ctx.get().setSourceLocked(false);
    ctx.get().setCompareMode("split");
    const id = ctx.patches()[0].id;
    expect(ctx.get().setPatchHidden(id, true)).toBe(false);
    expect(ctx.get().deletePatches([id])).toBe(0);
    expect(ctx.patches()[0].hidden).toBeUndefined();
  });

  test("hide: one undo step, the PNG shows the original again; show brings the patch back", () => {
    const ctx = withPatch();
    ctx.get().setSourceLocked(false);
    const id = ctx.patches()[0].id;
    expect(getPixel(render(ctx), CARD.x + 3, CARD.y + 3)).toEqual([240, 240, 240, 255]); // the patch covers the blue card
    const base = steps(ctx);
    expect(ctx.get().setPatchHidden(id, true)).toBe(true);
    expect(steps(ctx)).toBe(base + 1);
    expect(ctx.patches()[0].hidden).toBe(true);
    expect(getPixel(render(ctx), CARD.x + 3, CARD.y + 3)).toEqual(BLUE); // the original shows through
    expect(ctx.get().setPatchHidden(id, true)).toBe(false); // already hidden: nothing
    expect(ctx.get().setPatchHidden(id, false)).toBe(true);
    expect(ctx.patches()[0].hidden).toBeUndefined();
    expect(getPixel(render(ctx), CARD.x + 3, CARD.y + 3)).toEqual([240, 240, 240, 255]);
    ctx.get().undo();
    expect(ctx.patches()[0].hidden).toBe(true);
  });

  test("delete: one undo step for all, the selection is let go, undo brings them back", () => {
    const ctx = withPatch();
    ctx.get().setSourceLocked(false);
    committedId(ctx.get().beginExtraction({ x: 40, y: 5, width: 10, height: 10 }) as never);
    const [a, b] = ctx.patches().map((p) => p.id);
    ctx.get().selectPatch(a);
    const base = steps(ctx);
    expect(ctx.get().deletePatches([a, b, "nothing"])).toBe(2);
    expect(steps(ctx)).toBe(base + 1);
    expect(ctx.patches()).toHaveLength(0);
    expect(ctx.get().selectedPatchId).toBeNull();
    expect(getPixel(render(ctx), CARD.x + 3, CARD.y + 3)).toEqual(BLUE);
    expect(ctx.get().deletePatches([a])).toBe(0);
    ctx.get().undo();
    expect(ctx.patches()).toHaveLength(2);
  });

  test("a hidden patch is not drawn, in the PNG or in what the fill tool can pick", () => {
    expect(visiblePatches([patch("a", 0, 0, 5, 5), patch("b", 9, 9, 3, 3, true)]).map((p) => p.id)).toEqual(["a"]);
    const same = [patch("a", 0, 0, 5, 5)];
    expect(visiblePatches(same)).toBe(same); // nothing hidden: the very same array (no repaint)
  });
});

describe("an edit under a patch is reported", () => {
  const unlocked = () => {
    const ctx = withPatch();
    ctx.get().setSourceLocked(false);
    return ctx;
  };
  const editAt = (ctx: ReturnType<typeof storeWith>, x: number, y: number) => {
    const raw = { width: 60, height: 40, data: new Uint8ClampedArray(ctx.get().images.get(ctx.get().history!.present.screens[0].source.imageId)!.raw.data) } as RawImage;
    setPixel(raw, x, y, RED);
    return ctx.get().commitSourceEdit(raw, "e");
  };

  test("the box of changed pixels, and the drawn patches it lies over", () => {
    const a = solid(20, 10, [1, 1, 1, 255]);
    const b = { width: 20, height: 10, data: new Uint8ClampedArray(a.data) };
    expect(changedBox(a, b)).toBeNull();
    setPixel(b, 4, 2, RED);
    setPixel(b, 9, 6, RED);
    expect(changedBox(a, b)).toEqual({ x: 4, y: 2, width: 6, height: 5 });
    expect(changedBox(a, createRawImage(5, 5))).toBeNull(); // another size
    const ps = [patch("in", 0, 0, 6, 4), patch("out", 15, 0, 4, 4), patch("hidden", 3, 1, 8, 8, true)];
    expect(patchesOver(ps, { x: 4, y: 2, width: 6, height: 5 }).map((p) => p.id)).toEqual(["in"]);
    expect(patchesOver(ps, null)).toEqual([]);
  });

  test("an edit inside a patch: the patch is named and a notice says it is hidden under it", () => {
    const ctx = unlocked();
    const id = ctx.patches()[0].id;
    expect(editAt(ctx, CARD.x + 2, CARD.y + 2)).toBe(true);
    expect(ctx.get().sourceEditCovered).toEqual([id]);
    expect(ctx.get().notice).toContain("배경 패치 1개");
    // deleting it makes the edit show, and the report goes away
    expect(ctx.get().deletePatches(ctx.get().sourceEditCovered)).toBe(1);
    expect(ctx.get().sourceEditCovered).toEqual([]);
    expect(getPixel(render(ctx), CARD.x + 2, CARD.y + 2)).toEqual(RED);
  });

  test("an edit away from the patches reports nothing; neither does one under a hidden patch", () => {
    const ctx = unlocked();
    expect(editAt(ctx, 50, 35)).toBe(true);
    expect(ctx.get().sourceEditCovered).toEqual([]);
    ctx.get().setNotice(null);
    ctx.get().setPatchHidden(ctx.patches()[0].id, true);
    expect(editAt(ctx, CARD.x + 2, CARD.y + 2)).toBe(true);
    expect(ctx.get().sourceEditCovered).toEqual([]);
    expect(ctx.get().notice).toBeNull();
  });

  test("undo clears the report", () => {
    const ctx = unlocked();
    editAt(ctx, CARD.x + 2, CARD.y + 2);
    expect(ctx.get().sourceEditCovered).toHaveLength(1);
    ctx.get().undo();
    expect(ctx.get().sourceEditCovered).toEqual([]);
  });
});

describe("the file format (version 14)", () => {
  test("`hidden` round-trips; a value that is not true or false is refused", () => {
    const ctx = withPatch();
    ctx.get().setSourceLocked(false);
    ctx.get().setPatchHidden(ctx.patches()[0].id, true);
    const project = JSON.parse(JSON.stringify(ctx.get().snapshotProject()));
    expect(project.version).toBe(CURRENT_VERSION);
    expect(parseProjectValue(project).ok).toBe(true);
    expect(project.screens[0].backgroundPatches[0].hidden).toBe(true);
    project.screens[0].backgroundPatches[0].hidden = "yes";
    expect(parseProjectValue(project).ok).toBe(false);
  });

  test("a file saved by the previous build (version 13) opens as version 14 with its patches drawn", () => {
    const v13 = fs.readFileSync("tests/fixtures/project-v13.slc.json", "utf8");
    const before = JSON.parse(v13).project;
    expect(before.version).toBe(13);
    expect(before.screens[0].source.unlocked).toBe(true);
    const r = parseProjectFile(v13);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.project.version).toBe(14);
    expect(r.file.project.screens[0].backgroundPatches).toEqual(before.screens[0].backgroundPatches);
    expect(r.file.project.screens[0].backgroundPatches.every((p) => !p.hidden)).toBe(true);
    expect(r.file.project.screens[0].source.unlocked).toBe(true);
  });
});

describe("the original's adjustment is made by the same function as everywhere", () => {
  test("without Workers (here) it is made on the spot and equals adjustedPicture byte for byte", async () => {
    expect(adjustWorkerAvailable()).toBe(false); // node: no Worker, so this is the fallback path; in a browser the worker runs the same function
    const img = solid(40, 30, [200, 120, 40, 255]);
    for (let x = 10; x < 20; x++) setPixel(img, x, 5, RED);
    const adj = { brightness: 20, contrast: -10, saturation: 30, hue: 40, blur: 2, sharpen: 10 };
    const { image } = await adjustPictureAsync(img, adj);
    expect(Buffer.from(image.data).equals(Buffer.from(adjustedPicture(img, adj).data))).toBe(true);
    expect([image.width, image.height]).toEqual([40, 30]);
  });
});