import { describe, expect, test } from "vitest";
import { DEFAULT_SWATCHES, MAX_SWATCHES, SWATCHES_KEY, createSwatchStore, parseSwatches } from "@/features/swatches/swatches";
import { storeWith } from "./fixtures";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), raw: m };
};

describe("colour swatches (a browser setting)", () => {
  test("they start as the defaults; adding, removing and a reload keep the list; the list never goes into a project", () => {
    const storage = memory();
    const s = createSwatchStore(storage);
    expect(s.get()).toEqual(DEFAULT_SWATCHES);
    expect(s.add("#123456")).toBe(true);
    expect(s.add("#ABCDEF")).toBe(true);
    expect(s.get().slice(-2)).toEqual(["#123456", "#abcdef"]); // stored in the normal form
    s.remove("#ffffff");
    const again = createSwatchStore(storage);
    expect(again.get()).toEqual(s.get());
    expect(again.get()).not.toContain("#ffffff");
    expect(JSON.parse(storage.raw.get(SWATCHES_KEY)!)).toMatchObject({ format: 1 });
    s.reset();
    expect(s.get()).toEqual(DEFAULT_SWATCHES);
    expect(storage.raw.has(SWATCHES_KEY)).toBe(false);
  });
  test("a repeat, a non-colour and a full palette are refused", () => {
    const s = createSwatchStore(memory());
    expect(s.add("#000000")).toBe(false);
    expect(s.add("red")).toBe(false);
    expect(s.add("")).toBe(false);
    for (let i = 0; s.get().length < MAX_SWATCHES; i++) s.add(`#${(0x100000 + i * 997).toString(16).padStart(6, "0")}`);
    expect(s.get()).toHaveLength(MAX_SWATCHES);
    expect(s.add("#abcdef")).toBe(false);
  });
  test("a damaged or foreign saved list is cleaned or replaced by the defaults; blocked storage still works for the page", () => {
    expect(parseSwatches("{nope")).toEqual(DEFAULT_SWATCHES);
    expect(parseSwatches(JSON.stringify({ format: 2, colors: ["#111111"] }))).toEqual(DEFAULT_SWATCHES);
    expect(parseSwatches(JSON.stringify({ format: 1, colors: ["#111111", "#111111", 5, "zzz", "#222"] }))).toEqual(["#111111", "#222222"]);
    expect(parseSwatches(null)).toEqual(DEFAULT_SWATCHES);
    const blocked = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); }, removeItem: () => { throw new Error("no"); } };
    const s = createSwatchStore(blocked);
    expect(s.get()).toEqual(DEFAULT_SWATCHES);
    expect(s.add("#010203")).toBe(true);
    expect(s.get()).toContain("#010203");
    let n = 0;
    const off = s.subscribe(() => n++);
    s.add("#040506");
    off();
    s.add("#070809");
    expect(n).toBe(1);
  });
});

describe("the grid", () => {
  test("it is an editing aid: off by default, size clamped to 2..512, never part of the project history", () => {
    const c = storeWith();
    expect(c.get().grid).toEqual({ on: false, size: 16, snap: false });
    const history = c.get().history;
    c.get().setGrid({ on: true, size: 32, snap: true });
    expect(c.get().grid).toEqual({ on: true, size: 32, snap: true });
    c.get().setGrid({ size: 1 });
    expect(c.get().grid.size).toBe(2);
    c.get().setGrid({ size: 99999 });
    expect(c.get().grid.size).toBe(512);
    c.get().setGrid({ size: NaN });
    expect(c.get().grid.size).toBe(16);
    expect(c.get().history).toBe(history);
  });
});