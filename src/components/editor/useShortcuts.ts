"use client";

import { useEffect } from "react";
import { copyLayerToClipboard, writePngToSystemClipboard } from "@/features/layer-clipboard/layer-clipboard";
import { resolveShortcut } from "@/features/shortcuts/shortcuts";
import { canvasCodec } from "@/lib/image/canvas-codec";
import { isTypingTarget } from "@/lib/dom";
import { editorStore } from "@/store/use-editor-store";

/** true while a modal dialog (colour question, export) is open: the editor behind it must not react to keys */
const modalOpen = () => document.querySelector('[role="dialog"][aria-modal="true"]') !== null;

/** Editor shortcuts. Nothing happens while a text control has focus or a dialog is open. */
export function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target) || modalOpen()) return;
      const action = resolveShortcut(e);
      const st = editorStore.getState();
      if (!action || !st.history) return;
      const layerId = st.selectedLayerIds[0];

      switch (action) {
        case "undo":
          st.undo();
          break;
        case "redo":
          st.redo();
          break;
        case "delete":
          // with no layer selected, Delete takes the selected memo
          if (!layerId) {
            if (!st.selectedMemoId || !st.deleteMemo(st.selectedMemoId)) return;
            break;
          }
          if (!st.deleteLayer(layerId)) return;
          break;
        case "duplicate":
          if (layerId) st.duplicateLayer(layerId); // Ctrl+D is "bookmark this page" in a browser, so it is always taken
          break;
        case "copy":
          if (!layerId || window.getSelection()?.toString()) return; // with text selected, Ctrl+C is the normal copy
          // the layer's picture goes to the system clipboard; the app remembers the layer and the picture's hash.
          // A refusal (no permission, no clipboard API) is shown to the user, never swallowed.
          void copyLayerToClipboard({ layerId, store: editorStore, codec: canvasCodec, write: writePngToSystemClipboard }).then((r) => {
            editorStore.getState().setNotice(r.ok ? null : r.reason);
          });
          break;
        case "tool-select":
          st.setTool("select");
          break;
        case "tool-hand":
          st.setTool("hand");
          break;
        case "tool-rect":
          st.setTool("rect");
          break;
        case "nudge-left":
        case "nudge-right":
        case "nudge-up":
        case "nudge-down": {
          if (!layerId) return; // with nothing selected the arrow keys do what they always do
          const step = e.shiftKey ? 10 : 1;
          const dx = action === "nudge-left" ? -step : action === "nudge-right" ? step : 0;
          const dy = action === "nudge-up" ? -step : action === "nudge-down" ? step : 0;
          st.nudgeLayer(layerId, dx, dy);
          break;
        }
        case "tool-line":
          st.setTool("line");
          break;
        case "tool-box":
          st.setTool("box");
          break;
        case "tool-ellipse":
          st.setTool("ellipse");
          break;
        case "tool-eyedropper":
          st.setTool("eyedropper");
          break;
        case "tool-auto":
          st.setTool("auto");
          break;
        case "candidate-extract":
          if (!st.candidatePick) return; // Enter means nothing here otherwise
          st.extractCandidatePick();
          break;
        case "candidate-clear":
          if (!st.candidatePick) return;
          st.clearCandidatePick();
          break;
        case "tool-memo":
          st.setTool("memo");
          break;
        case "tool-text":
          st.setTool("text");
          break;
        case "tool-brush":
          st.setTool("brush");
          break;
        case "tool-eraser":
          st.setTool("eraser");
          break;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
