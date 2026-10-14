"use client";

import { useEffect, useState } from "react";
import { TEMPLATES, TemplateId } from "@/features/assets/templates";
import { CANVAS_PRESETS, DEFAULT_CANVAS_COLOR, checkCanvasSize } from "@/lib/project/blank";
import { normalizeHex } from "@/lib/image/color";
import { TemplateThumb } from "./AssetPanel";

export type CanvasSpec = { width: number; height: number; color: string };

/** The three ways to begin: upload a capture, start from a blank canvas, start from a template. Used by the first screen and by the
 *  top bar's "new project" window. */
export default function StartChoices({ onUpload, onBlank, onTemplate }: { onUpload: () => void; onBlank: () => void; onTemplate: (id: TemplateId) => void }) {
  const card = "flex flex-col rounded-[14px] border border-[var(--line)] bg-white p-4 text-left";
  return (
    <div data-testid="start-choices" className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
      <div className={card}>
        <div className="mb-2 grid h-12 w-12 place-items-center rounded-[12px] bg-[var(--soft)] text-2xl text-[var(--accent)]" aria-hidden>⇧</div>
        <h3 className="m-0 mb-1 text-base font-bold">캡처 올리기</h3>
        <p className="mb-3 flex-1 text-xs text-[var(--muted)]">화면 캡처 속 카드·버튼·글자를 사각형으로 골라 레이어로 분리합니다. PNG · JPG.</p>
        <button data-testid="start-upload" className="btn primary" onClick={onUpload}>이미지 선택</button>
      </div>
      <div className={card}>
        <div className="mb-2 grid h-12 w-12 place-items-center rounded-[12px] bg-[var(--soft)] text-2xl text-[var(--accent)]" aria-hidden>▢</div>
        <h3 className="m-0 mb-1 text-base font-bold">빈 캔버스로 시작</h3>
        <p className="mb-3 flex-1 text-xs text-[var(--muted)]">크기와 배경색을 정해 빈 화면에서 도형·글자·소스로 직접 만듭니다.</p>
        <button data-testid="start-blank" className="btn primary" onClick={onBlank}>크기 고르기</button>
      </div>
      <div className={card}>
        <div className="mb-2 text-xs font-bold text-[var(--muted)]">&nbsp;</div>
        <h3 className="m-0 mb-1 text-base font-bold">템플릿으로 시작</h3>
        <p className="mb-2 text-xs text-[var(--muted)]">화면 하나를 골라 바로 고쳐 쓰세요.</p>
        <div className="flex gap-2">
          {TEMPLATES.map((t) => (
            <button key={t.id} data-testid={`start-template-${t.id}`} className="flex min-w-0 flex-col items-center gap-1 rounded border border-transparent p-0.5 hover:border-[var(--accent)]" title={`${t.label} — ${t.note}`} onClick={() => onTemplate(t.id)}>
              <TemplateThumb id={t.id} width={52} height={112} label={t.label} />
              <span className="w-[56px] truncate text-center text-[10px]">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Esc closes a window even when focus is still on the page behind it */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

/** Asks for a canvas size and a background colour. The size rules are the upload's: whole pixels, at most 8192 on a side. */
export function NewCanvasDialog({ onCreate, onClose }: { onCreate: (spec: CanvasSpec) => void; onClose: () => void }) {
  useEscape(onClose);
  const [width, setWidth] = useState(String(CANVAS_PRESETS[0].width));
  const [height, setHeight] = useState(String(CANVAS_PRESETS[0].height));
  const [colorText, setColorText] = useState(DEFAULT_CANVAS_COLOR);
  const size = checkCanvasSize(width, height);
  const color = normalizeHex(colorText);
  const error = !size.ok ? size.error : !color ? "배경색은 #rrggbb 형식으로 입력해 주세요." : null;
  const preset = CANVAS_PRESETS.find((p) => String(p.width) === width && String(p.height) === height)?.id ?? "custom";
  const input = "w-24 rounded border border-[var(--line)] bg-white px-2 py-1";

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/30" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-title"
        data-testid="new-canvas-dialog"
        className="w-[420px] rounded-[14px] border border-[var(--line)] bg-white p-[18px] shadow-[var(--shadow)]"
        onSubmit={(e) => {
          e.preventDefault();
          if (size.ok && color) onCreate({ width: size.width, height: size.height, color });
        }}
      >
        <h2 id="canvas-title" className="m-0 mb-1 text-lg font-bold">빈 캔버스</h2>
        <p className="mb-3 text-xs text-[var(--muted)]">PNG로 내보내면 여기서 정한 크기 그대로 나옵니다.</p>
        <div className="mb-3 grid grid-cols-4 gap-1.5">
          {CANVAS_PRESETS.map((p) => (
            <button key={p.id} type="button" data-testid={`canvas-preset-${p.id}`} aria-pressed={preset === p.id} className="btn mini flex-col aria-pressed:border-[var(--accent)] aria-pressed:bg-[var(--soft)]" onClick={() => { setWidth(String(p.width)); setHeight(String(p.height)); }}>
              <b className="block">{p.label}</b>
              <span className="text-[10px] text-[var(--muted)]">{p.width}×{p.height}</span>
            </button>
          ))}
          <button type="button" data-testid="canvas-preset-custom" aria-pressed={preset === "custom"} className="btn mini flex-col aria-pressed:border-[var(--accent)] aria-pressed:bg-[var(--soft)]" onClick={() => document.getElementById("canvas-width")?.focus()}>
            <b className="block">직접 입력</b>
            <span className="text-[10px] text-[var(--muted)]">최대 8192</span>
          </button>
        </div>
        <div className="mb-3 flex items-center gap-2 text-sm">
          <label className="flex items-center gap-1">가로 <input id="canvas-width" data-testid="canvas-width" inputMode="numeric" className={input} value={width} onChange={(e) => setWidth(e.target.value)} /></label>
          <span>×</span>
          <label className="flex items-center gap-1">세로 <input data-testid="canvas-height" inputMode="numeric" className={input} value={height} onChange={(e) => setHeight(e.target.value)} /></label>
          <span className="text-xs text-[var(--muted)]">px</span>
        </div>
        <div className="mb-3 flex items-center gap-2 text-sm">
          <label className="flex items-center gap-2 whitespace-nowrap">
            배경색
            <input data-testid="canvas-color" type="color" value={color ?? "#ffffff"} onChange={(e) => setColorText(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-[var(--line)] bg-white p-0.5" />
          </label>
          <input data-testid="canvas-color-text" className={input} value={colorText} onChange={(e) => setColorText(e.target.value)} aria-label="배경색 코드" />
          <span className="text-[11px] leading-tight text-[var(--muted)]">나중에 &quot;배경 채움&quot;으로 변경</span>
        </div>
        {error && (
          <p role="alert" data-testid="canvas-error" className="mb-3 text-xs text-[#b3361b]">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" data-testid="canvas-cancel" className="btn" onClick={onClose}>취소</button>
          <button type="submit" data-testid="canvas-create" className="btn primary" disabled={!!error}>만들기</button>
        </div>
      </form>
    </div>
  );
}

/** the top bar's "new project" window: the same three ways to begin */
export function StartDialog({ onClose, ...choices }: { onClose: () => void; onUpload: () => void; onBlank: () => void; onTemplate: (id: TemplateId) => void }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/30" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="start-title" data-testid="start-dialog" className="max-h-[90vh] w-[720px] max-w-[94vw] overflow-auto rounded-[14px] border border-[var(--line)] bg-[var(--panel)] p-[18px] shadow-[var(--shadow)]">
        <h2 id="start-title" className="m-0 mb-3 text-lg font-bold">새 프로젝트</h2>
        <StartChoices {...choices} />
        <div className="mt-3 flex justify-end">
          <button data-testid="start-close" className="btn" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
