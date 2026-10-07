import { describe, expect, test } from "vitest";
import { LINE_HEIGHT, layoutText, lineHeightOf, wrapText } from "@/lib/image/text-layout";

/** every character is 10 px wide, so widths are easy to read off */
const m = (s: string) => Array.from(s).length * 10;

describe("wrapText", () => {
  test("text that fits is one line", () => {
    expect(wrapText("hello world", 200, m)).toEqual(["hello world"]);
  });
  test("it wraps at spaces, and the wrapped space is dropped", () => {
    expect(wrapText("one two three four", 100, m)).toEqual(["one two", "three four"]); // "three four" is exactly 100
    expect(wrapText("one two three four", 90, m)).toEqual(["one two", "three", "four"]);
    expect(wrapText("aaaa bbbb cccc", 85, m)).toEqual(["aaaa", "bbbb", "cccc"]); // "aaaa bbbb" is 90 > 85
  });
  test("a word that fits on a line by itself moves down whole rather than being cut", () => {
    expect(wrapText("ab cdefghij", 100, m)).toEqual(["ab", "cdefghij"]);
  });
  test("a word wider than the box is broken between characters", () => {
    expect(wrapText("abcdefghijkl", 50, m)).toEqual(["abcde", "fghij", "kl"]);
  });
  test("Korean text without spaces breaks between characters; with spaces it breaks at them first", () => {
    expect(wrapText("가나다라마바사", 30, m)).toEqual(["가나다", "라마바", "사"]);
    expect(wrapText("가나 다라 마바", 50, m)).toEqual(["가나 다라", "마바"]);
  });
  test("newlines are kept, including empty lines", () => {
    expect(wrapText("a\n\nb", 100, m)).toEqual(["a", "", "b"]);
    expect(wrapText("a\n", 100, m)).toEqual(["a", ""]);
  });
  test("a trailing space does not push a line over", () => {
    expect(wrapText("abcde fgh", 50, m)).toEqual(["abcde", "fgh"]);
  });
  test("a box narrower than one character still makes progress, one character a line", () => {
    expect(wrapText("abc", 5, m)).toEqual(["a", "b", "c"]);
  });
  test("emoji and other characters outside the basic plane count as one character", () => {
    expect(wrapText("😀😀😀😀", 20, m)).toEqual(["😀😀", "😀😀"]);
  });
  test("an empty text is one empty line", () => {
    expect(wrapText("", 100, m)).toEqual([""]);
  });
  test("every returned line fits, unless a single character is wider than the box", () => {
    const text = "The quick brown fox jumps over the lazy dog 0123456789 가나다라마바사아자차카타파하";
    for (const width of [30, 55, 100, 171, 400]) for (const l of wrapText(text, width, m)) expect(m(l)).toBeLessThanOrEqual(Math.max(width, 10));
  });
  test("no text is lost or invented: the lines joined give the words back in order", () => {
    const text = "alpha beta gamma delta epsilon";
    expect(wrapText(text, 70, m).join(" ")).toBe(text);
  });
});

describe("layoutText", () => {
  const box = (over: Partial<{ text: string; width: number; fontSize: number; align: "left" | "center" | "right" }> = {}) => layoutText({ text: "ab cd", width: 100, fontSize: 20, align: "left", ...over }, m);

  test("line height is 1.3 × the font size, and the box is as tall as its lines", () => {
    expect(lineHeightOf(20)).toBe(26);
    expect(LINE_HEIGHT).toBe(1.3);
    expect(box({ text: "a\nb\nc" }).height).toBe(78);
  });
  test("lines go one line height apart from the top", () => {
    expect(box({ text: "a\nb\nc" }).lines.map((l) => l.y)).toEqual([0, 26, 52]);
  });
  test("left, centre and right alignment put each line at its own offset", () => {
    expect(box({ text: "ab\nabcd", align: "left" }).lines.map((l) => l.x)).toEqual([0, 0]);
    expect(box({ text: "ab\nabcd", align: "center" }).lines.map((l) => l.x)).toEqual([40, 30]);
    expect(box({ text: "ab\nabcd", align: "right" }).lines.map((l) => l.x)).toEqual([80, 60]);
  });
  test("an empty text still has the height of one line", () => {
    expect(box({ text: "" }).height).toBe(26);
  });
  test("a narrower box makes a taller one", () => {
    expect(box({ text: "aaa bbb ccc ddd", width: 200 }).height).toBeLessThan(box({ text: "aaa bbb ccc ddd", width: 70 }).height);
  });
});
