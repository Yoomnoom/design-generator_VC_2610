"use client";

type Props = { projectName: string | null; canExport: boolean; onPickFile: () => void; onExport: () => void };

export default function TopBar({ projectName, canExport, onPickFile, onExport }: Props) {
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
      <button className="btn ghost" onClick={onPickFile}>
        이미지 업로드
      </button>
      <button className="btn primary" disabled={!canExport} onClick={onExport}>
        PNG 내보내기
      </button>
    </header>
  );
}
