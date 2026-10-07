import { Page } from "@playwright/test";
import { editor, openApp, pageWithCard, setColorInput, uploadPng, zoomTo } from "./helpers";

export const GRAY = [240, 240, 240, 255];
export const RED = [229, 50, 45, 255]; // the default drawing colour #e5322d
export const GREEN = [0, 170, 0, 255];
export const diff = (a: number[], b: number[]) => Math.max(...a.slice(0, 3).map((v, i) => Math.abs(v - b[i])));

/** the page with the card at a zoom, with image point `at` in the middle of the canvas. The canvas shows only about 670 × 530 image
 *  pixels at 100%, so a test has to keep everything it touches inside that window (the default window is x 363–1037, y 235–765). */
export async function setup(page: Page, zoom = 1, at = { x: 700, y: 500 }) {
  await openApp(page);
  await uploadPng(page, pageWithCard());
  await zoomTo(page, zoom, at.x, at.y);
}

/** the stored description of the (first) vector layer */
export const vector = async (page: Page) => (await editor(page)).layers.find((l) => l.content)!;

/** switch the fill on and give it a colour, in the drawing settings (a shape tool must be active) */
export async function useFill(page: Page, hex: string) {
  await page.getByTestId("draw-fill-none").uncheck();
  await setColorInput(page, "draw-fill", hex);
}

/** click empty canvas (selects nothing), so no handles or outlines cover the edges of what is being looked at */
export async function deselect(page: Page) {
  // with the select tool: a click on empty canvas deselects, whereas with the brush it would paint a dot
  await page.getByRole("button", { name: "선택", exact: true }).click();
  const box = (await page.getByTestId("viewport").boundingBox())!;
  await page.mouse.click(box.x + 12, box.y + 12); // the empty top-left corner of the canvas, left of any control
}
