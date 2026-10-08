import { CURRENT_VERSION } from "./schema";

/* Each entry upgrades a raw document from version N to N+1, keyed by N. */
type Doc = Record<string, unknown>;
const isRec = (v: unknown): v is Doc => typeof v === "object" && v !== null && !Array.isArray(v);

const MIGRATIONS: Record<number, (doc: Doc) => Doc> = {
  /** 1 → 2: a layer's scale and rotation become free. A version 1 file always held 1, 1 and 0 there, so the
   *  values stay as they are; a file that lacks them gets those same defaults. Anything else is left for the validator. */
  1: (doc) => {
    if (!Array.isArray(doc.screens)) return doc;
    return {
      ...doc,
      screens: doc.screens.map((screen) => {
        if (!isRec(screen) || !Array.isArray(screen.layers)) return screen;
        return {
          ...screen,
          layers: screen.layers.map((layer) => {
            if (!isRec(layer) || !isRec(layer.transform)) return layer;
            const t = layer.transform;
            return { ...layer, transform: { ...t, scaleX: t.scaleX ?? 1, scaleY: t.scaleY ?? 1, rotation: t.rotation ?? 0 } };
          }),
        };
      }),
    };
  },
  /** 2 → 3: vector layers are new and optional, so every version 2 file is already a valid version 3 file. */
  2: (doc) => doc,
  /** 3 → 4: `drawn` is new and optional (a layer without it was not made with the brush), so every version 3 file is already valid. */
  3: (doc) => doc,
  /** 4 -> 5: text layers are new and optional, so every version 4 file is already a valid version 5 file. */
  4: (doc) => doc,
};

export type MigrateResult = { ok: true; doc: Record<string, unknown> } | { ok: false; error: string };

/** Brings a parsed file up to CURRENT_VERSION. Refuses files with no usable version or from a newer app. */
export function migrate(raw: unknown): MigrateResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: "프로젝트 파일이 객체가 아닙니다" };
  let doc = raw as Record<string, unknown>;
  const version = doc.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return { ok: false, error: "version 필드가 올바르지 않습니다" };
  if (version > CURRENT_VERSION) return { ok: false, error: `더 새로운 버전(${version})의 프로젝트 파일입니다` };
  for (let v = version; v < CURRENT_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return { ok: false, error: `version ${v}에서 올리는 마이그레이션이 없습니다` };
    doc = { ...step(doc), version: v + 1 };
  }
  return { ok: true, doc };
}
