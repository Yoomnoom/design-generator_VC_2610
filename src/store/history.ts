import { Draft, Patch, applyPatches, enablePatches, produceWithPatches } from "immer";

enablePatches();

/* Undo/redo as state differences: every entry holds JSON patches, never pixels.
 * Images live elsewhere and are referenced by imageId, so an entry is a few hundred bytes. */

export const HISTORY_LIMIT = 100; // requirement is 50+

export type HistoryEntry = { label: string; patches: Patch[]; inverse: Patch[] };
export type History<T extends object> = { present: T; past: HistoryEntry[]; future: HistoryEntry[] };

export const createHistory = <T extends object>(present: T): History<T> => ({ present, past: [], future: [] });

/** Applies `recipe` as one undo step. A recipe that changes nothing records nothing. */
export function commit<T extends object>(h: History<T>, label: string, recipe: (draft: Draft<T>) => void, limit = HISTORY_LIMIT): History<T> {
  const [present, patches, inverse] = produceWithPatches(h.present, recipe);
  if (patches.length === 0) return h;
  return { present, past: [...h.past, { label, patches, inverse }].slice(-limit), future: [] };
}

export function undo<T extends object>(h: History<T>): History<T> {
  const entry = h.past[h.past.length - 1];
  if (!entry) return h;
  return { present: applyPatches(h.present, entry.inverse) as T, past: h.past.slice(0, -1), future: [entry, ...h.future] };
}

export function redo<T extends object>(h: History<T>): History<T> {
  const [entry, ...rest] = h.future;
  if (!entry) return h;
  return { present: applyPatches(h.present, entry.patches) as T, past: [...h.past, entry], future: rest };
}

export const canUndo = <T extends object>(h: History<T>) => h.past.length > 0;
export const canRedo = <T extends object>(h: History<T>) => h.future.length > 0;
