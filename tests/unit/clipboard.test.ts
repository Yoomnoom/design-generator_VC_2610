import { describe, expect, test } from "vitest";
import { imageFromClipboard } from "@/features/import-image/clipboard";
import { isTypingTarget } from "@/lib/dom";

const file = (name: string, type: string) => new File([new Uint8Array([1])], name, { type });
const items = (...fs: File[]) => fs.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f }));

describe("imageFromClipboard", () => {
  test("a PNG in files", () => {
    const png = file("image.png", "image/png");
    expect(imageFromClipboard({ files: [png] })).toBe(png);
  });
  test("a JPEG that only appears as an item", () => {
    const jpg = file("shot.jpg", "image/jpeg");
    expect(imageFromClipboard({ files: [], items: items(jpg) })).toBe(jpg);
  });
  test("the same file in both files and items is not doubled up", () => {
    const png = file("a.png", "image/png");
    expect(imageFromClipboard({ files: [png], items: items(png) })).toBe(png);
  });
  test("PNG/JPEG is preferred over another image type", () => {
    const gif = file("a.gif", "image/gif");
    const png = file("b.png", "image/png");
    expect(imageFromClipboard({ files: [gif, png] })).toBe(png);
  });
  test("an unsupported image type is still returned, so the user is told it is unsupported", () => {
    const webp = file("a.webp", "image/webp");
    expect(imageFromClipboard({ files: [webp] })).toBe(webp);
  });
  test("text, non-image files and an empty clipboard give null", () => {
    expect(imageFromClipboard(null)).toBeNull();
    expect(imageFromClipboard({ files: [] })).toBeNull();
    expect(imageFromClipboard({ files: [file("a.txt", "text/plain")] })).toBeNull();
    expect(imageFromClipboard({ items: [{ kind: "string", type: "text/plain", getAsFile: () => null }] })).toBeNull();
  });
  test("an unnamed image gets a readable name and keeps its type", () => {
    const named = imageFromClipboard({ files: [file("", "image/png")] })!;
    expect([named.name, named.type]).toEqual(["붙여넣은 이미지.png", "image/png"]);
    expect(imageFromClipboard({ files: [file("", "image/jpeg")] })!.name).toBe("붙여넣은 이미지.jpg");
  });
});

describe("isTypingTarget", () => {
  test.each([["INPUT", true], ["TEXTAREA", true], ["SELECT", true], ["BUTTON", false], ["DIV", false], ["CANVAS", false]])("%s → %s", (tagName, expected) => {
    expect(isTypingTarget({ tagName } as unknown as EventTarget)).toBe(expected);
  });
  test("contenteditable counts, null and non-elements do not", () => {
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({} as EventTarget)).toBe(false);
  });
});
