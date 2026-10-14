import { describe, expect, test } from "vitest";
import { LIQUIFY_MODE_LABEL, liquifyTargetProblem, startLiquifyStroke } from "@/features/liquify/liquify";
import { bitmapMapper } from "@/features/smudge/finger";
import { renderProjectRaw } from "@/features/export-image/export-png";
import { toolHint } from "@/features/tool-hints/tool-hints";
import { parseProject, serializeProject } from "@/lib/project/parse";
import { getPixel, setPixel, solid } from "./helpers";
import { CARD, committedId, storeWith } from "./fixtures";

type Ctx = ReturnType<typeof storeWith>;
const bars = () => {
  const raw = solid(120, 60, [0, 0, 255, 255]);
  for (let y = 0; y < 60; y++) for (let x = 40; x < 60; x++) setPixel(raw, x, y, [255, 0, 0, 255]);
  return raw;
};
/** a page with one pasted bitmap layer (the red bar on blue) at (100, 100) */
function withLayer() {
  const ctx = storeWith(solid(400, 300, [240, 240, 240, 255]));
  const id = ctx.get().addImageLayer({ raw: bars(), name: "bars" })!;
  ctx.get().transformLayer(id, { x: 100, y: 100, scaleX: 1, scaleY: 1, rotation: 0 });
  return { ctx, id };
}
const layer = (c: Ctx, id: string) => c.get().history!.present.screens[0].layers.find((l) => l.id === id)!;
const drag = (c: Ctx, id: string, from: { x: number; y: number }, to: { x: number; y: number }) => {
  const s = startLiquifyStroke(c.store, id);
  if (!s.ok) return s;
  for (let i = 0; i <= 30; i++) s.stroke.move({ x: from.x + ((to.x - from.x) * i) / 30, y: from.y + ((to.y - from.y) * i) / 30 });
  return { ...s, kept: s.stroke.finish() };
};
const redCentre = (raw: { width: number; height: number; data: Uint8ClampedArray }, y = 30) => {
  let s = 0, n = 0;
  for (let x = 0; x < raw.width; x++) if (raw.data[(y * raw.width + x) * 4] > 128 && raw.data[(y * raw.width + x) * 4 + 2] < 128) (s += x, n++);
  return s / n;
};

describe("which layers liquify accepts", () => {
  test("it says why not: no layer, the capture, a shape, a warped, locked or hidden layer, and comparing", () => {
    const { ctx, id } = withLayer();
    expect(liquifyTargetProblem(undefined, false)).toContain("이미지 레이어");
    const shape = ctx.get().addVectorLayer({ kind: "rect", width: 10, height: 10, stroke: "#000", strokeWidth: 1, fill: null }, 5, 5)!;
    expect(liquifyTargetProblem(layer(ctx, shape), false)).toContain("도형");
    expect(startLiquifyStroke(ctx.store, "nope")).toMatchObject({ ok: false });
    ctx.get().setLayerWarp(id, { kind: "quad", points: [{ x: 4, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 60 }, { x: 0, y: 60 }] });
    let r = startLiquifyStroke(ctx.store, id);
    expect(r.ok === false && r.reason).toContain("변형 초기화");
    ctx.get().setLayerWarp(id, null);
    ctx.get().setLayerLocked(id, true);
    r = startLiquifyStroke(ctx.store, id);
    expect(r.ok === false && r.reason).toContain("잠긴");
    ctx.get().setLayerLocked(id, false);
    ctx.get().setLayerVisible(id, false);
    r = startLiquifyStroke(ctx.store, id);
    expect(r.ok === false && r.reason).toContain("숨긴");
    ctx.get().setLayerVisible(id, true);
    ctx.get().setCompareMode("original");
    r = startLiquifyStroke(ctx.store, id);
    expect(r).toEqual({ ok: false, reason: null });
    expect(Object.keys(LIQUIFY_MODE_LABEL)).toEqual(["push", "bloat", "pucker", "restore"]);
  });

  test("the extracted-from-capture layer works too; the capture itself is not a layer, so it is never offered", () => {
    const ctx = storeWith();
    committedId(ctx.get().beginExtraction(CARD));
    const id = ctx.get().selectedLayerIds[0];
    expect(startLiquifyStroke(ctx.store, id).ok).toBe(true);
  });

  test("the tool hint for each state", () => {
    const { ctx, id } = withLayer();
    const st = () => ({ screen: ctx.get().history!.present.screens[0], selected: ctx.get().history!.present.screens[0].layers.filter((l) => ctx.get().selectedLayerIds.includes(l.id)), comparing: false });
    ctx.get().selectLayer(id);
    expect(toolHint("liquify", st()).usable).toBe(true);
    ctx.get().selectLayer(null);
    expect(toolHint("liquify", st()).text).toContain("유동화");
    expect(toolHint("liquify", st()).usable).toBe(false);
    ctx.get().selectLayer(id);
    ctx.get().setLayerLocked(id, true);
    expect(toolHint("liquify", st()).text).toContain("잠긴");
  });
});

describe("a stroke is one undo step with a new picture", () => {
  test("the layer takes a new imageId, the old picture is untouched, undo and redo swap them, the history holds only ids", () => {
    const { ctx, id } = withLayer();
    const oldId = layer(ctx, id).imageId!;
    const old = ctx.get().images.get(oldId)!.raw;
    const oldBytes = Buffer.from(old.data);
    const past = ctx.get().history!.past.length;
    const r = drag(ctx, id, { x: 120, y: 130 }, { x: 180, y: 130 });
    expect(r).toMatchObject({ ok: true, kept: true });
    expect(ctx.get().history!.past).toHaveLength(past + 1);
    expect(ctx.get().history!.past.at(-1)!.label).toBe("유동화");
    const newId = layer(ctx, id).imageId!;
    expect(newId).not.toBe(oldId);
    expect(Buffer.from(old.data).equals(oldBytes)).toBe(true);
    expect(redCentre(ctx.get().images.get(newId)!.raw)).toBeGreaterThan(redCentre(old) + 5);
    expect(JSON.stringify(ctx.get().history!.past.at(-1))).not.toContain("data"); // ids only
    ctx.get().undo();
    expect(layer(ctx, id).imageId).toBe(oldId);
    ctx.get().redo();
    expect(layer(ctx, id).imageId).toBe(newId);
  });

  test("a stroke that moved nothing records nothing", () => {
    const { ctx, id } = withLayer();
    const history = ctx.get().history;
    const s = startLiquifyStroke(ctx.store, id);
    if (!s.ok) throw new Error("no stroke");
    s.stroke.move({ x: 150, y: 130 });
    expect(s.stroke.finish()).toBe(false);
    expect(ctx.get().history).toBe(history);
  });

  test("it is saved and opened with the project: the layer refers to its new picture", () => {
    const { ctx, id } = withLayer();
    drag(ctx, id, { x: 120, y: 130 }, { x: 180, y: 130 });
    const text = serializeProject(ctx.get().snapshotProject()!);
    expect(parseProject(text).ok).toBe(true);
    expect(JSON.parse(text).screens[0].layers[0].imageId).toBe(layer(ctx, id).imageId);
  });

  test("100 strokes keep 100 undo steps on a small layer, and the pictures kept in memory stay within the retention policy", () => {
    const { ctx, id } = withLayer();
    for (let i = 0; i < 100; i++) {
      const back = i % 2 === 0;
      drag(ctx, id, { x: back ? 130 : 170, y: 130 }, { x: back ? 170 : 130, y: 130 });
    }
    expect(ctx.get().history!.past).toHaveLength(100);
    // 120 x 60 x 4 bytes is small: all 100 old pictures plus the first and the current fit the budget, and nothing else is kept
    expect(ctx.get().images.size).toBeLessThanOrEqual(104);
    for (let i = 0; i < 100; i++) ctx.get().undo();
    expect(ctx.get().history!.past).toHaveLength(0);
    expect(redCentre(ctx.get().images.get(layer(ctx, id).imageId!)!.raw)).toBeCloseTo(49.5, 1);
  });
});

describe("restore goes back to how the layer was when the tool began", () => {
  test("restore after a push moves toward the original, and the reference is dropped when another tool is chosen", () => {
    const { ctx, id } = withLayer();
    const original = ctx.get().images.get(layer(ctx, id).imageId!)!.raw;
    drag(ctx, id, { x: 120, y: 130 }, { x: 190, y: 130 });
    expect(ctx.get().liquifyBase?.raw).toBe(original);
    const pushed = redCentre(ctx.get().images.get(layer(ctx, id).imageId!)!.raw);
    ctx.get().setLiquifyStyle({ mode: "restore", strength: 100, size: 200 });
    for (let i = 0; i < 4; i++) drag(ctx, id, { x: 110, y: 130 }, { x: 210, y: 130 });
    const restored = redCentre(ctx.get().images.get(layer(ctx, id).imageId!)!.raw);
    expect(Math.abs(restored - 49.5)).toBeLessThan(Math.abs(pushed - 49.5));
    ctx.get().setTool("select");
    expect(ctx.get().liquifyBase).toBeNull();
  });
});

describe("the pointer lands on the bitmap pixel under it, whatever the layer's place", () => {
  test("turned 30° and scaled 2×: a push along the page's x moves content along the layer's own turned axis, by the right amount", () => {
    const { ctx, id } = withLayer();
    const t = layer(ctx, id).transform;
    ctx.get().transformLayer(id, { ...t, scaleX: 2, scaleY: 2, rotation: 30 });
    const l = layer(ctx, id);
    const map = bitmapMapper(l, { width: 120, height: 60 });
    // the bitmap point (50, 30) is at this frame point
    const a = (30 * Math.PI) / 180;
    const frame = { x: l.transform.x + 2 * (50 * Math.cos(a) - 30 * Math.sin(a)), y: l.transform.y + 2 * (50 * Math.sin(a) + 30 * Math.cos(a)) };
    const p = map(frame)!;
    expect(p.x).toBeCloseTo(50, 3);
    expect(p.y).toBeCloseTo(30, 3);
    // a 20px move of the pointer along the page's x is 10 bitmap pixels long (scale 2) in a direction turned by -30°
    const q = map({ x: frame.x + 20, y: frame.y })!;
    expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeCloseTo(10, 3);
    expect(Math.atan2(q.y - p.y, q.x - p.x)).toBeCloseTo((-30 * Math.PI) / 180, 3);
    // and the stroke works on such a layer, giving a new picture
    expect(drag(ctx, id, { x: frame.x - 10, y: frame.y }, { x: frame.x + 30, y: frame.y })).toMatchObject({ ok: true, kept: true });
  });

  test("the PNG shows the pushed picture at the layer's place (screen and export use the same bitmap)", () => {
    const { ctx, id } = withLayer();
    drag(ctx, id, { x: 120, y: 130 }, { x: 180, y: 130 });
    const out = renderProjectRaw(ctx.get().snapshotProject()!, ctx.get().images);
    const raw = ctx.get().images.get(layer(ctx, id).imageId!)!.raw;
    for (const [x, y] of [[10, 10], [60, 30], [70, 30], [100, 50]]) expect(getPixel(out, 100 + x, 100 + y)).toEqual(getPixel(raw, x, y));
  });
});