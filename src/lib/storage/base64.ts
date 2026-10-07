const CHUNK = 0x8000; // keeps String.fromCharCode's argument list small

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const blobToBase64 = async (blob: Blob) => bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
export const base64ToBlob = (base64: string, mime: string) => new Blob([base64ToBytes(base64)], { type: mime });
