import { StoreApi, createStore } from "zustand/vanilla";
import { addOnTop, moveLayer, removeLayer, sortByZ } from "@/features/layer-transform/order";
import { View } from "@/lib/geometry/coords";
import { isInside } from "@/lib/geometry/rect";
import { clampZoom } from "@/lib/geometry/view-transform";
import { cropRaw } from "@/lib/image/crop-bitmap";
import { normalizeHex } from "@/lib/image/color";
import { RawImage } from "@/lib/image/raw-image";
import { sampleBackground } from "@/lib/image/sample-background";
import { BitmapLayer, CURRENT_VERSION, Project, Rect, ScreenNode } from "@/lib/project/schema";
import { History, canRedo, canUndo, commit, createHistory, redo, undo } from "./history";
import { ImageCache } from "./images";

/** where a duplicated layer lands relative to its original, in original pixels */
export const DUPLICATE_OFFSET = 16;

export type Tool = "select" | "hand" | "rect" | "fill";

/** an extraction waiting for the user to pick a background colour; it owns no layer, patch or history entry */
export type PendingExtraction = { rect: Rect; suggestedHex: string | null };

export type ExtractionResult =
  | { status: "committed"; layerId: string }
  | { status: "needs-color"; suggestedHex: string | null }
  | { status: "rejected"; reason: "no-project" | "invalid-rect" | "no-pending" | "invalid-color" };

type EditorState = {
  /** only the project is undoable; pixels live in `images` */
  history: History<Project> | null;
  images: ImageCache;
  view: View;
  activeTool: Tool;
  selectedLayerIds: string[];
  /** a background patch picked with the fill tool, so its colour can be changed; never selected together with a layer */
  selectedPatchId: string | null;
  pendingExtraction: PendingExtraction | null;
  /** a drag in progress: shown live, recorded only by commitLayerDrag */
  dragPreview: { layerId: string; x: number; y: number } | null;
};

type EditorActions = {
  newProject(input: { fileName: string; raw: RawImage; blob?: Blob; name?: string }): void;
  loadProject(project: Project, images: ImageCache): void;
  snapshotProject(): Project | null;

  beginExtraction(rect: Rect): ExtractionResult;
  confirmExtraction(hex: string): ExtractionResult;
  cancelExtraction(): void;

  previewLayerDrag(layerId: string, x: number, y: number): void;
  commitLayerDrag(): boolean;
  cancelLayerDrag(): void;

  duplicateLayer(layerId: string): string | null;
  deleteLayer(layerId: string): boolean;
  reorderLayer(layerId: string, direction: 1 | -1): boolean;
  setPatchColor(patchId: string, hex: string): boolean;

  undo(): void;
  redo(): void;
  setView(view: View): void;
  setTool(tool: Tool): void;
  selectLayer(layerId: string | null): void;
  selectPatch(patchId: string | null): void;
};

export type EditorStore = EditorState & EditorActions;
export type EditorStoreApi = StoreApi<EditorStore>;
export type EditorStoreOptions = { genId?: () => string };

export const selectProject = (s: EditorState) => s.history?.present ?? null;
export const selectScreen = (s: EditorState): ScreenNode | null => s.history?.present.screens[0] ?? null;
export const selectCanUndo = (s: EditorState) => !!s.history && canUndo(s.history);
export const selectCanRedo = (s: EditorState) => !!s.history && canRedo(s.history);

/** "레이어 N" with N one past the highest already used, so names stay unique after deletions */
const nextLayerNumber = (layers: readonly BitmapLayer[]) =>
  layers.reduce((max, l) => Math.max(max, Number(/^레이어 (\d+)$/.exec(l.name)?.[1] ?? 0)), 0) + 1;

/** Makes a draft layer list match `next`: drops removed layers, appends new ones, rewrites changed zIndex.
 *  Only the differences become patches, so a reorder is a couple of numbers, not a copy of the list. */
function applyLayers(draft: BitmapLayer[], next: readonly BitmapLayer[]) {
  const keep = new Set(next.map((l) => l.id));
  for (let i = draft.length - 1; i >= 0; i--) if (!keep.has(draft[i].id)) draft.splice(i, 1);
  const byId = new Map(draft.map((l) => [l.id, l]));
  for (const layer of next) {
    const existing = byId.get(layer.id);
    if (!existing) draft.push(layer);
    else if (existing.zIndex !== layer.zIndex) existing.zIndex = layer.zIndex;
  }
}

const drawOrder = (layers: readonly BitmapLayer[]) => sortByZ(layers).map((l) => l.id).join("\n");

export function createEditorStore({ genId = () => crypto.randomUUID() }: EditorStoreOptions = {}): EditorStoreApi {
  return createStore<EditorStore>()((set, get) => {
    const screenOf = () => get().history?.present.screens[0] ?? null;

    /** history changed by undo/redo: drop whatever no longer exists or was mid-gesture */
    const reconcile = (history: History<Project>) => {
      const screen = history.present.screens[0];
      const ids = new Set(screen.layers.map((l) => l.id));
      const patch = get().selectedPatchId;
      set({
        history,
        selectedLayerIds: get().selectedLayerIds.filter((id) => ids.has(id)),
        selectedPatchId: patch && screen.backgroundPatches.some((p) => p.id === patch) ? patch : null,
        pendingExtraction: null,
        dragPreview: null,
      });
    };

    /** layer + background patch in a single undo step; pixels are always cut from the original image */
    const commitExtraction = (rect: Rect, hex: string): ExtractionResult => {
      const { history, images } = get();
      const screen = screenOf();
      const source = screen && images.get(screen.source.imageId)?.raw;
      if (!history || !screen || !source) return { status: "rejected", reason: "no-project" };

      const layerId = genId();
      const imageId = genId();
      const patchId = genId();
      const layer: BitmapLayer = {
        id: layerId,
        name: `레이어 ${nextLayerNumber(screen.layers)}`,
        crop: { ...rect },
        imageId,
        transform: { x: rect.x, y: rect.y, scaleX: 1, scaleY: 1, rotation: 0 },
        zIndex: 0,
        opacity: 1,
        visible: true,
        locked: false,
      };
      const next = commit(history, "영역 추출", (draft) => {
        const s = draft.screens[0];
        applyLayers(s.layers, addOnTop(screen.layers, layer));
        s.backgroundPatches.push({ id: patchId, rect: { ...rect }, fill: hex });
      });
      set({
        history: next,
        images: new Map(images).set(imageId, { raw: cropRaw(source, rect) }),
        selectedLayerIds: [layerId],
        selectedPatchId: null,
        activeTool: "select",
        pendingExtraction: null,
      });
      return { status: "committed", layerId };
    };

    /** one undo step for an edit of the layer list */
    const commitLayers = (label: string, next: readonly BitmapLayer[]) => {
      const history = get().history!;
      set({ history: commit(history, label, (draft) => applyLayers(draft.screens[0].layers, next)) });
    };

    const reset = (project: Project, images: ImageCache) =>
      set({
        history: createHistory(project),
        images,
        view: { ...project.canvas },
        activeTool: "select",
        selectedLayerIds: [],
        selectedPatchId: null,
        pendingExtraction: null,
        dragPreview: null,
      });

    return {
      history: null,
      images: new Map(),
      view: { zoom: 1, panX: 0, panY: 0 },
      activeTool: "select",
      selectedLayerIds: [],
      selectedPatchId: null,
      pendingExtraction: null,
      dragPreview: null,

      newProject({ fileName, raw, blob, name }) {
        if (raw.width < 1 || raw.height < 1) throw new RangeError("image has no pixels");
        const imageId = genId();
        reset(
          {
            id: genId(),
            name: name ?? fileName.replace(/\.[^.]+$/, ""),
            version: CURRENT_VERSION,
            canvas: { zoom: 1, panX: 0, panY: 0 },
            screens: [
              {
                id: genId(),
                name: "화면 1",
                x: 0,
                y: 0,
                width: raw.width, // the frame is the uploaded image's size, whatever it is
                height: raw.height,
                source: { imageId, fileName },
                backgroundPatches: [],
                layers: [],
              },
            ],
          },
          new Map([[imageId, { raw, blob }]]),
        );
      },

      loadProject: (project, images) => reset(project, images),

      snapshotProject() {
        const { history, view } = get();
        return history && { ...history.present, canvas: { ...view } };
      },

      beginExtraction(rect) {
        const screen = screenOf();
        const source = screen && get().images.get(screen.source.imageId)?.raw;
        if (!screen || !source) return { status: "rejected", reason: "no-project" };
        if (!isInside(rect, screen)) return { status: "rejected", reason: "invalid-rect" };

        const sample = sampleBackground(source, rect);
        if (sample.status === "ok" && sample.hex) return commitExtraction(rect, sample.hex);
        // too much variation to guess: stop and ask. Nothing is created until the user answers.
        set({ pendingExtraction: { rect: { ...rect }, suggestedHex: sample.hex } });
        return { status: "needs-color", suggestedHex: sample.hex };
      },

      confirmExtraction(hex) {
        const pending = get().pendingExtraction;
        if (!pending) return { status: "rejected", reason: "no-pending" };
        const color = normalizeHex(hex);
        if (!color) return { status: "rejected", reason: "invalid-color" };
        return commitExtraction(pending.rect, color);
      },

      cancelExtraction: () => set({ pendingExtraction: null }),

      previewLayerDrag(layerId, x, y) {
        if (!screenOf()?.layers.some((l) => l.id === layerId) || !Number.isFinite(x) || !Number.isFinite(y)) return;
        set({ dragPreview: { layerId, x: Math.round(x), y: Math.round(y) } });
      },

      commitLayerDrag() {
        const { history, dragPreview } = get();
        set({ dragPreview: null });
        if (!history || !dragPreview) return false;
        const { layerId, x, y } = dragPreview;
        const next = commit(history, "레이어 이동", (draft) => {
          const layer = draft.screens[0].layers.find((l) => l.id === layerId);
          if (!layer) return;
          layer.transform.x = x; // unchanged values make no patch, so a click without movement records nothing
          layer.transform.y = y;
        });
        if (next === history) return false;
        set({ history: next, selectedLayerIds: [layerId], selectedPatchId: null });
        return true;
      },

      cancelLayerDrag: () => set({ dragPreview: null }),

      duplicateLayer(layerId) {
        const screen = screenOf();
        const source = screen?.layers.find((l) => l.id === layerId);
        if (!screen || !source) return null;
        const copy: BitmapLayer = {
          ...source,
          id: genId(),
          name: `${source.name} 복사`,
          crop: { ...source.crop }, // same imageId: the copy shares the original's bitmap
          transform: { ...source.transform, x: source.transform.x + DUPLICATE_OFFSET, y: source.transform.y + DUPLICATE_OFFSET },
        };
        commitLayers("레이어 복제", addOnTop(screen.layers, copy));
        set({ selectedLayerIds: [copy.id], selectedPatchId: null });
        return copy.id;
      },

      deleteLayer(layerId) {
        const screen = screenOf();
        if (!screen?.layers.some((l) => l.id === layerId)) return false;
        commitLayers("레이어 삭제", removeLayer(screen.layers, layerId));
        set({ selectedLayerIds: get().selectedLayerIds.filter((id) => id !== layerId) });
        return true;
      },

      reorderLayer(layerId, direction) {
        const screen = screenOf();
        if (!screen) return false;
        const next = moveLayer(screen.layers, layerId, direction);
        if (drawOrder(next) === drawOrder(screen.layers)) return false; // already at that end
        commitLayers(direction === 1 ? "레이어 앞으로" : "레이어 뒤로", next);
        return true;
      },

      setPatchColor(patchId, hex) {
        const { history } = get();
        const color = normalizeHex(hex);
        if (!history || !color) return false;
        const next = commit(history, "배경색 변경", (draft) => {
          const patch = draft.screens[0].backgroundPatches.find((p) => p.id === patchId);
          if (patch) patch.fill = color;
        });
        if (next === history) return false;
        set({ history: next });
        return true;
      },

      undo() {
        const { history } = get();
        if (history) reconcile(undo(history));
      },

      redo() {
        const { history } = get();
        if (history) reconcile(redo(history));
      },

      setView: (view) => set({ view: { ...view, zoom: clampZoom(view.zoom) } }), // not undoable: it is not an edit
      setTool: (activeTool) => set({ activeTool }),
      selectLayer: (layerId) => set({ selectedLayerIds: layerId && screenOf()?.layers.some((l) => l.id === layerId) ? [layerId] : [], selectedPatchId: null }),
      selectPatch: (patchId) => {
        const known = patchId && screenOf()?.backgroundPatches.some((p) => p.id === patchId);
        set({ selectedPatchId: known ? patchId : null, selectedLayerIds: [] });
      },
    };
  });
}
