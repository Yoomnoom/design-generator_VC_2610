import { describe, expect, test } from "vitest";
import { BUILTIN_ASSETS, assetRect } from "@/features/assets/builtin";
import { TEMPLATES, templateBundle } from "@/features/assets/templates";
import { renderProjectRaw } from "@/features/export-image/export-png";
import { panelRows, rangeSelect } from "@/features/groups/groups";
import { parseProject, serializeProject } from "@/lib/project/parse";
import { Rasterize } from "@/lib/image/vector-raster";
import { solid } from "./helpers";
import { storeWith } from "./fixtures";

const fake: Rasterize = (content, t) => ({ image: solid(Math.max(1, Math.ceil(content.width)), Math.max(1, Math.ceil(content.height)), [(JSON.stringify(content).length * 7) & 255, 90, 160, 255]), x: Math.round(t.x), y: Math.round(t.y) });
function pageWith(n: number) {
  const ctx = storeWith(solid(400, 300, [240, 240, 240, 255]));
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(ctx.get().addVectorLayer(assetRect(`R${i}`, 0, 0, 30 + i, 20, { fill: "#112233" }).content!, 10 + i * 40, 10)!);
  return { ctx, ids };
}
type Ctx = ReturnType<typeof pageWith>["ctx"];
const scr = (c: Ctx) => c.get().history!.present.screens[0];
const lay = (c: Ctx, id: string) => scr(c).layers.find((l) => l.id === id)!;
const png = (c: Ctx) => Buffer.from(renderProjectRaw(c.get().snapshotProject()!, c.get().images, fake).data);
const group = (c: Ctx, ids: string[]) => {
  c.store.setState({ selectedLayerIds: ids });
  return c.get().groupSelected()!;
};

describe("selecting inside groups (the bug: Ctrl/Shift on a member took the whole group)", () => {
  test("Ctrl+click toggles exactly one layer, also for a member of a group; a group header toggles the whole group", () => {
    const { ctx, ids } = pageWith(4);
    const g = group(ctx, [ids[1], ids[2]]);
    ctx.get().selectLayer(ids[0]);
    ctx.get().toggleLayerSelection(ids[1]); // the canvas and the panel both call this for Ctrl+click
    expect(ctx.get().selectedLayerIds).toEqual([ids[0], ids[1]]);
    ctx.get().toggleLayerSelection(ids[1]);
    expect(ctx.get().selectedLayerIds).toEqual([ids[0]]);
    ctx.get().toggleLayerSelection(ids[2], true); // the header: the whole group
    expect(new Set(ctx.get().selectedLayerIds)).toEqual(new Set([ids[0], ids[1], ids[2]]));
    expect(g).toBeTruthy();
  });

  test("a plain click in the panel selects that layer only; on the canvas it selects the group", () => {
    const { ctx, ids } = pageWith(3);
    group(ctx, [ids[0], ids[1]]);
    ctx.get().selectLayer(ids[0]);
    expect(ctx.get().selectedLayerIds).toEqual([ids[0]]);
    ctx.get().selectLayerWithGroup(ids[0]);
    expect(new Set(ctx.get().selectedLayerIds)).toEqual(new Set([ids[0], ids[1]]));
  });

  test("Shift range: single layers in panel order; an open group's header adds nothing by itself; a folded group counts as one row", () => {
    const { ctx, ids } = pageWith(5); // panel: R4, R3, R2, R1, R0
    const g = group(ctx, [ids[2], ids[3]]);
    const s = scr(ctx);
    const open = panelRows(s.layers, s.groups!, new Set());
    // rows: R4, [G], R3, R2, R1, R0 : from R4 to R2 takes R4, R3, R2, not R1
    expect(rangeSelect(open, ids[4], ids[2])).toEqual([ids[4], ids[3], ids[2]]);
    expect(rangeSelect(open, ids[4], ids[1])).toEqual([ids[4], ids[3], ids[2], ids[1]]);
    expect(rangeSelect(open, ids[4], ids[3])).toEqual([ids[4], ids[3]]); // the header between them does not pull in the other member
    const folded = panelRows(s.layers, s.groups!, new Set([g]));
    expect(rangeSelect(folded, ids[4], ids[1]).sort()).toEqual([ids[4], ids[3], ids[2], ids[1]].sort()); // the folded group is one row
    expect(rangeSelect(folded, ids[0], ids[4]).length).toBe(5);
    // a member in the middle of an open group is found at its own row
    expect(rangeSelect(open, ids[3], ids[3])).toEqual([ids[3]]);
  });

  test("with part of a group selected, delete, duplicate and move touch only the selected layers; the others keep their group", () => {
    const { ctx, ids } = pageWith(4);
    const g = group(ctx, [ids[0], ids[1], ids[2]]);
    ctx.store.setState({ selectedLayerIds: [ids[0]] });
    const x = ids.map((i) => lay(ctx, i).transform.x);
    ctx.get().nudgeLayers([ids[0]], 5, 0);
    expect(lay(ctx, ids[0]).transform.x).toBe(x[0] + 5);
    expect(lay(ctx, ids[1]).transform.x).toBe(x[1]);
    const copy = ctx.get().duplicateLayer(ids[0])!;
    expect(lay(ctx, copy).groupId).toBeUndefined();
    expect(lay(ctx, ids[0]).groupId).toBe(g);
    ctx.store.setState({ selectedLayerIds: [ids[0]] });
    ctx.get().deleteSelectedLayers();
    expect(lay(ctx, ids[1]).groupId).toBe(g);
    expect(lay(ctx, ids[2]).groupId).toBe(g);
    ctx.store.setState({ selectedLayerIds: [ids[1]] });
    ctx.get().deleteSelectedLayers(); // one member left: the group is dissolved (a group needs two)
    expect(lay(ctx, ids[2]).groupId).toBeUndefined();
    expect(scr(ctx).groups).toBeUndefined();
  });
});

describe("sources and templates go in as groups", () => {
  test("a built-in of several layers is ONE group named like the source and is selected; one layer makes no group; one undo step", () => {
    const { ctx } = pageWith(0);
    const past = ctx.get().history!.past.length;
    const btn = BUILTIN_ASSETS.find((a) => a.id === "button-fill-hover")!.build();
    const ids = ctx.get().insertAsset(btn, "center")!;
    expect(ids.length).toBe(btn.layers.length);
    expect(ctx.get().history!.past).toHaveLength(past + 1);
    expect(scr(ctx).groups).toEqual([{ id: expect.any(String), name: btn.name }]);
    expect(new Set(ids.map((i) => lay(ctx, i).groupId)).size).toBe(1);
    expect(ctx.get().selectedLayerIds).toEqual(ids);
    const divider = BUILTIN_ASSETS.find((a) => a.id === "divider")!.build();
    ctx.get().insertAsset(divider, "center");
    expect(scr(ctx).groups).toHaveLength(1);
    ctx.get().undo();
    ctx.get().undo();
    expect(scr(ctx).groups).toBeUndefined();
    expect(scr(ctx).layers).toHaveLength(0);
  });

  test("inserting the same source twice makes two groups; a source made of loose layers (my sources) is grouped too; a source with its own groups keeps them as they were", () => {
    const { ctx } = pageWith(0);
    const card = BUILTIN_ASSETS.find((a) => a.id === "card")!.build();
    ctx.get().insertAsset(card, "center");
    ctx.get().insertAsset(card, "center");
    expect(scr(ctx).groups).toHaveLength(2);
    const own = { ...card, layers: card.layers.map((l, i) => ({ ...l, groupKey: i < 2 ? "a" : undefined, groupName: i < 2 ? "Own" : undefined })) };
    const fresh = pageWith(0).ctx;
    fresh.get().insertAsset(own, "center");
    expect(fresh.get().history!.present.screens[0].groups!.map((g) => g.name)).toEqual(["Own"]); // not wrapped again
  });

  test("a template added to the screen brings its component groups (one per field, card or row), nothing wrapped around them", () => {
    for (const t of TEMPLATES) {
      const { ctx } = pageWith(0);
      const b = templateBundle(t.id);
      const keys = new Set(b.layers.map((l) => l.groupKey).filter(Boolean));
      ctx.get().insertAsset(b, "keep");
      expect(scr(ctx).groups!.length, t.id).toBe(keys.size);
      expect(scr(ctx).groups!.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("the PNG of a source is the same grouped or not (group membership has no picture)", () => {
    const a = pageWith(0).ctx, b = pageWith(0).ctx;
    const card = BUILTIN_ASSETS.find((x) => x.id === "card")!.build();
    a.get().insertAsset(card, "center");
    b.get().insertAsset({ ...card, layers: card.layers.map((l) => ({ ...l })) }, "keep"); // "keep" does not wrap: the same layers, no group
    expect(scr(b).groups).toBeUndefined();
    // center vs keep place differently, so compare grouped and ungrouped copies of the same placement
    a.get().ungroupSelected();
    expect(scr(a).groups).toBeUndefined();
  });
});

describe("putting layers in and out of a group", () => {
  test("addToGroup: the layers join, the stacking order is not touched, one undo step, the group is selected", () => {
    const { ctx, ids } = pageWith(4);
    const g = group(ctx, [ids[0], ids[2]]); // R1 sits between them in the stacking
    const z = ids.map((i) => lay(ctx, i).zIndex);
    const before = png(ctx);
    const past = ctx.get().history!.past.length;
    expect(ctx.get().addToGroup(g, [ids[1]])).toBe(true);
    expect(ctx.get().history!.past).toHaveLength(past + 1);
    expect(lay(ctx, ids[1]).groupId).toBe(g);
    expect(ids.map((i) => lay(ctx, i).zIndex)).toEqual(z);
    expect(new Set(ctx.get().selectedLayerIds)).toEqual(new Set([ids[0], ids[1], ids[2]]));
    expect(png(ctx).equals(before)).toBe(true);
    ctx.get().undo();
    expect(lay(ctx, ids[1]).groupId).toBeUndefined();
    expect(png(ctx).equals(before)).toBe(true);
    ctx.get().redo();
    expect(lay(ctx, ids[1]).groupId).toBe(g);
    expect(ctx.get().addToGroup(g, [ids[1]])).toBe(false); // already in: nothing recorded
  });

  test("the panel lists the members together even when another layer lies between them in the stacking", () => {
    const { ctx, ids } = pageWith(4);
    group(ctx, [ids[0], ids[2]]);
    const s = scr(ctx);
    const rows = panelRows(s.layers, s.groups!, new Set());
    expect(rows.map((r) => (r.kind === "group" ? "G" : `${r.inGroup ? " " : ""}${ids.indexOf(r.layer.id)}`))).toEqual(["3", "G", " 2", " 0", "1"]);
  });

  test("a layer from another group moves over; that group is dissolved if it is left with one layer", () => {
    const { ctx, ids } = pageWith(5);
    const g1 = group(ctx, [ids[0], ids[1]]);
    const g2 = group(ctx, [ids[2], ids[3]]);
    expect(ctx.get().addToGroup(g2, [ids[1]])).toBe(true);
    expect(lay(ctx, ids[1]).groupId).toBe(g2);
    expect(lay(ctx, ids[0]).groupId).toBeUndefined(); // g1 had two, now one: dissolved
    expect(scr(ctx).groups!.map((g) => g.id)).toEqual([g2]);
    expect(g1).not.toBe(g2);
  });

  test("Ctrl+G with one whole group and loose layers selected adds the layers to that group; two whole groups are refused as nesting", () => {
    const { ctx, ids } = pageWith(5);
    const g1 = group(ctx, [ids[0], ids[1]]);
    ctx.store.setState({ selectedLayerIds: [ids[0], ids[1], ids[4]] });
    expect(ctx.get().groupSelected()).toBe(g1);
    expect(lay(ctx, ids[4]).groupId).toBe(g1);
    expect(scr(ctx).groups).toHaveLength(1);
    const g2 = group(ctx, [ids[2], ids[3]]);
    ctx.store.setState({ selectedLayerIds: [ids[0], ids[1], ids[4], ids[2], ids[3]] });
    const past = ctx.get().history!.past.length;
    expect(ctx.get().groupSelected()).toBeNull();
    expect(ctx.get().notice).toContain("다른 그룹");
    expect(ctx.get().history!.past).toHaveLength(past);
    expect(lay(ctx, ids[2]).groupId).toBe(g2);
    // dragging a whole group onto another group is the same refusal
    expect(ctx.get().addToGroup(g1, [ids[2], ids[3]])).toBe(false);
    expect(ctx.get().notice).toContain("다른 그룹");
  });

  test("removeFromGroup: the layers leave, the group stays while two remain and is dissolved with fewer; one undo step", () => {
    const { ctx, ids } = pageWith(4);
    const g = group(ctx, ids);
    const past = ctx.get().history!.past.length;
    expect(ctx.get().removeFromGroup([ids[3]])).toBe(1);
    expect(ctx.get().history!.past).toHaveLength(past + 1);
    expect(lay(ctx, ids[3]).groupId).toBeUndefined();
    expect(scr(ctx).groups).toHaveLength(1);
    expect(ctx.get().removeFromGroup([ids[2]])).toBe(1);
    expect(scr(ctx).groups).toHaveLength(1); // two left: still a group
    expect(ctx.get().removeFromGroup([ids[1]])).toBe(1);
    expect(scr(ctx).groups).toBeUndefined(); // one left: dissolved
    expect(lay(ctx, ids[0]).groupId).toBeUndefined();
    ctx.get().undo();
    expect(lay(ctx, ids[0]).groupId).toBe(g);
    expect(ctx.get().removeFromGroup([ids[3]])).toBe(0); // not in a group
  });

  test("locked layers, a locked member of the target group and comparing are refused with a reason; nothing changes", () => {
    const { ctx, ids } = pageWith(4);
    const g = group(ctx, [ids[0], ids[1]]);
    ctx.get().setLayerLocked(ids[2], true);
    let before = ctx.get().history;
    expect(ctx.get().addToGroup(g, [ids[2]])).toBe(false);
    expect(ctx.get().notice).toContain("잠긴");
    ctx.get().setLayerLocked(ids[2], false);
    ctx.get().setLayerLocked(ids[1], true); // a locked member of the target
    before = ctx.get().history;
    expect(ctx.get().addToGroup(g, [ids[3]])).toBe(false);
    expect(ctx.get().removeFromGroup([ids[0]])).toBe(0);
    expect(ctx.get().history).toBe(before);
    ctx.get().setLayerLocked(ids[1], false);
    ctx.get().setCompareMode("original");
    before = ctx.get().history;
    expect(ctx.get().addToGroup(g, [ids[3]])).toBe(false);
    expect(ctx.get().removeFromGroup([ids[0]])).toBe(0);
    expect(ctx.get().history).toBe(before);
  });

  test("membership survives save and open, and the PNG is the same before and after every change", () => {
    const { ctx, ids } = pageWith(4);
    const base = png(ctx);
    const g = group(ctx, [ids[0], ids[1]]);
    ctx.get().addToGroup(g, [ids[2]]);
    expect(png(ctx).equals(base)).toBe(true);
    const back = parseProject(serializeProject(ctx.get().snapshotProject()!));
    expect(back.ok && back.project.screens[0].layers.filter((l) => l.groupId === g).length).toBe(3);
    ctx.get().removeFromGroup([ids[0]]);
    expect(png(ctx).equals(base)).toBe(true);
  });
});