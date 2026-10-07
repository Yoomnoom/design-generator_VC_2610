import { describe, expect, test } from "vitest";
import { View, clientToImage, clientToWorld, imageToClient, roundToPixel, clampToImage } from "@/lib/geometry/coords";
import { selectionFromImagePoints } from "@/lib/geometry/rect";

const origin = { x: 100, y: 50 }; // container's top-left in the viewport
const frame0 = { x: 0, y: 0 };

describe("clientToImage — zoom 100%", () => {
  const view: View = { zoom: 1, panX: 0, panY: 0 };
  test("no pan: client minus container origin", () => {
    expect(clientToImage({ x: 110, y: 70 }, origin, view, frame0)).toEqual({ x: 10, y: 20 });
  });
  test("with pan", () => {
    expect(clientToImage({ x: 130, y: 70 }, origin, { zoom: 1, panX: 30, panY: 10 }, frame0)).toEqual({ x: 0, y: 10 });
  });
});

describe("clientToImage — zoom 200%", () => {
  test("no pan: pixel distances are halved", () => {
    expect(clientToImage({ x: 110, y: 70 }, origin, { zoom: 2, panX: 0, panY: 0 }, frame0)).toEqual({ x: 5, y: 10 });
  });
  test("with pan", () => {
    expect(clientToImage({ x: 140, y: 90 }, origin, { zoom: 2, panX: -40, panY: -20 }, frame0)).toEqual({ x: 40, y: 30 });
  });
  test("frame offset in the workspace is subtracted", () => {
    expect(clientToImage({ x: 140, y: 90 }, origin, { zoom: 2, panX: -40, panY: -20 }, { x: 20, y: 10 })).toEqual({ x: 20, y: 20 });
  });
});

describe("round trip", () => {
  test.each([
    [{ zoom: 1, panX: 0, panY: 0 }],
    [{ zoom: 2, panX: 0, panY: 0 }],
    [{ zoom: 2, panX: -40, panY: -20 }],
    [{ zoom: 0.5, panX: 123, panY: -77 }],
    [{ zoom: 8, panX: -999, panY: 31 }],
  ])("imageToClient(clientToImage(p)) returns p for %j", (view) => {
    const screen = { x: 17, y: -9 };
    for (const p of [{ x: 100, y: 50 }, { x: 333, y: 421 }, { x: 1000.5, y: 12.25 }]) {
      const back = imageToClient(clientToImage(p, origin, view, screen), origin, view, screen);
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });
});

describe("extraction rectangle at each zoom", () => {
  // the same on-screen drag, expressed in image pixels
  const drag = (view: View) =>
    selectionFromImagePoints(clientToImage({ x: 140, y: 90 }, origin, view, frame0), clientToImage({ x: 240, y: 190 }, origin, view, frame0), { width: 1000, height: 800 });

  test("100%", () => expect(drag({ zoom: 1, panX: 0, panY: 0 })).toEqual({ x: 40, y: 40, width: 100, height: 100 }));
  test("200%: 100 screen px are 50 image px", () => expect(drag({ zoom: 2, panX: 0, panY: 0 })).toEqual({ x: 20, y: 20, width: 50, height: 50 }));
  test("200% with pan stays on the same image pixels the cursor is over", () => expect(drag({ zoom: 2, panX: -40, panY: -20 })).toEqual({ x: 40, y: 30, width: 50, height: 50 }));
  test("dragging backwards gives the same rectangle", () => {
    const view: View = { zoom: 2, panX: -40, panY: -20 };
    const a = clientToImage({ x: 140, y: 90 }, origin, view, frame0);
    const b = clientToImage({ x: 240, y: 190 }, origin, view, frame0);
    expect(selectionFromImagePoints(b, a, { width: 1000, height: 800 })).toEqual(selectionFromImagePoints(a, b, { width: 1000, height: 800 }));
  });
});

describe("pixel snapping", () => {
  test("rounds half up and never returns -0", () => {
    expect(roundToPixel({ x: 40.5, y: 0.4 })).toEqual({ x: 41, y: 0 });
    expect(Object.is(roundToPixel({ x: -0.2, y: 0 }).x, 0)).toBe(true);
  });
  test("clamps to the image corners", () => {
    expect(clampToImage({ x: -5, y: 900 }, { width: 100, height: 800 })).toEqual({ x: 0, y: 800 });
  });
  test("a selection dragged past the frame is cut at the frame edge", () => {
    expect(selectionFromImagePoints({ x: 90, y: 90 }, { x: 500, y: 500 }, { width: 100, height: 100 })).toEqual({ x: 90, y: 90, width: 10, height: 10 });
  });
  test("a zero-area drag is not a selection", () => {
    expect(selectionFromImagePoints({ x: 10, y: 10 }, { x: 10.2, y: 50 }, { width: 100, height: 100 })).toBeNull();
  });
});

test("clientToWorld ignores nothing: world = (client − origin − pan) / zoom", () => {
  expect(clientToWorld({ x: 300, y: 250 }, origin, { zoom: 4, panX: 20, panY: 10 })).toEqual({ x: 45, y: 47.5 });
});
