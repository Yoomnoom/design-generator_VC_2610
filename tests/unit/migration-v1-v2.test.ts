import { IDBFactory } from "fake-indexeddb";
import fs from "node:fs";
import { describe, expect, test } from "vitest";
import { loadProjectText, saveProjectText } from "@/features/project-persistence/project-io";
import { referencedImageIds } from "@/features/project-persistence/sync-images";
import { ImageCodec } from "@/lib/image/codec";
import { migrate } from "@/lib/project/migrate";
import { parseProject, serializeProject } from "@/lib/project/parse";
import { CURRENT_VERSION } from "@/lib/project/schema";
import { openBlobStore } from "@/lib/storage/blob-store";
import { createEditorStore } from "@/store/editor-store";
import { fakeCodec } from "./fixtures";
import { decodePng } from "./png";
import { makeLayer, makeProject } from "./helpers";

/* tests/fixtures/project-v1.slc.json was saved by the Phase 1 build itself (tag phase1), with two layers, one of them
 * moved and sent backwards. It is the evidence that files people already have keep opening. */
const v1Text = fs.readFileSync("tests/fixtures/project-v1.slc.json", "utf8");
const expected = JSON.parse(fs.readFileSync("tests/fixtures/project-v1.expected.json", "utf8")) as { layers: { name: string; x: number; y: number; zIndex: number; crop: object }[]; patches: number };

/** the fixture holds real PNGs, so reading it back needs a real PNG decoder */
const pngCodec: ImageCodec = { encode: async () => { throw new Error("not needed"); }, decode: async (blob) => decodePng(Buffer.from(await blob.arrayBuffer())) };

describe("the file Phase 1 saved", () => {
  test("it really is version 1, with the fixed 1/1/0 transform", () => {
    const file = JSON.parse(v1Text);
    expect(file.project.version).toBe(1);
    for (const l of file.project.screens[0].layers) expect(l.transform).toMatchObject({ scaleX: 1, scaleY: 1, rotation: 0 });
  });

  test("it opens as it is, and comes out as version 2 with the same layers in the same places", async () => {
    const blobs = await openBlobStore("v1", new IDBFactory());
    const result = await loadProjectText(v1Text, { blobs, codec: pngCodec });
    if (!result.ok) throw new Error(result.error);
    expect(result.project.version).toBe(CURRENT_VERSION);
    const screen = result.project.screens[0];
    expect(screen.layers.map((l) => ({ name: l.name, x: l.transform.x, y: l.transform.y, zIndex: l.zIndex, crop: l.crop }))).toEqual(expected.layers);
    expect(screen.backgroundPatches).toHaveLength(expected.patches);
    for (const l of screen.layers) expect(l.transform).toMatchObject({ scaleX: 1, scaleY: 1, rotation: 0 });
  });

  test("its images (a real PNG capture and the extracted layers) decode, at the right sizes", async () => {
    const blobs = await openBlobStore("v1b", new IDBFactory());
    const result = await loadProjectText(v1Text, { blobs, codec: pngCodec });
    if (!result.ok) throw new Error(result.error);
    const screen = result.project.screens[0];
    const source = result.images.get(screen.source.imageId)!.raw;
    expect([source.width, source.height]).toEqual([screen.width, screen.height]);
    for (const l of screen.layers) {
      const raw = result.images.get(l.imageId!)!.raw;
      expect([raw.width, raw.height]).toEqual([l.crop.width, l.crop.height]);
    }
    expect((await blobs.keys()).sort()).toEqual(referencedImageIds(result.project).sort());
  });

  test("opened and saved again, it is a version 2 file that opens again", async () => {
    const blobs = await openBlobStore("v1c", new IDBFactory());
    const opened = await loadProjectText(v1Text, { blobs, codec: pngCodec });
    if (!opened.ok) throw new Error(opened.error);
    const store = createEditorStore();
    store.getState().loadProject(opened.project, opened.images);
    // saving needs an encoder; the images keep their original blobs, so nothing is re-encoded
    const saved = await saveProjectText(store.getState().snapshotProject()!, store.getState().images, { blobs, codec: fakeCodec() });
    expect(JSON.parse(saved).project.version).toBe(2);
    const again = await loadProjectText(saved, { blobs: await openBlobStore("v1d", new IDBFactory()), codec: pngCodec });
    expect(again.ok).toBe(true);
  });
});

describe("migrate 1 → 2", () => {
  const v1 = () => {
    const p = JSON.parse(serializeProject(makeProject([makeLayer("a", 0), makeLayer("b", 1)])));
    p.version = 1;
    return p;
  };

  test("the version becomes 2 and the placements of the layers are untouched", () => {
    const doc = v1();
    doc.screens[0].layers[0].transform = { x: 12, y: 34, scaleX: 1, scaleY: 1, rotation: 0 };
    const r = migrate(doc);
    expect(r.ok && r.doc.version).toBe(2);
    expect(r.ok && (r.doc.screens as any)[0].layers[0].transform).toEqual({ x: 12, y: 34, scaleX: 1, scaleY: 1, rotation: 0 });
  });

  test("a file missing scale and rotation gets 1, 1 and 0", () => {
    const doc = v1();
    doc.screens[0].layers[0].transform = { x: 5, y: 6 };
    const r = migrate(doc);
    expect(r.ok && (r.doc.screens as any)[0].layers[0].transform).toEqual({ x: 5, y: 6, scaleX: 1, scaleY: 1, rotation: 0 });
  });

  test("values that are already there are kept, not overwritten with defaults", () => {
    const doc = v1();
    doc.screens[0].layers[0].transform = { x: 0, y: 0, scaleX: 2, scaleY: 0.5, rotation: 30 };
    expect((migrate(doc) as any).doc.screens[0].layers[0].transform).toMatchObject({ scaleX: 2, scaleY: 0.5, rotation: 30 });
  });

  test("it does not touch the document it was given", () => {
    const doc = v1();
    const before = JSON.stringify(doc);
    migrate(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  test("malformed screens or layers pass through for the validator to reject, without a crash", () => {
    for (const bad of [{ screens: "x" }, { screens: [null] }, { screens: [{ layers: [1, null, { transform: 5 }] }] }]) {
      expect(migrate({ ...v1(), ...bad }).ok).toBe(true);
    }
    expect(parseProject(JSON.stringify({ ...v1(), screens: [{ layers: [1] }] })).ok).toBe(false);
  });

  test("a version 2 file is not migrated again", () => {
    const doc = JSON.parse(serializeProject(makeProject([makeLayer("a", 0, { transform: { x: 1, y: 2, scaleX: 3, scaleY: 3, rotation: 45 } })])));
    expect((migrate(doc) as any).doc).toEqual(doc);
  });

  test("parseProject takes a v1 text straight to a valid v2 project", () => {
    const r = parseProject(JSON.stringify(v1()));
    expect(r.ok && r.project.version).toBe(2);
  });
});

describe("a v2 file with a rotated and scaled layer", () => {
  test("round trips through serialize and parse", () => {
    const layer = makeLayer("a", 0, { transform: { x: 10.5, y: -4, scaleX: 1.75, scaleY: 0.4, rotation: -33.25 } });
    const project = makeProject([layer]);
    const r = parseProject(serializeProject(project));
    expect(r.ok && r.project.screens[0].layers[0].transform).toEqual(layer.transform);
  });

  test("a mirrored (negative) scale is allowed", () => {
    expect(parseProject(serializeProject(makeProject([makeLayer("a", 0, { transform: { x: 0, y: 0, scaleX: -1, scaleY: 1, rotation: 0 } })]))).ok).toBe(true);
  });
});
