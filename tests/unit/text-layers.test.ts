import fs from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, test } from "vitest";
import { loadProjectText, saveProjectText } from "@/features/project-persistence/project-io";
import { MAX_FONT_SIZE, MAX_TEXT_LENGTH, MIN_FONT_SIZE, MIN_TEXT_WIDTH, fontOf, lineHeightOf } from "@/lib/image/text-layout";
import { estimateMeasure, fitHeight } from "@/lib/image/text-measure";
import { DrawCtx, drawContent, drawText } from "@/lib/image/vector";
import { migrate } from "@/lib/project/migrate";
import { contentError, parseProject, serializeProject } from "@/lib/project/parse";
import { LayerContent, TextContent } from "@/lib/project/schema";
import { openBlobStore } from "@/lib/storage/blob-store";
import { CARD, committedId, fakeCodec, storeWith } from "./fixtures";

const TEXT: TextContent = { kind: "text", width: 200, height: 26, text: "hello", fontSize: 20, color: "#112233", align: "left", stroke: null, strokeWidth: 0 };
const layersOf = (ctx: ReturnType<typeof storeWith>) => ctx.get().snapshotProject()!.screens[0].layers;
const textOf = (ctx: ReturnType<typeof storeWith>, id: string) => layersOf(ctx).find((l) => l.id === id)!.content as TextContent;
const past = (ctx: ReturnType<typeof storeWith>) => ctx.get().history!.past.length;
const withText = (text = "hello world", width = 100) => {
  const ctx = storeWith();
  ctx.get().setTextStyle({ fontSize: 20 });
  const id = ctx.get().addTextLayer(text, 30, 40, width)!;
  return { ...ctx, id };
};

describe("addTextLayer", () => {
  test("makes one text layer at the point, selected, in the current style, as one undo step", () => {
    const ctx = storeWith();
    ctx.get().setTextStyle({ fontSize: 24, color: "#aa0000", align: "center" });
    const before = past(ctx);
    const id = ctx.get().addTextLayer("안녕하세요", 30, 40)!;
    const layer = layersOf(ctx).find((l) => l.id === id)!;
    expect(layer.name).toBe("텍스트 1");
    expect(layer.imageId).toBeUndefined();
    expect(layer.transform).toEqual({ x: 30, y: 40, scaleX: 1, scaleY: 1, rotation: 0 });
    expect(layer.content).toMatchObject({ kind: "text", text: "안녕하세요", fontSize: 24, color: "#aa0000", align: "center", width: 240, stroke: null, strokeWidth: 0 });
    expect(ctx.get().selectedLayerIds).toEqual([id]);
    expect(past(ctx)).toBe(before + 1);
    ctx.get().undo();
    expect(layersOf(ctx)).toHaveLength(0);
  });

  test("the box is as tall as the wrapped lines need", () => {
    const { id, ...ctx } = withText("hello world", 100); // 11 chars × 11 px > 100: two lines of 26
    expect(textOf(ctx as never, id).height).toBe(52);
    expect(textOf(ctx as never, id).height).toBe(fitHeight(textOf(ctx as never, id), estimateMeasure));
  });

  test("names count up, and empty or blank text makes nothing", () => {
    const ctx = storeWith();
    const before = past(ctx);
    expect(ctx.get().addTextLayer("", 1, 1)).toBeNull();
    expect(ctx.get().addTextLayer("  \n ", 1, 1)).toBeNull();
    expect(past(ctx)).toBe(before);
    ctx.get().addTextLayer("a", 1, 1);
    ctx.get().addTextLayer("b", 2, 2);
    expect(layersOf(ctx).map((l) => l.name)).toEqual(["텍스트 1", "텍스트 2"]);
  });

  test("a width below the minimum is raised to it", () => {
    const ctx = storeWith();
    const id = ctx.get().addTextLayer("a", 0, 0, 1)!;
    expect(textOf(ctx, id).width).toBe(MIN_TEXT_WIDTH);
  });

  test("not while comparing with the original", () => {
    const ctx = storeWith();
    ctx.get().setCompareMode("original");
    expect(ctx.get().addTextLayer("a", 1, 1)).toBeNull();
  });
});

describe("setTextContent", () => {
  test("new words re-fit the height; one undo step; undo brings back words and height together", () => {
    const ctx = withText("hello", 100);
    const before = past(ctx);
    expect(textOf(ctx, ctx.id).height).toBe(26);
    expect(ctx.get().setTextContent(ctx.id, { text: "hello world again and again" })).toBe(true);
    expect(textOf(ctx, ctx.id).height).toBeGreaterThan(26);
    expect(past(ctx)).toBe(before + 1);
    ctx.get().undo();
    expect(textOf(ctx, ctx.id)).toMatchObject({ text: "hello", height: 26 });
    ctx.get().redo();
    expect(textOf(ctx, ctx.id).text).toBe("hello world again and again");
  });

  test("a bigger font makes a taller box; colour and alignment change only themselves", () => {
    const ctx = withText("hello", 100);
    ctx.get().setTextContent(ctx.id, { fontSize: 40 });
    expect(textOf(ctx, ctx.id)).toMatchObject({ fontSize: 40, height: lineHeightOf(40) * 2 }); // 5 × 22 = 110 > 100: wraps to two lines
    const h = textOf(ctx, ctx.id).height;
    ctx.get().setTextContent(ctx.id, { color: "#00ff00", align: "right" });
    expect(textOf(ctx, ctx.id)).toMatchObject({ color: "#00ff00", align: "right", height: h, text: "hello" });
  });

  test("the font size is kept between the minimum and the maximum, to two decimals", () => {
    const ctx = withText();
    ctx.get().setTextContent(ctx.id, { fontSize: 1 });
    expect(textOf(ctx, ctx.id).fontSize).toBe(MIN_FONT_SIZE);
    ctx.get().setTextContent(ctx.id, { fontSize: 9999 });
    expect(textOf(ctx, ctx.id).fontSize).toBe(MAX_FONT_SIZE);
    ctx.get().setTextContent(ctx.id, { fontSize: 12.3456 });
    expect(textOf(ctx, ctx.id).fontSize).toBe(12.35);
  });

  test("nothing changes (and no step) when nothing differs; empty words, a bad colour and a too-long text are refused", () => {
    const ctx = withText("hello", 100);
    const before = past(ctx);
    expect(ctx.get().setTextContent(ctx.id, { text: "hello" })).toBe(false);
    expect(ctx.get().setTextContent(ctx.id, { text: "   " })).toBe(false);
    expect(ctx.get().setTextContent(ctx.id, { color: "red" })).toBe(false);
    expect(ctx.get().setTextContent(ctx.id, { text: "x".repeat(MAX_TEXT_LENGTH + 1) })).toBe(false);
    expect(past(ctx)).toBe(before);
    expect(textOf(ctx, ctx.id)).toMatchObject({ text: "hello", color: "#222222" });
  });

  test("refused for a locked layer, while comparing, for a layer that is not text, and for an unknown layer", () => {
    const ctx = withText();
    const bitmap = committedId(ctx.get().beginExtraction(CARD));
    expect(ctx.get().setTextContent(bitmap, { text: "x" })).toBe(false);
    expect(ctx.get().setTextContent("nope", { text: "x" })).toBe(false);
    ctx.get().setLayerLocked(ctx.id, true);
    expect(ctx.get().setTextContent(ctx.id, { text: "x" })).toBe(false);
    ctx.get().setLayerLocked(ctx.id, false);
    ctx.get().setCompareMode("split");
    expect(ctx.get().setTextContent(ctx.id, { text: "x" })).toBe(false);
  });
});

describe("resizing a text box", () => {
  const place = (ctx: ReturnType<typeof withText>, scaleX: number, scaleY: number) => {
    const t = layersOf(ctx).find((l) => l.id === ctx.id)!.transform;
    return ctx.get().transformLayer(ctx.id, { x: t.x, y: t.y, rotation: t.rotation, scaleX, scaleY });
  };

  test("stretching it sideways changes its width and re-fits its height; the letters and the scale stay as they were", () => {
    const ctx = withText("hello world", 100);
    expect(textOf(ctx, ctx.id).height).toBe(52);
    expect(place(ctx, 2, 1)).toBe(true);
    expect(textOf(ctx, ctx.id)).toMatchObject({ width: 200, height: 26, fontSize: 20 });
    expect(layersOf(ctx)[0].transform).toMatchObject({ scaleX: 1, scaleY: 1 });
    ctx.get().undo();
    expect(textOf(ctx, ctx.id)).toMatchObject({ width: 100, height: 52 });
  });

  test("stretching it only up or down changes nothing about the text (the height follows the lines)", () => {
    const ctx = withText("hello world", 100);
    place(ctx, 1, 3);
    expect(textOf(ctx, ctx.id)).toMatchObject({ width: 100, height: 52, fontSize: 20 });
  });

  test("it cannot be made narrower than the minimum", () => {
    const ctx = withText("hello", 100);
    place(ctx, 0.001, 1);
    expect(textOf(ctx, ctx.id).width).toBe(MIN_TEXT_WIDTH);
  });

  test("turning it keeps its words and size", () => {
    const ctx = withText("hello", 100);
    const t = layersOf(ctx)[0].transform;
    ctx.get().transformLayer(ctx.id, { x: t.x, y: t.y, scaleX: 1, scaleY: 1, rotation: 30 });
    expect(layersOf(ctx)[0].transform.rotation).toBe(30);
    expect(textOf(ctx, ctx.id)).toMatchObject({ text: "hello", fontSize: 20, width: 100 });
  });
});

describe("typing into a text box (beginTextEdit / commitTextEdit / cancelTextEdit)", () => {
  test("a new box exists only once words are committed, at the clicked point, as one step", () => {
    const ctx = storeWith();
    const before = past(ctx);
    expect(ctx.get().beginTextEdit({ x: 55, y: 66 })).toBe(true);
    expect(ctx.get().textEditing).toEqual({ layerId: null, x: 55, y: 66 });
    expect(layersOf(ctx)).toHaveLength(0); // nothing yet
    expect(past(ctx)).toBe(before);
    expect(ctx.get().commitTextEdit("hi there")).toBe(true);
    expect(ctx.get().textEditing).toBeNull();
    expect(layersOf(ctx)).toHaveLength(1);
    expect(layersOf(ctx)[0].transform).toMatchObject({ x: 55, y: 66 });
    expect(past(ctx)).toBe(before + 1);
  });

  test("an empty new box is dropped without a trace; Escape too", () => {
    const ctx = storeWith();
    const before = past(ctx);
    ctx.get().beginTextEdit({ x: 5, y: 5 });
    expect(ctx.get().commitTextEdit("  ")).toBe(false);
    expect(ctx.get().textEditing).toBeNull();
    ctx.get().beginTextEdit({ x: 5, y: 5 });
    ctx.get().cancelTextEdit();
    expect(ctx.get().textEditing).toBeNull();
    expect(layersOf(ctx)).toHaveLength(0);
    expect(past(ctx)).toBe(before);
  });

  test("editing an existing box: selects it, commits the new words as one step; emptied words keep the old ones", () => {
    const ctx = withText("old words", 300);
    ctx.get().selectLayer(null);
    const before = past(ctx);
    expect(ctx.get().beginTextEdit({ layerId: ctx.id })).toBe(true);
    expect(ctx.get().selectedLayerIds).toEqual([ctx.id]);
    expect(ctx.get().textEditing).toMatchObject({ layerId: ctx.id, x: 30, y: 40 });
    expect(ctx.get().commitTextEdit("new words")).toBe(true);
    expect(textOf(ctx, ctx.id).text).toBe("new words");
    expect(past(ctx)).toBe(before + 1);

    ctx.get().beginTextEdit({ layerId: ctx.id });
    expect(ctx.get().commitTextEdit("")).toBe(false);
    expect(textOf(ctx, ctx.id).text).toBe("new words");
    expect(ctx.get().textEditing).toBeNull();
    expect(past(ctx)).toBe(before + 1);
  });

  test("not for a locked box, a box that is not text, an unknown box, or while comparing", () => {
    const ctx = withText();
    const bitmap = committedId(ctx.get().beginExtraction(CARD));
    expect(ctx.get().beginTextEdit({ layerId: bitmap })).toBe(false);
    expect(ctx.get().beginTextEdit({ layerId: "nope" })).toBe(false);
    ctx.get().setLayerLocked(ctx.id, true);
    expect(ctx.get().beginTextEdit({ layerId: ctx.id })).toBe(false);
    ctx.get().setLayerLocked(ctx.id, false);
    ctx.get().setCompareMode("original");
    expect(ctx.get().beginTextEdit({ layerId: ctx.id })).toBe(false);
    expect(ctx.get().beginTextEdit({ x: 1, y: 1 })).toBe(false);
    expect(ctx.get().textEditing).toBeNull();
  });

  test("committing with nothing open does nothing", () => {
    const ctx = storeWith();
    const before = past(ctx);
    expect(ctx.get().commitTextEdit("x")).toBe(false);
    expect(past(ctx)).toBe(before);
  });
});

describe("the new-box style", () => {
  test("size is kept in range; an unusable size is ignored", () => {
    const ctx = storeWith();
    ctx.get().setTextStyle({ fontSize: 1 });
    expect(ctx.get().textStyle.fontSize).toBe(MIN_FONT_SIZE);
    ctx.get().setTextStyle({ fontSize: 1e6 });
    expect(ctx.get().textStyle.fontSize).toBe(MAX_FONT_SIZE);
    ctx.get().setTextStyle({ fontSize: Number.NaN });
    expect(ctx.get().textStyle.fontSize).toBe(MAX_FONT_SIZE);
  });
  test("changing it does not touch boxes that already exist", () => {
    const ctx = withText();
    ctx.get().setTextStyle({ fontSize: 60, color: "#ff0000" });
    expect(textOf(ctx, ctx.id)).toMatchObject({ fontSize: 20, color: "#222222" });
  });
});

describe("drawText (what both the canvas and the PNG run)", () => {
  type Call = { text: string; x: number; y: number; font: string; fill: unknown; baseline: string; align: string };
  const recorder = (fontSize: number) => {
    const calls: Call[] = [];
    const ctx = {
      font: "",
      textAlign: "start",
      textBaseline: "alphabetic",
      fillStyle: "",
      measureText: (t: string) => ({ width: estimateMeasure(fontSize)(t) }),
      fillText(text: string, x: number, y: number) {
        calls.push({ text, x, y, font: this.font, fill: this.fillStyle, baseline: this.textBaseline, align: this.textAlign });
      },
    };
    return { ctx: ctx as unknown as DrawCtx, calls };
  };

  test("each line is drawn with the layer's font, colour and a top baseline, one line height apart", () => {
    const { ctx, calls } = recorder(20);
    drawText(ctx, { ...TEXT, text: "ab\ncd\nef", width: 200 });
    expect(calls.map((c) => c.text)).toEqual(["ab", "cd", "ef"]);
    expect(calls.map((c) => c.y)).toEqual([3, 29, 55]); // line y + (26 - 20) / 2
    expect(new Set(calls.map((c) => c.font))).toEqual(new Set([fontOf(20)]));
    expect(new Set(calls.map((c) => c.fill))).toEqual(new Set(["#112233"]));
    expect(new Set(calls.map((c) => c.baseline))).toEqual(new Set(["top"]));
    expect(new Set(calls.map((c) => c.align))).toEqual(new Set(["left"]));
  });

  test("alignment puts each line at its own x inside the box", () => {
    for (const [align, x] of [["left", 0], ["center", 72.5], ["right", 145]] as const) {
      const { ctx, calls } = recorder(20);
      drawText(ctx, { ...TEXT, text: "ab cd", width: 200, align }); // "ab cd" is 55 wide
      expect(calls[0].x, align).toBe(x);
    }
  });

  test("empty lines draw nothing but still take their height", () => {
    const { ctx, calls } = recorder(20);
    drawText(ctx, { ...TEXT, text: "a\n\nb", width: 200 });
    expect(calls.map((c) => [c.text, c.y])).toEqual([["a", 3], ["b", 55]]);
  });

  test("drawContent hands a text layer to drawText and draws no shape", () => {
    const { ctx, calls } = recorder(20);
    let shapes = 0;
    Object.assign(ctx, { beginPath: () => shapes++, stroke: () => shapes++, fill: () => shapes++ });
    drawContent(ctx, TEXT);
    expect(calls).toHaveLength(1);
    expect(shapes).toBe(0);
  });

  test("a different measure (a different font engine) moves the line breaks: the layout is the measure's, not a constant", () => {
    const narrow = recorder(20);
    drawText(narrow.ctx, { ...TEXT, text: "hello world", width: 100 });
    expect(narrow.calls.map((c) => c.text)).toEqual(["hello", "world"]);
    const wide = recorder(20);
    drawText(wide.ctx, { ...TEXT, text: "hello world", width: 400 });
    expect(wide.calls.map((c) => c.text)).toEqual(["hello world"]);
  });
});

describe("the file format: text layers (version 5)", () => {
  test.each([
    ["a good text box", {}, null],
    ["Korean, with newlines", { text: "가나다\n라마바" }, null],
    ["empty words", { text: "" }, "text"],
    ["blank words", { text: "  \n " }, "text"],
    ["text that is not a string", { text: 5 }, "text"],
    ["too long", { text: "x".repeat(MAX_TEXT_LENGTH + 1) }, "text"],
    ["a font size under the minimum", { fontSize: MIN_FONT_SIZE - 1 }, "fontSize"],
    ["a font size over the maximum", { fontSize: MAX_FONT_SIZE + 1 }, "fontSize"],
    ["a font size that is not a number", { fontSize: "20" }, "fontSize"],
    ["a colour that is not #rrggbb", { color: "red" }, "color"],
    ["no colour", { color: null }, "color"],
    ["an alignment that does not exist", { align: "justify" }, "align"],
    ["an outline (text has none)", { stroke: "#000000", strokeWidth: 2 }, "테두리"],
    ["a width under the minimum", { width: MIN_TEXT_WIDTH - 1 }, "width"],
    ["no height", { height: 0 }, "width/height"],
  ])("%s", (_name, change, problem) => {
    const error = contentError({ ...TEXT, ...change });
    if (problem === null) expect(error).toBeNull();
    else expect(error).toContain(problem);
  });

  const v4 = fs.readFileSync("tests/fixtures/project-v4.slc.json", "utf8");
  const codec = () => ({ encode: async () => new Blob(), decode: async (blob: Blob) => (await import("./png")).decodePng(Buffer.from(await blob.arrayBuffer())) });

  test("the file the previous build saved is version 4: a bitmap layer, a rectangle and a brush layer, no text", () => {
    const project = JSON.parse(v4).project;
    expect(project.version).toBe(4);
    const layers = project.screens[0].layers as { content?: { kind: string }; drawn?: boolean; imageId?: string }[];
    expect(layers).toHaveLength(3);
    expect(layers.some((l) => l.content?.kind === "rect")).toBe(true);
    expect(layers.some((l) => l.drawn === true)).toBe(true);
    expect(layers.some((l) => l.content?.kind === "text")).toBe(false);
  });

  test("it opens as it was, as version 5, every layer and patch untouched", async () => {
    const before = JSON.parse(v4).project;
    const r = await loadProjectText(v4, { blobs: await openBlobStore("v4", new IDBFactory()), codec: codec() });
    if (!r.ok) throw new Error(r.error);
    expect(r.project.version).toBe(5);
    expect(r.project.screens[0].layers).toEqual(before.screens[0].layers);
    expect(r.project.screens[0].backgroundPatches).toEqual(before.screens[0].backgroundPatches);
  });

  test("migrate takes version 4 to the current version without touching the screens", () => {
    const doc = JSON.parse(v4).project;
    const r = migrate(doc);
    expect(r.ok && r.doc.version).toBe(5);
    expect(r.ok && (r.doc.screens as unknown[])).toEqual(doc.screens);
  });

  test("a project that holds a text layer passes the validator", () => {
    const ctx = withText("hello");
    const doc = JSON.parse(serializeProject(ctx.get().snapshotProject()!));
    expect(parseProject(JSON.stringify(doc)).ok).toBe(true);
  });

  test("a text layer may not carry an imageId or the brush flag", () => {
    const ctx = withText("hello");
    const doc = JSON.parse(serializeProject(ctx.get().snapshotProject()!));
    doc.screens[0].layers[0].imageId = "x";
    expect(parseProject(JSON.stringify(doc)).ok).toBe(false);
    delete doc.screens[0].layers[0].imageId;
    doc.screens[0].layers[0].drawn = true;
    expect(parseProject(JSON.stringify(doc)).ok).toBe(false);
  });

  test("a project with text layers saves and opens again exactly, and the text needs no image in the blob store", async () => {
    const ctx = withText("한글 and English\nsecond line", 180);
    ctx.get().setTextContent(ctx.id, { color: "#cc3300", align: "center", fontSize: 26.5 });
    ctx.get().transformLayer(ctx.id, { x: 31.25, y: 40.5, scaleX: 1, scaleY: 1, rotation: 12.5 });
    const project = ctx.get().snapshotProject()!;
    const c = fakeCodec();
    const text = await saveProjectText(project, ctx.get().images, { blobs: await openBlobStore("a", new IDBFactory()), codec: c });
    const opened = await loadProjectText(text, { blobs: await openBlobStore("b", new IDBFactory()), codec: c });
    if (!opened.ok) throw new Error(opened.error);
    expect(opened.project.screens[0].layers).toEqual(project.screens[0].layers);
    const layer = opened.project.screens[0].layers[0];
    expect(layer.content).toMatchObject({ kind: "text", text: "한글 and English\nsecond line", color: "#cc3300", align: "center", fontSize: 26.5 });
    expect(layer.transform.rotation).toBe(12.5);
  });

  test("the layer's content is plain data: nothing in it can be a Blob URL or an image reference", () => {
    const ctx = withText("hello");
    const json = serializeProject(ctx.get().snapshotProject()!);
    expect(json).not.toMatch(/blob:|data:image/);
  });
});

describe("types", () => {
  test("LayerContent includes text", () => {
    const c: LayerContent = TEXT;
    expect(c.kind).toBe("text");
  });
});
