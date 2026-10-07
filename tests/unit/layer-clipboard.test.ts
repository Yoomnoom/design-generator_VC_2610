import { describe, expect, test } from "vitest";
import { DUPLICATE_OFFSET } from "@/store/editor-store";
import { CARD, committedId, storeWith } from "./fixtures";

const withLayer = () => {
  const ctx = storeWith();
  return { ...ctx, id: committedId(ctx.get().beginExtraction(CARD)) };
};

describe("copy and paste of a layer (inside the app only)", () => {
  test("pasting without a copy does nothing", () => {
    const { get } = withLayer();
    const history = get().history;
    expect(get().pasteLayer()).toBeNull();
    expect(get().history).toBe(history);
  });

  test("copy changes nothing in the project; paste adds a layer 16px right and down, selected, in one undo step", () => {
    const { get, layers, id } = withLayer();
    const history = get().history;
    expect(get().copyLayer(id)).toBe(true);
    expect(get().history).toBe(history);

    const pastedId = get().pasteLayer()!;
    const pasted = layers().find((l) => l.id === pastedId)!;
    const original = layers().find((l) => l.id === id)!;
    expect(pasted.transform).toMatchObject({ x: original.transform.x + DUPLICATE_OFFSET, y: original.transform.y + DUPLICATE_OFFSET });
    expect(pasted.imageId).toBe(original.imageId);
    expect(pasted.zIndex).toBeGreaterThan(original.zIndex);
    expect(get().selectedLayerIds).toEqual([pastedId]);
    expect(get().history!.past).toHaveLength(2);
    get().undo();
    expect(layers()).toHaveLength(1);
  });

  test("each further paste lands one more step along, so pasted layers do not hide each other", () => {
    const { get, layers, id } = withLayer();
    get().copyLayer(id);
    get().pasteLayer();
    get().pasteLayer();
    get().pasteLayer();
    expect(layers().map((l) => l.transform.x)).toEqual([CARD.x, CARD.x + 16, CARD.x + 32, CARD.x + 48]);
  });

  test("the copy is of the layer as it was when copied, even if the original moves or is deleted afterwards", () => {
    const { get, layers, id } = withLayer();
    get().copyLayer(id);
    get().previewLayerDrag(id, 500, 400);
    get().commitLayerDrag();
    get().deleteLayer(id);
    const pastedId = get().pasteLayer()!;
    expect(layers()).toHaveLength(1);
    expect(layers()[0].id).toBe(pastedId);
    expect(layers()[0].transform).toMatchObject({ x: CARD.x + 16, y: CARD.y + 16 });
    expect(get().images.has(layers()[0].imageId!)).toBe(true);
  });

  test("copying an unknown layer fails and leaves the clipboard alone", () => {
    const { get, id } = withLayer();
    get().copyLayer(id);
    expect(get().copyLayer("nope")).toBe(false);
    expect(get().layerClipboard).not.toBeNull();
  });

  test("a new project or an opened one empties the clipboard: its bitmaps are gone", () => {
    const { get, id } = withLayer();
    get().copyLayer(id);
    get().newProject({ fileName: "other.png", raw: { width: 10, height: 10, data: new Uint8ClampedArray(400).fill(255) } });
    expect(get().layerClipboard).toBeNull();
    expect(get().pasteLayer()).toBeNull();
  });
});
