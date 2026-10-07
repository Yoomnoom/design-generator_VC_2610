"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Image as KImage, Layer, Rect, Stage } from "react-konva";
import { sortByZ } from "@/features/layer-transform/order";
import { Point, clientToImage, imageToClient } from "@/lib/geometry/coords";
import { selectionFromImagePoints } from "@/lib/geometry/rect";
import { renderComposite } from "@/lib/image/render-export";
import { ZOOM_STEP, fitView, panBy, zoomAt } from "@/lib/geometry/view-transform";
import { selectScreen } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";
import { rawToCanvas } from "./raw-canvas";

const ACCENT = "#5b5ce2";
const MARQUEE = "#ee6f43";

type Gesture =
  | { kind: "rect"; a: Point }
  | { kind: "pan"; startX: number; startY: number; panX: number; panY: number };

/** The working canvas. Konva only draws. Every pointer position goes through lib/geometry/coords,
 *  so the rectangle you drag is computed in original-image pixels whatever the zoom, pan or devicePixelRatio. */
export default function CanvasViewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null);
  const gesture = useRef<Gesture | null>(null);

  const screen = useEditorStore(selectScreen);
  const images = useEditorStore((s) => s.images);
  const view = useEditorStore((s) => s.view);
  const tool = useEditorStore((s) => s.activeTool);
  const selectedId = useEditorStore((s) => s.selectedLayerIds[0]);
  const preview = useEditorStore((s) => s.dragPreview);

  useEffect(() => {
    const el = containerRef.current!;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  // a new image is shown whole and centred
  const hasSize = size.width > 0 && size.height > 0;
  useEffect(() => {
    if (screen && hasSize) editorStore.getState().setView(fitView(size, screen));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when a different screen appears or the viewport first gets a size
  }, [screen?.id, hasSize]);

  // wheel: Ctrl/⌘ + wheel (and trackpad pinch) zooms at the cursor, plain wheel pans
  useEffect(() => {
    const el = containerRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { view: v, setView } = editorStore.getState();
      const box = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) setView(zoomAt(v, v.zoom * Math.exp(-e.deltaY * 0.0015), { x: e.clientX - box.left, y: e.clientY - box.top }));
      else setView(panBy(v, -e.deltaX, -e.deltaY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const origin = () => {
    const box = containerRef.current!.getBoundingClientRect();
    return { x: box.left, y: box.top };
  };
  const toImage = (e: { clientX: number; clientY: number }, v = editorStore.getState().view) =>
    clientToImage({ x: e.clientX, y: e.clientY }, origin(), v, { x: screen!.x, y: screen!.y });

  const onPointerDown = (e: React.PointerEvent) => {
    if (!screen) return;
    const { view: v, activeTool } = editorStore.getState();
    if (e.button === 1 || (e.button === 0 && activeTool === "hand")) {
      gesture.current = { kind: "pan", startX: e.clientX, startY: e.clientY, panX: v.panX, panY: v.panY };
    } else if (e.button === 0 && activeTool === "rect") {
      const a = toImage(e, v);
      gesture.current = { kind: "rect", a };
      setMarquee({ a, b: a });
    } else return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || !screen) return;
    if (g.kind === "pan") {
      const v = editorStore.getState().view;
      editorStore.getState().setView({ ...v, panX: g.panX + e.clientX - g.startX, panY: g.panY + e.clientY - g.startY });
    } else setMarquee({ a: g.a, b: toImage(e) });
  };

  const endGesture = (e: React.PointerEvent, commit: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || !screen) return;
    if (g.kind === "rect") {
      const rect = commit ? selectionFromImagePoints(g.a, toImage(e), screen) : null;
      setMarquee(null);
      if (rect) editorStore.getState().beginExtraction(rect); // shows the colour dialog itself when the background is too varied
    }
  };

  // The source with its background patches painted in, as one bitmap: patches drawn as separate shapes
  // would anti-alias at fractional zoom and let a hairline of the original show through.
  const sourceRaw = screen && images.get(screen.source.imageId)?.raw;
  const patches = screen?.backgroundPatches; // same array until a patch changes, so moving a layer does not repaint this
  const baseCanvas = useMemo(
    () => (sourceRaw && patches && screen ? rawToCanvas(renderComposite({ width: screen.width, height: screen.height, source: sourceRaw, patches, layers: [] })) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- width/height come from the screen, which only changes with the source
    [sourceRaw, patches],
  );

  const layers = useMemo(() => (screen ? sortByZ(screen.layers) : []), [screen]);
  const marqueeRect = marquee && screen ? selectionFromImagePoints(marquee.a, marquee.b, screen) : null;
  const frameOrigin = { x: screen?.x ?? 0, y: screen?.y ?? 0 };
  const labelAt = screen ? imageToClient({ x: 0, y: 0 }, { x: 0, y: 0 }, view, frameOrigin) : null;
  const tagAt = marqueeRect ? imageToClient({ x: marqueeRect.x, y: marqueeRect.y }, { x: 0, y: 0 }, view, frameOrigin) : null;

  const zoomBy = (factor: number) => editorStore.getState().setView(zoomAt(view, view.zoom * factor, { x: size.width / 2, y: size.height / 2 }));
  const cursor = tool === "hand" ? "grab" : tool === "rect" ? "crosshair" : "default";

  return (
    <div
      ref={containerRef}
      data-testid="viewport"
      className="relative h-full w-full overflow-hidden"
      style={{ cursor, touchAction: "none", backgroundColor: "var(--canvas)", backgroundImage: "radial-gradient(#c9c8c3 1px, transparent 1px)", backgroundSize: "20px 20px" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endGesture(e, true)}
      onPointerCancel={(e) => endGesture(e, false)}
    >
      {hasSize && (
        <Stage
          width={size.width}
          height={size.height}
          x={view.panX}
          y={view.panY}
          scaleX={view.zoom}
          scaleY={view.zoom}
          onMouseDown={(e) => e.target === e.target.getStage() && editorStore.getState().activeTool === "select" && editorStore.getState().selectLayer(null)}
        >
          <Layer imageSmoothingEnabled={view.zoom < 1}>
            {screen && (
              <>
                <Rect x={screen.x} y={screen.y} width={screen.width} height={screen.height} fill="#ffffff" shadowColor="#191e23" shadowOpacity={0.18} shadowBlur={24} shadowOffsetY={8} listening={false} />
                {baseCanvas && <KImage image={baseCanvas} x={screen.x} y={screen.y} width={screen.width} height={screen.height} listening={false} />}
                {layers.map((layer) => {
                  const image = layer.imageId ? images.get(layer.imageId)?.raw : undefined;
                  if (!image) return null;
                  const at = preview?.layerId === layer.id ? preview : layer.transform;
                  const movable = tool === "select";
                  return (
                    <KImage
                      key={layer.id}
                      name={`layer-${layer.id}`}
                      image={rawToCanvas(image)}
                      x={screen.x + at.x}
                      y={screen.y + at.y}
                      width={image.width}
                      height={image.height}
                      opacity={layer.opacity}
                      draggable={movable}
                      listening={movable}
                      onMouseDown={() => editorStore.getState().selectLayer(layer.id)}
                      onTouchStart={() => editorStore.getState().selectLayer(layer.id)}
                      onDragMove={(e) => editorStore.getState().previewLayerDrag(layer.id, e.target.x() - screen.x, e.target.y() - screen.y)}
                      onDragEnd={() => editorStore.getState().commitLayerDrag()} // one history step, on release
                      onMouseEnter={(e) => movable && (e.target.getStage()!.container().style.cursor = "move")}
                      onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = "")}
                    />
                  );
                })}
                {layers.map((layer) => {
                  const image = layer.imageId ? images.get(layer.imageId)?.raw : undefined;
                  if (!image || layer.id !== selectedId) return null;
                  const at = preview?.layerId === layer.id ? preview : layer.transform;
                  return <Rect key={`sel-${layer.id}`} x={screen.x + at.x} y={screen.y + at.y} width={image.width} height={image.height} stroke={ACCENT} strokeWidth={2} strokeScaleEnabled={false} listening={false} />;
                })}
                {marqueeRect && (
                  <Rect x={screen.x + marqueeRect.x} y={screen.y + marqueeRect.y} width={marqueeRect.width} height={marqueeRect.height} stroke={MARQUEE} strokeWidth={2} strokeScaleEnabled={false} dash={[6, 4]} fill="rgba(238,111,67,0.07)" listening={false} />
                )}
              </>
            )}
          </Layer>
        </Stage>
      )}

      {screen && labelAt && (
        <div data-testid="screen-label" className="pointer-events-none absolute text-xs font-bold text-[#555]" style={{ left: labelAt.x, top: labelAt.y - 24 }}>
          원본 크기 · {screen.width} × {screen.height} px
        </div>
      )}
      {marqueeRect && tagAt && (
        <div data-testid="marquee-tag" className="pointer-events-none absolute rounded bg-[#ee6f43] px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ left: tagAt.x, top: tagAt.y - 22 }}>
          선택 영역 {marqueeRect.width} × {marqueeRect.height} px
        </div>
      )}

      {screen && (
        <div className="absolute right-4 top-3 flex gap-1.5 rounded-[10px] border border-[var(--line)] bg-white/90 p-1.5 shadow-sm" onPointerDown={(e) => e.stopPropagation()}>
          <button className="btn mini" aria-label="축소" onClick={() => zoomBy(1 / ZOOM_STEP)}>−</button>
          <button className="btn mini min-w-14" data-testid="zoom-readout" aria-label="100%로 되돌리기" onClick={() => zoomBy(1 / view.zoom)}>{Math.round(view.zoom * 100)}%</button>
          <button className="btn mini" aria-label="확대" onClick={() => zoomBy(ZOOM_STEP)}>＋</button>
          <button className="btn mini" onClick={() => hasSize && editorStore.getState().setView(fitView(size, screen))}>화면 맞춤</button>
        </div>
      )}
    </div>
  );
}
