"use client";

import { canvasCodec } from "@/lib/image/canvas-codec";
import { openAutosaveStore } from "@/lib/storage/autosave-store";
import { openBlobStore } from "@/lib/storage/blob-store";
import { getSwitchableBlobStore } from "@/lib/storage/browser-blob-store";
import { editorStore } from "@/store/use-editor-store";
import { Autosave, LockManagerLike, createAutosave } from "./autosave";

let controller: Autosave | null = null;

/** the page's one autosave */
export const getAutosave = () =>
  (controller ??= createAutosave({
    editor: editorStore,
    blobs: getSwitchableBlobStore(),
    openIdbBlobs: () => openBlobStore(),
    openRecords: () => openAutosaveStore(),
    codec: canvasCodec,
    locks: typeof navigator !== "undefined" && navigator.locks ? (navigator.locks as unknown as LockManagerLike) : null,
    notify: (message) => editorStore.getState().setNotice(message),
  }));
