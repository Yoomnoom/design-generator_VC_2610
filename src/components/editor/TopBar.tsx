"use client";

import { selectCanRedo, selectCanUndo } from "@/store/editor-store";
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

export default function TopBar({ projectName, canExport, busy, onPickImage, onOpenProject, onSaveProject, onExport }: Props) {
  const canUndo = useEditorStore(selectCanUndo);
  const canRedo = useEditorStore(selectCanRedo);
  const undoLabel = useEditorStore((s) => s.history?.past.at(-1)?.label);
  const redoLabel = useEditorStore((s) => s.history?.future[0]?.label);
  return (
    <header className="flex items-center gap-3 border-b border-black bg-[#171a1f] px-4 text-white">
      <div className="font-extrabold tracking-tight">
        <i className="mr-[9px] inline-block h-3 w-3 rotate-45 rounded-[3px] bg-[var(--accent2)]" />
        LayerCanvas
      </div>
      <div className="border-l border-[#3c4048] pl-3 text-[#c7cad0]" data-testid="project-name">
        {projectName ?? "새 프로젝트"}
      </div>
      <div className="flex-1" />
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
