import { describe, expect, test } from "vitest";
import { Candidate } from "@/lib/image/candidates";
import { resolveShortcut } from "@/features/shortcuts/shortcuts";
import { CARD, splitPage, storeWith } from "./fixtures";

type Ctx = ReturnType<typeof storeWith>;
const cand = (x: number, y: number, width: number, height: number): Candidate => ({ x, y, width, height, pixels: width * height });
/** the button inside the card, the card, and a wider panel that holds the card (the frame is 40 × 30) */
const BUTTON = cand(12, 12, 8, 8);
const CARD_C = cand(CARD.x, CARD.y, CARD.width, CARD.height);
const PANEL = cand(5, 5, 32, 22);
const LIST = [PANEL, CARD_C, BUTTON];

const imageIdOf = (ctx: Ctx) => ctx.get().snapshotProject()!.screens[0].source.imageId;
const withCandidates = (ctx: Ctx = storeWith(), list: Candidate[] = LIST) => {
  ctx.get().setCandidates({ imageId: imageIdOf(ctx), list, ms: 5 });
  return ctx;
};
const pickOf = (ctx: Ctx) => ctx.get().candidatePick;
const layers = (ctx: Ctx) => ctx.get().snapshotProject()!.screens[0].layers;

describe("pickCandidateAt", () => {
  test("the first click takes the smallest candidate under it", () => {
    const ctx = withCandidates();
    expect(ctx.get().pickCandidateAt({ x: 15, y: 15 })).toBe(true);
    expect(pickOf(ctx)).toMatchObject({ rect: { x: 12, y: 12, width: 8, height: 8 }, index: 0, count: 3 });
  });

  test("clicking about the same spot again moves outwards, one candidate at a time, and then starts over", () => {
    const ctx = withCandidates();
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      ctx.get().pickCandidateAt({ x: 15 + (i % 2), y: 15 }); // a pixel either way is still the same spot
      seen.push(pickOf(ctx)!.rect.width);
    }
    expect(seen).toEqual([8, 20, 32, 8]);
    expect(pickOf(ctx)!.index).toBe(0);
  });

  test("a click somewhere else starts again from the smallest there", () => {
    const ctx = withCandidates();
    ctx.get().pickCandidateAt({ x: 15, y: 15 });
    ctx.get().pickCandidateAt({ x: 15, y: 15 });
    expect(pickOf(ctx)!.rect.width).toBe(20);
    ctx.get().pickCandidateAt({ x: 6, y: 6 }); // only the panel is here
    expect(pickOf(ctx)).toMatchObject({ rect: { width: 32 }, index: 0, count: 1 });
  });

  test("a click where there is no candidate chooses nothing and drops an earlier choice", () => {
    const ctx = withCandidates();
    ctx.get().pickCandidateAt({ x: 15, y: 15 });
    expect(ctx.get().pickCandidateAt({ x: 1, y: 1 })).toBe(false);
    expect(pickOf(ctx)).toBeNull();
  });

  test("nothing is chosen before an analysis, for another picture's analysis, for a bad point, or while comparing", () => {
    const ctx = storeWith();
    expect(ctx.get().pickCandidateAt({ x: 15, y: 15 })).toBe(false);
    ctx.get().setCandidates({ imageId: "someone-else", list: LIST, ms: 1 });
    expect(ctx.get().pickCandidateAt({ x: 15, y: 15 })).toBe(false);
    withCandidates(ctx);
    expect(ctx.get().pickCandidateAt({ x: Number.NaN, y: 15 })).toBe(false);
    ctx.get().setCompareMode("split");
    expect(ctx.get().pickCandidateAt({ x: 15, y: 15 })).toBe(false);
    expect(pickOf(ctx)).toBeNull();
  });

  test("a new analysis forgets the old choice", () => {
    const ctx = withCandidates();
    ctx.get().pickCandidateAt({ x: 15, y: 15 });
    withCandidates(ctx);
    expect(pickOf(ctx)).toBeNull();
  });
});

describe("extractCandidatePick: the ordinary extraction, with the candidate's box", () => {
  test("makes a layer cut from exactly that box, with the background patch, as one undo step", () => {
    const ctx = withCandidates();
    const before = ctx.get().history!.past.length;
    ctx.get().pickCandidateAt({ x: 15, y: 15 });
    ctx.get().pickCandidateAt({ x: 15, y: 15 }); // the card
    const result = ctx.get().extractCandidatePick();
    expect(result).toMatchObject({ status: "committed" });
    expect(layers(ctx)).toHaveLength(1);
    expect(layers(ctx)[0].crop).toEqual({ x: CARD.x, y: CARD.y, width: CARD.width, height: CARD.height });
    expect(ctx.get().snapshotProject()!.screens[0].backgroundPatches).toHaveLength(1);
    expect(ctx.get().history!.past.length).toBe(before + 1);
    expect(pickOf(ctx)).toBeNull();
    expect(ctx.get().activeTool).toBe("select");
    ctx.get().undo();
    expect(layers(ctx)).toHaveLength(0);
  });

  test("with nothing chosen it does nothing", () => {
    const ctx = withCandidates();
    expect(ctx.get().extractCandidatePick()).toBeNull();
    expect(layers(ctx)).toHaveLength(0);
  });

  test("when the background cannot be guessed, the colour question is asked first, as for a dragged rectangle; nothing is made yet", () => {
    const ctx = storeWith(splitPage());
    const seam = cand(10, 5, 20, 10); // straddles the red | blue seam of the 40 × 30 picture
    withCandidates(ctx, [seam]);
    ctx.get().pickCandidateAt({ x: 20, y: 10 });
    const result = ctx.get().extractCandidatePick();
    expect(result).toMatchObject({ status: "needs-color" });
    expect(ctx.get().pendingExtraction?.rect).toEqual({ x: 10, y: 5, width: 20, height: 10 });
    expect(layers(ctx)).toHaveLength(0);
    expect(pickOf(ctx)).toBeNull();
  });

  test("refused while comparing, and the choice stays so it can be extracted afterwards", () => {
    const ctx = withCandidates();
    ctx.get().pickCandidateAt({ x: 15, y: 15 });
    ctx.get().setCompareMode("original");
    expect(ctx.get().extractCandidatePick()).toMatchObject({ status: "rejected", reason: "comparing" });
    expect(pickOf(ctx)).not.toBeNull();
    expect(layers(ctx)).toHaveLength(0);
  });

  test("a candidate that does not fit the frame is refused and the choice stays", () => {
    const ctx = withCandidates(storeWith(), [cand(30, 20, 30, 30)]);
    ctx.get().pickCandidateAt({ x: 35, y: 25 });
    expect(ctx.get().extractCandidatePick()).toMatchObject({ status: "rejected", reason: "invalid-rect" });
    expect(pickOf(ctx)).not.toBeNull();
  });
});

describe("hover, tool changes and opening another picture", () => {
  test("hovering lights up the smallest candidate under the pointer; the same one again is not a change; none clears it", () => {
    const ctx = withCandidates();
    ctx.get().hoverCandidateAt({ x: 15, y: 15 });
    expect(ctx.get().candidateHover).toEqual(BUTTON);
    const same = ctx.get().candidateHover;
    ctx.get().hoverCandidateAt({ x: 16, y: 16 });
    expect(ctx.get().candidateHover).toBe(same);
    ctx.get().hoverCandidateAt({ x: 1, y: 1 });
    expect(ctx.get().candidateHover).toBeNull();
    ctx.get().hoverCandidateAt({ x: 15, y: 15 });
    ctx.get().hoverCandidateAt(null);
    expect(ctx.get().candidateHover).toBeNull();
  });

  test("nothing lights up while comparing", () => {
    const ctx = withCandidates();
    ctx.get().setCompareMode("split");
    ctx.get().hoverCandidateAt({ x: 15, y: 15 });
    expect(ctx.get().candidateHover).toBeNull();
  });

  test("leaving the tool drops the choice and the hover; staying on it keeps them", () => {
    const ctx = withCandidates();
    ctx.get().setTool("auto");
    ctx.get().pickCandidateAt({ x: 15, y: 15 });
    ctx.get().hoverCandidateAt({ x: 15, y: 15 });
    ctx.get().setTool("auto");
    expect(pickOf(ctx)).not.toBeNull();
    ctx.get().setTool("select");
    expect(pickOf(ctx)).toBeNull();
    expect(ctx.get().candidateHover).toBeNull();
  });

  test("opening another picture or project forgets the analysis", () => {
    const ctx = withCandidates();
    ctx.get().pickCandidateAt({ x: 15, y: 15 });
    ctx.get().loadProject(ctx.get().snapshotProject()!, ctx.get().images);
    expect(ctx.get().candidates).toBeNull();
    expect(pickOf(ctx)).toBeNull();
    expect(ctx.get().candidateStatus).toBe("idle");
  });

  test("the status and its error text follow what was set", () => {
    const ctx = storeWith();
    ctx.get().setCandidateStatus("running");
    expect(ctx.get().candidateStatus).toBe("running");
    ctx.get().setCandidateStatus("error", "boom");
    expect(ctx.get().candidateError).toBe("boom");
    ctx.get().setCandidateStatus("idle");
    expect(ctx.get().candidateError).toBeNull();
  });
});

describe("keys", () => {
  const key = (k: string, over: object = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over });
  test("A is the tool; Enter extracts and Escape clears (without modifiers)", () => {
    expect(resolveShortcut(key("a"))).toBe("tool-auto");
    expect(resolveShortcut(key("Enter"))).toBe("candidate-extract");
    expect(resolveShortcut(key("Escape"))).toBe("candidate-clear");
    expect(resolveShortcut(key("Enter", { ctrlKey: true }))).toBeNull();
    expect(resolveShortcut(key("Escape", { shiftKey: true }))).toBeNull();
    expect(resolveShortcut(key("a", { ctrlKey: true }))).toBeNull(); // select all stays the browser's
  });
});
