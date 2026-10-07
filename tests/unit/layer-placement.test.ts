import { describe, expect, test } from "vitest";
import { renderProjectPng } from "@/features/export-image/export-png";
import { MAX_SCALE, MIN_SCALE } from "@/lib/geometry/layer-transform";
import { parseProject, serializeProject } from "@/lib/project/parse";
import { CARD, GRAY, committedId, fakeCodec, storeWith } from "./fixtures";
import { getPixel } from "./helpers";

const withLayer = () => {
  const ctx = storeWith();
  return { ...ctx, id: committedId(ctx.get().beginExtraction(CARD)) };
};
const placement = (ctx: ReturnType<typeof withLayer>) => ctx.layers().find((l) => l.id === ctx.id)!.transform;
const T = (over: Record<string, number> = {}) => ({ x: CARD.x, y: CARD.y, scaleX: 1, scaleY: 1, rotation: 0, ...over });

describe("transformLayer", () => {
  test("resizing and rotating is one undo step, and one undo puts the layer back", () => {
    const ctx = withLayer();
    const past = ctx.get().history!.past.length;
    expect(ctx.get().transformLayer(ctx.id, T({ scaleX: 2, scaleY: 2, rotation: 30, x: 20, y: 25 }))).toBe(true);
    expect(placement(ctx)).toEqual({ x: 20, y: 25, scaleX: 2, scaleY: 2, rotation: 30 });
    expect(ctx.get().history!.past).toHaveLength(past + 1);
    expect(ctx.get().history!.past.at(-1)!.label).toBe("레이어 크기·회전");
    ctx.get().undo();
    expect(placement(ctx)).toEqual(T());
  });

  test("what is stored is rounded to a precision nobody sees", () => {
    const ctx = withLayer();
    ctx.get().transformLayer(ctx.id, T({ x: 10.123456, scaleX: 1.234567, scaleY: 0.987654, rotation: 33.33333 }));
    expect(placement(ctx)).toEqual({ x: 10.12, y: CARD.y, scaleX: 1.2346, scaleY: 0.9877, rotation: 33.33 });
  });

  test("scale stays inside its limits, rotation inside (-180, 180]", () => {
    const ctx = withLayer();
    ctx.get().transformLayer(ctx.id, T({ scaleX: 0, scaleY: 1e6, rotation: 450 }));
    expect(placement(ctx)).toMatchObject({ scaleX: MIN_SCALE, scaleY: MAX_SCALE, rotation: 90 });
  });

  test("a change too small to survive rounding records nothing", () => {
    const ctx = withLayer();
    const history = ctx.get().history;
    expect(ctx.get().transformLayer(ctx.id, T({ scaleX: 1.00001, rotation: 0.0001 }))).toBe(false);
    expect(ctx.get().history).toBe(history);
  });

  test("NaN, Infinity and unknown layers are refused", () => {
    const ctx = withLayer();
    const history = ctx.get().history;
    expect(ctx.get().transformLayer(ctx.id, T({ scaleX: NaN }))).toBe(false);
    expect(ctx.get().transformLayer(ctx.id, T({ rotation: Infinity }))).toBe(false);
    expect(ctx.get().transformLayer("nope", T({ scaleX: 2 }))).toBe(false);
    expect(ctx.get().history).toBe(history);
  });

  test("a locked layer refuses to be resized or rotated", () => {
    const ctx = withLayer();
    ctx.get().setLayerLocked(ctx.id, true);
    const history = ctx.get().history;
    expect(ctx.get().transformLayer(ctx.id, T({ scaleX: 2 }))).toBe(false);
    expect(ctx.get().resetLayerTransform(ctx.id)).toBe(false);
    expect(ctx.get().history).toBe(history);
  });
});

describe("reset", () => {
  test("goes back to natural size and upright, with the top-left corner where it was", () => {
    const ctx = withLayer();
    ctx.get().transformLayer(ctx.id, T({ x: 77, y: 88, scaleX: 3, scaleY: 0.5, rotation: -40 }));
    expect(ctx.get().resetLayerTransform(ctx.id)).toBe(true);
    expect(placement(ctx)).toEqual({ x: 77, y: 88, scaleX: 1, scaleY: 1, rotation: 0 });
  });
  test("on a layer that is only moved there is nothing to reset", () => {
    const ctx = withLayer();
    const history = ctx.get().history;
    expect(ctx.get().resetLayerTransform(ctx.id)).toBe(false);
    expect(ctx.get().history).toBe(history);
  });
});

describe("other edits keep the placement", () => {
  const rotated = () => {
    const ctx = withLayer();
    ctx.get().transformLayer(ctx.id, T({ scaleX: 1.5, scaleY: 1.5, rotation: 20 }));
    return ctx;
  };

  test("dragging a resized, rotated layer moves it and nothing else", () => {
    const ctx = rotated();
    ctx.get().previewLayerDrag(ctx.id, 400, 350);
    ctx.get().commitLayerDrag();
    expect(placement(ctx)).toEqual({ x: 400, y: 350, scaleX: 1.5, scaleY: 1.5, rotation: 20 });
  });

  test("a duplicate and a paste carry the size and rotation along", () => {
    const ctx = rotated();
    const dupId = ctx.get().duplicateLayer(ctx.id)!;
    expect(ctx.layers().find((l) => l.id === dupId)!.transform).toMatchObject({ scaleX: 1.5, scaleY: 1.5, rotation: 20, x: CARD.x + 16, y: CARD.y + 16 });
    ctx.get().copyLayer(ctx.id);
    const pastedId = ctx.get().pasteLayer()!;
    expect(ctx.layers().find((l) => l.id === pastedId)!.transform).toMatchObject({ scaleX: 1.5, rotation: 20 });
  });

  test("hide, lock, rename and reorder do not disturb it", () => {
    const ctx = rotated();
    ctx.get().setLayerVisible(ctx.id, false);
    ctx.get().setLayerLocked(ctx.id, true);
    ctx.get().renameLayer(ctx.id, "Hero");
    expect(placement(ctx)).toMatchObject({ scaleX: 1.5, scaleY: 1.5, rotation: 20 });
  });

  test("a resized, rotated layer survives serialize and parse, and is restored exactly", () => {
    const ctx = rotated();
    const project = ctx.get().snapshotProject()!;
    const r = parseProject(serializeProject(project));
    expect(r.ok && r.project.screens[0].layers[0].transform).toEqual(placement(ctx));
  });
});

describe("the PNG shows the placement", () => {
  const exported = async (ctx: ReturnType<typeof withLayer>) => {
    const codec = fakeCodec();
    return codec.decode((await renderProjectPng(ctx.get().snapshotProject()!, ctx.get().images, codec)).blob);
  };

  test("a layer scaled up covers more of the page, in the model's own coordinates", async () => {
    const ctx = withLayer();
    ctx.get().transformLayer(ctx.id, T({ scaleX: 1.5, scaleY: 1.5, x: 5, y: 5 })); // card is 20×10, so 30×15 at (5,5)
    const out = await exported(ctx);
    expect(getPixel(out, 6, 6)).toEqual([0, 0, 255, 255]);
    expect(getPixel(out, 33, 19)).toEqual([0, 0, 255, 255]); // just inside the far corner
    expect(getPixel(out, 36, 19)).toEqual(GRAY); // outside
    expect(getPixel(out, 33, 22)).toEqual(GRAY);
  });

  test("a quarter turn puts the card upright beside its origin, and the old spot stays filled with background", async () => {
    const ctx = withLayer();
    ctx.get().transformLayer(ctx.id, T({ x: 40, y: 5, rotation: 90 })); // 20×10 card becomes 10 wide, 20 tall, left of x = 40
    const out = await exported(ctx);
    expect(getPixel(out, 35, 15)).toEqual([0, 0, 255, 255]);
    expect(getPixel(out, 31, 6)).toEqual([0, 0, 255, 255]);
    expect(getPixel(out, 41, 15)).toEqual(GRAY);
    expect(getPixel(out, CARD.x + 5, CARD.y + 5)).toEqual(GRAY); // where it was cut out
  });

  test("the output size does not depend on how the layers are placed", async () => {
    const ctx = withLayer();
    ctx.get().transformLayer(ctx.id, T({ scaleX: 20, scaleY: 20, rotation: 33 }));
    const out = await exported(ctx);
    expect([out.width, out.height]).toEqual([60, 40]);
  });
});
