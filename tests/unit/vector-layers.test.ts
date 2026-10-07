import { IDBFactory } from "fake-indexeddb";
import { describe, expect, test } from "vitest";
import { renderProjectRaw } from "@/features/export-image/export-png";
import { loadProjectText, saveProjectText } from "@/features/project-persistence/project-io";
import { referencedImageIds } from "@/features/project-persistence/sync-images";
import { contentBounds, shapeFromDrag, strokeOverhang, vectorFrameBounds, withSize } from "@/lib/image/vector";
import { Rasterize } from "@/lib/image/vector-raster";
import { contentError, parseProject, serializeProject } from "@/lib/project/parse";
import { LayerContent } from "@/lib/project/schema";
import { openBlobStore } from "@/lib/storage/blob-store";
import { CARD, GRAY, committedId, fakeCodec, storeWith } from "./fixtures";
import { getPixel, solid } from "./helpers";

const RECT: LayerContent = { kind: "rect", width: 40, height: 20, stroke: "#112233", strokeWidth: 4, fill: "#ffcc00" };
const LINE: LayerContent = { kind: "line", width: 30, height: 10, direction: "down", stroke: "#ff0000", strokeWidth: 2 };
const STYLE = { stroke: "#112233", fill: "#ffcc00" as string | null, strokeWidth: 4 };

const withShape = (content: LayerContent = RECT) => {
  const ctx = storeWith();
  return { ...ctx, id: ctx.get().addVectorLayer(content, 10, 8)! };
};
const layer = (ctx: ReturnType<typeof withShape>) => ctx.layers().find((l) => l.id === ctx.id)!;

describe("dragging out a shape", () => {
  test("a rectangle or ellipse takes the box between the two corners, whichever way it was dragged", () => {
    const a = shapeFromDrag("rect", { x: 50, y: 40 }, { x: 10, y: 10 }, STYLE)!;
    expect(a).toMatchObject({ x: 10, y: 10, content: { kind: "rect", width: 40, height: 30, stroke: "#112233", strokeWidth: 4, fill: "#ffcc00" } });
    expect(shapeFromDrag("ellipse", { x: 10, y: 10 }, { x: 50, y: 40 }, STYLE)!.content).toMatchObject({ kind: "ellipse", width: 40, height: 30 });
  });
  test("a stroke width of 0 means no outline at all, not an invisible one", () => {
    expect(shapeFromDrag("rect", { x: 0, y: 0 }, { x: 20, y: 20 }, { ...STYLE, strokeWidth: 0 })!.content).toMatchObject({ stroke: null, strokeWidth: 0, fill: "#ffcc00" });
  });
  test("a line remembers which diagonal it runs along", () => {
    expect((shapeFromDrag("line", { x: 10, y: 10 }, { x: 50, y: 30 }, STYLE)!.content as { direction: string }).direction).toBe("down");
    expect((shapeFromDrag("line", { x: 50, y: 30 }, { x: 10, y: 10 }, STYLE)!.content as { direction: string }).direction).toBe("down"); // same line, other way
    const up = shapeFromDrag("line", { x: 10, y: 30 }, { x: 50, y: 10 }, STYLE)!;
    expect(up).toMatchObject({ x: 10, y: 10, content: { direction: "up", width: 40, height: 20 } });
  });
  test("a horizontal or vertical line still has a box a pixel thick, so it can be selected and resized", () => {
    expect(shapeFromDrag("line", { x: 0, y: 5 }, { x: 40, y: 5 }, STYLE)!.content).toMatchObject({ width: 40, height: 1 });
  });
  test("a click, or a drag too short to see, makes nothing", () => {
    expect(shapeFromDrag("rect", { x: 5, y: 5 }, { x: 6, y: 40 }, STYLE)).toBeNull();
    expect(shapeFromDrag("ellipse", { x: 5, y: 5 }, { x: 5, y: 5 }, STYLE)).toBeNull();
    expect(shapeFromDrag("line", { x: 5, y: 5 }, { x: 6, y: 5 }, STYLE)).toBeNull();
  });
});

describe("where a vector layer reaches", () => {
  test("a stroke is centred on the edge, so the box grows by half its width on every side", () => {
    expect(strokeOverhang(RECT)).toBe(2);
    expect(contentBounds(RECT)).toEqual({ x: -2, y: -2, width: 44, height: 24 });
    expect(contentBounds({ ...RECT, stroke: null, strokeWidth: 0 })).toEqual({ x: 0, y: 0, width: 40, height: 20 });
  });
  test("placed upright, the frame bounds are the layer origin plus that box", () => {
    expect(vectorFrameBounds(RECT, { x: 100, y: 50, scaleX: 1, scaleY: 1, rotation: 0 })).toEqual({ x: 98, y: 48, width: 44, height: 24 });
  });
  test("turned a quarter, width and height swap and the box swings round the origin", () => {
    const b = vectorFrameBounds({ ...RECT, stroke: null, strokeWidth: 0 }, { x: 100, y: 50, scaleX: 1, scaleY: 1, rotation: 90 });
    expect(b).toEqual({ x: 80, y: 50, width: 20, height: 40 });
  });
  test("withSize keeps the stroke and never lets a side reach zero", () => {
    expect(withSize(RECT, 80, 0)).toMatchObject({ width: 80, height: 1, strokeWidth: 4, stroke: "#112233" });
  });
});

describe("adding a vector layer", () => {
  test("it goes on top, selected, named by kind and number, as one undo step, and the tool goes back to select", () => {
    const { get, layers } = storeWith();
    get().setTool("box");
    const first = get().addVectorLayer(RECT, 10, 8)!;
    const second = get().addVectorLayer(RECT, 30, 8)!;
    get().addVectorLayer(LINE, 0, 0);
    expect(layers().map((l) => l.name)).toEqual(["사각형 1", "사각형 2", "선 1"]);
    expect(layers().map((l) => l.zIndex)).toEqual([0, 1, 2]);
    expect(layers().every((l) => l.imageId === undefined && l.transform.scaleX === 1 && l.transform.rotation === 0)).toBe(true);
    expect(get().history!.past).toHaveLength(3);
    expect(get().history!.past[0].label).toBe("사각형 추가");
    expect(get().selectedLayerIds).toEqual([layers()[2].id]);
    expect(get().activeTool).toBe("select");
    void first; void second;
    get().undo();
    expect(layers()).toHaveLength(2);
  });
  test("no pixels are created: the image cache is untouched", () => {
    const { get } = storeWith();
    const images = get().images;
    get().addVectorLayer(RECT, 1, 1);
    expect(get().images).toBe(images);
  });
  test("an invalid content, a NaN position or no project is refused and leaves no trace", () => {
    const { get } = storeWith();
    const history = get().history;
    expect(get().addVectorLayer({ ...RECT, width: 0 }, 1, 1)).toBeNull();
    expect(get().addVectorLayer({ ...RECT, stroke: null, fill: null }, 1, 1)).toBeNull();
    expect(get().addVectorLayer(RECT, NaN, 1)).toBeNull();
    expect(get().history).toBe(history);
  });
  test("while comparing nothing can be added", () => {
    const { get } = storeWith();
    get().setCompareMode("split");
    const history = get().history;
    expect(get().addVectorLayer(RECT, 1, 1)).toBeNull();
    expect(get().history).toBe(history);
  });
});

describe("changing how a shape looks", () => {
  test("a colour or a width is one undo step, and an undo puts it back", () => {
    const ctx = withShape();
    const past = ctx.get().history!.past.length;
    expect(ctx.get().setLayerContent(ctx.id, { stroke: "#00ff00" })).toBe(true);
    expect(ctx.get().setLayerContent(ctx.id, { strokeWidth: 9, fill: null })).toBe(true);
    expect(layer(ctx).content).toMatchObject({ stroke: "#00ff00", strokeWidth: 9, fill: null });
    expect(ctx.get().history!.past).toHaveLength(past + 2);
    ctx.get().undo();
    expect(layer(ctx).content).toMatchObject({ stroke: "#00ff00", strokeWidth: 4, fill: "#ffcc00" });
  });
  test("the same value again records nothing", () => {
    const ctx = withShape();
    const history = ctx.get().history;
    expect(ctx.get().setLayerContent(ctx.id, { stroke: "#112233", strokeWidth: 4 })).toBe(false);
    expect(ctx.get().history).toBe(history);
  });
  test("stroke width is held between 0 and 200 and rounded to two places", () => {
    const ctx = withShape();
    ctx.get().setLayerContent(ctx.id, { strokeWidth: 999 });
    expect(layer(ctx).content).toMatchObject({ strokeWidth: 200 });
    ctx.get().setLayerContent(ctx.id, { strokeWidth: 2.456 });
    expect(layer(ctx).content).toMatchObject({ strokeWidth: 2.46 });
    ctx.get().setLayerContent(ctx.id, { strokeWidth: -3 });
    expect(layer(ctx).content).toMatchObject({ strokeWidth: 0 });
  });
  test("a shape cannot lose both its fill and its outline, and a line cannot lose its colour", () => {
    const ctx = withShape({ ...RECT, fill: null });
    const history = ctx.get().history;
    expect(ctx.get().setLayerContent(ctx.id, { stroke: null })).toBe(false);
    expect(ctx.get().history).toBe(history);
    const line = withShape(LINE);
    expect(line.get().setLayerContent(line.id, { stroke: null })).toBe(false);
    expect(line.get().setLayerContent(line.id, { stroke: "not a colour" })).toBe(false);
  });
  test("a locked layer refuses, and so does comparing, and a bitmap layer has nothing to change", () => {
    const ctx = withShape();
    ctx.get().setLayerLocked(ctx.id, true);
    expect(ctx.get().setLayerContent(ctx.id, { stroke: "#00ff00" })).toBe(false);
    ctx.get().setLayerLocked(ctx.id, false);
    ctx.get().setCompareMode("original");
    expect(ctx.get().setLayerContent(ctx.id, { stroke: "#00ff00" })).toBe(false);
    ctx.get().setCompareMode("off");
    const bmp = storeWith();
    const b = committedId(bmp.get().beginExtraction(CARD));
    expect(bmp.get().setLayerContent(b, { stroke: "#00ff00" })).toBe(false);
  });
});

describe("a vector layer is a layer like the others", () => {
  test("resizing changes its box, not its scale, so the stroke keeps its thickness; one undo step", () => {
    const ctx = withShape();
    ctx.get().transformLayer(ctx.id, { x: 10, y: 8, scaleX: 2, scaleY: 0.5, rotation: 0 });
    expect(layer(ctx).content).toMatchObject({ width: 80, height: 10, strokeWidth: 4 });
    expect(layer(ctx).transform).toEqual({ x: 10, y: 8, scaleX: 1, scaleY: 1, rotation: 0 });
    ctx.get().undo();
    expect(layer(ctx).content).toMatchObject({ width: 40, height: 20 });
  });
  test("rotating keeps the box and turns the layer", () => {
    const ctx = withShape();
    ctx.get().transformLayer(ctx.id, { x: 10, y: 8, scaleX: 1, scaleY: 1, rotation: 30 });
    expect(layer(ctx)).toMatchObject({ transform: { rotation: 30, scaleX: 1 }, content: { width: 40, height: 20 } });
  });
  test("a locked layer refuses to be resized; reset goes back to upright", () => {
    const ctx = withShape();
    ctx.get().transformLayer(ctx.id, { x: 10, y: 8, scaleX: 1, scaleY: 1, rotation: 45 });
    expect(ctx.get().resetLayerTransform(ctx.id)).toBe(true);
    expect(layer(ctx).transform.rotation).toBe(0);
    ctx.get().setLayerLocked(ctx.id, true);
    expect(ctx.get().transformLayer(ctx.id, { x: 10, y: 8, scaleX: 3, scaleY: 3, rotation: 0 })).toBe(false);
  });
  test("move, duplicate, copy/paste, reorder, rename, hide, lock and delete all work, each as one undo step", () => {
    const ctx = withShape();
    ctx.get().previewLayerDrag(ctx.id, 50, 60);
    expect(ctx.get().commitLayerDrag()).toBe(true);
    expect(layer(ctx).transform).toMatchObject({ x: 50, y: 60 });

    const dup = ctx.get().duplicateLayer(ctx.id)!;
    const copy = ctx.layers().find((l) => l.id === dup)!;
    expect(copy).toMatchObject({ content: RECT, transform: { x: 66, y: 76 }, visible: true, locked: false });
    expect(copy.imageId).toBeUndefined();

    ctx.get().copyLayer(ctx.id);
    expect(ctx.get().pasteLayer()).not.toBeNull();
    expect(ctx.layers()).toHaveLength(3);

    expect(ctx.get().reorderLayer(ctx.id, 1)).toBe(true);
    expect(ctx.get().renameLayer(ctx.id, "Frame")).toBe(true);
    expect(ctx.get().setLayerVisible(ctx.id, false)).toBe(true);
    expect(ctx.get().setLayerLocked(ctx.id, true)).toBe(true);
    expect(ctx.get().deleteLayer(ctx.id)).toBe(false); // locked
    ctx.get().setLayerLocked(ctx.id, false);
    expect(ctx.get().deleteLayer(ctx.id)).toBe(true);
    ctx.get().undo();
    expect(ctx.layers().some((l) => l.id === ctx.id)).toBe(true);
  });
  test("editing the copy's colour leaves the original's alone", () => {
    const ctx = withShape();
    const dup = ctx.get().duplicateLayer(ctx.id)!;
    ctx.get().setLayerContent(dup, { stroke: "#00ff00" });
    expect(layer(ctx).content).toMatchObject({ stroke: "#112233" });
  });
  test("while comparing every one of these is refused", () => {
    const ctx = withShape();
    ctx.get().setCompareMode("split");
    const history = ctx.get().history;
    expect(ctx.get().duplicateLayer(ctx.id)).toBeNull();
    expect(ctx.get().deleteLayer(ctx.id)).toBe(false);
    expect(ctx.get().transformLayer(ctx.id, { x: 0, y: 0, scaleX: 2, scaleY: 2, rotation: 0 })).toBe(false);
    expect(ctx.get().history).toBe(history);
  });
});

describe("saving a project with vector layers", () => {
  test("it serialises and parses back exactly, with no image reference for the vector layer", () => {
    const ctx = withShape();
    ctx.get().addVectorLayer(LINE, 5, 5);
    const project = ctx.get().snapshotProject()!;
    const r = parseProject(serializeProject(project));
    expect(r.ok && r.project).toEqual(project);
    expect(referencedImageIds(project)).toHaveLength(1); // only the capture
    expect(serializeProject(project)).not.toMatch(/blob:|data:|base64/i);
  });
  test("a project file round-trips through save and open, in a fresh blob store", async () => {
    const ctx = withShape();
    ctx.get().transformLayer(ctx.id, { x: 12, y: 9, scaleX: 1.5, scaleY: 1, rotation: 20 });
    const project = ctx.get().snapshotProject()!;
    const codec = fakeCodec();
    const text = await saveProjectText(project, ctx.get().images, { blobs: await openBlobStore("a", new IDBFactory()), codec });
    const opened = await loadProjectText(text, { blobs: await openBlobStore("b", new IDBFactory()), codec });
    expect(opened.ok && opened.project).toEqual(project);
  });
  test.each([
    ["an unknown kind", { ...RECT, kind: "star" }],
    ["a zero-size box", { ...RECT, width: 0 }],
    ["a stroke width that is not a number", { ...RECT, strokeWidth: "3" }],
    ["a colour that is not one", { ...RECT, fill: "yellow" }],
    ["neither fill nor outline", { ...RECT, fill: null, stroke: null }],
    ["a line without a direction", { ...LINE, direction: "sideways" }],
    ["a line without a colour", { ...LINE, stroke: null }],
  ])("a file with %s is refused", (_n, content) => {
    expect(contentError(content)).not.toBeNull();
    const project = withShape().get().snapshotProject()!;
    const doc = JSON.parse(serializeProject(project));
    doc.screens[0].layers[0].content = content;
    expect(parseProject(JSON.stringify(doc)).ok).toBe(false);
  });
  test("a vector layer that also names an image is refused", () => {
    const doc = JSON.parse(serializeProject(withShape().get().snapshotProject()!));
    doc.screens[0].layers[0].imageId = "some-image";
    const r = parseProject(JSON.stringify(doc));
    expect(r.ok).toBe(false);
  });
});

describe("the finished screen with vector layers", () => {
  /** a stand-in for the canvas rasteriser: a solid sprite the size of the layer's box, at its rounded position */
  const fake: Rasterize = (content, t) => ({ image: solid(Math.round(content.width), Math.round(content.height), [200, 0, 0, 255]), x: Math.round(t.x), y: Math.round(t.y) });

  test("a visible vector layer is drawn above the page and below a layer with a higher zIndex", () => {
    const ctx = storeWith();
    ctx.get().addVectorLayer({ ...RECT, width: 20, height: 20 }, 5, 5);
    const out = renderProjectRaw(ctx.get().snapshotProject()!, ctx.get().images, fake);
    expect([out.width, out.height]).toEqual([60, 40]);
    expect(getPixel(out, 22, 22)).toEqual([200, 0, 0, 255]);
    expect(getPixel(out, 40, 30)).toEqual(GRAY);
  });
  test("a hidden vector layer is left out", () => {
    const ctx = storeWith();
    const id = ctx.get().addVectorLayer({ ...RECT, width: 20, height: 20 }, 5, 5)!;
    ctx.get().setLayerVisible(id, false);
    expect(getPixel(renderProjectRaw(ctx.get().snapshotProject()!, ctx.get().images, fake), 22, 22)).toEqual(GRAY); // plain page under the layer
  });
  test("the rasteriser is told the frame size, so it can clip to it", () => {
    const ctx = storeWith();
    ctx.get().addVectorLayer(RECT, 5, 5);
    const seen: { width: number; height: number }[] = [];
    renderProjectRaw(ctx.get().snapshotProject()!, ctx.get().images, (c, t, frame) => (seen.push(frame), fake(c, t, frame)));
    expect(seen).toEqual([{ width: 60, height: 40 }]);
  });
  test("a vector layer needs no image in the cache", () => {
    const ctx = storeWith();
    ctx.get().addVectorLayer(RECT, 5, 5);
    expect(() => renderProjectRaw(ctx.get().snapshotProject()!, ctx.get().images, fake)).not.toThrow();
  });
});
