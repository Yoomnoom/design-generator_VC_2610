import { describe, expect, test } from "vitest";
import { assetRect, assetText } from "@/features/assets/builtin";
import { applyToLayer, canStretch, handlePoint, quarterTurn, rotateFromDrag, scaleFromDrag, selectionBox } from "@/features/free-transform/free-transform";
import { renderProjectRaw } from "@/features/export-image/export-png";
import { parseProject, serializeProject } from "@/lib/project/parse";
import { estimateMeasure } from "@/lib/image/text-measure";
import { Rasterize } from "@/lib/image/vector-raster";
import { solid } from "./helpers";
import { storeWith } from "./fixtures";

const fake: Rasterize = (content, t) => ({ image: solid(Math.max(1, Math.ceil(content.width)), Math.max(1, Math.ceil(content.height)), [(JSON.stringify(content).length * 7) & 255, 90, 160, 255]), x: Math.round(t.x), y: Math.round(t.y) });
const page = () => storeWith(solid(600, 400, [240, 240, 240, 255]));
type Ctx = ReturnType<typeof page>;
const L = (c: Ctx, id: string) => c.get().history!.present.screens[0].layers.find((l) => l.id === id)!;
const rect = (c: Ctx, x: number, y: number, w: number, h: number) => c.get().addVectorLayer(assetRect("r", 0, 0, w, h, { fill: "#112233" }).content!, x, y)!;
/** the shadow and a button over it, as in the built-in sources */
function button(c: Ctx) {
  const shadow = rect(c, 110, 114, 100, 40);
  const body = rect(c, 110, 110, 100, 40);
  const label = c.get().addVectorLayer(assetText("t", 0, 0, 100, "OK", 16, "#fff", "center").content!, 110, 120)!;
  c.store.setState({ selectedLayerIds: [shadow, body, label] });
  return { shadow, body, label };
}
const sizes = (c: Ctx) => (l: { imageId?: string }) => (l.imageId ? c.get().images.get(l.imageId)?.raw : undefined);

describe("scaling a selection keeps the layers' relative positions and proportions", () => {
  test("shadow + button: x1.5 wide, x2 tall about the top-left corner: every offset and size scales by the same factors (numbers)", () => {
    const c = page();
    const { shadow, body } = button(c);
    const box = selectionBox([L(c, shadow), L(c, body)], sizes(c))!;
    const before = { dx: L(c, shadow).transform.x - L(c, body).transform.x, dy: L(c, shadow).transform.y - L(c, body).transform.y, w: L(c, body).content!.width, h: L(c, body).content!.height };
    const past = c.get().history!.past.length;
    expect(c.get().applyFreeTransform({ kind: "scale", sx: 1.5, sy: 2, pivot: { x: box.x, y: box.y } })).toBe(true);
    expect(c.get().history!.past).toHaveLength(past + 1);
    const s = L(c, shadow), b = L(c, body);
    expect(s.transform.x - b.transform.x).toBeCloseTo(before.dx * 1.5, 2);
    expect(s.transform.y - b.transform.y).toBeCloseTo(before.dy * 2, 2);
    expect(b.content!.width).toBeCloseTo(before.w * 1.5, 2);
    expect(b.content!.height).toBeCloseTo(before.h * 2, 2);
    expect(s.content!.width).toBe(b.content!.width); // the shadow is still exactly as big as the button
    expect(s.transform.scaleX).toBe(1); // a shape keeps scale 1: the factor is in its size
    // the pivot stays where it was
    const after = selectionBox([L(c, shadow), L(c, body)], sizes(c))!;
    expect(after.x).toBeCloseTo(box.x, 1);
    expect(after.y).toBeCloseTo(box.y, 1);
    expect(after.width).toBeCloseTo(box.width * 1.5, 1);
    expect(after.height).toBeCloseTo(box.height * 2, 1);
    c.get().undo();
    expect(L(c, body).content!.width).toBe(before.w);
    expect(L(c, shadow).transform.y - L(c, body).transform.y).toBe(before.dy);
  });

  test("a text box takes the width only: its letters keep their size and its height is refitted; a rect keeps its stroke width", () => {
    const c = page();
    const { label, body } = button(c);
    c.get().applyFreeTransform({ kind: "scale", sx: 2, sy: 3, pivot: { x: 110, y: 110 } });
    const t = L(c, label).content as { width: number; fontSize: number; height: number };
    expect(t.width).toBe(200);
    expect(t.fontSize).toBe(16);
    expect(t.height).toBeLessThan(40); // the lines decide it, not the vertical factor
    expect(L(c, body).content!.strokeWidth).toBe(0);
  });

  test("a long text box is refitted: wider means the lines decide a new height (not the stale one, not the vertical factor)", () => {
    const c = page();
    const tx = c.get().addVectorLayer(assetText("t", 0, 0, 100, "word ".repeat(14), 16, "#000").content!, 10, 10)!;
    const other = rect(c, 300, 10, 40, 40);
    c.store.setState({ selectedLayerIds: [tx, other] });
    c.get().applyFreeTransform({ kind: "scale", sx: 2, sy: 1, pivot: { x: 10, y: 10 } });
    const h = (L(c, tx).content as { height: number }).height;
    expect(h).toBeGreaterThan(30); // several lines at 200 wide: the 23px it was created with is no longer right
  });

  test("a bitmap takes the factor in scale", () => {
    const c = page();
    const id = c.get().addImageLayer({ raw: solid(40, 20, [255, 0, 0, 255]), name: "bm" })!;
    const v = rect(c, 10, 10, 50, 50);
    c.store.setState({ selectedLayerIds: [id, v] });
    const t0 = L(c, id).transform;
    c.get().applyFreeTransform({ kind: "scale", sx: 2, sy: 2, pivot: { x: 0, y: 0 } });
    expect(L(c, id).transform.scaleX).toBeCloseTo(t0.scaleX * 2, 3);
    expect(L(c, id).transform.x).toBeCloseTo(t0.x * 2, 1);
    expect(L(c, v).content!.width).toBe(100);
  });

  test("the corner radius of a scaled rectangle stays inside half of its new shorter side", () => {
    const c = page();
    const a = rect(c, 10, 10, 100, 60), b = rect(c, 200, 10, 100, 60);
    c.get().setLayerContent(a, { cornerRadius: 30 });
    c.store.setState({ selectedLayerIds: [a, b] });
    c.get().applyFreeTransform({ kind: "scale", sx: 1, sy: 0.5, pivot: { x: 10, y: 10 } });
    expect((L(c, a).content as { cornerRadius?: number }).cornerRadius).toBe(15);
  });
});

describe("turning a selection", () => {
  test("a quarter turn about the box centre moves every layer about the same point and adds the angle to each", () => {
    const c = page();
    const a = rect(c, 100, 100, 100, 20), b = rect(c, 100, 140, 100, 20);
    c.store.setState({ selectedLayerIds: [a, b] });
    const box = selectionBox([L(c, a), L(c, b)], sizes(c))!;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    c.get().applyFreeTransform({ kind: "rotate", degrees: 90, center: centre });
    expect(L(c, a).transform.rotation).toBe(90);
    expect(L(c, b).transform.rotation).toBe(90);
    const after = selectionBox([L(c, a), L(c, b)], sizes(c))!;
    expect(after.width).toBeCloseTo(box.height, 1); // the box turned on its side
    expect(after.height).toBeCloseTo(box.width, 1);
    expect(after.x + after.width / 2).toBeCloseTo(centre.x, 1);
    expect(after.y + after.height / 2).toBeCloseTo(centre.y, 1);
    // the two layers are still 40 apart, now side by side instead of above one another
    expect(Math.abs(L(c, a).transform.x - L(c, b).transform.x)).toBeCloseTo(40, 1);
    expect(L(c, a).transform.y).toBeCloseTo(L(c, b).transform.y, 1);
  });

  test("the angle stays in -180..180; 15° steps with Shift", () => {
    const c = page();
    const a = rect(c, 100, 100, 100, 20);
    c.store.setState({ selectedLayerIds: [a] });
    c.get().applyFreeTransform({ kind: "rotate", degrees: 170, center: { x: 150, y: 110 } });
    c.get().applyFreeTransform({ kind: "rotate", degrees: 30, center: { x: 150, y: 110 } });
    expect(L(c, a).transform.rotation).toBe(-160);
    const box = { x: 0, y: 0, width: 100, height: 100 };
    expect(rotateFromDrag(box, { x: 50, y: 0 }, { x: 100, y: 50 }, false)).toMatchObject({ kind: "rotate", degrees: 90 });
    expect(rotateFromDrag(box, { x: 50, y: 0 }, { x: 90, y: 20 }, true)).toMatchObject({ degrees: 60 }) // 53° rounded to the nearest 15;
  });
});

describe("what can be stretched, and handles", () => {
  test("a layer at an angle other than a multiple of 90° forbids a stretch; a layer on its side swaps the factors", () => {
    const c = page();
    const a = rect(c, 100, 100, 100, 20);
    expect(canStretch([L(c, a)])).toBe(true);
    c.store.setState({ selectedLayerIds: [a] });
    c.get().applyFreeTransform({ kind: "rotate", degrees: 30, center: { x: 100, y: 100 } });
    expect(canStretch([L(c, a)])).toBe(false);
    expect(quarterTurn(90)).toBe(true);
    expect(quarterTurn(-270)).toBe(true);
    expect(quarterTurn(30)).toBe(false);
    const side = applyToLayer({ ...L(c, a), transform: { ...L(c, a).transform, rotation: 90 } }, { kind: "scale", sx: 2, sy: 3, pivot: { x: 0, y: 0 } }, estimateMeasure);
    expect(side.content!.width).toBe(300); // its width runs along the page's vertical axis: x3 (100 -> 300)
    expect(side.content!.height).toBe(40); // its height runs along the page's horizontal axis: x2 (20 -> 40)
  });

  test("a stretch the layers cannot take leaves such a layer at its size (the caller keeps it proportional)", () => {
    const c = page();
    const a = rect(c, 100, 100, 100, 20);
    c.store.setState({ selectedLayerIds: [a] });
    c.get().applyFreeTransform({ kind: "rotate", degrees: 30, center: { x: 100, y: 100 } });
    const r = applyToLayer(L(c, a), { kind: "scale", sx: 2, sy: 1, pivot: { x: 0, y: 0 } }, estimateMeasure);
    expect(r.content!.width).toBe(100);
  });

  test("scaleFromDrag: corner = both axes, edge = one, Shift = proportional, Alt = about the centre, never below the minimum or flipped", () => {
    const box = { x: 100, y: 100, width: 200, height: 100 };
    const o = { shift: false, alt: false, stretch: true, min: 0.05 };
    const se = scaleFromDrag(box, "se", { x: 500, y: 250 }, o);
    expect(se).toMatchObject({ kind: "scale", sx: 2, sy: 1.5, pivot: { x: 100, y: 100 } });
    expect(scaleFromDrag(box, "e", { x: 400, y: 999 }, o)).toMatchObject({ sx: 1.5, sy: 1 });
    expect(scaleFromDrag(box, "s", { x: 999, y: 300 }, o)).toMatchObject({ sx: 1, sy: 2 });
    const prop = scaleFromDrag(box, "se", { x: 500, y: 250 }, { ...o, shift: true });
    expect((prop as { sx: number; sy: number }).sx).toBe((prop as { sx: number; sy: number }).sy);
    const forced = scaleFromDrag(box, "se", { x: 500, y: 250 }, { ...o, stretch: false });
    expect((forced as { sx: number; sy: number }).sx).toBe((forced as { sx: number; sy: number }).sy);
    const centred = scaleFromDrag(box, "se", { x: 500, y: 250 }, { ...o, alt: true });
    expect(centred).toMatchObject({ pivot: { x: 200, y: 150 } });
    expect((centred as { sx: number }).sx).toBeCloseTo(3, 5); // (500-200)/(300-200)
    const flip = scaleFromDrag(box, "se", { x: 0, y: 0 }, o);
    expect((flip as { sx: number }).sx).toBe(0.05);
    expect(handlePoint(box, "nw")).toEqual({ x: 100, y: 100 });
    expect(handlePoint(box, "e")).toEqual({ x: 300, y: 150 });
  });
});

describe("what a free transform leaves alone, and the rules around it", () => {
  test("locked layers stay (with a notice); a warped layer is carried along but not resized; memos are not layers and do not move", () => {
    const c = page();
    const a = rect(c, 100, 100, 100, 20), lockedOne = rect(c, 300, 100, 100, 20);
    const bm = c.get().addImageLayer({ raw: solid(40, 40, [0, 255, 0, 255]), name: "w" })!;
    c.get().setLayerWarp(bm, { kind: "quad", points: [{ x: 4, y: 0 }, { x: 40, y: 0 }, { x: 36, y: 40 }, { x: 0, y: 40 }] });
    c.get().addMemo(50, 50);
    c.get().setLayerLocked(lockedOne, true);
    c.store.setState({ selectedLayerIds: [a, lockedOne, bm] });
    const before = { locked: L(c, lockedOne).transform, warpScale: L(c, bm).transform.scaleX, warpX: L(c, bm).transform.x, memo: JSON.stringify(c.get().history!.present.screens[0].memos) };
    c.get().applyFreeTransform({ kind: "scale", sx: 2, sy: 2, pivot: { x: 0, y: 0 } });
    expect(L(c, lockedOne).transform).toEqual(before.locked);
    expect(L(c, bm).transform.scaleX).toBe(before.warpScale);
    expect(L(c, bm).transform.x).toBeCloseTo(before.warpX * 2, 1);
    expect(L(c, a).content!.width).toBe(200);
    expect(JSON.stringify(c.get().history!.present.screens[0].memos)).toBe(before.memo);
    expect(c.get().notice).toContain("잠긴 레이어 1개");
    expect(c.get().notice).toContain("warp");
  });

  test("comparing refuses with a reason and changes nothing; nothing selected or all locked is refused; a no-op records no step", () => {
    const c = page();
    const a = rect(c, 100, 100, 100, 20);
    c.store.setState({ selectedLayerIds: [a] });
    expect(c.get().applyFreeTransform({ kind: "scale", sx: 1, sy: 1, pivot: { x: 0, y: 0 } })).toBe(false); // nothing changes
    expect(c.get().applyFreeTransform({ kind: "move", dx: 0, dy: 0 })).toBe(false);
    c.get().setLayerLocked(a, true);
    expect(c.get().applyFreeTransform({ kind: "move", dx: 5, dy: 0 })).toBe(false);
    expect(c.get().notice).toContain("잠긴");
    c.get().setLayerLocked(a, false);
    c.get().setCompareMode("original");
    const before = c.get().history;
    expect(c.get().applyFreeTransform({ kind: "move", dx: 5, dy: 0 })).toBe(false);
    expect(c.get().notice).toContain("비교");
    expect(c.get().history).toBe(before);
    c.get().setCompareMode("off");
    c.store.setState({ selectedLayerIds: [] });
    expect(c.get().applyFreeTransform({ kind: "move", dx: 5, dy: 0 })).toBe(false);
  });

  test("the preview writes no history; the commit is exactly the preview", () => {
    const c = page();
    const { shadow, body } = button(c);
    const before = c.get().history;
    const op = { kind: "scale" as const, sx: 1.25, sy: 1.75, pivot: { x: 110, y: 110 } };
    c.get().setFreeTransformPreview(op);
    expect(c.get().history).toBe(before);
    const preview = c.get().ftPreview!;
    expect(Object.keys(preview).sort()).toEqual([shadow, body, ...Object.keys(preview).filter((k) => k !== shadow && k !== body)].sort());
    c.get().applyFreeTransform(op);
    expect(c.get().ftPreview).toBeNull();
    for (const id of [shadow, body]) {
      expect(L(c, id).transform).toEqual(preview[id].transform);
      expect(L(c, id).content).toMatchObject({ width: preview[id].content!.width, height: preview[id].content!.height });
    }
    c.get().setFreeTransformPreview(null);
    expect(c.get().ftPreview).toBeNull();
  });

  test("it works on one layer too, saves and opens again, and the PNG follows the new sizes", () => {
    const c = page();
    const a = rect(c, 100, 100, 100, 20);
    c.store.setState({ selectedLayerIds: [a] });
    c.get().applyFreeTransform({ kind: "scale", sx: 2, sy: 2, pivot: { x: 100, y: 100 } });
    expect(L(c, a).content!.width).toBe(200);
    const back = parseProject(serializeProject(c.get().snapshotProject()!));
    expect(back.ok && back.project.screens[0].layers[0].content!.width).toBe(200);
    const out = renderProjectRaw(c.get().snapshotProject()!, c.get().images, fake);
    expect([out.width, out.height]).toEqual([600, 400]);
    expect(out.data[(120 * 600 + 250) * 4 + 2]).toBe(160); // inside the enlarged rectangle (x 250 is past the old 200 edge)
  });
});