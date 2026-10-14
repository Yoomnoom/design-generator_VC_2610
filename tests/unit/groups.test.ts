import fs from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, test } from "vitest";
import { BUILTIN_ASSETS, assetRect } from "@/features/assets/builtin";
import { captureBundle } from "@/features/assets/capture";
import { openAssetLibrary, parseAssetFile } from "@/features/assets/library";
import { TEMPLATES, buildTemplate, templateBundle } from "@/features/assets/templates";
import { renderProjectRaw } from "@/features/export-image/export-png";
import { panelRows, rangeSelect, wholeGroupOf } from "@/features/groups/groups";
import { selectScreen } from "@/store/editor-store";
import { parseProject, parseProjectValue, serializeProject } from "@/lib/project/parse";
import { parseProjectFile } from "@/features/project-persistence/project-file";
import { migrate } from "@/lib/project/migrate";
import { Rasterize } from "@/lib/image/vector-raster";
import { solid } from "./helpers";
import { fakeCodec, storeWith } from "./fixtures";

const fake: Rasterize = (content, t) => ({ image: solid(Math.max(1, Math.ceil(content.width)), Math.max(1, Math.ceil(content.height)), [(JSON.stringify(content).length * 7) & 255, 90, 160, 255]), x: Math.round(t.x), y: Math.round(t.y) });

/** a page with n vector layers (ids returned back to front) */
function pageWith(n: number) {
  const ctx = storeWith(solid(400, 300, [240, 240, 240, 255]));
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(ctx.get().addVectorLayer(assetRect(`R${i}`, 0, 0, 30 + i, 20, { fill: "#112233" }).content!, 10 + i * 40, 10)!);
  return { ctx, ids };
}
type Ctx = ReturnType<typeof pageWith>["ctx"];
const screenOf = (ctx: Ctx) => ctx.get().history!.present.screens[0];
const layer = (ctx: Ctx, id: string) => screenOf(ctx).layers.find((l) => l.id === id)!;
const png = (ctx: Ctx) => renderProjectRaw(ctx.get().snapshotProject()!, ctx.get().images, fake);

describe("groups: make, release, rename, one level", () => {
  test("Ctrl+G makes a group of the selected layers (two or more) as ONE undo step; undo and redo bring it and take it away", () => {
    const { ctx, ids } = pageWith(3);
    ctx.get().selectLayer(ids[0]);
    expect(ctx.get().groupSelected()).toBeNull(); // one layer is not a group
    expect(ctx.get().notice).toContain("두 개 이상");
    ctx.store.setState({ selectedLayerIds: [ids[0], ids[1]] });
    const past = ctx.get().history!.past.length;
    const gid = ctx.get().groupSelected()!;
    expect(gid).toBeTruthy();
    expect(ctx.get().history!.past).toHaveLength(past + 1);
    expect(screenOf(ctx).groups).toEqual([{ id: gid, name: "그룹 1" }]);
    expect([ids[0], ids[1]].map((i) => layer(ctx, i).groupId)).toEqual([gid, gid]);
    expect(layer(ctx, ids[2]).groupId).toBeUndefined();
    ctx.get().undo();
    expect(screenOf(ctx).groups).toBeUndefined();
    expect(layer(ctx, ids[0]).groupId).toBeUndefined();
    ctx.get().redo();
    expect(layer(ctx, ids[0]).groupId).toBe(gid);
  });

  test("Ctrl+Shift+G releases every group that has a selected layer; the layers stay; one undo step", () => {
    const { ctx, ids } = pageWith(4);
    ctx.store.setState({ selectedLayerIds: [ids[0], ids[1]] });
    ctx.get().groupSelected();
    ctx.store.setState({ selectedLayerIds: [ids[2], ids[3]] });
    ctx.get().groupSelected();
    ctx.store.setState({ selectedLayerIds: ids });
    const past = ctx.get().history!.past.length;
    expect(ctx.get().ungroupSelected()).toBe(2);
    expect(ctx.get().history!.past).toHaveLength(past + 1);
    expect(screenOf(ctx).groups).toBeUndefined();
    expect(screenOf(ctx).layers).toHaveLength(4);
    expect(screenOf(ctx).layers.every((l) => !l.groupId)).toBe(true);
    ctx.get().undo();
    expect(screenOf(ctx).groups).toHaveLength(2);
    ctx.store.setState({ selectedLayerIds: [] });
    expect(ctx.get().ungroupSelected()).toBe(0); // nothing to release
  });

  test("one level only: grouping a layer that is in a group moves it to the new group, and a group left with one layer is dissolved", () => {
    const { ctx, ids } = pageWith(3);
    ctx.store.setState({ selectedLayerIds: [ids[0], ids[1]] });
    const g1 = ctx.get().groupSelected()!;
    ctx.store.setState({ selectedLayerIds: [ids[1], ids[2]] });
    const g2 = ctx.get().groupSelected()!;
    expect(layer(ctx, ids[1]).groupId).toBe(g2);
    expect(layer(ctx, ids[2]).groupId).toBe(g2);
    expect(layer(ctx, ids[0]).groupId).toBeUndefined(); // g1 had only ids[0] left: dissolved
    expect(screenOf(ctx).groups!.map((g) => g.id)).toEqual([g2]);
    expect(g1).not.toBe(g2);
    expect(parseProject(serializeProject(ctx.get().snapshotProject()!)).ok).toBe(true);
  });

  test("deleting layers dissolves a group that is left with fewer than two; the delete and the dissolving are one undo step", () => {
    const { ctx, ids } = pageWith(3);
    ctx.store.setState({ selectedLayerIds: ids });
    ctx.get().groupSelected();
    ctx.store.setState({ selectedLayerIds: [ids[0]] });
    ctx.get().deleteSelectedLayers();
    expect(screenOf(ctx).groups).toHaveLength(1); // two left: still a group
    ctx.store.setState({ selectedLayerIds: [ids[1]] });
    const past = ctx.get().history!.past.length;
    ctx.get().deleteSelectedLayers();
    expect(ctx.get().history!.past).toHaveLength(past + 1);
    expect(screenOf(ctx).groups).toBeUndefined();
    expect(layer(ctx, ids[2]).groupId).toBeUndefined();
    ctx.get().undo();
    expect(screenOf(ctx).groups).toHaveLength(1);
    expect(layer(ctx, ids[2]).groupId).toBeTruthy();
  });

  test("rename: a name is trimmed and cut to 60, an empty or unchanged name does nothing, one undo step", () => {
    const { ctx, ids } = pageWith(2);
    ctx.store.setState({ selectedLayerIds: ids });
    const gid = ctx.get().groupSelected()!;
    const past = ctx.get().history!.past.length;
    expect(ctx.get().renameGroup(gid, "  Header  ")).toBe(true);
    expect(screenOf(ctx).groups![0].name).toBe("Header");
    expect(ctx.get().renameGroup(gid, "Header")).toBe(false);
    expect(ctx.get().renameGroup(gid, "   ")).toBe(false);
    expect(ctx.get().history!.past).toHaveLength(past + 1);
    ctx.get().renameGroup(gid, "x".repeat(100));
    expect(screenOf(ctx).groups![0].name).toHaveLength(60);
    ctx.get().undo();
    expect(screenOf(ctx).groups![0].name).toBe("Header");
  });

  test("while comparing, groups cannot be made, released, renamed or duplicated", () => {
    const { ctx, ids } = pageWith(2);
    ctx.store.setState({ selectedLayerIds: ids });
    const gid = ctx.get().groupSelected()!;
    ctx.get().setCompareMode("original");
    const before = ctx.get().history;
    expect(ctx.get().groupSelected()).toBeNull();
    expect(ctx.get().ungroupSelected()).toBe(0);
    expect(ctx.get().renameGroup(gid, "Nope")).toBe(false);
    expect(ctx.get().duplicateGroup(gid)).toBeNull();
    expect(ctx.get().history).toBe(before);
  });

  test("a group does not change the picture: the PNG is the same with and without it", () => {
    const { ctx, ids } = pageWith(3);
    const before = png(ctx);
    ctx.store.setState({ selectedLayerIds: ids });
    ctx.get().groupSelected();
    const grouped = png(ctx);
    expect(Buffer.from(grouped.data).equals(Buffer.from(before.data))).toBe(true);
    ctx.get().ungroupSelected();
    expect(Buffer.from(png(ctx).data).equals(Buffer.from(before.data))).toBe(true);
  });
});

describe("selecting groups", () => {
  test("a click on a layer of a group selects the whole group; Ctrl-click toggles the whole group; a panel click on a member selects only it", () => {
    const { ctx, ids } = pageWith(4);
    ctx.store.setState({ selectedLayerIds: [ids[1], ids[2]] });
    ctx.get().groupSelected();
    ctx.get().deselectAll();
    ctx.get().selectLayerWithGroup(ids[1]);
    expect(new Set(ctx.get().selectedLayerIds)).toEqual(new Set([ids[1], ids[2]]));
    ctx.get().selectLayerWithGroup(ids[0]);
    expect(ctx.get().selectedLayerIds).toEqual([ids[0]]);
    ctx.get().toggleLayerSelection(ids[2], true);
    expect(new Set(ctx.get().selectedLayerIds)).toEqual(new Set([ids[0], ids[1], ids[2]]));
    ctx.get().toggleLayerSelection(ids[1], true); // takes the whole group out
    expect(ctx.get().selectedLayerIds).toEqual([ids[0]]);
    ctx.get().selectLayer(ids[2]); // the panel: one member alone
    expect(ctx.get().selectedLayerIds).toEqual([ids[2]]);
    ctx.get().toggleLayerSelection(ids[3]); // a layer alone, not its group
    expect(ctx.get().selectedLayerIds).toEqual([ids[2], ids[3]]);
  });

  test("Shift-click in the panel selects every row from the last clicked layer to this one, in panel order; the anchor stays", () => {
    const { ctx, ids } = pageWith(5); // panel order, front first: ids[4], ids[3], ids[2], ids[1], ids[0]
    ctx.get().selectLayer(ids[3]);
    ctx.get().selectRange(ids[1]);
    expect(ctx.get().selectedLayerIds).toEqual([ids[3], ids[2], ids[1]]);
    ctx.get().selectRange(ids[0]); // widened from the same anchor
    expect(ctx.get().selectedLayerIds).toEqual([ids[3], ids[2], ids[1], ids[0]]);
    ctx.get().selectRange(ids[4]); // and the other way
    expect(ctx.get().selectedLayerIds).toEqual([ids[4], ids[3]]);
    ctx.get().deselectAll();
    ctx.get().selectRange(ids[2]); // no anchor: just that layer
    expect(ctx.get().selectedLayerIds).toEqual([ids[2]]);
  });

  test("a range includes hidden and locked layers (selecting is not editing); a range over a group takes the whole group", () => {
    const { ctx, ids } = pageWith(5);
    ctx.get().setLayerVisible(ids[3], false);
    ctx.get().setLayerLocked(ids[2], true);
    ctx.store.setState({ selectedLayerIds: [ids[0], ids[1]] });
    ctx.get().groupSelected();
    ctx.get().selectLayer(ids[4]);
    ctx.get().selectRange(ids[0]); // the group's rows are in the range
    expect(new Set(ctx.get().selectedLayerIds)).toEqual(new Set(ids));
  });

  test("Esc and a click on empty canvas clear the selection; Ctrl+A selects all layers", () => {
    const { ctx, ids } = pageWith(3);
    ctx.get().selectAllLayers();
    expect(ctx.get().selectedLayerIds).toHaveLength(3);
    ctx.get().deselectAll();
    expect(ctx.get().selectedLayerIds).toEqual([]);
    ctx.get().selectLayer(ids[0]);
    ctx.get().selectLayer(null);
    expect(ctx.get().selectedLayerIds).toEqual([]);
  });

  test("the panel's rows: a group's header sits at its front-most member with all members under it; folding hides them; each layer once", () => {
    const { ctx, ids } = pageWith(4);
    ctx.store.setState({ selectedLayerIds: [ids[0], ids[2]] }); // not next to each other in the stacking
    const gid = ctx.get().groupSelected()!;
    const s = screenOf(ctx);
    const rows = panelRows(s.layers, s.groups ?? [], new Set());
    const at = (id: string) => ids.indexOf(id); // R0..R3 = back to front
    expect(rows.map((r) => (r.kind === "group" ? `G:${r.group.name}` : `${r.inGroup ? "  " : ""}R${at(r.layer.id)}`))).toEqual(["R3", "G:그룹 1", "  R2", "  R0", "R1"]);
    const folded = panelRows(s.layers, s.groups ?? [], new Set([gid]));
    expect(folded.map((r) => r.kind)).toEqual(["layer", "group", "layer"]);
    expect(rangeSelect(folded, ids[3], ids[1]).sort()).toEqual([ids[3], ids[2], ids[0], ids[1]].sort()); // a folded group counts as all of its layers
    expect(wholeGroupOf(s.layers, [ids[0], ids[2]])).toBe(gid);
    expect(wholeGroupOf(s.layers, [ids[0]])).toBeNull();
  });
});

describe("moving, duplicating and pasting groups", () => {
  test("a group moves as one (drag and arrow keys are the same action); a locked member stays; one undo step", () => {
    const { ctx, ids } = pageWith(3);
    ctx.get().setLayerLocked(ids[1], true);
    ctx.store.setState({ selectedLayerIds: ids });
    ctx.get().groupSelected();
    ctx.get().selectLayerWithGroup(ids[0]);
    const x = ids.map((i) => layer(ctx, i).transform.x);
    const past = ctx.get().history!.past.length;
    ctx.get().nudgeLayers(ctx.get().selectedLayerIds, 10, 0);
    expect(ctx.get().history!.past).toHaveLength(past + 1);
    expect(layer(ctx, ids[0]).transform.x).toBe(x[0] + 10);
    expect(layer(ctx, ids[1]).transform.x).toBe(x[1]); // locked: stays
    expect(layer(ctx, ids[2]).transform.x).toBe(x[2] + 10);
    expect(layer(ctx, ids[1]).groupId).toBeTruthy(); // and is still in the group
  });

  test("a locked layer in a group is not deleted with it; it stays, in a group of what remains", () => {
    const { ctx, ids } = pageWith(3);
    ctx.get().setLayerLocked(ids[0], true);
    ctx.store.setState({ selectedLayerIds: ids });
    ctx.get().groupSelected();
    ctx.get().deleteSelectedLayers();
    expect(screenOf(ctx).layers.map((l) => l.id)).toEqual([ids[0]]);
    expect(screenOf(ctx).groups).toBeUndefined(); // one layer is no group
  });

  test("duplicating a whole group makes copies in a NEW group, same stacking, as one undo step; one layer duplicated or pasted is in no group", () => {
    const { ctx, ids } = pageWith(3);
    ctx.store.setState({ selectedLayerIds: [ids[0], ids[1]] });
    const gid = ctx.get().groupSelected()!;
    const past = ctx.get().history!.past.length;
    const copies = ctx.get().duplicateGroup(gid)!;
    expect(copies).toHaveLength(2);
    expect(ctx.get().history!.past).toHaveLength(past + 1);
    const g2 = layer(ctx, copies[0]).groupId!;
    expect(g2).not.toBe(gid);
    expect(copies.every((c) => layer(ctx, c).groupId === g2 && !layer(ctx, c).locked)).toBe(true);
    expect(screenOf(ctx).groups).toHaveLength(2);
    expect(screenOf(ctx).groups![1].name).toBe("그룹 1 복사");
    expect(layer(ctx, copies[0]).zIndex).toBeLessThan(layer(ctx, copies[1]).zIndex); // the same order as the originals
    ctx.get().undo();
    expect(screenOf(ctx).groups).toHaveLength(1);
    expect(screenOf(ctx).layers).toHaveLength(3);

    const one = ctx.get().duplicateLayer(ids[0])!;
    expect(layer(ctx, one).groupId).toBeUndefined();
    expect(layer(ctx, ids[0]).groupId).toBe(gid);
    ctx.get().copyLayer(ids[0]);
    const pasted = ctx.get().pasteLayer()!;
    expect(layer(ctx, pasted).groupId).toBeUndefined();
  });
});

describe("groups in sources and templates", () => {
  test("a source keeps the groups of its layers; inserting twice makes two separate groups; a group of one layer does not travel", () => {
    const { ctx, ids } = pageWith(3);
    ctx.store.setState({ selectedLayerIds: ids });
    ctx.get().groupSelected();
    ctx.get().renameGroup(screenOf(ctx).groups![0].id, "Header");
    const s = screenOf(ctx);
    const bundle = captureBundle("Hdr", s.layers, ctx.get().images, s.groups)!;
    expect(bundle.layers.every((l) => l.groupKey && l.groupName === "Header")).toBe(true);

    const other = pageWith(0).ctx;
    expect(other.get().insertAsset(bundle, "center")).toHaveLength(3);
    expect(other.get().insertAsset(bundle, "center")).toHaveLength(3);
    const groups = screenOf(other).groups!;
    expect(groups.map((g) => g.name)).toEqual(["Header", "Header"]);
    expect(groups[0].id).not.toBe(groups[1].id);
    expect(new Set(screenOf(other).layers.map((l) => l.groupId)).size).toBe(2);
    expect(parseProject(serializeProject(other.get().snapshotProject()!)).ok).toBe(true);
    other.get().undo();
    expect(screenOf(other).groups).toHaveLength(1);

    const partial = captureBundle("one", s.layers.slice(0, 1), ctx.get().images, s.groups)!;
    expect(partial.layers[0].groupKey).toBeUndefined();
    const lone = { ...bundle, layers: [bundle.layers[0]] }; // a bundle whose group has one layer left: no group forms
    const t = pageWith(0).ctx;
    t.get().insertAsset(lone, "center");
    expect(screenOf(t).groups).toBeUndefined();
  });

  test("saved in my sources and read back: the groups survive; a file with a bad group entry is refused", async () => {
    const { ctx, ids } = pageWith(2);
    ctx.store.setState({ selectedLayerIds: ids });
    ctx.get().groupSelected();
    const s = screenOf(ctx);
    const lib = await openAssetLibrary(fakeCodec(), "g", new IDBFactory());
    const rec = await lib.add(captureBundle("G", s.layers, ctx.get().images, s.groups)!, "G");
    const back = (await lib.load(rec.id))!;
    expect(back.layers.map((l) => l.groupName)).toEqual(["그룹 1", "그룹 1"]);
    const text = await lib.exportFile();
    const bad = JSON.parse(text);
    bad.assets[0].layers[0].groupKey = 5;
    const r = await parseAssetFile(JSON.stringify(bad), fakeCodec());
    expect(r.ok).toBe(false);
    expect((await parseAssetFile(text, fakeCodec())).ok).toBe(true);
    lib.close();
  });

  test("templates group their parts (fields, cards, rows); they open as valid projects, and adding one to a screen brings the groups", () => {
    for (const t of TEMPLATES) {
      const { project, images } = buildTemplate(t.id);
      const sc = project.screens[0];
      expect(sc.groups!.length).toBeGreaterThanOrEqual(2);
      expect(parseProject(serializeProject(project)).ok).toBe(true);
      expect(sc.layers.some((l) => l.groupId)).toBe(true);
      void images;
      const { ctx } = pageWith(0);
      ctx.get().insertAsset(templateBundle(t.id), "keep");
      expect(screenOf(ctx).groups!.length).toBe(sc.groups!.length);
    }
    expect(BUILTIN_ASSETS.length).toBeGreaterThan(10);
  });
});

describe("the file format: groups (version 8)", () => {
  const v7 = fs.readFileSync("tests/fixtures/project-v7.slc.json", "utf8");

  test("the file the previous build saved is version 7 and has no groups; it opens as the current version with every layer untouched", () => {
    const before = JSON.parse(v7).project;
    expect(before.version).toBe(7);
    expect(before.screens[0].groups).toBeUndefined();
    expect(before.screens[0].layers.some((l: { warp?: unknown }) => l.warp)).toBe(true);
    const r = parseProjectFile(v7);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.project.version).toBe(10);
    expect(r.file.project.screens[0].layers).toEqual(before.screens[0].layers);
    expect(r.file.project.screens[0].memos).toEqual(before.screens[0].memos);
    const m = migrate(JSON.parse(v7).project);
    expect(m.ok && m.doc.version).toBe(10);
  });

  test("groups survive save and open; a layer pointing at a missing group, a duplicate group id or a bad name is refused", () => {
    const { ctx, ids } = pageWith(2);
    ctx.store.setState({ selectedLayerIds: ids });
    ctx.get().groupSelected();
    const text = serializeProject(ctx.get().snapshotProject()!);
    const back = parseProject(text);
    expect(back.ok && back.project.screens[0].groups).toEqual(screenOf(ctx).groups);
    const mutate = (f: (s: Record<string, any>) => void) => {
      const doc = JSON.parse(text);
      f(doc.screens[0]);
      return parseProjectValue(doc);
    };
    expect(mutate((s) => (s.layers[0].groupId = "nope")).ok).toBe(false);
    expect(mutate((s) => s.groups.push({ ...s.groups[0] })).ok).toBe(false);
    expect(mutate((s) => (s.groups[0].name = 5)).ok).toBe(false);
    expect(mutate((s) => (s.groups[0].name = "x".repeat(61))).ok).toBe(false);
    expect(mutate((s) => (s.groups = "no")).ok).toBe(false);
    expect(mutate((s) => (s.groups = Array.from({ length: 101 }, (_, i) => ({ id: `g${i}`, name: "g" })))).ok).toBe(false);
  });

  test("restoring (loadProject) keeps groups and an empty history, and the PNG is the same", () => {
    const { ctx, ids } = pageWith(3);
    ctx.store.setState({ selectedLayerIds: ids });
    ctx.get().groupSelected();
    const png1 = png(ctx);
    const snap = ctx.get().snapshotProject()!;
    const again = storeWith(solid(400, 300, [240, 240, 240, 255]));
    again.get().loadProject(JSON.parse(JSON.stringify(snap)), ctx.get().images);
    expect(selectScreen(again.get())!.groups).toEqual(screenOf(ctx).groups);
    expect(again.get().history!.past).toHaveLength(0);
    expect(Buffer.from(renderProjectRaw(again.get().snapshotProject()!, again.get().images, fake).data).equals(Buffer.from(png1.data))).toBe(true);
  });
});
