"use client";

import { selectScreen } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";

/** The list of memos: which pin is which, and a way to pick one (its balloon then opens on the canvas). */
export default function MemoPanel() {
  const memos = useEditorStore(selectScreen)?.memos ?? [];
  const selected = useEditorStore((s) => s.selectedMemoId);
  const comparing = useEditorStore((s) => s.compareMode !== "off");
  if (!memos.length) return null;
  return (
    <section aria-label="메모" className="border-b border-[var(--line)] px-3.5 py-3">
      <h3 className="m-0 mb-2 text-xs font-bold">
        메모 <span className="font-normal text-[#999]" data-testid="memo-count">{memos.length}</span>
      </h3>
      <ul className="m-0 grid list-none gap-1 p-0" data-testid="memo-list">
        {memos.map((m, i) => (
          <li key={m.id}>
            <button
              type="button"
              data-testid="memo-item"
              aria-pressed={selected === m.id}
              disabled={comparing}
              onClick={() => editorStore.getState().selectMemo(m.id)}
              className="flex w-full cursor-pointer items-baseline gap-2 rounded border border-transparent bg-transparent px-1.5 py-1 text-left text-xs hover:bg-[#f3f1ec] aria-pressed:border-[var(--accent)] aria-pressed:bg-[var(--soft)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span className="font-bold">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{m.text.trim() ? m.text.split("\n")[0] : <em className="text-[#999]">비어 있음</em>}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
