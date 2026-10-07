"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_LAYER_NAME, selectScreen } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";

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
function NameField({ id, name }: { id: string; name: string }) {
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

/** Numbers for the selected layer or patch. X, Y, width and height are read-only; a layer's name and a patch's colour can be changed. */
export default function PropertyPanel() {
  const screen = useEditorStore(selectScreen);
  const images = useEditorStore((s) => s.images);
  const layerId = useEditorStore((s) => s.selectedLayerIds[0]);
  const patchId = useEditorStore((s) => s.selectedPatchId);
  const preview = useEditorStore((s) => s.dragPreview);
  if (!screen) return null;

  const layer = screen.layers.find((l) => l.id === layerId);
  const patch = screen.backgroundPatches.find((p) => p.id === patchId);

  if (layer) {
    const raw = layer.imageId ? images.get(layer.imageId)?.raw : undefined;
    const at = preview?.layerId === layer.id ? preview : layer.transform; // follows the drag live
    return (
      <section aria-label="선택 레이어" className="px-3.5 py-3">
        <h3 className="mb-2.5 text-[13px] font-bold">선택 레이어</h3>
        <dl className="m-0 grid grid-cols-2 gap-[7px]">
          <div className="col-span-2">
            <NameField id={layer.id} name={layer.name} />
          </div>
          <Field label="X" value={at.x} id="prop-x" />
          <Field label="Y" value={at.y} id="prop-y" />
          <Field label="너비" value={raw?.width ?? layer.crop.width} id="prop-width" />
          <Field label="높이" value={raw?.height ?? layer.crop.height} id="prop-height" />
        </dl>
      </section>
    );
  }

  if (patch) return <PatchSection key={patch.id} id={patch.id} rect={patch.rect} fill={patch.fill} />;

  return (
    <section aria-label="속성" className="px-3.5 py-3 text-xs text-[var(--muted)]">
      레이어를 선택하면 위치와 크기가, 배경 채움 도구로 패치를 클릭하면 배경색이 여기에 나옵니다.
    </section>
  );
}

function PatchSection({ id, rect, fill }: { id: string; rect: { x: number; y: number; width: number; height: number }; fill: string }) {
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
        <input ref={input} data-testid="patch-color" type="color" value={draft} onChange={(e) => setDraft(e.target.value)} className="h-8 w-12 cursor-pointer rounded border border-[var(--line)] bg-white p-0.5" />
        <span data-testid="patch-hex" className="font-mono text-[var(--muted)]">{draft}</span>
      </label>
    </section>
  );
}
