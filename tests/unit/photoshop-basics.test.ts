import fs from "node:fs";
import { describe, expect, test } from "vitest";
import { assetRect } from "@/features/assets/builtin";
import { alignDeltas, distributeDeltas, makeUnits } from "@/features/align/align";
import { renderProjectRaw } from "@/features/export-image/export-png";
import { parseProjectFile } from "@/features/project-persistence/project-file";
import { renderComposite } from "@/lib/image/render-export";
import { parseProject, serializeProject } from "@/lib/project/parse";
import { Rasterize } from "@/lib/image/vector-raster";
import { getPixel, setPixel, solid } from "./helpers";
import { storeWith } from "./fixtures";

const fake: Rasterize = (content, t) => ({ image: solid(Math.max(1, Math.ceil(content.width)), Math.max(1, Math.ceil(content.height)), [200, 50, 50, 255]), x: Math.round(t.x), y: Math.round(t.y) });
const page = () => storeWith(solid(300, 200, [240, 240, 240, 255]));
type Ctx = ReturnType<typeof page>;
const sc = (c: Ctx) => c.get().history!.present.screens[0];
const L = (c: Ctx, id: string) => sc(c).layers.find((l) => l.id === id)!;
const rect = (c: Ctx, x: number, y: number, w: number, h: number) => c.get().addVectorLayer(assetRect("r", 0, 0, w, h, { fill: "#112233" }).content!, x, y)!;
const png = (c: Ctx) => renderProjectRaw(c.get().snapshotProject()!, c.get().images, fake);

describe("opacity", () => {
  test("0..1 in the project, rounded to 1%, one undo step; the same value or a locked layer or comparing records nothing", () => {
    const c = page();
    const a = rect(c, 10, 10, 50, 50);
    const past = c.get().history!.past.length;
    expect(c.get().setLayerOpacity(a, 0.456)).toBe(true);
    expect(L(c, a).opacity).toBe(0.46);
    expect(c.get().history!.past).toHaveLength(past + 1);
    expect(c.get().setLayerOpacity(a, 0.46)).toBe(false);
    c.get().setLayerOpacity(a, 7);
    expect(L(c, a).opacity).toBe(1);
    c.get().setLayerOpacity(a, -3);
    expect(L(c, a).opacity).toBe(0);
    expect(c.get().setLayerOpacity(a, NaN)).toBe(false);
    c.get().undo();
    expect(L(c, a).opacity).toBe(1);
    c.get().setLayerLocked(a, true);
    expect(c.get().setLayerOpacity(a, 0.5)).toBe(false);
    c.get().setLayerLocked(a, false);
    c.get().setCompareMode("original");
    expect(c.get().setLayerOpacity(a, 0.5)).toBe(false);
  });

  test("the preview writes no history; half opacity gives the half-mixed pixel in the PNG", () => {
    const c = page();
    const a = rect(c, 10, 10, 50, 50);
    const before = c.get().history;
    c.get().setOpacityPreview({ layerId: a, opacity: 0.2 });
    expect(c.get().history).toBe(before);
    c.get().setOpacityPreview(null);
    c.get().setLayerOpacity(a, 0.5);
    expect(getPixel(png(c), 20, 20)).toEqual([220, 145, 145, 255]); // (200 + 240) / 2, (50 + 240) / 2
  });
});

describe("blend modes (the export mixes them the way the canvas does)", () => {
  const mix = (mode: "multiply" | "screen" | "overlay" | "darken" | "lighten" | undefined, below: [number, number, number, number], above: [number, number, number, number], opacity = 1) =>
    getPixel(renderComposite({ width: 1, height: 1, source: solid(1, 1, below), patches: [], layers: [{ image: solid(1, 1, above), x: 0, y: 0, zIndex: 1, opacity, blend: mode, visible: true }] }), 0, 0);
  test("multiply, screen, overlay, darken, lighten on opaque pixels follow the standard formulas", () => {
    expect(mix("multiply", [200, 100, 50, 255], [100, 200, 255, 255])).toEqual([78, 78, 50, 255]);
    expect(mix("screen", [200, 100, 50, 255], [100, 200, 255, 255])).toEqual([222, 222, 255, 255]);
    expect(mix("darken", [200, 100, 50, 255], [100, 200, 255, 255])).toEqual([100, 100, 50, 255]);
    expect(mix("lighten", [200, 100, 50, 255], [100, 200, 255, 255])).toEqual([200, 200, 255, 255]);
    // overlay: a dark backdrop multiplies (x2), a light one screens
    const ov = mix("overlay", [64, 192, 128, 255], [128, 128, 128, 255]);
    expect(ov.slice(0, 2)).toEqual([64, 192]);
    expect(Math.abs(ov[2] - 128)).toBeLessThanOrEqual(1);
    expect(ov[3]).toBe(255);
  });
  test("over a transparent backdrop a blended layer shows its own colour; with opacity it mixes in proportion; no mode = normal", () => {
    expect(mix("multiply", [0, 0, 0, 0], [100, 150, 200, 255])).toEqual([100, 150, 200, 255]);
    expect(mix("multiply", [200, 200, 200, 255], [100, 100, 100, 255], 0.5)).toEqual([139, 139, 139, 255]); // half of the multiplied 78 and half of the backdrop 200
    expect(mix(undefined, [10, 20, 30, 255], [100, 100, 100, 255])).toEqual([100, 100, 100, 255]);
  });
  test("the setter: validated, one undo step, saved in the file and drawn in the PNG; locked and comparing refuse", () => {
    const c = page();
    const a = rect(c, 10, 10, 50, 50);
    const past = c.get().history!.past.length;
    expect(c.get().setLayerBlend(a, "multiply")).toBe(true);
    expect(c.get().history!.past).toHaveLength(past + 1);
    expect(L(c, a).blend).toBe("multiply");
    expect(c.get().setLayerBlend(a, "multiply")).toBe(false);
    expect(c.get().setLayerBlend(a, "bogus" as never)).toBe(false);
    expect(getPixel(png(c), 20, 20)).toEqual([Math.round((200 * 240) / 255), Math.round((50 * 240) / 255), Math.round((50 * 240) / 255), 255]);
    const back = parseProject(serializeProject(c.get().snapshotProject()!));
    expect(back.ok && back.project.screens[0].layers[0].blend).toBe("multiply");
    c.get().setLayerBlend(a, null);
    expect("blend" in L(c, a)).toBe(false);
    c.get().undo();
    expect(L(c, a).blend).toBe("multiply");
    c.get().setLayerLocked(a, true);
    expect(c.get().setLayerBlend(a, "screen")).toBe(false);
    c.get().setLayerLocked(a, false);
    c.get().setCompareMode("original");
    expect(c.get().setLayerBlend(a, "screen")).toBe(false);
  });
  test("the file format: a bad blend is refused", () => {
    const c = page();
    const a = rect(c, 10, 10, 50, 50);
    c.get().setLayerBlend(a, "screen");
    const doc = JSON.parse(serializeProject(c.get().snapshotProject()!));
    doc.screens[0].layers[0].blend = "dissolve";
    expect(parseProject(JSON.stringify(doc)).ok).toBe(false);
  });
});

describe("the file the previous build saved (version 9)", () => {
  const v9 = fs.readFileSync("tests/fixtures/project-v9.slc.json", "utf8");
  test("is version 9 with a rounded rectangle and opens as the current version, nothing changed", () => {
    const before = JSON.parse(v9).project;
    expect(before.version).toBe(9);
    expect(JSON.stringify(before)).toContain('"cornerRadius":6');
    expect(JSON.stringify(before)).not.toContain('"blend"');
    const r = parseProjectFile(v9);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.project.version).toBe(13);
    expect(r.file.project.screens[0].layers).toEqual(before.screens[0].layers);
    expect(r.file.project.screens[0].groups).toEqual(before.screens[0].groups);
  });
});

describe("flip", () => {
  test("a bitmap mirrors about its own centre: the picture is reversed, the box does not move, two flips are the identity", () => {
    const c = page();
    const raw = solid(40, 20, [255, 0, 0, 255]);
    for (let y = 0; y < 20; y++) for (let x = 20; x < 40; x++) setPixel(raw, x, y, [0, 0, 255, 255]); // left red, right blue
    const id = c.get().addImageLayer({ raw, name: "bm" })!;
    const t0 = { ...L(c, id).transform };
    const left0 = getPixel(png(c), t0.x + 5, t0.y + 5), right0 = getPixel(png(c), t0.x + 35, t0.y + 5);
    expect(left0).toEqual([255, 0, 0, 255]);
    expect(right0).toEqual([0, 0, 255, 255]);
    const past = c.get().history!.past.length;
    expect(c.get().flipLayer(id, "x")).toBe(true);
    expect(c.get().history!.past).toHaveLength(past + 1);
    expect(L(c, id).transform.scaleX).toBe(-t0.scaleX);
    const out = png(c);
    expect(getPixel(out, t0.x + 5, t0.y + 5)).toEqual([0, 0, 255, 255]); // the same place, mirrored content
    expect(getPixel(out, t0.x + 35, t0.y + 5)).toEqual([255, 0, 0, 255]);
    expect(getPixel(out, t0.x - 1, t0.y + 5).slice(0, 3)).toEqual([240, 240, 240]);
    c.get().flipLayer(id, "x");
    expect(L(c, id).transform).toEqual(t0);
    c.get().flipLayer(id, "y");
    expect(L(c, id).transform.scaleY).toBe(-t0.scaleY);
    expect(L(c, id).transform.y).toBeCloseTo(t0.y + 20 * t0.scaleY, 1); // the box stays: with a negative scale the origin is at the bottom, one height lower
  });

  test("a turned bitmap keeps its centre when flipped", () => {
    const c = page();
    const id = c.get().addImageLayer({ raw: solid(40, 20, [255, 0, 0, 255]), name: "bm" })!;
    const t = L(c, id).transform;
    c.get().transformLayer(id, { ...t, rotation: 30 });
    const centre = (tt: { x: number; y: number; scaleX: number; scaleY: number; rotation: number }) => {
      const a = (tt.rotation * Math.PI) / 180;
      return { x: tt.x + Math.cos(a) * tt.scaleX * 20 - Math.sin(a) * tt.scaleY * 10, y: tt.y + Math.sin(a) * tt.scaleX * 20 + Math.cos(a) * tt.scaleY * 10 };
    };
    const before = centre(L(c, id).transform);
    c.get().flipLayer(id, "x");
    const after = centre(L(c, id).transform);
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(after.y).toBeCloseTo(before.y, 1);
  });

  test("a line swaps its diagonal; a rectangle, an ellipse, a text box, a warped or a locked layer are refused with a reason", () => {
    const c = page();
    const line = c.get().addVectorLayer({ kind: "line", width: 40, height: 20, direction: "down", stroke: "#000", strokeWidth: 2 }, 5, 5)!;
    c.get().flipLayer(line, "x");
    expect((L(c, line).content as { direction: string }).direction).toBe("up");
    const r = rect(c, 50, 50, 20, 20);
    const before = c.get().history;
    expect(c.get().flipLayer(r, "x")).toBe(false);
    expect(c.get().notice).toContain("같습니다");
    const txt = c.get().addVectorLayer({ kind: "text", width: 80, height: 20, text: "hi", fontSize: 14, color: "#000", align: "left", stroke: null, strokeWidth: 0 }, 5, 90)!;
    expect(c.get().flipLayer(txt, "x")).toBe(false);
    expect(c.get().notice).toContain("텍스트");
    const bm = c.get().addImageLayer({ raw: solid(10, 10, [1, 2, 3, 255]), name: "w" })!;
    c.get().setLayerWarp(bm, { kind: "quad", points: [{ x: 2, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] });
    expect(c.get().flipLayer(bm, "x")).toBe(false);
    expect(c.get().notice).toContain("warp");
    c.get().setLayerLocked(line, true);
    expect(c.get().flipLayer(line, "x")).toBe(false);
    expect(c.get().history).not.toBe(before); // (the successful flip and the lock were steps)
  });
});

describe("align and distribute", () => {
  const boxes = (c: Ctx, ids: string[]) => ids.map((i) => ({ x: L(c, i).transform.x, y: L(c, i).transform.y, w: (L(c, i).content as { width: number }).width, h: (L(c, i).content as { height: number }).height }));
  test("several layers align to each other: left, right, centre, top, bottom (numbers)", () => {
    const c = page();
    const a = rect(c, 20, 30, 40, 20), b = rect(c, 100, 90, 60, 40), d = rect(c, 200, 10, 20, 10);
    c.store.setState({ selectedLayerIds: [a, b, d] });
    c.get().alignSelected("left");
    expect(boxes(c, [a, b, d]).map((x) => x.x)).toEqual([20, 20, 20]);
    c.get().alignSelected("right"); // the right edge of the widest reach: 20 + 60
    expect(boxes(c, [a, b, d]).map((x) => x.x + x.w)).toEqual([80, 80, 80]);
    c.get().alignSelected("top");
    expect(boxes(c, [a, b, d]).map((x) => x.y)).toEqual([10, 10, 10]);
    c.get().alignSelected("bottom");
    expect(boxes(c, [a, b, d]).map((x) => x.y + x.h)).toEqual([50, 50, 50].map(() => boxes(c, [a, b, d])[0].y + boxes(c, [a, b, d])[0].h));
    c.get().alignSelected("hcenter");
    const cx = boxes(c, [a, b, d]).map((x) => x.x + x.w / 2);
    expect(cx[0]).toBeCloseTo(cx[1], 1);
    expect(cx[1]).toBeCloseTo(cx[2], 1);
  });

  test("one layer aligns to the frame; each alignment is one undo step; nothing to move records nothing", () => {
    const c = page(); // 300 × 200
    const a = rect(c, 20, 30, 40, 20);
    c.store.setState({ selectedLayerIds: [a] });
    const past = c.get().history!.past.length;
    c.get().alignSelected("hcenter");
    c.get().alignSelected("vcenter");
    expect(L(c, a).transform).toMatchObject({ x: 130, y: 90 });
    expect(c.get().history!.past).toHaveLength(past + 2);
    expect(c.get().alignSelected("hcenter")).toBe(0); // already there
    expect(c.get().history!.past).toHaveLength(past + 2);
    c.get().alignSelected("right");
    expect(L(c, a).transform.x).toBe(260);
    c.get().alignSelected("bottom");
    expect(L(c, a).transform.y).toBe(180);
    c.get().undo();
    expect(L(c, a).transform.y).toBe(90);
  });

  test("a group is one unit: its layers move together and keep their spacing; locked and hidden layers stay", () => {
    const c = page();
    const g1 = rect(c, 10, 10, 20, 20), g2 = rect(c, 60, 10, 20, 20), solo = rect(c, 150, 100, 30, 30);
    c.store.setState({ selectedLayerIds: [g1, g2] });
    c.get().groupSelected();
    const lockedOne = rect(c, 5, 150, 10, 10);
    c.get().setLayerLocked(lockedOne, true);
    c.store.setState({ selectedLayerIds: [g1, g2, solo, lockedOne] });
    const gap = L(c, g2).transform.x - L(c, g1).transform.x;
    c.get().alignSelected("left"); // the group's left (10) against the solo layer (150) and the others: the group stays, solo comes to 10
    expect(L(c, g2).transform.x - L(c, g1).transform.x).toBe(gap);
    expect(L(c, g1).transform.x).toBe(10);
    expect(L(c, solo).transform.x).toBe(10);
    expect(L(c, lockedOne).transform.x).toBe(5);
    expect(c.get().notice).toContain("1개");
  });

  test("distribute: equal gaps for three or more, first and last stay; fewer than three is refused; a group counts as one", () => {
    const c = page();
    const a = rect(c, 10, 10, 20, 20), b = rect(c, 40, 10, 20, 20), d = rect(c, 200, 10, 20, 20);
    c.store.setState({ selectedLayerIds: [a, b, d] });
    c.get().distributeSelected("x");
    expect(L(c, a).transform.x).toBe(10);
    expect(L(c, d).transform.x).toBe(200);
    // gaps: (220 - 10 - 60) / 2 = 75
    expect(L(c, b).transform.x).toBe(105);
    c.store.setState({ selectedLayerIds: [a, b] });
    expect(c.get().distributeSelected("x")).toBe(0);
    expect(c.get().notice).toContain("3개");
    expect(distributeDeltas(makeUnits([{ id: "1", box: { x: 0, y: 0, width: 10, height: 10 } }, { id: "2", box: { x: 5, y: 0, width: 10, height: 10 } }]), "x")).toBeNull();
  });

  test("the pure functions: units, reference box and deltas", () => {
    const units = makeUnits([{ id: "a", groupId: "g", box: { x: 0, y: 0, width: 10, height: 10 } }, { id: "b", groupId: "g", box: { x: 20, y: 0, width: 10, height: 10 } }, { id: "c", box: { x: 50, y: 40, width: 20, height: 20 } }]);
    expect(units).toHaveLength(2);
    expect(units[0].box).toEqual({ x: 0, y: 0, width: 30, height: 10 });
    expect(alignDeltas(units, "right", { x: 0, y: 0, width: 300, height: 200 })).toEqual([{ dx: 40, dy: 0 }, { dx: 0, dy: 0 }]);
    expect(alignDeltas(units.slice(0, 1), "right", { x: 0, y: 0, width: 300, height: 200 })).toEqual([{ dx: 270, dy: 0 }]);
  });
});

describe("Alt+drag copies", () => {
  test("the drop makes copies at the new place and leaves the originals; one undo step; the copies are selected; a whole group becomes a new group; locked layers are not copied", () => {
    const c = page();
    const a = rect(c, 10, 10, 20, 20), b = rect(c, 60, 10, 20, 20), lockedOne = rect(c, 120, 10, 20, 20);
    c.get().setLayerLocked(lockedOne, true);
    c.store.setState({ selectedLayerIds: [a, b, lockedOne] });
    c.get().groupSelected();
    c.get().selectGroup(sc(c).groups![0].id);
    const past = c.get().history!.past.length;
    c.get().previewLayerDrag(a, 50, 70);
    expect(c.get().commitLayerDragAsCopy()).toBe(true);
    expect(c.get().history!.past).toHaveLength(past + 1);
    expect(L(c, a).transform).toMatchObject({ x: 10, y: 10 });
    expect(sc(c).layers).toHaveLength(5); // three originals + copies of the two that can move
    const copies = c.get().selectedLayerIds;
    expect(copies).toHaveLength(2);
    expect(copies.map((i) => L(c, i).transform.x).sort((x, y) => x - y)).toEqual([50, 100]);
    expect(copies.every((i) => L(c, i).transform.y === 70 && !L(c, i).locked)).toBe(true);
    expect(sc(c).groups).toHaveLength(1); // the original group had a locked member, so it is not a whole-group copy
    c.get().undo();
    expect(sc(c).layers).toHaveLength(3);
  });

  test("copies of a whole unlocked group are a new group; nothing moved or comparing: no copy", () => {
    const c = page();
    const a = rect(c, 10, 10, 20, 20), b = rect(c, 60, 10, 20, 20);
    c.store.setState({ selectedLayerIds: [a, b] });
    const g = c.get().groupSelected()!;
    c.get().previewLayerDrag(a, 10, 10);
    expect(c.get().commitLayerDragAsCopy()).toBe(false);
    c.get().previewLayerDrag(a, 40, 40);
    expect(c.get().commitLayerDragAsCopy()).toBe(true);
    expect(sc(c).groups).toHaveLength(2);
    expect(sc(c).groups![1].id).not.toBe(g);
    c.get().setCompareMode("original");
    c.get().previewLayerDrag(a, 90, 90);
    expect(c.get().commitLayerDragAsCopy()).toBe(false);
  });
});