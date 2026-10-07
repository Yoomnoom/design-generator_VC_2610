import { migrate } from "./migrate";
import { BitmapLayer, Project, Rect } from "./schema";
import { hexToRgb } from "../image/color";

export type ParseResult = { ok: true; project: Project } | { ok: false; error: string };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isId = (v: unknown): v is string => isStr(v) && v.length > 0;
/** a reference into the blob store; a Blob/data URL dies with the page, so it is never a valid reference */
const isImageId = (v: unknown): v is string => isId(v) && !/^(blob|data):/i.test(v);
const isRect = (v: unknown): v is Rect => isRec(v) && isNum(v.x) && isNum(v.y) && isNum(v.width) && isNum(v.height) && v.width >= 0 && v.height >= 0;

function layerError(l: unknown, i: number): string | null {
  const at = `layers[${i}]`;
  if (!isRec(l)) return `${at}가 객체가 아닙니다`;
  if (!isId(l.id) || !isStr(l.name)) return `${at}.id/name이 올바르지 않습니다`;
  if (!isRect(l.crop)) return `${at}.crop이 올바르지 않습니다`;
  if (l.imageId !== undefined && !isImageId(l.imageId)) return `${at}.imageId가 올바르지 않습니다`;
  const t = l.transform;
  if (!isRec(t) || !isNum(t.x) || !isNum(t.y)) return `${at}.transform이 올바르지 않습니다`;
  if (t.scaleX !== 1 || t.scaleY !== 1 || t.rotation !== 0) return `${at}: Phase 1에서는 scale 1/1, rotation 0만 허용됩니다`;
  if (!isNum(l.zIndex)) return `${at}.zIndex가 올바르지 않습니다`;
  if (!isNum(l.opacity) || l.opacity < 0 || l.opacity > 1) return `${at}.opacity가 0~1이 아닙니다`;
  if (typeof l.visible !== "boolean" || typeof l.locked !== "boolean") return `${at}.visible/locked가 올바르지 않습니다`;
  return null;
}

function patchError(p: unknown, i: number): string | null {
  const at = `backgroundPatches[${i}]`;
  if (!isRec(p) || !isId(p.id) || !isRect(p.rect)) return `${at}가 올바르지 않습니다`;
  if (!isStr(p.fill) || !hexToRgb(p.fill)) return `${at}.fill이 색상이 아닙니다`;
  return null;
}

function screenError(s: unknown): string | null {
  if (!isRec(s)) return "screens[0]이 객체가 아닙니다";
  if (!isId(s.id) || !isStr(s.name) || !isNum(s.x) || !isNum(s.y)) return "screens[0]의 id/name/x/y가 올바르지 않습니다";
  if (!isNum(s.width) || !isNum(s.height) || s.width < 1 || s.height < 1) return "screens[0]의 width/height가 올바르지 않습니다";
  if (!isRec(s.source) || !isImageId(s.source.imageId) || !isStr(s.source.fileName)) return "screens[0].source가 올바르지 않습니다";
  if (!Array.isArray(s.backgroundPatches) || !Array.isArray(s.layers)) return "screens[0]의 backgroundPatches/layers가 배열이 아닙니다";
  for (const [i, p] of s.backgroundPatches.entries()) {
    const e = patchError(p, i);
    if (e) return e;
  }
  const ids = new Set<string>();
  for (const [i, l] of s.layers.entries()) {
    const e = layerError(l, i);
    if (e) return e;
    const id = (l as BitmapLayer).id;
    if (ids.has(id)) return `layers[${i}].id가 중복됩니다`;
    ids.add(id);
  }
  return null;
}

/** parse → migrate → validate. Phase 1 accepts exactly one screen. */
export function parseProject(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "JSON을 읽을 수 없습니다" };
  }
  return parseProjectValue(raw);
}

/** the same checks for a value that is already parsed JSON */
export function parseProjectValue(raw: unknown): ParseResult {
  const migrated = migrate(raw);
  if (!migrated.ok) return migrated;
  const d = migrated.doc;
  if (!isId(d.id) || !isStr(d.name)) return { ok: false, error: "id/name이 올바르지 않습니다" };
  const c = d.canvas;
  if (!isRec(c) || !isNum(c.zoom) || c.zoom <= 0 || !isNum(c.panX) || !isNum(c.panY)) return { ok: false, error: "canvas가 올바르지 않습니다" };
  if (!Array.isArray(d.screens) || d.screens.length !== 1) return { ok: false, error: "Phase 1에서는 screens가 정확히 1개여야 합니다" };
  const err = screenError(d.screens[0]);
  if (err) return { ok: false, error: err };
  return { ok: true, project: d as unknown as Project };
}

/** Plain JSON only: images are referenced by imageId, never inlined here and never as Blob URLs. */
export const serializeProject = (project: Project): string => JSON.stringify(project);

