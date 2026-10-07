import { describe, expect, test } from "vitest";
import { ClipboardWriter, copyLayerToClipboard, decidePaste, describeClipboardFailure } from "@/features/layer-clipboard/layer-clipboard";
import { hashPixels } from "@/lib/image/hash";
import { createRawImage } from "@/lib/image/raw-image";
import { CARD, committedId, fakeCodec, solidPage, storeWith } from "./fixtures";
import { setPixel, solid } from "./helpers";

/** a stand-in for the system clipboard: remembers the last PNG written to it */
const fakeClipboard = () => {
  const box: { png: Blob | null; writes: number } = { png: null, writes: 0 };
  const write: ClipboardWriter = async (png) => {
    box.png = png;
    box.writes++;
  };
  return { box, write };
};

const withLayer = () => {
  const ctx = storeWith();
  return { ...ctx, id: committedId(ctx.get().beginExtraction(CARD)), codec: fakeCodec() };
};
const asFile = (blob: Blob) => new File([blob], "image.png", { type: "image/png" });

describe("copying a layer", () => {
  test("its bitmap goes to the system clipboard as a picture, and the app remembers the layer with that picture's hash", async () => {
    const ctx = withLayer();
    const cb = fakeClipboard();
    expect(await copyLayerToClipboard({ layerId: ctx.id, store: ctx.store, codec: ctx.codec, write: cb.write })).toEqual({ ok: true });

    const written = await ctx.codec.decode(cb.box.png!);
    const layer = ctx.layers()[0];
    const bitmap = ctx.get().images.get(layer.imageId!)!.raw;
    expect([written.width, written.height]).toEqual([CARD.width, CARD.height]); // the layer's own bitmap, not the whole page
    expect(Array.from(written.data)).toEqual(Array.from(bitmap.data));
    expect(ctx.get().layerClipboard).toMatchObject({ pastes: 0, hash: await hashPixels(bitmap) });
    expect(ctx.get().layerClipboard!.layer.id).toBe(ctx.id);
  });

  test("copying changes nothing in the project and records no undo step", async () => {
    const ctx = withLayer();
    const history = ctx.get().history;
    await copyLayerToClipboard({ layerId: ctx.id, store: ctx.store, codec: ctx.codec, write: fakeClipboard().write });
    expect(ctx.get().history).toBe(history);
  });

  test("a refused write is reported with the reason, and nothing is remembered", async () => {
    const ctx = withLayer();
    const refuse: ClipboardWriter = async () => {
      throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
    };
    const r = await copyLayerToClipboard({ layerId: ctx.id, store: ctx.store, codec: ctx.codec, write: refuse });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain("허용");
    expect(!r.ok && r.reason).toContain("레이어를 복사하지 못했습니다"); // it says what failed, then why
    expect(ctx.get().layerClipboard).toBeNull();
  });

  test("a failed copy also forgets an earlier successful one: the system clipboard no longer matches it", async () => {
    const ctx = withLayer();
    await copyLayerToClipboard({ layerId: ctx.id, store: ctx.store, codec: ctx.codec, write: fakeClipboard().write });
    expect(ctx.get().layerClipboard).not.toBeNull();
    await copyLayerToClipboard({ layerId: ctx.id, store: ctx.store, codec: ctx.codec, write: async () => { throw new Error("boom"); } });
    expect(ctx.get().layerClipboard).toBeNull();
  });

  test("an unknown layer is refused without touching the clipboard", async () => {
    const ctx = withLayer();
    const cb = fakeClipboard();
    const r = await copyLayerToClipboard({ layerId: "nope", store: ctx.store, codec: ctx.codec, write: cb.write });
    expect(r.ok).toBe(false);
    expect(cb.box.writes).toBe(0);
  });

  test("a layer deleted while the browser was asking for permission is not remembered", async () => {
    const ctx = withLayer();
    const slow: ClipboardWriter = async () => {
      ctx.get().deleteLayer(ctx.id);
    };
    const r = await copyLayerToClipboard({ layerId: ctx.id, store: ctx.store, codec: ctx.codec, write: slow });
    expect(r.ok).toBe(false);
    expect(ctx.get().layerClipboard).toBeNull();
  });
});

describe("what a paste does", () => {
  const copied = async () => {
    const ctx = withLayer();
    const cb = fakeClipboard();
    await copyLayerToClipboard({ layerId: ctx.id, store: ctx.store, codec: ctx.codec, write: cb.write });
    return { ...ctx, cb };
  };

  test("the picture that was put there pastes as the layer", async () => {
    const ctx = await copied();
    expect(await decidePaste({ file: asFile(ctx.cb.box.png!), store: ctx.store, codec: ctx.codec })).toBe("layer");
  });

  test("the same picture still counts after the clipboard hands it back re-encoded (the hash is of pixels, not bytes)", async () => {
    const ctx = await copied();
    const pixels = await ctx.codec.decode(ctx.cb.box.png!);
    const reEncoded = await ctx.codec.encode({ ...pixels, data: new Uint8ClampedArray(pixels.data) });
    expect(await decidePaste({ file: asFile(reEncoded), store: ctx.store, codec: ctx.codec })).toBe("layer");
  });

  test("a different picture is a new image, even though a layer is waiting", async () => {
    const ctx = await copied();
    const other = await ctx.codec.encode(solid(CARD.width, CARD.height, [1, 2, 3, 255]));
    expect(await decidePaste({ file: asFile(other), store: ctx.store, codec: ctx.codec })).toBe("image");
  });

  test("one different pixel is enough to make it a different picture", async () => {
    const ctx = await copied();
    const pixels = await ctx.codec.decode(ctx.cb.box.png!);
    setPixel(pixels, 0, 0, [9, 9, 9, 255]);
    expect(await decidePaste({ file: asFile(await ctx.codec.encode(pixels)), store: ctx.store, codec: ctx.codec })).toBe("image");
  });

  test("a picture of the same bytes but another shape is a different picture", async () => {
    const ctx = await copied();
    const pixels = await ctx.codec.decode(ctx.cb.box.png!);
    const rotated = createRawImage(pixels.height, pixels.width);
    rotated.data.set(pixels.data); // same bytes, 120 × 240 instead of 240 × 120
    expect(await decidePaste({ file: asFile(await ctx.codec.encode(rotated)), store: ctx.store, codec: ctx.codec })).toBe("image");
  });

  test("with no picture on the clipboard nothing is pasted, even though a layer was copied inside the app", async () => {
    const ctx = await copied();
    expect(await decidePaste({ file: null, store: ctx.store, codec: ctx.codec })).toBe("nothing");
    expect(ctx.get().layerClipboard).not.toBeNull(); // and the copy is still there for when the picture comes back
  });

  test("with no layer copied, any picture is a new image", async () => {
    const ctx = withLayer();
    const png = await ctx.codec.encode(solidPage(5, 5));
    expect(await decidePaste({ file: asFile(png), store: ctx.store, codec: ctx.codec })).toBe("image");
  });

  test("a file that cannot be read goes the import way, which reports it", async () => {
    const ctx = await copied();
    expect(await decidePaste({ file: new File([new Uint8Array([1, 2, 3])], "broken.png", { type: "image/png" }), store: ctx.store, codec: ctx.codec })).toBe("image");
  });

  test("once the project is replaced the copy is gone, so the very same picture is just an image", async () => {
    const ctx = await copied();
    ctx.get().newProject({ fileName: "b.png", raw: solidPage(10, 10) });
    expect(await decidePaste({ file: asFile(ctx.cb.box.png!), store: ctx.store, codec: ctx.codec })).toBe("image");
  });

  test("pasting the layer repeatedly keeps matching: the copy is not used up", async () => {
    const ctx = await copied();
    for (let i = 0; i < 3; i++) {
      expect(await decidePaste({ file: asFile(ctx.cb.box.png!), store: ctx.store, codec: ctx.codec })).toBe("layer");
      expect(ctx.get().pasteLayer()).not.toBeNull();
    }
    expect(ctx.layers().map((l) => l.transform.x)).toEqual([CARD.x, CARD.x + 16, CARD.x + 32, CARD.x + 48]);
  });
});

describe("describeClipboardFailure", () => {
  test.each([
    [{ name: "NotAllowedError", message: "x" }, "허용"],
    [{ name: "SecurityError", message: "x" }, "허용"],
    [{ name: "NoClipboardApi", message: "x" }, "보안 연결"],
    [{ name: "NoImageClipboard", message: "x" }, "지원하지 않습니다"],
    [new Error("disk full"), "disk full"],
    [undefined, "원인을 알 수 없습니다"],
    ["just a string", "원인을 알 수 없습니다"],
  ])("%j", (error, fragment) => {
    expect(describeClipboardFailure(error)).toContain(fragment);
  });
  test("is never empty", () => {
    for (const e of [null, undefined, {}, new Error("")]) expect(describeClipboardFailure(e).length).toBeGreaterThan(5);
  });
});

describe("hashPixels", () => {
  test("equal pictures hash equal; any change to a pixel, the size or the alpha changes it", async () => {
    const a = solid(4, 3, [10, 20, 30, 255]);
    const same = solid(4, 3, [10, 20, 30, 255]);
    const px = solid(4, 3, [10, 20, 30, 255]);
    setPixel(px, 3, 2, [10, 20, 31, 255]);
    const alpha = solid(4, 3, [10, 20, 30, 254]);
    const h = await hashPixels(a);
    expect(await hashPixels(same)).toBe(h);
    expect(await hashPixels(px)).not.toBe(h);
    expect(await hashPixels(alpha)).not.toBe(h);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  test("width and height are part of it", async () => {
    expect(await hashPixels(solid(2, 3, [1, 2, 3, 255]))).not.toBe(await hashPixels(solid(3, 2, [1, 2, 3, 255])));
  });
});
