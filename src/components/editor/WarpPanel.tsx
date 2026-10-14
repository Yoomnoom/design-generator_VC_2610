"use client";

import { MESH_MAX, MESH_MIN } from "@/lib/image/warp";
import { selectScreen } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";

/** The warp tool's settings: corner handles (skew, perspective, distortion) or a grid of control points (mesh), the grid's size, reset, and
 *  keep / cancel. Shown while the warp tool is on. */
export default function WarpPanel() {
  const tool = useEditorStore((s) => s.activeTool);
  const session = useEditorStore((s) => s.warpSession);
  const ui = useEditorStore((s) => s.warpUi);
  const screen = useEditorStore(selectScreen);
  const comparing = useEditorStore((s) => s.compareMode !== "off");
  if (tool !== "warp" || !session) return null;
  const layer = screen?.layers.find((l) => l.id === session.layerId);
  if (!layer) return null;
  const st = editorStore.getState();
  const setMode = (mode: "quad" | "mesh") => (layer.warp ? st.convertWarp(layer.id, { ...ui, mode }) : st.setWarpUi({ mode }));
  const setSize = (change: { cols?: number; rows?: number }) => {
    const next = { ...ui, ...change };
    if (layer.warp?.kind === "mesh") st.convertWarp(layer.id, next);
    else st.setWarpUi(change);
  };
  const number = (key: "cols" | "rows", label: string) => (
    <label className="flex items-center gap-1.5">
      {label}
      <input
        data-testid={`warp-${key}`}
        type="number"
        min={MESH_MIN}
        max={MESH_MAX}
        value={ui[key]}
        disabled={comparing}
        onChange={(e) => setSize({ [key]: Number(e.target.value) })}
        className="w-14 rounded border border-[var(--line)] bg-white px-1.5 py-0.5 text-xs"
      />
    </label>
  );
  return (
    <section aria-label="변형 설정" data-testid="warp-panel" className="border-b border-[var(--line)] px-3.5 py-3">
      <h3 className="mb-2.5 text-[13px] font-bold">변형 · {layer.name}</h3>
      <div role="group" aria-label="변형 방식" className="flex gap-1.5 text-xs">
        <button data-testid="warp-mode-quad" className="btn mini shrink-0" aria-pressed={ui.mode === "quad"} disabled={comparing} onClick={() => setMode("quad")} title="모서리 네 점을 끌어 왜곡, 변의 가운데 점을 밀어 기울이기, Alt+모서리로 원근(마주 보는 점이 대칭으로 움직임, Alt+Shift는 위아래)">
          모서리 (왜곡)
        </button>
        <button data-testid="warp-mode-mesh" className="btn mini shrink-0" aria-pressed={ui.mode === "mesh"} disabled={comparing} onClick={() => setMode("mesh")} title="격자 조절점을 끌면 그 주변이 부드럽게 따라옵니다">
          격자 (뒤틀기)
        </button>
      </div>
      {ui.mode === "mesh" && (
        <div className="mt-2 flex items-center gap-3 text-xs">
          {number("cols", "열")}
          {number("rows", "행")}
        </div>
      )}
      <p className="mb-0 mt-2 text-[11px] text-[var(--muted)]">
        {ui.mode === "quad" ? "모서리 점: 자유 왜곡 · 변 가운데 점: 기울이기 · Alt+모서리: 원근" : "조절점을 끌면 주변이 부드럽게 따라옵니다."} 원본 픽셀은 바뀌지 않습니다.
      </p>
      <div className="mt-2 flex gap-1.5">
        <button data-testid="warp-reset" className="btn mini" disabled={!layer.warp || comparing || layer.locked} onClick={() => st.setLayerWarp(layer.id, null)}>
          변형 초기화
        </button>
        <button data-testid="warp-confirm" className="btn mini primary" onClick={() => st.finishWarp(true)} title="변형을 확정합니다 (Enter)">
          확정
        </button>
        <button data-testid="warp-cancel" className="btn mini" onClick={() => st.finishWarp(false)} title="이 도구로 한 변형을 모두 취소합니다 (Esc)">
          취소
        </button>
      </div>
    </section>
  );
}