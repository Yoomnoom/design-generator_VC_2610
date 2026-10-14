import { describe, expect, test } from "vitest";
import { ACTION_INFO, Binding, DEFAULT_BINDINGS, RESERVED, bindingOf, checkBinding, formatBinding, resolveShortcut } from "@/features/shortcuts/shortcuts";
import { SHORTCUTS_STORAGE_KEY, createShortcutStore, parseStoredBindings, serializeBindings } from "@/features/shortcuts/shortcut-store";

const key = (k: string, o: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; repeat: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });
const bind = (k: string, o: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): Binding => ({ key: k, ctrl: !!o.ctrl, shift: !!o.shift, alt: !!o.alt });
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), raw: m };
};

describe("defaults", () => {
  test("group is Ctrl+G and release is Ctrl+Shift+G (⌘ on a Mac too); holding the key does not repeat them", () => {
    expect(resolveShortcut(key("g", { ctrlKey: true }))).toBe("group");
    expect(resolveShortcut(key("G", { ctrlKey: true, shiftKey: true }))).toBe("ungroup");
    expect(resolveShortcut(key("g", { metaKey: true }))).toBe("group");
    expect(resolveShortcut(key("g", { ctrlKey: true, repeat: true }))).toBeNull();
    expect(resolveShortcut(key("g"))).toBeNull();
  });

  test("no two actions share a default key, and no default is a reserved key", () => {
    const seen = new Map<string, string>();
    for (const a of ACTION_INFO) {
      const text = formatBinding(DEFAULT_BINDINGS[a.id]);
      expect(seen.has(text), `${a.id} vs ${seen.get(text)}`).toBe(false);
      seen.set(text, a.id);
      expect(checkBinding(a.id, DEFAULT_BINDINGS[a.id], DEFAULT_BINDINGS).ok, a.id).toBe(true);
    }
  });

  test("Ctrl+Y still redoes while redo has its default key; it does not once redo is moved", () => {
    expect(resolveShortcut(key("y", { ctrlKey: true }))).toBe("redo");
    expect(resolveShortcut(key("y", { ctrlKey: true }), { ...DEFAULT_BINDINGS, redo: bind("u", { ctrl: true, shift: true }) })).toBeNull();
  });
});

describe("changing a key", () => {
  test("the new key runs the action and the old key no longer does", () => {
    const b = { ...DEFAULT_BINDINGS, "tool-brush": bind("q") };
    expect(resolveShortcut(key("q"), b)).toBe("tool-brush");
    expect(resolveShortcut(key("b"), b)).toBeNull();
    const c = { ...DEFAULT_BINDINGS, group: bind("g", { ctrl: true, alt: true }) };
    expect(resolveShortcut(key("g", { ctrlKey: true, altKey: true }), c)).toBe("group");
    expect(resolveShortcut(key("g", { ctrlKey: true }), c)).toBeNull();
  });

  test("a key already used by another action is refused, naming that action; nothing changes (no silent swap)", () => {
    const r = checkBinding("tool-brush", bind("v"), DEFAULT_BINDINGS);
    expect(r).toMatchObject({ ok: false, conflict: "tool-select" });
    expect(!r.ok && r.reason).toContain("선택 도구");
    expect(checkBinding("group", bind("d", { ctrl: true }), DEFAULT_BINDINGS)).toMatchObject({ ok: false, conflict: "duplicate" });
    const store = createShortcutStore(memory());
    expect(store.set("tool-brush", bind("v")).ok).toBe(false);
    expect(store.get()["tool-brush"]).toEqual(DEFAULT_BINDINGS["tool-brush"]);
    expect(store.get()["tool-select"]).toEqual(DEFAULT_BINDINGS["tool-select"]);
  });

  test("browser-reserved keys cannot be assigned: new tab, close tab, reload, find, save, print...", () => {
    for (const k of ["t", "w", "n", "r", "l", "f", "s", "p"]) expect(checkBinding("group", bind(k, { ctrl: true }), DEFAULT_BINDINGS).ok, `Ctrl+${k}`).toBe(false);
    expect(checkBinding("group", bind("t", { ctrl: true, shift: true }), DEFAULT_BINDINGS).ok).toBe(false);
    expect(checkBinding("tool-brush", bind("F5"), DEFAULT_BINDINGS).ok).toBe(false);
    expect(checkBinding("tool-brush", bind("F4", { alt: true }), DEFAULT_BINDINGS).ok).toBe(false);
    expect(checkBinding("tool-brush", bind("Enter"), DEFAULT_BINDINGS).ok).toBe(false);
    expect(checkBinding("tool-brush", bind("Escape"), DEFAULT_BINDINGS).ok).toBe(false);
    expect(checkBinding("tool-brush", bind("v", { ctrl: true }), DEFAULT_BINDINGS).ok).toBe(false); // paste is the browser's event
    const r = checkBinding("group", bind("w", { ctrl: true }), DEFAULT_BINDINGS);
    expect(!r.ok && r.reason).toContain("브라우저");
    expect(RESERVED.length).toBeGreaterThan(30);
  });

  test("a modifier alone is not a key", () => {
    for (const k of ["Control", "Shift", "Alt", "Meta"]) expect(checkBinding("group", bind(k), DEFAULT_BINDINGS).ok).toBe(false);
  });

  test("arrow-key movement: one plain key per direction, Shift gives 10px (so Shift is not a way to tell keys apart)", () => {
    expect(resolveShortcut(key("ArrowLeft", { shiftKey: true }))).toBe("nudge-left");
    expect(checkBinding("nudge-left", bind("j", { shift: true }), DEFAULT_BINDINGS).ok).toBe(false);
    expect(checkBinding("nudge-left", bind("j", { ctrl: true }), DEFAULT_BINDINGS).ok).toBe(false);
    const b = { ...DEFAULT_BINDINGS, "nudge-left": bind("j") };
    expect(resolveShortcut(key("j", { shiftKey: true }), b)).toBe("nudge-left");
    // a key a nudge uses cannot also be a tool key, with or without Shift
    expect(checkBinding("nudge-up", bind("v"), DEFAULT_BINDINGS)).toMatchObject({ ok: false, conflict: "tool-select" });
  });

  test("bindingOf reads Cmd like Ctrl and letters in lower case", () => {
    expect(bindingOf(key("Z", { metaKey: true, shiftKey: true }))).toEqual(bind("z", { ctrl: true, shift: true }));
    expect(formatBinding(bind("z", { ctrl: true, shift: true }))).toBe("Ctrl+Shift+Z");
    expect(formatBinding(bind("ArrowLeft"))).toBe("←");
  });
});

describe("saving the setting (this browser only)", () => {
  test("a changed key is stored and comes back after a reload; only the changes are stored; reset removes the entry", () => {
    const storage = memory();
    const a = createShortcutStore(storage);
    expect(a.set("tool-brush", bind("q")).ok).toBe(true);
    const saved = JSON.parse(storage.raw.get(SHORTCUTS_STORAGE_KEY)!);
    expect(Object.keys(saved.bindings)).toEqual(["tool-brush"]);
    const b = createShortcutStore(storage); // a new page load
    expect(b.get()["tool-brush"]).toEqual(bind("q"));
    expect(b.get()["tool-select"]).toEqual(DEFAULT_BINDINGS["tool-select"]);
    b.reset();
    expect(b.get()).toEqual(DEFAULT_BINDINGS);
    expect(storage.raw.has(SHORTCUTS_STORAGE_KEY)).toBe(false);
    expect(createShortcutStore(storage).get()).toEqual(DEFAULT_BINDINGS);
  });

  test("keys that moved from one action to another reload correctly (not rejected for meeting an old default)", () => {
    const storage = memory();
    const a = createShortcutStore(storage);
    expect(a.set("tool-hand", bind("g")).ok).toBe(true); // frees H
    expect(a.set("tool-select", bind("h")).ok).toBe(true); // V's action takes H, which comes earlier in the list than the hand tool
    const b = createShortcutStore(storage);
    expect(b.get()["tool-select"]).toEqual(bind("h"));
    expect(b.get()["tool-hand"]).toEqual(bind("g"));
    expect(resolveShortcut(key("h"), b.get())).toBe("tool-select");
  });

  test("a damaged, foreign or invalid entry is ignored key by key: defaults stay, nothing throws", () => {
    expect(parseStoredBindings("{not json")).toEqual(DEFAULT_BINDINGS);
    expect(parseStoredBindings(JSON.stringify({ format: 99, bindings: { "tool-brush": bind("q") } }))).toEqual(DEFAULT_BINDINGS);
    expect(parseStoredBindings(JSON.stringify({ format: 1, bindings: "x" }))).toEqual(DEFAULT_BINDINGS);
    const mixed = parseStoredBindings(JSON.stringify({ format: 1, bindings: { "tool-brush": bind("q"), "tool-text": { key: 5 }, group: bind("w", { ctrl: true }), nope: bind("z"), "tool-line": bind("v") } }));
    expect(mixed["tool-brush"]).toEqual(bind("q"));
    expect(mixed["tool-text"]).toEqual(DEFAULT_BINDINGS["tool-text"]); // not a binding
    expect(mixed.group).toEqual(DEFAULT_BINDINGS.group); // reserved
    expect(mixed["tool-line"]).toEqual(DEFAULT_BINDINGS["tool-line"]); // collides with the selection tool
    expect(parseStoredBindings(null)).toEqual(DEFAULT_BINDINGS);
  });

  test("blocked storage: the defaults work, and a change still applies for this page", () => {
    const blocked = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
    const s = createShortcutStore(blocked);
    expect(s.get()).toEqual(DEFAULT_BINDINGS);
    expect(s.set("tool-brush", bind("q")).ok).toBe(true);
    expect(s.get()["tool-brush"]).toEqual(bind("q"));
    const none = createShortcutStore(null);
    expect(none.get()).toEqual(DEFAULT_BINDINGS);
  });

  test("it is a browser setting, not project data: nothing of it is in a project's text", () => {
    expect(serializeBindings(DEFAULT_BINDINGS)).toBe(JSON.stringify({ format: 1, bindings: {} }));
  });

  test("subscribers hear of a change and of a reset", () => {
    const s = createShortcutStore(memory());
    let n = 0;
    const off = s.subscribe(() => n++);
    s.set("tool-brush", bind("q"));
    s.reset();
    s.set("tool-brush", bind("v")); // refused: no event
    off();
    s.set("tool-brush", bind("q"));
    expect(n).toBe(2);
  });
});
