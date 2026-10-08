export type ShortcutAction = "undo" | "redo" | "delete" | "duplicate" | "copy" | "tool-select" | "tool-hand" | "tool-rect" | "tool-line" | "tool-box" | "tool-ellipse" | "tool-eyedropper" | "tool-brush" | "tool-eraser" | "tool-text" | "nudge-left" | "nudge-right" | "nudge-up" | "nudge-down";

export type KeyInfo = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; repeat?: boolean };

/** What a key press means in the editor, or null when it means nothing here.
 *  Ctrl+V is not in this list: paste arrives as a `paste` event, which also carries the clipboard. */
export function resolveShortcut(e: KeyInfo): ShortcutAction | null {
  const mod = e.ctrlKey || e.metaKey; // ⌘ on a Mac
  const key = e.key.toLowerCase();
  let action: ShortcutAction | null = null;

  if (mod && !e.altKey) {
    if (key === "z") action = e.shiftKey ? "redo" : "undo";
    else if (key === "y" && !e.shiftKey) action = "redo";
    else if (key === "d" && !e.shiftKey) action = "duplicate";
    else if (key === "c" && !e.shiftKey) action = "copy";
  } else if (!mod && !e.altKey && e.key.startsWith("Arrow")) {
    // 1px, or 10px with Shift (that is the caller's to read); holding the key repeats, and the store folds the repeats into one step
    action = e.key === "ArrowLeft" ? "nudge-left" : e.key === "ArrowRight" ? "nudge-right" : e.key === "ArrowUp" ? "nudge-up" : e.key === "ArrowDown" ? "nudge-down" : null;
  } else if (!mod && !e.altKey && !e.shiftKey) {
    if (e.key === "Delete") action = "delete";
    else if (key === "v") action = "tool-select";
    else if (key === "h") action = "tool-hand";
    else if (key === "r") action = "tool-rect";
    else if (key === "l") action = "tool-line";
    else if (key === "m") action = "tool-box";
    else if (key === "o") action = "tool-ellipse";
    else if (key === "i") action = "tool-eyedropper";
    else if (key === "b") action = "tool-brush";
    else if (key === "t") action = "tool-text";
    else if (key === "e") action = "tool-eraser";
  }
  // holding a key must not delete, copy or duplicate over and over
  if (e.repeat && (action === "delete" || action === "duplicate" || action === "copy")) return null;
  return action;
}

/** the shortcut text shown in tooltips */
export const SHORTCUT_HINT = { undo: "Ctrl+Z", redo: "Ctrl+Shift+Z", delete: "Delete", duplicate: "Ctrl+D", copy: "Ctrl+C", paste: "Ctrl+V", select: "V", hand: "H", rect: "R" } as const;
