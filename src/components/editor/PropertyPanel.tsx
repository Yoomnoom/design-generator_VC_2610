"use client";

import { useEffect, useRef, useState } from "react";
import { isOnlyMoved, scaledSize } from "@/lib/geometry/layer-transform";
import { MAX_LAYER_NAME, selectScreen } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";
import { BitmapLayer, LayerContent, TextContent } from "@/lib/project/schema";
import { MAX_FONT_SIZE, MAX_TEXT_LENGTH, MIN_FONT_SIZE } from "@/lib/image/text-layout";
import { SHAPE_LABEL, maxCornerRadius } from "@/lib/image/vector";
import { ColorField, WidthField } from "./StyleFields";
import SourceEditPanel from "./SourceEditPanel";
import { AdjustFields, AlignButtons, BlendSelect, EffectsFields, FlipButtons, MergeButtons, OpacityField } from "./LayerToolsPanel";
import { canStretch, selectionBox } from "@/features/free-transform/free-transform";
import { ImageCache } from "@/store/images";
import { useBindings } from "@/features/shortcuts/shortcut-store";
import { formatBinding } from "@/features/shortcuts/shortcuts";


/** 240, 12.5, 33.33: whole numbers without decimals, others to at most two places */
const fmt = (n: number) => String(Number(n.toFixed(2)));

/** the button that turns the free-transform box on (for one layer; with two or more it is always shown) */
export function FreeTransformButton({ disabled }: { disabled: boolean }) {
  const on = useEditorStore((s) => s.freeTransform);
  const key = formatBinding(useBindings()["free-transform"]);
  return (
    <button type="button" data-testid="ft-toggle" aria-pressed={on} disabled={disabled} className="btn mini w-full aria-pressed:bg-[var(--accent)] aria-pressed:text-white" title={`선택한 레이어 전체를 감싸는 변형 상자를 켜고 끕니다. 모서리·변은 크기, 위쪽 둥근 점은 회전입니다. Shift = 비율 유지, Alt = 중심 기준, Enter = 끝내기, Esc = 취소 (${key})`} onClick={() => editorStore.getState().setFreeTransform(!on)}>
      자유 변형
    </button>
  );
}

/** X, Y, width, height (with a ratio lock) and a turn for the whole selection. Each entry is ONE free transform, one undo step. */
export function FreeTransformFields({ layers, images, disabled }: { layers: BitmapLayer[]; images: ImageCache; disabled: boolean }) {
  const box = selectionBox(layers, (l) => (l.imageId ? images.get(l.imageId)?.raw : undefined));
  const stretch = canStretch(layers);
  const [lock, setLock] = useState(true);
  const [draft, setDraft] = useState({ x: "", y: "", w: "", h: "", rot: "0" });
  const key = box ? `${box.x}|${box.y}|${box.width}|${box.height}` : "";
  useEffect(() => {
    if (box) setDraft({ x: String(Math.round(box.x * 100) / 100), y: String(Math.round(box.y * 100) / 100), w: String(Math.round(box.width * 100) / 100), h: String(Math.round(box.height * 100) / 100), rot: "0" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follows the box itself
  }, [key]);
  if (!box) return null;
  const num = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));
  const keepLocked = lock || !stretch;
  const apply = (field: "x" | "y" | "w" | "h" | "rot") => {
    const v = num(draft[field]);
    const st = editorStore.getState();
    const reset = () => setDraft((d) => ({ ...d, [field]: field === "rot" ? "0" : String(Math.round({ x: box.x, y: box.y, w: box.width, h: box.height }[field] * 100) / 100) }));
    if (v === null) return reset();
    if (field === "x") st.applyFreeTransform({ kind: "move", dx: v - box.x, dy: 0 });
    else if (field === "y") st.applyFreeTransform({ kind: "move", dx: 0, dy: v - box.y });
    else if (field === "rot") st.applyFreeTransform({ kind: "rotate", degrees: v, center: { x: box.x + box.width / 2, y: box.y + box.height / 2 } });
    else if (v > 0) {
      const f = field === "w" ? v / box.width : v / box.height;
      st.applyFreeTransform({ kind: "scale", sx: field === "w" || keepLocked ? f : 1, sy: field === "h" || keepLocked ? f : 1, pivot: { x: box.x, y: box.y } });
    }
    reset();
  };
  const input = (field: "x" | "y" | "w" | "h" | "rot", label: string, unit: string) => (
    <label className="flex items-center gap-1.5 text-xs">
      <span className="w-9 shrink-0 text-[var(--muted)]">{label}</span>
      <input
        data-testid={`ft-${field}`}
        inputMode="decimal"
        disabled={disabled}
        value={draft[field]}
        onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
        onBlur={() => apply(field)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="min-w-0 flex-1 rounded border border-[var(--line)] bg-white px-1.5 py-1"
      />
      <span className="text-[var(--muted)]">{unit}</span>
    </label>
  );
  return (
    <div data-testid="ft-fields" className="mt-2 grid gap-1.5">
      <div className="grid grid-cols-2 gap-1.5">
        {input("x", "X", "px")}
        {input("y", "Y", "px")}
        {input("w", "너비", "px")}
        {input("h", "높이", "px")}
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input data-testid="ft-lock" type="checkbox" checked={keepLocked} disabled={disabled || !stretch} onChange={(e) => setLock(e.target.checked)} />
        비율 잠금{!stretch ? " (기울어진 레이어가 있어 비율 유지로만 바뀝니다)" : ""}
      </label>
      {input("rot", "회전", "° 더하기")}
    </div>
  );
}
function Field({ label, value, id }: { label: string; value: string | number; id: string }) {
  return (
    <div className="rounded-[7px] border border-[var(--line)] bg-[#fafafa] px-2 py-1.5 text-[#555]">
      <dt className="text-[9px] text-[#999]">{label}</dt>
      <dd data-testid={id} className="m-0 truncate">
        {value}
      </dd>
    </div>
  );
}

/** The layer name, the one editable thing here. Enter or leaving the field keeps it, Escape puts the old name back. */
function NameField({ id, name, disabled }: { id: string; name: string; disabled: boolean }) {
  const [draft, setDraft] = useState(name);
  const cancelled = useRef(false);
  useEffect(() => setDraft(name), [name]); // follows undo/redo and renames from elsewhere
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false; // Escape: leaving the field must not keep what was typed
      return;
    }
    if (!editorStore.getState().renameLayer(id, draft)) setDraft(name); // blank or unchanged: show what the layer is really called
  };
  return (
    <label className="block rounded-[7px] border border-[var(--line)] bg-white px-2 py-1.5 text-[#555] focus-within:border-[var(--accent)]">
      <span className="block text-[9px] text-[#999]">이름</span>
      <input
        data-testid="prop-name"
        type="text"
        disabled={disabled}
        value={draft}
        maxLength={MAX_LAYER_NAME}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            cancelled.current = true;
            setDraft(name);
            e.currentTarget.blur();
          }
        }}
        className="m-0 w-full border-0 bg-transparent p-0 text-[#333] outline-none"
      />
    </label>
  );
}

/** Colours and stroke width of a vector layer. Each commit is one undo step; a line has no fill and always has an outline. */
/** The words of a text box: typing changes nothing until the field is left (one edit, however long the typing), Escape puts the old words back. */
function TextBody({ id, text, disabled }: { id: string; text: string; disabled: boolean }) {
  const [draft, setDraft] = useState(text);
  const cancelled = useRef(false);
  useEffect(() => setDraft(text), [text]); // follows undo/redo and editing on the canvas
  return (
    <textarea
      data-testid="text-content"
      aria-label="글자 내용"
      rows={3}
      maxLength={MAX_TEXT_LENGTH}
      disabled={disabled}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        if (draft === text) return;
        if (!editorStore.getState().setTextContent(id, { text: draft })) setDraft(text); // empty or refused: the old words stay
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          cancelled.current = true;
          setDraft(text);
          e.currentTarget.blur();
        }
      }}
      className="w-full resize-y rounded border border-[var(--line)] bg-white p-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-45"
    />
  );
}

function TextSection({ id, content, disabled }: { id: string; content: TextContent; disabled: boolean }) {
  const set = (change: Partial<{ text: string; fontSize: number; color: string; align: TextContent["align"] }>) => editorStore.getState().setTextContent(id, change);
  const aligns: [TextContent["align"], string][] = [["left", "왼쪽"], ["center", "가운데"], ["right", "오른쪽"]];
  return (
    <div className="mt-3 grid gap-2 border-t border-[var(--line)] pt-3" data-testid="text-section">
      <div className="text-xs font-bold">텍스트</div>
      <TextBody id={id} text={content.text} disabled={disabled} />
      <WidthField label="크기" min={MIN_FONT_SIZE} max={MAX_FONT_SIZE} value={content.fontSize} disabled={disabled} testId="text-size" onCommit={(fontSize) => set({ fontSize })} />
      <ColorField label="색" value={content.color} disabled={disabled} testId="text-color" onCommit={(color) => set({ color })} />
      <div className="flex items-center gap-2 text-xs">
        <span className="w-12 shrink-0 font-bold">정렬</span>
        {aligns.map(([align, label]) => (
          <button key={align} type="button" data-testid={`text-align-${align}`} aria-pressed={content.align === align} disabled={disabled} className="btn mini px-2 aria-pressed:bg-[var(--accent)] aria-pressed:text-white" onClick={() => set({ align })}>
            {label}
          </button>
        ))}
      </div>
      <p className="m-0 text-[11px] text-[var(--muted)]">캔버스에서 두 번 클릭해도 고칠 수 있습니다. 모서리 점은 상자의 너비를 바꾸고, 글자 크기는 그대로입니다.</p>
    </div>
  );
}

/** Corner radius of a rectangle. Dragging the slider shows the rounding on the canvas at once but writes no history; letting go (or leaving
 *  the number box, or Enter) commits one undo step. The value runs from 0 to half of the shorter side. */
function RadiusField({ id, content, disabled }: { id: string; content: Extract<LayerContent, { kind: "rect" }>; disabled: boolean }) {
  const max = maxCornerRadius(content.width, content.height);
  const stored = content.cornerRadius ?? 0;
  const [value, setValue] = useState(stored);
  const dirty = useRef(false);
  useEffect(() => {
    setValue(stored);
    dirty.current = false;
  }, [stored, id]);
  useEffect(() => () => editorStore.getState().setCornerPreview(null), [id]);
  const clamp = (v: number) => Math.min(Math.max(Number.isFinite(v) ? v : 0, 0), max);
  const preview = (v: number) => {
    const r = clamp(v);
    setValue(r);
    dirty.current = true;
    editorStore.getState().setCornerPreview({ layerId: id, cornerRadius: r });
  };
  const commit = () => {
    if (!dirty.current) return;
    dirty.current = false;
    const st = editorStore.getState();
    st.setLayerContent(id, { cornerRadius: clamp(value) });
    st.setCornerPreview(null);
    setValue(clamp(value));
  };
  return (
    <div className="grid gap-1 text-xs">
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0">모서리</span>
        <input data-testid="vec-radius" type="range" aria-label="모서리 반지름" min={0} max={Math.max(max, 0)} step={1} value={Math.min(value, max)} disabled={disabled || max <= 0} onChange={(e) => preview(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} className="min-w-0 flex-1" />
        <input
          data-testid="vec-radius-num"
          type="number"
          aria-label="모서리 반지름 숫자"
          min={0}
          max={max}
          step={1}
          disabled={disabled || max <= 0}
          value={Number.isInteger(value) ? value : Math.round(value * 100) / 100}
          onChange={(e) => preview(e.target.value === "" ? 0 : Number(e.target.value))}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="w-14 rounded border border-[var(--line)] bg-white px-1 py-0.5"
        />
        <span className="text-[var(--muted)]">px</span>
      </div>
      <p className="m-0 pl-16 text-[11px] text-[var(--muted)]">0 ~ {max}px (짧은 변의 절반). 크기를 바꿔도 반지름은 같은 px로 유지되고, 상자가 작아지면 그만큼만 둥글어집니다. 줄었다가 다시 키워도 원래 값으로 자동 복원되지는 않으며 실행 취소(Undo)로만 돌아갑니다.</p>
    </div>
  );
}
function VectorSection({ id, content, disabled }: { id: string; content: Exclude<LayerContent, TextContent>; disabled: boolean }) {
  const set = (change: Partial<{ stroke: string | null; fill: string | null; strokeWidth: number }>) => editorStore.getState().setLayerContent(id, change);
  const isLine = content.kind === "line";
  const fill = isLine ? null : content.fill;
  return (
    <div data-testid="vector-section" className="mt-3 grid gap-2 border-t border-[var(--line)] pt-3">
      <div className="text-xs font-bold">{SHAPE_LABEL[content.kind]} 모양</div>
      <ColorField label="테두리" value={content.stroke ?? "#000000"} disabled={disabled || content.stroke === null} testId="vec-stroke" onCommit={(stroke) => set({ stroke })} />
      {!isLine && (
        <label className="flex items-center gap-2 pl-14 text-xs">
          <input data-testid="vec-stroke-none" type="checkbox" disabled={disabled} checked={content.stroke === null} onChange={(e) => set({ stroke: e.target.checked ? null : "#000000" })} />
          테두리 없음
        </label>
      )}
      {!isLine && (
        <>
          <ColorField label="채움" value={fill ?? "#ffd84d"} disabled={disabled || fill === null} testId="vec-fill" onCommit={(c) => set({ fill: c })} />
          <label className="flex items-center gap-2 pl-14 text-xs">
            <input data-testid="vec-fill-none" type="checkbox" disabled={disabled} checked={fill === null} onChange={(e) => set({ fill: e.target.checked ? null : "#ffd84d" })} />
            채움 없음
          </label>
        </>
      )}
      <WidthField value={content.strokeWidth} disabled={disabled || content.stroke === null} testId="vec-width" onCommit={(strokeWidth) => set({ strokeWidth })} />
      {content.kind === "rect" && <RadiusField id={id} content={content} disabled={disabled} />}
    </div>
  );
}

/** Numbers for the selected layer or patch. X, Y, width and height are read-only; a layer's name and a patch's colour can be changed. */
export default function PropertyPanel() {
  const screen = useEditorStore(selectScreen);
  const images = useEditorStore((s) => s.images);
  const layerId = useEditorStore((s) => s.selectedLayerIds[0]);
  const selectedIds = useEditorStore((s) => s.selectedLayerIds);
  const selectedCount = selectedIds.length;
  const patchId = useEditorStore((s) => s.selectedPatchId);
  const preview = useEditorStore((s) => s.dragPreview);
  const comparing = useEditorStore((s) => s.compareMode !== "off");
  const sourceSelected = useEditorStore((s) => s.sourceSelected);
  if (!screen) return null;

  if (sourceSelected && selectedCount === 0) return <SourceEditPanel />;

  if (selectedCount > 1) {
    const chosen = screen.layers.filter((l) => selectedIds.includes(l.id));
    const locked = chosen.filter((l) => l.locked).length;
    return (
      <section aria-label="선택 레이어" data-testid="multi-panel" className="px-3.5 py-3">
        <h3 className="mb-2.5 text-[13px] font-bold">선택 레이어 {chosen.length}개</h3>
        <p className="m-0 text-xs text-[var(--muted)]">끌거나 방향키(Shift는 10px)로 함께 옮기고, Delete로 모두 지웁니다. 크기와 회전은 선택 전체를 감싸는 상자(자유 변형)로 바꿉니다.</p>
        <div className="mt-2"><FreeTransformButton disabled={comparing} /></div>
        <FreeTransformFields layers={chosen} images={images} disabled={comparing} />
        <div className="mt-3"><AlignButtons disabled={comparing} /></div>
        <div className="mt-3"><MergeButtons count={chosen.length} disabled={comparing} /></div>
        <p className="mb-0 mt-2 text-xs text-[var(--muted)]">이름·복제·복사는 레이어를 하나만 선택했을 때 쓸 수 있습니다.</p>
        {locked > 0 && <p className="mb-0 mt-2 text-xs text-[#8a5a12]">잠긴 레이어 {locked}개는 함께 움직이지 않고 지워지지도 않습니다.</p>}
      </section>
    );
  }

  const layer = screen.layers.find((l) => l.id === layerId);
  const patch = screen.backgroundPatches.find((p) => p.id === patchId);

  if (layer) {
    const raw = layer.imageId ? images.get(layer.imageId)?.raw : undefined;
    const at = preview?.layerId === layer.id ? preview : layer.transform; // follows the drag live
    const size = layer.content ? { width: layer.content.width, height: layer.content.height } : scaledSize(layer.transform, raw?.width ?? layer.crop.width, raw?.height ?? layer.crop.height); // as placed, after any resizing
    return (
      <section aria-label="선택 레이어" className="px-3.5 py-3">
        <h3 className="mb-2.5 text-[13px] font-bold">선택 레이어</h3>
        <div className="mb-2"><FreeTransformButton disabled={comparing || layer.locked} /></div>
        <div className="mb-2 grid grid-cols-[minmax(0,1fr)] gap-2">
          <OpacityField layer={layer} disabled={comparing || layer.locked} />
          <BlendSelect layer={layer} disabled={comparing || layer.locked} />
          <FlipButtons layer={layer} disabled={comparing || layer.locked} />
          <EffectsFields layer={layer} disabled={comparing || layer.locked} />
          <AdjustFields layer={layer} disabled={comparing || layer.locked} />
          <AlignButtons disabled={comparing || layer.locked} />
          <MergeButtons layer={layer} count={1} disabled={comparing || layer.locked} />
        </div>
        <dl className="m-0 grid grid-cols-2 gap-[7px]">
          <div className="col-span-2">
            <NameField id={layer.id} name={layer.name} disabled={comparing} />
          </div>
          <Field label="X" value={at.x} id="prop-x" />
          <Field label="Y" value={at.y} id="prop-y" />
          <Field label="너비" value={fmt(size.width)} id="prop-width" />
          <Field label="높이" value={fmt(size.height)} id="prop-height" />
          <Field label="회전 (°)" value={fmt(layer.transform.rotation)} id="prop-rotation" />
          <div className="col-span-2">
            <Field label="크기 배율" value={`${fmt(layer.transform.scaleX * 100)}% × ${fmt(layer.transform.scaleY * 100)}%`} id="prop-scale" />
          </div>
        </dl>
        {layer.content?.kind === "text" && <TextSection id={layer.id} content={layer.content} disabled={layer.locked || comparing} />}
        {layer.content && layer.content.kind !== "text" && <VectorSection id={layer.id} content={layer.content} disabled={layer.locked || comparing} />}
        <p className="mt-2 text-[11px] text-[var(--muted)]">{layer.locked ? "잠긴 레이어는 크기와 회전을 바꿀 수 없습니다." : "선택한 레이어의 모서리 점으로 크기를, 위쪽 둥근 점으로 회전을 바꿉니다."}</p>
        {layer.warp && <WarpedFields layer={layer} disabled={layer.locked || comparing} />}
        <button className="btn mini mt-2 w-full" disabled={isOnlyMoved(layer.transform) || layer.locked || comparing} onClick={() => editorStore.getState().resetLayerTransform(layer.id)}>
          크기·회전 초기화
        </button>
        {layer.warp && (
          <button data-testid="prop-warp-reset" className="btn mini mt-2 w-full" disabled={layer.locked || comparing} onClick={() => editorStore.getState().setLayerWarp(layer.id, null)}>
            변형 초기화
          </button>
        )}
      </section>
    );
  }

  if (patch) return <PatchSection key={patch.id} id={patch.id} rect={patch.rect} fill={patch.fill} disabled={comparing} />;

  return (
    <section aria-label="속성" className="px-3.5 py-3 text-xs text-[var(--muted)]">
      레이어를 선택하면 위치와 크기가, 배경 채움 도구로 패치를 클릭하면 배경색이 여기에 나옵니다.
    </section>
  );
}

/** A warped layer has no resize/rotate frame on the canvas (its shape is not a rectangle), so its size (a percentage, same both ways) and turn are typed here. */
function WarpedFields({ layer, disabled }: { layer: BitmapLayer; disabled: boolean }) {
  const t = layer.transform;
  const apply = (change: Partial<typeof t>) => editorStore.getState().transformLayer(layer.id, { ...t, ...change });
  const input = (testId: string, label: string, value: number, onCommit: (v: number) => void) => (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 font-bold">{label}</span>
      <input
        key={value}
        data-testid={testId}
        type="number"
        step="any"
        defaultValue={fmt(value)}
        disabled={disabled}
        onBlur={(e) => Number.isFinite(e.currentTarget.valueAsNumber) && e.currentTarget.valueAsNumber !== Number(fmt(value)) && onCommit(e.currentTarget.valueAsNumber)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="w-20 rounded border border-[var(--line)] bg-white px-1.5 py-0.5 text-xs"
      />
    </label>
  );
  return (
    <div data-testid="warped-fields" className="mt-3 grid gap-2 border-t border-[var(--line)] pt-3">
      <div className="text-xs font-bold">변형한 레이어</div>
      {input("warped-scale", "크기 (%)", Math.abs(t.scaleX) * 100, (v) => apply({ scaleX: v / 100, scaleY: v / 100 }))}
      {input("warped-rotation", "회전 (°)", t.rotation, (v) => apply({ rotation: v }))}
    </div>
  );
}

function PatchSection({ id, rect, fill, disabled }: { id: string; rect: { x: number; y: number; width: number; height: number }; fill: string; disabled: boolean }) {
  const [draft, setDraft] = useState(fill);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(fill), [fill]); // follows undo/redo

  // Dragging inside the picker fires `input` continuously; only the native `change` (picker closed / value committed) is an edit,
  // so one colour change is one undo step.
  useEffect(() => {
    const el = input.current!;
    const commit = () => editorStore.getState().setPatchColor(id, el.value);
    el.addEventListener("change", commit);
    return () => el.removeEventListener("change", commit);
  }, [id]);

  return (
    <section aria-label="배경 패치" className="px-3.5 py-3">
      <h3 className="mb-2.5 text-[13px] font-bold">배경 패치</h3>
      <dl className="m-0 grid grid-cols-2 gap-[7px]">
        <Field label="X" value={rect.x} id="prop-x" />
        <Field label="Y" value={rect.y} id="prop-y" />
        <Field label="너비" value={rect.width} id="prop-width" />
        <Field label="높이" value={rect.height} id="prop-height" />
      </dl>
      <label className="mt-3 flex items-center gap-2.5 text-xs">
        <span className="font-bold">배경색</span>
        <input ref={input} data-testid="patch-color" type="color" disabled={disabled} value={draft} onChange={(e) => setDraft(e.target.value)} className="h-8 w-12 cursor-pointer rounded border border-[var(--line)] bg-white p-0.5" />
        <span data-testid="patch-hex" className="font-mono text-[var(--muted)]">{draft}</span>
      </label>
    </section>
  );
}
