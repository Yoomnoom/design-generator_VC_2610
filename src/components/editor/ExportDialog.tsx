"use client";

import { useState } from "react";
import { readPngSize, renderProjectPng } from "@/features/export-image/export-png";
import { canvasCodec } from "@/lib/image/canvas-codec";
import { downloadBlob, safeName } from "./download";
import { selectProject } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";

export default function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditorStore(selectProject);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "busy" } | { kind: "done"; width: number; height: number } | { kind: "error"; message: string }>({ kind: "idle" });
  if (!project) return null;
  const screen = project.screens[0];
  const fileName = `${safeName(project.name)}.png`;

  const save = async () => {
    setState({ kind: "busy" });
    try {
      const { blob, width, height } = await renderProjectPng(project, editorStore.getState().images, canvasCodec);
      // check the file itself, not just what we meant to write
      const written = await readPngSize(blob);
      if (!written || written.width !== screen.width || written.height !== screen.height) {
        throw new Error(`출력 크기(${written ? `${written.width} × ${written.height}` : "PNG 아님"})가 원본(${screen.width} × ${screen.height})과 다릅니다`);
      }
      downloadBlob(blob, fileName);
      setState({ kind: "done", width, height });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "내보내기에 실패했습니다" });
    }
  };

  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/30" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="export-title" className="w-[400px] rounded-[14px] border border-[var(--line)] bg-white p-[18px] shadow-[var(--shadow)]">
        <h2 id="export-title" className="m-0 mb-1 text-lg font-bold">
          목업 내보내기
        </h2>
        <p className="mb-4 text-xs text-[var(--muted)]">현재 화면을 한 장의 PNG로 저장합니다.</p>
        <div className="mb-4 rounded-[9px] border border-[var(--accent)] bg-[var(--soft)] p-2.5 text-sm">
          <div data-testid="export-size">
            PNG · 원본 크기 · {screen.width} × {screen.height} px
          </div>
          <div className="mt-0.5 text-xs text-[var(--muted)]">{fileName} · 투명한 부분은 투명 그대로 저장됩니다</div>
        </div>
        {state.kind === "done" && (
          <p data-testid="export-done" role="status" className="mb-3 text-xs text-[#2f7952]">
            저장했습니다 · {state.width} × {state.height} px
          </p>
        )}
        {state.kind === "error" && (
          <p role="alert" className="mb-3 text-xs text-[#b3361b]">
            {state.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            닫기
          </button>
          <button className="btn primary" data-testid="export-save" disabled={state.kind === "busy"} onClick={save} autoFocus>
            {state.kind === "busy" ? "만드는 중…" : "PNG 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
