"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { checkImageFile, importImage } from "@/features/import-image/import-image";
import { canvasCodec } from "@/lib/image/canvas-codec";
import { selectProject, selectScreen } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";
import ExportDialog from "./ExportDialog";
import FillColorDialog from "./FillColorDialog";
import SourcePanel from "./SourcePanel";
import ToolRail from "./ToolRail";
import TopBar from "./TopBar";

// Konva touches `window`, so the canvas is never rendered on the server
const CanvasViewport = dynamic(() => import("./CanvasViewport"), { ssr: false, loading: () => <div className="h-full w-full" /> });

export default function EditorShell() {
  const project = useEditorStore(selectProject);
  const screen = useEditorStore(selectScreen);
  const zoom = useEditorStore((s) => s.view.zoom);
  const tool = useEditorStore((s) => s.activeTool);

  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replace, setReplace] = useState<File | null>(null);
  const [exporting, setExporting] = useState(false);
  const [dropping, setDropping] = useState(false);

  const load = async (file: File) => {
    setReplace(null);
    setError(null);
    setBusy(true);
    const result = await importImage(file, canvasCodec);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    editorStore.getState().newProject({ fileName: file.name, raw: result.raw, blob: file });
  };

  /** replacing a project that has edits asks first: there is no save yet */
  const request = (file: File) => {
    const typeError = checkImageFile(file);
    if (typeError) return setError(typeError);
    const edited = (editorStore.getState().history?.past.length ?? 0) > 0;
    if (edited) {
      setError(null);
      setReplace(file);
    } else void load(file);
  };

  return (
    <div className="grid h-screen grid-rows-[54px_1fr_28px]">
      <TopBar projectName={project?.name ?? null} canExport={!!project} onPickFile={() => input.current?.click()} onExport={() => setExporting(true)} />
      <input
        ref={input}
        data-testid="file-input"
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // choosing the same file again must still fire
          if (file) request(file);
        }}
      />

      <main className="grid min-h-0 grid-cols-[76px_248px_minmax(420px,1fr)]">
        <ToolRail enabled={!!project} />
        <SourcePanel
          screen={screen}
          busy={busy}
          error={error}
          replaceName={replace?.name ?? null}
          onPickFile={() => input.current?.click()}
          onConfirmReplace={() => replace && void load(replace)}
          onCancelReplace={() => setReplace(null)}
        />
        <section
          className="relative min-h-0 min-w-0"
          onDragOver={(e) => {
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDropping(false);
            const file = e.dataTransfer.files[0];
            if (file) request(file);
          }}
        >
          <CanvasViewport />
          {!project && (
            <div className="absolute inset-0 grid place-items-center">
              <div className="w-80 text-center">
                <div className="mx-auto mb-4 grid h-[74px] w-[74px] place-items-center rounded-[18px] bg-[var(--soft)] text-3xl text-[var(--accent)]" aria-hidden>
                  ⇧
                </div>
                <h2 className="m-0 mb-2 text-xl font-bold">화면 캡처를 올려주세요</h2>
                <p className="mb-4 text-[var(--muted)]">캡처 속 카드·버튼·텍스트를 사각형으로 골라 이미지 레이어로 분리합니다.</p>
                <button className="btn primary" onClick={() => input.current?.click()}>
                  이미지 선택
                </button>
              </div>
            </div>
          )}
          {dropping && <div className="pointer-events-none absolute inset-2 rounded-xl border-2 border-dashed border-[var(--accent)] bg-[var(--soft)]/60" />}
        </section>
      </main>

      <footer className="flex items-center border-t border-[var(--line)] bg-white px-3 text-[11px] text-[#71767d]">
        <span>{tool === "select" ? "선택 도구 · 드래그로 레이어 이동" : tool === "hand" ? "이동 도구 · 드래그로 화면 이동" : "영역 추출 · 드래그로 사각형 지정"}</span>
        <span className="ml-auto">{screen ? `화면 1 · 레이어 ${screen.layers.length} · ${Math.round(zoom * 100)}%` : "화면 없음"}</span>
      </footer>

      <FillColorDialog />
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  );
}
