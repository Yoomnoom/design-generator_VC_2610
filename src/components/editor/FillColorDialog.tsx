"use client";

import { useState } from "react";
import { editorStore, useEditorStore } from "@/store/use-editor-store";

/** Shown when the colours around a selection vary too much to guess a background.
 *  Choosing a colour extracts; cancelling cancels the whole extraction. */
export default function FillColorDialog() {
  const pending = useEditorStore((s) => s.pendingExtraction);
  if (!pending) return null;
  return <Form key={JSON.stringify(pending.rect)} suggestedHex={pending.suggestedHex} width={pending.rect.width} height={pending.rect.height} />;
}

function Form({ suggestedHex, width, height }: { suggestedHex: string | null; width: number; height: number }) {
  const [hex, setHex] = useState(suggestedHex ?? "#ffffff");
  const cancel = () => editorStore.getState().cancelExtraction();
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/30" onKeyDown={(e) => e.key === "Escape" && cancel()}>
      <div role="dialog" aria-modal="true" aria-labelledby="fill-title" className="w-[400px] rounded-[14px] border border-[var(--line)] bg-white p-[18px] shadow-[var(--shadow)]">
        <h2 id="fill-title" className="m-0 mb-1 text-lg font-bold">
          배경색을 골라주세요
        </h2>
        <p className="mb-4 text-xs text-[var(--muted)]">
          선택 영역({width} × {height} px) 주변 색이 한 가지가 아니어서 자동으로 채우지 않았습니다. 추출한 뒤 빈자리를 채울 색을 직접 정해주세요.
        </p>
        <label className="mb-4 flex items-center gap-3 text-sm">
          <input data-testid="fill-color" type="color" value={hex} onChange={(e) => setHex(e.target.value)} className="h-9 w-14 cursor-pointer rounded border border-[var(--line)] bg-white p-0.5" autoFocus />
          <span data-testid="fill-hex" className="font-mono">
            {hex}
          </span>
          {suggestedHex && <span className="text-xs text-[var(--muted)]">(주변에서 가장 가까운 색으로 시작)</span>}
        </label>
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={cancel}>
            취소 (추출 안 함)
          </button>
          <button className="btn primary" onClick={() => editorStore.getState().confirmExtraction(hex)}>
            이 색으로 추출
          </button>
        </div>
      </div>
    </div>
  );
}
