import { describe, expect, test } from "vitest";
import { parseProject, serializeProject } from "@/lib/project/parse";
import { migrate } from "@/lib/project/migrate";
import { makeLayer, makeProject } from "./helpers";

const withLayers = () => makeProject([makeLayer("a", 0, { transform: { x: 30, y: 40, scaleX: 1, scaleY: 1, rotation: 0 } }), makeLayer("b", 1)]);
const tweak = (fn: (doc: any) => void) => {
  const doc = JSON.parse(serializeProject(withLayers()));
  fn(doc);
  return JSON.stringify(doc);
};
const errorOf = (text: string) => {
  const r = parseProject(text);
  return r.ok ? null : r.error;
};

describe("serialize / parse", () => {
  test("round trip restores everything, including layer positions and order", () => {
    const original = withLayers();
    const r = parseProject(serializeProject(original));
    expect(r.ok && r.project).toEqual(original);
    expect(r.ok && r.project.screens[0].layers.map((l) => [l.id, l.zIndex, l.transform.x, l.transform.y])).toEqual([["a", 0, 30, 40], ["b", 1, 0, 0]]);
  });

  test("the file holds image ids only, never a Blob URL", () => {
    expect(serializeProject(withLayers())).not.toContain("blob:");
  });

  test("a project with no layers is valid", () => {
    expect(parseProject(serializeProject(makeProject())).ok).toBe(true);
  });
});

describe("screens[] rule", () => {
  test("two screens are rejected in Phase 1", () => {
    expect(errorOf(tweak((d) => d.screens.push(structuredClone(d.screens[0]))))).toContain("1개");
  });
  test("zero screens are rejected", () => {
    expect(errorOf(tweak((d) => (d.screens = [])))).toContain("1개");
  });
  test("screens must be an array", () => {
    expect(errorOf(tweak((d) => (d.screens = {})))).toContain("1개");
  });
});

describe("validation", () => {
  test.each([
    ["invalid JSON", "{nope", "JSON"],
    ["layer scale of 0 (it could not be drawn or turned back)", tweak((d) => (d.screens[0].layers[0].transform.scaleX = 0)), "scale"],
    ["layer scale that is not a number", tweak((d) => (d.screens[0].layers[0].transform.scaleY = "2")), "scale"],
    ["layer scale beyond any sane size", tweak((d) => (d.screens[0].layers[0].transform.scaleX = 100000)), "scale"],
    ["layer rotation that is not a number", tweak((d) => (d.screens[0].layers[0].transform.rotation = "90")), "rotation"],
    ["opacity out of range", tweak((d) => (d.screens[0].layers[0].opacity = 2)), "opacity"],
    ["duplicate layer ids", tweak((d) => (d.screens[0].layers[1].id = "a")), "중복"],
    ["patch with a non-colour fill", tweak((d) => (d.screens[0].backgroundPatches[0].fill = "red")), "fill"],
    ["missing source image", tweak((d) => delete d.screens[0].source), "source"],
    ["zero-size screen", tweak((d) => (d.screens[0].width = 0)), "width"],
    ["non-positive zoom", tweak((d) => (d.canvas.zoom = 0)), "canvas"],
  ])("rejects %s", (_name, text, fragment) => {
    expect(errorOf(text)).toContain(fragment);
  });
});

describe("migrate", () => {
  test("the current version passes through unchanged", () => {
    const doc = JSON.parse(serializeProject(makeProject()));
    expect(migrate(doc)).toEqual({ ok: true, doc });
  });
  test("a file from a newer app is refused", () => {
    expect(errorOf(tweak((d) => (d.version = 4)))).toContain("새로운");
  });
  test.each([[undefined], ["1"], [0], [1.5]])("a bad version (%s) is refused", (v) => {
    expect(errorOf(tweak((d) => (d.version = v)))).toContain("version");
  });
  test("non-objects are refused", () => {
    expect(migrate([]).ok).toBe(false);
    expect(migrate(null).ok).toBe(false);
  });
});
