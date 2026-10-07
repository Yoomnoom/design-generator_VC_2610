import { Point, View, clientToWorld } from "./coords";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const ZOOM_STEP = 1.2;

export const clampZoom = (z: number) => Math.min(Math.max(z, MIN_ZOOM), MAX_ZOOM);

/** Zooms so the world point under `anchor` (container-relative CSS px) stays under it. */
export function zoomAt(view: View, nextZoom: number, anchor: Point): View {
  const zoom = clampZoom(nextZoom);
  const world = clientToWorld(anchor, { x: 0, y: 0 }, view);
  return { zoom, panX: anchor.x - world.x * zoom, panY: anchor.y - world.y * zoom };
}

export const panBy = (view: View, dx: number, dy: number): View => ({ ...view, panX: view.panX + dx, panY: view.panY + dy });

/** The view that centres the frame in the container, shrunk to fit but never enlarged past 100%. */
export function fitView(container: { width: number; height: number }, frame: { x: number; y: number; width: number; height: number }, padding = 48): View {
  const zoom = clampZoom(Math.min(1, (container.width - padding * 2) / frame.width, (container.height - padding * 2) / frame.height));
  return {
    zoom,
    panX: (container.width - frame.width * zoom) / 2 - frame.x * zoom,
    panY: (container.height - frame.height * zoom) / 2 - frame.y * zoom,
  };
}
