import fs from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, test } from "vitest";
import { renderProjectRaw } from "@/features/export-image/export-png";
import { loadProjectText, saveProjectText } from "@/features/project-persistence/project-io";
import { identityMesh, identityQuad } from "@/lib/image/warp";
import { migrate } from "@/lib/project/migrate";
import { parseProject } from "@/lib/project/parse";
import { WarpMesh, WarpQuad } from "@/lib/project/schema";
import { openBlobStore } from "@/lib/storage/blob-store";
import { CARD, committedId, fakeCodec, storeWith } from "./fixtures";

const quad = (): WarpQuad => ({ kind: "quad", points: [{ x: 3, y: 0 }, { x: 20, y: 1 }, { x: 18, y: 10 }, { x: 0, y: 9 }] });
const withLayer = () => {
  const ctx = storeWith();
  return { ...ctx, id: committedId(ctx.get().beginExtraction(CARD)) };
};
const layerOf = (ctx: ReturnType<typeof withLayer>) => ctx.get().history!.present.screens[0].layers.find((l) => l.id === ctx.id)!;

describe("setLayerWarp", () => {
  test("stores the warp on the layer in one undo step; undo and redo take it off and put it back; the bitmap is the same", () => {
    const ctx = withLayer();
    const imageId = layerOf(ctx).imageId;
    const past = ctx.get().history!.past.length;
    expect(ctx.get().setLayerWarp(ctx.id, quad())).toBe(true);
    expect(ctx.get().history!.past.length).toBe(past + 1);
    expect(layerOf(ctx).warp).toEqual(quad());
    expect(layerOf(ctx).imageId).toBe(imageId); // not a new picture
    ctx.get().undo();
    expect(layerOf(ctx).warp).toBeUndefined();
    ctx.get().redo();
    expect(layerOf(ctx).warp).toEqual(quad());
  });

  test("a warp that changes nothing, or null, removes the warp; with none there is nothing to do and no history entry", () => {
    const ctx = withLayer();
    expect(ctx.get().setLayerWarp(ctx.id, null)).toBe(false);
    expect(ctx.get().setLayerWarp(ctx.id, identityQuad(20, 10))).toBe(false);
    ctx.get().setLayerWarp(ctx.id, quad());
    const past = ctx.get().history!.past.length;
    expect(ctx.get().setLayerWarp(ctx.id, identityMesh(3, 3, 20, 10))).toBe(true); // back to nothing
    expect(layerOf(ctx).warp).toBeUndefined();
    expect(ctx.get().history!.past.length).toBe(past + 1);
  });

  test("a locked layer refuses, and so does comparing", () => {
    const ctx = withLayer();
    ctx.get().setLayerLocked(ctx.id, true);
    expect(ctx.get().setLayerWarp(ctx.id, quad())).toBe(false);
    ctx.get().setLayerLocked(ctx.id, false);
    ctx.get().setCompareMode("split");
    expect(ctx.get().setLayerWarp(ctx.id, quad())).toBe(false);
    expect(layerOf(ctx).warp).toBeUndefined();
  });

  test("a vector layer is not a target", () => {
    const ctx = storeWith();
    const id = ctx.get().addVectorLayer({ kind: "rect", width: 20, height: 10, stroke: "#000000", strokeWidth: 2, fill: null }, 5, 5)!;
    expect(ctx.get().setLayerWarp(id, quad())).toBe(false);
  });

  test("a shape that cannot be kept (crossed corners) is refused", () => {
    const ctx = withLayer();
    const crossed: WarpQuad = { kind: "quad", points: [{ x: 0, y: 0 }, { x: 20, y: 10 }, { x: 20, y: 0 }, { x: 0, y: 10 }] };
    expect(ctx.get().setLayerWarp(ctx.id, crossed)).toBe(false);
  });

  test("points are kept to two decimals", () => {
    const ctx = withLayer();
    ctx.get().setLayerWarp(ctx.id, { kind: "quad", points: [{ x: 3.123456, y: 0 }, { x: 20, y: 1 }, { x: 18, y: 10 }, { x: 0, y: 9 }] });
    expect((layerOf(ctx).warp as WarpQuad).points[0].x).toBe(3.12);
  });

  test("a preview shows the warp without recording; committing makes one step; cancelling leaves nothing", () => {
    const ctx = withLayer();
    const past = ctx.get().history!.past.length;
    ctx.get().previewWarp(ctx.id, quad());
    ctx.get().previewWarp(ctx.id, { ...quad(), points: [{ x: 4, y: 0 }, { x: 20, y: 1 }, { x: 18, y: 10 }, { x: 0, y: 9 }] });
    expect(ctx.get().warpPreview?.layerId).toBe(ctx.id);
    expect(ctx.get().history!.past.length).toBe(past);
    expect(layerOf(ctx).warp).toBeUndefined();
    expect(ctx.get().commitWarpPreview()).toBe(true);
    expect(ctx.get().history!.past.length).toBe(past + 1);
    expect(ctx.get().warpPreview).toBeNull();
    ctx.get().previewWarp(ctx.id, quad());
    ctx.get().cancelWarpPreview();
    expect(ctx.get().commitWarpPreview()).toBe(false);
    expect(ctx.get().history!.past.length).toBe(past + 1);
  });

  test("a preview of a locked layer or while comparing shows nothing", () => {
    const ctx = withLayer();
    ctx.get().setCompareMode("original");
    ctx.get().previewWarp(ctx.id, quad());
    expect(ctx.get().warpPreview).toBeNull();
  });
});

describe("converting between corner handles and a grid", () => {
  test("to a grid keeps the shape (the grid's corners are the quad's), the size can change, and back to corners keeps the corners", () => {
    const ctx = withLayer();
    ctx.get().setLayerWarp(ctx.id, quad());
    expect(ctx.get().convertWarp(ctx.id, { mode: "mesh", cols: 3, rows: 2 })).toBe(true);
    const m = layerOf(ctx).warp as WarpMesh;
    expect([m.kind, m.cols, m.rows, m.points.length]).toEqual(["mesh", 3, 2, 12]);
    expect(m.points[0]).toEqual({ x: 3, y: 0 });
    expect(m.points[3]).toEqual({ x: 20, y: 1 });
    expect(m.points[11]).toEqual({ x: 18, y: 10 });
    expect(ctx.get().convertWarp(ctx.id, { mode: "mesh", cols: 4, rows: 4 })).toBe(true);
    expect((layerOf(ctx).warp as WarpMesh).points).toHaveLength(25);
    expect(ctx.get().convertWarp(ctx.id, { mode: "quad", cols: 4, rows: 4 })).toBe(true);
    expect((layerOf(ctx).warp as WarpQuad).points).toEqual(quad().points);
  });

  test("on a layer with no warp only the handles change; nothing is stored", () => {
    const ctx = withLayer();
    const past = ctx.get().history!.past.length;
    expect(ctx.get().convertWarp(ctx.id, { mode: "mesh", cols: 5, rows: 5 })).toBe(false);
    expect(layerOf(ctx).warp).toBeUndefined();
    expect(ctx.get().warpUi).toEqual({ mode: "mesh", cols: 5, rows: 5 });
    expect(ctx.get().history!.past.length).toBe(past);
  });
});

describe("the warp tool", () => {
  test("starts on exactly one bitmap layer that can be changed, and says why when it cannot", () => {
    const ctx = withLayer();
    ctx.get().setTool("warp");
    expect(ctx.get().activeTool).toBe("warp");
    expect(ctx.get().warpSession?.layerId).toBe(ctx.id);
    ctx.get().setTool("select");
    expect(ctx.get().warpSession).toBeNull();

    ctx.get().selectLayer(null);
    ctx.get().setTool("warp");
    expect(ctx.get().activeTool).toBe("select");
    expect(ctx.get().notice).toContain("하나만 선택");

    ctx.get().selectLayer(ctx.id);
    ctx.get().setLayerLocked(ctx.id, true);
    ctx.get().setTool("warp");
    expect(ctx.get().notice).toContain("잠긴");
    ctx.get().setLayerLocked(ctx.id, false);
    ctx.get().setCompareMode("original");
    ctx.get().setTool("warp");
    expect(ctx.get().notice).toContain("비교");
    expect(ctx.get().activeTool).toBe("select");

    const v = storeWith();
    const vid = v.get().addVectorLayer({ kind: "rect", width: 20, height: 10, stroke: "#000000", strokeWidth: 2, fill: null }, 5, 5)!;
    v.get().selectLayer(vid);
    v.get().setTool("warp");
    expect(v.get().notice).toContain("이미지(비트맵)");
  });

  test("Enter keeps what was done; Esc takes every step since the tool started back", () => {
    const ctx = withLayer();
    ctx.get().setTool("warp");
    ctx.get().setLayerWarp(ctx.id, quad());
    ctx.get().setLayerWarp(ctx.id, { kind: "quad", points: [{ x: 5, y: 0 }, { x: 20, y: 1 }, { x: 18, y: 10 }, { x: 0, y: 9 }] });
    ctx.get().finishWarp(true);
    expect(ctx.get().activeTool).toBe("select");
    expect((layerOf(ctx).warp as WarpQuad).points[0].x).toBe(5);

    const before = ctx.get().history!.past.length;
    ctx.get().setTool("warp");
    ctx.get().setLayerWarp(ctx.id, quad());
    ctx.get().setLayerWarp(ctx.id, null);
    ctx.get().setLayerWarp(ctx.id, quad());
    ctx.get().finishWarp(false);
    expect(ctx.get().history!.past.length).toBe(before);
    expect((layerOf(ctx).warp as WarpQuad).points[0].x).toBe(5); // as it was when the tool started
  });
});

describe("a warp travels with its layer", () => {
  test("duplicate and paste keep it; resetting the transform leaves it", () => {
    const ctx = withLayer();
    ctx.get().setLayerWarp(ctx.id, quad());
    const dup = ctx.get().duplicateLayer(ctx.id)!;
    expect(ctx.get().history!.present.screens[0].layers.find((l) => l.id === dup)!.warp).toEqual(quad());
    ctx.get().copyLayer(ctx.id);
    const pasted = ctx.get().pasteLayer()!;
    expect(ctx.get().history!.present.screens[0].layers.find((l) => l.id === pasted)!.warp).toEqual(quad());
    ctx.get().transformLayer(ctx.id, { x: 10, y: 10, scaleX: 2, scaleY: 2, rotation: 30 });
    ctx.get().resetLayerTransform(ctx.id);
    expect(layerOf(ctx).warp).toEqual(quad());
  });

  test("the brush does not draw on a warped layer", () => {
    const ctx = withLayer();
    ctx.get().setLayerWarp(ctx.id, quad());
    expect(ctx.get().commitBitmapEdit({ layerId: ctx.id, raw: ctx.get().images.get(layerOf(ctx).imageId!)!.raw, x: 0, y: 0, label: "x" })).toBeNull();
  });

  test("it is saved in the project file and opens again exactly; the exported picture is the same before and after", async () => {
    const ctx = withLayer();
    ctx.get().setLayerWarp(ctx.id, quad());
    ctx.get().transformLayer(ctx.id, { x: 12, y: 11, scaleX: 1.5, scaleY: 1.5, rotation: 20 });
    const project = ctx.get().snapshotProject()!;
    const codec = fakeCodec();
    const text = await saveProjectText(project, ctx.get().images, { blobs: await openBlobStore("a", new IDBFactory()), codec });
    const opened = await loadProjectText(text, { blobs: await openBlobStore("b", new IDBFactory()), codec });
    if (!opened.ok) throw new Error(opened.error);
    expect(opened.project.screens[0].layers[0].warp).toEqual(quad());
    expect(Array.from(renderProjectRaw(opened.project, opened.images).data)).toEqual(Array.from(renderProjectRaw(project, ctx.get().images).data));
  });
});

describe("the file format: warp (version 7)", () => {
  const v6 = fs.readFileSync("tests/fixtures/project-v6.slc.json", "utf8");
  const pngCodec = () => ({ encode: async () => new Blob(), decode: async (blob: Blob) => (await import("./png")).decodePng(Buffer.from(await blob.arrayBuffer())) });

  test("the file the previous build saved is version 6: bitmap, vector, text layers and a memo, no warp", () => {
    const p = JSON.parse(v6).project;
    expect(p.version).toBe(6);
    expect(p.screens[0].layers.length).toBeGreaterThanOrEqual(4);
    expect(p.screens[0].memos).toHaveLength(1);
    expect(p.screens[0].layers.some((l: { warp?: unknown }) => l.warp)).toBe(false);
  });

  test("it opens as it was, as version 7, every layer and memo untouched", async () => {
    const before = JSON.parse(v6).project;
    const r = await loadProjectText(v6, { blobs: await openBlobStore("v6", new IDBFactory()), codec: pngCodec() });
    if (!r.ok) throw new Error(r.error);
    expect(r.project.version).toBe(7);
    expect(r.project.screens[0].layers).toEqual(before.screens[0].layers);
    expect(r.project.screens[0].memos).toEqual(before.screens[0].memos);
    expect(migrate(before).ok).toBe(true);
  });

  const docWith = (warp: unknown, patch: Record<string, unknown> = {}) => {
    const doc = JSON.parse(v6).project;
    doc.version = 7;
    Object.assign(doc.screens[0].layers[0], { warp, ...patch });
    return JSON.stringify(doc);
  };
  test("a valid warp is accepted; junk, a wrong number of points, a vector layer with a warp are refused", () => {
    const good = { kind: "quad", points: [{ x: 3, y: 0 }, { x: 20, y: 1 }, { x: 18, y: 10 }, { x: 0, y: 9 }] };
    expect(parseProject(docWith(good)).ok).toBe(true);
    expect(parseProject(docWith({ kind: "mesh", cols: 2, rows: 2, points: identityMesh(2, 2, 20, 10).points })).ok).toBe(true);
    expect(parseProject(docWith({ kind: "quad", points: good.points.slice(0, 3) })).ok).toBe(false);
    expect(parseProject(docWith({ kind: "mesh", cols: 2, rows: 2, points: [] })).ok).toBe(false);
    expect(parseProject(docWith("warped")).ok).toBe(false);
    expect(parseProject(docWith({ kind: "quad", points: [{ x: "a", y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] })).ok).toBe(false);
    const doc = JSON.parse(docWith(good));
    const vec = doc.screens[0].layers.find((l: { content?: unknown }) => l.content);
    vec.warp = good;
    expect(parseProject(JSON.stringify(doc)).ok).toBe(false);
  });
});