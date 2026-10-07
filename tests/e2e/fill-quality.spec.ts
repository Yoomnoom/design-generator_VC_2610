import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { dragImageRect, editor, openApp, pickTool, upload, zoomTo } from "./helpers";

/* The same real-looking capture as the sampling unit tests, driven through the app. */
const png = fs.readFileSync("tests/fixtures/realistic-capture.png");
const R = JSON.parse(fs.readFileSync("tests/fixtures/realistic-capture.rects.json", "utf8")) as Record<string, { x: number; y: number; width: number; height: number }>;
const grow = (r: { x: number; y: number; width: number; height: number }, b: number) => ({ x: r.x - b, y: r.y - b, width: r.width + 2 * b, height: r.height + 2 * b });

async function open(page: Parameters<typeof openApp>[0], zoom: number, centre: { x: number; y: number }) {
  await openApp(page);
  await upload(page, { name: "realistic.png", mimeType: "image/png", buffer: png });
  await expect(page.getByTestId("screen-label")).toContainText("960 × 600");
  await zoomTo(page, zoom, centre.x, centre.y);
  await pickTool(page, "영역 추출");
}
const select = (page: Parameters<typeof openApp>[0], r: { x: number; y: number; width: number; height: number }) => dragImageRect(page, { x: r.x, y: r.y }, { x: r.x + r.width, y: r.y + r.height });
const close = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }, tol = 2) =>
  expect([a.x, a.y, a.width, a.height].map((v, i) => Math.abs(v - [b.x, b.y, b.width, b.height][i])).every((d) => d <= tol)).toBe(true);

test("a card cut out exactly: asks, and the picker starts from the page behind the shadow", async ({ page }) => {
  await open(page, 1, { x: R.card0.x + 120, y: R.card0.y + 110 });
  await select(page, R.card0);
  await expect(page.getByRole("dialog", { name: "배경색을 골라주세요" })).toBeVisible();
  await expect(page.getByTestId("fill-hex")).toHaveText("#e8edfb"); // Phase 1 offered the shadow-tinted #daddee
  expect(await editor(page)).toMatchObject({ layers: [], patches: [], past: 0 });
});

test("the header: used to fill itself with a grey band, now asks", async ({ page }) => {
  await open(page, 0.68, { x: 480, y: 300 });
  await select(page, R.header);
  await expect(page.getByRole("dialog", { name: "배경색을 골라주세요" })).toBeVisible();
  const s = await editor(page);
  expect(s.patches).toHaveLength(0);
  await page.getByRole("dialog").getByRole("button", { name: /취소/ }).click();
  expect(await editor(page)).toMatchObject({ layers: [], patches: [], past: 0 });
});

test("a card cut out with a margin for its shadow still fills automatically", async ({ page }) => {
  await open(page, 1, { x: R.card0.x + 120, y: R.card0.y + 110 });
  await select(page, grow(R.card0, 40));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const s = await editor(page);
  expect(s.layers).toHaveLength(1);
  expect(s.patches[0].fill).toBe("#e6eafa");
  close(s.patches[0].rect, grow(R.card0, 40));
});

test("a button inside a card fills with the card's white, with no question", async ({ page }) => {
  await open(page, 1, { x: R.button0.x + 48, y: R.button0.y + 15 });
  await select(page, R.button0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await editor(page)).patches[0].fill).toBe("#ffffff");
});
