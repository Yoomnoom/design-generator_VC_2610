import { describe, expect, test } from "vitest";
import { KeyInfo, resolveShortcut } from "@/features/shortcuts/shortcuts";

const key = (k: string, over: Partial<KeyInfo> = {}): KeyInfo => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over });
const ctrl = (k: string, over: Partial<KeyInfo> = {}) => key(k, { ctrlKey: true, ...over });

describe("resolveShortcut", () => {
  test.each([
    ["Ctrl+Z", ctrl("z"), "undo"],
    ["Ctrl+Shift+Z (the browser reports an upper-case Z)", ctrl("Z", { shiftKey: true }), "redo"],
    ["Ctrl+Y", ctrl("y"), "redo"],
    ["⌘Z on a Mac", key("z", { metaKey: true }), "undo"],
    ["⌘⇧Z on a Mac", key("Z", { metaKey: true, shiftKey: true }), "redo"],
    ["Delete", key("Delete"), "delete"],
    ["Ctrl+D", ctrl("d"), "duplicate"],
    ["Ctrl+C", ctrl("c"), "copy"],
    ["V", key("v"), "tool-select"],
    ["H", key("h"), "tool-hand"],
    ["R", key("r"), "tool-rect"],
    ["Caps Lock on: V", key("V"), "tool-select"],
  ])("%s", (_name, e, expected) => {
    expect(resolveShortcut(e)).toBe(expected);
  });

  test.each([
    ["Ctrl+V is a paste event, not a key shortcut", ctrl("v")],
    ["plain Z, D and C do nothing", key("z")],
    ["Backspace is not Delete", key("Backspace")],
    ["Ctrl+Shift+Y", ctrl("Y", { shiftKey: true })],
    ["Ctrl+Shift+D", ctrl("D", { shiftKey: true })],
    ["Alt+Z", ctrl("z", { altKey: true })],
    ["Ctrl+H is the browser's history", ctrl("h")],
    ["Ctrl+R is reload", ctrl("r")],
    ["Shift+V", key("V", { shiftKey: true })],
    ["Alt+V", key("v", { altKey: true })],
    ["an unrelated key", key("q")],
    ["Shift+Delete", key("Delete", { shiftKey: true })],
  ])("%s → nothing", (_name, e) => {
    expect(resolveShortcut(e)).toBeNull();
  });

  test("holding Delete, Ctrl+D or Ctrl+C does not repeat, but Ctrl+Z does", () => {
    expect(resolveShortcut(key("Delete", { repeat: true }))).toBeNull();
    expect(resolveShortcut(ctrl("d", { repeat: true }))).toBeNull();
    expect(resolveShortcut(ctrl("c", { repeat: true }))).toBeNull();
    expect(resolveShortcut(ctrl("z", { repeat: true }))).toBe("undo");
  });
});

describe("arrow keys", () => {
  test.each([
    ["ArrowLeft", "nudge-left"],
    ["ArrowRight", "nudge-right"],
    ["ArrowUp", "nudge-up"],
    ["ArrowDown", "nudge-down"],
  ])("%s → %s, with or without Shift, and held down it repeats", (k, expected) => {
    expect(resolveShortcut(key(k))).toBe(expected);
    expect(resolveShortcut(key(k, { shiftKey: true }))).toBe(expected);
    expect(resolveShortcut(key(k, { repeat: true }))).toBe(expected);
  });
  test("with Ctrl, ⌘ or Alt the arrow keys are the browser's (back, forward, word jumps), not ours", () => {
    expect(resolveShortcut(ctrl("ArrowLeft"))).toBeNull();
    expect(resolveShortcut(key("ArrowRight", { metaKey: true }))).toBeNull();
    expect(resolveShortcut(key("ArrowLeft", { altKey: true }))).toBeNull();
  });
});
