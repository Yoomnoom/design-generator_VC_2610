"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_STROKE_WIDTH } from "@/lib/image/vector";

/** A colour field. Dragging inside the picker only changes what the swatch shows; the colour is handed on when the picker settles
 *  (the browser's `change` event), so one colour choice is one edit. */
export function ColorField({ label, value, disabled, testId, onCommit }: { label: string; value: string; disabled?: boolean; testId: string; onCommit: (hex: string) => void }) {
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => setDraft(value), [value]); // follows undo/redo and the eyedropper
  useEffect(() => {
    const el = input.current!;
    const onChange = () => commit.current(el.value);
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-12 shrink-0 font-bold">{label}</span>
      <input ref={input} data-testid={testId} type="color" disabled={disabled} value={draft} onChange={(e) => setDraft(e.target.value)} className="h-7 w-10 cursor-pointer rounded border border-[var(--line)] bg-white p-0.5 disabled:cursor-not-allowed disabled:opacity-45" />
      <span className="font-mono text-[var(--muted)]">{draft}</span>
    </label>
  );
}

/** Stroke width. Typing changes nothing; Enter or leaving the field commits (so typing "12" is not an edit to "1" and then "12"). */
export function WidthField({ value, disabled, testId, onCommit }: { value: number; disabled?: boolean; testId: string; onCommit: (width: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const cancelled = useRef(false);
  useEffect(() => setDraft(String(value)), [value]);
  const finish = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n)) return setDraft(String(value));
    onCommit(Math.min(Math.max(n, 0), MAX_STROKE_WIDTH));
  };
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-12 shrink-0 font-bold">굵기</span>
      <input
        data-testid={testId}
        type="number"
        min={0}
        max={MAX_STROKE_WIDTH}
        step={1}
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            cancelled.current = true;
            setDraft(String(value));
            e.currentTarget.blur();
          }
        }}
        className="h-7 w-16 rounded border border-[var(--line)] bg-white px-1.5 disabled:cursor-not-allowed disabled:opacity-45"
      />
      <span className="text-[var(--muted)]">px</span>
    </label>
  );
}
