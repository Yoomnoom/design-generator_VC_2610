import { useSyncExternalStore } from "react";

/* The layout of the side panels: open or folded, and how wide. It is a setting of this browser (localStorage `slc-panels`), never part of a
 * project file or the temporary save. A damaged or out-of-range value is replaced by the default one value at a time, so a bad entry can
 * never leave a panel unreachable. `open: null` = automatic: open when the window is wide enough for it. */

export type PanelSide = "left" | "right";
export type PanelState = { open: boolean | null; width: number };
export type PanelLayout = Record<PanelSide, PanelState>;

export const PANEL_LIMITS: Record<PanelSide, { min: number; max: number; default: number; /** the window width from which an automatic panel is open */ autoOpenFrom: number }> = {
  left: { min: 200, max: 480, default: 248, autoOpenFrom: 1000 },
  right: { min: 240, max: 520, default: 282, autoOpenFrom: 1180 },
};
/** the thin bar a folded panel leaves, and the tool bar's width (both in the grid of the editor) */
export const FOLDED_WIDTH = 26;
export const TOOL_RAIL_WIDTH = 80;
export const PANELS_STORAGE_KEY = "slc-panels";
const FORMAT = 1;

export const clampWidth = (side: PanelSide, w: number): number => {
  const l = PANEL_LIMITS[side];
  return Number.isFinite(w) ? Math.min(Math.max(Math.round(w), l.min), l.max) : l.default;
};
export const defaultLayout = (): PanelLayout => ({ left: { open: null, width: PANEL_LIMITS.left.default }, right: { open: null, width: PANEL_LIMITS.right.default } });

export function parseStoredLayout(text: string | null): PanelLayout {
  const out = defaultLayout();
  if (!text) return out;
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return out;
  }
  const d = doc as { format?: unknown; left?: unknown; right?: unknown } | null;
  if (!d || d.format !== FORMAT) return out;
  for (const side of ["left", "right"] as const) {
    const v = d[side] as { open?: unknown; width?: unknown } | undefined;
    if (!v || typeof v !== "object") continue;
    if (typeof v.open === "boolean") out[side].open = v.open;
    if (typeof v.width === "number") out[side].width = clampWidth(side, v.width);
  }
  return out;
}

/** is the panel open in a window `viewport` px wide: the user's choice, else open when the window is wide enough */
export const isOpen = (side: PanelSide, s: PanelState, viewport: number): boolean => (s.open === null ? viewport >= PANEL_LIMITS[side].autoOpenFrom : s.open);

/** the width of the panel's column in the editor's grid */
export const columnWidth = (side: PanelSide, s: PanelState, viewport: number): number => (isOpen(side, s, viewport) ? s.width : FOLDED_WIDTH);

/** the width a drag of the edge gives: the panel's width when the drag started, moved by dx (the right panel's edge moves the other way) */
export const draggedWidth = (side: PanelSide, startWidth: number, dx: number): number => clampWidth(side, startWidth + (side === "left" ? dx : -dx));

export type PanelStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Listener = () => void;

export function createPanelStore(storage: PanelStorage | null = typeof window === "undefined" ? null : safeLocalStorage()) {
  const read = (): PanelLayout => {
    try {
      return parseStoredLayout(storage?.getItem(PANELS_STORAGE_KEY) ?? null);
    } catch {
      return defaultLayout();
    }
  };
  let layout = read();
  const listeners = new Set<Listener>();
  const commit = (next: PanelLayout) => {
    layout = next;
    try {
      const plain = JSON.stringify(defaultLayout());
      if (JSON.stringify(next) === plain) storage?.removeItem(PANELS_STORAGE_KEY);
      else storage?.setItem(PANELS_STORAGE_KEY, JSON.stringify({ format: FORMAT, ...next }));
    } catch {
      /* not saved; the change still applies for this page */
    }
    listeners.forEach((l) => l());
  };
  return {
    get: () => layout,
    subscribe(l: Listener) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    /** fold or open a panel; `viewport` is the window width, so that a toggle from "automatic" goes the other way from what is shown */
    toggle(side: PanelSide, viewport: number) {
      commit({ ...layout, [side]: { ...layout[side], open: !isOpen(side, layout[side], viewport) } });
    },
    setOpen(side: PanelSide, open: boolean) {
      commit({ ...layout, [side]: { ...layout[side], open } });
    },
    setWidth(side: PanelSide, width: number) {
      const w = clampWidth(side, width);
      if (w !== layout[side].width) commit({ ...layout, [side]: { ...layout[side], width: w } });
    },
    resetWidth(side: PanelSide) {
      this.setWidth(side, PANEL_LIMITS[side].default);
    },
    reload() {
      layout = read();
      listeners.forEach((l) => l());
    },
  };
}

function safeLocalStorage(): PanelStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const panelStore = createPanelStore();
if (typeof window !== "undefined") window.addEventListener("storage", (e) => e.key === PANELS_STORAGE_KEY && panelStore.reload());

const DEFAULT = defaultLayout();
export const usePanelLayout = (): PanelLayout => useSyncExternalStore(panelStore.subscribe, panelStore.get, () => DEFAULT);
