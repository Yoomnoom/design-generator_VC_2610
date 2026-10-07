/* Project data model (PRD v0.2 §11). Coordinates in here are always original-image pixels. */

/** 1: layers fixed at scale 1 and rotation 0 (Phase 1). 2: scale and rotation are free (Phase 1.5). */
export const CURRENT_VERSION = 2 as const;

export type Rect = { x: number; y: number; width: number; height: number };

export type BackgroundPatch = {
  id: string;
  rect: Rect;
  fill: string; // "#rrggbb"
};

export type BitmapLayer = {
  id: string;
  name: string;
  crop: Rect; // region of the source image this layer was extracted from
  imageId?: string; // extracted bitmap Blob reference
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
