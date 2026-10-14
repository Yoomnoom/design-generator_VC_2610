import { IDBFactory } from "fake-indexeddb";
import { describe, expect, test } from "vitest";
import { BUILTIN_ASSETS, BUTTON_STATES, BUTTON_STYLES, buttonBundle } from "@/features/assets/builtin";
import { captureBundle } from "@/features/assets/capture";
import { ASSET_FILE_FORMAT, openAssetLibrary, parseAssetFile, uniqueName } from "@/features/assets/library";
import { TEMPLATES, TemplateId, buildTemplate, templateBundle } from "@/features/assets/templates";
import { renderProjectRaw } from "@/features/export-image/export-png";
import { parseProject, serializeProject } from "@/lib/project/parse";
import { createEditorStore } from "@/store/editor-store";
import { CARD, committedId, fakeCodec, storeWith } from "./fixtures";
import { getPixel, setPixel, solid } from "./helpers";

const layersOf = (ctx: ReturnType<typeof storeWith>) => ctx.get().history!.present.screens[0].layers;
const page = () => storeWith(solid(400, 300, [240, 240, 240, 255]));

describe("built-in sources", () => {
  test("every built-in is valid and goes in as new layers in ONE undo step, centred in the frame", () => {
    for (const a of BUILTIN_ASSETS) {
      const ctx = page();
      const past = ctx.get().history!.past.length;
      const ids = ctx.get().insertAsset(a.build(), "center");
      expect(ids, a.id).not.toBeNull();
      expect(layersOf(ctx).length).toBe(ids!.length);
      expect(ctx.get().history!.past.length).toBe(past + 1);
      expect(ctx.get().selectedLayerIds).toEqual(ids);
      // the group's box is centred (to a pixel or two: text height and rounding)
      const xs = layersOf(ctx).flatMap((l) => [l.transform.x, l.transform.x + (l.content?.width ?? 0)]);
      const ys = layersOf(ctx).flatMap((l) => [l.transform.y, l.transform.y + (l.content?.height ?? 0)]);
      expect(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 200), a.id).toBeLessThanOrEqual(1);
      expect(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - 150), a.id).toBeLessThanOrEqual(3);
      ctx.get().undo();
      expect(layersOf(ctx)).toHaveLength(0);
      ctx.get().redo();
      expect(layersOf(ctx)).toHaveLength(ids!.length);
    }
  });

  test("the catalogue has the parts that were asked for, and every button has its three looks", () => {
    const ids = BUILTIN_ASSETS.map((a) => a.id);
    for (const part of ["card", "input", "tag", "divider"]) expect(ids).toContain(part);
    expect(BUILTIN_ASSETS.filter((a) => a.group === "icon").length).toBeGreaterThanOrEqual(4);
    for (const s of BUTTON_STYLES) for (const st of BUTTON_STATES) expect(ids).toContain(`button-${s.id}-${st.id}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the three looks of a button really differ, in the way each style says", () => {
    const body = (style: "fill" | "outline" | "underline" | "slide", state: "rest" | "hover" | "pressed") => buttonBundle(style, state).layers;
    const shadowY = (s: "rest" | "hover" | "pressed") => body("fill", s)[0].transform.y - body("fill", s)[1].transform.y;
    expect(shadowY("hover")).toBeGreaterThan(shadowY("rest")); // deeper shadow on hover
    expect(body("fill", "pressed")[1].transform.y).toBeGreaterThan(body("fill", "rest")[1].transform.y); // sinks when pressed
    const fillOf = (s: "rest" | "hover" | "pressed") => (body("fill", s)[1].content as { fill: string }).fill;
    expect(new Set(["rest", "hover", "pressed"].map((s) => fillOf(s as "rest"))).size).toBe(3);
    const edge = (s: "rest" | "hover" | "pressed") => (body("outline", s)[0].content as { strokeWidth: number }).strokeWidth;
    expect(edge("hover")).toBeGreaterThan(edge("rest"));
    const rule = (s: "rest" | "hover" | "pressed") => (body("underline", s)[1].content as { height: number }).height;
    expect(rule("hover")).toBeGreaterThan(rule("rest"));
    const covered = (s: "rest" | "hover" | "pressed") => body("slide", s).find((l) => l.name === "채움")?.content?.width ?? 0;
    expect([covered("rest"), covered("hover"), covered("pressed")]).toEqual([0, 80, 160]);
  });

  test("refused while comparing; nothing changes", () => {
    const ctx = page();
    ctx.get().setCompareMode("original");
    expect(ctx.get().insertAsset(BUILTIN_ASSETS[0].build(), "center")).toBeNull();
    expect(layersOf(ctx)).toHaveLength(0);
  });

  test("a bundle with a bad layer, no layers, or a missing picture is refused whole", () => {
    const ctx = page();
    const good = BUILTIN_ASSETS[0].build();
    expect(ctx.get().insertAsset({ ...good, layers: [] }, "center")).toBeNull();
    expect(ctx.get().insertAsset({ ...good, layers: [...good.layers, { name: "x", crop: { x: 0, y: 0, width: 0, height: 0 }, content: { kind: "rect", width: 5, height: 5, stroke: null, strokeWidth: 0, fill: null }, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, opacity: 1 }] }, "center")).toBeNull();
    expect(ctx.get().insertAsset({ name: "p", images: {}, layers: [{ name: "b", crop: { x: 0, y: 0, width: 4, height: 4 }, imageKey: "nope", transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, opacity: 1 }] }, "center")).toBeNull();
    expect(layersOf(ctx)).toHaveLength(0);
    expect(ctx.get().history!.past).toHaveLength(0);
  });

  test("a picture with no pixels is refused", () => {
    const ctx = page();
    const l = { name: "b", crop: { x: 0, y: 0, width: 1, height: 1 }, imageKey: "k", transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, opacity: 1 };
    expect(ctx.get().insertAsset({ name: "p", images: { k: { width: 0, height: 0, data: new Uint8ClampedArray(0) } }, layers: [l] }, "center")).toBeNull();
    expect(ctx.get().insertAsset({ name: "p", images: { k: solid(2, 2, [1, 2, 3, 255]) }, layers: [l] }, "center")).not.toBeNull();
  });

  test("inserted layers are normal ones: visible, unlocked, on top of what was there; a second insert stacks above the first", () => {
    const ctx = page();
    const a = ctx.get().insertAsset(BUILTIN_ASSETS.find((x) => x.id === "card")!.build(), "center")!;
    const b = ctx.get().insertAsset(BUILTIN_ASSETS.find((x) => x.id === "tag")!.build(), "center")!;
    const ls = layersOf(ctx);
    expect(ls.every((l) => l.visible && !l.locked)).toBe(true);
    const z = (id: string) => ls.find((l) => l.id === id)!.zIndex;
    expect(Math.min(...b.map(z))).toBeGreaterThan(Math.max(...a.map(z)));
    expect(new Set(ls.map((l) => l.id)).size).toBe(ls.length);
  });

  test("it is drawn into the exported picture at the frame's size", () => {
    const ctx = page();
    ctx.get().insertAsset(BUILTIN_ASSETS.find((x) => x.id === "divider")!.build(), "center");
    const out = renderProjectRaw(ctx.get().snapshotProject()!, ctx.get().images, () => ({ image: solid(240, 1, [209, 213, 219, 255]), x: 80, y: 150 }));
    expect([out.width, out.height]).toEqual([400, 300]);
  });
});

describe("a source made from layers", () => {
  const withBitmap = () => {
    const ctx = storeWith();
    const id = committedId(ctx.get().beginExtraction(CARD));
    const raw = ctx.get().images.get(layersOf(ctx)[0].imageId!)!.raw;
    setPixel(raw, 3, 3, [255, 0, 0, 255]);
    const rect = ctx.get().addVectorLayer({ kind: "rect", width: 30, height: 12, stroke: "#000000", strokeWidth: 2, fill: "#ffcc00" }, 40, 20)!;
    return { ctx, id, rect };
  };

  test("several layers, bitmap and vector, keep their look, their relative places and their stacking when inserted again", () => {
    const { ctx, id, rect } = withBitmap();
    const chosen = layersOf(ctx).filter((l) => [id, rect].includes(l.id));
    const b = captureBundle("my", chosen, ctx.get().images)!;
    expect(b.layers.map((l) => l.name)).toEqual(chosen.map((l) => l.name));
    expect(Math.min(...b.layers.map((l) => l.transform.x))).toBe(0);
    expect(Math.min(...b.layers.map((l) => l.transform.y))).toBe(0);
    const fresh = storeWith(solid(300, 200, [240, 240, 240, 255]));
    const ids = fresh.get().insertAsset(b, "keep")!;
    expect(ids).toHaveLength(2);
    const [bm, vec] = ids.map((i) => layersOf(fresh).find((l) => l.id === i)!);
    expect(vec.content).toEqual(layersOf(ctx).find((l) => l.id === rect)!.content);
    expect(bm.imageId).toBeDefined();
    expect(getPixel(fresh.get().images.get(bm.imageId!)!.raw, 3, 3)).toEqual([255, 0, 0, 255]);
    expect(vec.transform.x - bm.transform.x).toBe(layersOf(ctx).find((l) => l.id === rect)!.transform.x - layersOf(ctx).find((l) => l.id === id)!.transform.x);
    expect(bm.zIndex).toBeLessThan(vec.zIndex);
  });

  test("nothing selected, or a layer whose picture is gone, gives no source", () => {
    const { ctx } = withBitmap();
    expect(captureBundle("x", [], ctx.get().images)).toBeNull();
    expect(captureBundle("x", layersOf(ctx).slice(0, 1), new Map())).toBeNull();
  });
});

describe("my sources (stored apart from the project)", () => {
  const open = (name: string, f = new IDBFactory()) => openAssetLibrary(fakeCodec(), name, f);
  const sample = () => {
    const ctx = storeWith();
    committedId(ctx.get().beginExtraction(CARD));
    ctx.get().addVectorLayer({ kind: "ellipse", width: 20, height: 20, stroke: null, strokeWidth: 0, fill: "#00aa00" }, 5, 5);
    return captureBundle("sample", layersOf(ctx), ctx.get().images)!;
  };

  test("save, list, insert, rename, delete; the picture survives the round trip through the store", async () => {
    const lib = await open("a");
    const rec = await lib.add(sample(), "  Mine  ");
    expect(rec.name).toBe("Mine");
    expect((await lib.list()).map((a) => a.name)).toEqual(["Mine"]);
    const loaded = (await lib.load(rec.id))!;
    expect(loaded.layers).toHaveLength(2);
    const bitmap = loaded.layers.find((l) => l.imageKey)!;
    expect(loaded.images[bitmap.imageKey!].width).toBe(20);
    expect(await lib.rename(rec.id, "Renamed")).toBe("Renamed");
    expect(await lib.rename(rec.id, "   ")).toBeNull();
    expect((await lib.list())[0].name).toBe("Renamed");
    await lib.remove(rec.id);
    expect(await lib.list()).toEqual([]);
    expect(await lib.load(rec.id)).toBeNull();
  });

  test("the same name is not overwritten: it is made unique, on save, on rename and on import", async () => {
    expect(uniqueName("a", ["a", "a (2)"])).toBe("a (3)");
    expect(uniqueName("", [])).toBe("내 소스");
    expect(uniqueName("x".repeat(80), []).length).toBe(60);
    const lib = await open("b");
    const one = await lib.add(sample(), "Same");
    const two = await lib.add(sample(), "Same");
    expect([one.name, two.name]).toEqual(["Same", "Same (2)"]);
    expect(await lib.rename(two.id, "Same")).toBe("Same (2)");
    expect(await lib.rename(two.id, "Same")).not.toBe("Same");
    expect((await lib.list()).map((a) => a.name).sort()).toEqual(["Same", "Same (2)"]);
  });

  test("the library is its own database: the project's database is untouched and a project file never holds a source", async () => {
    const f = new IDBFactory();
    const lib = await open("c", f);
    await lib.add(sample(), "Mine");
    const dbs = await f.databases();
    expect(dbs.map((d) => d.name)).toEqual(["c"]);
    const ctx = storeWith();
    expect(JSON.stringify(ctx.get().snapshotProject())).not.toContain("Mine");
  });

  test("export and import: another computer gets the same sources with their pictures; names that exist are kept apart", async () => {
    const a = await open("d1");
    await a.add(sample(), "One");
    await a.add(sample(), "Two");
    const text = await a.exportFile();
    expect(JSON.parse(text).format).toBe(ASSET_FILE_FORMAT);
    const b = await open("d2");
    await b.add(sample(), "One"); // already there
    const r = await b.importFile(text);
    expect(r).toEqual({ ok: true, added: ["One (2)", "Two"], renamed: [{ from: "One", to: "One (2)" }] });
    expect((await b.list()).map((x) => x.name).sort()).toEqual(["One", "One (2)", "Two"]);
    const two = (await b.list()).find((x) => x.name === "Two")!;
    const loaded = (await b.load(two.id))!;
    expect(Object.values(loaded.images)[0].width).toBe(20);
    // importing the same file again adds copies, never overwrites
    const again = await b.importFile(text);
    expect(again.ok && again.renamed.length).toBe(2);
    expect((await b.list()).length).toBe(5);
  });

  test("the library holds at most 200 sources: an import that would pass that is refused whole", async () => {
    const lib = await open("max");
    await lib.add(sample(), "First");
    const one = { name: "n", layers: [{ name: "r", crop: { x: 0, y: 0, width: 0, height: 0 }, content: { kind: "rect", width: 5, height: 5, stroke: null, strokeWidth: 0, fill: "#000000" }, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, opacity: 1 }], images: {} };
    const file = JSON.stringify({ format: ASSET_FILE_FORMAT, version: 1, assets: Array.from({ length: 200 }, (_, i) => ({ ...one, name: `n${i}` })) });
    const r = await lib.importFile(file);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain("200");
    expect(await lib.list()).toHaveLength(1);
  });

  test("a damaged file is refused with the reason and nothing is saved", async () => {
    const lib = await open("e");
    const good = JSON.parse(await (async () => { const l = await open("e0"); await l.add(sample(), "S"); return l.exportFile(); })());
    const bad: [string, string, RegExp][] = [
      ["not JSON", "{oops", /JSON/],
      ["another kind of file", JSON.stringify({ format: "other" }), /소스 파일/],
      ["a newer version", JSON.stringify({ ...good, version: 99 }), /새로운 버전/],
      ["no sources", JSON.stringify({ ...good, assets: [] }), /소스가 없/],
      ["a nameless source", JSON.stringify({ ...good, assets: [{ ...good.assets[0], name: "" }] }), /이름/],
      ["a layer with a bad shape", JSON.stringify({ ...good, assets: [{ ...good.assets[0], layers: [{ ...good.assets[0].layers[1], content: { kind: "rect", width: -1, height: 2, stroke: null, strokeWidth: 0, fill: null } }] }] }), /레이어 모양/],
      ["a picture that is missing", JSON.stringify({ ...good, assets: [{ ...good.assets[0], images: {} }] }), /그림이 파일에 없/],
      ["a picture that cannot be read", JSON.stringify({ ...good, assets: [{ ...good.assets[0], images: Object.fromEntries(Object.keys(good.assets[0].images).map((k) => [k, { mime: "image/png", data: "AAAA" }])) }] }), /읽을 수 없/],
      ["a layer position that is not a number", JSON.stringify({ ...good, assets: [{ ...good.assets[0], layers: [{ ...good.assets[0].layers[1], transform: { x: "a", y: 0, scaleX: 1, scaleY: 1, rotation: 0 } }] }] }), /위치/],
    ];
    for (const [name, text, reason] of bad) {
      const r = await lib.importFile(text);
      expect(r.ok, name).toBe(false);
      expect(r.ok ? "" : r.error, name).toMatch(reason);
    }
    expect(await lib.list()).toEqual([]);
    expect((await parseAssetFile(JSON.stringify(good), fakeCodec())).ok).toBe(true);
  });
});

describe("templates", () => {
  for (const t of TEMPLATES) {
    test(`${t.label}: a valid .slc.json project of vector layers that opens, renders at its size and can be saved and read again`, () => {
      const { project, images } = buildTemplate(t.id);
      const text = serializeProject(project);
      const parsed = parseProject(text);
      expect(parsed.ok).toBe(true);
      expect(project.version).toBe(7);
      const sc = project.screens[0];
      expect([sc.width, sc.height]).toEqual([390, 844]);
      expect(sc.layers.length).toBeGreaterThan(5);
      expect(sc.layers.every((l) => l.content && !l.imageId)).toBe(true);
      const ctx = createEditorStore();
      ctx.getState().loadProject(project, images);
      expect(ctx.getState().history!.past).toHaveLength(0);
      const out = renderProjectRaw(project, images, () => null);
      expect([out.width, out.height]).toEqual([390, 844]);
    });

    test(`${t.label}: "add to the current screen" brings only the layers, as one undo step, where the template puts them`, () => {
      const ctx = page();
      const before = ctx.get().snapshotProject()!.screens[0];
      const ids = ctx.get().insertAsset(templateBundle(t.id as TemplateId), "keep")!;
      expect(ids.length).toBe(buildTemplate(t.id).project.screens[0].layers.length);
      const s = ctx.get().snapshotProject()!.screens[0];
      expect([s.width, s.height]).toEqual([before.width, before.height]); // the screen is not replaced
      expect(s.source).toEqual(before.source);
      expect(ctx.get().history!.past).toHaveLength(1);
      expect(Math.min(...s.layers.map((l) => l.transform.x))).toBeGreaterThanOrEqual(0);
      ctx.get().undo();
      expect(layersOf(ctx)).toHaveLength(0);
    });
  }
});