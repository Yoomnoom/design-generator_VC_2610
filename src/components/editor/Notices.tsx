"use client";

import { useEditorStore } from "@/store/use-editor-store";
import { editorStore } from "@/store/use-editor-store";

/** Strips between the top bar and the work area for things the user must be told. Nothing here can cover the canvas. */
export default function Notices({ extra }: { extra?: React.ReactNode }) {
  const notice = useEditorStore((s) => s.notice);
  return (
    <div className="shrink-0" data-testid="notices">
      {notice && (
        <div role="alert" data-testid="notice" className="flex items-start gap-3 border-b border-[#ead9a2] bg-[#fff4d6] px-4 py-2 text-[13px] text-[#6b5516]">
          <span className="flex-1">{notice}</span>
          <button className="btn mini" onClick={() => editorStore.getState().setNotice(null)}>
            닫기
          </button>
        </div>
      )}
      {extra}
    </div>
  );
}
