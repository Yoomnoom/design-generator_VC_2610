import type { Patch } from "immer";
import { BitmapLayer, Project } from "@/lib/project/schema";
import { History, HistoryEntry } from "./history";
import { ImageCache } from "./images";

/* Which pictures the editor still needs, and how many bytes of old ones it may keep.
 *
 * The undo history holds no pixels: a step that replaced a layer's picture only names the picture's imageId (in its patches). So the
 * pictures an undo or redo can bring back are found by reading those ids. Anything named by nothing is freed; and when the pictures that
 * are no longer on screen (kept only for undo and redo) take more than a budget, the oldest undo steps are dropped until they fit. */

/** every string stored under an `imageId` or `originalImageId` key, at any depth (a removed layer's patch holds the whole layer) */
export function collectImageIds(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) for (const v of value) collectImageIds(v, into);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if ((k === "imageId" || k === "originalImageId") && typeof v === "string") into.add(v);
      else collectImageIds(v, into);
    }
  }
  return into;
}

const perEntry = new WeakMap<HistoryEntry, ReadonlySet<string>>();
/** the ids a patch names: a replaced `…/imageId` (the value is the id itself), or a whole layer or screen added or removed (the id is inside it) */
function collectFromPatches(patches: readonly Patch[], into: Set<string>) {
  for (const p of patches) {
    const last = p.path[p.path.length - 1];
    if ((last === "imageId" || last === "originalImageId") && typeof p.value === "string") into.add(p.value);
    else collectImageIds(p.value, into);
  }
}

const idsOfEntry = (e: HistoryEntry): ReadonlySet<string> => {
  let ids = perEntry.get(e);
  if (!ids) {
    const found = new Set<string>();
    collectFromPatches(e.patches, found);
    collectFromPatches(e.inverse, found);
    perEntry.set(e, (ids = found));
  }
  return ids;
};

export const projectImageIds = (p: Project): Set<string> => collectImageIds(p);

const bytesOf = (images: ImageCache, id: string) => images.get(id)?.raw.data.byteLength ?? 0;

/** Frees the pictures nothing refers to, then drops the oldest undo steps while the replaced pictures exceed `budget` bytes (the latest
 *  step always stays, so the last stroke can be undone however large the layer). `clipboard` is a copied layer, which still needs its picture. */
export function trimImageVersions(history: History<Project>, images: ImageCache, clipboard: { layer: BitmapLayer } | null, budget: number): { history: History<Project>; images: ImageCache } {
  let h = history;
  let kept = images;
  for (;;) {
    const present = projectImageIds(h.present);
    const needed = new Set(present);
    for (const e of h.past) for (const id of idsOfEntry(e)) needed.add(id);
    for (const e of h.future) for (const id of idsOfEntry(e)) needed.add(id);
    if (clipboard?.layer.imageId) needed.add(clipboard.layer.imageId);
    const gone = [...kept.keys()].filter((id) => !needed.has(id));
    if (gone.length > 0) {
      const next = new Map(kept);
      for (const id of gone) next.delete(id);
      kept = next;
    }
    let replaced = 0;
    for (const id of needed) if (!present.has(id)) replaced += bytesOf(kept, id);
    if (replaced <= budget || h.past.length <= 1) return { history: h, images: kept };
    h = { ...h, past: h.past.slice(1) };
  }
}