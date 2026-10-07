"use client";

import { useStore } from "zustand";
import { getAutosave } from "@/features/autosave/browser-autosave";
import { selectProject } from "@/store/editor-store";
import { useEditorStore } from "@/store/use-editor-store";

const clock = (ms: number) => new Date(ms).toLocaleTimeString("ko-KR", { hour12: false });

/** the small status in the footer */
export function AutosaveFooter() {
  const s = useStore(getAutosave().state);
  const hasProject = !!useEditorStore(selectProject);
  let text = "";
  if (s.ownership === "other-tab") text = "자동 저장 꺼짐 · 다른 탭에서 열려 있습니다";
  else if (s.ownership === "owner") {
    if (s.error) text = `자동 저장 실패: ${s.error}`;
    else if (s.saving) text = "자동 저장 중…";
    else if (s.savedAt) text = `자동 저장됨 ${clock(s.savedAt)}`;
    else if (hasProject) text = "자동 저장 대기 중";
  }
  return (
    <span data-testid="autosave-status" data-ownership={s.ownership} data-ready={s.ready ? "yes" : "no"} data-candidate={s.candidate ? "yes" : "no"} data-saving={s.saving ? "yes" : "no"} data-saved-at={s.savedAt ?? 0} className="mx-auto px-2">
      {text}
    </span>
  );
}

/** Strips above the work area for what the user must know about saving: another tab is open, or a save failed. */
export function AutosaveBanners() {
  const s = useStore(getAutosave().state);
  return (
    <>
      {s.ownership === "other-tab" && (
        <div role="status" data-testid="autosave-banner" className="border-b border-[#ead9a2] bg-[#fff4d6] px-4 py-2 text-[13px] text-[#6b5516]">
          이 앱이 다른 탭에서도 열려 있어서 <b>이 탭은 자동 저장하지 않습니다.</b> 이 탭의 작업은 &ldquo;프로젝트 저장&rdquo;으로 파일에 저장해 주세요. 다른 탭을 닫으면 자동 저장이 이어집니다.
        </div>
      )}
      {s.ownership === "owner" && s.error && (
        <div role="alert" data-testid="autosave-error" className="border-b border-[#f0c4bb] bg-[#fdebe7] px-4 py-2 text-[13px] text-[#8c2a14]">
          자동 저장에 실패했습니다: {s.error}. 작업이 사라지지 않도록 &ldquo;프로젝트 저장&rdquo;으로 파일에 저장해 주세요.
        </div>
      )}
    </>
  );
}
