import { describe, expect, test } from "vitest";
import { renderProjectPng } from "@/features/export-image/export-png";
import { CARD, committedId, fakeCodec, solidPage, splitPage, storeWith } from "./fixtures";
import { getPixel } from "./helpers";

const withLayer = () => {
  const ctx = storeWith();
  return { ...ctx, id: committedId(ctx.get().beginExtraction(CARD)) };
};

describe("compare mode", () => {
  test("starts off, and can be set to original and to side by side", () => {
    const { get } = storeWith();
    expect(get().compareMode).toBe("off");
    get().setCompareMode("original");
    expect(get().compareMode).toBe("original");
    get().setCompareMode("split");
    expect(get().compareMode).toBe("split");
    get().setCompareMode("off");
    expect(get().compareMode).toBe("off");
  });

  test("it is not part of the project and not an undo step", () => {
    const ctx = withLayer();
    const history = ctx.get().history;
    ctx.get().setCompareMode("split");
    expect(ctx.get().history).toBe(history);
    expect(ctx.get().snapshotProject()).toEqual({ ...history!.present, canvas: ctx.get().view });
  });

  test("a new project and an opened one start with comparing off", () => {
    const ctx = withLayer();
    ctx.get().setCompareMode("original");
    ctx.get().newProject({ fileName: "b.png", raw: solidPage(10, 10) });
    expect(ctx.get().compareMode).toBe("off");
    ctx.get().setCompareMode("split");
    ctx.get().loadProject(ctx.get().snapshotProject()!, ctx.get().images);
    expect(ctx.get().compareMode).toBe("off");
  });

  test("switching drops a drag or a colour question that was under way", () => {
    const ctx = withLayer();
    ctx.get().previewLayerDrag(ctx.id, 30, 30);
    ctx.get().setCompareMode("original");
    expect(ctx.get().dragPreview).toBeNull();

    const split = storeWith(splitPage());
    split.get().beginExtraction({ x: 10, y: 10, width: 20, height: 10 });
    expect(split.get().pendingExtraction).not.toBeNull();
    split.get().setCompareMode("split");
    expect(split.get().pendingExtraction).toBeNull();
  });
});

describe.each(["original", "split"] as const)("while comparing (%s) nothing can be edited", (mode) => {
  const setup = () => {
    const ctx = withLayer();
    ctx.get().setCompareMode(mode);
    return { ...ctx, history: ctx.get().history };
  };

  test("extracting is refused, and leaves no layer, patch or history entry", () => {
    const ctx = setup();
    expect(ctx.get().beginExtraction({ x: 40, y: 25, width: 10, height: 10 })).toEqual({ status: "rejected", reason: "comparing" });
    expect(ctx.get().history).toBe(ctx.history);
    expect(ctx.get().pendingExtraction).toBeNull();
  });

  test("moving a layer is refused", () => {
    const ctx = setup();
    ctx.get().previewLayerDrag(ctx.id, 5, 5);
    expect(ctx.get().dragPreview).toBeNull();
    expect(ctx.get().commitLayerDrag()).toBe(false);
    expect(ctx.get().history).toBe(ctx.history);
  });

  test("a drag that began before comparing is dropped, not committed, if comparing starts", () => {
    const ctx = withLayer();
    ctx.get().previewLayerDrag(ctx.id, 30, 30);
    ctx.get().setCompareMode(mode);
    expect(ctx.get().commitLayerDrag()).toBe(false);
    expect(ctx.layers()[0].transform).toMatchObject({ x: CARD.x, y: CARD.y });
  });

  test("duplicate, paste, delete, reorder, hide, lock, rename, resize/rotate, reset and a patch colour are all refused", () => {
    const ctx = withLayer();
    ctx.get().copyLayer(ctx.id);
    const patchId = ctx.patches()[0].id;
    ctx.get().setCompareMode(mode);
    const history = ctx.get().history;
    expect(ctx.get().duplicateLayer(ctx.id)).toBeNull();
    expect(ctx.get().pasteLayer()).toBeNull();
    expect(ctx.get().deleteLayer(ctx.id)).toBe(false);
    expect(ctx.get().reorderLayer(ctx.id, 1)).toBe(false);
    expect(ctx.get().setLayerVisible(ctx.id, false)).toBe(false);
    expect(ctx.get().setLayerLocked(ctx.id, true)).toBe(false);
    expect(ctx.get().renameLayer(ctx.id, "Hero")).toBe(false);
    expect(ctx.get().transformLayer(ctx.id, { x: 1, y: 2, scaleX: 2, scaleY: 2, rotation: 10 })).toBe(false);
    expect(ctx.get().resetLayerTransform(ctx.id)).toBe(false);
    expect(ctx.get().setPatchColor(patchId, "#ff0000")).toBe(false);
    expect(ctx.get().history).toBe(history); // not one of them left a trace
  });

  test("looking is still allowed: selecting, copying, tools and the view", () => {
    const ctx = setup();
    ctx.get().selectLayer(ctx.id);
    expect(ctx.get().selectedLayerIds).toEqual([ctx.id]);
    expect(ctx.get().copyLayer(ctx.id)).toBe(true);
    ctx.get().setTool("hand");
    expect(ctx.get().activeTool).toBe("hand");
    ctx.get().setView({ zoom: 2, panX: 3, panY: 4 });
    expect(ctx.get().view).toEqual({ zoom: 2, panX: 3, panY: 4 });
  });

  test("undo and redo still work", () => {
    const ctx = setup();
    ctx.get().undo();
    expect(ctx.layers()).toHaveLength(0);
    ctx.get().redo();
    expect(ctx.layers()).toHaveLength(1);
  });

  test("going back to off makes every edit possible again", () => {
    const ctx = setup();
    ctx.get().setCompareMode("off");
    expect(ctx.get().renameLayer(ctx.id, "Hero")).toBe(true);
    expect(ctx.get().duplicateLayer(ctx.id)).not.toBeNull();
    expect(ctx.get().beginExtraction({ x: 40, y: 25, width: 10, height: 10 }).status).toBe("committed");
  });
});

describe("the exported PNG is always the edited result", () => {
  test("whichever way the screen is being shown, the PNG shows the layer moved and the old spot filled", async () => {
    const ctx = withLayer();
    ctx.get().previewLayerDrag(ctx.id, 35, 25);
    ctx.get().commitLayerDrag();
    const codec = fakeCodec();
    const png = async () => codec.decode((await renderProjectPng(ctx.get().snapshotProject()!, ctx.get().images, codec)).blob);
    const results: number[][][] = [];
    for (const mode of ["off", "original", "split"] as const) {
      ctx.get().setCompareMode(mode);
      const out = await png();
      results.push([getPixel(out, 40, 30), getPixel(out, 15, 15)]);
    }
    expect(results[0]).toEqual([[0, 0, 255, 255], [240, 240, 240, 255]]); // the card at its new place; its old place is background
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });
});
