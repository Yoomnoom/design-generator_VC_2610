import { ImageCodec } from "@/lib/image/codec";
import { parseProjectValue } from "@/lib/project/parse";
import { Project } from "@/lib/project/schema";
import { base64ToBlob, blobToBase64 } from "@/lib/storage/base64";
import { BlobStore } from "@/lib/storage/blob-store";
import { ImageCache, RuntimeImage } from "@/store/images";
import { referencedImageIds } from "./sync-images";

/* The file a user saves: the project JSON plus every image it references, as base64 data.
 * The project part holds imageIds only; no Blob URL is ever written. */

export const FILE_FORMAT = "screenshot-layer-canvas";

export type ProjectFileImage = { mime: string; data: string };
export type ProjectFile = { format: typeof FILE_FORMAT; project: Project; images: Record<string, ProjectFileImage> };

/** reads every referenced blob out of the store; the caller syncs images into it first */
export async function buildProjectFile(project: Project, blobs: BlobStore): Promise<ProjectFile> {
  const images: Record<string, ProjectFileImage> = {};
  for (const id of referencedImageIds(project)) {
    const blob = await blobs.get(id);
    if (!blob) throw new Error(`image ${id} is missing from the blob store`);
    images[id] = { mime: blob.type || "application/octet-stream", data: await blobToBase64(blob) };
  }
  return { format: FILE_FORMAT, project, images };
}

export const serializeProjectFile = (file: ProjectFile) => JSON.stringify(file);

export type ParseFileResult = { ok: true; file: ProjectFile } | { ok: false; error: string };

export function parseProjectFile(text: string): ParseFileResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "JSON을 읽을 수 없습니다" };
  }
  if (typeof raw !== "object" || raw === null || (raw as { format?: unknown }).format !== FILE_FORMAT) return { ok: false, error: "프로젝트 파일이 아닙니다" };
  const { project: rawProject, images } = raw as { project: unknown; images: unknown };

  const parsed = parseProjectValue(rawProject);
  if (!parsed.ok) return parsed;
  if (typeof images !== "object" || images === null || Array.isArray(images)) return { ok: false, error: "images가 올바르지 않습니다" };

  const table = images as Record<string, unknown>;
  const kept: Record<string, ProjectFileImage> = {};
  for (const id of referencedImageIds(parsed.project)) {
    const entry = table[id] as Partial<ProjectFileImage> | undefined;
    if (!entry) return { ok: false, error: `이미지 ${id}가 파일에 없습니다` };
    if (typeof entry.mime !== "string" || typeof entry.data !== "string") return { ok: false, error: `이미지 ${id}의 형식이 올바르지 않습니다` };
    kept[id] = { mime: entry.mime, data: entry.data };
  }
  return { ok: true, file: { format: FILE_FORMAT, project: parsed.project, images: kept } };
}

/** Puts the file's images into the blob store (replacing what was there) and decodes them for editing. */
export async function restoreProjectFile(file: ProjectFile, blobs: BlobStore, codec: ImageCodec): Promise<{ project: Project; images: ImageCache }> {
  const decoded = new Map<string, RuntimeImage>();
  const stored = new Map<string, Blob>();
  for (const [id, { mime, data }] of Object.entries(file.images)) {
    const blob = base64ToBlob(data, mime);
    decoded.set(id, { raw: await codec.decode(blob) }); // decode first: a corrupt image fails before the store is touched
    stored.set(id, blob);
  }
  await blobs.clear();
  for (const [id, blob] of stored) await blobs.put(id, blob);
  return { project: file.project, images: decoded };
}
