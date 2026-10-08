import { Memo } from "../project/schema";
import { RawImage } from "./raw-image";
import { BALLOON_FONT_SIZE, compositeOver, drawMemo, layoutMemo } from "./memo-draw";
import { canvasMeasureFor } from "./text-measure";
import { DrawCtx } from "./vector";

/** The memos laid onto a picture (which is changed and returned). Each memo is drawn on a small canvas of its own and composited, so a
 *  huge capture is never copied whole. Browser only (needs OffscreenCanvas). */
export type MemoOverlay = (image: RawImage, memos: readonly Memo[]) => RawImage;

export const overlayMemos: MemoOverlay = (image, memos) => {
  const measure = canvasMeasureFor(BALLOON_FONT_SIZE);
  memos.forEach((memo, index) => {
    const layout = layoutMemo(memo, image, measure);
    const { x, y, width, height } = layout.bounds;
    if (width < 1 || height < 1) return;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D canvas is not available");
    drawMemo(ctx as unknown as DrawCtx, memo, index, layout, x, y);
    const { data } = ctx.getImageData(0, 0, width, height);
    compositeOver(image, { width, height, data }, x, y);
  });
  return image;
};
