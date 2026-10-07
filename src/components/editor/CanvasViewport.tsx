"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Image as KImage, Layer, Rect, Stage, Transformer } from "react-konva";
import { patchAt } from "@/features/background-fill/patch-at";
import { sortByZ } from "@/features/layer-transform/order";
import { Point, clientToImage, imageToClient } from "@/lib/geometry/coords";
import { selectionFromImagePoints } from "@/lib/geometry/rect";
import { renderComposite } from "@/lib/image/render-export";
import { View } from "@/lib/geometry/coords";
import { ZOOM_STEP, fitView, panBy, zoomAt } from "@/lib/geometry/view-transform";
import { selectScreen } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";
import { rawToCanvas } from "./raw-canvas";

const ACCENT = "#5b5ce2";
/** the space between the original and the edited frame in the side-by-side view, in image pixels */
const SPLIT_GAP = 48;
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
  const selectedPatchId = useEditorStore((s) => s.selectedPatchId);
  const needsFit = useEditorStore((s) => s.needsFit);
  const compare = useEditorStore((s) => s.compareMode);
  const comparing = compare !== "off";
  const preview = useEditorStore((s) => s.dragPreview);

  useEffect(() => {
    const el = containerRef.current!;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  // a newly uploaded image is shown whole and centred; an opened project keeps the view it was saved with
  const hasSize = size.width > 0 && size.height > 0;
  useEffect(() => {
    if (!screen || !hasSize || !needsFit) return;
    editorStore.getState().setView(fitView(size, screen));
    editorStore.getState().markFitted();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- size is read only at the moment a fit is requested
  }, [screen?.id, hasSize, needsFit]);

  // Side by side needs room for two frames. Entering it fits both; leaving it puts the view back where it was.
  const viewBeforeSplit = useRef<View | null>(null);
  const lastScreenId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!screen || !hasSize) return;
    if (screen.id !== lastScreenId.current) {
      lastScreenId.current = screen.id; // a different project: whatever view was kept belongs to the old one
      viewBeforeSplit.current = null;
      return;
    }
    const st = editorStore.getState();
    if (compare === "split") {
      viewBeforeSplit.current ??= st.view;
      st.setView(fitView(size, { x: screen.x - screen.width - SPLIT_GAP, y: screen.y, width: screen.width * 2 + SPLIT_GAP, height: screen.height }));
    } else if (viewBeforeSplit.current) {
      st.setView(viewBeforeSplit.current);
      viewBeforeSplit.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change of mode moves the view; size is read at that moment
  }, [compare, screen?.id, hasSize]);

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
    if (editorStore.getState().compareMode !== "off" && e.button !== 1 && activeTool !== "hand") return; // comparing: only moving the view
    if (e.button === 1 || (e.button === 0 && activeTool === "hand")) {
      gesture.current = { kind: "pan", startX: e.clientX, startY: e.clientY, panX: v.panX, panY: v.panY };
    } else if (e.button === 0 && activeTool === "fill") {
      const patch = patchAt(screen.backgroundPatches, toImage(e, v));
      editorStore.getState().selectPatch(patch?.id ?? null);
      return;
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

  const originalCanvas = useMemo(() => (sourceRaw ? rawToCanvas(sourceRaw) : null), [sourceRaw]);
  const layers = useMemo(() => (screen ? sortByZ(screen.layers) : []), [screen]);

  // The resize/rotate handles belong to the selected layer, and only while it can actually be changed.
  const layerRef = useRef<Konva.Layer>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const selected = layers.find((l) => l.id === selectedId);
  const showHandles = tool === "select" && !comparing && !!selected && selected.visible && !selected.locked;
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const node = showHandles ? layerRef.current?.findOne(`.layer-${selectedId}`) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  });
  const originalX = screen ? (compare === "split" ? screen.x - screen.width - SPLIT_GAP : screen.x) : 0;
  const marqueeRect = marquee && screen ? selectionFromImagePoints(marquee.a, marquee.b, screen) : null;
  const frameOrigin = { x: screen?.x ?? 0, y: screen?.y ?? 0 };
  const labelAt = screen ? imageToClient({ x: 0, y: 0 }, { x: 0, y: 0 }, view, frameOrigin) : null;
  const tagAt = marqueeRect ? imageToClient({ x: marqueeRect.x, y: marqueeRect.y }, { x: 0, y: 0 }, view, frameOrigin) : null;

  const zoomBy = (factor: number) => editorStore.getState().setView(zoomAt(view, view.zoom * factor, { x: size.width / 2, y: size.height / 2 }));
  const cursor = tool === "hand" ? "grab" : tool === "rect" ? "crosshair" : tool === "fill" ? "pointer" : "default";

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
          <Layer ref={layerRef} imageSmoothingEnabled={view.zoom < 1}>
            {screen && (
              <>
                <Rect x={screen.x} y={screen.y} width={screen.width} height={screen.height} fill="#ffffff" shadowColor="#191e23" shadowOpacity={0.18} shadowBlur={24} shadowOffsetY={8} listening={false} />
                {compare !== "original" && baseCanvas && <KImage image={baseCanvas} x={screen.x} y={screen.y} width={screen.width} height={screen.height} listening={false} />}
                {compare !== "off" && originalCanvas && (
                  <>
                    {compare === "split" && <Rect x={originalX} y={screen.y} width={screen.width} height={screen.height} fill="#ffffff" shadowColor="#191e23" shadowOpacity={0.18} shadowBlur={24} shadowOffsetY={8} listening={false} />}
                    <KImage image={originalCanvas} x={originalX} y={screen.y} width={screen.width} height={screen.height} listening={false} />
                  </>
                )}
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
                      scaleX={layer.transform.scaleX}
                      scaleY={layer.transform.scaleY}
                      rotation={layer.transform.rotation}
                      width={image.width}
                      height={image.height}
                      opacity={layer.opacity}
                      visible={layer.visible && compare !== "original"} // a hidden layer is neither drawn nor clickable; the original has no layers
                      draggable={movable && !layer.locked && !comparing}
                      listening={movable && layer.visible && !comparing}
                      onMouseDown={() => editorStore.getState().selectLayer(layer.id)}
                      onTouchStart={() => editorStore.getState().selectLayer(layer.id)}
                      onDragMove={(e) => editorStore.getState().previewLayerDrag(layer.id, e.target.x() - screen.x, e.target.y() - screen.y)}
                      onDragEnd={() => editorStore.getState().commitLayerDrag()} // one history step, on release
                      onTransformEnd={(e) => {
                        // handles were dragged: the node holds the new placement; the store keeps it (one history step) or refuses it
                        const node = e.target;
                        const ok = editorStore.getState().transformLayer(layer.id, { x: node.x() - screen.x, y: node.y() - screen.y, scaleX: node.scaleX(), scaleY: node.scaleY(), rotation: node.rotation() });
                        if (!ok) node.setAttrs({ x: screen.x + layer.transform.x, y: screen.y + layer.transform.y, scaleX: layer.transform.scaleX, scaleY: layer.transform.scaleY, rotation: layer.transform.rotation });
                      }}
                      onMouseEnter={(e) => movable && (e.target.getStage()!.container().style.cursor = "move")}
                      onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = "")}
                    />
                  );
                })}
                {layers.map((layer) => {
                  const image = layer.imageId ? images.get(layer.imageId)?.raw : undefined;
                  if (!image || layer.id !== selectedId || !layer.visible || showHandles || comparing) return null; // with handles, their frame is the outline
                  const at = preview?.layerId === layer.id ? preview : layer.transform;
                  return <Rect key={`sel-${layer.id}`} x={screen.x + at.x} y={screen.y + at.y} scaleX={layer.transform.scaleX} scaleY={layer.transform.scaleY} rotation={layer.transform.rotation} width={image.width} height={image.height} stroke={ACCENT} strokeWidth={2} strokeScaleEnabled={false} dash={layer.locked ? [6, 4] : undefined} listening={false} />;
                })}
                <Transformer
                  ref={transformerRef}
                  flipEnabled={false}
                  rotateAnchorOffset={26}
                  anchorSize={9}
                  anchorCornerRadius={2}
                  anchorFill="#ffffff"
                  anchorStroke={ACCENT}
                  borderStroke={ACCENT}
                  boundBoxFunc={(before, after) => (Math.abs(after.width) < 10 || Math.abs(after.height) < 10 ? before : after)} // never smaller than 10 screen px
                />
                {tool === "fill" && !comparing &&
                  screen.backgroundPatches.map((p) => (
                    <Rect
                      key={`patch-${p.id}`}
                      x={screen.x + p.rect.x}
                      y={screen.y + p.rect.y}
                      width={p.rect.width}
                      height={p.rect.height}
                      stroke={p.id === selectedPatchId ? ACCENT : "#888"}
                      strokeWidth={p.id === selectedPatchId ? 2.5 : 1}
                      strokeScaleEnabled={false}
                      dash={p.id === selectedPatchId ? undefined : [5, 4]}
                      listening={false}
                    />
                  ))}
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
      {screen && comparing && (
        <div data-testid="compare-badge" className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-[#171a1f] px-3 py-1 text-xs font-bold text-white">
          {compare === "original" ? "원본 보기 · 편집할 수 없습니다" : "나란히 보기 · 왼쪽 원본, 오른쪽 수정본 · 편집할 수 없습니다"}
        </div>
      )}
      {screen && compare === "split" &&
        (["original", "modified"] as const).map((which) => {
          const at = imageToClient({ x: which === "original" ? -(screen.width + SPLIT_GAP) : 0, y: screen.height }, { x: 0, y: 0 }, view, frameOrigin);
          return (
            <div key={which} data-testid={`compare-label-${which}`} className="pointer-events-none absolute rounded bg-[#171a1f] px-2 py-0.5 text-[11px] font-bold text-white" style={{ left: at.x, top: at.y + 8 }}>
              {which === "original" ? "원본" : "수정본"}
            </div>
          );
        })}
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
