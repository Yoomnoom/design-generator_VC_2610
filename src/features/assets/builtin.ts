import { LayerContent } from "@/lib/project/schema";
import { AssetBundle, AssetLayer } from "./types";

/* The built-in sources: buttons (each in a rest, hover and pressed look), a card, an input, a tag, a divider and a few plain icons.
 * Every one is made here from rectangles, ellipses, lines and text; nothing is loaded from outside. The looks of the states are our own
 * small set (shadow depth, outline weight, background brightness, underline weight, a fill sliding across); they were chosen by looking at
 * which kinds of change a button state usually shows, and no style code or effect name of another project is used. */

const t = (x: number, y: number) => ({ x, y, scaleX: 1, scaleY: 1, rotation: 0 });
const none = { x: 0, y: 0, width: 0, height: 0 };

const rect = (name: string, x: number, y: number, width: number, height: number, o: { fill?: string | null; stroke?: string | null; sw?: number; r?: number }): AssetLayer => ({
  name,
  crop: { ...none },
  content: { kind: "rect", width, height, fill: o.fill ?? null, stroke: o.stroke ?? null, strokeWidth: o.stroke ? (o.sw ?? 1) : 0, ...(o.r && o.r > 0 ? { cornerRadius: Math.min(o.r, Math.min(width, height) / 2) } : {}) },
  transform: t(x, y),
  opacity: 1,
});
const text = (name: string, x: number, y: number, width: number, value: string, fontSize: number, color: string, align: "left" | "center" | "right" = "left"): AssetLayer => ({
  name,
  crop: { ...none },
  content: { kind: "text", width, height: Math.ceil(fontSize * 1.4), text: value, fontSize, color, align, stroke: null, strokeWidth: 0 },
  transform: t(x, y),
  opacity: 1,
});
const line = (name: string, x: number, y: number, width: number, height: number, direction: "down" | "up", color: string, sw: number): AssetLayer => ({
  name,
  crop: { ...none },
  content: { kind: "line", width, height, direction, stroke: color, strokeWidth: sw } as LayerContent,
  transform: t(x, y),
  opacity: 1,
});
const ellipse = (name: string, x: number, y: number, w: number, h: number, o: { fill?: string | null; stroke?: string | null; sw?: number }): AssetLayer => ({
  ...rect(name, x, y, w, h, { ...o, r: 0 }),
  content: { kind: "ellipse", width: w, height: h, fill: o.fill ?? null, stroke: o.stroke ?? null, strokeWidth: o.stroke ? (o.sw ?? 1) : 0 },
});

export const bundle = (name: string, layers: AssetLayer[]): AssetBundle => ({ name, layers, images: {} });

export type ButtonStyle = "fill" | "outline" | "underline" | "slide";
export type ButtonState = "rest" | "hover" | "pressed";
export const BUTTON_STYLES: { id: ButtonStyle; label: string }[] = [
  { id: "fill", label: "채움 (그림자 깊이)" },
  { id: "outline", label: "테두리 (배경 밝기)" },
  { id: "underline", label: "밑줄 (두께)" },
  { id: "slide", label: "슬라이드 채움" },
];
export const BUTTON_STATES: { id: ButtonState; label: string }[] = [
  { id: "rest", label: "기본" },
  { id: "hover", label: "hover" },
  { id: "pressed", label: "눌림" },
];
const W = 160, H = 44, BRAND = "#4f46e5";
/** corner radius of the built-in parts, in pixels; the name of the paler shadow layer behind a shadow */
export const RADIUS = 8;
export const SOFT = "그림자 번짐";

/** one button in one state. fill: the shadow gets deeper on hover and the button sinks into it when pressed, and the colour lightens, then darkens.
 *  outline: the weight of the edge and the tint behind the label grow. underline: the rule under the label thickens. slide: a fill covers a
 *  part of the button, half on hover and all of it when pressed. */
export function buttonBundle(style: ButtonStyle, state: ButtonState): AssetBundle {
  const label = BUTTON_STATES.find((s) => s.id === state)!.label;
  const name = `버튼 · ${BUTTON_STYLES.find((s) => s.id === style)!.label.split(" ")[0]} · ${label}`;
  const i = state === "rest" ? 0 : state === "hover" ? 1 : 2;
  if (style === "fill") {
    const body = ["#4f46e5", "#6366f1", "#4338ca"][i];
    const depth = [4, 7, 1][i];
    const sink = [0, 0, 3][i];
    // the shadow and its soft edge (a larger, paler copy behind it) have the same rounded corners as the button, so the blur follows its shape
    return bundle(name, [rect(SOFT, -3, depth + sink - 3, W + 6, H + 6, { fill: "#c7d2fe", r: RADIUS + 3 }), rect("그림자", 0, depth + sink, W, H, { fill: "#312e81", r: RADIUS }), rect("버튼 바탕", 0, sink, W, H, { fill: body, r: RADIUS }), text("버튼 글자", 0, sink + 11, W, "버튼", 16, "#ffffff", "center")]);
  }
  if (style === "outline") {
    return bundle(name, [rect("버튼 바탕", 0, 0, W, H, { fill: ["#ffffff", "#eef2ff", "#c7d2fe"][i], stroke: BRAND, sw: [2, 3, 2][i], r: RADIUS }), text("버튼 글자", 0, 11, W, "버튼", 16, ["#4f46e5", "#4338ca", "#312e81"][i], "center")]);
  }
  if (style === "underline") {
    return bundle(name, [text("버튼 글자", 0, 0, W, "버튼", 16, ["#111827", "#111827", BRAND][i], "center"), rect("밑줄", 0, 28, W, [1, 3, 3][i], { fill: i === 2 ? "#312e81" : BRAND, r: 1 })]);
  }
  const covered = [0, 0.5, 1][i];
  return bundle(name, [
    rect("버튼 바탕", 0, 0, W, H, { fill: "#ffffff", stroke: BRAND, sw: 2, r: RADIUS }),
    ...(covered > 0 ? [rect("채움", 0, 0, Math.round(W * covered), H, { fill: BRAND, r: RADIUS })] : []),
    text("버튼 글자", 0, 11, W, "버튼", 16, i === 2 ? "#ffffff" : "#4f46e5", "center"),
  ]);
}

export type BuiltinAsset = { id: string; group: "button" | "part" | "icon"; label: string; build: () => AssetBundle };

const parts: BuiltinAsset[] = [
  {
    id: "card",
    group: "part",
    label: "카드",
    build: () => bundle("카드", [rect(SOFT, -3, 0, 246, 146, { fill: "#f3f4f6", r: 15 }), rect("카드 그림자", 0, 3, 240, 140, { fill: "#e5e7eb", r: 12 }), rect("카드", 0, 0, 240, 140, { fill: "#ffffff", stroke: "#e5e7eb", sw: 1, r: 12 }), text("카드 제목", 16, 14, 208, "카드 제목", 18, "#111827"), text("카드 설명", 16, 46, 208, "설명 글을 여기에 씁니다.", 14, "#6b7280")]),
  },
  {
    id: "input",
    group: "part",
    label: "입력창",
    build: () => bundle("입력창", [text("입력창 이름", 0, 0, 240, "이름", 13, "#374151"), rect("입력창", 0, 22, 240, 44, { fill: "#ffffff", stroke: "#9ca3af", sw: 1, r: RADIUS }), text("안내 글", 12, 34, 216, "입력하세요", 15, "#9ca3af")]),
  },
  { id: "tag", group: "part", label: "태그", build: () => bundle("태그", [rect("태그 바탕", 0, 0, 64, 26, { fill: "#e0e7ff", r: 13 }), text("태그 글자", 0, 4, 64, "태그", 13, "#3730a3", "center")]) },
  { id: "divider", group: "part", label: "구분선", build: () => bundle("구분선", [rect("구분선", 0, 0, 240, 1, { fill: "#d1d5db" })]) },
];

const icons: BuiltinAsset[] = [
  { id: "icon-plus", group: "icon", label: "더하기", build: () => bundle("아이콘 · 더하기", [rect("가로", 0, 7, 16, 2, { fill: "#111827" }), rect("세로", 7, 0, 2, 16, { fill: "#111827" })]) },
  { id: "icon-close", group: "icon", label: "엑스", build: () => bundle("아이콘 · 엑스", [line("대각선 1", 0, 0, 16, 16, "down", "#111827", 2), line("대각선 2", 0, 0, 16, 16, "up", "#111827", 2)]) },
  { id: "icon-check", group: "icon", label: "체크", build: () => bundle("아이콘 · 체크", [line("짧은 획", 0, 6, 6, 6, "down", "#16a34a", 2.5), line("긴 획", 6, 0, 12, 12, "up", "#16a34a", 2.5)]) },
  { id: "icon-arrow", group: "icon", label: "화살표", build: () => bundle("아이콘 · 화살표", [rect("몸통", 0, 9, 20, 2, { fill: "#111827" }), line("머리 위", 12, 2, 8, 8, "down", "#111827", 2), line("머리 아래", 12, 10, 8, 8, "up", "#111827", 2)]) },
  { id: "icon-dot", group: "icon", label: "점", build: () => bundle("아이콘 · 점", [ellipse("점", 0, 0, 12, 12, { fill: "#4f46e5" })]) },
];

export const BUILTIN_ASSETS: BuiltinAsset[] = [
  ...BUTTON_STYLES.flatMap((s) => BUTTON_STATES.map((st): BuiltinAsset => ({ id: `button-${s.id}-${st.id}`, group: "button", label: `${s.label} · ${st.label}`, build: () => buttonBundle(s.id, st.id) }))),
  ...parts,
  ...icons,
];

export { rect as assetRect, text as assetText, ellipse as assetEllipse };