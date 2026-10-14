"use client";

import { useRef } from "react";
import { SHAPE_TOOLS } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";
import { ColorField, WidthField } from "./StyleFields";
import { swatchStore, useSwatches } from "@/features/swatches/swatches";

const DEFAULT_FILL = "#ffd84d";

/** How the next shape will look, and where the eyedropper puts the colour it reads. Shown while a shape tool or the eyedropper is on. */
export default function DrawStylePanel() {
  const tool = useEditorStore((s) => s.activeTool);
  const style = useEditorStore((s) => s.drawStyle);
  const lastFill = useRef(DEFAULT_FILL);
  const swatches = useSwatches();
  if (!SHAPE_TOOLS[tool] && tool !== "eyedropper" && tool !== "brush" && tool !== "eraser") return null;
  if (style.fill) lastFill.current = style.fill;
  const set = editorStore.getState().setDrawStyle;
  const isLine = tool === "line";
  const painting = tool === "brush" || tool === "eraser"; // no fill: a brush has one colour and a size
  return (
    <section aria-label="그리기 설정" data-testid="draw-style" className="border-b border-[var(--line)] px-3.5 py-3">
      <h3 className="mb-2.5 text-[13px] font-bold">그리기 설정</h3>
      <div className="grid gap-2">
        {tool !== "eraser" && <ColorField label={painting ? "색" : "테두리"} value={style.stroke} testId="draw-stroke" onCommit={(stroke) => set({ stroke })} />}
        {!isLine && !painting && (
          <>
            <ColorField label="채움" value={style.fill ?? lastFill.current} disabled={style.fill === null} testId="draw-fill" onCommit={(fill) => set({ fill })} />
            <label className="flex items-center gap-2 pl-14 text-xs">
              <input data-testid="draw-fill-none" type="checkbox" checked={style.fill === null} onChange={(e) => set({ fill: e.target.checked ? null : lastFill.current })} />
              채움 없음
            </label>
          </>
        )}
        <WidthField label={painting ? "크기" : "굵기"} value={style.strokeWidth} testId="draw-width" onCommit={(strokeWidth) => set({ strokeWidth })} />
        {!isLine && !painting && style.strokeWidth === 0 && style.fill === null && <p className="text-[11px] text-[#b3361b]">채움도 테두리도 없으면 그려지지 않습니다.</p>}
        <details data-testid="swatches" className="rounded border border-[var(--line)] bg-white px-2 py-1.5">
          <summary className="cursor-pointer text-xs font-bold">색상 스와치</summary>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {swatches.map((c) => (
              <span key={c} className="group relative">
                <button
                  type="button"
                  data-testid="swatch"
                  data-color={c}
                  aria-label={`색 ${c}`}
                  title={`${c} — 클릭: ${style.pickTarget === "fill" && !isLine && !painting ? "채움" : painting ? "브러시" : "테두리"} 색으로 씁니다`}
                  className="h-6 w-6 cursor-pointer rounded border border-[var(--line)]"
                  style={{ background: c }}
                  onClick={() => set(style.pickTarget === "fill" && !isLine && !painting ? { fill: c } : { stroke: c })}
                />
                <button type="button" data-testid="swatch-remove" aria-label={`색 ${c} 지우기`} className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 rounded-full bg-black text-[9px] leading-none text-white group-hover:block" onClick={() => swatchStore.remove(c)}>×</button>
              </span>
            ))}
            <button type="button" data-testid="swatch-add" className="btn mini h-6 px-1.5" title="지금의 색을 스와치에 더합니다 (이 브라우저에만 저장됩니다)" onClick={() => swatchStore.add(style.pickTarget === "fill" && style.fill && !isLine && !painting ? style.fill : style.stroke)}>
              +
            </button>
          </div>
        </details>
        <div role="group" aria-label="스포이트 대상" className="flex items-center gap-1.5 text-xs">
          <span className="w-12 shrink-0 font-bold">스포이트</span>
          {(["stroke", "fill"] as const).map((t) => (
            <button key={t} className="btn mini" aria-pressed={style.pickTarget === t} disabled={t === "fill" && (isLine || painting)} onClick={() => set({ pickTarget: t })} title={t === "stroke" ? "스포이트로 읽은 색을 테두리 색으로 씁니다" : "스포이트로 읽은 색을 채움 색으로 씁니다"}>
              {t === "stroke" ? "→ 테두리" : "→ 채움"}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
