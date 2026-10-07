"use client";

import { useStore } from "zustand";
import { getAutosave } from "@/features/autosave/browser-autosave";
import { selectProject } from "@/store/editor-store";
import { useEditorStore } from "@/store/use-editor-store";

export const formatTime = (ms: number) => new Date(ms).toLocaleString("ko-KR", { hour12: false });

/** Asked once at start-up when a temporary copy of earlier work exists. It must be answered: until then nothing is overwritten. */
export default function RestorePrompt() {
  const autosave = getAutosave();
  const candidate = useStore(autosave.state, (s) => s.candidate);
  const hasProject = !!useEditorStore(selectProject);
  if (!candidate) return null;
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/35">
      <div role="dialog" aria-modal="true" aria-labelledby="restore-title" data-testid="restore-dialog" className="w-[420px] rounded-[14px] border border-[var(--line)] bg-white p-[18px] shadow-[var(--shadow)]">
        <h2 id="restore-title" className="m-0 mb-1 text-lg font-bold">
          이전 작업을 복원할까요?
        </h2>
        <p className="mb-3 text-xs text-[var(--muted)]">앱이 닫히기 전에 자동으로 저장해 둔 작업이 있습니다.</p>
        <dl data-testid="restore-summary" className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-[9px] border border-[var(--line)] bg-[#fafafa] p-2.5 text-sm">
          <dt className="text-[var(--muted)]">이름</dt>
          <dd className="m-0 truncate font-bold">{candidate.name}</dd>
          <dt className="text-[var(--muted)]">화면</dt>
          <dd className="m-0">
            {candidate.width} × {candidate.height} px · 레이어 {candidate.layers}
          </dd>
          <dt className="text-[var(--muted)]">저장 시각</dt>
          <dd className="m-0">{formatTime(candidate.savedAt)}</dd>
        </dl>
        {hasProject && <p className="mb-3 text-xs text-[#8a5a12]">복원하면 지금 열려 있는 화면은 대체됩니다.</p>}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={() => void autosave.discard()}>
            버리기
          </button>
          <button className="btn primary" autoFocus onClick={() => void autosave.restore()}>
            복원
          </button>
        </div>
      </div>
    </div>
  );
}
