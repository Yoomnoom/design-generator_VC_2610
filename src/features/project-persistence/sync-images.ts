import { ImageCodec } from "@/lib/image/codec";
import { Project } from "@/lib/project/schema";
import { BlobStore } from "@/lib/storage/blob-store";
import { ImageCache } from "@/store/images";

/** every imageId the project points at: the source image and each layer bitmap, once each */
export function referencedImageIds(project: Project): string[] {
  const ids = new Set<string>();
  for (const screen of project.screens) {
    ids.add(screen.source.imageId);
    for (const layer of screen.layers) if (layer.imageId) ids.add(layer.imageId);
  }
  return [...ids];
}

/** Writes the blobs the store does not have yet. The uploaded file goes in exactly as it came;
 *  extracted layers are encoded once. Returns the ids it wrote. */
export async function syncImagesToBlobStore(project: Project, images: ImageCache, codec: ImageCodec, blobs: BlobStore): Promise<string[]> {
  const written: string[] = [];
  for (const id of referencedImageIds(project)) {
    if (await blobs.has(id)) continue;
    const image = images.get(id);
    if (!image) throw new Error(`image ${id} is referenced by the project but not loaded`);
    await blobs.put(id, image.blob ?? (await codec.encode(image.raw)));
    written.push(id);
  }
  return written;
}

/** Deletes blobs the project no longer references. Only safe right after a load, when undo history is empty:
 *  while history exists, a deleted layer's bitmap must stay so redo works. */
export async function pruneBlobStore(project: Project, blobs: BlobStore): Promise<string[]> {
  const keep = new Set(referencedImageIds(project));
  const removed = (await blobs.keys()).filter((id) => !keep.has(id));
  for (const id of removed) await blobs.delete(id);
  return removed;
}
