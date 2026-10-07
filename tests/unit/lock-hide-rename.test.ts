import { describe, expect, test } from "vitest";
import { renderProjectPng } from "@/features/export-image/export-png";
import { MAX_LAYER_NAME } from "@/store/editor-store";
import { CARD, GRAY, committedId, fakeCodec, storeWith } from "./fixtures";
import { getPixel } from "./helpers";

const withLayer = () => {
  const ctx = storeWith();
  return { ...ctx, id: committedId(ctx.get().beginExtraction(CARD)) };
};
const layer = (ctx: ReturnType<typeof withLayer>) => ctx.layers().find((l) => l.id === ctx.id)!;

describe("hide", () => {
  test("hiding and showing are one undo step each, and no step when nothing changes", () => {
    const ctx = withLayer();
    const past = ctx.get().history!.past.length;
    expect(ctx.get().setLayerVisible(ctx.id, false)).toBe(true);
    expect(layer(ctx).visible).toBe(false);
    expect(ctx.get().setLayerVisible(ctx.id, false)).toBe(false);
    expect(ctx.get().setLayerVisible(ctx.id, true)).toBe(true);
    expect(ctx.get().history!.past).toHaveLength(past + 2);
    ctx.get().undo();
    expect(layer(ctx).visible).toBe(false);
  });

  test("a hidden layer is left out of the PNG: what shows is the patch (the filled old spot), not the layer", async () => {
    const ctx = withLayer();
    const codec = fakeCodec();
    const spot = { x: CARD.x + 5, y: CARD.y + 5 };
    const shown = await codec.decode((await renderProjectPng(ctx.get().snapshotProject()!, ctx.get().images, codec)).blob);
    expect(getPixel(shown, spot.x, spot.y)).toEqual([0, 0, 255, 255]); // the card's blue

    ctx.get().setLayerVisible(ctx.id, false);
    const hidden = await codec.decode((await renderProjectPng(ctx.get().snapshotProject()!, ctx.get().images, codec)).blob);
    expect(getPixel(hidden, spot.x, spot.y)).toEqual(GRAY); // the background colour the patch filled in
    expect([hidden.width, hidden.height]).toEqual([shown.width, shown.height]); // same size either way
  });

  test("an unknown layer is ignored", () => {
    const ctx = withLayer();
    expect(ctx.get().setLayerVisible("nope", false)).toBe(false);
  });
});

describe("lock", () => {
  test("a locked layer does not move: the drag is ignored and nothing is recorded", () => {
    const ctx = withLayer();
    ctx.get().setLayerLocked(ctx.id, true);
    const history = ctx.get().history;
    ctx.get().previewLayerDrag(ctx.id, 300, 300);
    expect(ctx.get().dragPreview).toBeNull();
    expect(ctx.get().commitLayerDrag()).toBe(false);
    expect(ctx.get().history).toBe(history);
    expect(layer(ctx).transform).toMatchObject({ x: CARD.x, y: CARD.y });
  });

  test("a drag that was under way when the layer got locked is dropped at the commit", () => {
    const ctx = withLayer();
    ctx.get().previewLayerDrag(ctx.id, 300, 300);
    ctx.get().setLayerLocked(ctx.id, true);
    expect(ctx.get().commitLayerDrag()).toBe(false);
    expect(layer(ctx).transform).toMatchObject({ x: CARD.x, y: CARD.y });
  });

  test("a locked layer cannot be deleted; unlocking brings that back", () => {
    const ctx = withLayer();
    ctx.get().setLayerLocked(ctx.id, true);
    const history = ctx.get().history;
    expect(ctx.get().deleteLayer(ctx.id)).toBe(false);
    expect(ctx.get().history).toBe(history);
    ctx.get().setLayerLocked(ctx.id, false);
    expect(ctx.get().deleteLayer(ctx.id)).toBe(true);
  });

  test("locking does not stop selecting, renaming, reordering, copying or hiding", () => {
    const ctx = withLayer();
    ctx.get().setLayerLocked(ctx.id, true);
    ctx.get().selectLayer(ctx.id);
    expect(ctx.get().selectedLayerIds).toEqual([ctx.id]);
    expect(ctx.get().renameLayer(ctx.id, "Hero")).toBe(true);
    expect(ctx.get().copyLayer(ctx.id)).toBe(true);
    expect(ctx.get().setLayerVisible(ctx.id, false)).toBe(true);
  });

  test("a duplicate or a paste of a locked, hidden layer is a fresh layer: visible and free to move", () => {
    const ctx = withLayer();
    ctx.get().setLayerLocked(ctx.id, true);
    ctx.get().setLayerVisible(ctx.id, false);
    const dupId = ctx.get().duplicateLayer(ctx.id)!;
    const dup = ctx.layers().find((l) => l.id === dupId)!;
    expect([dup.locked, dup.visible]).toEqual([false, true]);
    ctx.get().copyLayer(ctx.id);
    const pastedId = ctx.get().pasteLayer()!;
    const pasted = ctx.layers().find((l) => l.id === pastedId)!;
    expect([pasted.locked, pasted.visible]).toEqual([false, true]);
    expect(layer(ctx)).toMatchObject({ locked: true, visible: false }); // the original is untouched
  });

  test("lock and unlock are undoable", () => {
    const ctx = withLayer();
    ctx.get().setLayerLocked(ctx.id, true);
    ctx.get().undo();
    expect(layer(ctx).locked).toBe(false);
  });
});

describe("rename", () => {
  test("trims, records one undo step, and is undone by one", () => {
    const ctx = withLayer();
    const past = ctx.get().history!.past.length;
    expect(ctx.get().renameLayer(ctx.id, "  Hero card  ")).toBe(true);
    expect(layer(ctx).name).toBe("Hero card");
    expect(ctx.get().history!.past).toHaveLength(past + 1);
    ctx.get().undo();
    expect(layer(ctx).name).toBe("레이어 1");
  });

  test("an empty or blank name is refused: a layer always has a name", () => {
    const ctx = withLayer();
    const history = ctx.get().history;
    expect(ctx.get().renameLayer(ctx.id, "")).toBe(false);
    expect(ctx.get().renameLayer(ctx.id, "   ")).toBe(false);
    expect(ctx.get().history).toBe(history);
  });

  test("the same name again records nothing", () => {
    const ctx = withLayer();
    const history = ctx.get().history;
    expect(ctx.get().renameLayer(ctx.id, "레이어 1")).toBe(false);
    expect(ctx.get().history).toBe(history);
  });

  test(`a name longer than ${MAX_LAYER_NAME} characters is cut`, () => {
    const ctx = withLayer();
    ctx.get().renameLayer(ctx.id, "가".repeat(200));
    expect(layer(ctx).name).toHaveLength(MAX_LAYER_NAME);
  });

  test("a renamed layer does not disturb the numbering of new ones", () => {
    const ctx = withLayer();
    ctx.get().renameLayer(ctx.id, "Hero");
    ctx.get().beginExtraction({ x: 50, y: 30, width: 5, height: 5 });
    expect(ctx.layers().map((l) => l.name)).toEqual(["Hero", "레이어 1"]);
  });
});
