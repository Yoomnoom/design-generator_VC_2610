import { RawImage } from "@/lib/image/raw-image";

/** Pixels the editor works with, keyed by imageId. Deliberately outside the undo history:
 *  history entries only ever name an imageId. `blob` is the uploaded file as it came in,
 *  kept until the blob store has it. */
export type RuntimeImage = { raw: RawImage; blob?: Blob };
export type ImageCache = ReadonlyMap<string, RuntimeImage>;
