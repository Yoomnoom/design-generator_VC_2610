"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { getAutosave } from "@/features/autosave/browser-autosave";
import { decidePaste } from "@/features/layer-clipboard/layer-clipboard";
import { imageFromClipboard } from "@/features/import-image/clipboard";
import { checkImageFile, importImage } from "@/features/import-image/import-image";
import { parseProjectFile } from "@/features/project-persistence/project-file";
import { loadProjectText, saveProjectText } from "@/features/project-persistence/project-io";
import { canvasCodec } from "@/lib/image/canvas-codec";
import { isTypingTarget } from "@/lib/dom";
import { getBlobStore } from "@/lib/storage/browser-blob-store";
import { History } from "@/store/history";
import { Project } from "@/lib/project/schema";
import { selectProject, selectScreen } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";
import { downloadBlob, safeName } from "./download";
import { AutosaveBanners, AutosaveFooter } from "./AutosaveStatus";
import DrawStylePanel from "./DrawStylePanel";
import MemoPanel from "./MemoPanel";
import TextStylePanel from "./TextStylePanel";
import ExportDialog from "./ExportDialog";
import FillColorDialog from "./FillColorDialog";
import LayerPanel from "./LayerPanel";
import PropertyPanel from "./PropertyPanel";
import RestorePrompt from "./RestorePrompt";
import SourcePanel from "./SourcePanel";
import ToolRail from "./ToolRail";
import Notices from "./Notices";
import TopBar from "./TopBar";
import { useShortcuts } from "./useShortcuts";

// Konva touches `window`, so the canvas is never rendered on the server
const CanvasViewport = dynamic(() => import("./CanvasViewport"), { ssr: false, loading: () => <div className="h-full w-full" /> });

type Incoming = { kind: "image" | "project"; file: File };

export default function EditorShell() {
  const project = useEditorStore(selectProject);
  const screen = useEditorStore(selectScreen);
  const zoom = useEditorStore((s) => s.view.zoom);
  const tool = useEditorStore((s) => s.activeTool);

  useShortcuts();

  // Temporary save: starts once; the page being hidden or closed saves at once instead of waiting for the delay.
  useEffect(() => {
    const autosave = getAutosave();
    autosave.start();
    const flush = () => void autosave.flush();
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  const imageInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const savedHistory = useRef<History<Project> | null>(null); // the history as it was when last saved or opened
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<Incoming | null>(null); // waiting for "discard current work?" to be answered
  const [exporting, setExporting] = useState(false);
  const [dropping, setDropping] = useState(false);

  const loadImage = async (file: File) => {
    setBusy(true);
    const result = await importImage(file, canvasCodec);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    editorStore.getState().newProject({ fileName: file.name, raw: result.raw, blob: file });
    savedHistory.current = null;
  };

  const openProject = async (file: File) => {
    setBusy(true);
    try {
      const result = await loadProjectText(await file.text(), { blobs: await getBlobStore(), codec: canvasCodec });
      if (!result.ok) return setError(result.error);
      editorStore.getState().loadProject(result.project, result.images);
      savedHistory.current = editorStore.getState().history;
    } catch {
      setError("프로젝트를 열지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  const saveProject = async () => {
    const state = editorStore.getState();
    const snapshot = state.snapshotProject();
    if (!snapshot) return;
    setBusy(true);
    setError(null);
    try {
      const text = await saveProjectText(snapshot, state.images, { blobs: await getBlobStore(), codec: canvasCodec });
      downloadBlob(new Blob([text], { type: "application/json" }), `${safeName(snapshot.name)}.slc.json`);
      savedHistory.current = state.history; // edits made while saving still count as unsaved
    } catch (e) {
      setError(e instanceof Error ? `저장하지 못했습니다: ${e.message}` : "저장하지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  const run = (next: Incoming) => (next.kind === "image" ? loadImage(next.file) : openProject(next.file));

  /** replacing a project that has unsaved edits asks first */
  const request = async (next: Incoming) => {
    setError(null);
    setIncoming(null);
    // a file that cannot be opened is refused straight away; no point asking whether to discard work for it
    if (next.kind === "image") {
      const typeError = checkImageFile(next.file);
      if (typeError) return setError(typeError);
    } else {
      const parsed = parseProjectFile(await next.file.text());
      if (!parsed.ok) return setError(parsed.error);
    }
    const history = editorStore.getState().history;
    const unsaved = !!history && history.past.length > 0 && history !== savedHistory.current;
    if (unsaved) setIncoming(next);
    else void run(next);
  };

  // Ctrl/⌘+V needs a picture on the system clipboard; with none, nothing happens. A picture whose hash is the one the app put there
  // when a layer was copied is pasted as that layer. Any other picture is loaded exactly like an upload, including the
  // "discard current work?" question. (Leaving the window changes nothing: the copy stays until something else is copied.)
  const requestRef = useRef(request);
  requestRef.current = request;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const file = imageFromClipboard(e.clipboardData);
      if (!file) return; // no picture: nothing is pasted
      e.preventDefault();
      void decidePaste({ file, store: editorStore, codec: canvasCodec }).then((what) => {
        if (what === "layer") editorStore.getState().pasteLayer();
        else if (what === "image") void requestRef.current({ kind: "image", file });
      });
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  const pickFrom = (kind: Incoming["kind"]) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // choosing the same file again must still fire
    if (file) void request({ kind, file });
  };

  return (
    <div className="flex h-screen select-none flex-col">
      <TopBar
        projectName={project?.name ?? null}
        canExport={!!project}
        busy={busy}
        onPickImage={() => imageInput.current?.click()}
        onOpenProject={() => projectInput.current?.click()}
        onSaveProject={() => void saveProject()}
        onExport={() => setExporting(true)}
      />
      <Notices extra={<AutosaveBanners />} />
      <input ref={imageInput} data-testid="file-input" type="file" accept="image/png,image/jpeg" className="hidden" onChange={pickFrom("image")} />
      <input ref={projectInput} data-testid="project-input" type="file" accept=".json,application/json" className="hidden" onChange={pickFrom("project")} />

      <main className="grid min-h-0 flex-1 grid-cols-[76px_248px_minmax(420px,1fr)_282px]">
        <ToolRail enabled={!!project} />
        <SourcePanel
          screen={screen}
          busy={busy}
          error={error}
          replaceName={incoming?.file.name ?? null}
          onPickFile={() => imageInput.current?.click()}
          onConfirmReplace={() => incoming && void run(incoming).then(() => setIncoming(null))}
          onCancelReplace={() => setIncoming(null)}
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
            if (file) void request({ kind: "image", file });
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
                <button className="btn primary" onClick={() => imageInput.current?.click()}>
                  이미지 선택
                </button>
              </div>
            </div>
          )}
          {dropping && <div className="pointer-events-none absolute inset-2 rounded-xl border-2 border-dashed border-[var(--accent)] bg-[var(--soft)]/60" />}
        </section>
        <aside aria-label="레이어와 속성" className="min-h-0 overflow-auto border-l border-[var(--line)] bg-[var(--panel)]">
          <DrawStylePanel />
          <TextStylePanel />
          <LayerPanel />
          <PropertyPanel />
          <MemoPanel />
        </aside>
      </main>

      <footer className="flex h-7 shrink-0 items-center border-t border-[var(--line)] bg-white px-3 text-[11px] text-[#71767d]">
        <span>
          {tool === "select" ? "선택 도구 · 드래그로 레이어 이동" : tool === "hand" ? "이동 도구 · 드래그로 화면 이동" : tool === "rect" ? "영역 추출 · 드래그로 사각형 지정" : "배경 채움 · 패치를 클릭해 색 변경"}
        </span>
        <AutosaveFooter />
        <span>{screen ? `화면 1 · 레이어 ${screen.layers.length} · ${Math.round(zoom * 100)}%` : "화면 없음"}</span>
      </footer>

      <RestorePrompt />
      <FillColorDialog />
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  );
}
