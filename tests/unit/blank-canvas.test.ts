import { describe, expect, test } from "vitest";
import { BUILTIN_ASSETS } from "@/features/assets/builtin";
import { buildTemplate } from "@/features/assets/templates";
import { renderProjectRaw } from "@/features/export-image/export-png";
import { BLANK_FILE, checkCanvasSize, isGeneratedPage } from "@/lib/project/blank";
import { parseProject, serializeProject } from "@/lib/project/parse";
import { createEditorStore } from "@/store/editor-store";
import { storeWith } from "./fixtures";
import { getPixel } from "./helpers";

const blank = (width = 390, height = 844, color = "#ffffff") => {
  const ctx = createEditorStore();
  const why = ctx.getState().newBlankProject({ width, height, color });
  return { ctx, why };
};
const frame = (ctx: ReturnType<typeof createEditorStore>) => ctx.getState().history!.present.screens[0];
const png = (ctx: ReturnType<typeof createEditorStore>) => renderProjectRaw(ctx.getState().snapshotProject()!, ctx.getState().images, () => null);

describe("canvas size rules", () => {
  test("whole pixels from 1 to 8192 on each side; anything else is refused with a reason", () => {
    expect(checkCanvasSize(390, 844)).toEqual({ ok: true, width: 390, height: 844 });
    expect(checkCanvasSize("1440", " 900 ")).toEqual({ ok: true, width: 1440, height: 900 });
    expect(checkCanvasSize(8192, 8192).ok).toBe(true);
    expect(checkCanvasSize(1, 1).ok).toBe(true);
    for (const [w, h] of [[8193, 100], [100, 8193], [0, 10], [10, 0], [-5, 10], [10.5, 10], ["abc", 10], ["", 10], [NaN, 10], [Infinity, 10], [null, 10], [undefined, 10]] as const) {
      const r = checkCanvasSize(w, h);
      expect(r.ok, `${String(w)} x ${String(h)}`).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(5);
    }
  });
});

describe("blank canvas project", () => {
  test("has the chosen size, one plain source picture, one patch over the whole frame in the chosen colour, and a valid file", () => {
    const { ctx, why } = blank(390, 844, "#336699");
    expect(why).toBeNull();
    const s = frame(ctx);
    expect([s.width, s.height]).toEqual([390, 844]);
    expect(s.source.fileName).toBe(BLANK_FILE);
    expect(s.backgroundPatches).toHaveLength(1);
    expect(s.backgroundPatches[0]).toMatchObject({ rect: { x: 0, y: 0, width: 390, height: 844 }, fill: "#336699" });
    expect(ctx.getState().history!.past).toHaveLength(0);
    const text = serializeProject(ctx.getState().snapshotProject()!);
    expect(parseProject(text).ok).toBe(true);
  });

  test("the PNG is the chosen size and every pixel is the chosen colour, opaque", () => {
    for (const [w, h, c, rgb] of [[390, 844, "#336699", [51, 102, 153]], [1440, 900, "#fff", [255, 255, 255]], [7, 3, "#FF0000", [255, 0, 0]]] as const) {
      const { ctx, why } = blank(w, h, c);
      expect(why).toBeNull();
      const out = png(ctx);
      expect([out.width, out.height]).toEqual([w, h]);
      for (const [x, y] of [[0, 0], [w - 1, h - 1], [Math.floor(w / 2), Math.floor(h / 2)]]) expect(getPixel(out, x, y)).toEqual([...rgb, 255]);
    }
  });

  test("a bad size or colour is refused and nothing changes (an open project stays as it is)", () => {
    const ctx = storeWith();
    const before = ctx.get().history;
    for (const [w, h, c] of [[8193, 10, "#fff"], [0, 10, "#fff"], [10, 10.5, "#fff"], [10, 10, "red"], [10, 10, "#12"], [10, 10, ""]] as const) {
      expect(ctx.get().newBlankProject({ width: w, height: h, color: c }), `${w} ${h} ${c}`).not.toBeNull();
    }
    expect(ctx.get().history).toBe(before);
  });

  test("the background colour can be changed later with the patch colour action: one undo step, and the PNG follows", () => {
    const { ctx } = blank(40, 30, "#ffffff");
    const patchId = frame(ctx).backgroundPatches[0].id;
    expect(ctx.getState().setPatchColor(patchId, "#00ff00")).toBe(true);
    expect(ctx.getState().history!.past).toHaveLength(1);
    expect(getPixel(png(ctx), 5, 5)).toEqual([0, 255, 0, 255]);
    ctx.getState().undo();
    expect(getPixel(png(ctx), 5, 5)).toEqual([255, 255, 255, 255]);
  });

  test("sources and templates go in on a blank canvas, and the PNG keeps the canvas size", () => {
    const { ctx } = blank(400, 300, "#eeeeee");
    for (const a of BUILTIN_ASSETS.slice(0, 3)) expect(ctx.getState().insertAsset(a.build(), "center")).not.toBeNull();
    expect(frame(ctx).layers.length).toBeGreaterThan(3);
    const out = renderProjectRaw(ctx.getState().snapshotProject()!, ctx.getState().images, (c, t) => ({ image: { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(9) }, x: Math.round(t.x), y: Math.round(t.y) }));
    expect([out.width, out.height]).toEqual([400, 300]);
  });
});

describe("tools that need a screenshot", () => {
  test("on a blank canvas or a template, region extraction and auto candidates do not start, and the reason is shown", () => {
    const { ctx } = blank();
    for (const tool of ["rect", "auto"] as const) {
      ctx.getState().setNotice(null);
      ctx.getState().setTool(tool);
      expect(ctx.getState().activeTool, tool).not.toBe(tool);
      expect(ctx.getState().notice, tool).toContain("스크린샷");
    }
    ctx.getState().setTool("box"); // drawing tools still work
    expect(ctx.getState().activeTool).toBe("box");

    const t = createEditorStore();
    const { project, images } = buildTemplate("login");
    t.getState().loadProject(project, images);
    t.getState().setTool("rect");
    expect(t.getState().activeTool).not.toBe("rect");
  });

  test("with a real capture they work as before; a capture whose file name merely looks generated is the only thing that decides", () => {
    const ctx = storeWith();
    ctx.get().setTool("rect");
    expect(ctx.get().activeTool).toBe("rect");
    ctx.get().setTool("auto");
    expect(ctx.get().activeTool).toBe("auto");
    expect(isGeneratedPage("capture.png")).toBe(false);
    expect(isGeneratedPage("my-template.png")).toBe(false);
    expect(isGeneratedPage(BLANK_FILE)).toBe(true);
    expect(isGeneratedPage("slc-template-login.png")).toBe(true);
  });
});
