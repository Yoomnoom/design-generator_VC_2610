import { AUTOSAVE, DB_NAME, finished, openDb, request } from "./idb";

export const AUTOSAVE_FORMAT = "screenshot-layer-canvas-autosave";

/** The project as it was at `savedAt`. Images are not in here: the project names them by imageId and the blobs store holds them. */
export type AutosaveRecord = { format: typeof AUTOSAVE_FORMAT; version: 1; savedAt: number; project: unknown };

const KEY = "current";

export interface AutosaveStore {
  /** whatever is stored, unchecked: it may be damaged, so the caller validates it */
  get(): Promise<unknown>;
  put(record: AutosaveRecord): Promise<void>;
  delete(): Promise<void>;
  close(): void;
}

export async function openAutosaveStore(dbName = DB_NAME, factory: IDBFactory = indexedDB): Promise<AutosaveStore> {
  const db = await openDb(dbName, factory);
  const write = async (fn: (store: IDBObjectStore) => void) => {
    const tx = db.transaction(AUTOSAVE, "readwrite");
    fn(tx.objectStore(AUTOSAVE));
    await finished(tx);
  };
  return {
    get: () => request(db.transaction(AUTOSAVE, "readonly").objectStore(AUTOSAVE).get(KEY)),
    put: (record) => write((s) => void s.put(record, KEY)),
    delete: () => write((s) => void s.delete(KEY)),
    close: () => db.close(),
  };
}
