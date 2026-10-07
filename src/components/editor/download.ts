export const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, "_").trim() || "mockup";

/** Hands a Blob to the browser as a file download. The temporary URL exists only for the click; it is never stored. */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
