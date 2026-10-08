"use client";

import { useEffect, useRef, useState } from "react";
import { isOnlyMoved, scaledSize } from "@/lib/geometry/layer-transform";
import { MAX_LAYER_NAME, selectScreen } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";
import { LayerContent, TextContent } from "@/lib/project/schema";
import { MAX_FONT_SIZE, MAX_TEXT_LENGTH, MIN_FONT_SIZE } from "@/lib/image/text-layout";
import { SHAPE_LABEL } from "@/lib/image/vector";
import { ColorField, WidthField } from "./StyleFields";

/** 240, 12.5, 33.33: whole numbers without decimals, others to at most two places */
const fmt = (n: number) => String(Number(n.toFixed(2)));

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
    </div>
  );
}

/** Numbers for the selected layer or patch. X, Y, width and height are read-only; a layer's name and a patch's colour can be changed. */
export default function PropertyPanel() {
  const screen = useEditorStore(selectScreen);
  const images = useEditorStore((s) => s.images);
  const layerId = useEditorStore((s) => s.selectedLayerIds[0]);
  const patchId = useEditorStore((s) => s.selectedPatchId);
  const preview = useEditorStore((s) => s.dragPreview);
  const comparing = useEditorStore((s) => s.compareMode !== "off");
  if (!screen) return null;

  const layer = screen.layers.find((l) => l.id === layerId);
  const patch = screen.backgroundPatches.find((p) => p.id === patchId);

  if (layer) {
    const raw = layer.imageId ? images.get(layer.imageId)?.raw : undefined;
    const at = preview?.layerId === layer.id ? preview : layer.transform; // follows the drag live
    const size = layer.content ? { width: layer.content.width, height: layer.content.height } : scaledSize(layer.transform, raw?.width ?? layer.crop.width, raw?.height ?? layer.crop.height); // as placed, after any resizing
    return (
      <section aria-label="선택 레이어" className="px-3.5 py-3">
        <h3 className="mb-2.5 text-[13px] font-bold">선택 레이어</h3>
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
        <button className="btn mini mt-2 w-full" disabled={isOnlyMoved(layer.transform) || layer.locked || comparing} onClick={() => editorStore.getState().resetLayerTransform(layer.id)}>
          크기·회전 초기화
        </button>
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
