import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, test, vi } from "vitest";
import { FILE_FORMAT, buildProjectFile, parseProjectFile, restoreProjectFile, serializeProjectFile } from "@/features/project-persistence/project-file";
import { pruneBlobStore, referencedImageIds, syncImagesToBlobStore } from "@/features/project-persistence/sync-images";
import { sortByZ } from "@/features/layer-transform/order";
import { cropRaw } from "@/lib/image/crop-bitmap";
import { openBlobStore } from "@/lib/storage/blob-store";
import { createEditorStore } from "@/store/editor-store";
import { CARD, committedId, fakeCodec, pageWithCard, sequentialIds } from "./fixtures";

afterEach(() => vi.restoreAllMocks());

/** a project with the whole flow in it: upload, two extractions, a move, a duplicate, a reorder, a zoomed view */
async function editedSession(codec = fakeCodec()) {
  const raw = pageWithCard();
  const upload = new Blob([await (await codec.encode(raw)).arrayBuffer()], { type: "image/jpeg" }); // "the original file", with its own mime
  const store = createEditorStore({ genId: sequentialIds() });
  const get = () => store.getState();
  get().newProject({ fileName: "capture.jpg", raw, blob: upload });

  const card = committedId(get().beginExtraction(CARD));
  const corner = committedId(get().beginExtraction({ x: 40, y: 25, width: 10, height: 10 }));
  get().previewLayerDrag(card, 30, 5);
  get().commitLayerDrag();
  get().duplicateLayer(corner);
  get().reorderLayer(card, 1);
  get().setView({ zoom: 2, panX: -40, panY: -20 });
  return { raw, upload, codec, get, project: get().snapshotProject()!, images: get().images, card, corner };
}

const freshBlobs = (name = "db") => openBlobStore(name, new IDBFactory());

describe("syncing images into the blob store", () => {
  test("writes the source once, each layer bitmap once (a duplicate shares its original's)", async () => {
    const s = await editedSession();
    const blobs = await freshBlobs();
    const written = await syncImagesToBlobStore(s.project, s.images, s.codec, blobs);
    expect(written.sort()).toEqual(referencedImageIds(s.project).sort());
    expect(referencedImageIds(s.project)).toHaveLength(3); // source + 2 distinct bitmaps, 3 layers
    expect(s.project.screens[0].layers).toHaveLength(3);
  });

  test("the uploaded file is stored as it came in, with its own mime type", async () => {
    const s = await editedSession();
    const blobs = await freshBlobs();
    await syncImagesToBlobStore(s.project, s.images, s.codec, blobs);
    const stored = await blobs.get(s.project.screens[0].source.imageId);
    expect(stored!.type).toBe("image/jpeg");
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(new Uint8Array(await s.upload.arrayBuffer()));
  });

  test("a second sync writes nothing and encodes nothing", async () => {
    const s = await editedSession();
    const blobs = await freshBlobs();
    await syncImagesToBlobStore(s.project, s.images, s.codec, blobs);
    const encoded = s.codec.encodeCalls;
    expect(await syncImagesToBlobStore(s.project, s.images, s.codec, blobs)).toEqual([]);
    expect(s.codec.encodeCalls).toBe(encoded);
  });

  test("a referenced image that was never loaded is an error, not silently skipped", async () => {
    const s = await editedSession();
    await expect(syncImagesToBlobStore(s.project, new Map(), s.codec, await freshBlobs())).rejects.toThrow(/not loaded/);
  });

  test("prune removes only blobs the project does not reference", async () => {
    const s = await editedSession();
    const blobs = await freshBlobs();
    await syncImagesToBlobStore(s.project, s.images, s.codec, blobs);
    await blobs.put("orphan", new Blob([new Uint8Array([1])]));
    expect(await pruneBlobStore(s.project, blobs)).toEqual(["orphan"]);
    expect((await blobs.keys()).sort()).toEqual(referencedImageIds(s.project).sort());
  });
});

describe("no Blob URL is ever written", () => {
  test("the saved file has no blob: anywhere, and createObjectURL is never called", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    const s = await editedSession();
    const blobs = await freshBlobs();
    await syncImagesToBlobStore(s.project, s.images, s.codec, blobs);
    const text = serializeProjectFile(await buildProjectFile(s.project, blobs));

    expect(text).not.toMatch(/blob:/i);
    expect(createObjectURL).not.toHaveBeenCalled();
    // project JSON references images by id; image data is bare base64, not a data: URL
    const file = JSON.parse(text);
    expect(JSON.stringify(file.project)).not.toMatch(/data:|base64/i);
    for (const image of Object.values(file.images) as { mime: string; data: string }[]) expect(image.data).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(s.project.screens[0].layers.every((l) => !!l.imageId && !l.imageId.includes(":"))).toBe(true);
  });

  test("a file whose imageId is a Blob URL is refused on load", async () => {
    const s = await editedSession();
    const blobs = await freshBlobs();
    await syncImagesToBlobStore(s.project, s.images, s.codec, blobs);
    const file = JSON.parse(serializeProjectFile(await buildProjectFile(s.project, blobs)));
    file.project.screens[0].layers[0].imageId = "blob:http://localhost:3000/1234";
    const result = parseProjectFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("imageId");
  });
});

describe("save → load round trip", () => {
  async function roundTrip() {
    const s = await editedSession();
    const blobsA = await freshBlobs("a");
    await syncImagesToBlobStore(s.project, s.images, s.codec, blobsA);
    const text = serializeProjectFile(await buildProjectFile(s.project, blobsA));

    // a different browser profile: new blob store, new editor
    const parsed = parseProjectFile(text);
    if (!parsed.ok) throw new Error(parsed.error);
    const blobsB = await freshBlobs("b");
    const restored = await restoreProjectFile(parsed.file, blobsB, s.codec);
    const store = createEditorStore({ genId: sequentialIds() });
    store.getState().loadProject(restored.project, restored.images);
    return { s, text, blobsB, restored, store, loaded: store.getState() };
  }

  test("the project comes back identical: layers, positions, order, patches, canvas", async () => {
    const { s, loaded } = await roundTrip();
    expect(loaded.snapshotProject()).toEqual(s.project);
    const order = (p: typeof s.project) => sortByZ(p.screens[0].layers).map((l) => [l.id, l.zIndex, l.transform.x, l.transform.y]);
    expect(order(loaded.history!.present)).toEqual(order(s.project));
    expect(loaded.view).toEqual({ zoom: 2, panX: -40, panY: -20 });
    expect(loaded.history!.past).toHaveLength(0);
  });

  test("the original image and every extracted bitmap come back pixel for pixel", async () => {
    const { s, restored } = await roundTrip();
    for (const id of referencedImageIds(s.project)) {
      const before = s.images.get(id)!.raw;
      const after = restored.images.get(id)!.raw;
      expect([after.width, after.height]).toEqual([before.width, before.height]);
      expect(Array.from(after.data)).toEqual(Array.from(before.data));
    }
    const screen = s.project.screens[0];
    const source = restored.images.get(screen.source.imageId)!.raw;
    expect([source.width, source.height]).toEqual([screen.width, screen.height]);
    const layer = screen.layers.find((l) => l.id === s.card)!;
    expect(Array.from(restored.images.get(layer.imageId!)!.raw.data)).toEqual(Array.from(cropRaw(source, layer.crop).data));
  });

  test("the restored blob store holds exactly the referenced images, with their mime types", async () => {
    const { s, blobsB } = await roundTrip();
    expect((await blobsB.keys()).sort()).toEqual(referencedImageIds(s.project).sort());
    expect((await blobsB.get(s.project.screens[0].source.imageId))!.type).toBe("image/jpeg");
  });

  test("the loaded project can be edited and undone as usual", async () => {
    const { loaded, store, s } = await roundTrip();
    const layerId = s.project.screens[0].layers[0].id;
    loaded.previewLayerDrag(layerId, 1, 2);
    expect(store.getState().commitLayerDrag()).toBe(true);
    store.getState().undo();
    expect(store.getState().snapshotProject()).toEqual(s.project);
  });
});

describe("loading a bad file", () => {
  const goodFile = async () => {
    const s = await editedSession();
    const blobs = await freshBlobs();
    await syncImagesToBlobStore(s.project, s.images, s.codec, blobs);
    return { s, blobs, file: JSON.parse(serializeProjectFile(await buildProjectFile(s.project, blobs))) };
  };
  const errorOf = (file: unknown) => {
    const r = parseProjectFile(typeof file === "string" ? file : JSON.stringify(file));
    return r.ok ? null : r.error;
  };

  test("not JSON, wrong format, wrong shape", async () => {
    expect(errorOf("{nope")).toContain("JSON");
    expect(errorOf({ format: "something-else" })).toContain("프로젝트 파일");
    const { file } = await goodFile();
    file.images = [];
    expect(errorOf(file)).toContain("images");
  });

  test("two screens are refused (Phase 1 is single-screen)", async () => {
    const { file } = await goodFile();
    file.project.screens.push(structuredClone(file.project.screens[0]));
    expect(errorOf(file)).toContain("1개");
  });

  test("an image the project needs but the file lacks", async () => {
    const { file } = await goodFile();
    delete file.images[file.project.screens[0].layers[0].imageId];
    expect(errorOf(file)).toContain("파일에 없습니다");
  });

  test("a malformed image entry", async () => {
    const { file } = await goodFile();
    file.images[file.project.screens[0].source.imageId] = { mime: 5 };
    expect(errorOf(file)).toContain("형식");
  });

  test("a corrupt image fails before the existing blob store is touched", async () => {
    const { file, s } = await goodFile();
    const parsed = parseProjectFile(JSON.stringify(file));
    if (!parsed.ok) throw new Error(parsed.error);
    parsed.file.images[s.project.screens[0].source.imageId].data = "AAAA"; // 3 bytes: not an image
    const blobs = await freshBlobs();
    await blobs.put("existing", new Blob([new Uint8Array([1])]));
    await expect(restoreProjectFile(parsed.file, blobs, s.codec)).rejects.toThrow();
    expect(await blobs.keys()).toEqual(["existing"]);
  });

  test("the file format marker is part of what gets saved", async () => {
    expect((await goodFile()).file.format).toBe(FILE_FORMAT);
  });
});
