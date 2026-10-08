import { StoreApi, createStore } from "zustand/vanilla";
import { addOnTop, moveLayer, removeLayer, sortByZ } from "@/features/layer-transform/order";
import { View } from "@/lib/geometry/coords";
import { isInside } from "@/lib/geometry/rect";
import { MAX_STROKE_WIDTH, SHAPE_LABEL, withSize } from "@/lib/image/vector";
import { MAX_FONT_SIZE, MIN_FONT_SIZE, MIN_TEXT_WIDTH, TextAlign } from "@/lib/image/text-layout";
import { MeasureFor, canvasMeasureFor, fitHeight } from "@/lib/image/text-measure";
import { contentError } from "@/lib/project/parse";
import { LayerTransform, isOnlyMoved, sanitizeTransform } from "@/lib/geometry/layer-transform";
import { clampZoom } from "@/lib/geometry/view-transform";
import { cropRaw } from "@/lib/image/crop-bitmap";
import { normalizeHex } from "@/lib/image/color";
import { RawImage } from "@/lib/image/raw-image";
import { sampleBackground } from "@/lib/image/sample-background";
import { BitmapLayer, CURRENT_VERSION, LayerContent, MAX_MEMOS, MAX_MEMO_LENGTH, Project, Rect, ScreenNode } from "@/lib/project/schema";
import { History, canRedo, canUndo, commit, createHistory, redo, undo } from "./history";
import { ImageCache } from "./images";

/** where a duplicated layer lands relative to its original, in original pixels */
export const DUPLICATE_OFFSET = 16;

/** longest layer name kept; a longer one is cut */
export const MAX_LAYER_NAME = 60;

/** a layer copied with Ctrl+C. The system clipboard holds its picture; the app keeps the layer itself and the picture's hash. */
export type LayerClipboard = { layer: BitmapLayer; pastes: number; /** hash of the picture put on the system clipboard with it ("" when there is none) */ hash: string };

/** how the screen is shown: the edited result, the untouched original, or both side by side.
 *  While comparing, nothing can be edited: what is being compared must not change under the eye. */
export type CompareMode = "off" | "original" | "split";

export type Tool = "select" | "hand" | "rect" | "fill" | "line" | "box" | "ellipse" | "eyedropper" | "brush" | "eraser" | "text" | "memo";

/** the tools that drag out a new vector layer, and what each makes */
export const SHAPE_TOOLS: Partial<Record<Tool, Exclude<LayerContent["kind"], "text">>> = { line: "line", box: "rect", ellipse: "ellipse" };

/** What a new shape looks like. Not part of the project and not undoable. The eyedropper sets the colour named by `pickTarget`. */
export type DrawStyle = { stroke: string; fill: string | null; strokeWidth: number; pickTarget: "stroke" | "fill" };
export const DEFAULT_DRAW_STYLE: DrawStyle = { stroke: "#e5322d", fill: null, strokeWidth: 3, pickTarget: "stroke" };

/** What a new text box looks like (an existing one is changed in the property panel). */
export type TextStyle = { fontSize: number; color: string; align: TextAlign };
export const DEFAULT_TEXT_STYLE: TextStyle = { fontSize: 32, color: "#222222", align: "left" };
/** the width a new text box starts with, in image pixels */
export const DEFAULT_TEXT_WIDTH = 240;

/** the text box being typed into: an existing layer, or (layerId null) a new one that exists only once there are words in it */
export type TextEditing = { layerId: string | null; x: number; y: number };

/** an extraction waiting for the user to pick a background colour; it owns no layer, patch or history entry */
export type PendingExtraction = { rect: Rect; suggestedHex: string | null };

export type ExtractionResult =
  | { status: "committed"; layerId: string }
  | { status: "needs-color"; suggestedHex: string | null }
  | { status: "rejected"; reason: "no-project" | "invalid-rect" | "no-pending" | "invalid-color" | "comparing" };

type EditorState = {
  /** only the project is undoable; pixels live in `images` */
  history: History<Project> | null;
  images: ImageCache;
  view: View;
  /** a newly uploaded image wants to be shown whole; an opened project keeps the view it was saved with */
  needsFit: boolean;
  activeTool: Tool;
  selectedLayerIds: string[];
  /** a background patch picked with the fill tool, so its colour can be changed; never selected together with a layer */
  selectedPatchId: string | null;
  pendingExtraction: PendingExtraction | null;
  layerClipboard: LayerClipboard | null;
  notice: string | null;
  compareMode: CompareMode;
  drawStyle: DrawStyle;
  textStyle: TextStyle;
  textEditing: TextEditing | null;
  /** the memo whose balloon is open; not part of the project */
  selectedMemoId: string | null;
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
  copyLayer(layerId: string, hash?: string): boolean;
  clearLayerClipboard(): void;
  /** a message for the user about something that did not work (shown until dismissed) */
  setNotice(message: string | null): void;
  pasteLayer(): string | null;
  deleteLayer(layerId: string): boolean;
  reorderLayer(layerId: string, direction: 1 | -1): boolean;
  /** resize/rotate in one undo step; a locked layer refuses */
  transformLayer(layerId: string, transform: LayerTransform): boolean;
  resetLayerTransform(layerId: string): boolean;
  setLayerVisible(layerId: string, visible: boolean): boolean;
  setLayerLocked(layerId: string, locked: boolean): boolean;
  renameLayer(layerId: string, name: string): boolean;
  setPatchColor(patchId: string, hex: string): boolean;

  /** Puts a freshly painted bitmap on a brush layer (`layerId`), or makes a new brush layer when it is null. The bitmap gets a NEW
   *  imageId and the old one stays in the cache for undo, so the history holds only the layer's changed fields, never pixels.
   *  One undo step. Returns the layer id, or null when refused (comparing, locked, not a brush layer). */
  commitBitmapEdit(edit: { layerId: string | null; raw: RawImage; x: number; y: number; label: string }): string | null;
  /** Moves a layer by (dx, dy) pixels, for the arrow keys. Presses on the same layer within NUDGE_MERGE_MS ms of each other are ONE undo step
   *  (holding a key is not fifty steps). Refused for a locked layer and while comparing. */
  nudgeLayer(layerId: string, dx: number, dy: number): boolean;
  /** a new vector layer at (x, y) (its top-left, in frame pixels); one undo step */
  addVectorLayer(content: LayerContent, x: number, y: number): string | null;
  /** change a vector layer's look (colours, stroke width); one undo step, refused on a locked layer */
  setLayerContent(layerId: string, change: Partial<{ stroke: string | null; fill: string | null; strokeWidth: number }>): boolean;
  setDrawStyle(change: Partial<DrawStyle>): void;
  setTextStyle(change: Partial<TextStyle>): void;
  /** a new text box with its top-left at (x, y), in the current text style; one undo step. Empty text makes nothing. */
  addTextLayer(text: string, x: number, y: number, width?: number): string | null;
  /** change a text box (words, size, colour, alignment); its height follows its lines. One undo step; refused on a locked layer. */
  setTextContent(layerId: string, change: Partial<{ text: string; fontSize: number; color: string; align: TextAlign }>): boolean;
  /** start typing: into an existing text layer, or into a new box at (x, y). Refused while comparing and for a locked layer. */
  beginTextEdit(target: { layerId: string } | { x: number; y: number }): boolean;
  /** finish typing. A new box with no words is dropped, an existing one keeps its old words if emptied; nothing else changes on a no-op. */
  commitTextEdit(text: string): boolean;
  cancelTextEdit(): void;
  /** a memo pinned at (x, y) (kept inside the frame); selected, empty. One undo step. Refused while comparing and past MAX_MEMOS. */
  addMemo(x: number, y: number): string | null;
  setMemoText(memoId: string, text: string): boolean;
  /** move a memo's pin (kept inside the frame); one undo step, none when it does not move */
  moveMemo(memoId: string, x: number, y: number): boolean;
  deleteMemo(memoId: string): boolean;
  selectMemo(memoId: string | null): void;

  undo(): void;
  redo(): void;
  setCompareMode(mode: CompareMode): void;
  setView(view: View): void;
  markFitted(): void;
  setTool(tool: Tool): void;
  selectLayer(layerId: string | null): void;
  selectPatch(patchId: string | null): void;
};

export type EditorStore = EditorState & EditorActions;
export type EditorStoreApi = StoreApi<EditorStore>;
export type EditorStoreOptions = { genId?: () => string; /** how wide a string is at a font size; the canvas's own measure in the browser */ measure?: MeasureFor; /** the clock, so tests can say how much time passed between two key presses */ now?: () => number };

/** key presses on the same layer closer together than this are one undo step */
export const NUDGE_MERGE_MS = 600;

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

/** "<prefix> N" with N one past the highest already used */
const nextNumberFor = (layers: readonly BitmapLayer[], prefix: string) =>
  layers.reduce((max, l) => (l.name.startsWith(`${prefix} `) && /^\d+$/.test(l.name.slice(prefix.length + 1)) ? Math.max(max, Number(l.name.slice(prefix.length + 1))) : max), 0) + 1;

/** a point kept inside the frame, to two decimals */
const clampToFrame = (screen: { width: number; height: number }, x: number, y: number) => ({
  x: Math.min(Math.max(Math.round(x * 100) / 100, 0), screen.width),
  y: Math.min(Math.max(Math.round(y * 100) / 100, 0), screen.height),
});

const drawOrder = (layers: readonly BitmapLayer[]) => sortByZ(layers).map((l) => l.id).join("\n");

export function createEditorStore({ genId = () => crypto.randomUUID(), now = () => Date.now(), measure = canvasMeasureFor }: EditorStoreOptions = {}): EditorStoreApi {
  /** the last keyboard move: which layer, when, and the undo entry it made, so the next press can fold into it */
  let lastNudge: { layerId: string; at: number; entry: unknown; dx: number; dy: number } | null = null;
  return createStore<EditorStore>()((set, get) => {
    const screenOf = () => get().history?.present.screens[0] ?? null;
    /** true while comparing: every edit refuses, however it was asked for */
    const frozen = () => get().compareMode !== "off";

    /** history changed by undo/redo: drop whatever no longer exists or was mid-gesture */
    const reconcile = (history: History<Project>) => {
      const screen = history.present.screens[0];
      const ids = new Set(screen.layers.map((l) => l.id));
      const patch = get().selectedPatchId;
      set({
        history,
        selectedLayerIds: get().selectedLayerIds.filter((id) => ids.has(id)),
        selectedPatchId: patch && screen.backgroundPatches.some((p) => p.id === patch) ? patch : null,
        selectedMemoId: get().selectedMemoId && (screen.memos ?? []).some((m) => m.id === get().selectedMemoId) ? get().selectedMemoId : null,
        pendingExtraction: null,
        dragPreview: null,
      });
    };

    /** layer + background patch in a single undo step; pixels are always cut from the original image */
    const commitExtraction = (rect: Rect, hex: string): ExtractionResult => {
      if (frozen()) return { status: "rejected", reason: "comparing" };
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

    /** one undo step changing one layer; false (and no history entry) when nothing actually changes */
    const editLayer = (layerId: string, label: string, change: (layer: BitmapLayer) => void) => {
      if (frozen()) return false;
      const { history } = get();
      if (!history?.present.screens[0].layers.some((l) => l.id === layerId)) return false;
      const next = commit(history, label, (draft) => {
        const layer = draft.screens[0].layers.find((l) => l.id === layerId);
        if (layer) change(layer);
      });
      if (next === history) return false;
      set({ history: next });
      return true;
    };

    const reset = (project: Project, images: ImageCache) =>
      set({
        history: createHistory(project),
        images,
        view: { ...project.canvas },
        needsFit: false,
        activeTool: "select",
        selectedMemoId: null,
        selectedLayerIds: [],
        selectedPatchId: null,
        pendingExtraction: null,
        layerClipboard: null, // it points at bitmaps of the project that was just replaced
        compareMode: "off",
        dragPreview: null,
      });

    return {
      history: null,
      images: new Map(),
      view: { zoom: 1, panX: 0, panY: 0 },
      needsFit: false,
      activeTool: "select",
      selectedLayerIds: [],
      selectedPatchId: null,
      pendingExtraction: null,
      layerClipboard: null,
      notice: null,
      compareMode: "off",
      drawStyle: DEFAULT_DRAW_STYLE,
      textStyle: DEFAULT_TEXT_STYLE,
      textEditing: null,
      selectedMemoId: null,
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
        set({ needsFit: true });
      },

      loadProject: (project, images) => reset(project, images),

      snapshotProject() {
        const { history, view } = get();
        return history && { ...history.present, canvas: { ...view } };
      },

      beginExtraction(rect) {
        if (frozen()) return { status: "rejected", reason: "comparing" };
        const screen = screenOf();
        const source = screen && get().images.get(screen.source.imageId)?.raw;
        if (!screen || !source) return { status: "rejected", reason: "no-project" };
        if (!isInside(rect, screen)) return { status: "rejected", reason: "invalid-rect" };

        const sample = sampleBackground(source, rect);
        if (sample.status === "ok" && sample.hex) return commitExtraction(rect, sample.hex);
        // too much variation to guess: stop and ask. Nothing is created until the user answers.
        const suggestedHex = sample.suggestedHex ?? sample.hex; // taken from outside any shadow when the image has room
        set({ pendingExtraction: { rect: { ...rect }, suggestedHex } });
        return { status: "needs-color", suggestedHex };
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
        if (frozen()) return;
        const layer = screenOf()?.layers.find((l) => l.id === layerId);
        if (!layer || layer.locked || !Number.isFinite(x) || !Number.isFinite(y)) return; // a locked layer does not move
        set({ dragPreview: { layerId, x: Math.round(x), y: Math.round(y) } });
      },

      commitLayerDrag() {
        const { history, dragPreview } = get();
        set({ dragPreview: null });
        if (!history || !dragPreview || frozen()) return false;
        const { layerId, x, y } = dragPreview;
        const next = commit(history, "레이어 이동", (draft) => {
          const layer = draft.screens[0].layers.find((l) => l.id === layerId);
          if (!layer || layer.locked) return;
          layer.transform.x = x; // unchanged values make no patch, so a click without movement records nothing
          layer.transform.y = y;
        });
        if (next === history) return false;
        set({ history: next, selectedLayerIds: [layerId], selectedPatchId: null });
        return true;
      },

      cancelLayerDrag: () => set({ dragPreview: null }),

      duplicateLayer(layerId) {
        if (frozen()) return null;
        const screen = screenOf();
        const source = screen?.layers.find((l) => l.id === layerId);
        if (!screen || !source) return null;
        const copy: BitmapLayer = {
          ...source,
          id: genId(),
          name: `${source.name} 복사`,
          visible: true, // a copy is a fresh layer: shown and free to move, whatever state the original is in
          locked: false,
          crop: { ...source.crop }, // same imageId: the copy shares the original's bitmap
          transform: { ...source.transform, x: source.transform.x + DUPLICATE_OFFSET, y: source.transform.y + DUPLICATE_OFFSET },
        };
        commitLayers("레이어 복제", addOnTop(screen.layers, copy));
        set({ selectedLayerIds: [copy.id], selectedPatchId: null });
        return copy.id;
      },

      copyLayer(layerId, hash = "") {
        const layer = screenOf()?.layers.find((l) => l.id === layerId);
        if (!layer) return false;
        set({ layerClipboard: { layer: { ...layer, crop: { ...layer.crop }, transform: { ...layer.transform } }, pastes: 0, hash } });
        return true;
      },

      clearLayerClipboard: () => set({ layerClipboard: null }),
      setNotice: (notice) => set({ notice }),

      pasteLayer() {
        const { layerClipboard, history, images } = get();
        const screen = screenOf();
        if (frozen() || !layerClipboard || !history || !screen) return null;
        const source = layerClipboard.layer;
        if (!source.content && (!source.imageId || !images.has(source.imageId))) return null;
        // each paste lands one more step down and right, so repeated pastes do not hide each other
        const step = DUPLICATE_OFFSET * (layerClipboard.pastes + 1);
        const copy: BitmapLayer = {
          ...source,
          id: genId(),
          name: `${source.name} 복사`,
          visible: true,
          locked: false,
          crop: { ...source.crop },
          transform: { ...source.transform, x: source.transform.x + step, y: source.transform.y + step },
        };
        commitLayers("레이어 붙여넣기", addOnTop(screen.layers, copy));
        set({ selectedLayerIds: [copy.id], selectedPatchId: null, layerClipboard: { ...layerClipboard, pastes: layerClipboard.pastes + 1 } });
        return copy.id;
      },

      deleteLayer(layerId) {
        if (frozen()) return false;
        const screen = screenOf();
        const target = screen?.layers.find((l) => l.id === layerId);
        if (!screen || !target || target.locked) return false; // a locked layer cannot be deleted
        commitLayers("레이어 삭제", removeLayer(screen.layers, layerId));
        set({ selectedLayerIds: get().selectedLayerIds.filter((id) => id !== layerId) });
        return true;
      },

      reorderLayer(layerId, direction) {
        const screen = screenOf();
        if (!screen || frozen()) return false;
        const next = moveLayer(screen.layers, layerId, direction);
        if (drawOrder(next) === drawOrder(screen.layers)) return false; // already at that end
        commitLayers(direction === 1 ? "레이어 앞으로" : "레이어 뒤로", next);
        return true;
      },

      transformLayer(layerId, transform) {
        const layer = screenOf()?.layers.find((l) => l.id === layerId);
        const next = sanitizeTransform(transform);
        if (!layer || layer.locked || !next) return false;
        return editLayer(layerId, "레이어 크기·회전", (l) => {
          l.transform.x = next.x;
          l.transform.y = next.y;
          l.transform.rotation = next.rotation;
          if (l.content) {
            // a vector layer is resized through its box, never through scale: the stroke keeps its thickness
            if (l.content.kind === "text") {
              // a text box is resized by its width; its height is whatever its lines then need, and the letters keep their size
              l.content.width = Math.max(MIN_TEXT_WIDTH, Math.round(l.content.width * Math.abs(next.scaleX) * 100) / 100);
              l.content.height = fitHeight(l.content, measure);
            } else {
              const box = withSize(l.content as LayerContent, l.content.width * Math.abs(next.scaleX), l.content.height * Math.abs(next.scaleY));
              l.content.width = box.width;
              l.content.height = box.height;
            }
            l.transform.scaleX = 1;
            l.transform.scaleY = 1;
          } else {
            l.transform.scaleX = next.scaleX;
            l.transform.scaleY = next.scaleY;
          }
        });
      },

      resetLayerTransform(layerId) {
        const layer = screenOf()?.layers.find((l) => l.id === layerId);
        if (!layer || isOnlyMoved(layer.transform)) return false;
        // back to natural size and upright, the top-left corner staying where it is
        return get().transformLayer(layerId, { x: layer.transform.x, y: layer.transform.y, scaleX: 1, scaleY: 1, rotation: 0 });
      },

      setLayerVisible(layerId, visible) {
        return editLayer(layerId, visible ? "레이어 보이기" : "레이어 숨기기", (l) => void (l.visible = visible));
      },

      setLayerLocked(layerId, locked) {
        return editLayer(layerId, locked ? "레이어 잠그기" : "레이어 잠금 해제", (l) => void (l.locked = locked));
      },

      renameLayer(layerId, name) {
        const clean = name.trim().slice(0, MAX_LAYER_NAME);
        if (!clean) return false; // a layer always has a name
        return editLayer(layerId, "레이어 이름 변경", (l) => void (l.name = clean));
      },

      nudgeLayer(layerId, dx, dy) {
        const { history } = get();
        const layer = screenOf()?.layers.find((l) => l.id === layerId);
        if (frozen() || !history || !layer || layer.locked || ![dx, dy].every(Number.isFinite) || (dx === 0 && dy === 0)) return false;
        const t = now();
        const fold = lastNudge && lastNudge.layerId === layerId && t - lastNudge.at <= NUDGE_MERGE_MS && history.past.at(-1) === lastNudge.entry;
        // folding: step back over the previous press and make one move of the total, so the history has a single entry for the burst
        const base = fold ? undo(history) : history;
        const total = fold ? { dx: lastNudge!.dx + dx, dy: lastNudge!.dy + dy } : { dx, dy };
        const moved = commit(base, "레이어 이동(키보드)", (draft) => {
          const l = draft.screens[0].layers.find((d) => d.id === layerId);
          if (!l) return;
          l.transform.x = Math.round((l.transform.x + total.dx) * 100) / 100;
          l.transform.y = Math.round((l.transform.y + total.dy) * 100) / 100;
        });
        if (moved === base) {
          // the burst netted out to nothing: the earlier press is already undone, so keep that and leave no step behind
          if (fold) {
            lastNudge = null;
            set({ history: base, selectedLayerIds: [layerId], selectedPatchId: null });
            return true;
          }
          return false;
        }
        lastNudge = { layerId, at: t, entry: moved.past.at(-1), ...total };
        set({ history: moved, selectedLayerIds: [layerId], selectedPatchId: null });
        return true;
      },

      commitBitmapEdit({ layerId, raw, x, y, label }) {
        const { history, images } = get();
        const screen = screenOf();
        if (frozen() || !history || !screen || raw.width < 1 || raw.height < 1 || ![x, y].every(Number.isFinite)) return null;
        const imageId = genId();
        const nextImages = new Map(images).set(imageId, { raw });
        const crop = { x: 0, y: 0, width: raw.width, height: raw.height };
        const at = { x: Math.round(x), y: Math.round(y) };
        if (layerId) {
          const target = screen.layers.find((l) => l.id === layerId);
          if (!target || !target.drawn || target.locked) return null;
          const next = commit(history, label, (draft) => {
            const l = draft.screens[0].layers.find((d) => d.id === layerId);
            if (!l) return;
            l.imageId = imageId;
            l.crop = crop;
            l.transform.x = at.x;
            l.transform.y = at.y;
          });
          set({ history: next, images: nextImages, selectedLayerIds: [layerId], selectedPatchId: null });
          return layerId;
        }
        const id = genId();
        const layer: BitmapLayer = {
          id,
          name: `브러시 ${nextNumberFor(screen.layers, "브러시")}`,
          crop,
          imageId,
          drawn: true,
          transform: { x: at.x, y: at.y, scaleX: 1, scaleY: 1, rotation: 0 },
          zIndex: 0,
          opacity: 1,
          visible: true,
          locked: false,
        };
        set({ images: nextImages });
        commitLayers(label, addOnTop(screen.layers, layer));
        set({ selectedLayerIds: [id], selectedPatchId: null });
        return id;
      },

      addVectorLayer(content, x, y) {
        const screen = screenOf();
        if (frozen() || !screen || contentError(content) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
        const id = genId();
        const label = SHAPE_LABEL[content.kind];
        const layer: BitmapLayer = {
          id,
          name: `${label} ${nextNumberFor(screen.layers, label)}`,
          crop: { x: 0, y: 0, width: 0, height: 0 },
          content: { ...content } as LayerContent,
          transform: { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, scaleX: 1, scaleY: 1, rotation: 0 },
          zIndex: 0,
          opacity: 1,
          visible: true,
          locked: false,
        };
        commitLayers(`${label} 추가`, addOnTop(screen.layers, layer));
        set({ selectedLayerIds: [id], selectedPatchId: null, activeTool: "select" });
        return id;
      },

      setLayerContent(layerId, change) {
        const layer = screenOf()?.layers.find((l) => l.id === layerId);
        if (!layer?.content || layer.locked) return false;
        const merged = { ...layer.content, ...change } as LayerContent;
        merged.strokeWidth = Math.min(Math.max(Math.round(merged.strokeWidth * 100) / 100, merged.kind === "line" ? 0.5 : 0), MAX_STROKE_WIDTH);
        if (contentError(merged)) return false;
        return editLayer(layerId, "도형 속성 변경", (l) => {
          if (!l.content) return;
          const target = l.content as Record<string, unknown>;
          const wanted = merged as Record<string, unknown>;
          for (const key of ["stroke", "fill", "strokeWidth"]) if (key in wanted && target[key] !== wanted[key]) target[key] = wanted[key];
        });
      },

      setDrawStyle: (change) => set({ drawStyle: { ...get().drawStyle, ...change } }),

      setTextStyle(change) {
        const next = { ...get().textStyle, ...change };
        if (!Number.isFinite(next.fontSize)) return;
        next.fontSize = Math.min(Math.max(Math.round(next.fontSize * 100) / 100, MIN_FONT_SIZE), MAX_FONT_SIZE);
        set({ textStyle: next });
      },

      addTextLayer(text, x, y, width = DEFAULT_TEXT_WIDTH) {
        if (text.trim() === "") return null;
        const { fontSize, color, align } = get().textStyle;
        const w = Math.max(MIN_TEXT_WIDTH, width);
        const content: LayerContent = { kind: "text", width: w, height: 1, text, fontSize, color, align, stroke: null, strokeWidth: 0 };
        content.height = fitHeight(content, measure);
        return get().addVectorLayer(content, x, y);
      },

      setTextContent(layerId, change) {
        const layer = screenOf()?.layers.find((l) => l.id === layerId);
        const c = layer?.content;
        if (!layer || c?.kind !== "text" || layer.locked || frozen()) return false;
        const merged = { ...c, ...change };
        merged.fontSize = Math.min(Math.max(Math.round(merged.fontSize * 100) / 100, MIN_FONT_SIZE), MAX_FONT_SIZE);
        merged.height = fitHeight(merged, measure);
        if (contentError(merged)) return false;
        return editLayer(layerId, "텍스트 변경", (l) => {
          if (l.content?.kind !== "text") return;
          const target = l.content as Record<string, unknown>;
          const wanted = merged as Record<string, unknown>;
          for (const key of ["text", "fontSize", "color", "align", "height"]) if (target[key] !== wanted[key]) target[key] = wanted[key];
        });
      },

      beginTextEdit(target) {
        const screen = screenOf();
        if (frozen() || !screen) return false;
        if ("layerId" in target) {
          const layer = screen.layers.find((l) => l.id === target.layerId);
          if (!layer || layer.content?.kind !== "text" || layer.locked) return false;
          set({ textEditing: { layerId: layer.id, x: layer.transform.x, y: layer.transform.y }, selectedLayerIds: [layer.id], selectedPatchId: null });
          return true;
        }
        if (![target.x, target.y].every(Number.isFinite)) return false;
        set({ textEditing: { layerId: null, x: target.x, y: target.y } });
        return true;
      },

      commitTextEdit(text) {
        const editing = get().textEditing;
        if (!editing) return false;
        set({ textEditing: null });
        if (editing.layerId === null) return get().addTextLayer(text, editing.x, editing.y) !== null;
        return get().setTextContent(editing.layerId, { text });
      },

      cancelTextEdit: () => set({ textEditing: null }),

      addMemo(x, y) {
        const { history } = get();
        const screen = screenOf();
        if (frozen() || !history || !screen || ![x, y].every(Number.isFinite) || (screen.memos?.length ?? 0) >= MAX_MEMOS) return null;
        const id = genId();
        const p = clampToFrame(screen, x, y);
        set({
          history: commit(history, "메모 추가", (draft) => {
            (draft.screens[0].memos ??= []).push({ id, x: p.x, y: p.y, text: "" });
          }),
          selectedMemoId: id,
          selectedLayerIds: [],
          selectedPatchId: null,
          activeTool: "select",
        });
        return id;
      },

      setMemoText(memoId, text) {
        const { history } = get();
        const memo = screenOf()?.memos?.find((m) => m.id === memoId);
        if (frozen() || !history || !memo || memo.text === text || text.length > MAX_MEMO_LENGTH) return false;
        set({ history: commit(history, "메모 수정", (draft) => void (draft.screens[0].memos!.find((m) => m.id === memoId)!.text = text)) });
        return true;
      },

      moveMemo(memoId, x, y) {
        const { history } = get();
        const screen = screenOf();
        const memo = screen?.memos?.find((m) => m.id === memoId);
        if (frozen() || !history || !screen || !memo || ![x, y].every(Number.isFinite)) return false;
        const p = clampToFrame(screen, x, y);
        if (p.x === memo.x && p.y === memo.y) return false;
        set({
          history: commit(history, "메모 이동", (draft) => {
            const m = draft.screens[0].memos!.find((d) => d.id === memoId)!;
            m.x = p.x;
            m.y = p.y;
          }),
        });
        return true;
      },

      deleteMemo(memoId) {
        const { history } = get();
        if (frozen() || !history || !screenOf()?.memos?.some((m) => m.id === memoId)) return false;
        set({
          history: commit(history, "메모 삭제", (draft) => {
            const s = draft.screens[0];
            s.memos = s.memos!.filter((m) => m.id !== memoId);
          }),
          selectedMemoId: get().selectedMemoId === memoId ? null : get().selectedMemoId,
        });
        return true;
      },

      selectMemo(memoId) {
        if (memoId && screenOf()?.memos?.some((m) => m.id === memoId)) set({ selectedMemoId: memoId, selectedLayerIds: [], selectedPatchId: null });
        else set({ selectedMemoId: null });
      },

      setPatchColor(patchId, hex) {
        const { history } = get();
        const color = normalizeHex(hex);
        if (!history || !color || frozen()) return false;
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
      markFitted: () => set({ needsFit: false }),
      // a gesture or question that was under way is dropped, so nothing half-done lingers behind the comparison
      setCompareMode: (compareMode) => set({ compareMode, dragPreview: null, pendingExtraction: null }),
      setTool: (activeTool) => set({ activeTool }),
      selectLayer: (layerId) => set({ selectedMemoId: null, selectedLayerIds: layerId && screenOf()?.layers.some((l) => l.id === layerId) ? [layerId] : [], selectedPatchId: null }),
      selectPatch: (patchId) => {
        const known = patchId && screenOf()?.backgroundPatches.some((p) => p.id === patchId);
        set({ selectedPatchId: known ? patchId : null, selectedLayerIds: [] });
      },
    };
  });
}
