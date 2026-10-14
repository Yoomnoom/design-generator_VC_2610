"use client";

import { useEffect } from "react";
import { copyLayerToClipboard, writePngToSystemClipboard } from "@/features/layer-clipboard/layer-clipboard";
import { wholeGroupOf } from "@/features/groups/groups";
import { resolveShortcut } from "@/features/shortcuts/shortcuts";
import { shortcutStore } from "@/features/shortcuts/shortcut-store";
import { selectScreen } from "@/store/editor-store";
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
      const action = resolveShortcut(e, shortcutStore.get());
      const st = editorStore.getState();
      // Ctrl+G is "find next" in a browser: while the editor owns the keyboard it is always taken, project or not
      if ((action === "group" || action === "ungroup") && !st.history) return void e.preventDefault();
      if (!action || !st.history) return;
      const layerId = st.selectedLayerIds[0];

      switch (action) {
        case "select-all":
          st.selectAllLayers();
          break;
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
          if (!st.deleteSelectedLayers()) return; // every selected layer that is not locked
          break;
        case "duplicate":
          if (st.selectedLayerIds.length > 1) {
            const whole = wholeGroupOf(selectScreen(st)?.layers ?? [], st.selectedLayerIds);
            if (whole) st.duplicateGroup(whole);
            else st.setNotice("여러 레이어가 선택되어 있어 복제할 수 없습니다. 하나만 선택하거나 그룹 전체를 선택하세요.");
          } else if (layerId) st.duplicateLayer(layerId); // Ctrl+D is "bookmark this page" in a browser, so it is always taken
          break;
        case "copy":
          if (!layerId || window.getSelection()?.toString()) return; // with text selected, Ctrl+C is the normal copy
          if (st.selectedLayerIds.length > 1) {
            st.setNotice("여러 레이어가 선택되어 있어 복사할 수 없습니다. 하나만 선택하세요.");
            break;
          }
          // the layer's picture goes to the system clipboard; the app remembers the layer and the picture's hash.
          // A refusal (no permission, no clipboard API) is shown to the user, never swallowed.
          void copyLayerToClipboard({ layerId, store: editorStore, codec: canvasCodec, write: writePngToSystemClipboard }).then((r) => {
            editorStore.getState().setNotice(r.ok ? null : r.reason);
          });
          break;
        case "free-transform":
          if (st.selectedLayerIds.length === 0) st.setNotice("자유 변형: 먼저 레이어를 선택하세요.");
          else st.setFreeTransform(!st.freeTransform);
          break;
        case "group":
          st.groupSelected();
          break;
        case "ungroup":
          st.ungroupSelected();
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
          st.nudgeLayers(st.selectedLayerIds, dx, dy); // the whole selection; a locked layer stays where it is
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
          if (st.activeTool === "warp") {
            st.finishWarp(true); // Enter: keep the warp
            break;
          }
          if (st.freeTransform) {
            st.setFreeTransform(false); // Enter: done with the free-transform box (each drag was already one undo step)
            break;
          }
          if (!st.candidatePick) return; // Enter means nothing here otherwise
          st.extractCandidatePick();
          break;
        case "candidate-clear":
          if (st.activeTool === "warp") {
            st.finishWarp(false); // Esc: take back everything done with the warp tool
            break;
          }
          if (st.candidatePick) {
            st.clearCandidatePick();
            break;
          }
          if (st.freeTransform) {
            st.setFreeTransform(false);
            break;
          }
          if (st.selectedLayerIds.length === 0) return; // Esc means nothing here otherwise
          st.deselectAll();
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
        case "tool-warp":
          st.setTool("warp");
          break;
        case "tool-finger":
          st.setTool("finger");
          break;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
