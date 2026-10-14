import { createRawImage, RawImage } from "@/lib/image/raw-image";
import { MeasureFor, estimateMeasure, fitHeight } from "@/lib/image/text-measure";
import { BitmapLayer, CURRENT_VERSION, Project } from "@/lib/project/schema";
import { hexToRgb } from "@/lib/image/color";
import { ImageCache } from "@/store/images";
import { assetEllipse, assetRect, assetText, buttonBundle } from "./builtin";
import { AssetBundle, AssetLayer } from "./types";

/* Built-in templates: whole screens made of vector layers, written here in code. Each opens as a new project (the page is a plain
 * background picture of the screen's size) or adds only its layers to the screen being edited. Their project files are ordinary
 * .slc.json files (buildTemplate gives the project and its pictures; saving it writes the usual file). */

export type TemplateId = "login" | "cards" | "settings";
export const TEMPLATES: { id: TemplateId; label: string; note: string }[] = [
  { id: "login", label: "모바일 로그인", note: "390 × 844 · 입력창 2개, 버튼, 링크" },
  { id: "cards", label: "카드 목록", note: "390 × 844 · 제목 줄과 카드 3장" },
  { id: "settings", label: "설정 화면", note: "390 × 844 · 항목 5줄과 스위치" },
];
const W = 390, H = 844;
const shift = (l: AssetLayer, dx: number, dy: number): AssetLayer => ({ ...l, transform: { ...l.transform, x: l.transform.x + dx, y: l.transform.y + dy } });
const at = (layers: AssetLayer[], x: number, y: number) => layers.map((l) => shift(l, x, y));

function login(): AssetLayer[] {
  const field = (label: string, hint: string, y: number) => [
    assetText(`${label} 이름`, 24, y, 342, label, 13, "#374151"),
    assetRect(`${label} 입력창`, 24, y + 22, 342, 48, { fill: "#ffffff", stroke: "#9ca3af", sw: 1 }),
    assetText(`${label} 안내`, 38, y + 36, 310, hint, 15, "#9ca3af"),
  ];
  return [
    assetText("제목", 24, 120, 342, "로그인", 28, "#111827"),
    assetText("부제", 24, 164, 342, "계정에 로그인해 시작하세요.", 15, "#6b7280"),
    ...field("이메일", "name@example.com", 240),
    ...field("비밀번호", "비밀번호", 332),
    ...at(buttonBundle("fill", "rest").layers.map((l) => ({ ...l })), 24, 440).map((l) => (l.content?.kind === "rect" ? { ...l, content: { ...l.content, width: 342, height: 48 } } : l.content?.kind === "text" ? { ...l, content: { ...l.content, width: 342, text: "로그인" }, transform: { ...l.transform, y: l.transform.y + 2 } } : l)),
    assetText("링크", 24, 520, 342, "비밀번호를 잊으셨나요?", 14, "#4f46e5", "center"),
  ];
}
function cards(): AssetLayer[] {
  const card = (n: number, y: number): AssetLayer[] => [
    assetRect(`카드 ${n} 그림자`, 20, y + 3, 350, 150, { fill: "#e5e7eb" }),
    assetRect(`카드 ${n}`, 20, y, 350, 150, { fill: "#ffffff", stroke: "#e5e7eb", sw: 1 }),
    assetText(`카드 ${n} 제목`, 36, y + 16, 250, `카드 제목 ${n}`, 18, "#111827"),
    assetText(`카드 ${n} 설명`, 36, y + 50, 318, "두 줄 정도의 짧은 설명이 들어갑니다. 내용은 자유롭게 바꾸세요.", 14, "#6b7280"),
    assetRect(`카드 ${n} 태그`, 36, y + 108, 56, 24, { fill: "#e0e7ff" }),
    assetText(`카드 ${n} 태그 글자`, 36, y + 112, 56, "태그", 12, "#3730a3", "center"),
  ];
  return [assetText("제목", 20, 72, 350, "목록", 26, "#111827"), assetRect("제목 줄", 20, 116, 350, 1, { fill: "#d1d5db" }), ...card(1, 140), ...card(2, 316), ...card(3, 492)];
}
function settings(): AssetLayer[] {
  const rows = ["알림", "소리", "다크 모드", "위치 정보", "자동 업데이트"];
  return [
    assetText("제목", 24, 72, 342, "설정", 26, "#111827"),
    ...rows.flatMap((label, i): AssetLayer[] => {
      const y = 140 + i * 72;
      const on = i % 2 === 0;
      return [
        assetText(`${label} 이름`, 24, y + 20, 250, label, 16, "#111827"),
        assetRect(`${label} 스위치 바탕`, 306, y + 18, 60, 30, { fill: on ? "#4f46e5" : "#d1d5db" }),
        assetEllipse(`${label} 스위치 손잡이`, on ? 340 : 310, y + 22, 22, 22, { fill: "#ffffff" }),
        assetRect(`${label} 구분선`, 24, y + 64, 342, 1, { fill: "#e5e7eb" }),
      ];
    }),
  ];
}
const BUILDERS: Record<TemplateId, { layers: () => AssetLayer[]; background: string }> = {
  login: { layers: login, background: "#f9fafb" },
  cards: { layers: cards, background: "#f3f4f6" },
  settings: { layers: settings, background: "#ffffff" },
};

/** a template's layers as a bundle (frame positions kept), for adding to the screen being edited */
export function templateBundle(id: TemplateId): AssetBundle {
  return { name: TEMPLATES.find((t) => t.id === id)!.label, layers: BUILDERS[id].layers(), images: {} };
}

/** a template as a project of its own: a plain background picture and the layers */
export function buildTemplate(id: TemplateId, measure: MeasureFor = estimateMeasure): { project: Project; images: ImageCache } {
  const b = BUILDERS[id];
  const c = hexToRgb(b.background)!;
  const source: RawImage = createRawImage(W, H, [c.r, c.g, c.b, 255]);
  const sourceId = crypto.randomUUID();
  const layers: BitmapLayer[] = b.layers().map((a, i) => {
    const content = { ...a.content! };
    if (content.kind === "text") content.height = fitHeight(content, measure);
    return { id: crypto.randomUUID(), name: a.name, crop: { ...a.crop }, content, transform: { ...a.transform }, zIndex: i + 1, opacity: 1, visible: true, locked: false };
  });
  const label = TEMPLATES.find((t) => t.id === id)!.label;
  const project: Project = {
    id: crypto.randomUUID(),
    name: label,
    version: CURRENT_VERSION,
    canvas: { zoom: 1, panX: 0, panY: 0 },
    screens: [{ id: crypto.randomUUID(), name: "화면 1", x: 0, y: 0, width: W, height: H, source: { imageId: sourceId, fileName: `${id}-template.png` }, backgroundPatches: [], layers }],
  };
  return { project, images: new Map([[sourceId, { raw: source }]]) };
}