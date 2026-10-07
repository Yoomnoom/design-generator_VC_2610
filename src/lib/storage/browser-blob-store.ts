import { BlobStore, openBlobStore } from "./blob-store";

let opened: Promise<BlobStore> | null = null;

/** the page's one IndexedDB blob store, opened on first use */
export const getBlobStore = () => (opened ??= openBlobStore());
