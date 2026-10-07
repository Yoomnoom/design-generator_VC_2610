"use client";

import { useStore } from "zustand";
import { EditorStore, createEditorStore } from "./editor-store";

/** the one editor in the page */
export const editorStore = createEditorStore();

export const useEditorStore = <T,>(selector: (state: EditorStore) => T): T => useStore(editorStore, selector);

// Lets browser tests reach the store (read the view, check history). Not in a normal production build:
// only a build made with NEXT_PUBLIC_E2E=1 (for running the E2E suite against `next start`) includes it.
if (typeof window !== "undefined" && (process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_E2E === "1")) {
  (window as unknown as { __slc: typeof editorStore }).__slc = editorStore;
}
