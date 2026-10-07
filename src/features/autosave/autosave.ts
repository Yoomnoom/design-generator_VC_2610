import { createStore, StoreApi } from "zustand/vanilla";
import { pruneBlobStore, referencedImageIds, syncImagesToBlobStore } from "@/features/project-persistence/sync-images";
import { ImageCodec } from "@/lib/image/codec";
import { parseProjectValue } from "@/lib/project/parse";
import { Project } from "@/lib/project/schema";
import { AUTOSAVE_FORMAT, AutosaveRecord, AutosaveStore } from "@/lib/storage/autosave-store";
import { BlobStore, SwitchableBlobStore } from "@/lib/storage/blob-store";
import { EditorStoreApi } from "@/store/editor-store";
import { RuntimeImage } from "@/store/images";

/* Automatic temporary save.
 *
 * The project is written to IndexedDB a moment after it changes: the project JSON in the `autosave` store, its images as Blobs
 * in the `blobs` store (the same rule as everywhere: no Blob URLs, no base64 in the record). When the app is opened and a saved
 * copy exists, the user is asked whether to restore it; until they answer, nothing overwrites it.
 *
 * Only ONE tab may write: the one that holds a Web Lock. Any other tab works on an in-memory blob store, so nothing it does
 * (saving a file, opening a project, which clear and prune the blob store) can touch the blobs the owning tab's record depends on.
 * If the owner goes away, a waiting tab takes over. */

export const LOCK_NAME = "screenshot-layer-canvas-autosave";
export const AUTOSAVE_DELAY_MS = 800;

/** the part of navigator.locks that is used */
export type LockManagerLike = {
  request(name: string, options: { ifAvailable?: boolean }, callback: (lock: unknown) => Promise<unknown>): Promise<unknown>;
};

export type Candidate = { savedAt: number; name: string; width: number; height: number; layers: number };

export type AutosaveState = {
  ownership: "checking" | "owner" | "other-tab";
  /** false when the browser has no Web Locks: the app then has to assume it is the only tab */
  coordinated: boolean;
  saving: boolean;
  savedAt: number | null;
  error: string | null;
  /** a saved copy waiting for "restore" or "discard" */
  candidate: Candidate | null;
  /** the question "is there a saved copy to offer?" has been settled (one way or the other) */
  ready: boolean;
};

export type AutosaveDeps = {
  editor: EditorStoreApi;
  blobs: SwitchableBlobStore;
  openIdbBlobs: () => Promise<BlobStore>;
  openRecords: () => Promise<AutosaveStore>;
  codec: ImageCodec;
  locks: LockManagerLike | null;
  delayMs?: number;
  now?: () => number;
  /** told to the user, e.g. that the saved copy was damaged */
  notify?: (message: string) => void;
};

type Inspected = { ok: true; record: AutosaveRecord; project: Project; candidate: Candidate } | { ok: false; reason: string };
export type RestoreResult = { ok: true } | { ok: false; error: string };

const forever = () => new Promise<never>(() => {}); // a held lock lasts until the page goes away

export type Autosave = ReturnType<typeof createAutosave>;

export function createAutosave(deps: AutosaveDeps) {
  const { editor, blobs, codec } = deps;
  const delayMs = deps.delayMs ?? AUTOSAVE_DELAY_MS;
  const now = deps.now ?? Date.now;
  const notify = deps.notify ?? (() => {});
  const state: StoreApi<AutosaveState> = createStore<AutosaveState>(() => ({ ownership: "checking", coordinated: deps.locks !== null, saving: false, savedAt: null, error: null, candidate: null, ready: false }));
  const set = (patch: Partial<AutosaveState>) => state.setState(patch);
  const isOwner = () => state.getState().ownership === "owner";

  let records: AutosaveStore | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waitingForAnswer = false; // a saved copy exists and has not been restored or discarded: do not overwrite it
  let saving: Promise<void> | null = null;
  let dirty = false;
  let started = false;
  let unsubscribe: (() => void) | null = null;

  const schedule = () => {
    if (!isOwner() || waitingForAnswer || !editor.getState().history) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void saveNow();
    }, delayMs);
  };

  /** Writes the project now. Saves never overlap: a change that arrives mid-save makes one more run afterwards. */
  function saveNow(): Promise<void> {
    if (!isOwner() || waitingForAnswer || !records) return Promise.resolve();
    if (saving) {
      dirty = true;
      return saving;
    }
    saving = (async () => {
      do {
        dirty = false;
        const project = editor.getState().snapshotProject();
        if (!project) break;
        set({ saving: true });
        try {
          // blobs first, record second: a record never names an image that is not there
          await syncImagesToBlobStore(project, editor.getState().images, codec, blobs);
          const savedAt = now();
          await records!.put({ format: AUTOSAVE_FORMAT, version: 1, savedAt, project });
          set({ savedAt, error: null });
        } catch (e) {
          set({ error: e instanceof Error && e.message ? e.message : "원인을 알 수 없습니다" }); // shown to the user, never swallowed
        }
      } while (dirty);
      set({ saving: false });
    })().finally(() => {
      saving = null;
    });
    return saving;
  }

  /** is this stored value a record we can restore, with every image it needs still present? */
  async function inspect(raw: unknown): Promise<Inspected> {
    if (typeof raw !== "object" || raw === null) return { ok: false, reason: "형식이 올바르지 않습니다" };
    const r = raw as Partial<AutosaveRecord>;
    if (r.format !== AUTOSAVE_FORMAT || r.version !== 1 || typeof r.savedAt !== "number") return { ok: false, reason: "형식이 올바르지 않습니다" };
    const parsed = parseProjectValue(r.project);
    if (!parsed.ok) return { ok: false, reason: parsed.error };
    for (const id of referencedImageIds(parsed.project)) if (!(await blobs.has(id))) return { ok: false, reason: `이미지 ${id}가 없습니다` };
    const screen = parsed.project.screens[0];
    return { ok: true, record: r as AutosaveRecord, project: parsed.project, candidate: { savedAt: r.savedAt, name: parsed.project.name, width: screen.width, height: screen.height, layers: screen.layers.length } };
  }

  /** the saved copy and the blobs that belong to it, gone. Only the owning tab ever calls this. */
  async function dropStored() {
    await records?.delete();
    await blobs.clear();
  }

  async function checkStored() {
    const raw = await records!.get();
    if (raw === undefined) return;
    const found = await inspect(raw);
    if (found.ok) {
      waitingForAnswer = true;
      set({ candidate: found.candidate });
    } else {
      await dropStored();
      notify(`이전 임시저장본이 손상되어 복원할 수 없어 지웠습니다. (${found.reason})`);
    }
  }

  async function becomeOwner() {
    try {
      const idb = await deps.openIdbBlobs();
      records = await deps.openRecords();
      blobs.use(idb); // whatever was loaded before this moment is only in memory: the first save writes it
      set({ ownership: "owner" });
      await checkStored();
      set({ ready: true });
      schedule();
    } catch (e) {
      records = null;
      set({ ownership: "owner", ready: true, error: `이 브라우저에서는 임시저장을 쓸 수 없습니다. ${e instanceof Error ? e.message : ""}`.trim() });
    }
  }

  return {
    state,

    start() {
      if (started) return;
      started = true;
      unsubscribe = editor.subscribe((s, prev) => {
        if (s.history !== prev.history) schedule();
      });
      const locks = deps.locks;
      if (!locks) {
        void becomeOwner();
        return;
      }
      void locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (lock) {
          await becomeOwner();
          return forever();
        }
        set({ ownership: "other-tab", ready: true });
        // wait in line: if the owning tab closes, this one takes over
        void locks.request(LOCK_NAME, {}, async () => {
          await becomeOwner();
          return forever();
        });
        return undefined;
      });
    },

    stop() {
      unsubscribe?.();
      if (timer) clearTimeout(timer);
      timer = null;
    },

    /** save without waiting for the delay (the page is being hidden) */
    flush(): Promise<void> {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      return saveNow();
    },

    saveNow,

    /** Loads the saved copy. `pruneBlobStore` runs right after, and nowhere else: only here is the history known to be empty. */
    async restore(): Promise<RestoreResult> {
      if (!isOwner() || !waitingForAnswer || !records) return { ok: false, error: "복원할 임시저장본이 없습니다." };
      try {
        const found = await inspect(await records.get());
        if (!found.ok) throw new Error(found.reason);
        const images = new Map<string, RuntimeImage>();
        for (const id of referencedImageIds(found.project)) images.set(id, { raw: await codec.decode((await blobs.get(id))!) });
        editor.getState().loadProject(found.project, images);
        await pruneBlobStore(found.project, blobs);
        waitingForAnswer = false;
        set({ candidate: null, savedAt: found.record.savedAt, error: null });
        schedule();
        return { ok: true };
      } catch (e) {
        await dropStored();
        waitingForAnswer = false;
        set({ candidate: null });
        const error = `임시저장본을 복원하지 못했습니다. ${e instanceof Error ? e.message : ""}`.trim();
        notify(error);
        return { ok: false, error };
      }
    },

    /** Throws the saved copy away. Its blobs go with it: nothing else refers to them and the owning tab is the only writer. */
    async discard(): Promise<void> {
      if (!isOwner() || !waitingForAnswer) return;
      await dropStored();
      waitingForAnswer = false;
      set({ candidate: null, savedAt: null });
      schedule();
    },
  };
}
