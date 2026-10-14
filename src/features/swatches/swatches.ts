import { useSyncExternalStore } from "react";
import { normalizeHex } from "@/lib/image/color";

/* Colour swatches: a short palette the user keeps. A setting of this browser (localStorage `slc-swatches`), never part of a project file. */

export const SWATCHES_KEY = "slc-swatches";
export const MAX_SWATCHES = 32;
export const DEFAULT_SWATCHES = ["#000000", "#ffffff", "#e5322d", "#f59e0b", "#16a34a", "#2563eb", "#7c3aed"];
type Storage_ = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** the saved text as a list: only valid colours, no repeats, at most MAX_SWATCHES; anything else gives the defaults */
export function parseSwatches(text: string | null): string[] {
  if (!text) return [...DEFAULT_SWATCHES];
  try {
    const doc = JSON.parse(text) as { format?: unknown; colors?: unknown };
    if (doc.format !== 1 || !Array.isArray(doc.colors)) return [...DEFAULT_SWATCHES];
    const out: string[] = [];
    for (const c of doc.colors) {
      const hex = typeof c === "string" ? normalizeHex(c) : null;
      if (hex && !out.includes(hex) && out.length < MAX_SWATCHES) out.push(hex);
    }
    return out;
  } catch {
    return [...DEFAULT_SWATCHES];
  }
}

export function createSwatchStore(storage: Storage_ | null = typeof window === "undefined" ? null : safe()) {
  const read = () => {
    try {
      return parseSwatches(storage?.getItem(SWATCHES_KEY) ?? null);
    } catch {
      return [...DEFAULT_SWATCHES];
    }
  };
  let list = read();
  const listeners = new Set<() => void>();
  const save = () => {
    try {
      storage?.setItem(SWATCHES_KEY, JSON.stringify({ format: 1, colors: list }));
    } catch {
      /* not remembered; it still works for this page */
    }
    listeners.forEach((l) => l());
  };
  return {
    get: () => list,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    /** adds a colour (the end of the list); false when it is not a colour, already there, or the palette is full */
    add(color: string): boolean {
      const hex = normalizeHex(color);
      if (!hex || list.includes(hex) || list.length >= MAX_SWATCHES) return false;
      list = [...list, hex];
      save();
      return true;
    },
    remove(color: string) {
      const hex = normalizeHex(color);
      if (!hex || !list.includes(hex)) return;
      list = list.filter((c) => c !== hex);
      save();
    },
    reset() {
      list = [...DEFAULT_SWATCHES];
      try {
        storage?.removeItem(SWATCHES_KEY);
      } catch {
        /* nothing stored */
      }
      listeners.forEach((l) => l());
    },
  };
}
function safe(): Storage_ | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
export const swatchStore = createSwatchStore();
export const useSwatches = () => useSyncExternalStore(swatchStore.subscribe, swatchStore.get, () => DEFAULT_SWATCHES);