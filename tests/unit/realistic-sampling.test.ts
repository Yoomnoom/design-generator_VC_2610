import fs from "node:fs";
import { describe, expect, test } from "vitest";
import { hexToRgb } from "@/lib/image/color";
import { COLOR_TOLERANCE, DEFAULT_RING_WIDTH, FAR_RING_FROM, FAR_RING_TO, MAX_OUTLIER_RATIO, MODE_MIN_SHARE, NEAR_FAR_TOLERANCE, colorDistance, sampleBackground } from "@/lib/image/sample-background";
import { decodePng } from "./png";

/* How the background sampler behaves on a capture that looks like a real web app (tests/fixtures/realistic-capture.png:
 * diagonal gradient page, white cards with soft shadows, buttons, text bars, a header with a shadow). */

const image = decodePng(fs.readFileSync("tests/fixtures/realistic-capture.png"));
const rects: Record<string, { x: number; y: number; width: number; height: number }> = JSON.parse(fs.readFileSync("tests/fixtures/realistic-capture.rects.json", "utf8"));
const grow = (r: { x: number; y: number; width: number; height: number }, by: number) => ({ x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by });

const CASES: Record<string, { x: number; y: number; width: number; height: number }> = {
  "card, exactly": rects.card0,
  "card + 20px": grow(rects.card0, 20),
  "card + 40px (shadow included)": grow(rects.card0, 40),
  "button inside a card": rects.button0,
  "thumbnail inside a card": rects.thumb0,
  "text bar inside a card": rects.textbar0,
  "logo inside the header": { x: 24, y: 18, width: 28, height: 28 },
  "header, full width": rects.header,
  "wide chart card, exactly": rects.wide,
};

/** What Phase 1 did on the same selections (ring 3px; its picker started from the near ring's own colour). Measured before the change. */
const PHASE1: Record<string, { status: string; fill: string }> = {
  "card, exactly": { status: "needs-user-color", fill: "#daddee" },
  "card + 40px (shadow included)": { status: "ok", fill: "#e6eafa" },
  "button inside a card": { status: "ok", fill: "#ffffff" },
  "thumbnail inside a card": { status: "ok", fill: "#ffffff" },
  "text bar inside a card": { status: "ok", fill: "#ffffff" },
  "header, full width": { status: "ok", fill: "#d7dded" },
  "wide chart card, exactly": { status: "needs-user-color", fill: "#d1daec" },
};

const rows = Object.entries(CASES).flatMap(([name, rect]) =>
  [1, 3, 5].map((ring) => {
    const r = sampleBackground(image, rect, ring);
    return { name, ring, status: r.status, reason: r.reason, near: r.hex, far: r.farHex, dist: r.nearFarDistance, outlier: Number(r.outlierRatio.toFixed(3)), suggested: r.suggestedHex };
  }),
);
const at = (name: string, ring = DEFAULT_RING_WIDTH) => rows.find((r) => r.name === name && r.ring === ring)!;

/** the page's gradient at a point, computed from how the fixture was drawn (before any card or shadow) */
const gradientAt = (x: number, y: number) => {
  const t = (x * image.width + y * image.height) / (image.width ** 2 + image.height ** 2);
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
  return { r: lerp(0xf4, 0xd3), g: lerp(0xf6, 0xde), b: lerp(0xff, 0xf8) };
};

test("the fixture is what the report says it is", () => {
  expect([image.width, image.height]).toEqual([960, 600]);
});

test("before/after table (printed for the report)", () => {
  console.log(`thresholds: near ring ${DEFAULT_RING_WIDTH}px, tolerance ${COLOR_TOLERANCE}, off-colour > ${MAX_OUTLIER_RATIO * 100}% = mixed, mode share >= ${MODE_MIN_SHARE * 100}%, far ring ${FAR_RING_FROM}-${FAR_RING_TO}px, near/far tolerance ${NEAR_FAR_TOLERANCE}`);
  console.table(
    Object.keys(PHASE1).map((name) => ({
      selection: name,
      "before: result": PHASE1[name].status === "ok" ? `auto ${PHASE1[name].fill}` : `asks, picker starts ${PHASE1[name].fill}`,
      "after: result": at(name).status === "ok" ? `auto ${at(name).near}` : `asks (${at(name).reason}), picker starts ${at(name).suggested}`,
      "near/far gap": at(name).dist,
    })),
  );
  expect(rows.length).toBe(Object.keys(CASES).length * 3);
});

describe("a. near ring versus far ring", () => {
  test.each([1, 3, 5])("the header: its near ring is inside its own shadow while the far ring is the page, so the user is asked instead of getting a grey band (ring %i)", (ring) => {
    const r = at("header, full width", ring);
    expect(r).toMatchObject({ status: "needs-user-color", reason: "near-far-mismatch" });
    expect(r.dist).toBeGreaterThan(NEAR_FAR_TOLERANCE);
    expect(PHASE1["header, full width"].status).toBe("ok"); // it used to fill automatically, with the shadow's colour
  });

  test("what was already asked for is still asked for", () => {
    for (const ring of [1, 3, 5]) {
      expect(at("card, exactly", ring).status).toBe("needs-user-color");
      expect(at("wide chart card, exactly", ring).status).toBe("needs-user-color");
    }
  });

  test.each([1, 3, 5])("elements inside a card still fill automatically with the card's white, even though their far ring crosses the card's edge (ring %i)", (ring) => {
    for (const name of ["button inside a card", "thumbnail inside a card", "text bar inside a card", "logo inside the header"]) {
      expect(at(name, ring)).toMatchObject({ status: "ok", near: "#ffffff", far: null }); // far ring is a mix, so it is ignored
    }
  });

  test.each([1, 3, 5])("a card cut out with margin for its shadow still fills automatically (ring %i)", (ring) => {
    expect(at("card + 40px (shadow included)", ring).status).toBe("ok");
    expect(at("card + 20px", ring).status).toBe("ok");
  });
});

describe("b. the picker's suggested colour", () => {
  test("for a card cut out exactly it is the page behind the shadow, not the shadow", () => {
    const expected = gradientAt(rects.card0.x + rects.card0.width / 2, rects.card0.y + rects.card0.height / 2);
    const after = colorDistance(hexToRgb(at("card, exactly").suggested!)!, expected);
    const before = colorDistance(hexToRgb(PHASE1["card, exactly"].fill)!, expected);
    console.log(`suggested colour vs the page's real gradient under the card: before ${before}, after ${after} (max channel difference)`);
    expect(after).toBeLessThanOrEqual(6);
    expect(before).toBeGreaterThan(after * 2);
  });

  test("for the header it is the page, not the grey shadow band", () => {
    const expected = gradientAt(480, 100);
    expect(colorDistance(hexToRgb(at("header, full width").suggested!)!, expected)).toBeLessThanOrEqual(12);
  });

  test("every case still has a suggestion, so the picker never starts empty", () => {
    expect(rows.every((r) => r.suggested !== null)).toBe(true);
  });
});

test("a colour accepted automatically is within tolerance for at least 80% of the near ring, and the far ring agrees when it is usable", () => {
  for (const r of rows.filter((r) => r.status === "ok")) {
    expect(r.outlier).toBeLessThanOrEqual(MAX_OUTLIER_RATIO);
    if (r.dist !== null) expect(r.dist).toBeLessThanOrEqual(NEAR_FAR_TOLERANCE);
  }
});
