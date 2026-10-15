"use client";

import { useState } from "react";
import { ADJ_FIELDS } from "./LayerToolsPanel";
import { NO_ADJUST, adjustedPicture, hasAdjust } from "@/lib/image/adjust";
import { LayerAdjust } from "@/lib/project/schema";
import { SOURCE_LOCKED_MESSAGE, SOURCE_NAME, isSourceEdited, isSourceLocked } from "@/features/source-edit/source-edit";
import { selectScreen } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";

/** What the selected original picture ("배경(원본)") offers: the lock, "back to the original", and the colour adjustments (baked into a new
 *  picture of the original on "적용": there is no live preview for the original, which is big). The brush, finger and liquify are the tools
 *  in the tool bar: with the original selected and unlocked they paint on it. */
export default function SourceEditPanel() {
  const screen = useEditorStore(selectScreen);
  const comparing = useEditorStore((s) => s.compareMode !== "off");
  const [draft, setDraft] = useState<LayerAdjust>(NO_ADJUST);
  const [message, setMessage] = useState<string | null>(null);
  if (!screen) return null;
  const locked = isSourceLocked(screen.source);
  const edited = isSourceEdited(screen.source);
  const apply = () => {
    setMessage(null);
    const st = editorStore.getState();
    const raw = st.images.get(screen.source.imageId)?.raw;
    if (!raw || !hasAdjust(draft)) return;
    if (locked) return st.setNotice(SOURCE_LOCKED_MESSAGE);
    if (st.commitSourceEdit(adjustedPicture(raw, draft), "이미지 조정(원본)")) {
      setDraft(NO_ADJUST);
      setMessage("원본에 적용했습니다. 실행 취소(Ctrl+Z)로 되돌릴 수 있습니다.");
    }
  };
  return (
    <section aria-label="원본" data-testid="source-edit-panel" className="px-3.5 py-3 text-xs">
      <h3 className="mb-2 text-[13px] font-bold">{SOURCE_NAME}</h3>
      {locked ? (
        <p data-testid="source-locked-note" className="m-0 mb-2 text-[var(--muted)]">
          {SOURCE_LOCKED_MESSAGE}. 위의 자물쇠를 눌러 잠금을 풀어 주세요. 원본은 레이어가 아니라 화면 전체의 바탕 그림이며, 잠겨 있으면 모든 도구가 건드리지 않습니다.
        </p>
      ) : (
        <p data-testid="source-unlocked-note" className="m-0 mb-2 text-[var(--muted)]">
          원본의 잠금이 풀려 있습니다. 브러시·손가락·유동화와 아래 이미지 조정이 원본 그림에 적용됩니다(한 번에 실행 취소 1단계). 지우개는 원본에 쓸 수 없습니다(구멍이 생깁니다). 도형·텍스트·메모·효과·변형은 레이어에만 적용됩니다.
        </p>
      )}
      <div className="mb-2 flex items-center gap-2">
        <button type="button" data-testid="source-lock-toggle" className="btn mini" disabled={comparing} aria-pressed={locked} onClick={() => editorStore.getState().setSourceLocked(!locked)}>
          {locked ? "잠금 해제" : "다시 잠그기"}
        </button>
        <button type="button" data-testid="source-revert" className="btn mini" disabled={comparing || locked || !edited} title={!edited ? "원본을 수정하지 않았습니다" : locked ? "잠금을 풀어야 되돌릴 수 있습니다" : "원본을 업로드한 그림으로 되돌립니다(수정 전체가 실행 취소 1단계)"} onClick={() => editorStore.getState().revertSource()}>
          원본으로 되돌리기
        </button>
      </div>
      <p data-testid="source-state" className="m-0 mb-2 text-[var(--muted)]">{edited ? "수정됨 · 처음 올린 그림이 따로 보존되어 있어 비교 보기의 '원본'은 그 그림입니다." : "수정하지 않음"}</p>
      <details data-testid="source-adjust" className="rounded border border-[var(--line)] bg-white px-2 py-1.5">
        <summary className="cursor-pointer text-xs font-bold">이미지 조정 (원본에 적용)</summary>
        <div className="mt-2 grid gap-1.5">
          {ADJ_FIELDS.map((f) => (
            <label key={f.key} className="grid grid-cols-[52px_minmax(0,1fr)_32px] items-center gap-1.5 text-[11px]">
              <span>{f.label}</span>
              <input data-testid={`src-adj-${f.key}`} type="range" min={f.min} max={f.max} step={1} value={draft[f.key]} disabled={comparing} onChange={(e) => setDraft({ ...draft, [f.key]: Number(e.target.value) })} />
              <span className="text-right tabular-nums text-[var(--muted)]">{draft[f.key]}</span>
            </label>
          ))}
          <button type="button" data-testid="src-adj-apply" className="btn mini primary" disabled={comparing || !hasAdjust(draft)} onClick={apply}>원본에 적용</button>
        </div>
      </details>
      {message && <p role="status" data-testid="source-message" className="mb-0 mt-2 text-[var(--accent)]">{message}</p>}
    </section>
  );
}
