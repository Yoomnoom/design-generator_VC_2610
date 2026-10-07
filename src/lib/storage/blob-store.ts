import { BLOBS, DB_NAME, finished, openDb, request } from "./idb";

/** Blobs by imageId. In IndexedDB they survive a restart, which a Blob URL would not. */
export interface BlobStore {
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | undefined>;
  has(id: string): Promise<boolean>;
  delete(id: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
  close(): void;
}

export async function openBlobStore(dbName = DB_NAME, factory: IDBFactory = indexedDB): Promise<BlobStore> {
  const db = await openDb(dbName, factory);
  const write = async (fn: (store: IDBObjectStore) => void) => {
    const tx = db.transaction(BLOBS, "readwrite");
    fn(tx.objectStore(BLOBS));
    await finished(tx);
  };
  const read = <T>(fn: (store: IDBObjectStore) => IDBRequest<T>) => request(fn(db.transaction(BLOBS, "readonly").objectStore(BLOBS)));
  return {
    put: (id, blob) => write((s) => void s.put(blob, id)),
    get: async (id) => (await read((s) => s.get(id))) as Blob | undefined,
    has: async (id) => (await read((s) => s.getKey(id))) !== undefined,
    delete: (id) => write((s) => void s.delete(id)),
    keys: async () => (await read((s) => s.getAllKeys())).map(String),
    clear: () => write((s) => void s.clear()),
    close: () => db.close(),
  };
}

/** blobs kept in memory only: nothing outlives the page, and nothing here can touch what other tabs keep in IndexedDB */
export function createMemoryBlobStore(): BlobStore {
  const map = new Map<string, Blob>();
  return {
    put: async (id, blob) => void map.set(id, blob),
    get: async (id) => map.get(id),
    has: async (id) => map.has(id),
    delete: async (id) => void map.delete(id),
    keys: async () => [...map.keys()],
    clear: async () => map.clear(),
    close: () => {},
  };
}

export type SwitchableBlobStore = BlobStore & { use(store: BlobStore): void; readonly current: BlobStore };

/** A blob store whose backend can be swapped while the rest of the app keeps holding the same object. */
export function createSwitchableBlobStore(initial: BlobStore): SwitchableBlobStore {
  let backend = initial;
  return {
    use: (store) => void (backend = store),
    get current() {
      return backend;
    },
    put: (id, blob) => backend.put(id, blob),
    get: (id) => backend.get(id),
    has: (id) => backend.has(id),
    delete: (id) => backend.delete(id),
    keys: () => backend.keys(),
    clear: () => backend.clear(),
    close: () => backend.close(),
  };
}
