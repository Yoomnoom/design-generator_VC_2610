type ClipboardLike = {
  files?: ArrayLike<File>;
  items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }>;
};

const isPngOrJpeg = (f: File) => f.type === "image/png" || f.type === "image/jpeg";

/** The image on the clipboard, or null when there is none. A PNG/JPEG wins; any other image type is returned too,
 *  so the normal import path can tell the user it is not supported rather than ignoring the paste silently. */
export function imageFromClipboard(data: ClipboardLike | null): File | null {
  if (!data) return null;
  const found: File[] = Array.from(data.files ?? []).filter((f) => f.type.startsWith("image/"));
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file && !found.includes(file)) found.push(file);
    }
  }
  const file = found.find(isPngOrJpeg) ?? found[0];
  if (!file) return null;
  // a pasted screenshot usually arrives as "image.png"; give an unnamed one a readable name
  return file.name ? file : new File([file], file.type === "image/jpeg" ? "붙여넣은 이미지.jpg" : "붙여넣은 이미지.png", { type: file.type });
}
