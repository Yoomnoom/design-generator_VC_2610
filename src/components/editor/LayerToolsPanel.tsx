"use client";

import { useEffect, useRef, useState } from "react";
import { AlignKind } from "@/features/align/align";
import { BitmapLayer, BlendMode, LayerEffects } from "@/lib/project/schema";
import { editorStore, useEditorStore } from "@/store/use-editor-store";

/** Opacity: dragging the slider shows the result on the canvas without writing history; letting go (or Enter in the number box) is ONE undo step. */
export function OpacityField({ layer, disabled }: { layer: BitmapLayer; disabled: boolean }) {
  const stored = Math.round(layer.opacity * 100);
  const [value, setValue] = useState(stored);
  const dirty = useRef(false);
  useEffect(() => {
    setValue(stored);
    dirty.current = false;
  }, [stored, layer.id]);
  useEffect(() => () => editorStore.getState().setOpacityPreview(null), [layer.id]);
  const clamp = (v: number) => Math.min(Math.max(Number.isFinite(v) ? Math.round(v) : 100, 0), 100);
  const preview = (v: number) => {
    const p = clamp(v);
    setValue(p);
    dirty.current = true;
    editorStore.getState().setOpacityPreview({ layerId: layer.id, opacity: p / 100 });
  };
  const commit = () => {
    if (!dirty.current) return;
    dirty.current = false;
    const st = editorStore.getState();
    st.setLayerOpacity(layer.id, clamp(value) / 100);
    st.setOpacityPreview(null);
  };
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-14 shrink-0">불투명도</span>
      <input data-testid="opacity-range" type="range" aria-label="불투명도" min={0} max={100} step={1} value={value} disabled={disabled} onChange={(e) => preview(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} className="min-w-0 flex-1" />
      <input data-testid="opacity-num" type="number" aria-label="불투명도 숫자" min={0} max={100} value={value} disabled={disabled} onChange={(e) => preview(e.target.value === "" ? 0 : Number(e.target.value))} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} className="w-14 rounded border border-[var(--line)] bg-white px-1 py-0.5" />
      <span className="text-[var(--muted)]">%</span>
    </div>
  );
}

const BLEND_LABEL: Record<string, string> = { "": "보통", multiply: "곱하기", screen: "스크린", overlay: "오버레이", darken: "어둡게", lighten: "밝게" };

export function BlendSelect({ layer, disabled }: { layer: BitmapLayer; disabled: boolean }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-14 shrink-0">혼합 모드</span>
      <select data-testid="blend-select" aria-label="혼합 모드" disabled={disabled} value={layer.blend ?? ""} onChange={(e) => editorStore.getState().setLayerBlend(layer.id, (e.target.value || null) as BlendMode | null)} className="min-w-0 flex-1 rounded border border-[var(--line)] bg-white px-1 py-1">
        {Object.entries(BLEND_LABEL).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
    </label>
  );
}

export function FlipButtons({ layer, disabled }: { layer: BitmapLayer; disabled: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-14 shrink-0">뒤집기</span>
      <button type="button" data-testid="flip-x" className="btn mini" disabled={disabled} title="좌우로 뒤집습니다 (레이어 자신의 가로축 기준)" onClick={() => editorStore.getState().flipLayer(layer.id, "x")}>↔ 좌우</button>
      <button type="button" data-testid="flip-y" className="btn mini" disabled={disabled} title="상하로 뒤집습니다 (레이어 자신의 세로축 기준)" onClick={() => editorStore.getState().flipLayer(layer.id, "y")}>↕ 상하</button>
    </div>
  );
}

const ALIGN: { kind: AlignKind; label: string; title: string }[] = [
  { kind: "left", label: "⇤", title: "왼쪽 맞춤" },
  { kind: "hcenter", label: "↔", title: "가로 가운데 맞춤" },
  { kind: "right", label: "⇥", title: "오른쪽 맞춤" },
  { kind: "top", label: "⤒", title: "위쪽 맞춤" },
  { kind: "vcenter", label: "↕", title: "세로 가운데 맞춤" },
  { kind: "bottom", label: "⤓", title: "아래쪽 맞춤" },
];

/** Align (several chosen: to each other; one: to the frame) and distribute (three or more). A group counts as one. */
export function AlignButtons({ disabled }: { disabled: boolean }) {
  const count = useEditorStore((s) => s.selectedLayerIds.length);
  const how = count > 1 ? "선택한 것끼리" : "화면(프레임) 기준";
  return (
    <div data-testid="align-panel" className="grid grid-cols-[minmax(0,1fr)] gap-1.5 text-xs">
      <div className="font-bold">정렬 <span className="font-normal text-[var(--muted)]">({how})</span></div>
      <div className="grid grid-cols-6 gap-1">
        {ALIGN.map((a) => (
          <button key={a.kind} type="button" data-testid={`align-${a.kind}`} className="btn mini px-0" disabled={disabled || count === 0} title={`${a.title} — ${how}`} aria-label={a.title} onClick={() => editorStore.getState().alignSelected(a.kind)}>
            {a.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1">
        <button type="button" data-testid="distribute-x" className="btn mini" disabled={disabled || count < 3} title="가로 간격을 같게 (3개 이상, 그룹은 하나로 셈)" onClick={() => editorStore.getState().distributeSelected("x")}>가로 간격 같게</button>
        <button type="button" data-testid="distribute-y" className="btn mini" disabled={disabled || count < 3} title="세로 간격을 같게 (3개 이상, 그룹은 하나로 셈)" onClick={() => editorStore.getState().distributeSelected("y")}>세로 간격 같게</button>
      </div>
    </div>
  );
}
const DEFAULT_SHADOW = { on: true, color: "#000000", dx: 6, dy: 6, blur: 8, opacity: 0.5 };
const DEFAULT_STROKE = { on: true, color: "#ffffff", width: 3, position: "outside" as const };
const DEFAULT_OVERLAY = { on: true, color: "#4f46e5", opacity: 0.5 };

/** Layer effects: a drop shadow, an outline and a colour overlay. Values stay when an effect is switched off. Every change is one undo step. */
export function EffectsFields({ layer, disabled }: { layer: BitmapLayer; disabled: boolean }) {
  const fx = layer.effects ?? {};
  const set = (next: LayerEffects) => editorStore.getState().setLayerEffects(layer.id, next);
  const num = (testId: string, label: string, value: number, apply: (v: number) => void, min: number, max: number, step = 1) => (
    <label className="flex items-center gap-1 text-[11px]">
      <span className="w-9 shrink-0 text-[var(--muted)]">{label}</span>
      <input
        key={`${testId}-${value}`}
        data-testid={testId}
        type="number"
        min={min}
        max={max}
        step={step}
        defaultValue={value}
        disabled={disabled}
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v !== value) apply(Math.min(Math.max(v, min), max));
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="min-w-0 flex-1 rounded border border-[var(--line)] bg-white px-1 py-0.5"
      />
    </label>
  );
  const color = (testId: string, value: string, apply: (v: string) => void) => (
    <input data-testid={testId} type="color" aria-label="색" value={value} disabled={disabled} onChange={(e) => apply(e.target.value)} className="h-6 w-8 shrink-0 cursor-pointer rounded border border-[var(--line)] bg-white p-0.5" />
  );
  const head = (testId: string, label: string, on: boolean, toggle: (on: boolean) => void) => (
    <label className="flex items-center gap-1.5 text-xs font-bold">
      <input data-testid={testId} type="checkbox" checked={on} disabled={disabled} onChange={(e) => toggle(e.target.checked)} />
      {label}
    </label>
  );
  const sh = fx.shadow ?? { ...DEFAULT_SHADOW, on: false };
  const st = fx.stroke ?? { ...DEFAULT_STROKE, on: false };
  const ov = fx.overlay ?? { ...DEFAULT_OVERLAY, on: false };
  return (
    <details data-testid="fx-panel" className="rounded border border-[var(--line)] bg-white px-2 py-1.5" open={!!layer.effects}>
      <summary className="cursor-pointer text-xs font-bold">효과 {layer.effects ? "(켜짐)" : ""}</summary>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2.5">
        <div className="grid gap-1">
          <div className="flex items-center justify-between">
            {head("fx-shadow-on", "그림자", sh.on, (on) => set({ ...fx, shadow: { ...sh, on } }))}
            {color("fx-shadow-color", sh.color, (c) => set({ ...fx, shadow: { ...sh, color: c } }))}
          </div>
          <div className="grid grid-cols-2 gap-1">
            {num("fx-shadow-dx", "가로", sh.dx, (v) => set({ ...fx, shadow: { ...sh, dx: v } }), -500, 500)}
            {num("fx-shadow-dy", "세로", sh.dy, (v) => set({ ...fx, shadow: { ...sh, dy: v } }), -500, 500)}
            {num("fx-shadow-blur", "흐림", sh.blur, (v) => set({ ...fx, shadow: { ...sh, blur: v } }), 0, 100)}
            {num("fx-shadow-opacity", "투명", Math.round(sh.opacity * 100), (v) => set({ ...fx, shadow: { ...sh, opacity: v / 100 } }), 0, 100)}
          </div>
        </div>
        <div className="grid gap-1">
          <div className="flex items-center justify-between">
            {head("fx-stroke-on", "외곽선", st.on, (on) => set({ ...fx, stroke: { ...st, on } }))}
            {color("fx-stroke-color", st.color, (c) => set({ ...fx, stroke: { ...st, color: c } }))}
          </div>
          <div className="grid grid-cols-2 gap-1">
            {num("fx-stroke-width", "두께", st.width, (v) => set({ ...fx, stroke: { ...st, width: v } }), 0, 60)}
            <select data-testid="fx-stroke-position" aria-label="외곽선 위치" disabled={disabled} value={st.position} onChange={(e) => set({ ...fx, stroke: { ...st, position: e.target.value as "outside" | "inside" | "center" } })} className="min-w-0 rounded border border-[var(--line)] bg-white px-1 text-[11px]">
              <option value="outside">바깥</option>
              <option value="center">가운데</option>
              <option value="inside">안쪽</option>
            </select>
          </div>
        </div>
        <div className="grid gap-1">
          <div className="flex items-center justify-between">
            {head("fx-overlay-on", "색상 오버레이", ov.on, (on) => set({ ...fx, overlay: { ...ov, on } }))}
            {color("fx-overlay-color", ov.color, (c) => set({ ...fx, overlay: { ...ov, color: c } }))}
          </div>
          {num("fx-overlay-opacity", "투명", Math.round(ov.opacity * 100), (v) => set({ ...fx, overlay: { ...ov, opacity: v / 100 } }), 0, 100)}
        </div>
        <button type="button" data-testid="fx-clear" className="btn mini" disabled={disabled || !layer.effects} onClick={() => editorStore.getState().setLayerEffects(layer.id, null)}>효과 모두 지우기</button>
      </div>
    </details>
  );
}