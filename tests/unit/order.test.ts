import { describe, expect, test } from "vitest";
import { addOnTop, moveLayer, normalizeZ, removeLayer, sortByZ } from "@/features/layer-transform/order";
import { makeLayer } from "./helpers";

const ids = (ls: { id: string }[]) => ls.map((l) => l.id);

describe("layer order", () => {
  test("sortByZ orders back to front and is stable for ties", () => {
    const ls = [makeLayer("c", 2), makeLayer("a", 0), makeLayer("b", 0)];
    expect(ids(sortByZ(ls))).toEqual(["a", "b", "c"]);
  });

  test("normalizeZ renumbers to 0…n-1 without reordering", () => {
    const out = normalizeZ([makeLayer("a", 10), makeLayer("b", 3), makeLayer("c", 7)]);
    expect(out.map((l) => [l.id, l.zIndex])).toEqual([["b", 0], ["c", 1], ["a", 2]]);
  });

  test("addOnTop puts the new layer in front", () => {
    const out = addOnTop([makeLayer("a", 0), makeLayer("b", 1)], makeLayer("n", 0));
    expect(out.map((l) => [l.id, l.zIndex])).toEqual([["a", 0], ["b", 1], ["n", 2]]);
  });

  test("moveLayer forward swaps with the layer above", () => {
    const out = moveLayer([makeLayer("a", 0), makeLayer("b", 1), makeLayer("c", 2)], "a", 1);
    expect(ids(sortByZ(out))).toEqual(["b", "a", "c"]);
    expect(out.map((l) => l.zIndex).sort()).toEqual([0, 1, 2]);
  });

  test("moveLayer backward swaps with the layer below", () => {
    expect(ids(sortByZ(moveLayer([makeLayer("a", 0), makeLayer("b", 1), makeLayer("c", 2)], "c", -1)))).toEqual(["a", "c", "b"]);
  });

  test("moving past either end changes nothing", () => {
    const ls = [makeLayer("a", 0), makeLayer("b", 1)];
    expect(ids(sortByZ(moveLayer(ls, "b", 1)))).toEqual(["a", "b"]);
    expect(ids(sortByZ(moveLayer(ls, "a", -1)))).toEqual(["a", "b"]);
  });

  test("an unknown id changes nothing", () => {
    expect(ids(sortByZ(moveLayer([makeLayer("a", 0)], "zzz", 1)))).toEqual(["a"]);
  });

  test("removeLayer closes the gap in zIndex", () => {
    const out = removeLayer([makeLayer("a", 0), makeLayer("b", 1), makeLayer("c", 2)], "b");
    expect(out.map((l) => [l.id, l.zIndex])).toEqual([["a", 0], ["c", 1]]);
  });

  test("does not mutate its input", () => {
    const ls = [makeLayer("a", 0), makeLayer("b", 1)];
    moveLayer(ls, "a", 1);
    expect(ls.map((l) => l.zIndex)).toEqual([0, 1]);
  });
});
