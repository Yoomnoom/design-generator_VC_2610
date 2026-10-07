import { ImageCodec } from "@/lib/image/codec";
import { RawImage } from "@/lib/image/raw-image";

/** longest side accepted; a screenshot beyond this would need over 250MB of pixels in memory */
export const MAX_SIDE = 8192;

export type ImportResult = { ok: true; raw: RawImage } | { ok: false; error: string };

/** PNG or JPEG only; falls back to the extension when the browser reports no type */
export function checkImageFile(file: { name: string; type: string }): string | null {
  const type = file.type.toLowerCase();
  if (type === "image/png" || type === "image/jpeg") return null;
  if (type === "" && /\.(png|jpe?g)$/i.test(file.name)) return null;
  return "PNG 또는 JPG 파일만 올릴 수 있습니다";
}

export function checkImageSize(width: number, height: number): string | null {
  if (width < 1 || height < 1) return "이미지에 픽셀이 없습니다";
  if (width > MAX_SIDE || height > MAX_SIDE) return `이미지가 너무 큽니다 (${width} × ${height}px). 한 변은 ${MAX_SIDE}px 이하여야 합니다`;
  return null;
}

/** Decodes an uploaded file. EXIF rotation is applied by the codec, so the size returned is the size on screen. */
export async function importImage(file: File, codec: ImageCodec): Promise<ImportResult> {
  const fileError = checkImageFile(file);
  if (fileError) return { ok: false, error: fileError };
  let raw: RawImage;
  try {
    raw = await codec.decode(file);
  } catch {
    return { ok: false, error: "이미지를 읽을 수 없습니다. 파일이 손상되었을 수 있습니다" };
  }
  const sizeError = checkImageSize(raw.width, raw.height);
  return sizeError ? { ok: false, error: sizeError } : { ok: true, raw };
}
