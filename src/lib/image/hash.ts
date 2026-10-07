import { RawImage } from "./raw-image";

/** SHA-256 of an image's size and RGBA pixels, as hex. Two images are "the same picture" when this matches;
 *  the file bytes are not used, since a clipboard may hand a PNG back re-encoded. */
export async function hashPixels(raw: RawImage): Promise<string> {
  const header = new Uint8Array(8);
  new DataView(header.buffer).setUint32(0, raw.width); // width and height are part of the hash: 2×3 and 3×2 hold the same bytes
  new DataView(header.buffer).setUint32(4, raw.height);
  const bytes = new Uint8Array(header.length + raw.data.length);
  bytes.set(header);
  bytes.set(raw.data, header.length);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
