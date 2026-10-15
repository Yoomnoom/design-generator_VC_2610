import { StoreApi, createStore } from "zustand/vanilla";
import { addOnTop, moveLayer, normalizeZ, removeLayer, sortByZ } from "@/features/layer-transform/order";
import { View } from "@/lib/geometry/coords";
import { isInside } from "@/lib/geometry/rect";
import { MAX_STROKE_WIDTH, SHAPE_LABEL, maxCornerRadius, withSize } from "@/lib/image/vector";
import { MAX_FONT_SIZE, MIN_FONT_SIZE, MIN_TEXT_WIDTH, TextAlign } from "@/lib/image/text-layout";
import { MeasureFor, canvasMeasureFor, fitHeight } from "@/lib/image/text-measure";
import { Candidate, candidatesAt, pickNext } from "@/lib/image/candidates";
import { Guide } from "@/features/snap/snap";
import { contentError } from "@/lib/project/parse";
import { LayerTransform, isOnlyMoved, sanitizeTransform } from "@/lib/geometry/layer-transform";
import { clampZoom } from "@/lib/geometry/view-transform";
import { cropRaw } from "@/lib/image/crop-bitmap";
import { trimImageVersions } from "./image-retention";
import { layerBox } from "@/features/snap/layer-box";
import type { AssetBundle } from "@/features/assets/types";
import { MESH_DEFAULT, MESH_MAX, MESH_MIN, identityQuad, isIdentityWarp, resizeMesh, roundWarp, toQuad, warpError } from "@/lib/image/warp";
import { hexToRgb, normalizeHex } from "@/lib/image/color";
import { RawImage } from "@/lib/image/raw-image";
import { sampleBackground } from "@/lib/image/sample-background";
import { AlignKind, alignDeltas, distributeDeltas, makeUnits } from "@/features/align/align";
import { FreeOp, LayerResult, applyFreeTransform as computeFreeTransform, transformable } from "@/features/free-transform/free-transform";
import { MIN_GROUP_SIZE, expandToGroups, nextGroupName, panelRows, pruneGroups, rangeSelect, wholeGroupOf } from "@/features/groups/groups";
import { LIQUIFY_MODES, LiquifyMode, MAX_LIQUIFY_SIZE, MIN_LIQUIFY_SIZE } from "@/lib/image/liquify";
import { BLANK_FILE, checkCanvasSize, isGeneratedPage } from "@/lib/project/blank";
import { createRawImage } from "@/lib/image/raw-image";
import { renderLayerOf } from "@/features/export-image/export-png";
import { RenderLayer, renderComposite } from "@/lib/image/render-export";
import { Rasterize, rasterizeVectorLayer } from "@/lib/image/vector-raster";
import { effectMargin } from "@/lib/image/layer-effects";
import { adjustError, effectsError } from "@/lib/project/parse";
import { hasAdjust } from "@/lib/image/adjust";
import { LayerAdjust, LayerEffects } from "@/lib/project/schema";
import { BLEND_MODES, BlendMode, BitmapLayer, CURRENT_VERSION, LayerContent, LayerWarp, MAX_MEMOS, MAX_MEMO_LENGTH, Project, Rect, ScreenNode, MAX_GROUPS, MAX_GROUP_NAME } from "@/lib/project/schema";
import { History, canRedo, canUndo, commit, createHistory, redo, undo } from "./history";
import { ImageCache } from "./images";
import { SOURCE_LAYER_ID } from "@/features/source-edit/source-edit";

/** where a duplicated layer lands relative to its original, in original pixels */
export const DUPLICATE_OFFSET = 16;

/** longest layer name kept; a longer one is cut */
export const MAX_LAYER_NAME = 60;

/** a layer copied with Ctrl+C. The system clipboard holds its picture; the app keeps the layer itself and the picture's hash. */
export type LayerClipboard = { layer: BitmapLayer; pastes: number; /** hash of the picture put on the system clipboard with it ("" when there is none) */ hash: string };

/** how the screen is shown: the edited result, the untouched original, or both side by side.
 *  While comparing, nothing can be edited: what is being compared must not change under the eye. */
export type CompareMode = "off" | "original" | "split";

export type Tool = "select" | "hand" | "rect" | "fill" | "line" | "box" | "ellipse" | "eyedropper" | "brush" | "eraser" | "text" | "memo" | "auto" | "warp" | "finger" | "liquify";

/** The finger (smudge) tool's brush. Size is in the layer's own pixels; strength and softness are 0..100 (percent). Not part of the project. */
export type FingerStyle = { size: number; strength: number; softness: number };
export const DEFAULT_FINGER_STYLE: FingerStyle = { size: 30, strength: 60, softness: 50 };
/** the liquify tool's brush: mode, size (the layer's own pixels), strength and edge softness (percent) */
export type LiquifyStyle = { mode: LiquifyMode; size: number; strength: number; softness: number };
export const DEFAULT_LIQUIFY_STYLE: LiquifyStyle = { mode: "push", size: 80, strength: 70, softness: 50 };

/** The finger tool writes a whole new bitmap per stroke, and every undo step keeps the one it replaced alive. The versions that are no
 *  longer the present one may take at most this many bytes; past that, the oldest undo steps are dropped (and the pictures only they
 *  needed are freed). A small layer keeps all 100 steps (600 × 400 is under 1 MB a step); a 4000 × 3000 one keeps about five. */
export const IMAGE_VERSION_BUDGET = 256 * 1024 * 1024;

/** the warp tool: which kind of handles the selected bitmap layer shows (corner points, or a grid of control points) and how fine the grid is.
 *  Not part of the project. */
export type WarpUi = { mode: "quad" | "mesh"; cols: number; rows: number };
export const DEFAULT_WARP_UI: WarpUi = { mode: "quad", cols: MESH_DEFAULT, rows: MESH_DEFAULT };

/** the warp tool is working on one layer; `base` is how many undo steps existed when it started, so Esc can take them all back */
export type WarpSession = { layerId: string; base: number };

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

/** the regions found in the screen's original picture, for the automatic-candidates tool. Not part of the project: it is found again when needed. */
export type CandidateSet = { imageId: string; list: Candidate[]; /** how long the analysis took, in ms */ ms: number };
/** the candidate chosen by a click: the smaller ones under that spot come first, and clicking the same spot again takes the next larger */
export type CandidatePick = { rect: Rect; /** 0 = the smallest under the click */ index: number; /** how many candidates are under the click */ count: number; point: { x: number; y: number } };

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
  candidates: CandidateSet | null;
  candidateStatus: "idle" | "running" | "error";
  candidateError: string | null;
  candidatePick: CandidatePick | null;
  /** the smallest candidate under the pointer, shown lightly */
  candidateHover: Candidate | null;
  /** snap to other layers and the frame's lines while dragging; Alt turns it off for one drag */
  snapEnabled: boolean;
  /** the guide lines of the snap in progress (empty when not dragging) */
  snapGuides: Guide[];
  /** a drag in progress: shown live, recorded only by commitLayerDrag */
  dragPreview: { layerId: string; x: number; y: number } | null;
  fingerStyle: FingerStyle;
  liquifyStyle: LiquifyStyle;
  setLiquifyStyle(change: Partial<LiquifyStyle>): void;
  /** the picture a layer had when liquify first touched it (what "restore" blends back toward); dropped when another tool is chosen */
  liquifyBase: { layerId: string; raw: RawImage } | null;
  setLiquifyBase(base: { layerId: string; raw: RawImage } | null): void;
  warpUi: WarpUi;
  warpSession: WarpSession | null;
  /** a warp drag in progress: shown live, recorded only by commitWarpPreview */
  warpPreview: { layerId: string; warp: LayerWarp } | null;
  /** the original picture ("배경(원본)" row of the layer panel) is the thing selected (no layer, no patch). UI only, never saved. */
  sourceSelected: boolean;
};

type EditorActions = {
  newProject(input: { fileName: string; raw: RawImage; blob?: Blob; name?: string }): void;
  /** a project with no screenshot: a plain page of the chosen size and colour. Returns an error text, or null when it was made. */
  newBlankProject(input: { width: number; height: number; color: string; name?: string }): string | null;
  loadProject(project: Project, images: ImageCache): void;
  snapshotProject(): Project | null;

  beginExtraction(rect: Rect): ExtractionResult;
  confirmExtraction(hex: string): ExtractionResult;
  cancelExtraction(): void;

  previewLayerDrag(layerId: string, x: number, y: number): void;
  commitLayerDrag(): boolean;
  cancelLayerDrag(): void;
  /** Alt+drag: the drag ends with COPIES of the moved layers at the dropped place; the originals stay. One undo step; the copies are selected.
   *  A whole group is copied as a new group. Locked layers are not copied. False when nothing moved. */
  commitLayerDragAsCopy(): boolean;

  duplicateLayer(layerId: string): string | null;
  copyLayer(layerId: string, hash?: string): boolean;
  clearLayerClipboard(): void;
  /** a message for the user about something that did not work (shown until dismissed) */
  setNotice(message: string | null): void;
  pasteLayer(): string | null;
  /** Adds a picture from outside (Ctrl+V of an external image, a file dropped on the canvas) as a NEW bitmap layer, centred in the frame and
   *  shrunk (never enlarged) to fit when it is bigger. Each one after the first lands DUPLICATE_OFFSET further down and right. One undo step.
   *  Null when refused (comparing, no project). The raw picture is kept as it is; the shrinking is the layer's scale. */
  addImageLayer(input: { raw: RawImage; blob?: Blob; name: string }): string | null;
  deleteLayer(layerId: string): boolean;
  reorderLayer(layerId: string, direction: 1 | -1): boolean;
  /** all the way to the front or the back (one undo step); false at that end already */
  reorderLayerTo(layerId: string, end: "front" | "back"): boolean;
  /** every layer that is not selected becomes the selection, and the selected ones are let go */
  invertSelection(): void;
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
  commitBitmapEdit(edit: { layerId: string | null; raw: RawImage; x: number; y: number; label: string; /** the eraser may edit an extracted or pasted bitmap layer; the brush only its own */ erase?: boolean }): string | null;
  /** Moves a layer by (dx, dy) pixels, for the arrow keys. Presses on the same layer within NUDGE_MERGE_MS ms of each other are ONE undo step
   *  (holding a key is not fifty steps). Refused for a locked layer and while comparing. */
  nudgeLayer(layerId: string, dx: number, dy: number): boolean;
  /** Moves several layers by the same (dx, dy), the keyboard version of dragging a selection. A locked layer stays where it is (and when
   *  every one is locked nothing moves). Presses on the same set of layers close together are one undo step. */
  nudgeLayers(layerIds: readonly string[], dx: number, dy: number): boolean;
  /** add the layer to the selection, or take it out when it is in. `whole`: a layer in a group stands for the whole group. */
  toggleLayerSelection(layerId: string, whole?: boolean): void;
  /** the layer a range selection (Shift+click in the panel) starts from: the last layer clicked */
  selectionAnchor: string | null;
  /** groups folded shut in the layer panel (UI only, not saved) */
  collapsedGroups: string[];
  /** a click on a layer in the canvas: the layer, or all of its group when it is in one */
  selectLayerWithGroup(layerId: string): void;
  /** Shift+click in the layer panel: every row from the anchor to this layer, in the panel's order (hidden and locked ones too) */
  selectRange(layerId: string): void;
  selectGroup(groupId: string): void;
  /** the free-transform box is on for a single layer too (with two or more layers selected it is always shown) */
  freeTransform: boolean;
  setFreeTransform(on: boolean): void;
  /** what the dragged free-transform handle would do, shown on the canvas without any history; null when nothing is being dragged */
  ftPreview: Record<string, LayerResult> | null;
  setFreeTransformPreview(op: FreeOp | null): void;
  /** Change the page size (1..8192 each side). `ax`/`ay` (0 = left/top, 1 = centre, 2 = right/bottom) say where the old page sits in the new one;
   *  the capture is copied onto a new picture of the new size (margin = `fill`, or transparent), so cropping drops the part outside. Layers follow the
   *  picture ("follow") or keep their page positions ("stay"). One undo step. Returns an error text, or null. */
  resizeCanvas(change: { width: number; height: number; ax: 0 | 1 | 2; ay: 0 | 1 | 2; layers: "follow" | "stay"; fill: string | null }): string | null;
  /** a shape, text or effect layer becomes a bitmap layer (what is on the page now, effects included; the part outside the page is dropped), one undo step */
  rasterizeLayer(layerId: string): boolean;
  /** the visible, unlocked selected layers (two or more) become ONE bitmap layer at the front-most one's place, one undo step; the number merged */
  mergeSelected(): number;
  /** the selected layer and the visible one right below it become one bitmap (Ctrl+E) */
  mergeDown(): number;
  /** every visible, unlocked layer becomes one bitmap (Ctrl+Shift+E); the capture and the background patches are not part of it */
  mergeAll(): number;
  /** image adjustments of a bitmap layer (null removes them); one undo step. A shape or text layer, a locked layer, comparing and out-of-range values refuse. */
  setLayerAdjust(layerId: string, adjust: LayerAdjust | null): boolean;
  /** while an adjustment slider is dragged: shown on the canvas from a reduced copy, no history */
  adjustPreview: { layerId: string; adjust: LayerAdjust } | null;
  setAdjustPreview(preview: { layerId: string; adjust: LayerAdjust } | null): void;
  /** drop shadow, outline and colour overlay of a layer (null removes them all); one undo step. A locked layer, comparing or invalid values refuse. */
  setLayerEffects(layerId: string, effects: LayerEffects | null): boolean;
  /** while an effect slider is dragged: shown on the canvas, no history */
  effectsPreview: { layerId: string; effects: LayerEffects } | null;
  setEffectsPreview(preview: { layerId: string; effects: LayerEffects } | null): void;
  /** the grid: shown over the page while editing (never in the PNG), and optionally a drag lands on its lines. Editing aids only; not saved. */
  grid: { on: boolean; size: number; snap: boolean };
  setGrid(change: Partial<{ on: boolean; size: number; snap: boolean }>): void;
  /** layer opacity 0..1 (one undo step; a locked layer or comparing refuses) */
  setLayerOpacity(layerId: string, opacity: number): boolean;
  /** while the opacity slider is dragged: shown on the canvas, no history */
  opacityPreview: { layerId: string; opacity: number } | null;
  setOpacityPreview(preview: { layerId: string; opacity: number } | null): void;
  /** how the layer mixes with what is below it; null = normal (one undo step; a locked layer or comparing refuses) */
  setLayerBlend(layerId: string, mode: BlendMode | null): boolean;
  /** mirror a layer left-right or top-bottom about its own centre (one undo step). A bitmap gets a negative scale, a line swaps its diagonal;
   *  a rectangle or ellipse looks the same, a text box and a warped layer are refused with a reason. */
  flipLayer(layerId: string, axis: "x" | "y"): boolean;
  /** line the selected layers up (to each other; one unit alone: to the frame). A group counts as one unit. One undo step; the number moved. */
  alignSelected(kind: AlignKind): number;
  /** equal gaps between three or more units, horizontally or vertically (one undo step); the number moved */
  distributeSelected(axis: "x" | "y"): number;
  /** apply a free transform (scale, turn or move) to every selected layer that is not locked: ONE undo step. False with a notice when refused. */
  applyFreeTransform(op: FreeOp): boolean;
  /** the selection is exactly these layers (ids that are not in the screen are dropped): the result of a box selection */
  setLayerSelection(layerIds: readonly string[]): void;
  deselectAll(): void;
  /** Ctrl+G: the selected layers (two or more) become one group, as one undo step; the group's id */
  groupSelected(): string | null;
  /** put layers into an existing group (one undo step); false with a notice when locked, nested or comparing. The stacking order is not changed. */
  addToGroup(groupId: string, layerIds: readonly string[]): boolean;
  /** take layers out of their groups (one undo step); how many. A group left with fewer than two layers is dissolved. */
  removeFromGroup(layerIds: readonly string[]): number;
  /** Ctrl+Shift+G: every group that has a selected layer is dissolved (layers stay), one undo step; how many */
  ungroupSelected(): number;
  renameGroup(groupId: string, name: string): boolean;
  toggleGroupCollapsed(groupId: string): void;
  /** copies of every layer of the group, as a new group, one undo step */
  duplicateGroup(groupId: string): string[] | null;
  /** every layer */
  selectAllLayers(): void;
  /** delete every selected layer that is not locked, as one undo step; the number deleted. Locked ones stay, with a notice. */
  deleteSelectedLayers(): number;
  setSnapEnabled(enabled: boolean): void;
  setSnapGuides(guides: Guide[]): void;
  /** a new vector layer at (x, y) (its top-left, in frame pixels); one undo step */
  addVectorLayer(content: LayerContent, x: number, y: number): string | null;
  /** change a vector layer's look (colours, stroke width); one undo step, refused on a locked layer */
  setLayerContent(layerId: string, change: Partial<{ stroke: string | null; fill: string | null; strokeWidth: number; cornerRadius: number }>): boolean;
  /** while the radius slider is being dragged: shown on the canvas at once, NOT in the history (the commit on release is `setLayerContent`) */
  cornerPreview: { layerId: string; cornerRadius: number } | null;
  setCornerPreview(preview: { layerId: string; cornerRadius: number } | null): void;
  /** Warps a bitmap layer (skew, perspective, distortion, mesh) without touching its pixels, or removes the warp (null, or one that changes
   *  nothing). One undo step. Refused for a locked layer, a vector layer, an unacceptable shape, and while comparing. */
  setLayerWarp(layerId: string, warp: LayerWarp | null): boolean;
  /** show a warp while the pointer is still down; nothing is recorded until commitWarpPreview */
  previewWarp(layerId: string, warp: LayerWarp): void;
  commitWarpPreview(): boolean;
  cancelWarpPreview(): void;
  /** switch the layer between corner handles (quad) and a control-point grid (mesh), or change the grid's size, keeping the present shape. One undo step. */
  convertWarp(layerId: string, target: WarpUi): boolean;
  setWarpUi(change: Partial<WarpUi>): void;
  /** leave the warp tool: confirmed keeps what was done; cancelled takes every step made since the tool started back */
  finishWarp(confirm: boolean): void;
  /** Puts a source (a group of layers) into the screen as NEW layers on top, in one undo step, and selects them. "center": the group's box is
   *  centred in the frame; "keep": its layers stay where the bundle puts them (a template's layers). Bitmap pictures get new imageIds.
   *  Returns the new layer ids, or null when refused (comparing, no project, nothing to add, a layer that is not valid). */
  insertAsset(bundle: AssetBundle, mode: "center" | "keep"): string[] | null;
  setFingerStyle(change: Partial<FingerStyle>): void;
  /** Puts the result of a finger stroke on a bitmap layer: `raw` (same size as the layer's bitmap) becomes the layer's picture under a NEW
   *  imageId, and the old picture stays for undo; the history holds only the imageId change. One undo step. Refused (false) for a locked or
   *  vector layer, while comparing, or when the size differs. Old versions are released by the memory budget (IMAGE_VERSION_BUDGET). */
  commitSmudge(layerId: string, raw: RawImage, label?: string): boolean;
  /** select the original picture as the target of the brush, finger, liquify and image adjustments (no layer or patch is then selected) */
  selectSource(): void;
  /** lock or unlock the original (one undo step). Locked is the default: every tool refuses it. Refused while comparing. */
  setSourceLocked(locked: boolean): boolean;
  /** Puts `raw` (the size of the page) on the unlocked original as its new picture under a NEW imageId, one undo step. The first time, the picture
   *  that was uploaded is kept as `source.originalImageId`. Refused (false) while locked or comparing, or when the size differs. */
  commitSourceEdit(raw: RawImage, label: string): boolean;
  /** "back to the original": the original is the picture that was uploaded again, all the edits of it in ONE undo step. Needs the original unlocked and edited. */
  revertSource(): boolean;
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
  setCandidateStatus(status: "idle" | "running" | "error", error?: string | null): void;
  setCandidates(set: CandidateSet | null): void;
  /** light up the smallest candidate under the pointer (null: none) */
  hoverCandidateAt(point: { x: number; y: number } | null): void;
  /** a click on a spot of the picture: the smallest candidate under it, or, clicking about the same spot again, the next larger one.
   *  False (and nothing chosen) when there is no candidate there, no analysis yet, or while comparing. */
  pickCandidateAt(point: { x: number; y: number }): boolean;
  /** hand the chosen candidate's box to the ordinary extraction (background colour, undo step, all as if it had been dragged out) */
  extractCandidatePick(): ExtractionResult | null;
  clearCandidatePick(): void;

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
export type EditorStoreOptions = { /** how a vector layer is drawn to a picture (the canvas one in the browser; tests pass a stand-in) */ rasterize?: Rasterize; /** bytes the replaced bitmaps may take (see IMAGE_VERSION_BUDGET) */ imageBudget?: number; genId?: () => string; /** how wide a string is at a font size; the canvas's own measure in the browser */ measure?: MeasureFor; /** the clock, so tests can say how much time passed between two key presses */ now?: () => number };

/** key presses on the same layer closer together than this are one undo step */
export const NUDGE_MERGE_MS = 600;

export const selectProject = (s: EditorState) => s.history?.present ?? null;
/** any effect object at all (even switched off: the values are kept) */
const hasAnyEffect = (e: LayerEffects) => !!(e.shadow || e.stroke || e.overlay);
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

export function createEditorStore({ rasterize = rasterizeVectorLayer, imageBudget = IMAGE_VERSION_BUDGET, genId = () => crypto.randomUUID(), now = () => Date.now(), measure = canvasMeasureFor }: EditorStoreOptions = {}): EditorStoreApi {
  /** the last keyboard move: which layer, when, and the undo entry it made, so the next press can fold into it */
  /** how many outside pictures were added since the project was opened, for the staggering of repeated pastes */
  let externalPastes = 0;
  let lastNudge: { layerId: string; at: number; entry: unknown; dx: number; dy: number } | null = null;
  const store = createStore<EditorStore>()((set, get) => {
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
    /** moves the selected layers (not locked, hidden ones too) by per-unit deltas from `deltas(units)`; one undo step; the number of layers moved */
    const moveUnits = (deltas: (units: ReturnType<typeof makeUnits>) => { dx: number; dy: number }[] | null, label: string, needed: number): number => {
      const { history } = get();
      const screen = screenOf();
      if (!history || !screen) return 0;
      if (frozen()) {
        set({ notice: "비교 보기 중에는 정렬할 수 없습니다. 비교를 끄고 다시 시도해 주세요." });
        return 0;
      }
      const chosen = screen.layers.filter((l) => get().selectedLayerIds.includes(l.id));
      const free = chosen.filter((l) => !l.locked && l.visible);
      const items = sortByZ(free).map((l) => ({ id: l.id, groupId: l.groupId, box: layerBox(l, l.imageId ? get().images.get(l.imageId)?.raw : undefined) })).filter((i): i is { id: string; groupId: string | undefined; box: NonNullable<ReturnType<typeof layerBox>> } => !!i.box);
      const units = makeUnits(items);
      if (units.length < (needed === 1 ? 1 : needed)) {
        set({ notice: needed === 3 ? "간격을 맞추려면 (그룹은 하나로 세어) 3개 이상을 선택하세요." : chosen.length > free.length && free.length === 0 ? "잠기거나 숨겨진 레이어는 정렬할 수 없습니다." : "정렬할 레이어를 선택하세요." });
        return 0;
      }
      const d = deltas(units);
      if (!d) return 0;
      const byId = new Map<string, { dx: number; dy: number }>();
      units.forEach((u, i) => u.ids.forEach((id) => byId.set(id, d[i])));
      if ([...byId.values()].every((v) => v.dx === 0 && v.dy === 0)) return 0;
      set({
        history: commit(history, label, (draft) => {
          for (const l of draft.screens[0].layers) {
            const m = byId.get(l.id);
            if (!m) continue;
            l.transform.x = Math.round((l.transform.x + m.dx) * 100) / 100;
            l.transform.y = Math.round((l.transform.y + m.dy) * 100) / 100;
          }
        }),
      });
      const skipped = chosen.length - free.length;
      if (skipped > 0) set({ notice: `잠기거나 숨겨진 레이어 ${skipped}개는 움직이지 않았습니다.` });
      return byId.size;
    };

    /** the given layers drawn together on a transparent page of their own size (union of their boxes and effects, cut to the page); positions are
     *  shifted so the box starts at (0, 0). Their own opacity, blend and effects count; hidden ones are not part of it. Null when nothing shows. */
    const bakeLayers = (layers: readonly BitmapLayer[]): { raw: RawImage; x: number; y: number } | null => {
      const screen = screenOf();
      if (!screen) return null;
      const imgs = get().images;
      const shown = sortByZ(layers.filter((l) => l.visible));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const l of shown) {
        const b = layerBox(l, l.imageId ? imgs.get(l.imageId)?.raw : undefined);
        if (!b) continue;
        const m = l.effects ? effectMargin(l.effects) : 0;
        x0 = Math.min(x0, b.x - m); y0 = Math.min(y0, b.y - m); x1 = Math.max(x1, b.x + b.width + m); y1 = Math.max(y1, b.y + b.height + m);
      }
      x0 = Math.max(Math.floor(x0), 0); y0 = Math.max(Math.floor(y0), 0); x1 = Math.min(Math.ceil(x1), screen.width); y1 = Math.min(Math.ceil(y1), screen.height);
      if (!(x1 > x0 && y1 > y0)) return null;
      const frame = { width: x1 - x0, height: y1 - y0 };
      const rl: RenderLayer[] = [];
      for (const l of shown) {
        const moved = { ...l, transform: { ...l.transform, x: l.transform.x - x0, y: l.transform.y - y0 } };
        const r = renderLayerOf(moved, imgs, frame, rasterize);
        if (r) rl.push({ ...r, zIndex: rl.length });
      }
      const raw = renderComposite({ width: frame.width, height: frame.height, source: createRawImage(frame.width, frame.height), patches: [], layers: rl });
      return raw.data.some((v, i) => i % 4 === 3 && v > 0) ? { raw, x: x0, y: y0 } : null;
    };

    /** the layers become one bitmap layer at the front-most one's place (one undo step); how many were merged */
    const mergeInto = (picked: readonly BitmapLayer[], label: string): number => {
      const { history } = get();
      const screen = screenOf();
      if (!history || !screen || frozen()) return 0;
      const free = picked.filter((l) => !l.locked && l.visible);
      if (free.length < 2) {
        set({ notice: picked.some((l) => l.locked) ? "잠긴 레이어는 병합할 수 없습니다. 보이고 잠기지 않은 레이어가 둘 이상 필요합니다." : "병합하려면 보이는 레이어가 둘 이상 필요합니다." });
        return 0;
      }
      const made = bakeLayers(free);
      if (!made) {
        set({ notice: "페이지 안에 보이는 부분이 없어 병합할 수 없습니다." });
        return 0;
      }
      const top = sortByZ(free).at(-1)!;
      const imageId = genId();
      const id = genId();
      const merged: BitmapLayer = {
        id,
        name: label === "병합" || label === "아래와 병합" || label === "전체 병합" ? `병합 ${nextNumberFor(screen.layers, "병합")}` : label,
        crop: { x: 0, y: 0, width: made.raw.width, height: made.raw.height },
        imageId,
        transform: { x: made.x, y: made.y, scaleX: 1, scaleY: 1, rotation: 0 },
        zIndex: top.zIndex + 0.5,
        opacity: 1,
        visible: true,
        locked: false,
      };
      const gone = new Set(free.map((l) => l.id));
      const list = normalizeZ([...screen.layers.filter((l) => !gone.has(l.id)), merged]);
      const nextImages = new Map(get().images).set(imageId, { raw: made.raw });
      set({
        history: commit(history, label, (draft) => {
          applyLayers(draft.screens[0].layers, list);
          pruneGroups(draft.screens[0]); // a group left with fewer than two layers is dissolved
        }),
        images: nextImages,
        selectedLayerIds: [id],
        selectedPatchId: null,
      });
      return free.length;
    };

    const commitLayers = (label: string, next: readonly BitmapLayer[]) => {
      const history = get().history!;
      set({
        history: commit(history, label, (draft) => {
          applyLayers(draft.screens[0].layers, next);
          pruneGroups(draft.screens[0]); // a group left with fewer than two layers (deleted, or pasted away) is dissolved
        }),
      });
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

    const reset = (project: Project, images: ImageCache) => {
      externalPastes = 0;
      set({
        history: createHistory(project),
        images,
        view: { ...project.canvas },
        needsFit: false,
        activeTool: "select",
        selectedMemoId: null,
        candidates: null,
        candidateStatus: "idle",
        candidateError: null,
        candidatePick: null,
        candidateHover: null,
        snapGuides: [],
        selectedLayerIds: [],
        sourceSelected: false,
        selectedPatchId: null,
        pendingExtraction: null,
        layerClipboard: null, // it points at bitmaps of the project that was just replaced
      selectionAnchor: null,
      cornerPreview: null,
      grid: { on: false, size: 16, snap: false },
      opacityPreview: null,
      effectsPreview: null,
      adjustPreview: null,
      freeTransform: false,
      ftPreview: null,
      collapsedGroups: [],
        compareMode: "off",
        dragPreview: null,
        warpPreview: null,
        warpSession: null,
      });
    };

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
      candidates: null,
      candidateStatus: "idle",
      candidateError: null,
      candidatePick: null,
      candidateHover: null,
      snapEnabled: true,
      selectionAnchor: null,
      cornerPreview: null,
      grid: { on: false, size: 16, snap: false },
      opacityPreview: null,
      effectsPreview: null,
      adjustPreview: null,
      freeTransform: false,
      ftPreview: null,
      collapsedGroups: [],
      snapGuides: [],
      textEditing: null,
      selectedMemoId: null,
      dragPreview: null,
      fingerStyle: DEFAULT_FINGER_STYLE,
      sourceSelected: false,
      liquifyStyle: DEFAULT_LIQUIFY_STYLE,
      liquifyBase: null,
      warpUi: DEFAULT_WARP_UI,
      warpSession: null,
      warpPreview: null,

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

      newBlankProject({ width, height, color, name }) {
        const size = checkCanvasSize(width, height);
        if (!size.ok) return size.error;
        const hex = normalizeHex(color);
        const rgb = hex && hexToRgb(hex);
        if (!hex || !rgb) return "배경색은 #rrggbb 형식이어야 합니다.";
        const imageId = genId();
        // the page is the source picture (its colour never changes) plus one patch over the whole frame: the patch is what "change the
        // background colour" edits later, with the same fill tool as any other patch
        reset(
          {
            id: genId(),
            name: name?.trim() || "빈 캔버스",
            version: CURRENT_VERSION,
            canvas: { zoom: 1, panX: 0, panY: 0 },
            screens: [
              {
                id: genId(),
                name: "화면 1",
                x: 0,
                y: 0,
                width: size.width,
                height: size.height,
                source: { imageId, fileName: BLANK_FILE },
                backgroundPatches: [{ id: genId(), rect: { x: 0, y: 0, width: size.width, height: size.height }, fill: hex }],
                layers: [],
              },
            ],
          },
          new Map([[imageId, { raw: createRawImage(size.width, size.height, [rgb.r, rgb.g, rgb.b, 255]) }]]),
        );
        set({ needsFit: true });
        return null;
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
        const { history, dragPreview, selectedLayerIds } = get();
        set({ dragPreview: null, snapGuides: [] });
        if (!history || !dragPreview || frozen()) return false;
        const { layerId, x, y } = dragPreview;
        const layers = screenOf()?.layers ?? [];
        const dragged = layers.find((l) => l.id === layerId);
        if (!dragged || dragged.locked) return false;
        // dragging a selected layer drags the whole selection by the same distance; a locked one stays where it is
        const group = selectedLayerIds.includes(layerId) ? selectedLayerIds : [layerId];
        const movers = layers.filter((l) => group.includes(l.id) && !l.locked).map((l) => l.id);
        const dx = x - dragged.transform.x;
        const dy = y - dragged.transform.y;
        const next = commit(history, movers.length > 1 ? "레이어 이동(여러 개)" : "레이어 이동", (draft) => {
          for (const l of draft.screens[0].layers) {
            if (!movers.includes(l.id)) continue;
            if (l.id === layerId) {
              l.transform.x = x; // unchanged values make no patch, so a click without movement records nothing
              l.transform.y = y;
            } else {
              l.transform.x = Math.round((l.transform.x + dx) * 100) / 100;
              l.transform.y = Math.round((l.transform.y + dy) * 100) / 100;
            }
          }
        });
        if (next === history) return false;
        set({ history: next, selectedLayerIds: group, selectedPatchId: null });
        return true;
      },

      cancelLayerDrag: () => set({ dragPreview: null, snapGuides: [] }),

      commitLayerDragAsCopy() {
        const { history, dragPreview, selectedLayerIds } = get();
        set({ dragPreview: null, snapGuides: [] });
        const screen = screenOf();
        if (!history || !dragPreview || !screen || frozen()) return false;
        const dragged = screen.layers.find((l) => l.id === dragPreview.layerId);
        if (!dragged) return false;
        const dx = dragPreview.x - dragged.transform.x, dy = dragPreview.y - dragged.transform.y;
        if (dx === 0 && dy === 0) return false;
        const group = selectedLayerIds.includes(dragged.id) ? selectedLayerIds : [dragged.id];
        const sources = sortByZ(screen.layers.filter((l) => group.includes(l.id) && !l.locked));
        if (sources.length === 0) return false;
        const whole = wholeGroupOf(screen.layers, sources.map((l) => l.id));
        const gid = whole && (screen.groups?.length ?? 0) < MAX_GROUPS ? genId() : null;
        const copies: BitmapLayer[] = sources.map((s) => {
          const { groupId: _g, ...plain } = s;
          void _g;
          return { ...plain, ...(gid ? { groupId: gid } : {}), id: genId(), name: `${s.name} 복사`, visible: true, locked: false, crop: { ...s.crop }, transform: { ...s.transform, x: Math.round((s.transform.x + dx) * 100) / 100, y: Math.round((s.transform.y + dy) * 100) / 100 } };
        });
        let list: readonly BitmapLayer[] = screen.layers;
        for (const c of copies) list = addOnTop(list, c); // back to front: the copies keep their stacking
        const gname = whole ? `${screen.groups?.find((g) => g.id === whole)?.name ?? "그룹"} 복사`.slice(0, MAX_GROUP_NAME) : "";
        set({
          history: commit(history, copies.length > 1 ? "레이어 복제 이동(여러 개)" : "레이어 복제 이동", (draft) => {
            applyLayers(draft.screens[0].layers, list);
            if (gid) (draft.screens[0].groups ??= []).push({ id: gid, name: gname });
          }),
          selectedLayerIds: copies.map((c) => c.id),
          selectionAnchor: copies[0].id,
        });
        return true;
      },

      duplicateLayer(layerId) {
        if (frozen()) return null;
        const screen = screenOf();
        const source = screen?.layers.find((l) => l.id === layerId);
        if (!screen || !source) return null;
        const { groupId: _g, ...plain } = source; // a copy of one layer belongs to no group
        void _g;
        const copy: BitmapLayer = {
          ...plain,
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
        const { groupId: _g, ...plain } = source; // pasted alone: in no group
        void _g;
        const copy: BitmapLayer = {
          ...plain,
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

      addImageLayer({ raw, blob, name }) {
        const { history, images } = get();
        const screen = screenOf();
        if (frozen() || !history || !screen || raw.width < 1 || raw.height < 1) return null;
        const fit = Math.min(1, screen.width / raw.width, screen.height / raw.height);
        const shift = DUPLICATE_OFFSET * externalPastes;
        const w = raw.width * fit;
        const h = raw.height * fit;
        const round = (v: number) => (fit === 1 ? Math.round(v) : Math.round(v * 100) / 100);
        const imageId = genId();
        const id = genId();
        const layer: BitmapLayer = {
          id,
          name: name.trim().slice(0, MAX_LAYER_NAME) || `붙여넣기 ${nextNumberFor(screen.layers, "붙여넣기")}`,
          crop: { x: 0, y: 0, width: raw.width, height: raw.height },
          imageId,
          transform: { x: round((screen.width - w) / 2 + shift), y: round((screen.height - h) / 2 + shift), scaleX: fit, scaleY: fit, rotation: 0 },
          zIndex: 0,
          opacity: 1,
          visible: true,
          locked: false,
        };
        externalPastes++;
        set({ images: new Map(images).set(imageId, { raw, blob }) });
        commitLayers("이미지 붙여넣기", addOnTop(screen.layers, layer));
        set({ selectedLayerIds: [id], selectedPatchId: null, activeTool: "select" });
        return id;
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

      reorderLayerTo(layerId, end) {
        const screen = screenOf();
        if (!screen || frozen()) return false;
        let next: readonly BitmapLayer[] = screen.layers;
        for (let i = 0; i < screen.layers.length; i++) next = moveLayer(next, layerId, end === "front" ? 1 : -1);
        if (drawOrder(next) === drawOrder(screen.layers)) return false;
        commitLayers(end === "front" ? "레이어 맨 앞으로" : "레이어 맨 뒤로", next);
        return true;
      },

      invertSelection() {
        const screen = screenOf();
        if (!screen) return;
        const chosen = get().selectedLayerIds;
        const ids = screen.layers.filter((l) => !chosen.includes(l.id)).map((l) => l.id);
        set({ selectedLayerIds: ids, selectionAnchor: ids[0] ?? null, selectedPatchId: null, selectedMemoId: null, sourceSelected: false });
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
              if (box.kind === "rect" && box.cornerRadius !== undefined) (l.content as { cornerRadius?: number }).cornerRadius = box.cornerRadius; // kept inside half of the new shorter side
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

      nudgeLayer: (layerId, dx, dy) => get().nudgeLayers([layerId], dx, dy),

      nudgeLayers(layerIds, dx, dy) {
        const { history } = get();
        const layers = screenOf()?.layers ?? [];
        const movers = layerIds.filter((id) => layers.some((l) => l.id === id && !l.locked));
        if (frozen() || !history || movers.length === 0 || ![dx, dy].every(Number.isFinite) || (dx === 0 && dy === 0)) return false;
        const key = [...movers].sort().join("|");
        const t = now();
        const fold = lastNudge && lastNudge.layerId === key && t - lastNudge.at <= NUDGE_MERGE_MS && history.past.at(-1) === lastNudge.entry;
        // folding: step back over the previous press and make one move of the total, so the history has a single entry for the burst
        const base = fold ? undo(history) : history;
        const total = fold ? { dx: lastNudge!.dx + dx, dy: lastNudge!.dy + dy } : { dx, dy };
        const moved = commit(base, movers.length > 1 ? "레이어 이동(키보드, 여러 개)" : "레이어 이동(키보드)", (draft) => {
          for (const l of draft.screens[0].layers) {
            if (!movers.includes(l.id)) continue;
            l.transform.x = Math.round((l.transform.x + total.dx) * 100) / 100;
            l.transform.y = Math.round((l.transform.y + total.dy) * 100) / 100;
          }
        });
        const selection = movers.length === 1 && layerIds.length === 1 ? { selectedLayerIds: movers } : {};
        if (moved === base) {
          // the burst netted out to nothing: the earlier press is already undone, so keep that and leave no step behind
          if (fold) {
            lastNudge = null;
            set({ history: base, selectedPatchId: null, ...selection });
            return true;
          }
          return false;
        }
        lastNudge = { layerId: key, at: t, entry: moved.past.at(-1), ...total };
        set({ history: moved, selectedPatchId: null, ...selection });
        return true;
      },

      toggleLayerSelection(layerId, whole = false) {
        const screen = screenOf();
        if (!screen?.layers.some((l) => l.id === layerId)) return;
        const current = get().selectedLayerIds;
        const ids = whole ? expandToGroups(screen.layers, [layerId]) : [layerId];
        const removing = current.includes(layerId);
        set({
          selectedLayerIds: removing ? current.filter((id) => !ids.includes(id)) : [...current, ...ids.filter((id) => !current.includes(id))],
          selectionAnchor: layerId,
          selectedPatchId: null,
          selectedMemoId: null,
        });
      },

      selectLayerWithGroup(layerId) {
        const screen = screenOf();
        if (!screen?.layers.some((l) => l.id === layerId)) return;
        set({ selectedLayerIds: expandToGroups(screen.layers, [layerId]), selectionAnchor: layerId, selectedPatchId: null, selectedMemoId: null });
      },

      selectRange(layerId) {
        const screen = screenOf();
        if (!screen?.layers.some((l) => l.id === layerId)) return;
        const rows = panelRows(screen.layers, screen.groups ?? [], new Set(get().collapsedGroups));
        set({ selectedLayerIds: rangeSelect(rows, get().selectionAnchor, layerId), selectedPatchId: null, selectedMemoId: null }); // the anchor stays, so the range can be widened
      },

      setOpacityPreview: (opacityPreview) => set({ opacityPreview }),

      setLayerOpacity(layerId, opacity) {
        const layer = screenOf()?.layers.find((l) => l.id === layerId);
        if (!layer || layer.locked || !Number.isFinite(opacity)) return false;
        const v = Math.min(Math.max(Math.round(opacity * 100) / 100, 0), 1);
        if (layer.opacity === v) return false;
        return editLayer(layerId, "불투명도 변경", (l) => {
          l.opacity = v;
        });
      },

      resizeCanvas({ width, height, ax, ay, layers, fill }) {
        const { history, images } = get();
        const screen = screenOf();
        if (!history || !screen) return "열려 있는 프로젝트가 없습니다.";
        if (frozen()) return "비교 보기 중에는 캔버스 크기를 바꿀 수 없습니다. 비교를 끄고 다시 시도해 주세요.";
        const size = checkCanvasSize(width, height);
        if (!size.ok) return size.error;
        const rgb = fill === null ? null : hexToRgb(fill);
        if (fill !== null && !rgb) return "여백 색은 #rrggbb 형식이어야 합니다.";
        if (size.width === screen.width && size.height === screen.height) return "크기가 그대로입니다.";
        const old = images.get(screen.source.imageId)?.raw;
        if (!old) return "원본 이미지가 로드되어 있지 않습니다.";
        const dx = Math.round(((size.width - screen.width) * ax) / 2), dy = Math.round(((size.height - screen.height) * ay) / 2);
        const next = createRawImage(size.width, size.height, rgb ? [rgb.r, rgb.g, rgb.b, 255] : [0, 0, 0, 0]);
        for (let y = 0; y < old.height; y++) {
          const ty = y + dy;
          if (ty < 0 || ty >= size.height) continue;
          const sx0 = Math.max(0, -dx), sx1 = Math.min(old.width, size.width - dx);
          if (sx1 > sx0) next.data.set(old.data.subarray((y * old.width + sx0) * 4, (y * old.width + sx1) * 4), (ty * size.width + sx0 + dx) * 4);
        }
        const imageId = genId();
        const shiftBy = layers === "follow" ? { x: dx, y: dy } : { x: 0, y: 0 };
        set({
          history: commit(history, "캔버스 크기", (draft) => {
            const s = draft.screens[0];
            s.width = size.width;
            s.height = size.height;
            s.source.imageId = imageId;
            delete s.source.originalImageId; // the new page is the baseline: "the original" is now the resized picture (the uploaded one has another size)
            // the patches belong to the picture: they move with it and are cut to the new page
            s.backgroundPatches = s.backgroundPatches.flatMap((p) => {
              const x0 = Math.max(p.rect.x + dx, 0), y0 = Math.max(p.rect.y + dy, 0), x1 = Math.min(p.rect.x + dx + p.rect.width, size.width), y1 = Math.min(p.rect.y + dy + p.rect.height, size.height);
              return x1 > x0 && y1 > y0 ? [{ ...p, rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } }] : [];
            });
            for (const l of s.layers) {
              l.transform.x = Math.round((l.transform.x + shiftBy.x) * 100) / 100;
              l.transform.y = Math.round((l.transform.y + shiftBy.y) * 100) / 100;
            }
            if (s.memos) s.memos = s.memos.map((m) => ({ ...m, x: Math.min(Math.max(m.x + shiftBy.x, 0), size.width), y: Math.min(Math.max(m.y + shiftBy.y, 0), size.height) }));
          }),
          images: new Map(images).set(imageId, { raw: next }),
          needsFit: true,
          selectedPatchId: null,
        });
        return null;
      },

      rasterizeLayer(layerId) {
        const { history } = get();
        const screen = screenOf();
        const layer = screen?.layers.find((l) => l.id === layerId);
        if (!history || !screen || !layer || frozen()) return false;
        if (layer.locked) {
          set({ notice: "잠긴 레이어는 래스터화할 수 없습니다." });
          return false;
        }
        if (!layer.content && !layer.effects && !layer.adjust) {
          set({ notice: "이미 이미지 레이어이고 효과도 없습니다." });
          return false;
        }
        const made = bakeLayers([{ ...layer, opacity: 1, blend: undefined }]); // opacity and blend stay on the layer: they are applied when it is drawn, not baked in twice
        if (!made) {
          set({ notice: "페이지 안에 보이는 부분이 없어 래스터화할 수 없습니다." });
          return false;
        }
        const imageId = genId();
        const nextImages = new Map(get().images).set(imageId, { raw: made.raw });
        set({
          history: commit(history, "래스터화", (draft) => {
            const l = draft.screens[0].layers.find((d) => d.id === layerId);
            if (!l) return;
            delete l.content;
            delete l.effects;
            delete l.adjust;
            delete l.warp;
            delete l.drawn;
            l.imageId = imageId;
            l.crop = { x: 0, y: 0, width: made.raw.width, height: made.raw.height };
            l.transform = { x: made.x, y: made.y, scaleX: 1, scaleY: 1, rotation: 0 };
          }),
          images: nextImages,
          selectedLayerIds: [layerId],
        });
        return true;
      },

      mergeSelected() {
        const screen = screenOf();
        if (!screen) return 0;
        return mergeInto(screen.layers.filter((l) => get().selectedLayerIds.includes(l.id)), "병합");
      },

      mergeDown() {
        const screen = screenOf();
        const id = get().selectedLayerIds[0];
        if (!screen || !id || get().selectedLayerIds.length !== 1) {
          set({ notice: "아래와 병합은 레이어를 하나만 선택했을 때 쓸 수 있습니다." });
          return 0;
        }
        const ordered = sortByZ(screen.layers);
        const at = ordered.findIndex((l) => l.id === id);
        const below = ordered.slice(0, at).reverse().find((l) => l.visible);
        if (!below) {
          set({ notice: "아래에 병합할 보이는 레이어가 없습니다." });
          return 0;
        }
        return mergeInto([ordered[at], below], "아래와 병합");
      },

      mergeAll() {
        const screen = screenOf();
        if (!screen) return 0;
        return mergeInto(screen.layers, "전체 병합");
      },

      setGrid(change) {
        const next = { ...get().grid, ...change };
        const size = Number.isFinite(next.size) ? Math.min(Math.max(Math.round(next.size), 2), 512) : 16;
        set({ grid: { on: !!next.on, snap: !!next.snap, size } });
      },

      setAdjustPreview: (adjustPreview) => set({ adjustPreview }),

      setLayerAdjust(layerId, adjust) {
        const layer = screenOf()?.layers.find((l) => l.id === layerId);
        if (!layer || layer.locked || layer.content || !layer.imageId) return false;
        if (adjust !== null && adjustError(adjust)) return false;
        const next = adjust && hasAdjust(adjust) ? adjust : null;
        if (JSON.stringify(layer.adjust ?? null) === JSON.stringify(next)) return false;
        return editLayer(layerId, "이미지 조정", (l) => {
          if (next) l.adjust = { ...next };
          else delete l.adjust;
        });
      },

      setEffectsPreview: (effectsPreview) => set({ effectsPreview }),

      setLayerEffects(layerId, effects) {
        const layer = screenOf()?.layers.find((l) => l.id === layerId);
        if (!layer || layer.locked) return false;
        if (effects !== null && effectsError(effects)) return false;
        const next = effects && hasAnyEffect(effects) ? effects : null;
        if (JSON.stringify(layer.effects ?? null) === JSON.stringify(next)) return false;
        return editLayer(layerId, "레이어 효과", (l) => {
          if (next) l.effects = JSON.parse(JSON.stringify(next));
          else delete l.effects;
        });
      },

      setLayerBlend(layerId, mode) {
        const layer = screenOf()?.layers.find((l) => l.id === layerId);
        if (!layer || layer.locked || (mode !== null && !BLEND_MODES.includes(mode)) || (layer.blend ?? null) === mode) return false;
        return editLayer(layerId, "혼합 모드 변경", (l) => {
          if (mode) l.blend = mode;
          else delete l.blend;
        });
      },

      flipLayer(layerId, axis) {
        const layer = screenOf()?.layers.find((l) => l.id === layerId);
        if (!layer || frozen()) return false;
        if (layer.locked) {
          set({ notice: "잠긴 레이어는 뒤집을 수 없습니다." });
          return false;
        }
        const why = layer.warp ? "변형(warp)한 레이어는 뒤집을 수 없습니다. 먼저 변형을 초기화하세요." : layer.content?.kind === "text" ? "텍스트 상자는 뒤집을 수 없습니다(글자가 거꾸로 됩니다)." : layer.content && layer.content.kind !== "line" ? "사각형과 원은 뒤집어도 모양이 같습니다." : null;
        if (why) {
          set({ notice: why });
          return false;
        }
        if (layer.content) {
          return editLayer(layerId, axis === "x" ? "좌우 뒤집기" : "상하 뒤집기", (l) => {
            if (l.content?.kind === "line") l.content.direction = l.content.direction === "down" ? "up" : "down"; // either mirror turns the diagonal over
          });
        }
        const raw = layer.imageId ? get().images.get(layer.imageId)?.raw : undefined;
        const w = raw?.width ?? layer.crop.width, h = raw?.height ?? layer.crop.height;
        return editLayer(layerId, axis === "x" ? "좌우 뒤집기" : "상하 뒤집기", (l) => {
          const t = l.transform;
          const a = (t.rotation * Math.PI) / 180;
          const cos = Math.cos(a), sin = Math.sin(a);
          const at = (sx: number, sy: number) => ({ x: cos * (sx * w) / 2 - sin * (sy * h) / 2, y: sin * (sx * w) / 2 + cos * (sy * h) / 2 });
          const c = at(t.scaleX, t.scaleY); // the centre, from the corner
          const nx = axis === "x" ? -t.scaleX : t.scaleX, ny = axis === "y" ? -t.scaleY : t.scaleY;
          const c2 = at(nx, ny);
          l.transform.x = Math.round((t.x + c.x - c2.x) * 100) / 100;
          l.transform.y = Math.round((t.y + c.y - c2.y) * 100) / 100;
          l.transform.scaleX = nx;
          l.transform.scaleY = ny;
        });
      },

      alignSelected(kind) {
        const moved = moveUnits((units) => alignDeltas(units, kind, { x: 0, y: 0, width: screenOf()!.width, height: screenOf()!.height }), "정렬", 1);
        return moved;
      },

      distributeSelected(axis) {
        return moveUnits((units) => distributeDeltas(units, axis), "간격 맞춤", 3);
      },

      setFreeTransform: (on) => set({ freeTransform: on, ftPreview: null }),

      setFreeTransformPreview(op) {
        const screen = screenOf();
        if (!op || !screen || frozen()) return set({ ftPreview: null });
        const chosen = screen.layers.filter((l) => get().selectedLayerIds.includes(l.id));
        set({ ftPreview: Object.fromEntries(computeFreeTransform(chosen, op, measure)) });
      },

      applyFreeTransform(op) {
        const { history } = get();
        const screen = screenOf();
        set({ ftPreview: null });
        if (!history || !screen) return false;
        if (frozen()) {
          set({ notice: "비교 보기 중에는 변형할 수 없습니다. 비교를 끄고 다시 시도해 주세요." });
          return false;
        }
        const chosen = screen.layers.filter((l) => get().selectedLayerIds.includes(l.id));
        const results = computeFreeTransform(chosen, op, measure);
        if (results.size === 0) {
          set({ notice: chosen.length ? "잠긴 레이어는 변형할 수 없습니다." : "변형할 레이어를 선택하세요." });
          return false;
        }
        const same = (id: string) => {
          const l = chosen.find((x) => x.id === id)!;
          const r = results.get(id)!;
          return JSON.stringify(l.transform) === JSON.stringify(r.transform) && JSON.stringify(l.content) === JSON.stringify(r.content);
        };
        if ([...results.keys()].every(same)) return false; // nothing changes: no history entry
        set({
          history: commit(history, op.kind === "scale" ? "자유 변형: 크기" : op.kind === "rotate" ? "자유 변형: 회전" : "자유 변형: 이동", (draft) => {
            for (const l of draft.screens[0].layers) {
              const r = results.get(l.id);
              if (!r) continue;
              l.transform.x = r.transform.x;
              l.transform.y = r.transform.y;
              l.transform.scaleX = r.transform.scaleX;
              l.transform.scaleY = r.transform.scaleY;
              l.transform.rotation = r.transform.rotation;
              if (r.content && l.content) {
                l.content.width = r.content.width;
                l.content.height = r.content.height;
                if (r.content.kind === "rect") {
                  if (r.content.cornerRadius !== undefined) (l.content as { cornerRadius?: number }).cornerRadius = r.content.cornerRadius;
                }
              }
            }
          }),
        });
        const skipped = chosen.length - results.size;
        const warped = op.kind === "scale" ? [...results.keys()].filter((id) => chosen.find((x) => x.id === id)?.warp).length : 0;
        const notes = [skipped > 0 ? `잠긴 레이어 ${skipped}개는 변형되지 않았습니다.` : "", warped > 0 ? `변형(warp)한 레이어 ${warped}개는 크기가 바뀌지 않고 위치만 따라 움직였습니다.` : ""].filter(Boolean);
        if (notes.length) set({ notice: notes.join(" ") });
        return true;
      },

      selectGroup(groupId) {
        const screen = screenOf();
        const ids = screen?.layers.filter((l) => l.groupId === groupId).map((l) => l.id) ?? [];
        if (ids.length === 0) return;
        set({ selectedLayerIds: ids, selectionAnchor: ids[0], selectedPatchId: null, selectedMemoId: null });
      },

      setLayerSelection(layerIds) {
        const screen = screenOf();
        const ids = [...new Set(layerIds)].filter((id) => screen?.layers.some((l) => l.id === id));
        set({ selectedLayerIds: ids, selectionAnchor: ids[0] ?? null, selectedPatchId: null, selectedMemoId: null, sourceSelected: false });
      },

      deselectAll: () => set({ selectedLayerIds: [], selectionAnchor: null, selectedPatchId: null, selectedMemoId: null, sourceSelected: false }),

      selectAllLayers() {
        const screen = screenOf();
        if (!screen) return;
        set({ selectedLayerIds: screen.layers.map((l) => l.id), selectionAnchor: null, selectedPatchId: null, selectedMemoId: null });
      },

      groupSelected() {
        const { history } = get();
        const screen = screenOf();
        if (frozen() || !history || !screen) return null;
        const ids = get().selectedLayerIds.filter((id) => screen.layers.some((l) => l.id === id));
        if (ids.length < MIN_GROUP_SIZE) {
          set({ notice: "그룹으로 만들려면 레이어를 두 개 이상 선택하세요." });
          return null;
        }
        // which groups are selected WHOLE (all their layers), and which layers are loose (in no group)
        const wholeGroups = (screen.groups ?? []).filter((g) => screen.layers.filter((l) => l.groupId === g.id).every((l) => ids.includes(l.id)));
        const loose = ids.filter((id) => !screen.layers.find((l) => l.id === id)?.groupId);
        if (wholeGroups.length >= 2) {
          set({ notice: "그룹 안에 다른 그룹을 넣을 수 없습니다. 그룹은 한 단계만 만들 수 있습니다." });
          return null;
        }
        if (wholeGroups.length === 1 && loose.length > 0 && ids.length === loose.length + screen.layers.filter((l) => l.groupId === wholeGroups[0].id).length) {
          // one group and some loose layers: the layers join that group
          return get().addToGroup(wholeGroups[0].id, loose) ? wholeGroups[0].id : null;
        }
        if ((screen.groups?.length ?? 0) >= MAX_GROUPS && !ids.some((id) => screen.layers.find((l) => l.id === id)?.groupId)) {
          set({ notice: `그룹은 ${MAX_GROUPS}개까지 만들 수 있습니다.` });
          return null;
        }
        const gid = genId();
        const name = nextGroupName(screen.groups ?? []);
        const next = commit(history, "그룹 만들기", (draft) => {
          const s = draft.screens[0];
          (s.groups ??= []).push({ id: gid, name });
          // one level only: a layer that was in another group leaves it (and that group is dissolved if too few remain)
          for (const l of s.layers) if (ids.includes(l.id)) l.groupId = gid;
          pruneGroups(s);
        });
        set({ history: next, selectedLayerIds: ids, selectionAnchor: ids[0] });
        return gid;
      },

      addToGroup(groupId, layerIds) {
        const { history } = get();
        const screen = screenOf();
        if (frozen() || !history || !screen) return false;
        const group = screen.groups?.find((g) => g.id === groupId);
        const layers = screen.layers.filter((l) => layerIds.includes(l.id));
        if (!group || layers.length === 0) return false;
        const members = screen.layers.filter((l) => l.groupId === groupId);
        // a whole group cannot go into another group (one level only)
        const groupsOfMovers = new Set(layers.map((l) => l.groupId).filter((g): g is string => !!g && g !== groupId));
        for (const gid of groupsOfMovers) {
          const all = screen.layers.filter((l) => l.groupId === gid);
          if (all.every((l) => layerIds.includes(l.id))) {
            set({ notice: "그룹 안에 다른 그룹을 넣을 수 없습니다. 그룹은 한 단계만 만들 수 있습니다." });
            return false;
          }
        }
        if (layers.some((l) => l.locked) || members.some((l) => l.locked)) {
          set({ notice: "잠긴 레이어가 있어 그룹을 바꿀 수 없습니다. 잠금을 풀고 다시 시도하세요." });
          return false;
        }
        const moving = layers.filter((l) => l.groupId !== groupId);
        if (moving.length === 0) return false;
        const movingIds = moving.map((l) => l.id);
        set({
          history: commit(history, "그룹에 넣기", (draft) => {
            const s = draft.screens[0];
            for (const l of s.layers) if (movingIds.includes(l.id)) l.groupId = groupId; // the stacking order (zIndex) is not touched
            pruneGroups(s); // a group that lost layers to this one and is left with one is dissolved
          }),
          selectedLayerIds: [...new Set([...members.map((m) => m.id), ...movingIds])],
        });
        return true;
      },

      removeFromGroup(layerIds) {
        const { history } = get();
        const screen = screenOf();
        if (frozen() || !history || !screen) return 0;
        const layers = screen.layers.filter((l) => layerIds.includes(l.id) && l.groupId);
        if (layers.length === 0) {
          set({ notice: "선택한 레이어 중에 그룹에 속한 것이 없습니다." });
          return 0;
        }
        const gids = new Set(layers.map((l) => l.groupId!));
        if (layers.some((l) => l.locked) || screen.layers.some((l) => l.locked && l.groupId && gids.has(l.groupId))) {
          set({ notice: "잠긴 레이어가 있는 그룹은 바꿀 수 없습니다. 잠금을 풀고 다시 시도하세요." });
          return 0;
        }
        const ids = layers.map((l) => l.id);
        set({
          history: commit(history, "그룹에서 빼기", (draft) => {
            const s = draft.screens[0];
            for (const l of s.layers) if (ids.includes(l.id)) delete l.groupId;
            pruneGroups(s); // with one layer left a group is dissolved (the simplest rule: a group needs two)
          }),
        });
        return ids.length;
      },
      ungroupSelected() {
        const { history } = get();
        const screen = screenOf();
        if (frozen() || !history || !screen) return 0;
        const gids = new Set(screen.layers.filter((l) => get().selectedLayerIds.includes(l.id) && l.groupId).map((l) => l.groupId!));
        if (gids.size === 0) {
          set({ notice: "선택한 레이어 중에 그룹이 없습니다." });
          return 0;
        }
        const next = commit(history, "그룹 해제", (draft) => {
          const s = draft.screens[0];
          for (const l of s.layers) if (l.groupId && gids.has(l.groupId)) delete l.groupId;
          s.groups = (s.groups ?? []).filter((g) => !gids.has(g.id));
          pruneGroups(s);
        });
        set({ history: next });
        return gids.size;
      },

      renameGroup(groupId, name) {
        const { history } = get();
        const clean = name.trim().slice(0, MAX_GROUP_NAME);
        if (frozen() || !history || !clean) return false;
        if (!screenOf()?.groups?.some((g) => g.id === groupId && g.name !== clean)) return false;
        set({
          history: commit(history, "그룹 이름 변경", (draft) => {
            const g = draft.screens[0].groups?.find((x) => x.id === groupId);
            if (g) g.name = clean;
          }),
        });
        return true;
      },

      toggleGroupCollapsed(groupId) {
        const cur = get().collapsedGroups;
        set({ collapsedGroups: cur.includes(groupId) ? cur.filter((g) => g !== groupId) : [...cur, groupId] });
      },

      duplicateGroup(groupId) {
        const { history } = get();
        const screen = screenOf();
        if (frozen() || !history || !screen) return null;
        const members = sortByZ(screen.layers.filter((l) => l.groupId === groupId)); // back to front
        const group = screen.groups?.find((g) => g.id === groupId);
        if (!group || members.length < MIN_GROUP_SIZE || (screen.groups?.length ?? 0) >= MAX_GROUPS) return null;
        const gid = genId();
        const copies: BitmapLayer[] = members.map((m) => ({
          ...m,
          id: genId(),
          name: `${m.name} 복사`,
          groupId: gid,
          visible: true,
          locked: false,
          crop: { ...m.crop },
          transform: { ...m.transform, x: m.transform.x + DUPLICATE_OFFSET, y: m.transform.y + DUPLICATE_OFFSET },
        }));
        let list: readonly BitmapLayer[] = screen.layers;
        for (const c of copies) list = addOnTop(list, c); // back to front, so the copies keep their stacking
        const next = commit(history, "그룹 복제", (draft) => {
          applyLayers(draft.screens[0].layers, list);
          (draft.screens[0].groups ??= []).push({ id: gid, name: `${group.name} 복사`.slice(0, MAX_GROUP_NAME) });
        });
        set({ history: next, selectedLayerIds: copies.map((c) => c.id), selectionAnchor: copies[0].id });
        return copies.map((c) => c.id);
      },

      deleteSelectedLayers() {
        if (frozen()) return 0;
        const screen = screenOf();
        if (!screen) return 0;
        const ids = get().selectedLayerIds.filter((id) => screen.layers.some((l) => l.id === id));
        const deletable = ids.filter((id) => !screen.layers.find((l) => l.id === id)!.locked);
        if (deletable.length === 0) {
          if (ids.length > 0) set({ notice: "잠긴 레이어는 삭제할 수 없습니다." });
          return 0;
        }
        let layers: readonly BitmapLayer[] = screen.layers;
        for (const id of deletable) layers = removeLayer(layers, id);
        commitLayers(deletable.length > 1 ? `레이어 ${deletable.length}개 삭제` : "레이어 삭제", layers);
        const kept = ids.filter((id) => !deletable.includes(id));
        set({ selectedLayerIds: kept, ...(kept.length > 0 ? { notice: `잠긴 레이어 ${kept.length}개는 삭제되지 않았습니다.` } : {}) });
        return deletable.length;
      },

      setCornerPreview: (cornerPreview) => set({ cornerPreview }),

      setSnapEnabled: (snapEnabled) => set({ snapEnabled, snapGuides: snapEnabled ? get().snapGuides : [] }),
      setSnapGuides: (snapGuides) => set({ snapGuides }),

      commitBitmapEdit({ layerId, raw, x, y, label, erase }) {
        const { history, images } = get();
        const screen = screenOf();
        if (frozen() || !history || !screen || raw.width < 1 || raw.height < 1 || ![x, y].every(Number.isFinite)) return null;
        if (layerId && screen.layers.find((l) => l.id === layerId)?.warp) return null; // a warped layer is edited after its warp is reset
        const imageId = genId();
        const nextImages = new Map(images).set(imageId, { raw });
        const crop = { x: 0, y: 0, width: raw.width, height: raw.height };
        const at = { x: Math.round(x), y: Math.round(y) };
        if (layerId) {
          const target = screen.layers.find((l) => l.id === layerId);
          if (!target || (!target.drawn && !erase) || target.locked) return null; // only the eraser may work on an extracted or pasted layer
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
        if (frozen()) return false;
        if ("cornerRadius" in change && layer.content.kind !== "rect") return false; // only a rectangle has rounded corners
        const merged = { ...layer.content, ...change } as LayerContent;
        if (merged.kind === "rect" && change.cornerRadius !== undefined) {
          // 0 to half of the shorter side; 0 is the same as having none
          const r = Math.min(Math.max(Number.isFinite(change.cornerRadius) ? Math.round(change.cornerRadius * 100) / 100 : 0, 0), maxCornerRadius(merged.width, merged.height));
          if (r > 0) merged.cornerRadius = r;
          else delete merged.cornerRadius;
        }
        merged.strokeWidth = Math.min(Math.max(Math.round(merged.strokeWidth * 100) / 100, merged.kind === "line" ? 0.5 : 0), MAX_STROKE_WIDTH);
        if (contentError(merged)) return false;
        return editLayer(layerId, "도형 속성 변경", (l) => {
          if (!l.content) return;
          const target = l.content as Record<string, unknown>;
          const wanted = merged as Record<string, unknown>;
          for (const key of ["stroke", "fill", "strokeWidth"]) if (key in wanted && target[key] !== wanted[key]) target[key] = wanted[key];
          if ("cornerRadius" in change) {
            if (wanted.cornerRadius === undefined) delete target.cornerRadius;
            else if (target.cornerRadius !== wanted.cornerRadius) target.cornerRadius = wanted.cornerRadius;
          }
        });
      },

      setLayerWarp(layerId, warp) {
        const layer = screenOf()?.layers.find((l) => l.id === layerId);
        if (!layer || layer.content || !layer.imageId || layer.locked || frozen()) return false;
        const raw = get().images.get(layer.imageId)?.raw;
        const w = raw?.width ?? layer.crop.width, h = raw?.height ?? layer.crop.height;
        const next = warp && !isIdentityWarp(warp, w, h) ? roundWarp(warp) : null;
        if (next && warpError(next, w, h)) return false;
        if (!next && !layer.warp) return false;
        return editLayer(layerId, next ? "레이어 변형" : "변형 초기화", (l) => {
          if (next) l.warp = next;
          else delete l.warp;
        });
      },

      previewWarp(layerId, warp) {
        const layer = screenOf()?.layers.find((l) => l.id === layerId);
        if (!layer || layer.content || layer.locked || frozen()) return;
        const raw = layer.imageId ? get().images.get(layer.imageId)?.raw : undefined;
        if (!raw || warpError(warp, raw.width, raw.height)) return; // a shape that cannot be kept is not shown either
        set({ warpPreview: { layerId, warp } });
      },

      commitWarpPreview() {
        const preview = get().warpPreview;
        set({ warpPreview: null });
        return !!preview && get().setLayerWarp(preview.layerId, preview.warp);
      },

      cancelWarpPreview: () => set({ warpPreview: null }),

      convertWarp(layerId, target) {
        const layer = screenOf()?.layers.find((l) => l.id === layerId);
        const raw = layer?.imageId ? get().images.get(layer.imageId)?.raw : undefined;
        if (!layer || !raw) return false;
        const current: LayerWarp = layer.warp ?? identityQuad(raw.width, raw.height);
        const cols = Math.min(Math.max(Math.round(target.cols), MESH_MIN), MESH_MAX);
        const rows = Math.min(Math.max(Math.round(target.rows), MESH_MIN), MESH_MAX);
        const next: LayerWarp = target.mode === "quad" ? toQuad(current) : current.kind === "mesh" && current.cols === cols && current.rows === rows ? current : resizeMesh(current, cols, rows, raw.width, raw.height);
        set({ warpUi: { mode: target.mode, cols, rows } });
        // a bitmap with no warp yet only has its handles switched; nothing is stored until it is actually bent
        return next === current || isIdentityWarp(next, raw.width, raw.height) ? false : get().setLayerWarp(layerId, next);
      },

      setWarpUi(change) {
        const next = { ...get().warpUi, ...change };
        next.cols = Math.min(Math.max(Math.round(next.cols) || MESH_DEFAULT, MESH_MIN), MESH_MAX);
        next.rows = Math.min(Math.max(Math.round(next.rows) || MESH_DEFAULT, MESH_MIN), MESH_MAX);
        set({ warpUi: next });
      },

      finishWarp(confirm) {
        const session = get().warpSession;
        set({ activeTool: "select", warpSession: null, warpPreview: null });
        if (confirm || !session) return;
        let h = get().history;
        while (h && h.past.length > session.base) h = undo(h);
        if (h) reconcile(h);
      },

      insertAsset(bundle, mode) {
        const { history, images } = get();
        const screen = screenOf();
        if (frozen() || !history || !screen || bundle.layers.length === 0 || bundle.layers.length > 200) return null;
        const nextImages = new Map(images);
        const idOfKey = new Map<string, string>();
        const groupIdOfKey = new Map<string, string>(); // the groups the source brings are new groups, with new ids
        // a source of several layers that brings no groups of its own goes in as ONE group named like the source (the built-ins, and my
        // sources made of loose layers); a template keeps its own component groups
        const wrap = mode === "center" && bundle.layers.length >= 2 && !bundle.layers.some((a) => a.groupKey);
        const groupKeyOf = (a: { groupKey?: string }) => a.groupKey ?? (wrap ? "__source" : undefined);
        const made: BitmapLayer[] = [];
        for (const a of bundle.layers) {
          let imageId: string | undefined;
          if (a.content) {
            if (contentError(a.content)) return null;
          } else {
            const raw = a.imageKey ? bundle.images[a.imageKey] : undefined;
            if (!a.imageKey || !raw || raw.width < 1 || raw.height < 1) return null;
            imageId = idOfKey.get(a.imageKey);
            if (!imageId) {
              imageId = genId();
              idOfKey.set(a.imageKey, imageId);
              nextImages.set(imageId, { raw });
            }
          }
          const content = a.content ? ({ ...a.content } as LayerContent) : undefined;
          if (content?.kind === "text") content.height = fitHeight(content, measure); // this machine's fonts decide the lines
          made.push({
            id: genId(),
            name: a.name.slice(0, MAX_LAYER_NAME) || "레이어",
            crop: { ...a.crop },
            ...(imageId ? { imageId } : {}),
            ...(content ? { content } : {}),
            ...(a.drawn ? { drawn: true } : {}),
            ...(a.warp ? { warp: JSON.parse(JSON.stringify(a.warp)) } : {}),
            ...(groupKeyOf(a) ? { groupId: groupIdOfKey.get(groupKeyOf(a)!) ?? (groupIdOfKey.set(groupKeyOf(a)!, genId()), groupIdOfKey.get(groupKeyOf(a)!)!) } : {}),
            transform: { ...a.transform },
            zIndex: 0,
            opacity: a.opacity,
            visible: true,
            locked: false,
          });
        }
        if (mode === "center") {
          const boxes = made.map((l) => layerBox(l, l.imageId ? nextImages.get(l.imageId)?.raw : undefined)).filter((b): b is NonNullable<typeof b> => !!b);
          if (boxes.length === 0) return null;
          const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
          const x1 = Math.max(...boxes.map((b) => b.x + b.width)), y1 = Math.max(...boxes.map((b) => b.y + b.height));
          const dx = Math.round(screen.width / 2 - (x0 + x1) / 2), dy = Math.round(screen.height / 2 - (y0 + y1) / 2);
          for (const l of made) {
            l.transform.x = Math.round((l.transform.x + dx) * 100) / 100;
            l.transform.y = Math.round((l.transform.y + dy) * 100) / 100;
          }
        }
        let list: readonly BitmapLayer[] = screen.layers;
        for (const l of made) list = addOnTop(list, l);
        set({ images: nextImages });
        const newGroups = [...groupIdOfKey].map(([key, id]) => ({ id, name: (key === "__source" ? bundle.name : (bundle.layers.find((a) => a.groupKey === key)?.groupName ?? "그룹")).trim().slice(0, MAX_GROUP_NAME) || "그룹" })).slice(0, Math.max(0, MAX_GROUPS - (screen.groups?.length ?? 0))); // over the limit the extra groups just do not form
        set({
          history: commit(history, `소스 삽입: ${bundle.name}`, (draft) => {
            const s = draft.screens[0];
            applyLayers(s.layers, list);
            if (newGroups.length) (s.groups ??= []).push(...newGroups);
            pruneGroups(s); // a group of one layer is no group
          }),
        });
        const ids = made.map((l) => l.id);
        set({ selectedLayerIds: ids, selectedPatchId: null, selectedMemoId: null, activeTool: "select" });
        return ids;
      },

      setFingerStyle(change) {
        const next = { ...get().fingerStyle, ...change };
        const clamp = (v: number, lo: number, hi: number, fallback: number) => (Number.isFinite(v) ? Math.min(Math.max(Math.round(v), lo), hi) : fallback);
        set({ fingerStyle: { size: clamp(next.size, 2, 300, DEFAULT_FINGER_STYLE.size), strength: clamp(next.strength, 1, 100, DEFAULT_FINGER_STYLE.strength), softness: clamp(next.softness, 0, 100, DEFAULT_FINGER_STYLE.softness) } });
      },

      setLiquifyStyle(change) {
        const next = { ...get().liquifyStyle, ...change };
        const clamp = (v: number, lo: number, hi: number, fallback: number) => (Number.isFinite(v) ? Math.min(Math.max(Math.round(v), lo), hi) : fallback);
        const mode: LiquifyMode = LIQUIFY_MODES.includes(next.mode) ? next.mode : DEFAULT_LIQUIFY_STYLE.mode;
        set({ liquifyStyle: { mode, size: clamp(next.size, MIN_LIQUIFY_SIZE, MAX_LIQUIFY_SIZE, DEFAULT_LIQUIFY_STYLE.size), strength: clamp(next.strength, 1, 100, DEFAULT_LIQUIFY_STYLE.strength), softness: clamp(next.softness, 0, 100, DEFAULT_LIQUIFY_STYLE.softness) } });
      },
      setLiquifyBase: (liquifyBase) => set({ liquifyBase }),

      commitSmudge(layerId, raw, label = "손가락 번짐") {
        if (layerId === SOURCE_LAYER_ID) return get().commitSourceEdit(raw, label);
        const { history, images } = get();
        const layer = screenOf()?.layers.find((l) => l.id === layerId);
        const old = layer?.imageId ? images.get(layer.imageId)?.raw : undefined;
        if (frozen() || !history || !layer || layer.content || layer.locked || !old || old.width !== raw.width || old.height !== raw.height) return false;
        const imageId = genId();
        const next = commit(history, label, (draft) => {
          const l = draft.screens[0].layers.find((d) => d.id === layerId);
          if (l) l.imageId = imageId; // only the id changes: the history never holds pixels
        });
        const kept = trimImageVersions(next, new Map(images).set(imageId, { raw }), get().layerClipboard, imageBudget);
        set({ history: kept.history, images: kept.images, selectedLayerIds: [layerId], selectedPatchId: null });
        return true;
      },

      selectSource() {
        if (!screenOf()) return;
        set({ sourceSelected: true, selectedLayerIds: [], selectionAnchor: null, selectedPatchId: null, selectedMemoId: null });
      },

      setSourceLocked(locked) {
        const { history } = get();
        const screen = screenOf();
        if (!history || !screen || frozen()) return false;
        if (!!screen.source.unlocked === !locked) return false;
        set({
          history: commit(history, locked ? "원본 잠금" : "원본 잠금 해제", (draft) => {
            if (locked) delete draft.screens[0].source.unlocked;
            else draft.screens[0].source.unlocked = true;
          }),
        });
        return true;
      },

      commitSourceEdit(raw, label) {
        const { history, images } = get();
        const screen = screenOf();
        const old = screen ? images.get(screen.source.imageId)?.raw : undefined;
        if (!history || !screen || !old || frozen() || !screen.source.unlocked || old.width !== raw.width || old.height !== raw.height) return false;
        const imageId = genId();
        const before = screen.source.imageId;
        const next = commit(history, label, (draft) => {
          const s = draft.screens[0].source;
          if (!s.originalImageId) s.originalImageId = before; // the first edit keeps the picture that was uploaded; the later ones keep it where it is
          s.imageId = imageId; // only ids change: the history never holds pixels
        });
        const kept = trimImageVersions(next, new Map(images).set(imageId, { raw }), get().layerClipboard, imageBudget);
        set({ history: kept.history, images: kept.images, selectedPatchId: null });
        return true;
      },

      revertSource() {
        const { history, images } = get();
        const screen = screenOf();
        const original = screen?.source.originalImageId;
        if (!history || !screen || !original || frozen() || !screen.source.unlocked || original === screen.source.imageId || !images.has(original)) return false;
        const next = commit(history, "원본으로 되돌리기", (draft) => {
          const s = draft.screens[0].source;
          s.imageId = original;
          delete s.originalImageId; // unedited again: the original is the source itself
        });
        const kept = trimImageVersions(next, images, get().layerClipboard, imageBudget);
        set({ history: kept.history, images: kept.images });
        return true;
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

      setCandidateStatus: (candidateStatus, error = null) => set({ candidateStatus, candidateError: candidateStatus === "error" ? error : null }),
      setCandidates: (candidates) => set({ candidates, candidatePick: null, candidateHover: null }),

      hoverCandidateAt(point) {
        const { candidates, candidateHover } = get();
        const screen = screenOf();
        const found = point && !frozen() && screen && candidates?.imageId === screen.source.imageId ? candidatesAt(candidates.list, point)[0] ?? null : null;
        if (found === candidateHover) return;
        if (found && candidateHover && found.x === candidateHover.x && found.y === candidateHover.y && found.width === candidateHover.width && found.height === candidateHover.height) return;
        set({ candidateHover: found });
      },

      pickCandidateAt(point) {
        const { candidates, candidatePick } = get();
        const screen = screenOf();
        if (frozen() || !screen || !candidates || candidates.imageId !== screen.source.imageId || ![point.x, point.y].every(Number.isFinite)) return false;
        const r = pickNext(candidates.list, point, candidatePick ? { point: candidatePick.point, index: candidatePick.index } : null);
        if (!r) {
          set({ candidatePick: null });
          return false;
        }
        const { x, y, width, height } = r.candidate;
        set({ candidatePick: { rect: { x, y, width, height }, index: r.index, count: candidatesAt(candidates.list, point).length, point: { ...point } } });
        return true;
      },

      extractCandidatePick() {
        const pick = get().candidatePick;
        if (!pick) return null;
        const result = get().beginExtraction({ ...pick.rect });
        if (result.status !== "rejected") set({ candidatePick: null, candidateHover: null });
        return result;
      },

      clearCandidatePick: () => set({ candidatePick: null }),

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
      setTool(activeTool) {
        if (activeTool !== "liquify" && get().liquifyBase) set({ liquifyBase: null });
        if ((activeTool === "rect" || activeTool === "auto") && isGeneratedPage(screenOf()?.source.fileName ?? "")) {
          return set({ notice: "빈 캔버스·템플릿 화면에는 추출할 스크린샷이 없습니다. 영역 추출과 자동 후보는 캡처를 올렸을 때 쓸 수 있습니다." });
        }
        if (activeTool === "warp") {
          // the warp tool works on exactly one bitmap layer that can be changed; say why when it cannot start
          const ids = get().selectedLayerIds;
          const layer = ids.length === 1 ? screenOf()?.layers.find((l) => l.id === ids[0]) : undefined;
          const why = frozen() ? "비교 보기 중에는 변형할 수 없습니다. 비교를 끄고 다시 시도해 주세요." : !layer ? "변형할 레이어를 하나만 선택해 주세요." : layer.content || !layer.imageId ? "변형은 이미지(비트맵) 레이어에만 쓸 수 있습니다. 도형·텍스트 레이어는 대상이 아닙니다." : layer.locked ? "잠긴 레이어는 변형할 수 없습니다." : null;
          if (why || !layer) return set({ notice: why });
          const mode = layer.warp ? layer.warp.kind : get().warpUi.mode;
          return set({ activeTool, candidatePick: null, candidateHover: null, warpPreview: null, warpSession: { layerId: layer.id, base: get().history!.past.length }, warpUi: layer.warp?.kind === "mesh" ? { mode, cols: layer.warp.cols, rows: layer.warp.rows } : { ...get().warpUi, mode } });
        }
        set(activeTool === "auto" ? { activeTool, warpSession: null, warpPreview: null } : { activeTool, candidatePick: null, candidateHover: null, warpSession: null, warpPreview: null });
      },
      selectLayer: (layerId) => set({ selectionAnchor: layerId, selectedMemoId: null, selectedLayerIds: layerId && screenOf()?.layers.some((l) => l.id === layerId) ? [layerId] : [], selectedPatchId: null }),
      selectPatch: (patchId) => {
        const known = patchId && screenOf()?.backgroundPatches.some((p) => p.id === patchId);
        set({ selectedPatchId: known ? patchId : null, selectedLayerIds: [] });
      },
    };
  });
  // the original is selected only while nothing else is: choosing a layer or a patch (any change of what is selected) lets it go
  store.subscribe((s, prev) => {
    if (!s.sourceSelected || !prev.sourceSelected) return;
    const same = s.selectedLayerIds.length === prev.selectedLayerIds.length && s.selectedLayerIds.every((id, i) => id === prev.selectedLayerIds[i]);
    if (!same || s.selectedPatchId !== prev.selectedPatchId) store.setState({ sourceSelected: false });
  });
  return store;
}
