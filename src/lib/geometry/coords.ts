/* Three coordinate spaces, kept apart:
 *   client — pointer position in CSS px (viewport)
 *   world  — the pannable/zoomable workspace; client = origin + pan + world * zoom
 *   image  — original-image pixels; world minus the screen frame's position
 * Only image coordinates are ever stored. devicePixelRatio is deliberately not an input anywhere. */

export type Point = { x: number; y: number };
export type View = { zoom: number; panX: number; panY: number };

export const clientToWorld = (client: Point, containerOrigin: Point, view: View): Point => ({
  x: (client.x - containerOrigin.x - view.panX) / view.zoom,
  y: (client.y - containerOrigin.y - view.panY) / view.zoom,
});

export const worldToClient = (world: Point, containerOrigin: Point, view: View): Point => ({
  x: world.x * view.zoom + view.panX + containerOrigin.x,
  y: world.y * view.zoom + view.panY + containerOrigin.y,
});

export const worldToImage = (world: Point, screenOrigin: Point): Point => ({ x: world.x - screenOrigin.x, y: world.y - screenOrigin.y });
export const imageToWorld = (image: Point, screenOrigin: Point): Point => ({ x: image.x + screenOrigin.x, y: image.y + screenOrigin.y });

export const clientToImage = (client: Point, containerOrigin: Point, view: View, screenOrigin: Point): Point =>
  worldToImage(clientToWorld(client, containerOrigin, view), screenOrigin);

export const imageToClient = (image: Point, containerOrigin: Point, view: View, screenOrigin: Point): Point =>
  worldToClient(imageToWorld(image, screenOrigin), containerOrigin, view);

/** nearest whole pixel; `+ 0` turns -0 into 0 */
export const roundToPixel = (p: Point): Point => ({ x: Math.round(p.x) + 0, y: Math.round(p.y) + 0 });

/** keeps a point inside [0, width] × [0, height], the corners a pixel selection may land on */
export const clampToImage = (p: Point, size: { width: number; height: number }): Point => ({
  x: Math.min(Math.max(p.x, 0), size.width),
  y: Math.min(Math.max(p.y, 0), size.height),
});
