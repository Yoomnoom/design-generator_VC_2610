import { RawImage } from "@/lib/image/raw-image";
import { BackgroundPatch, BitmapLayer, Rect, ScreenNode } from "@/lib/project/schema";

/* The original picture (the screen's `source`) as something that can be edited. It is locked by default. Unlocked, the brush, finger,
 * liquify and the colour adjustments work on it like on a bitmap layer: the result is a NEW imageId on `source.imageId` (one undo step, the
 * same memory policy as the finger tool), and the picture that was uploaded stays in `source.originalImageId` so that the comparison view
 * shows the untouched original and "back to the original" can restore it. Never edited = no originalImageId (the original is `imageId`). */

/** the id the original has in the tools: they look a target up by id, and this is the id of the original (never a real layer's id) */
export const SOURCE_LAYER_ID = "__source__";
export const SOURCE_NAME = "배경(원본)";
export const SOURCE_LOCKED_MESSAGE = "잠긴 원본입니다. 잠금을 풀면 수정할 수 있습니다";
export const SOURCE_ERASER_MESSAGE = "지우개는 원본에 쓸 수 없습니다(지우면 원본에 구멍이 생깁니다). 지울 부분은 영역 추출로 레이어를 만든 뒤 그 레이어에서 지우거나, 원본에는 브러시로 덧칠해 주세요.";
export const SOURCE_HOW_TO = "원본은 기본으로 잠겨 있습니다. 레이어 패널의 '배경(원본)' 잠금을 풀고 '배경(원본)'을 선택하면 브러시·손가락·유동화·이미지 조정을 쓸 수 있습니다.";

type SourceOf = ScreenNode["source"];
/** the picture as it was uploaded (the comparison view's "original"): the kept one once the source was edited, else the source itself */
export const pureOriginalId = (source: SourceOf): string => source.originalImageId ?? source.imageId;
export const isSourceEdited = (source: SourceOf): boolean => !!source.originalImageId && source.originalImageId !== source.imageId;
export const isSourceLocked = (source: SourceOf): boolean => !source.unlocked;

/** the original as a stand-in bitmap layer, so the tools that work on a layer's picture (finger, liquify, brush) can take it as a target:
 *  at the frame's origin, no scale, rotation or warp. It is not in `layers` and is never saved. */
export function sourceAsLayer(screen: ScreenNode): BitmapLayer {
  return {
    id: SOURCE_LAYER_ID,
    name: SOURCE_NAME,
    crop: { x: 0, y: 0, width: screen.width, height: screen.height },
    imageId: screen.source.imageId,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    zIndex: 0,
    opacity: 1,
    visible: true,
    locked: isSourceLocked(screen.source),
  };
}

/** the layer with this id, or the original's stand-in for SOURCE_LAYER_ID */
export const targetLayerOf = (screen: ScreenNode | null | undefined, id: string): BitmapLayer | undefined => (!screen ? undefined : id === SOURCE_LAYER_ID ? sourceAsLayer(screen) : screen.layers.find((l) => l.id === id));

/** the patches that are drawn (a hidden patch is kept in the project but neither shown nor exported) */
export const visiblePatches = (patches: readonly BackgroundPatch[]): BackgroundPatch[] => (patches.some((p) => p.hidden) ? patches.filter((p) => !p.hidden) : (patches as BackgroundPatch[]));

/** The smallest box holding every pixel that differs between two pictures of the same size (null: none differ, or the sizes differ). */
export function changedBox(a: RawImage, b: RawImage): Rect | null {
  if (a.width !== b.width || a.height !== b.height) return null;
  const w = a.width, h = a.height;
  const A = new Uint32Array(a.data.buffer, a.data.byteOffset, w * h), B = new Uint32Array(b.data.buffer, b.data.byteOffset, w * h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (A[row + x] !== B[row + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** the drawn patches that lie over any of `box`: an edit there is hidden under them */
export const patchesOver = (patches: readonly BackgroundPatch[], box: Rect | null): BackgroundPatch[] =>
  !box ? [] : visiblePatches(patches).filter((p) => p.rect.x < box.x + box.width && p.rect.x + p.rect.width > box.x && p.rect.y < box.y + box.height && p.rect.y + p.rect.height > box.y);