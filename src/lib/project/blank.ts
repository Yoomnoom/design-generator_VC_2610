import { MAX_SIDE } from "@/features/import-image/import-image";

/* Pages made by the app (a blank canvas, a template) have no screenshot: their "source image" is a plain single-colour picture of
 * the chosen size, so the schema needs nothing new. The file name says so, which is how the editor knows there is nothing to extract from. */

export const BLANK_FILE = "slc-blank.png";
export const templateFile = (id: string) => `slc-template-${id}.png`;
export const isGeneratedPage = (fileName: string) => fileName === BLANK_FILE || /^slc-template-[a-z]+\.png$/.test(fileName);

export const CANVAS_PRESETS: { id: string; label: string; width: number; height: number }[] = [
  { id: "mobile", label: "모바일", width: 390, height: 844 },
  { id: "desktop", label: "데스크톱", width: 1440, height: 900 },
  { id: "tablet", label: "태블릿", width: 820, height: 1180 },
];
export const DEFAULT_CANVAS_COLOR = "#ffffff";

export type CanvasSize = { ok: true; width: number; height: number } | { ok: false; error: string };

/** a canvas size typed by the user: whole pixels, 1 to MAX_SIDE each */
export function checkCanvasSize(width: unknown, height: unknown): CanvasSize {
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
  const w = num(width), h = num(height);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return { ok: false, error: "가로와 세로를 숫자로 입력해 주세요." };
  if (!Number.isInteger(w) || !Number.isInteger(h)) return { ok: false, error: "가로와 세로는 정수(픽셀)여야 합니다." };
  if (w < 1 || h < 1) return { ok: false, error: "가로와 세로는 1px 이상이어야 합니다." };
  if (w > MAX_SIDE || h > MAX_SIDE) return { ok: false, error: `한 변은 ${MAX_SIDE}px 이하여야 합니다 (입력: ${w} × ${h}px).` };
  return { ok: true, width: w, height: h };
}
