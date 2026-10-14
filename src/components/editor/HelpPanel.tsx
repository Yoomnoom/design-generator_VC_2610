"use client";

import { useEffect, useState } from "react";
import { COMMON_STUCK, HELP_ORDER, ONBOARDING, ONBOARDING_KEY, TOOL_HELP } from "@/features/help/help-content";
import { ACTION_INFO, PRESET_LABEL, formatBinding } from "@/features/shortcuts/shortcuts";
import { useBindings, usePreset } from "@/features/shortcuts/shortcut-store";

const seen = () => {
  try {
    return window.localStorage.getItem(ONBOARDING_KEY) === "1";
  } catch {
    return true; // storage blocked: do not nag
  }
};
const markSeen = () => {
  try {
    window.localStorage.setItem(ONBOARDING_KEY, "1");
  } catch {
    /* nothing to remember it with */
  }
};

/** Whether the first-use guide has not been answered yet in this browser (checked after mount, so the page and the server agree). */
export function useFirstUse(): [boolean, () => void] {
  const [first, setFirst] = useState(false);
  useEffect(() => setFirst(!seen()), []);
  return [first, () => (markSeen(), setFirst(false))];
}

/** The four steps. As a card (first use, on the start screen) it sits in the page and can be set aside; as a window it is opened from the help. */
export function OnboardingGuide({ variant, onDone }: { variant: "card" | "modal"; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === ONBOARDING.length - 1;
  const body = (
    <div data-testid="onboarding" className="rounded-[14px] border border-[var(--line)] bg-white p-4 text-left">
      <div className="mb-1 text-[11px] font-bold text-[var(--accent)]">처음이신가요? ({step + 1}/{ONBOARDING.length})</div>
      <h3 className="m-0 mb-1 text-base font-bold">{ONBOARDING[step].title}</h3>
      <p data-testid="onboarding-body" className="mb-3 text-sm text-[var(--muted)]">{ONBOARDING[step].body}</p>
      <div className="flex items-center gap-2">
        <button type="button" data-testid="onboarding-prev" className="btn mini" disabled={step === 0} onClick={() => setStep(step - 1)}>이전</button>
        {last ? (
          <button type="button" data-testid="onboarding-done" className="btn mini primary" onClick={onDone}>알겠어요</button>
        ) : (
          <button type="button" data-testid="onboarding-next" className="btn mini primary" onClick={() => setStep(step + 1)}>다음</button>
        )}
        {!last && <button type="button" data-testid="onboarding-skip" className="btn mini ml-auto" onClick={onDone}>건너뛰기</button>}
      </div>
    </div>
  );
  if (variant === "card") return body;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30" onKeyDown={(e) => e.key === "Escape" && onDone()}>
      <div role="dialog" aria-modal="true" aria-label="처음 사용 안내" className="w-[460px] max-w-[94vw]">{body}</div>
    </div>
  );
}

/** The help: every tool with what it is for, an example and the usual reasons it does not work, then the keys of the current preset. */
export default function HelpPanel({ onClose, onShowGuide }: { onClose: () => void; onShowGuide: () => void }) {
  const bindings = useBindings();
  const preset = usePreset();
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const keyOf = (id: string): string => {
    const action = TOOL_HELP[id as keyof typeof TOOL_HELP].action;
    if (!action) return "";
    const b = bindings[action as keyof typeof bindings];
    if (b) return formatBinding(b);
    if (id === "line" || id === "box" || id === "ellipse") return `${formatBinding(bindings["tool-shape"])} 반복`;
    return "없음";
  };
  const groups = ["편집", "선택·그룹", "이동·보기", "레이어 순서", "도구", "색·크기", "파일"] as const;
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/30">
      <div role="dialog" aria-modal="true" aria-labelledby="help-title" data-testid="help-panel" className="flex max-h-[90vh] w-[820px] max-w-[96vw] flex-col rounded-[14px] border border-[var(--line)] bg-white p-[18px] shadow-[var(--shadow)]">
        <div className="mb-2 flex items-center gap-2">
          <h2 id="help-title" className="m-0 flex-1 text-lg font-bold">도움말</h2>
          <button type="button" data-testid="help-guide" className="btn mini" onClick={onShowGuide}>첫 사용 안내 다시 보기</button>
          <button type="button" data-testid="help-close" className="btn mini primary" onClick={onClose}>도움말 끝내기</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto pr-1 text-sm">
          <section className="mb-4">
            <h3 className="mb-1 text-[13px] font-bold">도구와 기능</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {HELP_ORDER.map((id) => {
                const h = TOOL_HELP[id];
                const key = keyOf(id);
                return (
                  <article key={id} data-testid={`help-${id}`} className="rounded-[10px] border border-[var(--line)] bg-[var(--panel)] p-2.5">
                    <h4 className="m-0 mb-0.5 flex items-center justify-between text-[13px] font-bold">
                      <span>{h.label}</span>
                      {key && <span className="rounded border border-[var(--line)] bg-white px-1.5 py-0.5 font-mono text-[11px] font-normal">{key}</span>}
                    </h4>
                    <p className="m-0 text-xs">{h.summary}</p>
                    <p className="m-0 mt-1 text-xs text-[var(--muted)]"><b>언제:</b> {h.when}</p>
                    <p className="m-0 mt-1 text-xs text-[var(--muted)]"><b>예:</b> {h.example}</p>
                    {h.stuck && <p className="m-0 mt-1 text-xs text-[#8a5a12]"><b>막힐 때:</b> {h.stuck}</p>}
                  </article>
                );
              })}
            </div>
          </section>
          <section className="mb-4">
            <h3 className="mb-1 text-[13px] font-bold">자주 막히는 경우</h3>
            <ul data-testid="help-stuck" className="m-0 list-none p-0">
              {COMMON_STUCK.map((s) => (
                <li key={s.problem} className="mb-1.5 rounded-[10px] border border-[var(--line)] p-2 text-xs">
                  <b>{s.problem}</b>
                  <div className="text-[var(--muted)]">{s.answer}</div>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="mb-1 text-[13px] font-bold">
              지금 단축키 <span className="font-normal text-[var(--muted)]">(프리셋: {PRESET_LABEL[preset]} — 위쪽 "단축키"에서 바꿉니다)</span>
            </h3>
            <div data-testid="help-keys" className="grid gap-x-4 sm:grid-cols-2">
              {groups.map((g) => (
                <div key={g} className="mb-2">
                  <div className="text-[11px] font-bold text-[var(--muted)]">{g}</div>
                  {ACTION_INFO.filter((a) => a.group === g).map((a) => (
                    <div key={a.id} className="flex justify-between gap-2 border-b border-[#f0f0ec] py-0.5 text-xs">
                      <span>{a.label}</span>
                      <span className="font-mono">{formatBinding(bindings[a.id])}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}