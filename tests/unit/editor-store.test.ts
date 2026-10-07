import { describe, expect, test } from "vitest";
import { DUPLICATE_OFFSET } from "@/store/editor-store";
import { sortByZ } from "@/features/layer-transform/order";
import { CARD, GRAY, committedId, pageWithCard, splitPage, storeWith } from "./fixtures";
import { getPixel, solid } from "./helpers";

describe("newProject", () => {
  test("the frame is the uploaded image's size, whatever it is", () => {
    const { get } = storeWith(solid(37, 23, GRAY));
    const screen = get().history!.present.screens[0];
    expect([screen.width, screen.height]).toEqual([37, 23]);
    expect(get().history!.past).toHaveLength(0);
    expect(get().images.get(screen.source.imageId)?.raw.width).toBe(37);
  });

  test("uses the file name (without extension) as the project name", () => {
    expect(storeWith(pageWithCard(), "dashboard.v2.png").get().history!.present.name).toBe("dashboard.v2");
  });
});

describe("extraction", () => {
  test("one gesture creates a layer and a background patch as ONE undo step", () => {
    const { get, layers, patches } = storeWith();
    const id = committedId(get().beginExtraction(CARD));

    expect(layers()).toHaveLength(1);
    expect(patches()).toHaveLength(1);
    expect(get().history!.past).toHaveLength(1);
    expect(get().selectedLayerIds).toEqual([id]);

    get().undo();
    expect([layers().length, patches().length]).toEqual([0, 0]);
    expect(get().selectedLayerIds).toEqual([]);
    get().redo();
    expect([layers().length, patches().length]).toEqual([1, 1]);
  });

  test("the layer is exactly the selection size, sits where it was cut, and holds the card's pixels", () => {
    const { get, layers } = storeWith();
    get().beginExtraction(CARD);
    const layer = layers()[0];
    const image = get().images.get(layer.imageId!)!.raw;
    expect([image.width, image.height]).toEqual([CARD.width, CARD.height]);
    expect(layer.crop).toEqual(CARD);
    expect(layer.transform).toEqual({ x: 10, y: 10, scaleX: 1, scaleY: 1, rotation: 0 });
    expect(getPixel(image, 0, 0)).toEqual([0, 0, 255, 255]);
  });

  test("the patch covers the original spot with the sampled background colour", () => {
    const { get, patches } = storeWith();
    get().beginExtraction(CARD);
    expect(patches()[0]).toMatchObject({ rect: CARD, fill: "#f0f0f0" });
  });

  test("switches to the select tool", () => {
    const { get } = storeWith();
    get().setTool("rect");
    get().beginExtraction(CARD);
    expect(get().activeTool).toBe("select");
  });

  test("pixels always come from the original image, never from patches or moved layers", () => {
    const { get, layers } = storeWith();
    const first = committedId(get().beginExtraction(CARD)); // paints gray over the card's spot
    get().previewLayerDrag(first, 40, 25);
    get().commitLayerDrag(); // and the card moves away

    get().beginExtraction({ x: 20, y: 10, width: 20, height: 10 }); // overlaps the card's right half
    const second = get().images.get(layers()[1].imageId!)!.raw;
    expect(getPixel(second, 0, 0)).toEqual([0, 0, 255, 255]); // still blue: not the gray patch
    expect(getPixel(second, 9, 0)).toEqual([0, 0, 255, 255]);
    expect(getPixel(second, 10, 0)).toEqual(GRAY); // x=30 is past the card
  });

  test("a selection outside the image is rejected and leaves no trace", () => {
    const { get } = storeWith();
    const before = get().history;
    expect(get().beginExtraction({ x: 50, y: 30, width: 20, height: 20 })).toEqual({ status: "rejected", reason: "invalid-rect" });
    expect(get().beginExtraction({ x: 0.5, y: 0, width: 5, height: 5 })).toEqual({ status: "rejected", reason: "invalid-rect" });
    expect(get().history).toBe(before);
  });

  test("layers are named 레이어 N, one past the highest in use", () => {
    const { get, layers } = storeWith();
    const a = committedId(get().beginExtraction({ x: 0, y: 0, width: 5, height: 5 }));
    get().beginExtraction({ x: 50, y: 30, width: 5, height: 5 });
    get().deleteLayer(a);
    get().beginExtraction({ x: 40, y: 0, width: 5, height: 5 });
    expect(layers().map((l) => l.name)).toEqual(["레이어 2", "레이어 3"]);
  });
});

describe("extraction when the background is too varied", () => {
  const ask = () => {
    const ctx = storeWith(splitPage());
    return { ...ctx, rect: { x: 10, y: 10, width: 20, height: 10 } };
  };

  test("stops and asks: nothing is created yet", () => {
    const { get, rect, layers, patches } = ask();
    const history = get().history;
    const images = get().images;
    const result = get().beginExtraction(rect);
    expect(result.status).toBe("needs-color");
    expect(get().pendingExtraction?.rect).toEqual(rect);
    expect([layers().length, patches().length, get().history!.past.length]).toEqual([0, 0, 0]);
    expect(get().history).toBe(history);
    expect(get().images).toBe(images);
  });

  test("cancelling cancels the whole extraction: no layer, no patch, no history, no bitmap", () => {
    const { get, rect, layers, patches } = ask();
    const history = get().history;
    const images = get().images;
    get().beginExtraction(rect);
    get().cancelExtraction();

    expect(get().pendingExtraction).toBeNull();
    expect(get().history).toBe(history); // the very same object: not even a no-op entry
    expect(get().images).toBe(images);
    expect([layers().length, patches().length, get().history!.past.length]).toEqual([0, 0, 0]);
    get().undo();
    expect(get().history).toBe(history);
  });

  test("cancelling does not disturb earlier work", () => {
    const { get, layers } = storeWith(splitPage());
    get().beginExtraction({ x: 0, y: 0, width: 4, height: 4 }); // flat red corner: extracts fine
    const history = get().history;
    expect(get().beginExtraction({ x: 10, y: 10, width: 20, height: 10 }).status).toBe("needs-color");
    get().cancelExtraction();
    expect(get().history).toBe(history);
    expect(layers()).toHaveLength(1);
    expect(get().history!.past).toHaveLength(1);
  });

  test("confirming uses the chosen colour, in one undo step", () => {
    const { get, rect, layers, patches } = ask();
    get().beginExtraction(rect);
    expect(get().confirmExtraction("#ABCDEF").status).toBe("committed");
    expect(patches()[0].fill).toBe("#abcdef");
    expect(layers()).toHaveLength(1);
    expect(get().history!.past).toHaveLength(1);
    expect(get().pendingExtraction).toBeNull();
  });

  test("suggests the best guess to prefill the picker", () => {
    const { get, rect } = ask();
    expect(get().beginExtraction(rect)).toMatchObject({ status: "needs-color", suggestedHex: expect.stringMatching(/^#[0-9a-f]{6}$/) });
  });

  test("a bad colour keeps the question open; confirming with nothing pending is refused", () => {
    const { get, rect } = ask();
    expect(get().confirmExtraction("#fff")).toEqual({ status: "rejected", reason: "no-pending" });
    get().beginExtraction(rect);
    expect(get().confirmExtraction("red")).toEqual({ status: "rejected", reason: "invalid-color" });
    expect(get().pendingExtraction).not.toBeNull();
  });

  test("undo while asking drops the question", () => {
    const { get, rect } = ask();
    get().beginExtraction({ x: 0, y: 0, width: 4, height: 4 });
    get().beginExtraction(rect);
    get().undo();
    expect(get().pendingExtraction).toBeNull();
  });
});

describe("dragging", () => {
  const withLayer = () => {
    const ctx = storeWith();
    const id = committedId(ctx.get().beginExtraction(CARD));
    return { ...ctx, id };
  };

  test("many pointer moves, one history step on pointerup", () => {
    const { get, layers, id } = withLayer();
    const history = get().history;
    for (let i = 1; i <= 30; i++) get().previewLayerDrag(id, 10 + i, 10 + i / 2);
    expect(get().history).toBe(history); // nothing recorded, project untouched while dragging
    expect(layers()[0].transform).toMatchObject({ x: 10, y: 10 });
    expect(get().dragPreview).toEqual({ layerId: id, x: 40, y: 25 });

    expect(get().commitLayerDrag()).toBe(true);
    expect(get().history!.past).toHaveLength(2); // extraction + one move
    expect(layers()[0].transform).toMatchObject({ x: 40, y: 25 });
    expect(get().dragPreview).toBeNull();

    get().undo();
    expect(layers()[0].transform).toMatchObject({ x: 10, y: 10 });
  });

  test("positions are whole original pixels", () => {
    const { get, layers, id } = withLayer();
    get().previewLayerDrag(id, 30.6, 12.4);
    get().commitLayerDrag();
    expect(layers()[0].transform).toMatchObject({ x: 31, y: 12 });
  });

  test("moving outside the frame is allowed", () => {
    const { get, layers, id } = withLayer();
    get().previewLayerDrag(id, -50, 900);
    get().commitLayerDrag();
    expect(layers()[0].transform).toMatchObject({ x: -50, y: 900 });
  });

  test("a click without movement records nothing", () => {
    const { get, id } = withLayer();
    const history = get().history;
    get().previewLayerDrag(id, 10, 10);
    expect(get().commitLayerDrag()).toBe(false);
    expect(get().history).toBe(history);
  });

  test("cancelling a drag leaves the layer where it was", () => {
    const { get, layers, id } = withLayer();
    const history = get().history;
    get().previewLayerDrag(id, 50, 50);
    get().cancelLayerDrag();
    expect(get().dragPreview).toBeNull();
    expect(get().history).toBe(history);
    expect(layers()[0].transform).toMatchObject({ x: 10, y: 10 });
  });

  test("committing with no drag, an unknown layer, or a NaN position does nothing", () => {
    const { get } = withLayer();
    const history = get().history;
    expect(get().commitLayerDrag()).toBe(false);
    get().previewLayerDrag("nope", 1, 1);
    get().previewLayerDrag(get().selectedLayerIds[0], NaN, 1);
    expect(get().dragPreview).toBeNull();
    expect(get().history).toBe(history);
  });
});

describe("duplicate", () => {
  test(`copies the layer ${DUPLICATE_OFFSET}px right and down, on top, sharing the bitmap`, () => {
    const { get, layers, patches, id } = (() => {
      const c = storeWith();
      return { ...c, id: committedId(c.get().beginExtraction(CARD)) };
    })();
    const copyId = get().duplicateLayer(id)!;
    const [original, copy] = sortByZ(layers());

    expect(DUPLICATE_OFFSET).toBe(16);
    expect(copy.id).toBe(copyId);
    expect(copy.transform).toMatchObject({ x: original.transform.x + 16, y: original.transform.y + 16 });
    expect(copy.imageId).toBe(original.imageId);
    expect(copy.crop).toEqual(original.crop);
    expect(copy.zIndex).toBeGreaterThan(original.zIndex);
    expect(copy.name).toBe("레이어 1 복사");
    expect(get().selectedLayerIds).toEqual([copyId]);
    expect(patches()).toHaveLength(1); // nothing was cut out, so nothing to fill
    expect(get().history!.past).toHaveLength(2);

    get().undo();
    expect(layers()).toHaveLength(1);
  });

  test("an unknown layer is ignored", () => {
    const { get } = storeWith();
    expect(get().duplicateLayer("nope")).toBeNull();
    expect(get().history!.past).toHaveLength(0);
  });
});

describe("order, delete, patch colour", () => {
  const three = () => {
    const ctx = storeWith();
    const ids = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 30 }].map((p) => committedId(ctx.get().beginExtraction({ ...p, width: 5, height: 5 })));
    return { ...ctx, ids };
  };
  const order = (layers: () => { id: string }[]) => sortByZ(layers() as never).map((l) => l.id);

  test("forward and backward move one step and keep zIndex 0…n-1", () => {
    const { get, layers, ids } = three();
    expect(get().reorderLayer(ids[0], 1)).toBe(true);
    expect(order(layers)).toEqual([ids[1], ids[0], ids[2]]);
    expect(layers().map((l) => l.zIndex).sort()).toEqual([0, 1, 2]);
    expect(get().reorderLayer(ids[2], -1)).toBe(true);
    expect(order(layers)).toEqual([ids[1], ids[2], ids[0]]);
  });

  test("at either end it does nothing and records nothing", () => {
    const { get, ids } = three();
    const history = get().history;
    expect(get().reorderLayer(ids[2], 1)).toBe(false);
    expect(get().reorderLayer(ids[0], -1)).toBe(false);
    expect(get().reorderLayer("nope", 1)).toBe(false);
    expect(get().history).toBe(history);
  });

  test("a reorder is a tiny patch, not a copy of the layer list", () => {
    const { get, ids } = three();
    get().reorderLayer(ids[0], 1);
    const entry = get().history!.past.at(-1)!;
    expect(JSON.stringify(entry.patches).length).toBeLessThan(200);
  });

  test("delete removes the layer, closes the zIndex gap, and keeps the filled patch", () => {
    const { get, layers, patches, ids } = three();
    get().selectLayer(ids[1]);
    expect(get().deleteLayer(ids[1])).toBe(true);
    expect(order(layers)).toEqual([ids[0], ids[2]]);
    expect(layers().map((l) => l.zIndex).sort()).toEqual([0, 1]);
    expect(get().selectedLayerIds).toEqual([]);
    expect(patches()).toHaveLength(3);
    get().undo();
    expect(order(layers)).toEqual(ids);
  });

  test("deleting an unknown layer does nothing", () => {
    const { get } = three();
    const history = get().history;
    expect(get().deleteLayer("nope")).toBe(false);
    expect(get().history).toBe(history);
  });

  test("a patch colour can be changed, once per real change, and undone", () => {
    const { get, patches } = three();
    const patchId = patches()[0].id;
    const past = get().history!.past.length;
    expect(get().setPatchColor(patchId, "#FF0000")).toBe(true);
    expect(patches()[0].fill).toBe("#ff0000");
    expect(get().setPatchColor(patchId, "#ff0000")).toBe(false);
    expect(get().setPatchColor(patchId, "nope")).toBe(false);
    expect(get().history!.past).toHaveLength(past + 1);
    get().undo();
    expect(patches()[0].fill).toBe("#f0f0f0");
  });

  test("selection only accepts layers that exist", () => {
    const { get, ids } = three();
    get().selectLayer(ids[0]);
    expect(get().selectedLayerIds).toEqual([ids[0]]);
    get().selectLayer("nope");
    expect(get().selectedLayerIds).toEqual([]);
  });
});

describe("view", () => {
  test("zoom and pan are not edits: no history, zoom is clamped", () => {
    const { get } = storeWith();
    get().setView({ zoom: 2, panX: 5, panY: 6 });
    expect(get().view).toEqual({ zoom: 2, panX: 5, panY: 6 });
    get().setView({ zoom: 100, panX: 0, panY: 0 });
    expect(get().view.zoom).toBe(8);
    expect(get().history!.past).toHaveLength(0);
  });

  test("snapshotProject carries the live view as project.canvas", () => {
    const { get } = storeWith();
    get().setView({ zoom: 2, panX: -40, panY: -20 });
    expect(get().snapshotProject()!.canvas).toEqual({ zoom: 2, panX: -40, panY: -20 });
  });
});

test("undo through 60 extractions and back (requirement: 50+)", () => {
  const { get, layers } = storeWith(solid(100, 100, GRAY));
  for (let i = 0; i < 60; i++) get().beginExtraction({ x: i, y: 0, width: 1, height: 1 });
  expect(layers()).toHaveLength(60);
  for (let i = 0; i < 60; i++) get().undo();
  expect(layers()).toHaveLength(0);
  for (let i = 0; i < 60; i++) get().redo();
  expect(layers()).toHaveLength(60);
});
