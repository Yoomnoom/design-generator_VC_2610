import { frameToLayerPoint } from "@/lib/geometry/layer-transform";
import { IRect, Pt } from "@/lib/image/brush-raster";
import { RawImage } from "@/lib/image/raw-image";
import { Smudge, SmudgeOptions, createSmudge } from "@/lib/image/smudge";
import { effectiveWarp, warpInverse } from "@/lib/image/warp";
import { BitmapLayer } from "@/lib/project/schema";
import { EditorStoreApi, FingerStyle, selectScreen } from "@/store/editor-store";

/** why the finger tool cannot work on this layer (in words for the user), or null when it can */
export function fingerTargetProblem(layer: BitmapLayer | undefined, hasPicture: boolean): string | null {
  if (!layer) return "손가락 도구는 이미지 레이어를 선택한 뒤 쓸 수 있습니다. 원본 스크린샷은 바꿀 수 없습니다.";
  if (layer.content || !layer.imageId || !hasPicture) return "손가락 도구는 이미지(비트맵) 레이어에만 쓸 수 있습니다. 도형·텍스트 레이어는 대상이 아닙니다.";
  if (layer.locked) return "잠긴 레이어는 번지게 할 수 없습니다. 잠금을 풀어 주세요.";
  if (!layer.visible) return "숨긴 레이어는 번지게 할 수 없습니다. 먼저 보이게 해 주세요.";
  return null;
}

/** The map from a point of the frame (original-image pixels) to the point of the layer's own bitmap under it, through the layer's position,
 *  rotation, scale and warp: the pointer lands on the bitmap pixel it is over however the layer is placed. Null when the point is not over
 *  the layer's warped shape. A warped layer sits on a whole pixel (as it does when drawn). */
export function bitmapMapper(layer: BitmapLayer, size: { width: number; height: number }): (frame: Pt) => Pt | null {
  const warp = effectiveWarp(layer.warp, size.width, size.height);
  const t = warp ? { ...layer.transform, x: Math.round(layer.transform.x), y: Math.round(layer.transform.y) } : layer.transform;
  if (!warp) return (p) => frameToLayerPoint(t, p);
  const inv = warpInverse(warp, size.width, size.height);
  const out = { u: 0, v: 0 };
  return (p) => {
    const q = frameToLayerPoint(t, p);
    return inv.contains(q.x, q.y) && inv.solve(q.x, q.y, out) ? { x: out.u, y: out.v } : null;
  };
}

export type FingerStroke = {
  layerId: string;
  /** the working copy the stroke paints on; the layer's own bitmap is untouched until finish() */
  raw: RawImage;
  /** the stroke moves on to this point of the frame; the box of pixels this move changed (null: none), for repainting a preview */
  move(frame: Pt): IRect | null;
  /** keeps the result as one undo step, or does nothing when the stroke changed no pixel; true when something was kept */
  finish(): boolean;
};

export const smudgeOptions = (style: FingerStyle): SmudgeOptions => ({ size: style.size, strength: style.strength / 100, hardness: 1 - style.softness / 100 });

/** Begins a stroke on a layer, or says why it cannot. The stroke works on a copy of the bitmap (a live preview reads it); finish() hands
 *  the copy to the store, which gives it a new imageId. Nothing is recorded before that, so a stroke that never moves leaves no trace. */
export function startFingerStroke(store: EditorStoreApi, layerId: string): { ok: true; stroke: FingerStroke } | { ok: false; reason: string | null } {
  const state = store.getState();
  if (state.compareMode !== "off") return { ok: false, reason: null }; // nothing can be edited while comparing
  const layer = selectScreen(state)?.layers.find((l) => l.id === layerId);
  const source = layer?.imageId ? state.images.get(layer.imageId)?.raw : undefined;
  const problem = fingerTargetProblem(layer, !!source);
  if (problem || !layer || !source) return { ok: false, reason: problem };
  const raw: RawImage = { width: source.width, height: source.height, data: new Uint8ClampedArray(source.data) };
  const map = bitmapMapper(layer, source);
  const smudge: Smudge = createSmudge(raw, smudgeOptions(state.fingerStyle));
  let written = false;
  return {
    ok: true,
    stroke: {
      layerId,
      raw,
      move(frame) {
        const p = map(frame);
        if (!p) return null; // off the layer's shape: this point is skipped, the stroke goes on from the next
        const box = smudge.add(p);
        if (box) written = true;
        return box;
      },
      finish() {
        if (!written) return false;
        return store.getState().commitSmudge(layerId, raw);
      },
    },
  };
}