import { describe, expect, test } from "vitest";
import { renderProjectPng, readPngSize } from "@/features/export-image/export-png";
import { MAX_SIDE, checkImageFile, checkImageSize, importImage } from "@/features/import-image/import-image";
import { ImageCodec } from "@/lib/image/codec";
import { CARD, committedId, fakeCodec, pageWithCard, solidPage, storeWith } from "./fixtures";
import { getPixel } from "./helpers";

describe("checkImageFile", () => {
  test.each([
    [{ name: "a.png", type: "image/png" }, null],
    [{ name: "a.jpg", type: "image/jpeg" }, null],
    [{ name: "SHOT.JPEG", type: "" }, null], // some systems report no type
    [{ name: "a.gif", type: "image/gif" }, "PNG 또는 JPG"],
    [{ name: "a.webp", type: "image/webp" }, "PNG 또는 JPG"],
    [{ name: "notes.txt", type: "text/plain" }, "PNG 또는 JPG"],
    [{ name: "noext", type: "" }, "PNG 또는 JPG"],
  ])("%j", (file, error) => {
    const result = checkImageFile(file);
    expect(error === null ? result : result?.includes(error as string)).toBe(error === null ? null : true);
  });
});

describe("checkImageSize", () => {
  test("accepts ordinary sizes, including odd ones", () => {
    expect(checkImageSize(1440, 900)).toBeNull();
    expect(checkImageSize(37, 23)).toBeNull();
    expect(checkImageSize(MAX_SIDE, MAX_SIDE)).toBeNull();
  });
  test("refuses empty and oversized images", () => {
    expect(checkImageSize(0, 10)).toContain("픽셀");
    expect(checkImageSize(MAX_SIDE + 1, 10)).toContain("너무 큽니다");
    expect(checkImageSize(10, MAX_SIDE + 1)).toContain("너무 큽니다");
  });
});

describe("importImage", () => {
  const file = (name = "a.png", type = "image/png") => new File([new Uint8Array([1])], name, { type });

  test("returns the decoded pixels", async () => {
    const codec = fakeCodec();
    const raw = pageWithCard();
    const blob = await codec.encode(raw);
    const result = await importImage(new File([blob], "page.png", { type: "image/png" }), codec);
    expect(result.ok && [result.raw.width, result.raw.height]).toEqual([60, 40]);
  });

  test("a file the codec cannot read is reported, not thrown", async () => {
    const result = await importImage(file(), fakeCodec());
    expect(result).toEqual({ ok: false, error: expect.stringContaining("읽을 수 없습니다") });
  });

  test("the wrong file type is refused before decoding", async () => {
    let decoded = false;
    const codec: ImageCodec = { encode: async () => new Blob(), decode: async () => ((decoded = true), solidPage(1, 1)) };
    expect((await importImage(file("a.gif", "image/gif"), codec)).ok).toBe(false);
    expect(decoded).toBe(false);
  });

  test("an oversized image is refused", async () => {
    const codec: ImageCodec = { encode: async () => new Blob(), decode: async () => ({ width: MAX_SIDE + 1, height: 1, data: new Uint8ClampedArray((MAX_SIDE + 1) * 4) }) };
    const result = await importImage(file(), codec);
    expect(!result.ok && result.error).toContain("너무 큽니다");
  });
});

describe("renderProjectPng", () => {
  test("output is the screen's size and shows the moved layer, the patch, and the untouched rest", async () => {
    const codec = fakeCodec();
    const { get } = storeWith();
    const id = committedId(get().beginExtraction(CARD));
    get().previewLayerDrag(id, 30, 25);
    get().commitLayerDrag();

    const out = await renderProjectPng(get().snapshotProject()!, get().images, codec);
    expect([out.width, out.height]).toEqual([60, 40]);
    const px = await codec.decode(out.blob);
    expect([px.width, px.height]).toEqual([60, 40]);
    expect(getPixel(px, 35, 30)).toEqual([0, 0, 255, 255]); // the card, at its new place
    expect(getPixel(px, 15, 15)).toEqual([240, 240, 240, 255]); // its old place, filled with the background
    expect(getPixel(px, 55, 5)).toEqual([240, 240, 240, 255]);
  });

  test("a layer moved partly outside the frame is cut at the frame, and the size does not change", async () => {
    const codec = fakeCodec();
    const { get } = storeWith();
    const id = committedId(get().beginExtraction(CARD));
    get().previewLayerDrag(id, 50, 30);
    get().commitLayerDrag();
    const out = await renderProjectPng(get().snapshotProject()!, get().images, codec);
    expect([out.width, out.height]).toEqual([60, 40]);
    expect(getPixel(await codec.decode(out.blob), 59, 39)).toEqual([0, 0, 255, 255]);
  });

  test("a transparent source pixel stays transparent: nothing is painted behind it", async () => {
    const codec = fakeCodec();
    const raw = solidPage(8, 8);
    raw.data.set([0, 0, 0, 0], 0);
    const { get } = storeWith(raw);
    const px = await codec.decode((await renderProjectPng(get().snapshotProject()!, get().images, codec)).blob);
    expect(getPixel(px, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  test("a layer whose bitmap is not loaded is an error", async () => {
    const { get } = storeWith();
    committedId(get().beginExtraction(CARD));
    const layerImage = get().history!.present.screens[0].layers[0].imageId!;
    const images = new Map(get().images);
    images.delete(layerImage);
    await expect(renderProjectPng(get().snapshotProject()!, images, fakeCodec())).rejects.toThrow(/레이어/);
  });
});

describe("readPngSize", () => {
  const header = (w: number, h: number) => {
    const b = new Uint8Array(33);
    b.set([137, 80, 78, 71, 13, 10, 26, 10]);
    new DataView(b.buffer).setUint32(16, w);
    new DataView(b.buffer).setUint32(20, h);
    return new Blob([b]);
  };
  test("reads width and height from IHDR", async () => {
    expect(await readPngSize(header(1440, 900))).toEqual({ width: 1440, height: 900 });
  });
  test("anything that is not a PNG is null", async () => {
    expect(await readPngSize(new Blob([new Uint8Array(40)]))).toBeNull();
    expect(await readPngSize(new Blob([new Uint8Array(3)]))).toBeNull();
  });
});
