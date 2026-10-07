"use client";

import { useStore } from "zustand";
import { EditorStore, createEditorStore } from "./editor-store";

/** the one editor in the page */
export const editorStore = createEditorStore();

export const useEditorStore = <T,>(selector: (state: EditorStore) => T): T => useStore(editorStore, selector);

// Lets browser tests reach the store (read the view, check history). Never exposed in a production build.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") (window as unknown as { __slc: typeof editorStore }).__slc = editorStore;
