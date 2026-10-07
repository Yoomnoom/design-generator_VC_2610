import { IDBFactory } from "fake-indexeddb";
import { describe, expect, test } from "vitest";
import { base64ToBytes, blobToBase64, bytesToBase64 } from "@/lib/storage/base64";
import { openBlobStore } from "@/lib/storage/blob-store";

const blobOf = (bytes: number[], type = "image/png") => new Blob([new Uint8Array(bytes)], { type });
const bytesOf = async (blob: Blob | undefined) => Array.from(new Uint8Array(await blob!.arrayBuffer()));

describe("blob store (IndexedDB)", () => {
  test("keeps a Blob's bytes and type", async () => {
    const store = await openBlobStore("t", new IDBFactory());
    await store.put("a", blobOf([1, 2, 3, 250], "image/jpeg"));
    const got = await store.get("a");
    expect(got).toBeInstanceOf(Blob);
    expect(got!.type).toBe("image/jpeg");
    expect(await bytesOf(got)).toEqual([1, 2, 3, 250]);
  });

  test("missing ids read as undefined", async () => {
    const store = await openBlobStore("t", new IDBFactory());
    expect(await store.get("nope")).toBeUndefined();
    expect(await store.has("nope")).toBe(false);
  });

  test("has, keys, overwrite, delete, clear", async () => {
    const store = await openBlobStore("t", new IDBFactory());
    await store.put("a", blobOf([1]));
    await store.put("b", blobOf([2]));
    expect(await store.has("a")).toBe(true);
    expect((await store.keys()).sort()).toEqual(["a", "b"]);

    await store.put("a", blobOf([9]));
    expect(await bytesOf(await store.get("a"))).toEqual([9]);

    await store.delete("a");
    expect(await store.has("a")).toBe(false);
    expect(await store.keys()).toEqual(["b"]);

    await store.clear();
    expect(await store.keys()).toEqual([]);
  });

  test("survives closing and reopening the database", async () => {
    const factory = new IDBFactory();
    const first = await openBlobStore("persist", factory);
    await first.put("img", blobOf([7, 7, 7]));
    first.close();

    const second = await openBlobStore("persist", factory);
    expect(await bytesOf(await second.get("img"))).toEqual([7, 7, 7]);
  });

  test("databases with different names are separate", async () => {
    const factory = new IDBFactory();
    const a = await openBlobStore("a", factory);
    const b = await openBlobStore("b", factory);
    await a.put("x", blobOf([1]));
    expect(await b.has("x")).toBe(false);
  });
});

describe("base64", () => {
  test("round trips arbitrary bytes, including large buffers", async () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31 + 7) % 256);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
    expect(await blobToBase64(new Blob([bytes]))).toBe(bytesToBase64(bytes));
  });
});
