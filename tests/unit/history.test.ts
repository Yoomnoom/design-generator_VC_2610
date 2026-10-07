import { describe, expect, test } from "vitest";
import { HISTORY_LIMIT, canRedo, canUndo, commit, createHistory, redo, undo } from "@/store/history";
import { addOnTop } from "@/features/layer-transform/order";
import { makeLayer, makeProject } from "./helpers";

type S = { n: number; items: string[] };
const init = (): S => ({ n: 0, items: [] });

describe("history", () => {
  test("commit, undo, redo", () => {
    let h = createHistory(init());
    h = commit(h, "add", (d) => void d.items.push("a"));
    h = commit(h, "n", (d) => void (d.n = 5));
    expect(h.present).toEqual({ n: 5, items: ["a"] });
    h = undo(h);
    expect(h.present).toEqual({ n: 0, items: ["a"] });
    h = undo(h);
    expect(h.present).toEqual(init());
    expect(canUndo(h)).toBe(false);
    h = redo(redo(h));
    expect(h.present).toEqual({ n: 5, items: ["a"] });
    expect(canRedo(h)).toBe(false);
  });

  test("a new commit discards the redo branch", () => {
    let h = createHistory(init());
    h = commit(h, "a", (d) => void d.items.push("a"));
    h = undo(h);
    h = commit(h, "b", (d) => void d.items.push("b"));
    expect(canRedo(h)).toBe(false);
    expect(h.present.items).toEqual(["b"]);
  });

  test("a recipe that changes nothing records nothing", () => {
    const h = createHistory(init());
    expect(commit(h, "noop", () => {})).toBe(h);
    expect(commit(h, "same", (d) => void (d.n = 0))).toBe(h);
  });

  test("undo/redo with nothing to do returns the same history", () => {
    const h = createHistory(init());
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  test("60 steps can all be undone and redone (requirement: 50+)", () => {
    let h = createHistory(init());
    for (let i = 1; i <= 60; i++) h = commit(h, `step ${i}`, (d) => void (d.n = i));
    for (let i = 0; i < 60; i++) h = undo(h);
    expect(h.present.n).toBe(0);
    for (let i = 0; i < 60; i++) h = redo(h);
    expect(h.present.n).toBe(60);
  });

  test(`oldest steps drop beyond ${HISTORY_LIMIT}`, () => {
    let h = createHistory(init());
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = commit(h, `step ${i}`, (d) => void (d.n = i));
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    for (let i = 0; i < HISTORY_LIMIT; i++) h = undo(h);
    expect(h.present.n).toBe(20);
  });

  test("entries are small serialisable patches, not copies of the document", () => {
    let h = createHistory(makeProject());
    h = commit(h, "extract", (d) => {
      d.screens[0].layers = addOnTop(d.screens[0].layers, makeLayer("a", 0));
    });
    const entry = h.past[0];
    expect(() => JSON.stringify(entry)).not.toThrow();
    expect(JSON.stringify(entry)).not.toContain("blob:");
    expect(JSON.stringify(entry).length).toBeLessThan(1500);
  });

  test("a project edit (layer + patch in one step) undoes as one", () => {
    let h = createHistory(makeProject());
    h = commit(h, "extract", (d) => {
      const s = d.screens[0];
      s.layers = addOnTop(s.layers, makeLayer("a", 0));
      s.backgroundPatches.push({ id: "bp2", rect: { x: 0, y: 0, width: 5, height: 5 }, fill: "#ffffff" });
    });
    expect(h.present.screens[0].layers).toHaveLength(1);
    expect(h.present.screens[0].backgroundPatches).toHaveLength(2);
    h = undo(h);
    expect(h.present).toEqual(makeProject());
  });
});
