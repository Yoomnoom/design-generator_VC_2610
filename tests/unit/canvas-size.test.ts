import { describe, expect, test } from "vitest";
import { assetRect } from "@/features/assets/builtin";
import { renderProjectRaw } from "@/features/export-image/export-png";
import { parseProject, serializeProject } from "@/lib/project/parse";
import { getPixel, setPixel, solid } from "./helpers";
import { CARD, committedId, storeWith } from "./fixtures";

const base = () => {
  const raw = solid(100, 60, [10, 20, 30, 255]);
  setPixel(raw, 0, 0, [255, 0, 0, 255]);
  setPixel(raw, 99, 59, [0, 255, 0, 255]);
  return raw;
};
const page = () => storeWith(base());
type Ctx = ReturnType<typeof page>;
const sc = (c: Ctx) => c.get().history!.present.screens[0];
const resize = (c: Ctx, o: Partial<Parameters<Ctx["get"] extends () => infer S ? (S extends { resizeCanvas: infer F } ? F : never) : never>[0]> = {}) =>
  c.get().resizeCanvas({ width: 140, height: 100, ax: 1, ay: 1, layers: "follow", fill: null, ...o } as never);
const png = (c: Ctx) => renderProjectRaw(c.get().snapshotProject()!, c.get().images, () => null);

describe("canvas size", () => {
  test("growing from the centre puts the old picture in the middle with a transparent margin; the PNG has the new size; one undo step", () => {
    const c = page();
    const past = c.get().history!.past.length;
    expect(resize(c)).toBeNull();
    expect(c.get().history!.past).toHaveLength(past + 1);
    expect([sc(c).width, sc(c).height]).toEqual([140, 100]);
    const out = png(c);
    expect([out.width, out.height]).toEqual([140, 100]);
    expect(getPixel(out, 20, 20)).toEqual([255, 0, 0, 255]); // the old (0,0) is at (20, 20)
    expect(getPixel(out, 119, 79)).toEqual([0, 255, 0, 255]);
    expect(getPixel(out, 5, 5)[3]).toBe(0);
    expect(getPixel(out, 139, 99)[3]).toBe(0);
    c.get().undo();
    expect([sc(c).width, sc(c).height]).toEqual([100, 60]);
    expect(getPixel(png(c), 0, 0)).toEqual([255, 0, 0, 255]);
  });

  test("the margin can be a colour; each anchor puts the old page in its own corner or middle", () => {
    for (const [ax, ay, ox, oy] of [[0, 0, 0, 0], [2, 0, 40, 0], [0, 2, 0, 40], [2, 2, 40, 40], [1, 1, 20, 20]] as const) {
      const c = page();
      resize(c, { ax, ay, fill: "#112233" });
      const out = png(c);
      expect(getPixel(out, ox, oy), `${ax}${ay}`).toEqual([255, 0, 0, 255]);
      const empty = ax === 0 && ay === 0 ? [139, 99] : ax === 2 && ay === 2 ? [1, 1] : null;
      if (empty) expect(getPixel(out, empty[0], empty[1])).toEqual([0x11, 0x22, 0x33, 255]);
    }
  });

  test("layers follow the picture, or keep their page positions; patches follow the picture; memos follow with layers", () => {
    const follow = page();
    follow.get().addVectorLayer(assetRect("r", 0, 0, 10, 10, { fill: "#ff0000" }).content!, 30, 20);
    follow.get().addMemo(50, 30);
    const stay = page();
    stay.get().addVectorLayer(assetRect("r", 0, 0, 10, 10, { fill: "#ff0000" }).content!, 30, 20);
    stay.get().addMemo(50, 30);
    resize(follow);
    resize(stay, { layers: "stay" });
    expect(sc(follow).layers[0].transform).toMatchObject({ x: 50, y: 40 });
    expect(sc(follow).memos![0]).toMatchObject({ x: 70, y: 50 });
    expect(sc(stay).layers[0].transform).toMatchObject({ x: 30, y: 20 });
    expect(sc(stay).memos![0]).toMatchObject({ x: 50, y: 30 });
  });

  test("cropping drops what is outside, cuts patches to the page and keeps layers where the picture was", () => {
    const c = storeWith();
    committedId(c.get().beginExtraction(CARD));
    const patch = sc(c).backgroundPatches[0].rect;
    const w = sc(c).width, h = sc(c).height;
    expect(c.get().resizeCanvas({ width: CARD.x + 5, height: h, ax: 0, ay: 0, layers: "follow", fill: null })).toBeNull();
    expect(sc(c).width).toBe(CARD.x + 5);
    const p = sc(c).backgroundPatches[0].rect;
    expect(p.x + p.width).toBeLessThanOrEqual(CARD.x + 5);
    expect(p.width).toBe(5);
    expect(p.x).toBe(patch.x);
    expect(w).toBeGreaterThan(CARD.x + 5);
    // cropping from the right edge moves the picture left: patches go with it
    const d = storeWith();
    committedId(d.get().beginExtraction(CARD));
    expect(d.get().resizeCanvas({ width: w - 5, height: h, ax: 2, ay: 0, layers: "follow", fill: null })).toBeNull();
    expect(sc(d).backgroundPatches[0].rect.x).toBe(patch.x - 5);
    expect(sc(d).layers[0].transform.x).toBe(CARD.x - 5);
  });

  test("a memo that would fall off the page is held at its edge", () => {
    const c = page();
    c.get().addMemo(5, 5);
    expect(c.get().resizeCanvas({ width: 80, height: 60, ax: 2, ay: 0, layers: "follow", fill: null })).toBeNull();
    expect(sc(c).memos![0]).toMatchObject({ x: 0, y: 5 });
  });

  test("refused with a reason: no change, over 8192, zero, not whole pixels, a bad colour, comparing; nothing changes", () => {
    const c = page();
    const history = c.get().history;
    expect(resize(c, { width: 100, height: 60 })).toContain("그대로");
    expect(resize(c, { width: 8193, height: 10 })).toContain("8192");
    expect(resize(c, { width: 0, height: 10 })).toContain("1px");
    expect(resize(c, { width: 10.5, height: 10 })).toContain("정수");
    expect(resize(c, { fill: "red" })).toContain("#rrggbb");
    c.get().setCompareMode("original");
    expect(resize(c)).toContain("비교");
    expect(c.get().history).toBe(history);
    expect(storeWith().get().resizeCanvas({ width: 8192, height: 4, ax: 0, ay: 0, layers: "stay", fill: null })).toBeNull(); // exactly the limit is allowed
  });

  test("it is saved and opened again, and the project is valid at the new size", () => {
    const c = page();
    resize(c, { fill: "#ffffff" });
    const back = parseProject(serializeProject(c.get().snapshotProject()!));
    expect(back.ok && [back.project.screens[0].width, back.project.screens[0].height]).toEqual([140, 100]);
    expect(back.ok && back.project.screens[0].source.imageId).toBe(sc(c).source.imageId);
  });
});