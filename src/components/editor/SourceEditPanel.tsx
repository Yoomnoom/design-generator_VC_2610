"use client";

import { useEffect, useRef, useState } from "react";
import { ADJ_FIELDS } from "./LayerToolsPanel";
import { NO_ADJUST, hasAdjust } from "@/lib/image/adjust";
import { LayerAdjust } from "@/lib/project/schema";
import { adjustPictureAsync } from "@/features/source-edit/adjust-client";
import { SOURCE_LAYER_ID, SOURCE_LOCKED_MESSAGE, SOURCE_NAME, isSourceEdited, isSourceLocked, visiblePatches } from "@/features/source-edit/source-edit";
import { selectScreen } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";

/** What the selected original picture ("배경(원본)") offers: the lock, "back to the original", and the colour adjustments. A slider shows a
 *  reduced-size preview on the page while it moves (no history); "원본에 적용" makes the full-size picture in a Web Worker (a big original
 *  takes seconds) and puts it on the original as ONE undo step. The brush, finger and liquify are the tools in the tool bar: with the
 *  original selected and unlocked they paint on it. */
export default function SourceEditPanel() {
  const screen = useEditorStore(selectScreen);
  const comparing = useEditorStore((s) => s.compareMode !== "off");
  const [draft, setDraft] = useState<LayerAdjust>(NO_ADJUST);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      editorStore.getState().setAdjustPreview(null); // the preview ends with the panel
    };
  }, []);
  if (!screen) return null;
  const locked = isSourceLocked(screen.source);
  const edited = isSourceEdited(screen.source);
  const shown = visiblePatches(screen.backgroundPatches);
  const move = (key: keyof LayerAdjust, value: number) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    setMessage(null);
    editorStore.getState().setAdjustPreview(hasAdjust(next) ? { layerId: SOURCE_LAYER_ID, adjust: next } : null);
  };
  const clear = () => {
    setDraft(NO_ADJUST);
    editorStore.getState().setAdjustPreview(null);
  };
  const apply = async () => {
    setMessage(null);
    const st = editorStore.getState();
    const before = st.history?.present.screens[0].source.imageId;
    const raw = before ? st.images.get(before)?.raw : undefined;
    if (!raw || !hasAdjust(draft)) return;
    if (locked) return st.setNotice(SOURCE_LOCKED_MESSAGE);
    setBusy(true);
    try {
      const { image, ms } = await adjustPictureAsync(raw, draft);
      const now = editorStore.getState();
      if (now.history?.present.screens[0].source.imageId !== before) return setMessage("원본이 그 사이 바뀌어 적용하지 않았습니다. 다시 눌러 주세요."); // edited or undone while computing
      if (now.commitSourceEdit(image, "이미지 조정(원본)")) {
        if (alive.current) {
          clear();
          setMessage(`원본에 적용했습니다(${(ms / 1000).toFixed(1)}초). 실행 취소(Ctrl+Z)로 되돌릴 수 있습니다.`);
        }
      }
    } catch (e) {
      setMessage(e instanceof Error ? `적용하지 못했습니다: ${e.message}` : "적용하지 못했습니다.");
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section aria-label="원본" data-testid="source-edit-panel" className="px-3.5 py-3 text-xs">
      <h3 className="mb-2 text-[13px] font-bold">{SOURCE_NAME}{edited ? " · 수정됨" : ""}</h3>
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
      <p data-testid="source-state" className="m-0 mb-2 text-[var(--muted)]">
        {edited ? "수정됨 · 처음 올린 그림은 따로 보존되어 있습니다. 위쪽의 '원본'(또는 '나란히') 비교 보기에서 수정 전 그림과 견줄 수 있습니다." : "수정하지 않음"}
      </p>
      {shown.length > 0 && (
        <div data-testid="source-patch-note" className="mb-2 rounded border border-[#ead9a2] bg-[#fff9e8] p-2 text-[#75601b]">
          <p className="m-0">배경 패치 {shown.length}개가 원본 위를 덮고 있습니다. 패치가 있는 자리의 원본을 고쳐도 화면에는 보이지 않으니, 필요하면 레이어 패널의 "배경 패치"에서 숨기거나 삭제하세요.</p>
        </div>
      )}
      <details data-testid="source-adjust" className="rounded border border-[var(--line)] bg-white px-2 py-1.5">
        <summary className="cursor-pointer text-xs font-bold">이미지 조정 (원본에 적용)</summary>
        <div className="mt-2 grid gap-1.5">
          {ADJ_FIELDS.map((f) => (
            <label key={f.key} className="grid grid-cols-[52px_minmax(0,1fr)_32px] items-center gap-1.5 text-[11px]">
              <span>{f.label}</span>
              <input data-testid={`src-adj-${f.key}`} type="range" min={f.min} max={f.max} step={1} value={draft[f.key]} disabled={comparing || busy} onChange={(e) => move(f.key, Number(e.target.value))} />
              <span className="text-right tabular-nums text-[var(--muted)]">{draft[f.key]}</span>
            </label>
          ))}
          <p className="m-0 text-[11px] text-[var(--muted)]">슬라이더를 움직이는 동안은 줄인 그림으로 미리 보이고, "원본에 적용"을 누르면 전체 크기로 계산해 원본에 굽습니다.</p>
          <div className="flex gap-1.5">
            <button type="button" data-testid="src-adj-apply" className="btn mini primary flex-1" disabled={comparing || busy || locked || !hasAdjust(draft)} title={locked ? SOURCE_LOCKED_MESSAGE : undefined} onClick={() => void apply()}>
              {busy ? "계산 중…" : "원본에 적용"}
            </button>
            <button type="button" data-testid="src-adj-cancel" className="btn mini" disabled={busy || !hasAdjust(draft)} onClick={clear}>미리보기 취소</button>
          </div>
        </div>
      </details>
      {message && <p role="status" data-testid="source-message" className="mb-0 mt-2 text-[var(--accent)]">{message}</p>}
    </section>
  );
}
