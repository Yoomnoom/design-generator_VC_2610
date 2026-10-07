export type Rgb = { r: number; g: number; b: number };

export const rgbToHex = ({ r, g, b }: Rgb) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

/** accepts "#rgb" and "#rrggbb"; null for anything else */
export const hexToRgb = (hex: string): Rgb | null => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
};

/** "#abc" / "#AABBCC" → "#aabbcc"; null when it is not a colour */
export const normalizeHex = (hex: string): string | null => {
  const rgb = hexToRgb(hex);
  return rgb && rgbToHex(rgb);
};
