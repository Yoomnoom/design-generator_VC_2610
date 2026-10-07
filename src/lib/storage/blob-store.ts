/** Blobs by imageId in IndexedDB. A Blob URL would not survive a restart; the Blob itself does. */
export interface BlobStore {
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | undefined>;
  has(id: string): Promise<boolean>;
  delete(id: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
  close(): void;
}

const STORE = "blobs";

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const finished = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });

export function openBlobStore(dbName = "screenshot-layer-canvas", factory: IDBFactory = indexedDB): Promise<BlobStore> {
  return new Promise((resolve, reject) => {
    const open = factory.open(dbName, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const write = async (fn: (store: IDBObjectStore) => void) => {
        const tx = db.transaction(STORE, "readwrite");
        fn(tx.objectStore(STORE));
        await finished(tx);
      };
      const read = <T>(fn: (store: IDBObjectStore) => IDBRequest<T>) => request(fn(db.transaction(STORE, "readonly").objectStore(STORE)));
      resolve({
        put: (id, blob) => write((s) => void s.put(blob, id)),
        get: async (id) => (await read((s) => s.get(id))) as Blob | undefined,
        has: async (id) => (await read((s) => s.getKey(id))) !== undefined,
        delete: (id) => write((s) => void s.delete(id)),
        keys: async () => (await read((s) => s.getAllKeys())).map(String),
        clear: () => write((s) => void s.clear()),
        close: () => db.close(),
      });
    };
  });
}
