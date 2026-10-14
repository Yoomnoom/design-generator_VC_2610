import { describe, expect, test } from "vitest";
import { toolHint } from "@/features/tool-hints/tool-hints";
import { Tool } from "@/store/editor-store";
import { CARD, committedId, storeWith } from "./fixtures";
import { solid } from "./helpers";

const ALL: Tool[] = ["select", "hand", "rect", "fill", "line", "box", "ellipse", "eyedropper", "brush", "eraser", "text", "memo", "auto", "warp", "finger"];
const state = (ctx: ReturnType<typeof storeWith>) => {
  const s = ctx.get();
  const screen = s.history!.present.screens[0];
  return { screen, selected: screen.layers.filter((l) => s.selectedLayerIds.includes(l.id)), comparing: s.compareMode !== "off" };
};

describe("one line per tool and state", () => {
  test("every tool says something, with and without a project", () => {
    const ctx = storeWith();
    for (const t of ALL) {
      expect(toolHint(t, state(ctx)).text.length, t).toBeGreaterThan(10);
      const none = toolHint(t, { screen: null, selected: [], comparing: false });
      expect(none.usable, t).toBe(false);
      expect(none.text).toContain("새 프로젝트");
    }
  });

  test("fill with no patch says to extract first and then click the filled place; with a patch it is usable", () => {
    const ctx = storeWith();
    const h = toolHint("fill", state(ctx));
    expect(h.usable).toBe(false);
    expect(h.text).toContain("영역 추출");
    expect(h.text).toContain("채워진 자리");
    committedId(ctx.get().beginExtraction(CARD));
    expect(toolHint("fill", state(ctx)).usable).toBe(true);
  });

  test("the eraser says what to select; usable on an extracted bitmap; not on a shape, a locked or a warped layer", () => {
    const ctx = storeWith();
    expect(toolHint("eraser", state(ctx))).toMatchObject({ usable: false });
    expect(toolHint("eraser", state(ctx)).text).toContain("이미지 레이어");
    committedId(ctx.get().beginExtraction(CARD));
    expect(toolHint("eraser", state(ctx)).usable).toBe(true);
    const id = ctx.get().selectedLayerIds[0];
    ctx.get().setLayerLocked(id, true);
    expect(toolHint("eraser", state(ctx)).text).toContain("잠긴");
    ctx.get().setLayerLocked(id, false);
    ctx.get().setLayerWarp(id, { kind: "quad", points: [{ x: 2, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }] });
    expect(toolHint("eraser", state(ctx)).text).toContain("변형");
    const shape = ctx.get().addVectorLayer({ kind: "rect", width: 10, height: 10, stroke: "#000", strokeWidth: 1, fill: null }, 5, 5)!;
    ctx.get().selectLayer(shape);
    expect(toolHint("eraser", state(ctx)).usable).toBe(false);
  });

  test("warp and finger want exactly one unlocked image layer, and say which problem it is", () => {
    const ctx = storeWith();
    for (const t of ["warp", "finger"] as const) {
      expect(toolHint(t, state(ctx)).text).toContain("하나만 선택");
    }
    committedId(ctx.get().beginExtraction(CARD));
    for (const t of ["warp", "finger"] as const) expect(toolHint(t, state(ctx)).usable, t).toBe(true);
    const shape = ctx.get().addVectorLayer({ kind: "rect", width: 10, height: 10, stroke: "#000", strokeWidth: 1, fill: null }, 5, 5)!;
    ctx.get().selectLayer(shape);
    for (const t of ["warp", "finger"] as const) expect(toolHint(t, state(ctx)).text, t).toContain("도형");
    const bm = ctx.get().addImageLayer({ raw: solid(8, 8, [1, 2, 3, 255]), name: "b" })!;
    ctx.get().setLayerLocked(bm, true);
    for (const t of ["warp", "finger"] as const) expect(toolHint(t, state(ctx)).text, t).toContain("잠긴");
  });

  test("a blank canvas: extraction tools say there is no screenshot; comparing: editing tools say to go back to the edited view", () => {
    const ctx = storeWith();
    ctx.get().newBlankProject({ width: 100, height: 100, color: "#ffffff" });
    expect(toolHint("rect", state(ctx)).text).toContain("스크린샷이 없는 화면");
    expect(toolHint("auto", state(ctx)).usable).toBe(false);
    ctx.get().setCompareMode("original");
    for (const t of ["rect", "fill", "line", "brush", "eraser", "text", "warp"] as const) {
      expect(toolHint(t, state(ctx)).text, t).toContain("비교 보기");
    }
    expect(toolHint("select", state(ctx)).usable).toBe(true); // selecting and the hand still work
    expect(toolHint("hand", state(ctx)).usable).toBe(true);
    expect(solid(1, 1, [0, 0, 0, 0])).toBeTruthy();
  });
});