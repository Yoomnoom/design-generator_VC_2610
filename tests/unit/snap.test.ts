import { describe, expect, test } from "vitest";
import { Box, SNAP_GAP, snapMove, unionBox } from "@/features/snap/snap";

const FRAME = { width: 1000, height: 800 };
const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });
const T = 6;
const snap = (moving: Box, others: Box[] = [], threshold = T) => snapMove(moving, others, FRAME, threshold);

describe("alignment", () => {
  test("a left edge a few pixels from another box's left edge is pulled onto it, and only on that axis", () => {
    const r = snap(box(203, 300, 50, 40), [box(200, 100, 120, 60)]);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(0);
  });
  test("every pairing counts: left, centre and right against left, centre and right", () => {
    const o = box(200, 100, 100, 60); // 200 · 250 · 300
    expect(snap(box(0, 500, 40, 40), [o]).dx).toBe(0); // far: nothing
    expect(snap(box(262, 500, 40, 40), [o]).dx).toBe(-2); // right edge 302 → 300
    expect(snap(box(232, 500, 40, 40), [o]).dx).toBe(-2); // centre 252 → 250
    expect(snap(box(197, 500, 40, 40), [o]).dx).toBe(3); // left edge 197 → 200
    expect(snap(box(272, 500, 40, 40), [box(200, 100, 100, 60)]).dx).toBe(0); // nothing within reach: left 272, centre 292, right 312 against 200 · 250 · 300
    expect(snap(box(500, 400, 40, 40), [box(480, 100, 100, 100)]).dx).toBe(0); // 520 is 10 from the centre line 530: out of reach
    expect(snap(box(296, 500, 40, 40), [box(200, 100, 100, 60)]).dx).toBe(4); // a left edge onto another box's right edge (300): touching is an alignment too
  });
  test("vertical alignment works the same way: top, middle, bottom", () => {
    const o = box(100, 400, 60, 100); // 400 · 450 · 500
    expect(snap(box(600, 396, 40, 40), [o]).dy).toBe(4);
    expect(snap(box(600, 432, 40, 36), [o]).dy).toBe(0); // middle 450 already on 450
    expect(snap(box(600, 466, 40, 40), [o]).dy).toBe(-6); // bottom 506 → 500
  });
  test("beyond the threshold nothing happens; exactly at the threshold it does", () => {
    const o = box(200, 100, 100, 60);
    expect(snap(box(207.5, 500, 10, 40), [o]).dx).toBe(0); // 7.5 from the line at 200
    expect(snap(box(206, 500, 10, 40), [o]).dx).toBe(-6);
    expect(snap(box(206, 500, 10, 40), [o], 5).dx).toBe(0);
  });
  test("of several lines in reach the nearest wins", () => {
    const near = box(300, 100, 50, 50); // left 300
    const far = box(303, 200, 50, 50); // left 303
    expect(snap(box(301, 500, 20, 20), [far, near]).dx).toBe(-1);
    expect(snap(box(302, 500, 20, 20), [near, far]).dx).toBe(1);
  });
  test("the frame's edges and centre are lines too", () => {
    expect(snap(box(4, 300, 50, 50)).dx).toBe(-4); // left edge → 0
    expect(snap(box(944, 300, 50, 50)).dx).toBe(6); // right edge 994 → 1000
    expect(snap(box(477, 300, 50, 50)).dx).toBe(-2); // centre 502 → 500
    expect(snap(box(300, 3, 50, 50)).dy).toBe(-3);
    expect(snap(box(300, 372, 50, 50)).dy).toBe(3); // middle 397 → 400
  });
  test("with nothing near, there is no correction and no guide", () => {
    const r = snap(box(333, 333, 40, 40), [box(700, 600, 50, 50)]);
    expect(r).toEqual({ dx: 0, dy: 0, guides: [] });
  });
  test("a pulled-on line is drawn: a vertical guide spanning the moving box and the box it lines up with", () => {
    const r = snap(box(203, 300, 50, 40), [box(200, 100, 120, 60)]);
    const g = r.guides.filter((x) => x.kind === "align");
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ x1: 200, x2: 200, y1: 100, y2: 340 });
  });
  test("two boxes on the same line give two guides; both axes can snap at once", () => {
    const r = snap(box(203, 103, 50, 40), [box(200, 300, 50, 40), box(200, 500, 50, 40)]);
    expect(r.dx).toBe(-3);
    expect(r.guides.filter((g) => g.x1 === 200 && g.x2 === 200).length).toBeGreaterThanOrEqual(2);
    const both = snap(box(203, 297, 40, 40), [box(200, 300, 100, 100)]);
    expect([both.dx, both.dy]).toEqual([-3, 3]);
  });
  test("a frame guide spans the moving box and the whole frame side", () => {
    const g = snap(box(4, 300, 50, 50)).guides[0];
    expect(g).toMatchObject({ x1: 0, x2: 0, y1: 0, y2: 800 });
  });
});

describe("8 px spacing", () => {
  test("a box close to being 8 px to the right of another is pulled to exactly 8 px", () => {
    const o = box(100, 100, 100, 100); // right edge 200
    expect(SNAP_GAP).toBe(8);
    const r = snap(box(205, 120, 40, 40), [o], 4); // the touching line (200) is 5 away: out of reach, the 8 px line (208) is 3 away
    expect(r.dx).toBe(3); // left 205 → 208
  });
  test("and 8 px to the left, above and below", () => {
    const o = box(300, 300, 100, 100);
    expect(snap(box(250, 320, 40, 40), [o]).dx).toBe(2); // right 290 → 292
    expect(snap(box(320, 252, 40, 40), [o]).dy).toBe(0); // bottom 292 is already 8 above 300
    expect(snap(box(320, 408 + 3, 40, 40), [o]).dy).toBe(-3); // top 411 → 408
  });
  test("an exact 8 px gap needs no correction, and draws a spacing guide labelled 8", () => {
    const r = snap(box(208, 120, 40, 40), [box(100, 100, 100, 100)]);
    expect(r.dx).toBe(0);
    const gap = r.guides.find((g) => g.kind === "gap")!;
    expect(gap).toMatchObject({ label: "8", x1: 200, x2: 208 });
    expect(gap.y1).toBe(gap.y2);
  });
  test("a box that is somewhere else (not facing the moving one) is not a neighbour", () => {
    const o = box(100, 600, 100, 100); // far below
    expect(snap(box(205, 120, 40, 40), [o], 4).dx).toBe(0);
    expect(snap(box(205, 120, 40, 40), [box(100, 100, 100, 100)], 4).dx).toBe(3); // the same move beside a real neighbour does snap
  });
  test("boxes that only just miss each other across the other axis still count when within 8 px", () => {
    const o = box(100, 100, 100, 100); // y 100..200
    expect(snap(box(205, 205, 40, 40), [o], 4).dx).toBe(3); // 5 px below its bottom: a neighbour
    expect(snap(box(205, 215, 40, 40), [o], 4).dx).toBe(0); // 15 px below: no
  });
  test("alignment and spacing compete by distance on the same axis", () => {
    const a = box(100, 100, 100, 100); // right edge 200 → gap line at 208
    const b = box(209, 400, 50, 50); // left edge 209: an alignment line 1 px from the gap line
    const r = snap(box(207, 120, 40, 40), [a, b]);
    expect(r.dx).toBe(1); // the spacing line at 208 is at distance 1; the alignment line at 209 at 2
  });
});

describe("what is not changed, and the helpers", () => {
  test("the input boxes are not touched", () => {
    const moving = box(203, 300, 50, 40);
    const o = box(200, 100, 120, 60);
    const before = JSON.stringify([moving, o]);
    snap(moving, [o]);
    expect(JSON.stringify([moving, o])).toBe(before);
  });
  test("the same input always gives the same answer", () => {
    const a = snap(box(203, 297, 50, 40), [box(200, 300, 120, 60), box(400, 100, 30, 30)]);
    const b = snap(box(203, 297, 50, 40), [box(200, 300, 120, 60), box(400, 100, 30, 30)]);
    expect(a).toEqual(b);
  });
  test("a zero or negative threshold snaps only what already lines up", () => {
    expect(snap(box(203, 300, 50, 40), [box(200, 100, 120, 60)], 0).dx).toBe(0);
    expect(snap(box(200, 300, 50, 40), [box(200, 100, 120, 60)], 0).guides.length).toBeGreaterThan(0);
  });
  test("unionBox holds all the boxes, and is null for none", () => {
    expect(unionBox([])).toBeNull();
    expect(unionBox([box(10, 20, 30, 40), box(100, 5, 10, 10)])).toEqual({ x: 10, y: 5, width: 100, height: 55 });
  });
});
