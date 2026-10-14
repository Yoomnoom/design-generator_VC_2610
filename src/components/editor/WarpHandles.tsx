"use client";

import { useRef } from "react";
import type Konva from "konva";
import { Circle, Line, Rect } from "react-konva";
import { frameToLayerPoint, layerPointToFrame } from "@/lib/geometry/layer-transform";
import { BitmapLayer, LayerWarp, WarpMesh, WarpPoint, WarpQuad } from "@/lib/project/schema";
import { cloneWarp, dragMeshPoint, dragQuadCorner, dragQuadEdge, identityMesh, identityQuad } from "@/lib/image/warp";
import { editorStore } from "@/store/use-editor-store";

const ACCENT = "#5b5ce2";
const GRID = "#9b9cf0";

type Props = {
  layer: BitmapLayer;
  image: { width: number; height: number };
  /** where the frame starts on the canvas */
  origin: { x: number; y: number };
  zoom: number;
  warp: LayerWarp | null;
  mode: "quad" | "mesh";
  cols: number;
  rows: number;
};

type Drag = { start: LayerWarp; startAt: WarpPoint; kind: "corner" | "edge" | "point"; index: number };

/** The handles of the warp tool: the four corners and edge middles of the bitmap (quad), or a grid of control points (mesh), laid over the
 *  warped shape. Positions are the layer's own (warped-bitmap) points mapped to the frame by the layer's scale, rotation and position, so
 *  the handles stay on the bent picture at any zoom or turn. One drag is one undo step: the warp is previewed while the pointer is down and
 *  recorded when it is released. */
export default function WarpHandles({ layer, image, origin, zoom, warp, mode, cols, rows }: Props) {
  const drag = useRef<Drag | null>(null);
  const t = { ...layer.transform, x: Math.round(layer.transform.x), y: Math.round(layer.transform.y) }; // a warped layer sits on a whole pixel
  const shown: LayerWarp = warp ?? (mode === "mesh" ? identityMesh(cols, rows, image.width, image.height) : identityQuad(image.width, image.height));
  const toCanvas = (p: WarpPoint) => {
    const f = layerPointToFrame(t, p);
    return { x: origin.x + f.x, y: origin.y + f.y };
  };
  const fromCanvas = (x: number, y: number) => frameToLayerPoint(t, { x: x - origin.x, y: y - origin.y });
  const r = 6 / zoom; // handles keep their size on screen

  const begin = (kind: Drag["kind"], index: number, at: WarpPoint) => {
    drag.current = { start: cloneWarp(shown), startAt: at, kind, index };
  };
  const move = (e: Konva.KonvaEventObject<DragEvent>) => {
    const d = drag.current;
    if (!d) return;
    const p = fromCanvas(e.target.x(), e.target.y());
    const delta = { x: p.x - d.startAt.x, y: p.y - d.startAt.y };
    const ev = e.evt;
    let next: LayerWarp;
    if (d.start.kind === "quad") {
      // Alt: the corner next to it moves the opposite way (a perspective); with Shift that neighbour is the vertical one
      if (d.kind === "edge") next = dragQuadEdge(d.start as WarpQuad, d.index, delta);
      else next = dragQuadCorner(d.start as WarpQuad, d.index, delta, ev.altKey ? (ev.shiftKey ? "y" : "x") : "none");
    } else next = dragMeshPoint(d.start as WarpMesh, d.index, delta);
    editorStore.getState().previewWarp(layer.id, next);
  };
  const end = () => {
    drag.current = null;
    editorStore.getState().commitWarpPreview(); // the one undo step
  };
  const common = (kind: Drag["kind"], index: number, at: WarpPoint) => ({
    draggable: true,
    onDragStart: () => begin(kind, index, at),
    onDragMove: move,
    onDragEnd: end,
    onMouseEnter: (e: Konva.KonvaEventObject<MouseEvent>) => (e.target.getStage()!.container().style.cursor = "pointer"),
    onMouseLeave: (e: Konva.KonvaEventObject<MouseEvent>) => (e.target.getStage()!.container().style.cursor = ""),
  });

  const lines: number[][] = [];
  const handles: React.ReactNode[] = [];
  if (shown.kind === "quad") {
    const pts = shown.points.map(toCanvas);
    lines.push([...pts.flatMap((p) => [p.x, p.y]), pts[0].x, pts[0].y]);
    shown.points.forEach((p, i) => {
      const c = pts[i];
      handles.push(<Circle key={`c${i}`} name="warp-handle" x={c.x} y={c.y} radius={r} fill="#fff" stroke={ACCENT} strokeWidth={2} strokeScaleEnabled={false} {...common("corner", i, p)} />);
    });
    shown.points.forEach((p, i) => {
      const q = shown.points[(i + 1) % 4];
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const c = toCanvas(mid);
      handles.push(<Rect key={`e${i}`} name="warp-handle" x={c.x} y={c.y} offsetX={r * 0.8} offsetY={r * 0.8} width={r * 1.6} height={r * 1.6} fill={ACCENT} stroke="#fff" strokeWidth={1} strokeScaleEnabled={false} {...common("edge", i, mid)} />);
    });
  } else {
    const { cols: nc, rows: nr, points } = shown;
    const at = (i: number, j: number) => toCanvas(points[j * (nc + 1) + i]);
    for (let j = 0; j <= nr; j++) lines.push(Array.from({ length: nc + 1 }, (_, i) => [at(i, j).x, at(i, j).y]).flat());
    for (let i = 0; i <= nc; i++) lines.push(Array.from({ length: nr + 1 }, (_, j) => [at(i, j).x, at(i, j).y]).flat());
    points.forEach((p, n) => {
      const c = toCanvas(p);
      handles.push(<Circle key={`m${n}`} name="warp-handle" x={c.x} y={c.y} radius={r * 0.8} fill="#fff" stroke={ACCENT} strokeWidth={2} strokeScaleEnabled={false} {...common("point", n, p)} />);
    });
  }
  return (
    <>
      {lines.map((pts, i) => (
        <Line key={`l${i}`} points={pts} stroke={shown.kind === "mesh" ? GRID : ACCENT} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      ))}
      {handles}
    </>
  );
}
