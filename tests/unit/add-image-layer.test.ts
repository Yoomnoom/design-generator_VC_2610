import { describe, expect, test } from "vitest";
import { DUPLICATE_OFFSET } from "@/store/editor-store";
import { solid } from "./helpers";
import { storeWith } from "./fixtures";

/* storeWith(): a 60×40 page */
const layersOf = (ctx: ReturnType<typeof storeWith>) => ctx.get().history!.present.screens[0].layers;

describe("addImageLayer (a picture from outside becomes a new bitmap layer)", () => {
  test("a smaller picture is centred at its own size, without a scale", () => {
    const ctx = storeWith();
    const id = ctx.get().addImageLayer({ raw: solid(20, 10, [1, 2, 3, 255]), name: "logo" })!;
    const l = layersOf(ctx).find((x) => x.id === id)!;
    expect(l.transform).toEqual({ x: 20, y: 15, scaleX: 1, scaleY: 1, rotation: 0 });
    expect(l.name).toBe("logo");
    expect(l.crop).toEqual({ x: 0, y: 0, width: 20, height: 10 });
    expect(l.drawn).toBeUndefined();
    expect(ctx.get().images.get(l.imageId!)!.raw.width).toBe(20);
    expect(ctx.get().selectedLayerIds).toEqual([id]);
  });

  test("a bigger picture keeps its pixels and shrinks by scale to fit, keeping its shape", () => {
    const ctx = storeWith();
    const id = ctx.get().addImageLayer({ raw: solid(240, 40, [1, 2, 3, 255]), name: "wide" })!;
    const l = layersOf(ctx).find((x) => x.id === id)!;
    expect(l.transform.scaleX).toBeCloseTo(0.25, 9);
    expect(l.transform.scaleY).toBeCloseTo(0.25, 9);
    expect(l.transform.x).toBeCloseTo(0, 9);
    expect(l.transform.y).toBeCloseTo(15, 9);
    expect(ctx.get().images.get(l.imageId!)!.raw.width).toBe(240); // not resampled
  });

  test("a picture exactly the frame's size is not scaled", () => {
    const ctx = storeWith();
    const id = ctx.get().addImageLayer({ raw: solid(60, 40, [1, 2, 3, 255]), name: "full" })!;
    expect(layersOf(ctx).find((x) => x.id === id)!.transform).toMatchObject({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
  });

  test("each repeated paste is a new layer, DUPLICATE_OFFSET further along, one undo step each", () => {
    const ctx = storeWith();
    const past = ctx.get().history!.past.length;
    const ids = [1, 2, 3].map(() => ctx.get().addImageLayer({ raw: solid(20, 10, [1, 2, 3, 255]), name: "p" })!);
    const ls = ids.map((id) => layersOf(ctx).find((x) => x.id === id)!);
    expect(ls.map((l) => l.transform.x)).toEqual([20, 20 + DUPLICATE_OFFSET, 20 + 2 * DUPLICATE_OFFSET]);
    expect(ls.map((l) => l.transform.y)).toEqual([15, 15 + DUPLICATE_OFFSET, 15 + 2 * DUPLICATE_OFFSET]);
    expect(new Set(ls.map((l) => l.imageId)).size).toBe(3);
    expect(ctx.get().history!.past.length).toBe(past + 3);
    ctx.get().undo();
    expect(layersOf(ctx)).toHaveLength(2);
    ctx.get().redo();
    expect(layersOf(ctx)).toHaveLength(3);
  });

  test("the stagger starts over in a newly opened project", () => {
    const ctx = storeWith();
    ctx.get().addImageLayer({ raw: solid(20, 10, [1, 2, 3, 255]), name: "p" });
    ctx.get().newProject({ fileName: "n.png", raw: solid(60, 40, [9, 9, 9, 255]) });
    const id = ctx.get().addImageLayer({ raw: solid(20, 10, [1, 2, 3, 255]), name: "p" })!;
    expect(layersOf(ctx).find((x) => x.id === id)!.transform.x).toBe(20);
  });

  test("refused while comparing, and with no project; nothing changes", () => {
    const ctx = storeWith();
    ctx.get().setCompareMode("original");
    const past = ctx.get().history!.past.length;
    expect(ctx.get().addImageLayer({ raw: solid(5, 5, [1, 2, 3, 255]), name: "x" })).toBeNull();
    expect(ctx.get().history!.past.length).toBe(past);
    expect(layersOf(ctx)).toHaveLength(0);
  });

  test("an empty name falls back to a numbered one", () => {
    const ctx = storeWith();
    ctx.get().addImageLayer({ raw: solid(5, 5, [1, 2, 3, 255]), name: "  " });
    expect(layersOf(ctx)[0].name).toBe("붙여넣기 1");
  });
});