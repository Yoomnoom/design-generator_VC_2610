import fs from "node:fs";
import { describe, expect, test } from "vitest";
import { Candidate, DEFAULT_OPTIONS, candidatesAt, findCandidates, iou, pickNext } from "@/lib/image/candidates";
import { RawImage, createRawImage } from "@/lib/image/raw-image";
import { decodePng } from "./png";
import { setPixel } from "./helpers";

type R = { x: number; y: number; width: number; height: number };
const fill = (img: RawImage, r: R, c: [number, number, number, number]) => {
  for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) setPixel(img, x, y, c);
};
const PAGE: [number, number, number, number] = [240, 240, 240, 255];
const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const BLUE: [number, number, number, number] = [60, 90, 220, 255];
const GREY: [number, number, number, number] = [200, 205, 215, 255];

/** a flat capture with two cards, a button and a text bar inside the first, and a few specks */
function synthetic() {
  const img = createRawImage(400, 300, PAGE);
  const rects = {
    card1: { x: 50, y: 40, width: 150, height: 100 },
    button: { x: 70, y: 100, width: 60, height: 24 },
    textBar: { x: 70, y: 60, width: 100, height: 8 },
    card2: { x: 230, y: 40, width: 120, height: 100 },
  };
  fill(img, rects.card1, WHITE);
  fill(img, rects.textBar, GREY);
  fill(img, rects.button, BLUE);
  fill(img, rects.card2, WHITE);
  for (const [x, y] of [[20, 200], [100, 220], [300, 250]]) fill(img, { x, y, width: 3, height: 3 }, [0, 0, 0, 255]); // specks
  return { img, rects };
}
const best = (list: Candidate[], gt: R) => list.reduce((m, c) => Math.max(m, iou(c, gt)), 0);

describe("findCandidates on a flat capture", () => {
  const { img, rects } = synthetic();
  const list = findCandidates(img);

  test("every card, the button in a card and the text bar are found, with boxes that match", () => {
    for (const [name, r] of Object.entries(rects)) expect(best(list, r), name).toBeGreaterThanOrEqual(0.98);
  });
  test("the page itself is not a candidate", () => {
    expect(list.some((c) => c.width * c.height > 0.9 * 400 * 300)).toBe(false);
  });
  test("specks and other noise smaller than a few pixels are left out", () => {
    expect(list.some((c) => c.width < 8 || c.height < 8)).toBe(false);
  });
  test("nothing is made up: every candidate lies inside the frame", () => {
    for (const c of list) expect(c.x >= 0 && c.y >= 0 && c.x + c.width <= 400 && c.y + c.height <= 300).toBe(true);
  });
  test("the same picture always gives the same answer", () => {
    expect(findCandidates(img)).toEqual(list);
  });
  test("it does not change the picture it looks at", () => {
    const copy = Uint8ClampedArray.from(img.data);
    findCandidates(img);
    expect(Buffer.from(img.data).equals(Buffer.from(copy))).toBe(true);
  });
  test("a blank picture, and one pixel, have no candidates", () => {
    expect(findCandidates(createRawImage(100, 100, PAGE))).toEqual([]);
    expect(findCandidates(createRawImage(1, 1, PAGE))).toEqual([]);
  });
});

describe("accuracy on the synthetic capture (printed for the report)", () => {
  const { img, rects } = synthetic();
  const list = findCandidates(img);
  test("measurement table", () => {
    const rows = Object.entries(rects).map(([name, r]) => ({ element: name, "best IoU": Number(best(list, r).toFixed(3)), found: best(list, r) >= 0.85 }));
    console.log(`candidates found: ${list.length} in a ${img.width}x${img.height} synthetic capture with ${rows.length} known elements (+3 specks that must not be found)`);
    console.table(rows);
    expect(rows.every((r) => r.found)).toBe(true);
  });
});
describe("tolerance and what a region may be", () => {
  test("a card on a soft gradient page is still found (the gradient joins the page, not the card)", () => {
    const img = createRawImage(300, 200);
    for (let y = 0; y < 200; y++) for (let x = 0; x < 300; x++) setPixel(img, x, y, [220 + Math.round((x + y) / 25), 225 + Math.round((x + y) / 40), 250, 255]);
    fill(img, { x: 60, y: 50, width: 120, height: 80 }, WHITE);
    expect(best(findCandidates(img), { x: 60, y: 50, width: 120, height: 80 })).toBeGreaterThanOrEqual(0.98);
  });
  test("two patches that differ by less than the tolerance are one patch; by more, two", () => {
    const img = createRawImage(60, 30, [100, 100, 100, 255]);
    fill(img, { x: 30, y: 0, width: 30, height: 30 }, [102, 100, 100, 255]);
    expect(findCandidates(img, { maxFrameShare: 2 }).map((c) => c.width)).toEqual([60]);
    fill(img, { x: 30, y: 0, width: 30, height: 30 }, [130, 100, 100, 255]);
    expect(findCandidates(img, { maxFrameShare: 2 }).map((c) => c.width)).toEqual([30, 30]);
  });
  test("a thin outline is not a shape", () => {
    const img = createRawImage(200, 200, PAGE);
    fill(img, { x: 20, y: 20, width: 100, height: 100 }, [0, 0, 0, 255]);
    fill(img, { x: 22, y: 22, width: 96, height: 96 }, PAGE);
    expect(findCandidates(img).some((c) => c.width === 100)).toBe(false); // the ring fills about 8% of its box
  });
  test("a noisy photo-like area makes no big region (a known limit: textures are not found)", () => {
    const img = createRawImage(300, 200, PAGE);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let y = 40; y < 160; y++) for (let x = 40; x < 260; x++) setPixel(img, x, y, [Math.round(rnd() * 255), Math.round(rnd() * 255), Math.round(rnd() * 255), 255]);
    expect(findCandidates(img).filter((c) => c.width > 40)).toEqual([]);
  });
  test("transparent pixels count as a patch of their own", () => {
    const img = createRawImage(100, 100, [0, 0, 0, 0]);
    fill(img, { x: 20, y: 20, width: 40, height: 40 }, BLUE);
    expect(best(findCandidates(img), { x: 20, y: 20, width: 40, height: 40 })).toBeGreaterThanOrEqual(0.98);
  });
});

describe("picking among candidates under a click", () => {
  const { img, rects } = synthetic();
  const list = findCandidates(img);
  const inButton = { x: rects.button.x + 30, y: rects.button.y + 12 };

  test("under a click inside the button: the button first, then the card that holds it", () => {
    const here = candidatesAt(list, inButton);
    expect(iou(here[0], rects.button)).toBeGreaterThan(0.95);
    expect(iou(here[1], rects.card1)).toBeGreaterThan(0.95);
    const areas = here.map((c) => c.width * c.height);
    expect(areas).toEqual([...areas].sort((a, b) => a - b));
  });
  test("the first click takes the smallest; clicking again on the same spot goes outwards; after the largest it starts over", () => {
    const a = pickNext(list, inButton, null)!;
    expect(iou(a.candidate, rects.button)).toBeGreaterThan(0.95);
    const b = pickNext(list, { x: inButton.x + 1, y: inButton.y }, { point: inButton, index: a.index })!; // a click about 1px away is the same spot
    expect(iou(b.candidate, rects.card1)).toBeGreaterThan(0.95);
    const c = pickNext(list, inButton, { point: inButton, index: b.index })!;
    expect(iou(c.candidate, rects.button)).toBeGreaterThan(0.95);
  });
  test("a click somewhere else starts again from the smallest", () => {
    const a = pickNext(list, inButton, null)!;
    const b = pickNext(list, { x: rects.card2.x + 20, y: rects.card2.y + 20 }, { point: inButton, index: a.index })!;
    expect(iou(b.candidate, rects.card2)).toBeGreaterThan(0.95);
    expect(b.index).toBe(0);
  });
  test("a click on the bare page picks nothing", () => {
    expect(pickNext(list, { x: 5, y: 5 }, null)).toBeNull();
  });
});

describe("accuracy on a capture that looks like a real app (tests/fixtures/realistic-capture.png)", () => {
  const image = decodePng(fs.readFileSync("tests/fixtures/realistic-capture.png"));
  const truth: Record<string, R> = JSON.parse(fs.readFileSync("tests/fixtures/realistic-capture.rects.json", "utf8"));
  const list = findCandidates(image);
  const rows = Object.entries(truth).map(([name, r]) => ({ element: name, "best IoU": Number(best(list, r).toFixed(3)), found: best(list, r) >= 0.85 }));

  test("measurement table (printed for the report)", () => {
    console.log(`candidates found: ${list.length} in a ${image.width}x${image.height} capture with ${rows.length} known elements`);
    console.table(rows);
    expect(rows.length).toBeGreaterThan(5);
  });
  test("the cards, the buttons, the thumbnail and the chart card are found at IoU 0.85 or better", () => {
    for (const name of ["card0", "card1", "card2", "button0", "button1", "button2", "thumb0", "wide"]) expect(best(list, truth[name]), name).toBeGreaterThanOrEqual(0.85);
  });
  test("a text bar inside a card is found too", () => {
    expect(best(list, truth.textbar0)).toBeGreaterThanOrEqual(0.85);
  });
});

describe("a picture that is too busy", () => {
  const noise = (w: number, h: number) => {
    const img = createRawImage(w, h);
    let seed = 7;
    for (let i = 0; i < w * h; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      img.data.set([seed & 255, (seed >> 8) & 255, (seed >> 16) & 255, 255], i * 4);
    }
    return img;
  };
  test("noise makes one run per pixel; past the limit the search stops with a message instead of eating memory", () => {
    expect(() => findCandidates(noise(200, 200), { maxRuns: 10_000 })).toThrow(/복잡한 화면/);
  });
  test("under the limit nothing changes; a flat screenshot has very few runs and is far from it", () => {
    expect(() => findCandidates(noise(50, 50), { maxRuns: 10_000 })).not.toThrow();
    expect(() => findCandidates(synthetic().img, { maxRuns: 2_000 })).not.toThrow();
  });
  test("the default limit is generous for real screenshots and still stops a full-size photo (12 million pixels)", () => {
    expect(DEFAULT_OPTIONS.maxRuns).toBeGreaterThanOrEqual(1_000_000);
    expect(DEFAULT_OPTIONS.maxRuns).toBeLessThan(12_000_000);
  });
});
describe("speed", () => {
  test("a 4000 × 3000 capture with fifty cards is analysed in a few seconds (measurement)", () => {
    const img = createRawImage(4000, 3000, PAGE);
    for (let i = 0; i < 50; i++) {
      const r = { x: 100 + (i % 10) * 380, y: 100 + Math.floor(i / 10) * 560, width: 320, height: 480 };
      fill(img, r, WHITE);
      fill(img, { x: r.x + 20, y: r.y + 20, width: 280, height: 40 }, GREY);
      fill(img, { x: r.x + 20, y: r.y + 400, width: 120, height: 50 }, BLUE);
    }
    const t0 = performance.now();
    const list = findCandidates(img);
    const ms = Math.round(performance.now() - t0);
    console.log(`MEASURE findCandidates 4000x3000, 50 cards: ${ms} ms, ${list.length} candidates (Node, main thread)`);
    expect(list.length).toBeGreaterThanOrEqual(150);
    expect(ms).toBeLessThan(15000);
  });
});
