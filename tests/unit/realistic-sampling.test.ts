import fs from "node:fs";
import { describe, expect, test } from "vitest";
import { rgbToHex } from "@/lib/image/color";
import { COLOR_TOLERANCE, DEFAULT_RING_WIDTH, MAX_OUTLIER_RATIO, MODE_MIN_SHARE, sampleBackground } from "@/lib/image/sample-background";
import { decodePng } from "./png";

/* How the thresholds behave on a capture that looks like a real web app (tests/fixtures/realistic-capture.png:
 * diagonal gradient page, white cards with soft shadows, buttons, text bars, a header with a shadow). */

const image = decodePng(fs.readFileSync("tests/fixtures/realistic-capture.png"));
const rects: Record<string, { x: number; y: number; width: number; height: number }> = JSON.parse(fs.readFileSync("tests/fixtures/realistic-capture.rects.json", "utf8"));

const grow = (r: { x: number; y: number; width: number; height: number }, by: number) => ({ x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by });

const CASES: Record<string, { x: number; y: number; width: number; height: number }> = {
  "card, exactly": rects.card0,
  "card + 40px (shadow included)": grow(rects.card0, 40),
  "button inside a card": rects.button0,
  "thumbnail inside a card": rects.thumb0,
  "text bar inside a card": rects.textbar0,
  "header, full width": rects.header,
  "wide chart card, exactly": rects.wide,
};

const rows = Object.entries(CASES).flatMap(([name, rect]) =>
  [1, 3, 5].map((ring) => {
    const r = sampleBackground(image, rect, ring);
    return { name, ring, status: r.status, method: r.method, outlier: Number(r.outlierRatio.toFixed(3)), hex: r.hex, samples: r.sampleCount };
  }),
);
const at = (name: string, ring: number) => rows.find((r) => r.name === name && r.ring === ring)!;

test("the fixture is what the report says it is", () => {
  expect([image.width, image.height]).toEqual([960, 600]);
  expect(Object.keys(rects)).toEqual(expect.arrayContaining(["card0", "button0", "wide", "header", "thumb0", "textbar0"]));
});

test("characterisation table (printed for the report)", () => {
  console.log(`thresholds: ring ${DEFAULT_RING_WIDTH}px, tolerance ${COLOR_TOLERANCE}, outliers > ${MAX_OUTLIER_RATIO * 100}% asks, mode share >= ${MODE_MIN_SHARE * 100}%`);
  console.table(rows);
  expect(rows.length).toBe(Object.keys(CASES).length * 3);
});

describe("what the user gets on this capture, at ring widths 1, 3 and 5", () => {
  test.each([1, 3, 5])("a button, thumbnail or text bar inside a card is filled with the card's white, automatically (ring %i)", (ring) => {
    for (const name of ["button inside a card", "thumbnail inside a card", "text bar inside a card"]) {
      expect(at(name, ring)).toMatchObject({ status: "ok", method: "mode", hex: "#ffffff", outlier: 0 });
    }
  });

  test.each([1, 3, 5])("a card cut out exactly has its own shadow around it, so the user is asked for a colour (ring %i)", (ring) => {
    expect(at("card, exactly", ring).status).toBe("needs-user-color");
    expect(at("card, exactly", ring).outlier).toBeGreaterThan(MAX_OUTLIER_RATIO);
    expect(at("wide chart card, exactly", ring).status).toBe("needs-user-color");
  });

  test.each([1, 3, 5])("a card cut out with a margin for its shadow sits on a smooth gradient, which fills automatically (ring %i)", (ring) => {
    expect(at("card + 40px (shadow included)", ring)).toMatchObject({ status: "ok", method: "median" });
  });

  test("on a gradient no single colour dominates, so the median is used instead of the most frequent colour", () => {
    expect(at("card + 40px (shadow included)", 3).method).toBe("median");
    expect(at("header, full width", 3).method).toBe("median");
  });

  test("a wider ring reaches further into a shadow, so the share of off-colour samples grows with it", () => {
    expect(at("card + 40px (shadow included)", 5).outlier).toBeGreaterThan(at("card + 40px (shadow included)", 3).outlier);
  });

  test("every case still returns a best-guess colour, so the picker never starts empty", () => {
    expect(rows.every((r) => r.hex !== null)).toBe(true);
  });
});

test("an automatically accepted colour is within tolerance for at least 80% of the samples", () => {
  for (const r of rows.filter((r) => r.status === "ok")) {
    const sample = sampleBackground(image, CASES[r.name], r.ring);
    expect(sample.outlierRatio).toBeLessThanOrEqual(MAX_OUTLIER_RATIO);
    expect(rgbToHex(sample.color!)).toBe(r.hex);
  }
});
