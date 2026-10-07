import { describe, expect, test } from "vitest";
import { RenderLayer, renderComposite } from "@/lib/image/render-export";
import { getPixel, setPixel, solid } from "./helpers";

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const layer = (w: number, h: number, rgba: [number, number, number, number], x: number, y: number, zIndex: number, over: Partial<RenderLayer> = {}): RenderLayer => ({
  image: solid(w, h, rgba),
  x,
  y,
  zIndex,
  opacity: 1,
  visible: true,
  ...over,
});
const render = (layers: RenderLayer[], patches = [] as { id: string; rect: { x: number; y: number; width: number; height: number }; fill: string }[]) =>
  renderComposite({ width: 4, height: 4, source: solid(4, 4, WHITE), patches, layers });

describe("renderComposite", () => {
  test("output is exactly the frame size, whatever the source size", () => {
    const out = renderComposite({ width: 6, height: 5, source: solid(9, 9, WHITE), patches: [], layers: [] });
    expect([out.width, out.height, out.data.length]).toEqual([6, 5, 6 * 5 * 4]);
  });

  test("patch fills its rectangle with the colour", () => {
    const out = render([], [{ id: "p", rect: { x: 1, y: 1, width: 2, height: 2 }, fill: "#ff0000" }]);
    expect(getPixel(out, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(getPixel(out, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(getPixel(out, 0, 0)).toEqual(WHITE);
    expect(getPixel(out, 3, 3)).toEqual(WHITE);
  });

  test("layers draw above patches", () => {
    const out = render([layer(2, 2, [0, 0, 255, 255], 1, 1, 0)], [{ id: "p", rect: { x: 0, y: 0, width: 4, height: 4 }, fill: "#ff0000" }]);
    expect(getPixel(out, 1, 1)).toEqual([0, 0, 255, 255]);
    expect(getPixel(out, 0, 0)).toEqual([255, 0, 0, 255]);
  });

  test("zIndex decides the stacking, not array order", () => {
    const red = layer(2, 2, [255, 0, 0, 255], 0, 0, 5);
    const blue = layer(2, 2, [0, 0, 255, 255], 0, 0, 1);
    expect(getPixel(render([red, blue]), 0, 0)).toEqual([255, 0, 0, 255]);
    expect(getPixel(render([blue, red]), 0, 0)).toEqual([255, 0, 0, 255]);
  });

  test("equal zIndex keeps array order", () => {
    const a = layer(1, 1, [1, 0, 0, 255], 0, 0, 0);
    const b = layer(1, 1, [2, 0, 0, 255], 0, 0, 0);
    expect(getPixel(render([a, b]), 0, 0)[0]).toBe(2);
  });

  test("layers hanging outside the frame are cut at its edge", () => {
    const out = render([layer(2, 2, [0, 255, 0, 255], -1, -1, 0), layer(2, 2, [0, 0, 255, 255], 3, 3, 1)]);
    expect(getPixel(out, 0, 0)).toEqual([0, 255, 0, 255]);
    expect(getPixel(out, 1, 1)).toEqual(WHITE);
    expect(getPixel(out, 3, 3)).toEqual([0, 0, 255, 255]);
  });

  test("hidden layers are not drawn", () => {
    expect(getPixel(render([layer(2, 2, [0, 0, 0, 255], 0, 0, 0, { visible: false })]), 0, 0)).toEqual(WHITE);
  });

  test("transparency stays real alpha: no checkerboard or fill appears", () => {
    const source = solid(4, 4, WHITE);
    setPixel(source, 0, 0, [0, 0, 0, 0]);
    const out = renderComposite({ width: 4, height: 4, source, patches: [], layers: [layer(1, 1, [9, 9, 9, 0], 0, 0, 0)] });
    expect(getPixel(out, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  test("a half-transparent layer blends instead of replacing", () => {
    const out = render([layer(1, 1, [255, 0, 0, 255], 0, 0, 0, { opacity: 0.5 })]);
    const [r, g, b, a] = getPixel(out, 0, 0);
    expect(r).toBe(255);
    expect(g).toBeGreaterThanOrEqual(127);
    expect(g).toBeLessThanOrEqual(128);
    expect(b).toBe(g);
    expect(a).toBe(255);
  });
});
