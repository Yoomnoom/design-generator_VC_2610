"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { getAutosave } from "@/features/autosave/browser-autosave";
import { copyInProgress, decidePaste } from "@/features/layer-clipboard/layer-clipboard";
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
import AssetPanel from "./AssetPanel";
import FingerPanel from "./FingerPanel";
import LiquifyPanel from "./LiquifyPanel";
import WarpPanel from "./WarpPanel";
import ExportDialog from "./ExportDialog";
import FillColorDialog from "./FillColorDialog";
import LayerPanel from "./LayerPanel";
import PropertyPanel from "./PropertyPanel";
import RestorePrompt from "./RestorePrompt";
import SourcePanel from "./SourcePanel";
import ToolRail from "./ToolRail";
import Notices from "./Notices";
import TopBar from "./TopBar";
import ShortcutSettings from "./ShortcutSettings";
import CanvasSizeDialog from "./CanvasSizeDialog";
import HelpPanel, { OnboardingGuide, useFirstUse } from "./HelpPanel";
import StartChoices, { CanvasSpec, NewCanvasDialog, StartDialog } from "./StartChoices";
import { TemplateId, TEMPLATES, buildTemplate } from "@/features/assets/templates";
import { canvasMeasureFor } from "@/lib/image/text-measure";
import { useShortcuts } from "./useShortcuts";
import { toolHint } from "@/features/tool-hints/tool-hints";

// Konva touches `window`, so the canvas is never rendered on the server
const CanvasViewport = dynamic(() => import("./CanvasViewport"), { ssr: false, loading: () => <div className="h-full w-full" /> });

type Incoming = { kind: "image" | "project"; file: File } | { kind: "blank"; spec: CanvasSpec } | { kind: "template"; id: TemplateId };
/** what the "discard current work?" question names */
const incomingLabel = (i: Incoming) => (i.kind === "blank" ? "빈 캔버스" : i.kind === "template" ? TEMPLATES.find((t) => t.id === i.id)!.label : i.file.name);

export default function EditorShell() {
  const project = useEditorStore(selectProject);
  const screen = useEditorStore(selectScreen);
  const zoom = useEditorStore((s) => s.view.zoom);
  const tool = useEditorStore((s) => s.activeTool);
  const selectedCount = useEditorStore((s) => s.selectedLayerIds.length);
  const hintSelected = useEditorStore((s) => s.selectedLayerIds);
  const comparingNow = useEditorStore((s) => s.compareMode !== "off");
  const hint = toolHint(tool, { screen, selected: screen ? screen.layers.filter((l) => hintSelected.includes(l.id)) : [], comparing: comparingNow });

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
  const [startOpen, setStartOpen] = useState(false); // the top bar's "new project" window
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false); // the guide as a window, opened from the help
  const [firstUse, endFirstUse] = useFirstUse();
  const [canvasOpen, setCanvasOpen] = useState(false); // the blank-canvas size window

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

  /** a picture from outside while a project is open: it becomes a new layer, no question asked */
  const addAsLayer = async (file: File) => {
    const state = editorStore.getState();
    if (state.compareMode !== "off") return state.setNotice("비교 보기 중에는 이미지를 붙여넣을 수 없습니다. 비교를 끄고 다시 시도해 주세요.");
    const result = await importImage(file, canvasCodec);
    if (!result.ok) return state.setNotice(result.error);
    if (!editorStore.getState().addImageLayer({ raw: result.raw, blob: file, name: file.name.replace(/\.[^.]+$/, "") })) editorStore.getState().setNotice("이미지를 레이어로 추가하지 못했습니다.");
  };

  /** a picture arriving from outside: a new layer when a project is open, otherwise a new project (like an upload) */
  const receiveImage = (file: File) => (editorStore.getState().history ? addAsLayer(file) : request({ kind: "image", file }));

  const run = async (next: Incoming) => {
    if ("file" in next) return next.kind === "image" ? loadImage(next.file) : openProject(next.file);
    if (next.kind === "blank") {
      const why = editorStore.getState().newBlankProject({ ...next.spec });
      if (why) return setError(why);
    } else {
      const { project, images } = buildTemplate(next.id, canvasMeasureFor);
      editorStore.getState().loadProject(project, images);
      editorStore.setState({ needsFit: true });
    }
    savedHistory.current = null;
  };

  /** replacing a project that has unsaved edits asks first */
  const request = async (next: Incoming) => {
    setError(null);
    setIncoming(null);
    // a file that cannot be opened is refused straight away; no point asking whether to discard work for it
    if (next.kind === "blank" || next.kind === "template") {
      // nothing to read: a size and colour, or a built-in template
    } else if (next.kind === "image") {
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
  const receiveRef = useRef(receiveImage);
  receiveRef.current = receiveImage;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const file = imageFromClipboard(e.clipboardData);
      if (!file) {
        // no picture: nothing is pasted, unless a layer copy is still being written to the clipboard (Ctrl+C then Ctrl+V in quick succession)
        const copying = copyInProgress();
        if (copying) void copying.then(() => editorStore.getState().pasteLayer());
        return;
      }
      e.preventDefault();
      void decidePaste({ file, store: editorStore, codec: canvasCodec }).then((what) => {
        if (what === "layer") editorStore.getState().pasteLayer();
        else if (what === "image") void receiveRef.current(file);
      });
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  // In a full-screen or installed-app window ask the browser to hand over keys it normally keeps (Ctrl+T/N/W); best effort, unverified
  useEffect(() => {
    const kb = (navigator as unknown as { keyboard?: { lock?: (codes: string[]) => Promise<void>; unlock?: () => void } }).keyboard;
    if (!kb?.lock) return;
    const standalone = () => window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches || !!document.fullscreenElement;
    const sync = () => (standalone() ? void kb.lock!(["KeyT", "KeyN", "KeyW"]).catch(() => {}) : kb.unlock?.());
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  // Ctrl+S / Ctrl+O arrive as events from the shortcut handler
  const fileRef = useRef({ save: saveProject, open: () => projectInput.current?.click() });
  fileRef.current = { save: saveProject, open: () => projectInput.current?.click() };
  useEffect(() => {
    const on = (e: Event) => {
      const what = (e as CustomEvent<string>).detail;
      if (what === "save" && editorStore.getState().history) void fileRef.current.save();
      else if (what === "open") fileRef.current.open();
    };
    window.addEventListener("slc-file", on);
    return () => window.removeEventListener("slc-file", on);
  }, []);

  const pickFrom = (kind: "image" | "project") => (e: React.ChangeEvent<HTMLInputElement>) => {
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
        onNew={() => setStartOpen(true)}
        onShortcuts={() => setShortcutsOpen(true)}
        onHelp={() => setHelpOpen(true)}
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
          replaceName={incoming ? incomingLabel(incoming) : null}
          onPickFile={() => imageInput.current?.click()}
          onConfirmReplace={() => incoming && void run(incoming).then(() => setIncoming(null))}
          onCancelReplace={() => setIncoming(null)}
          onCanvasSize={() => setSizeOpen(true)}
        >
          <AssetPanel />
        </SourcePanel>
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
            if (file) void receiveImage(file);
          }}
        >
          <CanvasViewport />
          {!project && (
            <div className="absolute inset-0 grid place-items-center">
              <div className="max-h-full w-full max-w-[760px] overflow-auto p-6">
                <h2 className="m-0 mb-1 text-center text-xl font-bold">무엇으로 시작할까요?</h2>
                <p className="mb-4 text-center text-[var(--muted)]">캡처를 올리거나, 빈 캔버스나 템플릿에서 시작할 수 있습니다.</p>
                {firstUse && (
                  <div className="mb-4">
                    <OnboardingGuide variant="card" onDone={endFirstUse} />
                  </div>
                )}
                <StartChoices onUpload={() => imageInput.current?.click()} onBlank={() => setCanvasOpen(true)} onTemplate={(id) => void request({ kind: "template", id })} />
              </div>
            </div>          )}
          {dropping && <div className="pointer-events-none absolute inset-2 rounded-xl border-2 border-dashed border-[var(--accent)] bg-[var(--soft)]/60" />}
        </section>
        <aside aria-label="레이어와 속성" className="min-h-0 overflow-auto border-l border-[var(--line)] bg-[var(--panel)]">
          <DrawStylePanel />
          <TextStylePanel />
          <WarpPanel />
          <FingerPanel />
          <LiquifyPanel />
          <LayerPanel />
          <PropertyPanel />
          <MemoPanel />
        </aside>
      </main>

      <footer className="flex h-7 shrink-0 items-center border-t border-[var(--line)] bg-white px-3 text-[11px] text-[#71767d]">
        <span>
          <span data-testid="tool-hint" data-usable={hint.usable ? "yes" : "no"} className={hint.usable ? "" : "font-bold text-[#8a5a12]"}>
            {hint.text}
          </span>
        </span>
        <AutosaveFooter />
        <span data-testid="footer-info">{screen ? `화면 1 · 레이어 ${screen.layers.length}${selectedCount > 0 ? ` · ${selectedCount}개 선택됨` : ""} · ${Math.round(zoom * 100)}%` : "화면 없음"}</span>
      </footer>

      {startOpen && (
        <StartDialog
          onClose={() => setStartOpen(false)}
          onUpload={() => { setStartOpen(false); imageInput.current?.click(); }}
          onBlank={() => { setStartOpen(false); setCanvasOpen(true); }}
          onTemplate={(id) => { setStartOpen(false); void request({ kind: "template", id }); }}
        />
      )}
      {canvasOpen && <NewCanvasDialog onClose={() => setCanvasOpen(false)} onCreate={(spec) => { setCanvasOpen(false); void request({ kind: "blank", spec }); }} />}
      {sizeOpen && screen && <CanvasSizeDialog width={screen.width} height={screen.height} onClose={() => setSizeOpen(false)} />}
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} onShowGuide={() => { setHelpOpen(false); setGuideOpen(true); }} />}
      {guideOpen && <OnboardingGuide variant="modal" onDone={() => { setGuideOpen(false); endFirstUse(); }} />}
      {shortcutsOpen && <ShortcutSettings onClose={() => setShortcutsOpen(false)} />}
      <RestorePrompt />
      <FillColorDialog />
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  );
}
