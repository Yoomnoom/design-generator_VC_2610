import { RawImage } from "./raw-image";

/* Rectangle candidates for "extract this": classical image processing, nothing learned, nothing sent anywhere.
 *
 * Idea: a card, a button, a picture is a patch of the screenshot that stays one colour (or changes slowly) until its edge. So join each
 * pixel to its right and lower neighbour when their colours are close, and every connected patch is a region. The bounding box of a
 * region is a candidate. A white card is one region with holes (its text, its button); the holes are regions of their own, which is how
 * a button inside a card is found too. A soft shadow or a gradient changes slowly enough to stay joined to the page behind it, so it does
 * not become part of the card. */

export type Candidate = { x: number; y: number; width: number; height: number; /** pixels in the region itself (not its box) */ pixels: number };

export type CandidateOptions = {
  /** the largest difference in any channel between two neighbouring pixels that still counts as "the same patch" */
  tolerance?: number;
  /** a region smaller than this on either side is noise (a letter, a dot) */
  minSide?: number;
  /** a region whose box covers more of the frame than this is the page itself, not something on it */
  maxFrameShare?: number;
  /** a region that fills less than this share of its own box is a thin outline or a scatter, not a shape */
  minFill?: number;
};

export const DEFAULT_OPTIONS: Required<CandidateOptions> = { tolerance: 4, minSide: 8, maxFrameShare: 0.9, minFill: 0.15 };

/** Finds regions in `img`. Cost grows with the number of pixels (one pass to join, one to sum up), not with how busy the picture is. */
export function findCandidates(img: RawImage, options: CandidateOptions = {}): Candidate[] {
  const { tolerance, minSide, maxFrameShare, minFill } = { ...DEFAULT_OPTIONS, ...options };
  const { width: W, height: H, data } = img;
  if (W < 1 || H < 1) return [];

  const diff = (a: number, b: number) => {
    // a and b are pixel offsets (index * 4)
    const d0 = Math.abs(data[a] - data[b]);
    const d1 = Math.abs(data[a + 1] - data[b + 1]);
    const d2 = Math.abs(data[a + 2] - data[b + 2]);
    const d3 = Math.abs(data[a + 3] - data[b + 3]);
    return Math.max(d0, d1, d2, d3);
  };

  // Runs: maximal horizontal stretches of one patch. Joining runs instead of pixels keeps the union-find tiny on flat pictures.
  const runStart: number[][] = new Array(H);
  const runEnd: number[][] = new Array(H);
  const runId: number[][] = new Array(H);
  const parent: number[] = [];
  const find = (a: number) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  for (let y = 0; y < H; y++) {
    const starts: number[] = [];
    const ends: number[] = [];
    const ids: number[] = [];
    let x0 = 0;
    for (let x = 1; x <= W; x++) {
      if (x === W || diff(((y * W + x - 1) << 2), ((y * W + x) << 2)) > tolerance) {
        starts.push(x0);
        ends.push(x - 1);
        ids.push(parent.length);
        parent.push(parent.length);
        x0 = x;
      }
    }
    runStart[y] = starts;
    runEnd[y] = ends;
    runId[y] = ids;
    if (y === 0) continue;
    // join with the row above wherever a pixel and the one above it are alike
    const pS = runStart[y - 1];
    const pE = runEnd[y - 1];
    const pI = runId[y - 1];
    let j = 0;
    for (let i = 0; i < starts.length; i++) {
      while (j < pS.length && pE[j] < starts[i]) j++;
      for (let k = j; k < pS.length && pS[k] <= ends[i]; k++) {
        if (find(ids[i]) === find(pI[k])) continue;
        const from = Math.max(starts[i], pS[k]);
        const to = Math.min(ends[i], pE[k]);
        for (let x = from; x <= to; x++) {
          if (diff(((y * W + x) << 2), (((y - 1) * W + x) << 2)) <= tolerance) {
            union(ids[i], pI[k]);
            break;
          }
        }
      }
    }
  }

  // sum each region up: box and pixel count
  const n = parent.length;
  const minX = new Int32Array(n).fill(W);
  const minY = new Int32Array(n).fill(H);
  const maxX = new Int32Array(n).fill(-1);
  const maxY = new Int32Array(n).fill(-1);
  const count = new Float64Array(n);
  for (let y = 0; y < H; y++) {
    for (let i = 0; i < runStart[y].length; i++) {
      const r = find(runId[y][i]);
      if (runStart[y][i] < minX[r]) minX[r] = runStart[y][i];
      if (runEnd[y][i] > maxX[r]) maxX[r] = runEnd[y][i];
      if (y < minY[r]) minY[r] = y;
      if (y > maxY[r]) maxY[r] = y;
      count[r] += runEnd[y][i] - runStart[y][i] + 1;
    }
  }

  const out: Candidate[] = [];
  for (let r = 0; r < n; r++) {
    if (parent[r] !== r || maxX[r] < 0) continue;
    const width = maxX[r] - minX[r] + 1;
    const height = maxY[r] - minY[r] + 1;
    if (width < minSide || height < minSide) continue;
    if ((width * height) / (W * H) > maxFrameShare) continue; // the page itself
    if (count[r] / (width * height) < minFill) continue;
    out.push({ x: minX[r], y: minY[r], width, height, pixels: count[r] });
  }
  return dedupe(out).sort((a, b) => a.y - b.y || a.x - b.x || a.width * a.height - b.width * b.height);
}

/** Of regions with (nearly) the same box, keep the one with the most pixels. */
function dedupe(list: Candidate[], slack = 2): Candidate[] {
  const kept: Candidate[] = [];
  for (const c of [...list].sort((a, b) => b.pixels - a.pixels)) {
    if (!kept.some((k) => Math.abs(k.x - c.x) <= slack && Math.abs(k.y - c.y) <= slack && Math.abs(k.width - c.width) <= slack && Math.abs(k.height - c.height) <= slack)) kept.push(c);
  }
  return kept;
}

export const contains = (c: Candidate, p: { x: number; y: number }) => p.x >= c.x && p.x < c.x + c.width && p.y >= c.y && p.y < c.y + c.height;

/** every candidate under a point, the smallest first: the innermost thing, then what holds it, then what holds that */
export function candidatesAt(list: readonly Candidate[], p: { x: number; y: number }): Candidate[] {
  return list.filter((c) => contains(c, p)).sort((a, b) => a.width * a.height - b.width * b.height || a.x - b.x || a.y - b.y);
}

/** How far a repeated click moves outwards. The first click on a spot takes the smallest candidate there; clicking again at (about) the
 *  same spot takes the next larger one, and after the largest it starts over with the smallest. */
export function pickNext(list: readonly Candidate[], p: { x: number; y: number }, previous: { point: { x: number; y: number }; index: number } | null, sameSpot = 4): { candidate: Candidate; index: number } | null {
  const here = candidatesAt(list, p);
  if (here.length === 0) return null;
  const again = previous && Math.hypot(previous.point.x - p.x, previous.point.y - p.y) <= sameSpot;
  const index = again ? (previous.index + 1) % here.length : 0;
  return { candidate: here[index], index };
}

/** intersection over union of two boxes: 1 for identical, 0 for disjoint */
export function iou(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / (a.width * a.height + b.width * b.height - inter);
}
