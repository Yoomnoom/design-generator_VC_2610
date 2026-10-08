import fs from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, test, vi } from "vitest";
import { renderProjectPng, renderProjectRaw } from "@/features/export-image/export-png";
import { loadProjectText, saveProjectText } from "@/features/project-persistence/project-io";
import { BALLOON_LINE_HEIGHT, BALLOON_MAX_WIDTH, BALLOON_PADDING, PIN_COLOR, PIN_RADIUS, compositeOver, drawMemo, layoutMemo } from "@/lib/image/memo-draw";
import { createRawImage } from "@/lib/image/raw-image";
import { estimateMeasure } from "@/lib/image/text-measure";
import { DrawCtx } from "@/lib/image/vector";
import { migrate } from "@/lib/project/migrate";
import { parseProject, serializeProject } from "@/lib/project/parse";
import { MAX_MEMOS, MAX_MEMO_LENGTH, Memo } from "@/lib/project/schema";
import { openBlobStore } from "@/lib/storage/blob-store";
import { CARD, committedId, fakeCodec, storeWith } from "./fixtures";
import { getPixel } from "./helpers";

type Ctx = ReturnType<typeof storeWith>;
const memosOf = (ctx: Ctx) => ctx.get().snapshotProject()!.screens[0].memos ?? [];
const past = (ctx: Ctx) => ctx.get().history!.past.length;
const frameOf = (ctx: Ctx) => {
  const s = ctx.get().snapshotProject()!.screens[0];
  return { width: s.width, height: s.height };
};
const measure = estimateMeasure(14);

describe("addMemo", () => {
  test("pins an empty memo at the point, selects it, as one undo step; undo takes it away again", () => {
    const ctx = storeWith();
    const before = past(ctx);
    const id = ctx.get().addMemo(12, 7)!;
    expect(memosOf(ctx)).toEqual([{ id, x: 12, y: 7, text: "" }]);
    expect(ctx.get().selectedMemoId).toBe(id);
    expect(past(ctx)).toBe(before + 1);
    expect(ctx.get().activeTool).toBe("select");
    ctx.get().undo();
    expect(memosOf(ctx)).toEqual([]);
    expect(ctx.get().selectedMemoId).toBeNull(); // the memo is gone, so is its selection
    ctx.get().redo();
    expect(memosOf(ctx)).toHaveLength(1);
  });

  test("a point outside the frame is brought to its edge; positions keep two decimals", () => {
    const ctx = storeWith();
    const { width, height } = frameOf(ctx);
    ctx.get().addMemo(-50, 9999);
    ctx.get().addMemo(1.23456, 2.98765);
    expect(memosOf(ctx).map((m) => [m.x, m.y])).toEqual([[0, height], [1.23, 2.99]]);
    ctx.get().addMemo(width + 5, 0);
    expect(memosOf(ctx)[2].x).toBe(width);
  });

  test("refused for a point that is not a number, while comparing, and past the limit; none of it leaves a step", () => {
    const ctx = storeWith();
    const before = past(ctx);
    expect(ctx.get().addMemo(Number.NaN, 1)).toBeNull();
    expect(ctx.get().addMemo(1, Infinity)).toBeNull();
    ctx.get().setCompareMode("original");
    expect(ctx.get().addMemo(1, 1)).toBeNull();
    ctx.get().setCompareMode("off");
    expect(past(ctx)).toBe(before);
    for (let i = 0; i < MAX_MEMOS; i++) ctx.get().addMemo(1, 1);
    expect(memosOf(ctx)).toHaveLength(MAX_MEMOS);
    expect(ctx.get().addMemo(1, 1)).toBeNull();
    expect(memosOf(ctx)).toHaveLength(MAX_MEMOS);
  });

  test("a memo is not a layer: layers are untouched, and locking or hiding a layer does not stop memos", () => {
    const ctx = storeWith();
    const layer = committedId(ctx.get().beginExtraction(CARD));
    ctx.get().setLayerLocked(layer, true);
    ctx.get().setLayerVisible(layer, false);
    const layers = ctx.get().snapshotProject()!.screens[0].layers;
    const id = ctx.get().addMemo(5, 5)!;
    expect(ctx.get().setMemoText(id, "still works")).toBe(true);
    expect(ctx.get().moveMemo(id, 6, 6)).toBe(true);
    expect(ctx.get().snapshotProject()!.screens[0].layers).toEqual(layers);
  });
});

describe("setMemoText", () => {
  test("one undo step; the same text is no step; over the limit is refused", () => {
    const ctx = storeWith();
    const id = ctx.get().addMemo(5, 5)!;
    const before = past(ctx);
    expect(ctx.get().setMemoText(id, "hello 한글")).toBe(true);
    expect(memosOf(ctx)[0].text).toBe("hello 한글");
    expect(past(ctx)).toBe(before + 1);
    expect(ctx.get().setMemoText(id, "hello 한글")).toBe(false);
    expect(ctx.get().setMemoText(id, "x".repeat(MAX_MEMO_LENGTH + 1))).toBe(false);
    expect(past(ctx)).toBe(before + 1);
    expect(ctx.get().setMemoText(id, "x".repeat(MAX_MEMO_LENGTH))).toBe(true);
    ctx.get().undo();
    ctx.get().undo();
    expect(memosOf(ctx)[0].text).toBe("");
  });
  test("emptying a memo is allowed (it stays as a bare pin)", () => {
    const ctx = storeWith();
    const id = ctx.get().addMemo(5, 5)!;
    ctx.get().setMemoText(id, "words");
    expect(ctx.get().setMemoText(id, "")).toBe(true);
    expect(memosOf(ctx)).toHaveLength(1);
  });
  test("refused for an unknown memo and while comparing", () => {
    const ctx = storeWith();
    const id = ctx.get().addMemo(5, 5)!;
    expect(ctx.get().setMemoText("nope", "x")).toBe(false);
    ctx.get().setCompareMode("split");
    expect(ctx.get().setMemoText(id, "x")).toBe(false);
    expect(memosOf(ctx)[0].text).toBe("");
  });
});

describe("moveMemo", () => {
  test("one undo step, kept in the frame; not moving is no step", () => {
    const ctx = storeWith();
    const { width } = frameOf(ctx);
    const id = ctx.get().addMemo(5, 5)!;
    const before = past(ctx);
    expect(ctx.get().moveMemo(id, 5, 5)).toBe(false);
    expect(ctx.get().moveMemo(id, 20.126, 9)).toBe(true);
    expect(memosOf(ctx)[0]).toMatchObject({ x: 20.13, y: 9 });
    expect(ctx.get().moveMemo(id, 1e6, 9)).toBe(true);
    expect(memosOf(ctx)[0].x).toBe(width);
    expect(past(ctx)).toBe(before + 2);
    ctx.get().undo();
    ctx.get().undo();
    expect(memosOf(ctx)[0]).toMatchObject({ x: 5, y: 5 });
  });
  test("refused for an unknown memo, a bad number, and while comparing", () => {
    const ctx = storeWith();
    const id = ctx.get().addMemo(5, 5)!;
    expect(ctx.get().moveMemo("nope", 1, 1)).toBe(false);
    expect(ctx.get().moveMemo(id, Number.NaN, 1)).toBe(false);
    ctx.get().setCompareMode("original");
    expect(ctx.get().moveMemo(id, 9, 9)).toBe(false);
    expect(memosOf(ctx)[0]).toMatchObject({ x: 5, y: 5 });
  });
});

describe("deleteMemo and selection", () => {
  test("deleting is one undo step, clears the selection, and undo brings the memo back in the same place in the order", () => {
    const ctx = storeWith();
    const a = ctx.get().addMemo(1, 1)!;
    const b = ctx.get().addMemo(2, 2)!;
    const c = ctx.get().addMemo(3, 3)!;
    ctx.get().selectMemo(b);
    const before = past(ctx);
    expect(ctx.get().deleteMemo(b)).toBe(true);
    expect(memosOf(ctx).map((m) => m.id)).toEqual([a, c]);
    expect(ctx.get().selectedMemoId).toBeNull();
    expect(past(ctx)).toBe(before + 1);
    ctx.get().undo();
    expect(memosOf(ctx).map((m) => m.id)).toEqual([a, b, c]);
    expect(ctx.get().deleteMemo("nope")).toBe(false);
  });
  test("not while comparing", () => {
    const ctx = storeWith();
    const id = ctx.get().addMemo(1, 1)!;
    ctx.get().setCompareMode("original");
    expect(ctx.get().deleteMemo(id)).toBe(false);
    expect(memosOf(ctx)).toHaveLength(1);
  });
  test("selecting a memo clears the layer selection and the other way round; an unknown id selects nothing", () => {
    const ctx = storeWith();
    const layer = committedId(ctx.get().beginExtraction(CARD));
    const id = ctx.get().addMemo(1, 1)!;
    expect(ctx.get().selectedLayerIds).toEqual([]); // adding the memo took the selection
    ctx.get().selectLayer(layer);
    expect(ctx.get().selectedMemoId).toBeNull();
    ctx.get().selectMemo(id);
    expect(ctx.get().selectedLayerIds).toEqual([]);
    expect(ctx.get().selectedMemoId).toBe(id);
    ctx.get().selectMemo("nope");
    expect(ctx.get().selectedMemoId).toBeNull();
  });
  test("opening another project forgets the selection", () => {
    const ctx = storeWith();
    ctx.get().addMemo(1, 1);
    const project = ctx.get().snapshotProject()!;
    ctx.get().loadProject(project, ctx.get().images);
    expect(ctx.get().selectedMemoId).toBeNull();
  });
});

describe("the file format: memos (version 6)", () => {
  const withMemos = () => {
    const ctx = storeWith();
    const a = ctx.get().addMemo(5, 6)!;
    ctx.get().setMemoText(a, "첫 번째 메모\nsecond line");
    ctx.get().addMemo(10, 12);
    return ctx;
  };
  const docOf = (ctx: Ctx) => JSON.parse(serializeProject(ctx.get().snapshotProject()!));

  test("a project with memos is valid; one without the field is valid too", () => {
    const ctx = withMemos();
    expect(parseProject(JSON.stringify(docOf(ctx))).ok).toBe(true);
    const bare = docOf(storeWith());
    expect(bare.screens[0].memos).toBeUndefined();
    expect(parseProject(JSON.stringify(bare)).ok).toBe(true);
  });

  test.each([
    ["memos that is not a list", (m: unknown[]) => ({ ...{ memos: m }, memos: "x" })],
    ["a memo that is not an object", () => ({ memos: [5] })],
    ["a memo without an id", () => ({ memos: [{ x: 1, y: 1, text: "" }] })],
    ["a repeated id", () => ({ memos: [{ id: "a", x: 1, y: 1, text: "" }, { id: "a", x: 2, y: 2, text: "" }] })],
    ["text that is not a string", () => ({ memos: [{ id: "a", x: 1, y: 1, text: 5 }] })],
    ["text over the limit", () => ({ memos: [{ id: "a", x: 1, y: 1, text: "x".repeat(MAX_MEMO_LENGTH + 1) }] })],
    ["a position that is not a number", () => ({ memos: [{ id: "a", x: "1", y: 1, text: "" }] })],
    ["a negative position", () => ({ memos: [{ id: "a", x: -1, y: 1, text: "" }] })],
    ["a position beyond the frame", () => ({ memos: [{ id: "a", x: 1, y: 9999, text: "" }] })],
    ["more than the limit", () => ({ memos: Array.from({ length: MAX_MEMOS + 1 }, (_, i) => ({ id: `m${i}`, x: 1, y: 1, text: "" })) })],
  ])("%s is refused", (_name, make) => {
    const doc = docOf(storeWith());
    Object.assign(doc.screens[0], make([]));
    expect(parseProject(JSON.stringify(doc)).ok).toBe(false);
  });

  test("a project with memos saves and opens again exactly (no image data in them)", async () => {
    const ctx = withMemos();
    const project = ctx.get().snapshotProject()!;
    const codec = fakeCodec();
    const text = await saveProjectText(project, ctx.get().images, { blobs: await openBlobStore("a", new IDBFactory()), codec });
    const opened = await loadProjectText(text, { blobs: await openBlobStore("b", new IDBFactory()), codec });
    if (!opened.ok) throw new Error(opened.error);
    expect(opened.project.screens[0].memos).toEqual(project.screens[0].memos);
    expect(JSON.parse(text).project.version).toBe(6);
    expect(JSON.stringify(project.screens[0].memos)).not.toMatch(/blob:|data:/);
  });

  const v5 = fs.readFileSync("tests/fixtures/project-v5.slc.json", "utf8");
  const pngCodec = () => ({ encode: async () => new Blob(), decode: async (blob: Blob) => (await import("./png")).decodePng(Buffer.from(await blob.arrayBuffer())) });

  test("the file the previous build saved is version 5: bitmap, rectangle, brush and text layers, no memos", () => {
    const project = JSON.parse(v5).project;
    expect(project.version).toBe(5);
    const kinds = project.screens[0].layers.map((l: { content?: { kind: string }; drawn?: boolean }) => l.content?.kind ?? (l.drawn ? "drawn" : "bitmap"));
    expect(kinds).toEqual(["bitmap", "rect", "drawn", "text"]);
    expect(project.screens[0].memos).toBeUndefined();
  });

  test("it opens as it was, as version 6, with no memos and every layer untouched", async () => {
    const before = JSON.parse(v5).project;
    const r = await loadProjectText(v5, { blobs: await openBlobStore("v5", new IDBFactory()), codec: pngCodec() });
    if (!r.ok) throw new Error(r.error);
    expect(r.project.version).toBe(6);
    expect(r.project.screens[0].layers).toEqual(before.screens[0].layers);
    expect(r.project.screens[0].backgroundPatches).toEqual(before.screens[0].backgroundPatches);
    expect(r.project.screens[0].memos).toBeUndefined();
  });

  test("migrate takes version 5 to the current version without touching the screens", () => {
    const doc = JSON.parse(v5).project;
    const r = migrate(doc);
    expect(r.ok && r.doc.version).toBe(6);
    expect(r.ok && (r.doc.screens as unknown[])).toEqual(doc.screens);
  });
});

describe("exporting with or without memos", () => {
  const codec = fakeCodec();
  const setup = () => {
    const ctx = storeWith();
    ctx.get().addMemo(20, 15);
    ctx.get().setMemoText(ctx.get().selectedMemoId!, "note");
    return ctx;
  };

  test("by default the memos are not drawn: the overlay is never asked, and the picture is exactly the same as with no memos", async () => {
    const ctx = setup();
    const overlay = vi.fn((image) => image);
    const project = ctx.get().snapshotProject()!;
    await renderProjectPng(project, ctx.get().images, codec, undefined, { overlayMemos: overlay });
    expect(overlay).not.toHaveBeenCalled();
    const bare = storeWith();
    expect(Buffer.from(renderProjectRaw(project, ctx.get().images).data).equals(Buffer.from(renderProjectRaw(bare.get().snapshotProject()!, bare.get().images).data))).toBe(true);
  });

  test("with memos on, the overlay gets the picture and the memos in order; the size does not change", async () => {
    const ctx = setup();
    ctx.get().addMemo(3, 3);
    const seen: { size: number[]; memos: Memo[] }[] = [];
    const overlay = (image: ReturnType<typeof createRawImage>, memos: readonly Memo[]) => {
      seen.push({ size: [image.width, image.height], memos: [...memos] });
      return image;
    };
    const project = ctx.get().snapshotProject()!;
    const out = await renderProjectPng(project, ctx.get().images, codec, undefined, { memos: true, overlayMemos: overlay });
    expect(seen).toHaveLength(1);
    expect(seen[0].memos.map((m) => m.text)).toEqual(["note", ""]);
    expect([out.width, out.height]).toEqual([project.screens[0].width, project.screens[0].height]);
    expect(seen[0].size).toEqual([out.width, out.height]);
  });

  test("memos on but no memos: nothing to draw, the overlay is not asked", async () => {
    const ctx = storeWith();
    const overlay = vi.fn((image) => image);
    await renderProjectPng(ctx.get().snapshotProject()!, ctx.get().images, codec, undefined, { memos: true, overlayMemos: overlay });
    expect(overlay).not.toHaveBeenCalled();
  });
});

describe("layoutMemo", () => {
  const frame = { width: 400, height: 300 };
  const memo = (over: Partial<Memo> = {}): Memo => ({ id: "m", x: 100, y: 100, text: "", ...over });
  const inside = (r: { x: number; y: number; width: number; height: number }) => r.x >= 0 && r.y >= 0 && r.x + r.width <= frame.width && r.y + r.height <= frame.height;

  test("a memo without words is just the pin; the bounds hold the pin and stay in the frame", () => {
    const l = layoutMemo(memo(), frame, measure);
    expect(l.balloon).toBeNull();
    expect(l.bounds.x).toBeLessThanOrEqual(100 - PIN_RADIUS);
    expect(l.bounds.x + l.bounds.width).toBeGreaterThanOrEqual(100 + PIN_RADIUS);
    expect(inside(l.bounds)).toBe(true);
  });
  test("a blank text counts as no words", () => {
    expect(layoutMemo(memo({ text: "  \n " }), frame, measure).balloon).toBeNull();
  });
  test("words make a balloon to the right of the pin, wide enough for the longest line, tall enough for every line", () => {
    const l = layoutMemo(memo({ text: "hello\nworld again" }), frame, measure);
    const b = l.balloon!;
    expect(b.lines).toEqual(["hello", "world again"]);
    expect(b.x).toBeGreaterThan(100 + PIN_RADIUS);
    expect(b.height).toBe(2 * BALLOON_LINE_HEIGHT + 2 * BALLOON_PADDING);
    expect(b.width).toBe(Math.ceil(measure("world again")) + 2 * BALLOON_PADDING);
    expect(inside(l.bounds)).toBe(true);
  });
  test("long words wrap at the balloon width", () => {
    const b = layoutMemo(memo({ text: "word ".repeat(30).trim() }), frame, measure).balloon!;
    expect(b.width).toBeLessThanOrEqual(BALLOON_MAX_WIDTH);
    expect(b.lines.length).toBeGreaterThan(3);
    for (const line of b.lines) expect(measure(line)).toBeLessThanOrEqual(BALLOON_MAX_WIDTH - 2 * BALLOON_PADDING);
  });
  test("near the right and bottom edges the balloon is pushed back inside the frame, and the pin keeps its point", () => {
    const l = layoutMemo(memo({ x: 395, y: 295, text: "pushed back into the picture" }), frame, measure);
    expect(inside(l.balloon!)).toBe(true);
    expect(inside(l.bounds)).toBe(true);
  });
  test("a pin at the very corner has bounds clipped to the frame", () => {
    const l = layoutMemo(memo({ x: 0, y: 0 }), frame, measure);
    expect(l.bounds.x).toBe(0);
    expect(l.bounds.y).toBe(0);
    expect(inside(l.bounds)).toBe(true);
  });
  test("a frame smaller than a balloon still gives an in-frame balloon", () => {
    const tiny = { width: 60, height: 40 };
    const l = layoutMemo(memo({ x: 30, y: 20, text: "a long note that does not fit" }), tiny, measure);
    expect(l.balloon!.x).toBeGreaterThanOrEqual(0);
    expect(l.balloon!.y).toBeGreaterThanOrEqual(0);
  });
});

describe("drawMemo", () => {
  type Rec = { fills: unknown[]; texts: { text: string; x: number; y: number; align: string }[]; ellipses: number[][]; rects: number[][] };
  const recorder = () => {
    const rec: Rec = { fills: [], texts: [], ellipses: [], rects: [] };
    const ctx = {
      font: "",
      textAlign: "start",
      textBaseline: "alphabetic",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      beginPath() {},
      rect: (...a: number[]) => rec.rects.push(a),
      ellipse: (...a: number[]) => rec.ellipses.push(a),
      fill() {
        rec.fills.push(ctx.fillStyle);
      },
      stroke() {},
      fillText(text: string, x: number, y: number) {
        rec.texts.push({ text, x, y, align: ctx.textAlign });
      },
    };
    return { ctx: ctx as unknown as DrawCtx, rec };
  };
  const memo: Memo = { id: "m", x: 100, y: 80, text: "hi\nthere" };
  const layout = layoutMemo(memo, { width: 400, height: 300 }, measure);

  test("the pin is a red circle on the memo's point with its number (1-based) in the middle", () => {
    const { ctx, rec } = recorder();
    drawMemo(ctx, memo, 2, layout, 0, 0);
    expect(rec.ellipses).toEqual([[100, 80, PIN_RADIUS, PIN_RADIUS, 0, 0, Math.PI * 2]]);
    expect(rec.fills).toContain(PIN_COLOR);
    const number = rec.texts.find((t) => t.text === "3")!;
    expect(number).toMatchObject({ x: 100, align: "center" });
  });
  test("the balloon text is drawn line by line inside its box", () => {
    const { ctx, rec } = recorder();
    drawMemo(ctx, memo, 0, layout, 0, 0);
    const b = layout.balloon!;
    expect(rec.rects).toEqual([[b.x, b.y, b.width, b.height]]);
    const lines = rec.texts.filter((t) => t.text !== "1");
    expect(lines.map((t) => t.text)).toEqual(["hi", "there"]);
    expect(lines[0].x).toBe(b.x + BALLOON_PADDING);
    expect(lines[1].y - lines[0].y).toBe(BALLOON_LINE_HEIGHT);
  });
  test("a memo without words draws no balloon", () => {
    const { ctx, rec } = recorder();
    const bare = { ...memo, text: "" };
    drawMemo(ctx, bare, 0, layoutMemo(bare, { width: 400, height: 300 }, measure), 0, 0);
    expect(rec.rects).toEqual([]);
    expect(rec.texts.map((t) => t.text)).toEqual(["1"]);
  });
  test("everything is shifted by the origin of the small bitmap it is drawn on", () => {
    const a = recorder();
    const b = recorder();
    drawMemo(a.ctx, memo, 0, layout, 0, 0);
    drawMemo(b.ctx, memo, 0, layout, 30, 40);
    expect(b.rec.ellipses[0].slice(0, 2)).toEqual([a.rec.ellipses[0][0] - 30, a.rec.ellipses[0][1] - 40]);
    expect(b.rec.rects[0].slice(0, 2)).toEqual([a.rec.rects[0][0] - 30, a.rec.rects[0][1] - 40]);
  });
});

describe("compositeOver", () => {
  const px = (r: number, g: number, b: number, a: number) => {
    const img = createRawImage(1, 1);
    img.data.set([r, g, b, a]);
    return img;
  };
  const at = (img: ReturnType<typeof createRawImage>, x = 0, y = 0) => getPixel(img, x, y);

  test("an opaque source replaces what is under it; a transparent one changes nothing", () => {
    const dst = px(10, 20, 30, 255);
    compositeOver(dst, px(200, 100, 50, 255), 0, 0);
    expect(at(dst)).toEqual([200, 100, 50, 255]);
    compositeOver(dst, px(1, 2, 3, 0), 0, 0);
    expect(at(dst)).toEqual([200, 100, 50, 255]);
  });
  test("half transparent over opaque blends; the result stays opaque", () => {
    const dst = px(0, 0, 0, 255);
    compositeOver(dst, px(255, 255, 255, 128), 0, 0);
    const [r, , , a] = at(dst);
    expect(a).toBe(255);
    expect(r).toBeGreaterThanOrEqual(127);
    expect(r).toBeLessThanOrEqual(129);
  });
  test("over a transparent pixel the source's colour is kept with its own alpha (the PNG keeps its transparency)", () => {
    const dst = px(0, 0, 0, 0);
    compositeOver(dst, px(200, 100, 50, 128), 0, 0);
    expect(at(dst)).toEqual([200, 100, 50, 128]);
  });
  test("a source partly outside is clipped without error, and lands at its offset", () => {
    const dst = createRawImage(4, 4, [0, 0, 0, 255]);
    const src = createRawImage(3, 3, [255, 0, 0, 255]);
    compositeOver(dst, src, 2, 2);
    expect(at(dst, 3, 3)).toEqual([255, 0, 0, 255]);
    expect(at(dst, 1, 1)).toEqual([0, 0, 0, 255]);
    compositeOver(dst, src, -2, -2);
    expect(at(dst, 0, 0)).toEqual([255, 0, 0, 255]);
    compositeOver(dst, src, 100, 100);
  });
});
