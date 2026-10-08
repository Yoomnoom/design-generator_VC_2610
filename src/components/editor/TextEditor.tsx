"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { imageToClient } from "@/lib/geometry/coords";
import { MAX_TEXT_LENGTH, fontOf, lineHeightOf } from "@/lib/image/text-layout";
import { DEFAULT_TEXT_WIDTH, selectScreen } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";

/** a blur this soon after the box opened is the click that opened it taking the focus back, not the user leaving */
const SETTLE_MS = 250;

/** The box you type into. It sits exactly where the text box is (or will be) on the canvas, at the canvas's zoom and the box's angle,
 *  so typing happens in place. Leaving the box commits (one undo step), Escape throws the typing away, Ctrl+Enter commits. While it is
 *  open, the text box underneath is covered, since the box shows the words being typed. */
export default function TextEditor() {
  const editing = useEditorStore((s) => s.textEditing);
  const view = useEditorStore((s) => s.view);
  const screen = useEditorStore(selectScreen);
  const textStyle = useEditorStore((s) => s.textStyle);
  const layer = editing?.layerId ? screen?.layers.find((l) => l.id === editing.layerId) : undefined;
  const ref = useRef<HTMLTextAreaElement>(null);
  const openedAt = useRef(0);
  const done = useRef(false);

  const content = layer?.content?.kind === "text" ? layer.content : null;
  const key = editing ? `${editing.layerId ?? "new"}:${editing.x}:${editing.y}` : "";

  useEffect(() => {
    if (!editing) return;
    done.current = false;
    openedAt.current = performance.now();
    const el = ref.current;
    if (!el) return;
    el.value = content?.text ?? "";
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    grow(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useLayoutEffect(() => {
    if (ref.current) grow(ref.current);
  });

  if (!editing || !screen) return null;
  const fontSize = content?.fontSize ?? textStyle.fontSize;
  const color = content?.color ?? textStyle.color;
  const align = content?.align ?? textStyle.align;
  const width = content?.width ?? DEFAULT_TEXT_WIDTH;
  const rotation = layer?.transform.rotation ?? 0;
  const at = imageToClient({ x: editing.x, y: editing.y }, { x: 0, y: 0 }, view, { x: screen.x, y: screen.y });

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const text = ref.current?.value ?? "";
    if (commit) editorStore.getState().commitTextEdit(text);
    else editorStore.getState().cancelTextEdit();
  };

  return (
    <textarea
      ref={ref}
      data-testid="text-editor"
      aria-label="글자 입력"
      maxLength={MAX_TEXT_LENGTH}
      spellCheck={false}
      rows={1}
      onPointerDown={(e) => e.stopPropagation()}
      onInput={(e) => grow(e.currentTarget)}
      onBlur={(e) => {
        if (performance.now() - openedAt.current < SETTLE_MS) return void e.currentTarget.focus();
        finish(true);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") finish(false);
        else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) finish(true);
      }}
      className="absolute z-20 m-0 resize-none overflow-hidden border-0 p-0"
      style={{
        left: at.x,
        top: at.y,
        width: width * view.zoom,
        transformOrigin: "0 0",
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        font: fontOf(fontSize * view.zoom),
        lineHeight: `${lineHeightOf(fontSize) * view.zoom}px`,
        textAlign: align,
        color,
        background: "rgba(255,255,255,0.92)",
        outline: "1px dashed var(--accent)",
        outlineOffset: 0,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      }}
    />
  );
}

/** the box is as tall as its lines, so there is no scrollbar and nothing hides */
function grow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}
