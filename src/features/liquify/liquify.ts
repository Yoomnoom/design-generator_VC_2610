import { bitmapMapper, FingerStroke } from "@/features/smudge/finger";
import { LiquifyMode, createLiquify } from "@/lib/image/liquify";
import { RawImage } from "@/lib/image/raw-image";
import { BitmapLayer } from "@/lib/project/schema";
import { EditorStoreApi, LiquifyStyle, selectScreen } from "@/store/editor-store";

/** why liquify cannot work on this layer (in words for the user), or null when it can */
export function liquifyTargetProblem(layer: BitmapLayer | undefined, hasPicture: boolean): string | null {
  if (!layer) return "유동화는 이미지 레이어를 하나 선택한 뒤 쓸 수 있습니다. 원본 스크린샷과 도형·텍스트·메모는 바꿀 수 없습니다.";
  if (layer.content || !layer.imageId || !hasPicture) return "유동화는 이미지(비트맵) 레이어에만 쓸 수 있습니다. 도형·텍스트 레이어는 대상이 아닙니다.";
  if (layer.warp) return "변형(warp)한 레이어에는 유동화를 쓸 수 없습니다. 속성 패널의 '변형 초기화'를 먼저 누르세요.";
  if (layer.locked) return "잠긴 레이어는 유동화할 수 없습니다. 잠금을 풀어 주세요.";
  if (!layer.visible) return "숨긴 레이어는 유동화할 수 없습니다. 먼저 보이게 해 주세요.";
  return null;
}

export const LIQUIFY_MODE_LABEL: Record<LiquifyMode, string> = { push: "밀기", bloat: "부풀리기", pucker: "오므리기", restore: "복원" };

/** Begins a liquify stroke on a layer, or says why not. Like the finger stroke it works on a copy of the bitmap (the preview reads it) and
 *  finish() hands the copy to the store, which gives it a new imageId (ONE undo step; the history holds ids, never pixels). The picture
 *  the layer had when the tool first touched it is kept as the reference that "restore" blends back toward. */
export function startLiquifyStroke(store: EditorStoreApi, layerId: string): { ok: true; stroke: FingerStroke } | { ok: false; reason: string | null } {
  const state = store.getState();
  if (state.compareMode !== "off") return { ok: false, reason: null };
  const layer = selectScreen(state)?.layers.find((l) => l.id === layerId);
  const picture = layer?.imageId ? state.images.get(layer.imageId)?.raw : undefined;
  const problem = liquifyTargetProblem(layer, !!picture);
  if (problem || !layer || !picture) return { ok: false, reason: problem };
  let base = state.liquifyBase;
  if (!base || base.layerId !== layerId || base.raw.width !== picture.width || base.raw.height !== picture.height) {
    base = { layerId, raw: picture }; // the picture itself (immutable), not a copy: nothing is duplicated for it
    state.setLiquifyBase(base);
  }
  const raw: RawImage = { width: picture.width, height: picture.height, data: new Uint8ClampedArray(picture.data) };
  const source: RawImage = { width: picture.width, height: picture.height, data: new Uint8ClampedArray(picture.data) };
  const map = bitmapMapper(layer, picture);
  const style: LiquifyStyle = state.liquifyStyle;
  const lq = createLiquify(raw, source, base.raw, { mode: style.mode, size: style.size, strength: style.strength / 100, hardness: 1 - style.softness / 100 });
  let written = false;
  return {
    ok: true,
    stroke: {
      layerId,
      raw,
      move(frame) {
        const p = map(frame);
        if (!p) return null;
        const box = lq.add(p);
        if (box) written = true;
        return box;
      },
      finish() {
        if (!written) return false;
        return store.getState().commitSmudge(layerId, raw, "유동화");
      },
    },
  };
}