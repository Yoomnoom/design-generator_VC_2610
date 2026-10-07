import { ImageCodec } from "@/lib/image/codec";
import { Project } from "@/lib/project/schema";
import { BlobStore } from "@/lib/storage/blob-store";
import { ImageCache } from "@/store/images";
import { buildProjectFile, parseProjectFile, restoreProjectFile, serializeProjectFile } from "./project-file";
import { pruneBlobStore, syncImagesToBlobStore } from "./sync-images";

export type ProjectIo = { blobs: BlobStore; codec: ImageCodec };

/** Saving never prunes: while undo history exists, a deleted layer's bitmap must stay so redo can bring it back. */
export async function saveProjectText(project: Project, images: ImageCache, { blobs, codec }: ProjectIo): Promise<string> {
  await syncImagesToBlobStore(project, images, codec, blobs);
  return serializeProjectFile(await buildProjectFile(project, blobs));
}

export type LoadResult = { ok: true; project: Project; images: ImageCache } | { ok: false; error: string };

/** Opens a saved file. Pruning happens here and only here: right after a load the history is empty, so nothing can need an orphan. */
export async function loadProjectText(text: string, { blobs, codec }: ProjectIo): Promise<LoadResult> {
  const parsed = parseProjectFile(text);
  if (!parsed.ok) return parsed;
  try {
    const restored = await restoreProjectFile(parsed.file, blobs, codec);
    await pruneBlobStore(restored.project, blobs);
    return { ok: true, ...restored };
  } catch {
    return { ok: false, error: "프로젝트 파일 안의 이미지를 읽을 수 없습니다" };
  }
}
