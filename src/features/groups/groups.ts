import { sortByZ } from "@/features/layer-transform/order";
import { BitmapLayer, LayerGroup } from "@/lib/project/schema";

/* Layer groups: one level (a layer is in one group or none), saved with the project (`groups` on the screen, `groupId` on a layer),
 * selected and moved as one, listed in the layer panel under a header that folds. A group has no picture of its own. */

/** a group needs at least two layers; with fewer it is dissolved */
export const MIN_GROUP_SIZE = 2;

/** `ids` plus, for every id that is in a group, all the other members of that group (order: the given ids first) */
export function expandToGroups(layers: readonly BitmapLayer[], ids: readonly string[]): string[] {
  const out = [...new Set(ids)];
  const seen = new Set(out);
  for (const id of ids) {
    const gid = layers.find((l) => l.id === id)?.groupId;
    if (!gid) continue;
    for (const l of layers) if (l.groupId === gid && !seen.has(l.id)) (seen.add(l.id), out.push(l.id));
  }
  return out;
}

export const membersOf = (layers: readonly BitmapLayer[], groupId: string) => sortByZ(layers).reverse().filter((l) => l.groupId === groupId);

/** When the selection is exactly the members of one group, that group's id (else null) */
export function wholeGroupOf(layers: readonly BitmapLayer[], ids: readonly string[]): string | null {
  const first = layers.find((l) => l.id === ids[0])?.groupId;
  if (!first) return null;
  const members = layers.filter((l) => l.groupId === first);
  return members.length === ids.length && members.every((m) => ids.includes(m.id)) ? first : null;
}

export type PanelRow = { kind: "group"; group: LayerGroup; members: BitmapLayer[]; folded: boolean } | { kind: "layer"; layer: BitmapLayer; inGroup: boolean };

/** The layer panel's rows, front to back. A group's header sits where its front-most member is and lists all its members under it
 *  (even if other layers lie between them in the stacking), so each layer appears once. A folded group lists no members. */
export function panelRows(layers: readonly BitmapLayer[], groups: readonly LayerGroup[], collapsed: ReadonlySet<string>): PanelRow[] {
  const front = sortByZ(layers).reverse();
  const known = new Map(groups.map((g) => [g.id, g]));
  const rows: PanelRow[] = [];
  const done = new Set<string>();
  for (const l of front) {
    const g = l.groupId ? known.get(l.groupId) : undefined;
    if (!g) {
      rows.push({ kind: "layer", layer: l, inGroup: false });
      continue;
    }
    if (done.has(g.id)) continue;
    done.add(g.id);
    const members = front.filter((m) => m.groupId === g.id);
    rows.push({ kind: "group", group: g, members, folded: collapsed.has(g.id) });
    if (!collapsed.has(g.id)) for (const m of members) rows.push({ kind: "layer", layer: m, inGroup: true });
  }
  return rows;
}

/** the layer ids a row stands for: a layer is itself; a FOLDED group header is all its members (its layers are not listed); an open group's
 *  header stands for nothing by itself, its members are rows of their own */
export const rowIds = (row: PanelRow): string[] => (row.kind === "layer" ? [row.layer.id] : row.folded ? row.members.map((m) => m.id) : []);

/** Shift+click: every row from the anchor to the target in the panel's order (both ends included), as layer ids. Hidden and locked layers
 *  are included (selecting is not editing: moving and deleting still skip locked ones). Unknown ids give just the target. */
export function rangeSelect(rows: readonly PanelRow[], anchorId: string | null, targetId: string): string[] {
  // a layer is found at its own row; inside a folded group it is found at the group's header; an open group's header is where its first member is
  const index = (id: string) => {
    const own = rows.findIndex((r) => r.kind === "layer" && r.layer.id === id);
    if (own >= 0) return own;
    return rows.findIndex((r) => r.kind === "group" && r.members.some((m) => m.id === id));
  };
  const a = anchorId ? index(anchorId) : -1;
  const b = index(targetId);
  if (b < 0) return [targetId];
  if (a < 0) return rowIds(rows[b]).length ? rowIds(rows[b]) : [targetId];
  const [from, to] = a < b ? [a, b] : [b, a];
  const out: string[] = [];
  for (const r of rows.slice(from, to + 1)) for (const id of rowIds(r)) if (!out.includes(id)) out.push(id);
  return out;
}

/** In a draft screen: drop groups with fewer than MIN_GROUP_SIZE members and clear groupIds that point at nothing */
export function pruneGroups(screen: { layers: BitmapLayer[]; groups?: LayerGroup[] }): void {
  const count = new Map<string, number>();
  for (const l of screen.layers) if (l.groupId) count.set(l.groupId, (count.get(l.groupId) ?? 0) + 1);
  const keep = new Set([...count].filter(([id, n]) => n >= MIN_GROUP_SIZE && screen.groups?.some((g) => g.id === id)).map(([id]) => id));
  for (const l of screen.layers) if (l.groupId && !keep.has(l.groupId)) delete l.groupId;
  if (screen.groups) {
    const kept = screen.groups.filter((g) => keep.has(g.id));
    if (kept.length === 0) delete screen.groups;
    else if (kept.length !== screen.groups.length) screen.groups = kept;
  }
}

/** "그룹 1", "그룹 2"... the first number not used by a group name */
export function nextGroupName(groups: readonly LayerGroup[]): string {
  const used = new Set(groups.map((g) => g.name));
  for (let n = 1; ; n++) if (!used.has(`그룹 ${n}`)) return `그룹 ${n}`;
}
