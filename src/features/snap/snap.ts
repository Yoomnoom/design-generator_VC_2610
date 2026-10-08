/* Snapping while a layer (or a group) is dragged. Pure geometry: boxes in, a correction and the guide lines to draw out.
 * The rules are in CLAUDE.md ("정렬 가이드·스냅"). */

export type Box = { x: number; y: number; width: number; height: number };
/** a line segment to draw over the canvas, in image pixels */
export type Guide = { x1: number; y1: number; x2: number; y2: number; kind: "align" | "gap"; /** "8" on a spacing guide */ label?: string };

export const SNAP_GAP = 8;
/** how close (screen pixels) a line has to be to be pulled onto another */
export const SNAP_SCREEN_PIXELS = 6;

type Axis = "x" | "y";
const lo = (b: Box, a: Axis) => (a === "x" ? b.x : b.y);
const size = (b: Box, a: Axis) => (a === "x" ? b.width : b.height);
const hi = (b: Box, a: Axis) => lo(b, a) + size(b, a);
const mid = (b: Box, a: Axis) => lo(b, a) + size(b, a) / 2;
const other = (a: Axis): Axis => (a === "x" ? "y" : "x");

type Candidate = { d: number; kind: "align" | "gap"; line: number; target: Box | "frame" };

/** the distance between two intervals on one axis: 0 when they overlap */
const separation = (a: Box, b: Box, axis: Axis) => Math.max(0, lo(b, axis) - hi(a, axis), lo(a, axis) - hi(b, axis));

function candidatesOn(axis: Axis, moving: Box, others: readonly Box[], frame: { width: number; height: number }, threshold: number, gap: number): Candidate[] {
  const out: Candidate[] = [];
  const mLines = [lo(moving, axis), mid(moving, axis), hi(moving, axis)];
  const frameBox: Box = { x: 0, y: 0, width: frame.width, height: frame.height };
  const add = (d: number, kind: Candidate["kind"], line: number, target: Candidate["target"]) => {
    if (Math.abs(d) <= threshold) out.push({ d, kind, line, target });
  };
  for (const t of others) for (const ml of mLines) for (const tl of [lo(t, axis), mid(t, axis), hi(t, axis)]) add(tl - ml, "align", tl, t);
  for (const ml of mLines) for (const tl of [0, mid(frameBox, axis), hi(frameBox, axis)]) add(tl - ml, "align", tl, "frame");
  const cross = other(axis);
  for (const t of others) {
    if (separation(moving, t, cross) > gap) continue; // a box somewhere else entirely is not a neighbour
    add(hi(t, axis) + gap - lo(moving, axis), "gap", hi(t, axis) + gap, t); // moving sits `gap` after t
    add(lo(t, axis) - gap - hi(moving, axis), "gap", lo(t, axis) - gap, t); // moving sits `gap` before t
  }
  return out;
}

/** The correction (dx, dy) that pulls `moving` onto the nearest alignment or spacing line within `threshold` on each axis, and the
 *  guides for what it was pulled onto. No candidate on an axis means no correction there. */
export function snapMove(moving: Box, others: readonly Box[], frame: { width: number; height: number }, threshold: number, gap = SNAP_GAP): { dx: number; dy: number; guides: Guide[] } {
  const pick = (axis: Axis) => {
    let best: Candidate | null = null;
    for (const c of candidatesOn(axis, moving, others, frame, threshold, gap)) if (!best || Math.abs(c.d) < Math.abs(best.d)) best = c;
    return best;
  };
  const bx = pick("x");
  const by = pick("y");
  const dx = bx ? bx.d : 0;
  const dy = by ? by.d : 0;
  const placed: Box = { x: moving.x + dx, y: moving.y + dy, width: moving.width, height: moving.height };
  const guides: Guide[] = [];
  for (const axis of ["x", "y"] as const) {
    const chosen = axis === "x" ? bx : by;
    if (!chosen) continue;
    const cross = other(axis);
    const all = candidatesOn(axis, moving, others, frame, threshold, gap).filter((c) => Math.abs(c.d - chosen.d) < 1e-6);
    for (const c of all) {
      const t: Box = c.target === "frame" ? { x: 0, y: 0, width: frame.width, height: frame.height } : c.target;
      if (c.kind === "align") {
        const a = Math.min(lo(placed, cross), lo(t, cross));
        const b = Math.max(hi(placed, cross), hi(t, cross));
        guides.push(axis === "x" ? { x1: c.line, y1: a, x2: c.line, y2: b, kind: "align" } : { x1: a, y1: c.line, x2: b, y2: c.line, kind: "align" });
      } else {
        // the segment across the gap, halfway along where the two boxes face each other
        const from = Math.max(lo(placed, cross), lo(t, cross));
        const to = Math.min(hi(placed, cross), hi(t, cross));
        const along = from <= to ? (from + to) / 2 : mid(placed, cross);
        const start = hi(t, axis) + gap === c.line ? hi(t, axis) : c.line;
        const end = hi(t, axis) + gap === c.line ? c.line : lo(t, axis);
        guides.push(axis === "x" ? { x1: start, y1: along, x2: end, y2: along, kind: "gap", label: String(gap) } : { x1: along, y1: start, x2: along, y2: end, kind: "gap", label: String(gap) });
      }
    }
  }
  return { dx, dy, guides };
}

/** the smallest box holding all of `boxes` (null for none) */
export function unionBox(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
