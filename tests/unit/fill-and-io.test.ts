import { IDBFactory } from "fake-indexeddb";
import { describe, expect, test } from "vitest";
import { patchAt } from "@/features/background-fill/patch-at";
import { loadProjectText, saveProjectText } from "@/features/project-persistence/project-io";
import { referencedImageIds } from "@/features/project-persistence/sync-images";
import { openBlobStore } from "@/lib/storage/blob-store";
import { createEditorStore } from "@/store/editor-store";
import { CARD, committedId, fakeCodec, pageWithCard, sequentialIds, storeWith } from "./fixtures";

const patch = (id: string, x: number, y: number, w: number, h: number) => ({ id, rect: { x, y, width: w, height: h }, fill: "#ffffff" });

describe("patchAt", () => {
  test("finds the patch covering a point, edges included on the top/left only", () => {
    const patches = [patch("a", 10, 10, 20, 10)];
    expect(patchAt(patches, { x: 10, y: 10 })?.id).toBe("a");
    expect(patchAt(patches, { x: 29.9, y: 19.9 })?.id).toBe("a");
    expect(patchAt(patches, { x: 30, y: 15 })).toBeNull();
    expect(patchAt(patches, { x: 9.9, y: 15 })).toBeNull();
  });
  test("where patches overlap, the later one (drawn on top) wins", () => {
    expect(patchAt([patch("under", 0, 0, 50, 50), patch("over", 10, 10, 5, 5)], { x: 12, y: 12 })?.id).toBe("over");
    expect(patchAt([patch("under", 0, 0, 50, 50), patch("over", 10, 10, 5, 5)], { x: 40, y: 40 })?.id).toBe("under");
  });
  test("no patches, no hit", () => expect(patchAt([], { x: 1, y: 1 })).toBeNull());
});

describe("selecting a patch", () => {
  const withPatch = () => {
    const ctx = storeWith();
    const layerId = committedId(ctx.get().beginExtraction(CARD));
    return { ...ctx, layerId, patchId: ctx.patches()[0].id };
  };

  test("a patch and a layer are never selected together", () => {
    const { get, layerId, patchId } = withPatch();
    expect(get().selectedLayerIds).toEqual([layerId]);
    get().selectPatch(patchId);
    expect([get().selectedPatchId, get().selectedLayerIds]).toEqual([patchId, []]);
    get().selectLayer(layerId);
    expect([get().selectedPatchId, get().selectedLayerIds]).toEqual([null, [layerId]]);
  });

  test("unknown ids select nothing", () => {
    const { get } = withPatch();
    get().selectPatch("nope");
    expect(get().selectedPatchId).toBeNull();
  });

  test("undoing the extraction drops a selection that no longer exists", () => {
    const { get, patchId } = withPatch();
    get().selectPatch(patchId);
    get().undo();
    expect(get().selectedPatchId).toBeNull();
  });

  test("changing the colour of the selected patch is one undo step and keeps the selection", () => {
    const { get, patches, patchId } = withPatch();
    get().selectPatch(patchId);
    const past = get().history!.past.length;
    expect(get().setPatchColor(patchId, "#336699")).toBe(true);
    expect(patches()[0].fill).toBe("#336699");
    expect(get().history!.past).toHaveLength(past + 1);
    expect(get().selectedPatchId).toBe(patchId);
    get().undo();
    expect(patches()[0].fill).toBe("#f0f0f0");
  });
});

describe("project save and open", () => {
  const io = async () => ({ blobs: await openBlobStore("db", new IDBFactory()), codec: fakeCodec() });

  async function edited() {
    const codec = fakeCodec();
    const raw = pageWithCard();
    const store = createEditorStore({ genId: sequentialIds() });
    const get = () => store.getState();
    get().newProject({ fileName: "capture.png", raw, blob: await codec.encode(raw) });
    const a = committedId(get().beginExtraction(CARD));
    committedId(get().beginExtraction({ x: 40, y: 25, width: 10, height: 10 }));
    get().previewLayerDrag(a, 33, 7);
    get().commitLayerDrag();
    get().reorderLayer(a, 1);
    return { get, codec, project: get().snapshotProject()!, images: get().images };
  }

  test("saving then opening in a fresh browser profile restores the project", async () => {
    const s = await edited();
    const text = await saveProjectText(s.project, s.images, { blobs: await openBlobStore("a", new IDBFactory()), codec: s.codec });
    const result = await loadProjectText(text, { blobs: await openBlobStore("b", new IDBFactory()), codec: s.codec });
    expect(result.ok && result.project).toEqual(s.project);
    expect(result.ok && result.images.size).toBe(referencedImageIds(s.project).length);
  });

  test("saving does NOT prune: a layer deleted in this session keeps its bitmap so redo still works", async () => {
    const s = await edited();
    const layer = s.project.screens[0].layers[0];
    s.get().deleteLayer(layer.id);
    const live = { blobs: await openBlobStore("c", new IDBFactory()), codec: s.codec };
    await saveProjectText(s.project, s.images, live); // saved while the layer still existed
    await saveProjectText(s.get().snapshotProject()!, s.get().images, live); // saved after deleting it
    expect(await live.blobs.has(layer.imageId!)).toBe(true);
    s.get().undo();
    await expect(saveProjectText(s.get().snapshotProject()!, s.get().images, live)).resolves.toContain(layer.imageId!);
  });

  test("opening DOES prune: blobs the opened project does not use are removed afterwards", async () => {
    const s = await edited();
    const text = await saveProjectText(s.project, s.images, { blobs: await openBlobStore("d", new IDBFactory()), codec: s.codec });
    const target = { blobs: await openBlobStore("e", new IDBFactory()), codec: s.codec };
    await target.blobs.put("left-over-from-before", new Blob([new Uint8Array([1])]));
    const result = await loadProjectText(text, target);
    expect(result.ok).toBe(true);
    expect((await target.blobs.keys()).sort()).toEqual(referencedImageIds(s.project).sort());
  });

  test("a bad file leaves the existing blobs alone", async () => {
    const s = await edited();
    const target = { blobs: await openBlobStore("f", new IDBFactory()), codec: s.codec };
    await target.blobs.put("keep-me", new Blob([new Uint8Array([1])]));
    for (const text of ["{nope", JSON.stringify({ format: "other" })]) {
      const result = await loadProjectText(text, target);
      expect(result.ok).toBe(false);
    }
    expect(await target.blobs.keys()).toEqual(["keep-me"]);
  });

  test("a file whose image bytes are corrupt is reported, not thrown, and blobs are untouched", async () => {
    const s = await edited();
    const text = await saveProjectText(s.project, s.images, { blobs: await openBlobStore("g", new IDBFactory()), codec: s.codec });
    const file = JSON.parse(text);
    file.images[s.project.screens[0].source.imageId].data = "AAAA";
    const target = { blobs: await openBlobStore("h", new IDBFactory()), codec: s.codec };
    await target.blobs.put("keep-me", new Blob([new Uint8Array([1])]));
    const result = await loadProjectText(JSON.stringify(file), target);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("이미지") });
    expect(await target.blobs.keys()).toEqual(["keep-me"]);
  });
});
