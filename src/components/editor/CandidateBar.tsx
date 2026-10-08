"use client";

import { useCallback, useEffect } from "react";
import { Analyser, createWorkerAnalyser } from "@/features/auto-regions/analyser";
import { selectScreen } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";

/** one worker for the whole page, started the first time candidates are asked for */
let analyser: Analyser | null = null;
const getAnalyser = () => (analyser ??= createWorkerAnalyser());

/** Runs the analysis (in a Web Worker, so the editor stays usable) when the automatic-candidates tool is on and the screen's picture has
 *  not been analysed yet, and shows its state: analysing, how many candidates, the chosen one with its Extract and Clear buttons. */
export default function CandidateBar() {
  const tool = useEditorStore((s) => s.activeTool);
  const compare = useEditorStore((s) => s.compareMode);
  const screen = useEditorStore(selectScreen);
  const candidates = useEditorStore((s) => s.candidates);
  const status = useEditorStore((s) => s.candidateStatus);
  const error = useEditorStore((s) => s.candidateError);
  const pick = useEditorStore((s) => s.candidatePick);
  const imageId = screen?.source.imageId;
  const need = tool === "auto" && compare === "off" && !!imageId && candidates?.imageId !== imageId;

  const run = useCallback(() => {
    const st = editorStore.getState();
    const id = st.history?.present.screens[0].source.imageId;
    const raw = id ? st.images.get(id)?.raw : undefined;
    if (!id || !raw) return;
    st.setCandidateStatus("running");
    getAnalyser()
      .analyse(raw)
      .then((a) => {
        const now = editorStore.getState();
        if (now.history?.present.screens[0].source.imageId !== id) return; // another picture was opened meanwhile
        now.setCandidates({ imageId: id, list: a.candidates, ms: a.ms });
        now.setCandidateStatus("idle");
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.message === "superseded") return;
        editorStore.getState().setCandidateStatus("error", e instanceof Error ? e.message : "분석에 실패했습니다");
      });
  }, []);

  useEffect(() => {
    if (need && status === "idle") run();
  }, [need, status, run, imageId]);

  if (tool !== "auto" || compare !== "off" || !screen) return null;
  return (
    <div
      data-testid="candidate-bar"
      className="absolute bottom-3 left-1/2 z-10 flex max-w-[92%] -translate-x-1/2 items-center gap-3 rounded-[10px] border border-[var(--line)] bg-white/95 px-3 py-2 text-xs shadow-md"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span data-testid="candidate-status" data-state={status === "error" ? "error" : status === "running" || need ? "running" : "ready"}>
        {status === "error" ? (
          <>분석하지 못했습니다: {error}</>
        ) : status === "running" || need ? (
          "화면을 분석하는 중…"
        ) : candidates ? (
          <>
            후보 {candidates.list.length}개 · 분석 {candidates.ms}ms
          </>
        ) : null}
      </span>
      {status === "error" && (
        <button className="btn mini" onClick={() => editorStore.getState().setCandidateStatus("idle")}>
          다시 분석
        </button>
      )}
      {pick ? (
        <>
          <span data-testid="candidate-pick" className="font-bold">
            {pick.index + 1}/{pick.count} · {pick.rect.width} × {pick.rect.height} px
          </span>
          <button className="btn mini primary" data-testid="candidate-extract" onClick={() => editorStore.getState().extractCandidatePick()}>
            추출 (Enter)
          </button>
          <button className="btn mini" data-testid="candidate-clear" onClick={() => editorStore.getState().clearCandidatePick()}>
            해제 (Esc)
          </button>
          <span className="text-[var(--muted)]">같은 자리를 다시 클릭하면 더 큰 후보</span>
        </>
      ) : (
        status !== "error" && candidates && <span className="text-[var(--muted)]">후보를 클릭하세요. 같은 자리를 다시 클릭하면 한 단계 큰 후보가 선택됩니다.</span>
      )}
    </div>
  );
}
