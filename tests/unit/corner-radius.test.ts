import fs from "node:fs";
import { describe, expect, test } from "vitest";
import { BUILTIN_ASSETS, RADIUS, SOFT } from "@/features/assets/builtin";
import { TEMPLATES, buildTemplate } from "@/features/assets/templates";
import { parseProjectFile } from "@/features/project-persistence/project-file";
import { DrawCtx, cornerRadiusOf, drawContent, maxCornerRadius, roundedRectPath, withSize } from "@/lib/image/vector";
import { contentError, parseProject, serializeProject } from "@/lib/project/parse";
import { migrate } from "@/lib/project/migrate";
import { LayerContent } from "@/lib/project/schema";
import { solid } from "./helpers";
import { storeWith } from "./fixtures";

const rect = (o: Partial<Extract<LayerContent, { kind: "rect" }>> = {}): LayerContent => ({ kind: "rect", width: 100, height: 60, fill: "#336699", stroke: null, strokeWidth: 0, ...o });

/** a drawing context that only writes down the path it is given */
function recorder() {
  const ops: string[] = [];
  const f = (n: number) => String(Math.round(n * 100) / 100);
  const ctx = {
    beginPath: () => ops.push("begin"),
    closePath: () => ops.push("close"),
    rect: (x: number, y: number, w: number, h: number) => ops.push(`rect ${f(x)} ${f(y)} ${f(w)} ${f(h)}`),
    moveTo: (x: number, y: number) => ops.push(`M ${f(x)} ${f(y)}`),
    lineTo: (x: number, y: number) => ops.push(`L ${f(x)} ${f(y)}`),
    arc: (x: number, y: number, r: number, s: number, e: number) => ops.push(`arc ${f(x)} ${f(y)} r${f(r)} ${f(s / Math.PI)}pi>${f(e / Math.PI)}pi`),
    ellipse: () => ops.push("ellipse"),
    fill: () => ops.push("fill"),
    stroke: () => ops.push("stroke"),
    fillText: () => {},
    measureText: () => ({ width: 1 }),
  } as unknown as DrawCtx;
  return { ctx, ops };
}

describe("the rounded rectangle path", () => {
  test("radius 0 (or none) is the plain rectangle, exactly as before", () => {
    for (const c of [rect(), rect({ cornerRadius: 0 })]) {
      const { ctx, ops } = recorder();
      drawContent(ctx, c);
      expect(ops).toEqual(["begin", "rect 0 0 100 60", "fill"]);
    }
  });

  test("a radius makes four arcs centred one radius in from each corner, joined by straight edges", () => {
    const { ctx, ops } = recorder();
    roundedRectPath(ctx, 100, 60, 10);
    expect(ops).toEqual(["M 10 0", "L 90 0", "arc 90 10 r10 -0.5pi>0pi", "L 100 50", "arc 90 50 r10 0pi>0.5pi", "L 10 60", "arc 10 50 r10 0.5pi>1pi", "L 0 10", "arc 10 10 r10 1pi>1.5pi", "close"]);
  });

  test("the radius never passes half of the shorter side, so a huge value makes a pill and never overlaps", () => {
    expect(cornerRadiusOf(rect({ cornerRadius: 500 }))).toBe(30);
    const { ctx, ops } = recorder();
    roundedRectPath(ctx, 100, 60, 500);
    expect(ops.some((o) => o.startsWith("arc 70 30 r30"))).toBe(true);
    expect(cornerRadiusOf(rect({ cornerRadius: -4 }))).toBe(0);
    expect(maxCornerRadius(100, 60)).toBe(30);
    expect(maxCornerRadius(7, 3)).toBe(1.5);
  });

  test("a rounded rectangle is drawn with fill and stroke on the same path; an ellipse and a line have no radius", () => {
    const { ctx, ops } = recorder();
    drawContent(ctx, rect({ cornerRadius: 8, stroke: "#000", strokeWidth: 2 }));
    expect(ops[0]).toBe("begin");
    expect(ops.filter((o) => o.startsWith("arc")).length).toBe(4);
    expect(ops.slice(-2)).toEqual(["fill", "stroke"]);
    expect(cornerRadiusOf({ kind: "ellipse", width: 10, height: 10, fill: "#000", stroke: null, strokeWidth: 0 })).toBe(0);
  });
});

describe("the radius in the file", () => {
  const bad = (c: Record<string, unknown>) => contentError({ ...rect(), ...c });
  test("accepted: none, 0, up to half of the shorter side; refused: negative, beyond half, not a number, on another shape", () => {
    expect(contentError(rect())).toBeNull();
    expect(contentError(rect({ cornerRadius: 0 }))).toBeNull();
    expect(contentError(rect({ cornerRadius: 12.5 }))).toBeNull();
    expect(contentError(rect({ cornerRadius: 30 }))).toBeNull(); // exactly half of 60
    expect(bad({ cornerRadius: -1 })).toContain("cornerRadius");
    expect(bad({ cornerRadius: 30.5 })).toContain("cornerRadius");
    expect(bad({ cornerRadius: "8" })).toContain("cornerRadius");
    expect(bad({ cornerRadius: NaN })).toContain("cornerRadius");
    expect(contentError({ kind: "ellipse", width: 10, height: 10, fill: "#000", stroke: null, strokeWidth: 0, cornerRadius: 2 })).toContain("사각형에만");
    expect(contentError({ kind: "line", width: 10, height: 10, direction: "down", stroke: "#000", strokeWidth: 1, cornerRadius: 2 })).toContain("사각형에만");
  });

  test("saved and opened again: the radius comes back as it was, in a layer and in the project text", () => {
    const ctx = storeWith(solid(300, 200, [255, 255, 255, 255]));
    const id = ctx.get().addVectorLayer(rect({ cornerRadius: 12 }), 10, 10)!;
    const text = serializeProject(ctx.get().snapshotProject()!);
    expect(JSON.parse(text).version).toBe(11);
    const back = parseProject(text);
    expect(back.ok && (back.project.screens[0].layers.find((l) => l.id === id)!.content as { cornerRadius?: number }).cornerRadius).toBe(12);
  });
});

describe("older files: version 8 opens as version 9 with nothing changed", () => {
  const v8 = fs.readFileSync("tests/fixtures/project-v8.slc.json", "utf8");
  test("the file the previous build saved has groups, no radius", () => {
    const p = JSON.parse(v8).project;
    expect(p.version).toBe(8);
    expect(p.screens[0].groups).toHaveLength(1);
    expect(p.screens[0].layers.some((l: { groupId?: string }) => l.groupId)).toBe(true);
    expect(JSON.stringify(p)).not.toContain("cornerRadius");
  });
  test("it opens as version 9: layers, groups and memos untouched; the rectangle layers stay square", () => {
    const before = JSON.parse(v8).project;
    const r = parseProjectFile(v8);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { project } = r.file;
    expect(project.version).toBe(11);
    expect(project.screens[0].layers).toEqual(before.screens[0].layers);
    expect(project.screens[0].groups).toEqual(before.screens[0].groups);
    expect(project.name).toBe(before.name);
    expect(project.canvas).toEqual(before.canvas);
    expect(project.screens[0].layers.filter((l) => l.content?.kind === "rect").every((l) => cornerRadiusOf(l.content!) === 0)).toBe(true);
    const m = migrate(before);
    expect(m.ok && m.doc.version).toBe(11);
  });
});

describe("setting the radius", () => {
  const page = () => {
    const ctx = storeWith(solid(300, 200, [255, 255, 255, 255]));
    const id = ctx.get().addVectorLayer(rect(), 10, 10)!;
    return { ctx, id };
  };
  const content = (ctx: ReturnType<typeof page>["ctx"], id: string) => ctx.get().history!.present.screens[0].layers.find((l) => l.id === id)!.content as { cornerRadius?: number };

  test("one undo step; the value is rounded and kept between 0 and half of the shorter side; 0 means none", () => {
    const { ctx, id } = page();
    const past = ctx.get().history!.past.length;
    expect(ctx.get().setLayerContent(id, { cornerRadius: 12.345 })).toBe(true);
    expect(content(ctx, id).cornerRadius).toBe(12.35);
    expect(ctx.get().history!.past).toHaveLength(past + 1);
    ctx.get().setLayerContent(id, { cornerRadius: 999 });
    expect(content(ctx, id).cornerRadius).toBe(30);
    ctx.get().setLayerContent(id, { cornerRadius: -5 });
    expect("cornerRadius" in content(ctx, id)).toBe(false);
    ctx.get().setLayerContent(id, { cornerRadius: NaN });
    expect("cornerRadius" in content(ctx, id)).toBe(false);
    ctx.get().setLayerContent(id, { cornerRadius: 8 });
    ctx.get().undo();
    expect("cornerRadius" in content(ctx, id)).toBe(false);
    ctx.get().redo();
    expect(content(ctx, id).cornerRadius).toBe(8);
  });

  test("setting the same value again records nothing", () => {
    const { ctx, id } = page();
    ctx.get().setLayerContent(id, { cornerRadius: 8 });
    const past = ctx.get().history!.past.length;
    expect(ctx.get().setLayerContent(id, { cornerRadius: 8 })).toBe(false);
    expect(ctx.get().setLayerContent(id, { cornerRadius: 0 })).toBe(true);
    expect(ctx.get().setLayerContent(id, { cornerRadius: 0 })).toBe(false);
    expect(ctx.get().history!.past).toHaveLength(past + 1);
  });

  test("while the slider is dragged the preview changes and the history does not; the commit is one step", () => {
    const { ctx, id } = page();
    const past = ctx.get().history!.past.length;
    const before = ctx.get().history;
    for (const r of [2, 6, 11, 17]) ctx.get().setCornerPreview({ layerId: id, cornerRadius: r });
    expect(ctx.get().history).toBe(before);
    expect(ctx.get().cornerPreview).toEqual({ layerId: id, cornerRadius: 17 });
    ctx.get().setLayerContent(id, { cornerRadius: 17 });
    ctx.get().setCornerPreview(null);
    expect(ctx.get().history!.past).toHaveLength(past + 1);
    expect(content(ctx, id).cornerRadius).toBe(17);
  });

  test("refused on an ellipse, a line and a text box, on a locked layer and while comparing; nothing changes", () => {
    const { ctx, id } = page();
    const ell = ctx.get().addVectorLayer({ kind: "ellipse", width: 40, height: 40, fill: "#000", stroke: null, strokeWidth: 0 }, 5, 5)!;
    const line = ctx.get().addVectorLayer({ kind: "line", width: 40, height: 40, direction: "down", stroke: "#000", strokeWidth: 2 }, 5, 5)!;
    const before = ctx.get().history;
    expect(ctx.get().setLayerContent(ell, { cornerRadius: 5 })).toBe(false);
    expect(ctx.get().setLayerContent(line, { cornerRadius: 5 })).toBe(false);
    ctx.get().setLayerLocked(id, true);
    const afterLock = ctx.get().history;
    expect(ctx.get().setLayerContent(id, { cornerRadius: 5 })).toBe(false);
    ctx.get().setLayerLocked(id, false);
    ctx.get().setCompareMode("original");
    const cmp = ctx.get().history;
    expect(ctx.get().setLayerContent(id, { cornerRadius: 5 })).toBe(false);
    expect(ctx.get().history).toBe(cmp);
    expect(before).not.toBe(afterLock); // (locking itself is a step)
  });
});

describe("resizing", () => {
  test("the radius stays the same in pixels while the box is big enough, and shrinks to half of the shorter side when it is not", () => {
    expect(withSize(rect({ cornerRadius: 10 }), 200, 120)).toMatchObject({ width: 200, height: 120, cornerRadius: 10 });
    expect(withSize(rect({ cornerRadius: 10 }), 100, 12)).toMatchObject({ cornerRadius: 6 });
    expect(withSize(rect(), 50, 50)).not.toHaveProperty("cornerRadius");
  });

  test("through the store: a handle resize keeps the radius in pixels (clamped), the scale stays 1, one undo step", () => {
    const ctx = storeWith(solid(300, 200, [255, 255, 255, 255]));
    const id = ctx.get().addVectorLayer(rect({ cornerRadius: 20 }), 10, 10)!;
    const t = ctx.get().history!.present.screens[0].layers[0].transform;
    const past = ctx.get().history!.past.length;
    ctx.get().transformLayer(id, { ...t, scaleX: 2, scaleY: 0.5 });
    const l = ctx.get().history!.present.screens[0].layers[0];
    expect(l.transform.scaleX).toBe(1);
    expect(l.content).toMatchObject({ width: 200, height: 30, cornerRadius: 15 }); // 20 does not fit in a 30px-high box: half of it
    expect(ctx.get().history!.past).toHaveLength(past + 1);
    ctx.get().undo();
    expect(ctx.get().history!.present.screens[0].layers[0].content).toMatchObject({ width: 100, height: 60, cornerRadius: 20 });
  });
});

describe("built-in sources and templates are rounded", () => {
  const radii = (layers: { content?: LayerContent }[]) => layers.map((l) => (l.content ? cornerRadiusOf(l.content) : 0));
  test("buttons (fill, outline, slide), card, input and tag have rounded corners; the shadow and its soft edge follow the shape", () => {
    const get = (id: string) => BUILTIN_ASSETS.find((a) => a.id === id)!.build().layers;
    for (const state of ["rest", "hover", "pressed"]) {
      const fill = get(`button-fill-${state}`);
      expect(fill.map((l) => l.name).slice(0, 3)).toEqual([SOFT, "그림자", "버튼 바탕"]);
      expect(cornerRadiusOf(fill[2].content!)).toBe(RADIUS);
      expect(cornerRadiusOf(fill[1].content!)).toBe(RADIUS); // the shadow has the button's corners
      expect(cornerRadiusOf(fill[0].content!)).toBeGreaterThan(RADIUS); // and its soft edge is a larger, rounder copy
      expect(cornerRadiusOf(get(`button-outline-${state}`)[0].content!)).toBe(RADIUS);
      expect(cornerRadiusOf(get(`button-slide-${state}`)[0].content!)).toBe(RADIUS);
    }
    const card = get("card");
    expect(card.map((l) => l.name).slice(0, 3)).toEqual([SOFT, "카드 그림자", "카드"]);
    expect(radii(card).slice(0, 3)).toEqual([15, 12, 12]);
    expect(cornerRadiusOf(get("input").find((l) => l.name === "입력창")!.content!)).toBe(RADIUS);
    expect(cornerRadiusOf(get("tag")[0].content!)).toBe(13); // half of its height: a pill
    expect(radii(get("divider"))).toEqual([0]);
    for (const icon of BUILTIN_ASSETS.filter((a) => a.group === "icon")) expect(radii(icon.build().layers).every((r) => r === 0), icon.id).toBe(true);
  });

  test("every built-in is still valid (every radius fits its box), and the templates are rounded and open as valid projects", () => {
    for (const a of BUILTIN_ASSETS) for (const l of a.build().layers) expect(contentError(l.content), `${a.id}/${l.name}`).toBeNull();
    for (const t of TEMPLATES) {
      const { project } = buildTemplate(t.id);
      expect(project.version).toBe(11);
      const rounded = project.screens[0].layers.filter((l) => l.content && cornerRadiusOf(l.content) > 0);
      expect(rounded.length, t.id).toBeGreaterThanOrEqual(3);
      if (t.id === "cards") expect(project.screens[0].layers.filter((l) => /^카드 \d$/.test(l.name)).map((l) => cornerRadiusOf(l.content!))).toEqual([12, 12, 12]);
      expect(parseProject(serializeProject(project)).ok, t.id).toBe(true);
    }
  });
});
