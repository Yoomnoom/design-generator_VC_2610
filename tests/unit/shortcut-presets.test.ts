import { describe, expect, test } from "vitest";
import { ACTION_INFO, KeyInfo, NOT_AVAILABLE, PRESETS, PRESET_ALIASES, ShortcutAction, checkBinding, resolveShortcut } from "@/features/shortcuts/shortcuts";
import { SHORTCUTS_STORAGE_KEY, createShortcutStore, liveAliases } from "@/features/shortcuts/shortcut-store";

const k = (key: string, o: Partial<KeyInfo> = {}): KeyInfo => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });
const ps = (e: KeyInfo) => resolveShortcut(e, PRESETS.photoshop, PRESET_ALIASES.photoshop);
const legacy = (e: KeyInfo) => resolveShortcut(e, PRESETS.legacy, PRESET_ALIASES.legacy);
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (x: string) => m.get(x) ?? null, setItem: (x: string, v: string) => void m.set(x, v), removeItem: (x: string) => void m.delete(x), raw: m };
};

describe("the Photoshop preset (the default)", () => {
  const table: [string, KeyInfo, ShortcutAction][] = [
    ["V select", k("v"), "tool-select"],
    ["H hand", k("h"), "tool-hand"],
    ["M region extraction", k("m"), "tool-rect"],
    ["T text", k("t"), "tool-text"],
    ["B brush", k("b"), "tool-brush"],
    ["E eraser", k("e"), "tool-eraser"],
    ["I eyedropper", k("i"), "tool-eyedropper"],
    ["U shapes (cycle)", k("u"), "tool-shape"],
    ["R finger", k("r"), "tool-finger"],
    ["X swap colours", k("x"), "swap-colors"],
    ["D default colours", k("d"), "default-colors"],
    ["[ smaller", k("["), "brush-smaller"],
    ["] bigger", k("]"), "brush-bigger"],
    ["Ctrl+J duplicate", k("j", { ctrlKey: true }), "duplicate"],
    ["Ctrl+G group", k("g", { ctrlKey: true }), "group"],
    ["Ctrl+Shift+G ungroup", k("G", { ctrlKey: true, shiftKey: true }), "ungroup"],
    ["Ctrl+A select all", k("a", { ctrlKey: true }), "select-all"],
    ["Ctrl+D deselect", k("d", { ctrlKey: true }), "deselect"],
    ["Ctrl+Shift+I invert", k("I", { ctrlKey: true, shiftKey: true }), "invert-selection"],
    ["Ctrl+Z undo", k("z", { ctrlKey: true }), "undo"],
    ["Ctrl+Shift+Z redo", k("Z", { ctrlKey: true, shiftKey: true }), "redo"],
    ["Ctrl+Alt+Z steps back", k("z", { ctrlKey: true, altKey: true }), "undo"],
    ["Ctrl+0 fit", k("0", { ctrlKey: true }), "zoom-fit"],
    ["Ctrl+1 100%", k("1", { ctrlKey: true }), "zoom-100"],
    ["Ctrl++ zoom in (Ctrl+=)", k("=", { ctrlKey: true }), "zoom-in"],
    ["Ctrl+- zoom out", k("-", { ctrlKey: true }), "zoom-out"],
    ["Ctrl+] forward", k("]", { ctrlKey: true }), "layer-forward"],
    ["Ctrl+[ backward", k("[", { ctrlKey: true }), "layer-backward"],
    ["Delete", k("Delete"), "delete"],
    ["Backspace", k("Backspace"), "delete"],
    ["arrows", k("ArrowLeft"), "nudge-left"],
    ["Shift+arrows", k("ArrowDown", { shiftKey: true }), "nudge-down"],
    ["Ctrl+C", k("c", { ctrlKey: true }), "copy"],
    ["Ctrl+X", k("x", { ctrlKey: true }), "cut"],
    ["Ctrl+S", k("s", { ctrlKey: true }), "save"],
    ["Ctrl+O", k("o", { ctrlKey: true }), "open-project"],
    ["Shift+T free transform", k("T", { shiftKey: true }), "free-transform"],
    ["Ctrl+T free transform (when the browser lets it through)", k("t", { ctrlKey: true }), "free-transform"],
    ["Shift+W warp (W is the magic wand in Photoshop)", k("W", { shiftKey: true }), "tool-warp"],
    ["A auto candidates", k("a"), "tool-auto"],
    ["N memo", k("n"), "tool-memo"],
    ["⌘Z on a Mac", k("z", { metaKey: true }), "undo"],
  ];
  test.each(table)("%s", (_n, e, action) => expect(ps(e)).toBe(action));

  test("Ctrl+Shift+[ and Ctrl+Shift+] go all the way: the physical key counts, not the character Shift makes of it ({ })", () => {
    expect(ps(k("}", { code: "BracketRight", ctrlKey: true, shiftKey: true }))).toBe("layer-front");
    expect(ps(k("{", { code: "BracketLeft", ctrlKey: true, shiftKey: true }))).toBe("layer-back");
    expect(ps(k("]", { code: "BracketRight", ctrlKey: true }))).toBe("layer-forward");
  });

  test("Korean input on: the physical key decides (ㅠ is B, 'Process' is whatever key, Ctrl+ㅋ is Ctrl+Z)", () => {
    expect(ps(k("ㅠ", { code: "KeyB" }))).toBe("tool-brush");
    expect(ps(k("Process", { code: "KeyV" }))).toBe("tool-select");
    expect(ps(k("ㅋ", { code: "KeyZ", ctrlKey: true }))).toBe("undo");
    expect(ps(k("ㅈ", { code: "KeyW", shiftKey: true }))).toBe("tool-warp");
    expect(ps(k("Process", { code: "Digit0", ctrlKey: true }))).toBe("zoom-fit");
    expect(ps(k("ㅁ", { code: "KeyA", ctrlKey: true }))).toBe("select-all");
  });

  test("keys whose Photoshop function this app does not have are NOT registered: L, W, Z, Ctrl+E, Ctrl+Shift+E do nothing and are listed", () => {
    for (const e of [k("l"), k("w"), k("z"), k("e", { ctrlKey: true }), k("E", { ctrlKey: true, shiftKey: true })]) expect(ps(e)).toBeNull();
    expect(NOT_AVAILABLE.map((x) => x.keys)).toEqual(expect.arrayContaining(["L", "W", "Z", "Ctrl+E", "Ctrl+Shift+E"]));
  });

  test("the shape tools without a key of their own are reached with U; line, rectangle and ellipse have no key here", () => {
    expect(PRESETS.photoshop["tool-line"]).toBeNull();
    expect(PRESETS.photoshop["tool-box"]).toBeNull();
    expect(PRESETS.photoshop["tool-ellipse"]).toBeNull();
    expect(ps(k("l"))).toBeNull();
    expect(ps(k("o"))).toBeNull();
  });

  test("every action has an entry in both presets, and the keys of a preset never collide", () => {
    for (const preset of ["photoshop", "legacy"] as const) {
      const seen = new Map<string, string>();
      for (const a of ACTION_INFO) {
        expect(a.id in PRESETS[preset], `${preset} has ${a.id}`).toBe(true);
        const v = PRESETS[preset][a.id];
        if (!v) continue;
        const text = JSON.stringify(v);
        expect(seen.has(text), `${preset}: ${a.id} vs ${seen.get(text)}`).toBe(false);
        seen.set(text, a.id);
        expect(checkBinding(a.id, v, PRESETS[preset]).ok, `${preset}:${a.id}`).toBe(true);
      }
    }
  });

  test("browser keys: Ctrl+T, N, W (and with Shift) cannot be assigned; Ctrl+S, O, J, 0, 1, +, - can (the page may take them)", () => {
    for (const key of ["t", "n", "w"]) {
      expect(checkBinding("group", { key, ctrl: true, shift: false, alt: false }, PRESETS.photoshop).ok, `Ctrl+${key}`).toBe(false);
      expect(checkBinding("group", { key, ctrl: true, shift: true, alt: false }, PRESETS.photoshop).ok, `Ctrl+Shift+${key}`).toBe(false);
    }
    const free = { ...PRESETS.photoshop, save: null, "open-project": null, duplicate: null, "zoom-fit": null };
    for (const key of ["s", "o", "j", "0"]) expect(checkBinding("tool-line", { key, ctrl: true, shift: false, alt: false }, free).ok, key).toBe(true);
  });
});

describe("the previous layout is kept as the legacy preset", () => {
  test("R extracts, M draws a rectangle, L a line, O a circle, F is the finger, W the warp, Ctrl+D duplicates", () => {
    expect(legacy(k("r"))).toBe("tool-rect");
    expect(legacy(k("m"))).toBe("tool-box");
    expect(legacy(k("l"))).toBe("tool-line");
    expect(legacy(k("o"))).toBe("tool-ellipse");
    expect(legacy(k("f"))).toBe("tool-finger");
    expect(legacy(k("w"))).toBe("tool-warp");
    expect(legacy(k("d", { ctrlKey: true }))).toBe("duplicate");
    expect(legacy(k("y", { ctrlKey: true }))).toBe("redo");
    expect(legacy(k("Backspace"))).toBeNull();
  });
});

describe("switching presets and saving the choice", () => {
  test("the default is Photoshop; a preset change replaces every key and is remembered after a reload; the individual changes are dropped", () => {
    const storage = memory();
    const a = createShortcutStore(storage);
    expect(a.preset()).toBe("photoshop");
    expect(a.set("tool-brush", { key: "q", ctrl: false, shift: false, alt: false }).ok).toBe(true);
    a.setPreset("legacy");
    expect(a.get()).toEqual(PRESETS.legacy);
    const b = createShortcutStore(storage);
    expect(b.preset()).toBe("legacy");
    expect(b.get()["tool-brush"]).toEqual(PRESETS.legacy["tool-brush"]);
    expect(b.get()["tool-rect"]).toEqual({ key: "r", ctrl: false, shift: false, alt: false });
    // changing a key in the legacy preset is stored as a change against LEGACY
    b.set("tool-brush", { key: "q", ctrl: false, shift: false, alt: false });
    const saved = JSON.parse(storage.raw.get(SHORTCUTS_STORAGE_KEY)!);
    expect(saved).toMatchObject({ format: 2, preset: "legacy", bindings: { "tool-brush": { key: "q" } } });
    expect(Object.keys(saved.bindings)).toEqual(["tool-brush"]);
    // back to Photoshop: nothing stored at all
    b.setPreset("photoshop");
    expect(storage.raw.has(SHORTCUTS_STORAGE_KEY)).toBe(false);
  });

  test("reset returns to the CURRENT preset's keys, not to Photoshop's", () => {
    const s = createShortcutStore(memory());
    s.setPreset("legacy");
    s.set("tool-brush", { key: "q", ctrl: false, shift: false, alt: false });
    s.reset();
    expect(s.preset()).toBe("legacy");
    expect(s.get()).toEqual(PRESETS.legacy);
  });

  test("a key can be cleared and the clearing is remembered; an unassigned function can be given a key", () => {
    const storage = memory();
    const s = createShortcutStore(storage);
    s.clear("tool-text");
    expect(s.get()["tool-text"]).toBeNull();
    expect(createShortcutStore(storage).get()["tool-text"]).toBeNull();
    expect(resolveShortcut({ key: "t", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }, s.get(), s.aliases())).toBeNull();
    expect(s.set("tool-line", { key: "l", ctrl: false, shift: false, alt: false }).ok).toBe(true);
    expect(createShortcutStore(storage).get()["tool-line"]).toMatchObject({ key: "l" });
  });

  test("the extra keys (Ctrl+Alt+Z, Ctrl+Y, Backspace, Ctrl+T) work only while their action keeps the preset's key", () => {
    const s = createShortcutStore(memory());
    expect(Object.keys(s.aliases()).sort()).toEqual(["delete", "free-transform", "redo", "undo"]);
    s.set("delete", { key: "d", ctrl: false, shift: true, alt: false });
    expect(Object.keys(s.aliases())).not.toContain("delete");
    expect(liveAliases({ preset: "legacy", bindings: PRESETS.legacy })).toEqual(PRESET_ALIASES.legacy);
  });

  test("a file written before presets (format 1) is not used: the default preset applies", () => {
    const storage = memory();
    storage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify({ format: 1, bindings: { "tool-brush": { key: "q", ctrl: false, shift: false, alt: false } } }));
    const s = createShortcutStore(storage);
    expect(s.preset()).toBe("photoshop");
    expect(s.get()).toEqual(PRESETS.photoshop);
  });
});