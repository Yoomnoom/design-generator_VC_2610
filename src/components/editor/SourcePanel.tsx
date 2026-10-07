"use client";

import { ScreenNode } from "@/lib/project/schema";

type Props = {
  screen: ScreenNode | null;
  busy: boolean;
  error: string | null;
  replaceName: string | null; // set while waiting for the user to confirm replacing the current work
  onPickFile: () => void;
  onConfirmReplace: () => void;
  onCancelReplace: () => void;
};

export default function SourcePanel({ screen, busy, error, replaceName, onPickFile, onConfirmReplace, onCancelReplace }: Props) {
  return (
    <aside className="min-h-0 overflow-auto border-r border-[var(--line)] bg-[var(--panel)]">
      <div className="panel-title">소스 이미지</div>
      <div className="card">
        <button
          type="button"
          onClick={onPickFile}
          disabled={busy}
          className="w-full cursor-pointer rounded-[10px] border-[1.5px] border-dashed border-[#b9b8b2] bg-[#fafaf8] px-2.5 py-5 text-center disabled:cursor-wait"
        >
          <b className="mb-1 block">{busy ? "불러오는 중…" : "캡처 이미지 업로드"}</b>
          <span className="text-xs text-[var(--muted)]">PNG · JPG · 끌어다 놓기</span>
        </button>
        {error && (
          <p role="alert" className="mt-2 text-xs text-[#b3361b]">
            {error}
          </p>
        )}
        {replaceName && (
          <div role="alertdialog" aria-label="이미지 교체 확인" className="mt-3 rounded-lg border border-[#ead9a2] bg-[#fff9e8] p-2.5 text-xs text-[#75601b]">
            <p className="mb-2">
              <b>{replaceName}</b>을(를) 불러오면 저장하지 않은 현재 작업이 사라집니다.
            </p>
            <div className="flex gap-2">
              <button className="btn mini primary" onClick={onConfirmReplace}>
                새로 불러오기
              </button>
              <button className="btn mini" onClick={onCancelReplace}>
                취소
              </button>
            </div>
          </div>
        )}
      </div>

      {screen && (
        <>
          <div className="panel-title">현재 화면</div>
          <div className="card text-xs">
            <p data-testid="source-name" className="truncate font-bold" title={screen.source.fileName}>
              {screen.source.fileName}
            </p>
            <p className="mt-1 text-[var(--muted)]">
              원본 크기 {screen.width} × {screen.height} px · 레이어 {screen.layers.length}
            </p>
          </div>
        </>
      )}
    </aside>
  );
}
