import { describe, expect, test } from "vitest";
import { COMMON_STUCK, HELP_ORDER, ONBOARDING, TOOL_HELP, toolTooltip } from "@/features/help/help-content";
import { ACTION_INFO } from "@/features/shortcuts/shortcuts";
import { Tool } from "@/store/editor-store";

/** every tool of the tool rail (the Tool type's members) */
const ALL_TOOLS: Tool[] = ["select", "hand", "rect", "fill", "line", "box", "ellipse", "eyedropper", "brush", "eraser", "text", "memo", "auto", "warp", "finger", "liquify"];

describe("help content", () => {
  test("every tool, the free-transform button and the source panel have help with a summary, when to use it and an example", () => {
    for (const id of [...ALL_TOOLS, "free-transform", "sources"] as const) {
      const h = TOOL_HELP[id];
      expect(h, id).toBeDefined();
      expect(h.label.trim().length, `${id} has no label`).toBeGreaterThan(0);
      for (const field of [h.summary, h.when, h.example]) expect(field.trim().length, `${id} has empty text`).toBeGreaterThan(5);
      expect(HELP_ORDER, id).toContain(id);
    }
    expect(new Set(HELP_ORDER).size).toBe(HELP_ORDER.length);
    expect(HELP_ORDER.length).toBe(ALL_TOOLS.length + 2);
  });

  test("the fill tool's help says what to do when its colour looks wrong (shadows and gradients)", () => {
    expect(TOOL_HELP.fill.summary).toContain("추출 후 채워진 자리를 클릭해 색을 바꿉니다");
    expect(TOOL_HELP.fill.summary).toContain("그림자·그라데이션");
  });

  test("the tools that can be blocked say why: eraser (what it works on), warp (reset first for the brush), finger, region extraction", () => {
    expect(TOOL_HELP.eraser.stuck).toContain("원본");
    expect(TOOL_HELP.warp.stuck).toContain("변형 초기화");
    expect(TOOL_HELP.finger.stuck).toBeTruthy();
    expect(TOOL_HELP.rect.stuck).toContain("스크린샷이 없");
    expect(COMMON_STUCK.map((s) => s.problem).join("\n")).toContain("지우개");
    expect(COMMON_STUCK.map((s) => s.answer).join("\n")).toContain("변형 초기화");
  });

  test("a tooltip is the one-line description, when to use it, and the live key", () => {
    const t = toolTooltip("brush", "B");
    expect(t).toContain(TOOL_HELP.brush.summary);
    expect(t).toContain(TOOL_HELP.brush.when);
    expect(t.endsWith("(B)")).toBe(true);
    expect(toolTooltip("fill", null).endsWith(")")).toBe(false);
  });

  test("a tool help that names an action names one that exists", () => {
    const ids = new Set<string>(ACTION_INFO.map((a) => a.id));
    for (const id of HELP_ORDER) {
      const a = TOOL_HELP[id].action;
      if (a) expect(ids.has(a), `${id} -> ${a}`).toBe(true);
    }
  });

  test("the first-use guide has the four steps: start, extract or insert, move or transform, save the PNG", () => {
    expect(ONBOARDING).toHaveLength(4);
    expect(ONBOARDING.map((s) => s.body).join(" ")).toMatch(/빈 캔버스/);
    expect(ONBOARDING[1].body).toContain("영역 추출");
    expect(ONBOARDING[2].body).toContain("자유 변형");
    expect(ONBOARDING[3].body).toContain("PNG");
  });
});