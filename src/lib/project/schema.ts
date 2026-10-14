/* Project data model (PRD v0.2 §11). Coordinates in here are always original-image pixels. */

/** 1: layers fixed at scale 1 and rotation 0 (Phase 1). 2: scale and rotation are free (Phase 1.5).
 *  3: vector layers (`content`: line, rectangle, ellipse) (Phase 2).
 *  4: `drawn` marks a bitmap layer made with the brush (Phase 2).
 *  5: text layers (`content.kind` "text") (Phase 2).
 *  6: `memos` on a screen: notes pinned to points of the picture (Phase 2).
 *  7: `warp` on a bitmap layer: skew, perspective, distortion and mesh warping, stored as control points (Phase 2).
 *  8: `groups` on a screen and `groupId` on a layer: layers that are selected and moved as one (one level, no nesting).
 *  9: `cornerRadius` on a rectangle layer's content: rounded corners (absent = square, as in every earlier file).
 *  10: `blend` on a layer: how it mixes with what is below it (absent = normal, as in every earlier file). */
export const CURRENT_VERSION = 10 as const;

export type Rect = { x: number; y: number; width: number; height: number };

export type BackgroundPatch = {
  id: string;
  rect: Rect;
  fill: string; // "#rrggbb"
};

/** What a vector layer draws, in the layer's own pixels with its top-left at (0, 0). A vector layer is resized by changing
 *  width/height (its transform scale stays 1), so strokes keep their thickness. Drawn only when needed: the project stores
 *  this description, and the PNG export rasterises it. */
export type ShapeStyle = { stroke: string | null; strokeWidth: number; fill: string | null };
/** A text box: the words, their size, colour and alignment, wrapped inside `width`. `height` is whatever the wrapped lines need (kept
 *  in step with them by the editor), so the box always holds its text. Text has no outline, so stroke is always null. */
export type TextContent = { kind: "text"; width: number; height: number; text: string; fontSize: number; color: string; align: "left" | "center" | "right"; stroke: null; strokeWidth: 0 };
export type LayerContent =
  | TextContent
  /** `cornerRadius` (pixels, 0 to half of the shorter side; absent = square corners) is only on a rectangle */
  | ({ kind: "rect"; width: number; height: number; cornerRadius?: number } & ShapeStyle)
  | ({ kind: "ellipse"; width: number; height: number } & ShapeStyle)
  /** a segment across the box: "down" runs top-left → bottom-right, "up" runs bottom-left → top-right */
  | { kind: "line"; width: number; height: number; direction: "down" | "up"; stroke: string; strokeWidth: number };

/** Non-destructive warping of a bitmap layer: where the bitmap's corners (or grid points) go. Positions are in the bitmap's own pixels,
 *  BEFORE scale, rotation and position are applied, so a bitmap pixel p lands at  T · R · S · warp(p). The bitmap itself is never changed.
 *  quad: the new places of the bitmap's top-left, top-right, bottom-right and bottom-left corners, joined by a projective (homography) map.
 *  mesh: a (cols+1) × (rows+1) grid of control points, row by row; point (i, j) starts at (i·width/cols, j·height/rows); the bitmap is bent
 *  between them cell by cell. */
export type WarpPoint = { x: number; y: number };
export type WarpQuad = { kind: "quad"; points: [WarpPoint, WarpPoint, WarpPoint, WarpPoint] };
export type WarpMesh = { kind: "mesh"; cols: number; rows: number; points: WarpPoint[] };
export type LayerWarp = WarpQuad | WarpMesh;

/** how a layer mixes with the layers and picture below it; absent = "normal". The names are the canvas' own (`globalCompositeOperation`). */
export type BlendMode = "multiply" | "screen" | "overlay" | "darken" | "lighten";
export const BLEND_MODES: BlendMode[] = ["multiply", "screen", "overlay", "darken", "lighten"];

export type BitmapLayer = {
  id: string;
  name: string;
  crop: Rect; // region of the source image this layer was extracted from
  imageId?: string; // extracted bitmap Blob reference (absent on a vector layer)
  /** set on a vector layer; then there is no imageId and `crop` is an empty rectangle */
  content?: LayerContent;
  /** true on a bitmap layer made with the brush; only such a layer takes more brush strokes and the eraser */
  drawn?: boolean;
  /** absent = not warped (and in every file before version 7). Only a bitmap layer has one. */
  warp?: LayerWarp;
  /** the group this layer belongs to (an id in the screen's `groups`); absent = in no group (and in every file before version 8) */
  groupId?: string;
  /** absent = normal (and in every file before version 10) */
  blend?: BlendMode;
  /** Where the bitmap is placed. A bitmap pixel p lands at  T(x, y) · R(rotation) · S(scaleX, scaleY) · p,
   *  in frame pixels (original-image pixels, y down). So (x, y) is where the bitmap's top-left corner goes and is the
   *  centre of rotation; rotation is in degrees, clockwise on screen. */
  transform: {
    x: number;
    y: number;
    scaleX: number; // never 0
    scaleY: number;
    rotation: number;
  };
  zIndex: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
};

/** A note pinned to a point of the screen (original-image pixels). It is not a layer: it is never part of the picture, and it reaches the
 *  exported PNG only when the export asks for memos. */
export type Memo = { id: string; x: number; y: number; text: string };
export const MAX_MEMOS = 200;
export const MAX_MEMO_LENGTH = 1000;

/** A set of layers selected and moved together. One level only: a layer is in one group or none, and a group holds layers, not groups.
 *  It has no picture of its own, so it never changes the PNG. Whether it is folded open in the layer panel is UI state, not saved. */
export type LayerGroup = { id: string; name: string };
export const MAX_GROUPS = 100;
export const MAX_GROUP_NAME = 60;

export type ScreenNode = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number; // original image width
  height: number; // original image height
  source: { imageId: string; fileName: string };
  backgroundPatches: BackgroundPatch[];
  layers: BitmapLayer[];
  /** absent in files saved before version 6 */
  memos?: Memo[];
  /** absent in files saved before version 8 */
  groups?: LayerGroup[];
};

export type Project = {
  id: string;
  name: string;
  version: typeof CURRENT_VERSION;
  canvas: { zoom: number; panX: number; panY: number };
  screens: ScreenNode[]; // Phase 1: exactly one
};
