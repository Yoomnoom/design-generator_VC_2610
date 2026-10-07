import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Autosave, LockManagerLike, createAutosave } from "@/features/autosave/autosave";
import { loadProjectText, saveProjectText } from "@/features/project-persistence/project-io";
import { referencedImageIds } from "@/features/project-persistence/sync-images";
import { AUTOSAVE_FORMAT, AutosaveRecord, openAutosaveStore } from "@/lib/storage/autosave-store";
import { createMemoryBlobStore, createSwitchableBlobStore, openBlobStore } from "@/lib/storage/blob-store";
import { createEditorStore } from "@/store/editor-store";
import { CARD, committedId, fakeCodec, pageWithCard } from "./fixtures";

afterEach(() => vi.restoreAllMocks());

const DB = "autosave-test";
const codec = fakeCodec();

/** Web Locks, shared by several simulated tabs: one holder per name, a queue behind it, and a way to close a tab */
class LockSim {
  private holder = new Map<string, string>();
  private queue = new Map<string, { tab: string; grant: () => void }[]>();

  forTab(tab: string): LockManagerLike {
    return {
      request: (name, options, callback) => {
        const run = () => {
          this.holder.set(name, tab);
          return callback({ name });
        };
        if (!this.holder.has(name)) return run();
        if (options.ifAvailable) return callback(null);
        return new Promise((resolve) => {
          const q = this.queue.get(name) ?? [];
          q.push({ tab, grant: () => resolve(run()) });
          this.queue.set(name, q);
        });
      },
    };
  }

  /** the tab goes away: it stops holding and stops waiting; the next in line gets the lock */
  close(tab: string) {
    for (const [name, holder] of this.holder) {
      if (holder !== tab) continue;
      this.holder.delete(name);
      const q = (this.queue.get(name) ?? []).filter((w) => w.tab !== tab);
      this.queue.set(name, q);
      q.shift()?.grant();
    }
    for (const [name, q] of this.queue) this.queue.set(name, q.filter((w) => w.tab !== tab));
  }
}

const until = async (check: () => boolean | Promise<boolean>, what = "condition", ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
};

let counter = 0;
function makeTab(factory: IDBFactory, locks: LockManagerLike | null, over: { records?: () => ReturnType<typeof openAutosaveStore> } = {}) {
  const prefix = `t${++counter}-`;
  let n = 0;
  const notices: string[] = [];
  const store = createEditorStore({ genId: () => `${prefix}${++n}` });
  const blobs = createSwitchableBlobStore(createMemoryBlobStore());
  const autosave: Autosave = createAutosave({
    editor: store,
    blobs,
    openIdbBlobs: () => openBlobStore(DB, factory),
    openRecords: over.records ?? (() => openAutosaveStore(DB, factory)),
    codec,
    locks,
    delayMs: 15,
    notify: (m) => notices.push(m),
  });
  const get = store.getState;
  /** a project with the whole flow in it: a capture, two layers, one moved, one hidden and locked, one renamed */
  const seed = async () => {
    const raw = pageWithCard();
    get().newProject({ fileName: "capture.png", raw, blob: await codec.encode(raw) });
    const a = committedId(get().beginExtraction(CARD));
    const b = committedId(get().beginExtraction({ x: 40, y: 25, width: 10, height: 10 }));
    get().previewLayerDrag(a, 30, 5);
    get().commitLayerDrag();
    get().reorderLayer(a, 1);
    get().renameLayer(b, "Corner");
    get().setLayerVisible(b, false);
    get().setLayerLocked(b, true);
    get().setView({ zoom: 2, panX: -40, panY: -20 });
    return { a, b };
  };
  return { store, blobs, autosave, get, notices, seed, prefix };
}

const readRecord = async (factory: IDBFactory) => {
  const s = await openAutosaveStore(DB, factory);
  const raw = (await s.get()) as AutosaveRecord | undefined;
  s.close();
  return raw;
};
const blobKeys = async (factory: IDBFactory) => {
  const s = await openBlobStore(DB, factory);
  const keys = (await s.keys()).sort();
  s.close();
  return keys;
};
const owner = (t: ReturnType<typeof makeTab>) => until(() => t.autosave.state.getState().ownership === "owner", "ownership");

describe("saving", () => {
  test("a moment after the project changes it is written: the record names the images, the blobs store holds them", async () => {
    const f = new IDBFactory();
    const t = makeTab(f, null);
    t.autosave.start();
    await owner(t);
    await t.seed();
    await until(async () => (await readRecord(f)) !== undefined, "the first save");
    const rec = (await readRecord(f))!;
    expect(rec).toMatchObject({ format: AUTOSAVE_FORMAT, version: 1, project: { name: "capture" } });
    expect(rec.savedAt).toBeGreaterThan(0);
    expect(await blobKeys(f)).toEqual(referencedImageIds(t.get().snapshotProject()!).sort());
    expect(t.autosave.state.getState()).toMatchObject({ saving: false, error: null, savedAt: rec.savedAt });
  });

  test("it is not written at once: edits made in a burst become one save", async () => {
    const f = new IDBFactory();
    let writes = 0;
    const counting = makeTab(f, null, {
      records: async () => {
        const real = await openAutosaveStore(DB, f);
        return { ...real, put: async (r: AutosaveRecord) => { writes++; await real.put(r); } };
      },
    });
    counting.autosave.start();
    await owner(counting);
    await counting.seed(); // a dozen store changes in a row
    expect(writes).toBe(0);
    await until(() => writes >= 1, "a save");
    await new Promise((r) => setTimeout(r, 100));
    expect(writes).toBe(1);
  });

  test("the record has no Blob URL and no embedded image data, and URL.createObjectURL is never called", async () => {
    const create = vi.spyOn(URL, "createObjectURL");
    const f = new IDBFactory();
    const t = makeTab(f, null);
    t.autosave.start();
    await owner(t);
    await t.seed();
    await until(async () => (await readRecord(f)) !== undefined, "a save");
    const text = JSON.stringify(await readRecord(f));
    expect(text).not.toMatch(/blob:|data:|base64/i);
    expect(create).not.toHaveBeenCalled();
  });

  test("nothing is saved while there is no project", async () => {
    const f = new IDBFactory();
    const t = makeTab(f, null);
    t.autosave.start();
    await owner(t);
    await new Promise((r) => setTimeout(r, 80));
    expect(await readRecord(f)).toBeUndefined();
  });

  test("a later edit updates the saved copy (and the layer bitmap it needs is there)", async () => {
    const f = new IDBFactory();
    const t = makeTab(f, null);
    t.autosave.start();
    await owner(t);
    await t.seed();
    await until(async () => (await readRecord(f)) !== undefined, "first save");
    const first = (await readRecord(f))!.savedAt;
    t.get().duplicateLayer(t.get().history!.present.screens[0].layers[0].id);
    await until(async () => ((await readRecord(f))?.savedAt ?? 0) > first, "second save");
    const project = (await readRecord(f))!.project as { screens: { layers: unknown[] }[] };
    expect(project.screens[0].layers).toHaveLength(3);
  });

  test("flush saves at once, without waiting for the delay (the page is going away)", async () => {
    const f = new IDBFactory();
    const t = makeTab(f, null);
    t.autosave.start();
    await owner(t);
    await t.seed();
    await t.autosave.flush();
    expect(await readRecord(f)).toBeDefined();
  });

  test("a failed save is reported in the state and does not throw; the next good one clears it", async () => {
    const f = new IDBFactory();
    let fail = true;
    const t = makeTab(f, null, {
      records: async () => {
        const real = await openAutosaveStore(DB, f);
        return { ...real, put: async (r: AutosaveRecord) => { if (fail) throw new Error("quota exceeded"); await real.put(r); } };
      },
    });
    t.autosave.start();
    await owner(t);
    await t.seed();
    await until(() => t.autosave.state.getState().error !== null, "the error");
    expect(t.autosave.state.getState().error).toContain("quota exceeded");
    fail = false;
    t.get().renameLayer(t.get().history!.present.screens[0].layers[0].id, "again");
    await until(() => t.autosave.state.getState().error === null && t.autosave.state.getState().savedAt !== null, "recovery");
  });
});

describe("restoring", () => {
  async function savedByAFirstSession(f: IDBFactory) {
    const first = makeTab(f, null);
    first.autosave.start();
    await owner(first);
    const ids = await first.seed();
    await first.autosave.flush();
    first.autosave.stop();
    return { ids, project: first.get().snapshotProject()! };
  }

  test("a new session is offered the saved copy, and restoring it brings back positions, order, patches, lock, hide, names and view", async () => {
    const f = new IDBFactory();
    const { project } = await savedByAFirstSession(f);
    const second = makeTab(f, null);
    second.autosave.start();
    await until(() => second.autosave.state.getState().candidate !== null, "the offer");
    expect(second.autosave.state.getState().candidate).toMatchObject({ name: "capture", width: 60, height: 40, layers: 2 });
    expect(second.get().history).toBeNull(); // nothing is loaded until the user says so

    expect(await second.autosave.restore()).toEqual({ ok: true });
    expect(second.get().snapshotProject()).toEqual(project);
    const layers = second.get().history!.present.screens[0].layers;
    expect(layers.find((l) => l.name === "Corner")).toMatchObject({ visible: false, locked: true });
    expect(second.get().history!.present.screens[0].backgroundPatches).toHaveLength(2);
    expect(second.get().view).toEqual({ zoom: 2, panX: -40, panY: -20 });
    expect(second.get().history!.past).toHaveLength(0); // a restored project starts with an empty history
    expect(second.autosave.state.getState().candidate).toBeNull();
  });

  test("the images come back pixel for pixel", async () => {
    const f = new IDBFactory();
    const first = makeTab(f, null);
    first.autosave.start();
    await owner(first);
    await first.seed();
    await first.autosave.flush();
    const before = first.get().images;
    const second = makeTab(f, null);
    second.autosave.start();
    await until(() => second.autosave.state.getState().candidate !== null, "the offer");
    await second.autosave.restore();
    for (const id of referencedImageIds(second.get().snapshotProject()!)) {
      expect(Array.from(second.get().images.get(id)!.raw.data)).toEqual(Array.from(before.get(id)!.raw.data));
    }
  });

  test("until the user answers, nothing overwrites the saved copy", async () => {
    const f = new IDBFactory();
    await savedByAFirstSession(f);
    const before = await readRecord(f);
    const second = makeTab(f, null);
    second.autosave.start();
    await until(() => second.autosave.state.getState().candidate !== null, "the offer");
    const raw = pageWithCard();
    second.get().newProject({ fileName: "other.png", raw, blob: await codec.encode(raw) }); // something else happens in the meantime
    await new Promise((r) => setTimeout(r, 120));
    expect(await readRecord(f)).toEqual(before);
    await second.autosave.flush();
    expect(await readRecord(f)).toEqual(before);
  });

  test("pruneBlobStore runs right after a restore, and only then: blobs nothing refers to are removed by it, not by saving", async () => {
    const f = new IDBFactory();
    await savedByAFirstSession(f);
    const planted = await openBlobStore(DB, f);
    await planted.put("left-over", new Blob([new Uint8Array([1])]));
    planted.close();

    const second = makeTab(f, null);
    second.autosave.start();
    await until(() => second.autosave.state.getState().candidate !== null, "the offer");
    expect(await blobKeys(f)).toContain("left-over"); // the offer alone prunes nothing
    await second.autosave.restore();
    expect(await blobKeys(f)).toEqual(referencedImageIds(second.get().snapshotProject()!).sort()); // pruned by the restore

    const again = await openBlobStore(DB, f);
    await again.put("later-left-over", new Blob([new Uint8Array([2])]));
    again.close();
    second.get().duplicateLayer(second.get().history!.present.screens[0].layers[0].id);
    await second.autosave.flush();
    expect(await blobKeys(f)).toContain("later-left-over"); // saving does not prune (undo needs the bitmaps)
  });

  test("after restoring, saving carries on", async () => {
    const f = new IDBFactory();
    await savedByAFirstSession(f);
    const second = makeTab(f, null);
    second.autosave.start();
    await until(() => second.autosave.state.getState().candidate !== null, "the offer");
    await second.autosave.restore();
    const was = (await readRecord(f))!.savedAt;
    second.get().renameLayer(second.get().history!.present.screens[0].layers[0].id, "edited after restore");
    await until(async () => ((await readRecord(f))?.savedAt ?? 0) > was, "a later save");
    expect(JSON.stringify((await readRecord(f))!.project)).toContain("edited after restore");
  });

  test("discarding removes the saved copy and its blobs, leaves an empty editor, and saving then starts from nothing", async () => {
    const f = new IDBFactory();
    await savedByAFirstSession(f);
    const second = makeTab(f, null);
    second.autosave.start();
    await until(() => second.autosave.state.getState().candidate !== null, "the offer");
    await second.autosave.discard();
    expect(second.autosave.state.getState().candidate).toBeNull();
    expect(second.get().history).toBeNull();
    expect(await readRecord(f)).toBeUndefined();
    expect(await blobKeys(f)).toEqual([]);

    const third = makeTab(f, null); // and a later session is not offered it again
    third.autosave.start();
    await owner(third);
    await new Promise((r) => setTimeout(r, 60));
    expect(third.autosave.state.getState().candidate).toBeNull();
  });

  test("restore or discard with nothing on offer does nothing", async () => {
    const f = new IDBFactory();
    const t = makeTab(f, null);
    t.autosave.start();
    await owner(t);
    expect((await t.autosave.restore()).ok).toBe(false);
    await t.autosave.discard();
  });
});

describe("a damaged saved copy", () => {
  async function plant(f: IDBFactory, value: unknown) {
    const s = await openAutosaveStore(DB, f);
    await s.put(value as AutosaveRecord);
    s.close();
  }
  const startedWith = async (f: IDBFactory) => {
    const t = makeTab(f, null);
    t.autosave.start();
    await owner(t);
    await until(() => t.notices.length > 0 || t.autosave.state.getState().candidate !== null, "a verdict");
    return t;
  };

  test.each([
    ["not an object", "garbage"],
    ["the wrong format", { format: "something else", version: 1, savedAt: 1, project: {} }],
    ["no project", { format: AUTOSAVE_FORMAT, version: 1, savedAt: 1 }],
    ["a project that does not validate", { format: AUTOSAVE_FORMAT, version: 1, savedAt: 1, project: { id: "x", name: "y", version: 2, canvas: { zoom: 1, panX: 0, panY: 0 }, screens: [] } }],
  ])("%s: it is not offered, the user is told, and it is removed", async (_name, value) => {
    const f = new IDBFactory();
    await plant(f, value);
    const t = await startedWith(f);
    expect(t.autosave.state.getState().candidate).toBeNull();
    expect(t.notices[0]).toContain("손상");
    expect(await readRecord(f)).toBeUndefined();
    expect(t.get().history).toBeNull();
  });

  test("a good record whose image is missing is damaged too", async () => {
    const f = new IDBFactory();
    const first = makeTab(f, null);
    first.autosave.start();
    await owner(first);
    await first.seed();
    await first.autosave.flush();
    first.autosave.stop();
    const blobs = await openBlobStore(DB, f);
    await blobs.delete((await blobs.keys())[0]);
    blobs.close();
    const t = await startedWith(f);
    expect(t.autosave.state.getState().candidate).toBeNull();
    expect(t.notices[0]).toContain("손상");
    expect(await readRecord(f)).toBeUndefined();
  });

  test("an image that cannot be decoded fails the restore cleanly: told, cleared, editor left empty", async () => {
    const f = new IDBFactory();
    const first = makeTab(f, null);
    first.autosave.start();
    await owner(first);
    await first.seed();
    await first.autosave.flush();
    first.autosave.stop();
    const blobs = await openBlobStore(DB, f);
    await blobs.put((await blobs.keys())[0], new Blob([new Uint8Array([1, 2, 3])])); // present, but not an image
    blobs.close();
    const t = makeTab(f, null);
    t.autosave.start();
    await until(() => t.autosave.state.getState().candidate !== null, "the offer");
    const r = await t.autosave.restore();
    expect(r.ok).toBe(false);
    expect(t.notices.at(-1)).toContain("복원하지 못했습니다");
    expect(t.get().history).toBeNull();
    expect(await readRecord(f)).toBeUndefined();
    expect(t.autosave.state.getState().candidate).toBeNull();
  });
});

describe("several tabs", () => {
  test("the first tab owns saving; the second is told so and never writes", async () => {
    const f = new IDBFactory();
    const locks = new LockSim();
    const a = makeTab(f, locks.forTab("A"));
    a.autosave.start();
    await owner(a);
    const b = makeTab(f, locks.forTab("B"));
    b.autosave.start();
    await until(() => b.autosave.state.getState().ownership === "other-tab", "B to learn it is not the owner");
    expect(a.autosave.state.getState().ownership).toBe("owner");

    await a.seed();
    await a.autosave.flush();
    const saved = (await readRecord(f))!;

    await b.seed(); // B works away
    await b.autosave.flush();
    await new Promise((r) => setTimeout(r, 120));
    expect(await readRecord(f)).toEqual(saved); // A's saved copy is untouched
  });

  test("what the second tab does with the blob store cannot delete the first tab's blobs", async () => {
    const f = new IDBFactory();
    const locks = new LockSim();
    const a = makeTab(f, locks.forTab("A"));
    a.autosave.start();
    await owner(a);
    await a.seed();
    await a.autosave.flush();
    const aBlobs = await blobKeys(f);
    expect(aBlobs.length).toBeGreaterThan(0);

    const b = makeTab(f, locks.forTab("B"));
    b.autosave.start();
    await until(() => b.autosave.state.getState().ownership === "other-tab", "B to learn it is not the owner");
    await new Promise((r) => setTimeout(r, 100)); // and stays that way
    expect(b.autosave.state.getState().ownership).toBe("other-tab");
    await b.seed();
    // B saves a project file and opens one: both go through the blob store, and opening clears and prunes it
    const text = await saveProjectText(b.get().snapshotProject()!, b.get().images, { blobs: b.blobs, codec });
    const opened = await loadProjectText(text, { blobs: b.blobs, codec });
    expect(opened.ok).toBe(true);
    await b.blobs.clear();
    await b.autosave.flush();
    await new Promise((r) => setTimeout(r, 100));

    expect(await blobKeys(f)).toEqual(aBlobs); // every one of A's blobs is still there, and none of B's has been added
    expect(await readRecord(f)).toBeDefined();
    // and A can still be restored from them
    const c = makeTab(f, null);
    c.autosave.start();
    await until(() => c.autosave.state.getState().candidate !== null, "the offer");
    expect((await c.autosave.restore()).ok).toBe(true);
  });

  test("a tab that is not the owner shows no offer, and does not touch a saved copy it was not asked about", async () => {
    const f = new IDBFactory();
    const locks = new LockSim();
    const a = makeTab(f, locks.forTab("A"));
    a.autosave.start();
    await owner(a);
    await a.seed();
    await a.autosave.flush();
    const b = makeTab(f, locks.forTab("B"));
    b.autosave.start();
    await until(() => b.autosave.state.getState().ownership === "other-tab", "B to learn it is not the owner");
    await new Promise((r) => setTimeout(r, 60));
    expect(b.autosave.state.getState().candidate).toBeNull();
    expect(await readRecord(f)).toBeDefined();
  });

  test("when the owning tab closes, the waiting tab takes over; it is offered that tab's saved copy, and may then save", async () => {
    const f = new IDBFactory();
    const locks = new LockSim();
    const a = makeTab(f, locks.forTab("A"));
    a.autosave.start();
    await owner(a);
    await a.seed();
    await a.autosave.flush();
    const b = makeTab(f, locks.forTab("B"));
    b.autosave.start();
    await until(() => b.autosave.state.getState().ownership === "other-tab", "B to wait");

    locks.close("A");
    await owner(b);
    await until(() => b.autosave.state.getState().candidate !== null, "B to be offered A's work");
    await b.seed(); // B has its own work in the meantime
    await new Promise((r) => setTimeout(r, 100));
    expect(((await readRecord(f))!.project as { name: string }).name).toBe("capture"); // not overwritten while B has not answered

    await b.autosave.discard();
    await b.autosave.flush();
    await until(async () => (await readRecord(f)) !== undefined, "B's own save");
  });

  test("a third tab queues behind the second", async () => {
    const f = new IDBFactory();
    const locks = new LockSim();
    const [a, b, c] = ["A", "B", "C"].map((n) => makeTab(f, locks.forTab(n)));
    a.autosave.start();
    await owner(a);
    b.autosave.start();
    c.autosave.start();
    await until(() => b.autosave.state.getState().ownership === "other-tab" && c.autosave.state.getState().ownership === "other-tab", "B and C to wait");
    locks.close("A");
    await owner(b);
    expect(c.autosave.state.getState().ownership).toBe("other-tab");
    locks.close("B");
    await owner(c);
  });

  test("without Web Locks the tab assumes it is alone and saves", async () => {
    const f = new IDBFactory();
    const t = makeTab(f, null);
    expect(t.autosave.state.getState().coordinated).toBe(false);
    t.autosave.start();
    await owner(t);
    await t.seed();
    await until(async () => (await readRecord(f)) !== undefined, "a save");
  });

  test("a tab that is not the owner keeps its blobs in memory only, and switching to IndexedDB later writes them", async () => {
    const f = new IDBFactory();
    const locks = new LockSim();
    const a = makeTab(f, locks.forTab("A"));
    a.autosave.start();
    await owner(a);
    const b = makeTab(f, locks.forTab("B"));
    b.autosave.start();
    await until(() => b.autosave.state.getState().ownership === "other-tab", "B to wait");
    await b.seed();
    await b.autosave.flush();
    expect(await blobKeys(f)).toEqual([]); // nothing of B's reached the shared database
    locks.close("A");
    await owner(b);
    await b.autosave.flush(); // B is now the owner: its project (no offer here: A never saved)
    await until(async () => (await blobKeys(f)).length > 0, "B's blobs to be written");
    expect(await blobKeys(f)).toEqual(referencedImageIds(b.get().snapshotProject()!).sort());
  });
});
