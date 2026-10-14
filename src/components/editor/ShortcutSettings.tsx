"use client";

import { useEffect, useState } from "react";
import { ACTION_INFO, ConfigurableAction, bindingOf, formatBinding } from "@/features/shortcuts/shortcuts";
import { shortcutStore, useBindings } from "@/features/shortcuts/shortcut-store";

const GROUPS = ["편집", "선택·그룹", "이동", "도구"] as const;

/** keys that cannot be changed: they belong to a gesture or to the browser */
const FIXED: { keys: string; what: string }[] = [
  { keys: "Ctrl+V", what: "붙여넣기 (클립보드에 이미지가 있을 때)" },
  { keys: "Enter / Esc", what: "후보 추출·변형 확정 / 후보·변형 취소, 선택 해제" },
  { keys: "Ctrl+클릭", what: "선택에 더하기·빼기 (캔버스와 레이어 패널)" },
  { keys: "Shift+클릭", what: "레이어 패널: 범위 선택 · 캔버스: 선택에 더하기" },
  { keys: "빈 곳 클릭", what: "선택 해제" },
  { keys: "Alt (끄는 동안)", what: "스냅 끄기" },
  { keys: "Ctrl+Y", what: "다시 실행 (다시 실행이 기본 키일 때)" },
];

/** The shortcut window: every key by function. Click a key, press the new one. A key that is reserved by the browser or used by another
 *  function is refused with the reason (nothing is swapped silently). Stored in this browser only, never in a project. */
export default function ShortcutSettings({ onClose }: { onClose: () => void }) {
  const bindings = useBindings();
  const [capturing, setCapturing] = useState<ConfigurableAction | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (capturing) {
        // everything is taken while a key is awaited, so the keys being pressed do not run the editor or the browser
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") return setCapturing(null);
        if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return; // wait for the real key
        const result = shortcutStore.set(capturing, bindingOf(e));
        const label = ACTION_INFO.find((a) => a.id === capturing)!.label;
        setMessage(result.ok ? { kind: "ok", text: `"${label}" 키를 ${formatBinding(bindingOf(e))}(으)로 바꿨습니다.` } : { kind: "error", text: result.reason });
        setCapturing(null);
        return;
      }
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, onClose]);

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/30">
      <div role="dialog" aria-modal="true" aria-labelledby="shortcut-title" data-testid="shortcut-settings" className="flex max-h-[88vh] w-[560px] max-w-[94vw] flex-col rounded-[14px] border border-[var(--line)] bg-white p-[18px] shadow-[var(--shadow)]">
        <h2 id="shortcut-title" className="m-0 mb-1 text-lg font-bold">단축키</h2>
        <p className="mb-3 text-xs text-[var(--muted)]">키를 누르면 새 키를 입력할 수 있습니다. 이 브라우저에만 저장되고 프로젝트 파일에는 들어가지 않습니다.</p>
        <div className="min-h-0 flex-1 overflow-auto pr-1">
          {GROUPS.map((g) => (
            <section key={g} className="mb-3">
              <h3 className="mb-1 text-[13px] font-bold">{g}</h3>
              <ul className="m-0 list-none p-0">
                {ACTION_INFO.filter((a) => a.group === g).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 border-b border-[#f0f0ec] py-1 text-sm">
                    <span>{a.label}</span>
                    <button
                      type="button"
                      data-testid={`shortcut-${a.id}`}
                      aria-label={`${a.label} 키: ${formatBinding(bindings[a.id])}`}
                      aria-pressed={capturing === a.id}
                      className="btn mini min-w-[110px] font-mono"
                      onClick={() => {
                        setMessage(null);
                        setCapturing(capturing === a.id ? null : a.id);
                      }}
                    >
                      {capturing === a.id ? "키를 누르세요…" : formatBinding(bindings[a.id])}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section className="mb-2">
            <h3 className="mb-1 text-[13px] font-bold">바꿀 수 없는 키</h3>
            <ul className="m-0 list-none p-0 text-xs text-[var(--muted)]">
              {FIXED.map((f) => (
                <li key={f.keys} className="flex justify-between gap-2 border-b border-[#f0f0ec] py-0.5">
                  <span className="font-mono">{f.keys}</span>
                  <span className="text-right">{f.what}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <div className="mt-2 min-h-[20px]" aria-live="polite">
          {message && (
            <p role={message.kind === "error" ? "alert" : "status"} data-testid="shortcut-message" className={`text-xs ${message.kind === "error" ? "text-[#b3361b]" : "text-[#2f7952]"}`}>
              {message.text}
            </p>
          )}
        </div>
        <div className="mt-2 flex justify-between">
          <button type="button" data-testid="shortcut-reset" className="btn" onClick={() => { shortcutStore.reset(); setCapturing(null); setMessage({ kind: "ok", text: "모든 단축키를 기본값으로 되돌렸습니다." }); }}>
            기본값으로 되돌리기
          </button>
          <button type="button" data-testid="shortcut-close" className="btn primary" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
