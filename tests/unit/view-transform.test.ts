import { describe, expect, test } from "vitest";
import { clientToWorld } from "@/lib/geometry/coords";
import { MAX_ZOOM, MIN_ZOOM, fitView, panBy, zoomAt } from "@/lib/geometry/view-transform";

const zero = { x: 0, y: 0 };

describe("zoomAt", () => {
  test("keeps the world point under the anchor fixed", () => {
    const view = { zoom: 1, panX: 30, panY: -10 };
    const anchor = { x: 200, y: 100 };
    const next = zoomAt(view, 2, anchor);
    expect(next.zoom).toBe(2);
    expect(clientToWorld(anchor, zero, next)).toEqual(clientToWorld(anchor, zero, view));
  });
  test("from the origin view, zooming at (200,100) to 2x pans by (-200,-100)", () => {
    expect(zoomAt({ zoom: 1, panX: 0, panY: 0 }, 2, { x: 200, y: 100 })).toEqual({ zoom: 2, panX: -200, panY: -100 });
  });
  test("zoom is clamped", () => {
    expect(zoomAt({ zoom: 1, panX: 0, panY: 0 }, 100, zero).zoom).toBe(MAX_ZOOM);
    expect(zoomAt({ zoom: 1, panX: 0, panY: 0 }, 0.001, zero).zoom).toBe(MIN_ZOOM);
  });
});

test("panBy moves the view without touching zoom", () => {
  expect(panBy({ zoom: 2, panX: 5, panY: 5 }, 10, -3)).toEqual({ zoom: 2, panX: 15, panY: 2 });
});

describe("fitView", () => {
  test("shrinks a large frame to fit and centres it", () => {
    const v = fitView({ width: 1000, height: 700 }, { x: 0, y: 0, width: 1440, height: 900 });
    expect(v.zoom).toBeCloseTo(904 / 1440, 9);
    expect(v.panX).toBeCloseTo(48, 6);
  });
  test("a small frame stays at 100% and is centred", () => {
    expect(fitView({ width: 1000, height: 700 }, { x: 0, y: 0, width: 400, height: 300 })).toEqual({ zoom: 1, panX: 300, panY: 200 });
  });
});
