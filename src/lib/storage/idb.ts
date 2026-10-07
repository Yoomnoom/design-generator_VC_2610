/* The one IndexedDB database the app uses. Version 2 added the `autosave` store next to `blobs`; opening upgrades an older database. */

export const DB_NAME = "screenshot-layer-canvas";
export const DB_VERSION = 2;
export const BLOBS = "blobs";
export const AUTOSAVE = "autosave";

export const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export const finished = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });

export function openDb(dbName = DB_NAME, factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(dbName, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const name of [BLOBS, AUTOSAVE]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      db.onversionchange = () => db.close(); // another tab is upgrading the database: let it
      resolve(db);
    };
  });
}
