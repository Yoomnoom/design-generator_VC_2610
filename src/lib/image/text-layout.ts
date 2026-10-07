/* Text layout, with no canvas in it: given a way to measure a string, it decides the lines and where each starts. The canvas on screen
 * and the PNG export both draw these lines, so they wrap in exactly the same places. */

export const TEXT_FONT_FAMILY = '"Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif';
export const LINE_HEIGHT = 1.3;
export const MIN_FONT_SIZE = 4;
export const MAX_FONT_SIZE = 400;
export const MAX_TEXT_LENGTH = 5000;
export const MIN_TEXT_WIDTH = 8;

export type TextAlign = "left" | "center" | "right";
/** the width of a string, in pixels, at the layer's font size */
export type Measure = (text: string) => number;

export const fontOf = (fontSize: number) => `${fontSize}px ${TEXT_FONT_FAMILY}`;
export const lineHeightOf = (fontSize: number) => Math.round(fontSize * LINE_HEIGHT * 100) / 100;

const chars = (s: string) => Array.from(s);

/** Breaks text into lines no wider than `maxWidth`: at newlines, at spaces, and, for a word that is wider than the box on its own
 *  (a long URL, or Korean or Chinese text without spaces), between characters. A line never starts with a wrapped space. */
export function wrapText(text: string, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = [];
  const push = (l: string) => lines.push(l.replace(/\s+$/, ""));
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    let line = "";
    for (const token of paragraph.split(/(\s+)/)) {
      if (token === "") continue;
      if (measure((line + token).replace(/\s+$/, "")) <= maxWidth) {
        line += token;
        continue;
      }
      if (/^\s+$/.test(token)) {
        push(line); // wrap at the space: the space itself is dropped
        line = "";
        continue;
      }
      if (line.trim() !== "") {
        push(line);
        line = "";
      }
      let rest = chars(token);
      while (rest.length > 1 && measure(rest.join("")) > maxWidth) {
        let n = 1;
        while (n < rest.length && measure(rest.slice(0, n + 1).join("")) <= maxWidth) n++;
        push(rest.slice(0, n).join(""));
        rest = rest.slice(n);
      }
      line = rest.join("");
    }
    push(line);
  }
  return lines;
}

export type PlacedLine = { text: string; x: number; y: number };
export type TextLayout = { lines: PlacedLine[]; height: number };

/** Where every line goes inside a box `width` wide, and how tall the box has to be to hold them. */
export function layoutText(args: { text: string; width: number; fontSize: number; align: TextAlign }, measure: Measure): TextLayout {
  const lh = lineHeightOf(args.fontSize);
  const lines = wrapText(args.text, args.width, measure).map((text, i) => {
    const w = measure(text);
    const x = args.align === "center" ? (args.width - w) / 2 : args.align === "right" ? args.width - w : 0;
    return { text, x: Math.round(x * 100) / 100, y: Math.round(i * lh * 100) / 100 };
  });
  return { lines, height: Math.max(Math.round(lines.length * lh * 100) / 100, lh) };
}
