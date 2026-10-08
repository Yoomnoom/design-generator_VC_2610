"use client";

import { useEffect, useRef, useState } from "react";
import { imageToClient } from "@/lib/geometry/coords";
import { MAX_MEMO_LENGTH, Memo } from "@/lib/project/schema";
import { selectScreen } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";

const PIN = 24;
const BALLOON_WIDTH = 224;
/** a press that moves less than this (screen pixels) is a click, not a drag */
const DRAG_SLOP = 3;

/** The memo pins on the canvas, and the open balloon of the selected one. They are HTML on top of the canvas, anchored to image points,
 *  so they stay the same size at any zoom. Not drawn while comparing: the original has no memos, and nothing may be edited then. */
export default function MemoLayer() {
  const screen = useEditorStore(selectScreen);
  const view = useEditorStore((s) => s.view);
  const compare = useEditorStore((s) => s.compareMode);
  const selectedId = useEditorStore((s) => s.selectedMemoId);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  if (!screen?.memos?.length || compare !== "off") return null;

  const origin = { x: screen.x, y: screen.y };
  const placed = (m: Memo) => (drag?.id === m.id ? { x: drag.x, y: drag.y } : m);
  const room = wrap.current?.clientWidth ?? Infinity;

  return (
    <div ref={wrap} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" data-testid="memo-layer">
      {screen.memos.map((m, i) => {
        const p = imageToClient(placed(m), { x: 0, y: 0 }, view, origin);
        return (
          <Pin
            key={m.id}
            memo={m}
            number={i + 1}
            at={p}
            selected={m.id === selectedId}
            onDrag={(point) => setDrag(point ? { id: m.id, ...point } : null)}
            dragging={drag?.id === m.id}
            drop={() => {
              if (drag?.id === m.id) editorStore.getState().moveMemo(m.id, drag.x, drag.y);
              setDrag(null);
            }}
          />
        );
      })}
      {screen.memos.map((m, i) => {
        if (m.id !== selectedId) return null;
        const p = imageToClient(placed(m), { x: 0, y: 0 }, view, origin);
        const left = Math.max(4, Math.min(p.x + PIN / 2 + 6, room - BALLOON_WIDTH - 4));
        return <Balloon key={m.id} memo={m} number={i + 1} left={left} top={Math.max(4, p.y - PIN / 2)} />;
      })}
    </div>
  );
}

function Pin({ memo, number, at, selected, dragging, onDrag, drop }: { memo: Memo; number: number; at: { x: number; y: number }; selected: boolean; dragging: boolean; onDrag: (p: { x: number; y: number } | null) => void; drop: () => void }) {
  const start = useRef<{ cx: number; cy: number; x: number; y: number; moved: boolean } | null>(null);
  const view = useEditorStore((s) => s.view);
  return (
    <button
      type="button"
      data-testid="memo-pin"
      data-memo-id={memo.id}
      data-selected={selected ? "yes" : "no"}
      aria-label={`메모 ${number}${memo.text ? `: ${memo.text}` : ""}`}
      title={memo.text || `메모 ${number}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { cx: e.clientX, cy: e.clientY, x: memo.x, y: memo.y, moved: false };
        editorStore.getState().selectMemo(memo.id);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        if (!s.moved && Math.hypot(e.clientX - s.cx, e.clientY - s.cy) < DRAG_SLOP) return;
        s.moved = true;
        // a drag is measured in screen pixels and turned into image pixels, so it is the same distance at any zoom
        onDrag({ x: s.x + (e.clientX - s.cx) / view.zoom, y: s.y + (e.clientY - s.cy) / view.zoom });
      }}
      onPointerUp={() => {
        const s = start.current;
        start.current = null;
        if (s?.moved) drop();
        else onDrag(null);
      }}
      onPointerCancel={() => {
        start.current = null;
        onDrag(null);
      }}
      className={`pointer-events-auto absolute grid cursor-grab place-items-center rounded-full border-2 border-white p-0 text-xs font-bold text-white shadow-md ${selected ? "bg-[var(--accent)] ring-2 ring-[var(--accent)]" : "bg-[#e5322d]"} ${dragging ? "cursor-grabbing" : ""}`}
      style={{ left: at.x - PIN / 2, top: at.y - PIN / 2, width: PIN, height: PIN, touchAction: "none" }}
    >
      {number}
    </button>
  );
}

/** The balloon of the selected memo: its words, editable. Typing changes nothing until the box is left (one undo step); Esc puts the old
 *  words back. Delete removes the memo. */
function Balloon({ memo, number, left, top }: { memo: Memo; number: number; left: number; top: number }) {
  const [draft, setDraft] = useState(memo.text);
  const cancelled = useRef(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(memo.text), [memo.text]); // follows undo and redo
  useEffect(() => box.current?.focus(), [memo.id]);
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (draft !== memo.text) editorStore.getState().setMemoText(memo.id, draft);
  };
  return (
    <div
      data-testid="memo-balloon"
      className="pointer-events-auto absolute rounded-[10px] border border-[var(--accent)] bg-[#fffbe6] p-2 shadow-lg"
      style={{ left, top, width: BALLOON_WIDTH }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-1 flex items-center justify-between text-xs font-bold">
        <span>메모 {number}</span>
        <button type="button" data-testid="memo-delete" className="btn mini" onClick={() => editorStore.getState().deleteMemo(memo.id)}>
          삭제
        </button>
      </div>
      <textarea
        ref={box}
        data-testid="memo-text"
        aria-label={`메모 ${number} 내용`}
        rows={3}
        maxLength={MAX_MEMO_LENGTH}
        value={draft}
        placeholder="메모를 입력하세요"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            cancelled.current = true;
            setDraft(memo.text);
            e.currentTarget.blur();
          }
        }}
        className="w-full resize-none rounded border border-[var(--line)] bg-white p-1.5 text-xs"
      />
      <p className="m-0 mt-1 text-[11px] text-[var(--muted)]">편집용 메모입니다. PNG에는 내보내기에서 &quot;메모 포함&quot;을 켰을 때만 들어갑니다.</p>
    </div>
  );
}
