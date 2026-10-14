import { ImageCodec } from "@/lib/image/codec";
import { contentError } from "@/lib/project/parse";
import { base64ToBlob, blobToBase64 } from "@/lib/storage/base64";
import { finished, request } from "@/lib/storage/idb";
import { AssetBundle, AssetLayer } from "./types";

/* "My sources": layers the user saved under a name. They live in their own IndexedDB database, apart from the project, the temporary save
 * and the picture store: a project file never holds them, and nothing that prunes or clears those can reach them.
 * A source file (.slc-assets.json) carries any number of them, pictures included, to another computer. */

export const LIBRARY_DB = "screenshot-layer-canvas-assets";
const STORE = "assets";
export const ASSET_FILE_FORMAT = "slc-assets";
export const ASSET_FILE_VERSION = 1;
export const MAX_ASSETS = 200;
export const MAX_ASSET_NAME = 60;
const MAX_LAYERS = 200;

export type StoredAsset = { id: string; name: string; savedAt: number; layers: AssetLayer[]; images: Record<string, Blob> };
export type ImportReport = { added: string[]; renamed: { from: string; to: string }[] };
export type ImportResult = ({ ok: true } & ImportReport) | { ok: false; error: string };

/** the name to use: the wanted one, or "name (2)", "name (3)" … when it is taken (never over an existing one) */
export function uniqueName(wanted: string, taken: Iterable<string>): string {
  const names = new Set(taken);
  const base = wanted.trim().slice(0, MAX_ASSET_NAME) || "내 소스";
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = base.slice(0, MAX_ASSET_NAME - suffix.length) + suffix;
    if (!names.has(candidate)) return candidate;
  }
}

export interface AssetLibrary {
  list(): Promise<StoredAsset[]>;
  /** saves a source under a name (made unique); the stored copy */
  add(bundle: AssetBundle, name: string): Promise<StoredAsset>;
  rename(id: string, name: string): Promise<string | null>;
  remove(id: string): Promise<void>;
  /** the stored source with its pictures decoded, ready for insertAsset */
  load(id: string): Promise<AssetBundle | null>;
  exportFile(): Promise<string>;
  importFile(text: string): Promise<ImportResult>;
  close(): void;
}

export async function openAssetLibrary(codec: ImageCodec, dbName = LIBRARY_DB, factory: IDBFactory = indexedDB): Promise<AssetLibrary> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open(dbName, 1);
    open.onupgradeneeded = () => void (!open.result.objectStoreNames.contains(STORE) && open.result.createObjectStore(STORE, { keyPath: "id" }));
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      open.result.onversionchange = () => open.result.close();
      resolve(open.result);
    };
  });
  const store = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
  const all = async () => ((await request(store("readonly").getAll())) as StoredAsset[]).sort((a, b) => a.savedAt - b.savedAt || a.name.localeCompare(b.name));
  const put = async (record: StoredAsset) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    await finished(tx);
  };
  const encodeImages = async (images: AssetBundle["images"]) => {
    const out: Record<string, Blob> = {};
    for (const [k, raw] of Object.entries(images)) out[k] = await codec.encode(raw);
    return out;
  };
  let counter = 0;
  const newId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    list: all,
    async add(bundle, name) {
      const existing = await all();
      if (existing.length >= MAX_ASSETS) throw new Error(`내 소스는 ${MAX_ASSETS}개까지 저장할 수 있습니다`);
      const record: StoredAsset = { id: newId(), name: uniqueName(name, existing.map((a) => a.name)), savedAt: Date.now(), layers: JSON.parse(JSON.stringify(bundle.layers)), images: await encodeImages(bundle.images) };
      await put(record);
      return record;
    },
    async rename(id, name) {
      const existing = await all();
      const rec = existing.find((a) => a.id === id);
      if (!rec || !name.trim()) return null;
      const unique = uniqueName(name, existing.filter((a) => a.id !== id).map((a) => a.name));
      await put({ ...rec, name: unique });
      return unique;
    },
    async remove(id) {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      await finished(tx);
    },
    async load(id) {
      const rec = (await request(store("readonly").get(id))) as StoredAsset | undefined;
      if (!rec) return null;
      const images: AssetBundle["images"] = {};
      for (const [k, blob] of Object.entries(rec.images)) images[k] = await codec.decode(blob);
      return { name: rec.name, layers: JSON.parse(JSON.stringify(rec.layers)), images };
    },
    async exportFile() {
      const assets = [];
      for (const rec of await all()) {
        const images: Record<string, { mime: string; data: string }> = {};
        for (const [k, blob] of Object.entries(rec.images)) images[k] = { mime: blob.type || "image/png", data: await blobToBase64(blob) };
        assets.push({ name: rec.name, layers: rec.layers, images });
      }
      return JSON.stringify({ format: ASSET_FILE_FORMAT, version: ASSET_FILE_VERSION, assets });
    },
    async importFile(text) {
      const parsed = await parseAssetFile(text, codec);
      if (!parsed.ok) return parsed;
      const existing = await all();
      if (existing.length + parsed.assets.length > MAX_ASSETS) return { ok: false, error: `가져오면 내 소스가 ${MAX_ASSETS}개를 넘습니다 (지금 ${existing.length}개, 파일 ${parsed.assets.length}개)` };
      const taken = existing.map((a) => a.name);
      const report: ImportReport = { added: [], renamed: [] };
      for (const a of parsed.assets) {
        const name = uniqueName(a.name, taken); // never over an existing source
        taken.push(name);
        await put({ id: newId(), name, savedAt: Date.now(), layers: a.layers, images: await encodeImages(a.images) });
        report.added.push(name);
        if (name !== a.name) report.renamed.push({ from: a.name, to: name });
      }
      return { ok: true, ...report };
    },
    close: () => db.close(),
  };
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function layerError(l: unknown, images: Record<string, unknown>): string | null {
  if (!isRec(l) || typeof l.name !== "string") return "레이어에 이름이 없습니다";
  const c = l.crop;
  if (!isRec(c) || ![c.x, c.y, c.width, c.height].every(num)) return "레이어의 crop이 올바르지 않습니다";
  const t = l.transform;
  if (!isRec(t) || ![t.x, t.y, t.scaleX, t.scaleY, t.rotation].every(num) || t.scaleX === 0 || t.scaleY === 0) return "레이어의 위치·크기가 올바르지 않습니다";
  if (!num(l.opacity) || l.opacity < 0 || l.opacity > 1) return "레이어의 투명도가 올바르지 않습니다";
  if (l.content !== undefined) {
    const e = contentError(l.content);
    return e ? `레이어 모양: ${e}` : null;
  }
  if (typeof l.imageKey !== "string" || !isRec(images[l.imageKey])) return "레이어의 그림이 파일에 없습니다";
  return null;
}

/** reads and checks a source file completely before anything is saved; the reason in words when it is not usable */
export async function parseAssetFile(text: string, codec: ImageCodec): Promise<{ ok: true; assets: { name: string; layers: AssetLayer[]; images: AssetBundle["images"] }[] } | { ok: false; error: string }> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "소스 파일이 아닙니다: JSON을 읽을 수 없습니다" };
  }
  if (!isRec(raw) || raw.format !== ASSET_FILE_FORMAT) return { ok: false, error: "소스 파일(.slc-assets.json)이 아닙니다" };
  if (typeof raw.version !== "number" || !Number.isInteger(raw.version) || raw.version < 1) return { ok: false, error: "소스 파일의 version이 올바르지 않습니다" };
  if (raw.version > ASSET_FILE_VERSION) return { ok: false, error: `더 새로운 버전(${raw.version})의 소스 파일입니다` };
  if (!Array.isArray(raw.assets) || raw.assets.length === 0 || raw.assets.length > MAX_ASSETS) return { ok: false, error: "소스 파일에 소스가 없거나 너무 많습니다" };
  const assets: { name: string; layers: AssetLayer[]; images: AssetBundle["images"] }[] = [];
  for (const [i, a] of raw.assets.entries()) {
    const at = `소스 ${i + 1}`;
    if (!isRec(a) || typeof a.name !== "string" || !a.name.trim() || a.name.length > MAX_ASSET_NAME) return { ok: false, error: `${at}: 이름이 올바르지 않습니다` };
    if (!Array.isArray(a.layers) || a.layers.length === 0 || a.layers.length > MAX_LAYERS) return { ok: false, error: `${at}(${a.name}): 레이어가 없거나 너무 많습니다` };
    const imgs = isRec(a.images) ? a.images : {};
    for (const l of a.layers) {
      const e = layerError(l, imgs);
      if (e) return { ok: false, error: `${at}(${a.name}): ${e}` };
    }
    const images: AssetBundle["images"] = {};
    for (const [k, v] of Object.entries(imgs)) {
      if (!isRec(v) || typeof v.data !== "string" || typeof v.mime !== "string" || !v.mime.startsWith("image/")) return { ok: false, error: `${at}(${a.name}): 그림 ${k}의 형식이 올바르지 않습니다` };
      try {
        images[k] = await codec.decode(base64ToBlob(v.data, v.mime));
      } catch {
        return { ok: false, error: `${at}(${a.name}): 그림 ${k}을(를) 읽을 수 없습니다` };
      }
    }
    assets.push({ name: a.name.trim(), layers: a.layers as AssetLayer[], images });
  }
  return { ok: true, assets };
}