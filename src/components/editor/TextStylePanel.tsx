"use client";

import { MAX_FONT_SIZE, MIN_FONT_SIZE } from "@/lib/image/text-layout";
import { editorStore, useEditorStore } from "@/store/use-editor-store";
import { ColorField, WidthField } from "./StyleFields";

const ALIGNS = [["left", "왼쪽"], ["center", "가운데"], ["right", "오른쪽"]] as const;

/** How the next text box will look. Shown while the text tool is on; a box that already exists is changed in the property panel. */
export default function TextStylePanel() {
  const tool = useEditorStore((s) => s.activeTool);
  const style = useEditorStore((s) => s.textStyle);
  if (tool !== "text") return null;
  const set = editorStore.getState().setTextStyle;
  return (
    <section aria-label="텍스트 설정" data-testid="text-style" className="grid gap-2 border-b border-[var(--line)] px-3.5 py-3">
      <div className="text-xs font-bold">새 텍스트 상자</div>
      <WidthField label="크기" min={MIN_FONT_SIZE} max={MAX_FONT_SIZE} value={style.fontSize} testId="newtext-size" onCommit={(fontSize) => set({ fontSize })} />
      <ColorField label="색" value={style.color} testId="newtext-color" onCommit={(color) => set({ color })} />
      <div className="flex items-center gap-2 text-xs">
        <span className="w-12 shrink-0 font-bold">정렬</span>
        {ALIGNS.map(([align, label]) => (
          <button key={align} type="button" data-testid={`newtext-align-${align}`} aria-pressed={style.align === align} className="btn mini px-2 aria-pressed:bg-[var(--accent)] aria-pressed:text-white" onClick={() => set({ align })}>
            {label}
          </button>
        ))}
      </div>
      <p className="m-0 text-[11px] text-[var(--muted)]">화면을 클릭하고 글자를 입력하세요. 입력창을 벗어나면 만들어집니다. Esc는 취소입니다.</p>
    </section>
  );
}
