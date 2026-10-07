import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { expectPixel, CARD, CARD2, PAGE, dragImageRect, dragLayerBy, editor, idbKeys, openApp, openProjectFile, pageWithTwoCards, panelNames, pickTool, pixelAt, readPngSize, saveProjectFile, uploadPng, zoomTo } from "./helpers";

/* Handoff v0.2, "E2E 테스트", steps 1–9, in order, in one session. The page is reloaded between 8 and 9. */

const GRAY = [240, 240, 240, 255];
const BLUE = [0, 0, 255, 255];
const GREEN = [0, 160, 0, 255];
const rgbaOf = (page: Parameters<typeof pixelAt>[0], x: number, y: number) => pixelAt(page, x, y);

test("handoff v0.2 E2E, steps 1–9", async ({ page }) => {
  let savedText = "";
  let savedView: { zoom: number; panX: number; panY: number };

  await test.step("1. 테스트 이미지를 업로드하고 화면 라벨이 원본 크기와 일치하는지 확인", async () => {
    await openApp(page);
    await uploadPng(page, pageWithTwoCards());
    await expect(page.getByTestId("screen-label")).toContainText(`${PAGE.width} × ${PAGE.height} px`);
    expect((await editor(page)).screen).toMatchObject({ width: PAGE.width, height: PAGE.height });
  });

  await test.step("2. 지정 좌표로 영역 선택", async () => {
    await zoomTo(page, 1, 600, 300);
    await pickTool(page, "영역 추출");
    await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height }, { release: false });
    await expect(page.getByTestId("marquee-tag")).toHaveText(`선택 영역 ${CARD.width} × ${CARD.height} px`);
    await page.mouse.up();
  });

  await test.step("3. 새 레이어 생성 확인", async () => {
    const s = await editor(page);
    expect(s.layers).toHaveLength(1);
    expect(s.layers[0].crop).toEqual(CARD);
    await expect(page.getByTestId("layer-item")).toHaveCount(1);
    expect(await panelNames(page)).toEqual(["레이어 1"]);
    await expect(page.getByTestId("prop-width")).toHaveText(String(CARD.width)); // layer size = selection size
    await expect(page.getByTestId("prop-height")).toHaveText(String(CARD.height));
  });

  await test.step("4. 200% 확대 상태에서 영역 선택 후 원본 픽셀 위치 확인", async () => {
    await zoomTo(page, 2, CARD2.x + CARD2.width / 2, CARD2.y + CARD2.height / 2);
    expect((await editor(page)).view.zoom).toBe(2);
    await pickTool(page, "영역 추출");
    await dragImageRect(page, { x: CARD2.x, y: CARD2.y }, { x: CARD2.x + CARD2.width, y: CARD2.y + CARD2.height });
    const s = await editor(page);
    expect(s.layers).toHaveLength(2);
    expect(s.layers[1].crop).toEqual(CARD2); // original pixel position, untouched by the 200% zoom
    expect(s.layers[1].transform).toMatchObject({ x: CARD2.x, y: CARD2.y });
  });

  await test.step("5. 레이어 이동", async () => {
    await zoomTo(page, 1, 600, 300);
    await pickTool(page, "선택");
    await dragLayerBy(page, { x: CARD2.x + 100, y: CARD2.y + 50 }, -380, 60); // the green card half over the blue one, sticking out below it
    const s = await editor(page);
    expect(s.layers[1].transform).toMatchObject({ x: CARD2.x - 380, y: CARD2.y + 60 }); // (320, 260)
    expect(s.layers[0].transform).toMatchObject({ x: CARD.x, y: CARD.y });
    await expectPixel(page, 400, 290, GREEN); // the later layer is in front
    await page.getByRole("button", { name: "뒤로" }).click(); // send green behind blue, so the saved order is not just the default
    await expectPixel(page, 400, 290, BLUE);
    expect(await panelNames(page)).toEqual(["레이어 1", "레이어 2"]);
  });

  await test.step("6. 원본 위치의 배경 패치 확인", async () => {
    const s = await editor(page);
    expect(s.patches).toHaveLength(2);
    expect(s.patches.map((p) => p.rect)).toEqual([CARD, CARD2]);
    expect(s.patches.every((p) => p.fill === "#f0f0f0")).toBe(true);
    await expectPixel(page, CARD2.x + 100, CARD2.y + 50, GRAY); // where the green card used to be, on screen
  });

  await test.step("7. PNG 다운로드 실행, 결과 크기가 원본과 일치하는지 확인", async () => {
    await page.getByRole("button", { name: "PNG 내보내기" }).click();
    await expect(page.getByTestId("export-size")).toContainText(`${PAGE.width} × ${PAGE.height} px`);
    const download = page.waitForEvent("download");
    await page.getByTestId("export-save").click();
    const png = fs.readFileSync(await (await download).path());
    expect(readPngSize(png)).toMatchObject({ width: PAGE.width, height: PAGE.height });
    await page.getByRole("button", { name: "닫기" }).click();
  });

  await test.step("8. 프로젝트 저장 후 재로딩", async () => {
    savedView = (await editor(page)).view;
    savedText = await saveProjectFile(page);
    const file = JSON.parse(savedText);
    expect(file.format).toBe("screenshot-layer-canvas");
    expect(file.project.screens).toHaveLength(1);
    expect(savedText).not.toMatch(/blob:/); // no Blob URL in the file
    expect(Object.keys(file.images)).toHaveLength(3); // the capture + two layer bitmaps

    await page.reload(); // everything in memory is gone
    await expect(page.getByRole("heading", { name: "화면 캡처를 올려주세요" })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__slc.getState().history)).toBeNull();

    await openProjectFile(page, savedText);
    await expect(page.getByTestId("screen-label")).toContainText(`${PAGE.width} × ${PAGE.height} px`);
  });

  await test.step("9. 위치와 레이어 순서 복원 확인", async () => {
    const s = await editor(page);
    expect(s.layers.map((l) => [l.name, l.transform.x, l.transform.y]).sort()).toEqual([["레이어 1", CARD.x, CARD.y], ["레이어 2", CARD2.x - 380, CARD2.y + 60]]);
    expect(s.layers.find((l) => l.name === "레이어 1")!.zIndex).toBeGreaterThan(s.layers.find((l) => l.name === "레이어 2")!.zIndex); // blue still in front
    expect(await panelNames(page)).toEqual(["레이어 1", "레이어 2"]);
    expect(s.patches).toHaveLength(2);
    expect(s.past).toBe(0); // a freshly opened project starts with empty history
    expect(s.view).toEqual(savedView); // and the view it was saved with, not a re-fit

    await expectPixel(page, 400, 290, BLUE); // drawn from the restored bitmaps, in the restored order
    await expectPixel(page, CARD2.x + 100, CARD2.y + 50, GRAY);
    await expectPixel(page, 500, 310, BLUE); // inside the blue card
    await expectPixel(page, 400, 340, GREEN); // the green card's part that sticks out below the blue one
  });
});
