"use client";

import { ReactNode, useEffect, useRef, useSyncExternalStore } from "react";
import { PanelSide, columnWidth, draggedWidth, isOpen, panelStore, usePanelLayout } from "@/features/panels/panel-layout";

const subscribeResize = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
/** the window's width, following resizes */
export const useViewportWidth = (): number => useSyncExternalStore(subscribeResize, () => window.innerWidth, () => 1280);

/** One side panel: a thin header with the fold button, the panel itself (kept mounted while folded, so what it holds is not lost), and, when
 *  folded, a thin bar that opens it again. The width is set by the grid of the editor (`columnWidth`), and the edge handle (`PanelEdges`). */
export default function PanelFrame({ side, label, keyText, children }: { side: PanelSide; label: string; keyText: string; children: ReactNode }) {
  const layout = usePanelLayout();
  const vw = useViewportWidth();
  const open = isOpen(side, layout[side], vw);
  const toggle = () => panelStore.toggle(side, window.innerWidth);
  return (
    <div data-testid={`panel-${side}`} data-open={open ? "true" : "false"} className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--panel)] ${side === "left" ? "border-r" : "border-l"} border-[var(--line)]`}>
      {open && (
        <div className="flex h-6 shrink-0 items-center justify-between border-b border-[var(--line)] px-2 text-[11px] text-[var(--muted)]">
          <span className="truncate">{label}</span>
          <button type="button" data-testid={`${side}-collapse`} className="grid h-5 w-5 place-items-center rounded hover:bg-[#ebebe6]" aria-label={`${label} 접기`} title={`${label} 접기${keyText ? ` (${keyText})` : ""}`} onClick={toggle}>
            {side === "left" ? "‹" : "›"}
          </button>
        </div>
      )}
      <div className={open ? "flex min-h-0 flex-1 flex-col [&>aside]:min-h-0 [&>aside]:flex-1 [&>aside]:border-0" : "hidden"}>{children}</div>
      {!open && (
        <button type="button" data-testid={`${side}-expand`} className="flex h-full w-full cursor-pointer flex-col items-center gap-2 border-0 bg-transparent pt-2 text-[11px] text-[var(--muted)] hover:bg-[#ebebe6]" aria-label={`${label} 펴기`} title={`${label} 펴기${keyText ? ` (${keyText})` : ""}`} onClick={toggle}>
          <span aria-hidden>{side === "left" ? "›" : "‹"}</span>
          <span className="[writing-mode:vertical-rl]">{label}</span>
        </button>
      )}
    </div>
  );
}

/** the two draggable edges (6 px wide, over the border between panel and canvas): drag to change the width, double-click for the default */
export function PanelEdges({ toolWidth }: { toolWidth: number }) {
  const layout = usePanelLayout();
  const vw = useViewportWidth();
  const drag = useRef<{ side: PanelSide; x: number; width: number } | null>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (d) panelStore.setWidth(d.side, draggedWidth(d.side, d.width, e.clientX - d.x));
    };
    const up = () => (drag.current = null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);
  const edge = (side: PanelSide) => {
    if (!isOpen(side, layout[side], vw)) return null;
    const pos = side === "left" ? { left: toolWidth + columnWidth("left", layout.left, vw) - 3 } : { right: columnWidth("right", layout.right, vw) - 3 };
    return (
      <div
        key={side}
        role="separator"
        aria-orientation="vertical"
        aria-label={side === "left" ? "왼쪽 패널 폭 조절" : "오른쪽 패널 폭 조절"}
        data-testid={`resize-${side}`}
        title="끌어서 폭을 바꿉니다. 두 번 누르면 기본 폭"
        className="absolute bottom-0 top-0 z-20 w-1.5 cursor-col-resize hover:bg-[var(--accent)]/30"
        style={pos}
        onPointerDown={(e) => {
          drag.current = { side, x: e.clientX, width: layout[side].width };
          e.preventDefault();
        }}
        onDoubleClick={() => panelStore.resetWidth(side)}
      />
    );
  };
  return (
    <>
      {edge("left")}
      {edge("right")}
    </>
  );
}
