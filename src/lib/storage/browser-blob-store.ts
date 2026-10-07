import { createMemoryBlobStore, createSwitchableBlobStore, SwitchableBlobStore } from "./blob-store";

let store: SwitchableBlobStore | null = null;

/** The page's one blob store. It starts in memory and is switched to IndexedDB only when this tab becomes the one allowed to
 *  write there (see features/autosave): a tab that is not the owner never touches the shared database. */
export const getSwitchableBlobStore = () => (store ??= createSwitchableBlobStore(createMemoryBlobStore()));

export const getBlobStore = async () => getSwitchableBlobStore();
