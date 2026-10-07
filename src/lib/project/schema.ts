/* Project data model (PRD v0.2 §11). Coordinates in here are always original-image pixels. */

/** 1: layers fixed at scale 1 and rotation 0 (Phase 1). 2: scale and rotation are free (Phase 1.5).
 *  3: vector layers (`content`: line, rectangle, ellipse) (Phase 2). */
export const CURRENT_VERSION = 3 as const;

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
export type LayerContent =
  | ({ kind: "rect" | "ellipse"; width: number; height: number } & ShapeStyle)
  /** a segment across the box: "down" runs top-left → bottom-right, "up" runs bottom-left → top-right */
  | { kind: "line"; width: number; height: number; direction: "down" | "up"; stroke: string; strokeWidth: number };

export type BitmapLayer = {
  id: string;
  name: string;
  crop: Rect; // region of the source image this layer was extracted from
  imageId?: string; // extracted bitmap Blob reference (absent on a vector layer)
  /** set on a vector layer; then there is no imageId and `crop` is an empty rectangle */
  content?: LayerContent;
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
};

export type Project = {
  id: string;
  name: string;
  version: typeof CURRENT_VERSION;
  canvas: { zoom: number; panX: number; panY: number };
  screens: ScreenNode[]; // Phase 1: exactly one
};
