import { RawImage } from "./raw-image";

/** Turns pixels into an image file and back. The editor logic only sees this interface,
 *  so it runs under Node with a stand-in; the real one needs a browser (see canvas-codec.ts). */
export interface ImageCodec {
  encode(raw: RawImage): Promise<Blob>; // PNG, alpha kept
  decode(blob: Blob): Promise<RawImage>;
}
