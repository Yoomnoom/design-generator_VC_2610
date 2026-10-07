/* Project data model (PRD v0.2 §11). Coordinates in here are always original-image pixels. */

export const CURRENT_VERSION = 1 as const;

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
  transform: {
    x: number; // frame-relative original pixels
    y: number;
    scaleX: 1; // fixed in Phase 1
    scaleY: 1;
    rotation: 0;
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
