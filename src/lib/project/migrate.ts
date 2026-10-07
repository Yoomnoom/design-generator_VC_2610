import { CURRENT_VERSION } from "./schema";

/* Each entry upgrades a raw document from version N to N+1, keyed by N.
 * Empty while the schema is at version 1; Phase 1.5 (resize/rotate) and Phase 2 (multi-screen) add steps here. */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {};

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
