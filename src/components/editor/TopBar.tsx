"use client";

import { CompareMode, selectCanRedo, selectCanUndo } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";

type Props = {
  projectName: string | null;
  canExport: boolean;
  busy: boolean;
  onPickImage: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onExport: () => void;
};

const COMPARE: { mode: CompareMode; label: string; title: string }[] = [
  { mode: "off", label: "수정본", title: "수정한 결과를 봅니다" },
  { mode: "original", label: "원본", title: "업로드한 원본 그대로를 봅니다 (편집 불가)" },
  { mode: "split", label: "나란히", title: "원본과 수정본을 나란히 봅니다 (편집 불가)" },
];

export default function TopBar({ projectName, canExport, busy, onPickImage, onOpenProject, onSaveProject, onExport }: Props) {
  const canUndo = useEditorStore(selectCanUndo);
  const canRedo = useEditorStore(selectCanRedo);
  const undoLabel = useEditorStore((s) => s.history?.past.at(-1)?.label);
  const compare = useEditorStore((s) => s.compareMode);
  const redoLabel = useEditorStore((s) => s.history?.future[0]?.label);
  return (
    <header className="flex h-[54px] shrink-0 items-center gap-3 border-b border-black bg-[#171a1f] px-4 text-white">
      <div className="font-extrabold tracking-tight">
        <i className="mr-[9px] inline-block h-3 w-3 rotate-45 rounded-[3px] bg-[var(--accent2)]" />
        LayerCanvas
      </div>
      <div className="border-l border-[#3c4048] pl-3 text-[#c7cad0]" data-testid="project-name">
        {projectName ?? "새 프로젝트"}
      </div>
      <div className="flex-1" />
      <div role="group" aria-label="원본 비교" className="flex overflow-hidden rounded-lg border border-[#494e57]">
        {COMPARE.map((c) => (
          <button key={c.mode} aria-pressed={compare === c.mode} title={c.title} disabled={!canExport} onClick={() => editorStore.getState().setCompareMode(c.mode)} className={`h-8 cursor-pointer border-0 px-3 text-[13px] disabled:cursor-not-allowed disabled:opacity-45 ${compare === c.mode ? "bg-[var(--accent)] font-bold text-white" : "bg-transparent text-[#dfe2e7] hover:bg-[#272b32]"}`}>
            {c.label}
          </button>
        ))}
      </div>
      <span className="h-5 border-l border-[#3c4048]" />
      <button className="btn ghost" disabled={!canUndo} title={`${undoLabel ? `실행 취소: ${undoLabel}` : "실행 취소"} (Ctrl+Z)`} onClick={() => editorStore.getState().undo()}>
        ↶ 실행 취소
      </button>
      <button className="btn ghost" disabled={!canRedo} title={`${redoLabel ? `다시 실행: ${redoLabel}` : "다시 실행"} (Ctrl+Shift+Z)`} onClick={() => editorStore.getState().redo()}>
        ↷ 다시 실행
      </button>
      <span className="h-5 border-l border-[#3c4048]" />
      <button className="btn ghost" onClick={onPickImage}>
        이미지 업로드
      </button>
      <button className="btn ghost" disabled={busy} onClick={onOpenProject}>
        프로젝트 열기
      </button>
      <button className="btn ghost" disabled={!canExport || busy} onClick={onSaveProject}>
        프로젝트 저장
      </button>
      <button className="btn primary" disabled={!canExport} onClick={onExport}>
        PNG 내보내기
      </button>
    </header>
  );
}
