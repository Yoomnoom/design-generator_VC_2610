import { describe, expect, test } from "vitest";
import { FOLDED_WIDTH, PANELS_STORAGE_KEY, PANEL_LIMITS, clampWidth, columnWidth, createPanelStore, defaultLayout, draggedWidth, isOpen, parseStoredLayout } from "@/features/panels/panel-layout";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe("panel widths", () => {
  test("clamped to the limits; a non-number is the default", () => {
    expect(clampWidth("left", 10)).toBe(PANEL_LIMITS.left.min);
    expect(clampWidth("left", 9999)).toBe(PANEL_LIMITS.left.max);
    expect(clampWidth("right", 300.4)).toBe(300);
    expect(clampWidth("right", NaN)).toBe(PANEL_LIMITS.right.default);
  });
  test("dragging the left panel's edge right widens it, the right panel's edge left widens it; both stop at the limits", () => {
    expect(draggedWidth("left", 248, 40)).toBe(288);
    expect(draggedWidth("right", 282, -40)).toBe(322);
    expect(draggedWidth("left", 248, -500)).toBe(PANEL_LIMITS.left.min);
    expect(draggedWidth("right", 282, -500)).toBe(PANEL_LIMITS.right.max);
  });
});

describe("open or folded", () => {
  test("automatic: open when the window is wide enough; the user's choice wins", () => {
    const auto = { open: null, width: 248 };
    expect(isOpen("left", auto, 1280)).toBe(true);
    expect(isOpen("left", auto, 900)).toBe(false);
    expect(isOpen("right", auto, 1100)).toBe(false);
    expect(isOpen("right", auto, 1280)).toBe(true);
    expect(isOpen("left", { open: true, width: 248 }, 600)).toBe(true);
    expect(isOpen("left", { open: false, width: 248 }, 1920)).toBe(false);
  });
  test("a folded panel leaves a thin bar", () => {
    expect(columnWidth("left", { open: false, width: 300 }, 1280)).toBe(FOLDED_WIDTH);
    expect(columnWidth("left", { open: true, width: 300 }, 1280)).toBe(300);
  });
});

describe("the stored layout", () => {
  test("round trip; the default layout stores nothing", () => {
    const s = memory();
    const store = createPanelStore(s);
    expect(s.m.size).toBe(0);
    store.setWidth("left", 320);
    store.setOpen("right", false);
    expect(JSON.parse(s.m.get(PANELS_STORAGE_KEY)!)).toMatchObject({ format: 1, left: { width: 320 }, right: { open: false } });
    const again = createPanelStore(s);
    expect(again.get().left.width).toBe(320);
    expect(again.get().right.open).toBe(false);
    again.setWidth("left", PANEL_LIMITS.left.default);
    again.setOpen("right", null as never);
    expect(s.m.size).toBe(0);
  });
  test("toggle from automatic goes the other way from what is shown", () => {
    const store = createPanelStore(memory());
    store.toggle("left", 1280); // shown open -> folded
    expect(store.get().left.open).toBe(false);
    store.toggle("left", 1280);
    expect(store.get().left.open).toBe(true);
    const narrow = createPanelStore(memory());
    narrow.toggle("left", 800); // automatic fold -> open
    expect(narrow.get().left.open).toBe(true);
  });
  test("damaged or out-of-range values are replaced one by one", () => {
    expect(parseStoredLayout("not json")).toEqual(defaultLayout());
    expect(parseStoredLayout(JSON.stringify({ format: 2, left: { width: 300 } }))).toEqual(defaultLayout());
    const l = parseStoredLayout(JSON.stringify({ format: 1, left: { open: "yes", width: 99999 }, right: { open: false, width: "wide" } }));
    expect(l.left).toEqual({ open: null, width: PANEL_LIMITS.left.max });
    expect(l.right).toEqual({ open: false, width: PANEL_LIMITS.right.default });
  });
  test("a blocked storage still works for the page", () => {
    const store = createPanelStore({ getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } });
    store.setWidth("left", 300);
    expect(store.get().left.width).toBe(300);
  });
});
