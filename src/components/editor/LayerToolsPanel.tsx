"use client";

import { useEffect, useRef, useState } from "react";
import { AlignKind } from "@/features/align/align";
import { BitmapLayer, BlendMode } from "@/lib/project/schema";
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
    <div data-testid="align-panel" className="grid gap-1.5 text-xs">
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