import { Box } from "@/features/snap/snap";

/* Align and distribute. The things that move are "units": a layer that is in no group is a unit, and the selected layers of one group are
 * ONE unit (they keep their positions relative to each other). Everything is in original image pixels. */

export type AlignKind = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type Unit = { ids: string[]; box: Box };
export type Delta = { dx: number; dy: number };

const r2 = (v: number) => Math.round(v * 100) / 100;

/** units from (id, group, box) triples: one per group, one per loose layer; the box of a unit is the union of its layers' boxes */
export function makeUnits(items: { id: string; groupId?: string; box: Box }[]): Unit[] {
  const out: Unit[] = [];
  const byGroup = new Map<string, Unit>();
  for (const it of items) {
    const g = it.groupId && byGroup.get(it.groupId);
    if (g) {
      const x0 = Math.min(g.box.x, it.box.x), y0 = Math.min(g.box.y, it.box.y);
      const x1 = Math.max(g.box.x + g.box.width, it.box.x + it.box.width), y1 = Math.max(g.box.y + g.box.height, it.box.y + it.box.height);
      g.ids.push(it.id);
      g.box = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
      continue;
    }
    const unit: Unit = { ids: [it.id], box: { ...it.box } };
    if (it.groupId) byGroup.set(it.groupId, unit);
    out.push(unit);
  }
  return out;
}

/** The reference box: the frame when one unit is chosen, otherwise the box around all the units. */
export function referenceBox(units: readonly Unit[], frame: Box): Box {
  if (units.length < 2) return frame;
  const x0 = Math.min(...units.map((u) => u.box.x)), y0 = Math.min(...units.map((u) => u.box.y));
  const x1 = Math.max(...units.map((u) => u.box.x + u.box.width)), y1 = Math.max(...units.map((u) => u.box.y + u.box.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** how far each unit must move to line up with the reference box */
export function alignDeltas(units: readonly Unit[], kind: AlignKind, frame: Box): Delta[] {
  const ref = referenceBox(units, frame);
  return units.map((u) => {
    const b = u.box;
    switch (kind) {
      case "left": return { dx: r2(ref.x - b.x), dy: 0 };
      case "hcenter": return { dx: r2(ref.x + ref.width / 2 - (b.x + b.width / 2)), dy: 0 };
      case "right": return { dx: r2(ref.x + ref.width - (b.x + b.width)), dy: 0 };
      case "top": return { dx: 0, dy: r2(ref.y - b.y) };
      case "vcenter": return { dx: 0, dy: r2(ref.y + ref.height / 2 - (b.y + b.height / 2)) };
      case "bottom": return { dx: 0, dy: r2(ref.y + ref.height - (b.y + b.height)) };
    }
  });
}

/** Equal gaps between three or more units along an axis: the first and the last stay, the ones between are spaced evenly. Null with fewer than three. */
export function distributeDeltas(units: readonly Unit[], axis: "x" | "y"): Delta[] | null {
  if (units.length < 3) return null;
  const pos = (u: Unit) => (axis === "x" ? u.box.x : u.box.y);
  const len = (u: Unit) => (axis === "x" ? u.box.width : u.box.height);
  const order = units.map((u, i) => i).sort((a, b) => pos(units[a]) - pos(units[b]) || a - b);
  const first = units[order[0]], last = units[order[order.length - 1]];
  const span = pos(last) + len(last) - pos(first);
  const gap = (span - order.reduce((s, i) => s + len(units[i]), 0)) / (order.length - 1);
  const out: Delta[] = units.map(() => ({ dx: 0, dy: 0 }));
  let cursor = pos(first) + len(first) + gap;
  for (const i of order.slice(1, -1)) {
    const d = r2(cursor - pos(units[i]));
    out[i] = axis === "x" ? { dx: d, dy: 0 } : { dx: 0, dy: d };
    cursor += len(units[i]) + gap;
  }
  return out;
}
