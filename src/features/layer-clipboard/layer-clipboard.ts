import { ImageCodec } from "@/lib/image/codec";
import { hashPixels } from "@/lib/image/hash";
import { Rasterize, rasterizeContentAlone, rasterizeVectorLayer } from "@/lib/image/vector-raster";
import { EditorStoreApi } from "@/store/editor-store";

/* Copying a layer puts its bitmap on the system clipboard as a PNG, and the app remembers the layer together with a hash of
 * that picture. When Ctrl+V brings a picture back, a matching hash means "this is the layer I copied" and it is pasted as a layer;
 * anything else is a different picture and is loaded as a new image. Without a picture on the clipboard nothing is pasted. */

export type CopyResult = { ok: true } | { ok: false; reason: string };

/** puts a PNG on the system clipboard; throws if the browser will not */
export type ClipboardWriter = (png: Blob) => Promise<void>;

/** The user-facing reason a clipboard write failed. Never empty: a failed copy must say why. */
export function describeClipboardFailure(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  const message = (error as { message?: string } | null)?.message;
  if (name === "NotAllowedError" || name === "SecurityError") return "브라우저가 클립보드 쓰기를 허용하지 않았습니다. 주소창의 사이트 설정에서 클립보드 권한을 허용한 뒤 다시 복사해 주세요.";
  if (name === "NoClipboardApi") return "이 환경에서는 클립보드를 쓸 수 없습니다. 보안 연결(https 또는 localhost)에서 열어 주세요.";
  if (name === "NoImageClipboard") return "이 브라우저는 이미지를 클립보드에 복사하는 기능을 지원하지 않습니다.";
  return message ? `원인: ${message}` : "원인을 알 수 없습니다.";
}

/** the real writer: the async Clipboard API with an image/png item */
export const writePngToSystemClipboard: ClipboardWriter = async (png) => {
  if (typeof navigator === "undefined" || !navigator.clipboard?.write) throw Object.assign(new Error("clipboard API unavailable"), { name: "NoClipboardApi" });
  if (typeof ClipboardItem === "undefined") throw Object.assign(new Error("ClipboardItem unavailable"), { name: "NoImageClipboard" });
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
};

/** Copies a layer: PNG to the system clipboard, then remembers the layer and the picture's hash. On failure nothing is remembered,
 *  because a paste without a matching picture on the clipboard would do nothing anyway. */
export async function copyLayerToClipboard(args: { layerId: string; store: EditorStoreApi; codec: ImageCodec; write: ClipboardWriter; rasterize?: Rasterize }): Promise<CopyResult> {
  const { layerId, store, codec, write, rasterize = rasterizeVectorLayer } = args;
  const state = store.getState();
  const layer = state.history?.present.screens[0].layers.find((l) => l.id === layerId);
  // a vector layer has no bitmap: its picture is drawn for the clipboard (the layer itself stays a description)
  const raw = layer?.content ? (rasterizeContentAlone(layer.content, rasterize) ?? undefined) : layer?.imageId ? state.images.get(layer.imageId)?.raw : undefined;
  if (!layer || !raw) return { ok: false, reason: "레이어를 복사하지 못했습니다. 복사할 레이어를 찾을 수 없습니다." };
  try {
    const png = await codec.encode(raw);
    const hash = await hashPixels(await codec.decode(png)); // through the same decoder a paste uses, so the two hashes are comparable
    await write(png);
    // the layer may have been deleted while the browser was asking for permission: copyLayer then refuses
    if (!store.getState().copyLayer(layerId, hash)) return { ok: false, reason: "레이어를 복사하지 못했습니다. 복사하는 동안 레이어가 사라졌습니다." };
    return { ok: true };
  } catch (error) {
    store.getState().clearLayerClipboard();
    return { ok: false, reason: `레이어를 복사하지 못했습니다. ${describeClipboardFailure(error)}` };
  }
}

export type PasteDecision = "layer" | "image" | "nothing";

/** What a Ctrl+V should do, given the picture it brought (null when the clipboard held none). */
export async function decidePaste(args: { file: File | null; store: EditorStoreApi; codec: ImageCodec }): Promise<PasteDecision> {
  const { file, store, codec } = args;
  if (!file) return "nothing"; // no picture: nothing is pasted, even if a layer was copied inside the app
  const copied = store.getState().layerClipboard;
  if (!copied?.hash) return "image";
  try {
    return (await hashPixels(await codec.decode(file))) === copied.hash ? "layer" : "image";
  } catch {
    return "image"; // not a picture we can read: the normal import reports it
  }
}
