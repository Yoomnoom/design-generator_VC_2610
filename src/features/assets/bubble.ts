/* Where the large preview card goes. It sits next to the panel the hovered card is in, on the canvas side (the side of the panel that
 * faces the middle of the window: right of a left-hand panel, left of a right-hand one), level with the hovered card, and is moved so that it is always fully inside the window. Pure, so it can be unit tested. */

export type BubbleAnchor = {
  /** the panel's left and right edges (or the card's own, when it is not in a panel) */
  left: number;
  right: number;
  /** the hovered card's top */
  top: number;
};
export type BubblePlace = { x: number; y: number; side: "left" | "right" | "over" };

export const BUBBLE_GAP = 8;
export const BUBBLE_MARGIN = 8;

export function placeBubble(anchor: BubbleAnchor, size: { width: number; height: number }, viewport: { width: number; height: number }, gap = BUBBLE_GAP, margin = BUBBLE_MARGIN): BubblePlace {
  const maxX = Math.max(margin, viewport.width - margin - size.width);
  const maxY = Math.max(margin, viewport.height - margin - size.height);
  const y = Math.min(Math.max(anchor.top, margin), maxY);
  const leftX = anchor.left - gap - size.width;
  const rightX = anchor.right + gap;
  const canvasOnRight = (anchor.left + anchor.right) / 2 < viewport.width / 2;
  const fitsLeft = leftX >= margin, fitsRight = rightX <= maxX;
  if (canvasOnRight ? fitsRight : fitsLeft) return canvasOnRight ? { x: rightX, y, side: "right" } : { x: leftX, y, side: "left" };
  if (canvasOnRight ? fitsLeft : fitsRight) return canvasOnRight ? { x: leftX, y, side: "left" } : { x: rightX, y, side: "right" };
  // no room beside the panel (a narrow window): it covers part of the panel, but stays inside the window
  return { x: Math.min(Math.max(leftX, margin), maxX), y, side: "over" };
}
