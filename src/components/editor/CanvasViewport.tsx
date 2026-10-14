"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { effectTileFor } from "./effect-tile";
import { hasEffects } from "@/lib/image/layer-effects";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { Circle, Image as KImage, Layer, Line, Rect, Shape, Stage, Text, Transformer } from "react-konva";
import { layerBox } from "@/features/snap/layer-box";
import { BitmapLayer } from "@/lib/project/schema";
import { Box, SNAP_SCREEN_PIXELS, snapMove, unionBox } from "@/features/snap/snap";
import { renderProjectRaw } from "@/features/export-image/export-png";
import { rgbToHex } from "@/lib/image/color";
import { DrawCtx, drawContent, shapeFromDrag } from "@/lib/image/vector";
import { SHAPE_TOOLS } from "@/store/editor-store";
import { applyStroke } from "@/features/brush/brush";
import { FingerStroke, bitmapMapper, startFingerStroke } from "@/features/smudge/finger";
import { startLiquifyStroke } from "@/features/liquify/liquify";
import { MAX_STROKE_POINTS } from "@/lib/image/brush-raster";
import { patchAt } from "@/features/background-fill/patch-at";
import { sortByZ } from "@/features/layer-transform/order";
import { Point, clientToImage, imageToClient } from "@/lib/geometry/coords";
import { FreeOp, HandleKind, ROTATE_GAP, canStretch, handlePoint, minFactor, rotateFromDrag, scaleFromDrag, selectionBox } from "@/features/free-transform/free-transform";
import { MARQUEE_MIN_SCREEN_DRAG, MarqueeMode, boxFromPoints, combineSelection, marqueeHits } from "@/features/marquee/marquee";
import { selectionFromImagePoints } from "@/lib/geometry/rect";
import { renderComposite } from "@/lib/image/render-export";
import { View } from "@/lib/geometry/coords";
import { ZOOM_STEP, fitView, panBy, zoomAt } from "@/lib/geometry/view-transform";
import { selectScreen } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";
import { rawToCanvas } from "./raw-canvas";
import CandidateBar from "./CandidateBar";
import CandidateOverlay from "./CandidateOverlay";
import MemoLayer from "./MemoLayer";
import TextEditor from "./TextEditor";
import VectorShape from "./VectorShape";
import WarpHandles from "./WarpHandles";
import WarpedShape from "./WarpedShape";
import { effectiveWarp } from "@/lib/image/warp";
import { warpOutline } from "@/lib/image/warp";
import { layerPointToFrame } from "@/lib/geometry/layer-transform";

const ACCENT = "#5b5ce2";
/** the space between the original and the edited frame in the side-by-side view, in image pixels */
const SPLIT_GAP = 48;
const MARQUEE = "#ee6f43";

type Gesture =
  | { kind: "rect"; a: Point }
  | { kind: "shape"; a: Point }
  | { kind: "brush"; points: Point[] }
  | { kind: "finger"; stroke: FingerStroke; imageData: ImageData; context: CanvasRenderingContext2D }
  | { kind: "pan"; startX: number; startY: number; panX: number; panY: number }
  /** a box selection started on an empty place with the select tool; `moved` once the pointer has gone a few screen pixels */
  | { kind: "pick"; a: Point; startX: number; startY: number; moved: boolean }
  /** a drag of a free-transform handle: the selection box at the start, which handle, and what the layers allow */
  | { kind: "ft"; handle: HandleKind; box: { x: number; y: number; width: number; height: number }; start: Point; stretch: boolean; min: number; op: FreeOp | null };

/** The working canvas. Konva only draws. Every pointer position goes through lib/geometry/coords,
 *  so the rectangle you drag is computed in original-image pixels whatever the zoom, pan or devicePixelRatio. */
export default function CanvasViewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null);
  const [shapeDrag, setShapeDrag] = useState<{ a: Point; b: Point } | null>(null);
  const brushPoints = useRef<Point[] | null>(null); // the stroke being drawn: points in image pixels (the live preview reads it)
  const [, setBrushTick] = useState(0);
  const drawStyle = useEditorStore((s) => s.drawStyle);
  const gesture = useRef<Gesture | null>(null);
  /** the box being dragged for a box selection, and the layers it would select (shown before the button is released) */
  const [pickDrag, setPickDrag] = useState<{ box: Box; hits: string[]; mode: MarqueeMode } | null>(null);
  const [ring, setRing] = useState<Point | null>(null); // where the finger / liquify brush is, for its ring
  const fingerSize = useEditorStore((s) => s.fingerStyle.size);
  const liquifySize = useEditorStore((s) => s.liquifyStyle.size);
  const space = useRef(false); // Space held: a temporary hand, whatever the tool
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["TEXTAREA", "SELECT"].includes(t.tagName) || (t instanceof HTMLInputElement && !["checkbox", "radio", "button", "range", "color"].includes(t.type))); // a focused checkbox is not a text box
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !typing(e.target) && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        space.current = true;
        if (e.target === document.body || (e.target instanceof HTMLElement && containerRef.current?.contains(e.target))) e.preventDefault();
      } else if (e.key === "Escape" && gesture.current?.kind === "ft") {
        gesture.current = null; // Esc while dragging a handle: back to how it was, no history
        editorStore.getState().setFreeTransformPreview(null);
        e.stopPropagation();
      } else if (e.key === "Escape" && gesture.current?.kind === "pick") {
        // Esc cancels the box: nothing is selected or changed, and the other Esc meanings do not run
        gesture.current = null;
        setPickDrag(null);
        e.stopPropagation();
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && (space.current = false);
    const blur = () => (space.current = false);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  /** the finger stroke being made: its working picture (the canvas the layer shows meanwhile) and a counter that tells a warped layer to redraw */
  const [finger, setFinger] = useState<{ layerId: string; canvas: HTMLCanvasElement; raw: { width: number; height: number; data: Uint8ClampedArray }; rev: number } | null>(null);

  const screen = useEditorStore(selectScreen);
  const images = useEditorStore((s) => s.images);
  const view = useEditorStore((s) => s.view);
  const tool = useEditorStore((s) => s.activeTool);
  const selectedIds = useEditorStore((s) => s.selectedLayerIds);
  const selectedId = selectedIds[0];
  const snapGuides = useEditorStore((s) => s.snapGuides);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const selectedPatchId = useEditorStore((s) => s.selectedPatchId);
  const needsFit = useEditorStore((s) => s.needsFit);
  const compare = useEditorStore((s) => s.compareMode);
  const comparing = compare !== "off";
  const preview = useEditorStore((s) => s.dragPreview);
  const warpPreview = useEditorStore((s) => s.warpPreview);
  const cornerPreview = useEditorStore((s) => s.cornerPreview);
  const warpUi = useEditorStore((s) => s.warpUi);
  const warpSession = useEditorStore((s) => s.warpSession);

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

  const roundPoint = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });

  /** The eyedropper: the colour of the finished picture (source, patches, layers) at an image pixel. It reads the same pixels the
   *  PNG export produces, so zoom, devicePixelRatio and what is drawn on top of what cannot change the answer. */
  const pickColorAt = (p: Point) => {
    const st = editorStore.getState();
    const project = st.snapshotProject();
    if (!project) return;
    const sc = project.screens[0];
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= sc.width || y >= sc.height) return;
    const raw = renderProjectRaw(project, st.images);
    const i = (y * raw.width + x) * 4;
    if (raw.data[i + 3] === 0) return st.setNotice("그 자리는 투명해서 색을 읽을 수 없습니다.");
    st.setDrawStyle({ [st.drawStyle.pickTarget]: rgbToHex({ r: raw.data[i], g: raw.data[i + 1], b: raw.data[i + 2] }) });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!screen) return;
    const { view: v, activeTool } = editorStore.getState();
    if (editorStore.getState().compareMode !== "off" && e.button !== 1 && activeTool !== "hand") return; // comparing: only moving the view
    if (e.button === 1 || (e.button === 0 && (activeTool === "hand" || (space.current && activeTool !== "text")))) {
      gesture.current = { kind: "pan", startX: e.clientX, startY: e.clientY, panX: v.panX, panY: v.panY };
    } else if (e.button === 0 && activeTool === "fill") {
      const patch = patchAt(screen.backgroundPatches, toImage(e, v));
      editorStore.getState().selectPatch(patch?.id ?? null);
      return;
    } else if (e.button === 0 && activeTool === "rect") {
      const a = toImage(e, v);
      gesture.current = { kind: "rect", a };
      setMarquee({ a, b: a });
    } else if (e.button === 0 && SHAPE_TOOLS[activeTool]) {
      const a = roundPoint(toImage(e, v));
      gesture.current = { kind: "shape", a };
      setShapeDrag({ a, b: a });
    } else if (e.button === 0 && (activeTool === "brush" || activeTool === "eraser")) {
      const q = toImage(e, v);
      brushPoints.current = [{ x: Math.round(q.x * 100) / 100, y: Math.round(q.y * 100) / 100 }];
      gesture.current = { kind: "brush", points: brushPoints.current };
      setBrushTick((t) => t + 1);
    } else if (e.button === 0 && (activeTool === "finger" || activeTool === "liquify")) {
      const st = editorStore.getState();
      let target = st.selectedLayerIds.length === 1 ? st.selectedLayerIds[0] : undefined;
      if (!target) {
        // nothing chosen yet: the layer under the pointer is taken, so the first drag on a picture just works
        const at = toImage(e, v);
        for (const l of [...(screen?.layers ?? [])].sort((x, y) => y.zIndex - x.zIndex)) {
          const pic = l.imageId ? editorStore.getState().images.get(l.imageId)?.raw : undefined;
          if (!pic || !l.visible || l.content) continue;
          const q = bitmapMapper(l, pic)(at);
          if (q && q.x >= 0 && q.y >= 0 && q.x < pic.width && q.y < pic.height && pic.data[(Math.floor(q.y) * pic.width + Math.floor(q.x)) * 4 + 3] > 0) {
            st.selectLayer(l.id);
            target = l.id;
            break;
          }
        }
      }
      const name = activeTool === "liquify" ? "유동화" : "손가락";
      const started = activeTool === "liquify" ? startLiquifyStroke(editorStore, target ?? "") : startFingerStroke(editorStore, target ?? "");
      if (!started.ok) {
        st.setNotice(target ? started.reason : `${name} 도구는 이미지 레이어 위에서 쓸 수 있습니다. 이미지 레이어를 선택하거나 그 위를 끌어 보세요. 원본 스크린샷은 바꿀 수 없습니다.`);
        return;
      }
      const { raw } = started.stroke;
      const canvas = document.createElement("canvas");
      canvas.width = raw.width;
      canvas.height = raw.height;
      const context = canvas.getContext("2d")!;
      const imageData = new ImageData(raw.data as Uint8ClampedArray<ArrayBuffer>, raw.width, raw.height); // shares the working picture: no copy per move
      context.putImageData(imageData, 0, 0);
      setFinger({ layerId: started.stroke.layerId, canvas, raw, rev: 0 });
      gesture.current = { kind: "finger", stroke: started.stroke, imageData, context };
      started.stroke.move(toImage(e, v));
    } else if (e.button === 0 && activeTool === "text") {
      // a click while a box is open is the user leaving it (the box commits on blur); the next click makes the next box
      if (editorStore.getState().textEditing) return;
      editorStore.getState().beginTextEdit(roundPoint(toImage(e, v)));
      e.preventDefault();
      return;
    } else if (e.button === 0 && activeTool === "auto") {
      editorStore.getState().pickCandidateAt(toImage(e, v));
      e.preventDefault();
      return;
    } else if (e.button === 0 && activeTool === "memo") {
      const p = roundPoint(toImage(e, v));
      editorStore.getState().addMemo(p.x, p.y);
      e.preventDefault();
      return;
    } else if (e.button === 0 && activeTool === "eyedropper") {
      pickColorAt(toImage(e, v));
      return;
    } else if (e.button === 0 && activeTool === "select") {
      // a press on a layer (or a handle) belongs to Konva: it moves or resizes it. A press on an empty place, the original picture
      // included (it is never moved), starts a box selection.
      const stage = layerRef.current?.getStage();
      const r = containerRef.current!.getBoundingClientRect();
      const hitNode = stage?.getIntersection({ x: e.clientX - r.left, y: e.clientY - r.top });
      const handleName = hitNode?.name() ?? "";
      if (handleName.startsWith("ft-handle-") && ftBox) {
        const chosen = layers.filter((l) => selectedIds.includes(l.id));
        gesture.current = { kind: "ft", handle: handleName.slice("ft-handle-".length) as HandleKind, box: ftBox, start: toImage(e, v), stretch: canStretch(chosen), min: minFactor(chosen), op: null };
      } else if (hitNode) return;
      if (gesture.current?.kind === "ft") {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      gesture.current = { kind: "pick", a: toImage(e, v), startX: e.clientX, startY: e.clientY, moved: false };
      // preventing the default below also stops the browser from moving focus off a field or checkbox, so do that here (shortcuts need the page to have focus)
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
    } else return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    {
      const t0 = editorStore.getState().activeTool;
      if (screen && (t0 === "finger" || t0 === "liquify")) setRing(toImage(e)); // the brush ring follows the pointer
    }
    if (!gesture.current && screen && editorStore.getState().activeTool === "auto") return editorStore.getState().hoverCandidateAt(toImage(e));
    const g = gesture.current;
    if (!g || !screen) return;
    if (g.kind === "pan") {
      const v = editorStore.getState().view;
      editorStore.getState().setView({ ...v, panX: g.panX + e.clientX - g.startX, panY: g.panY + e.clientY - g.startY });
    } else if (g.kind === "brush") {
      const q = toImage(e);
      const last = g.points[g.points.length - 1];
      if (Math.hypot(q.x - last.x, q.y - last.y) >= 0.75 && g.points.length < MAX_STROKE_POINTS) {
        g.points.push({ x: Math.round(q.x * 100) / 100, y: Math.round(q.y * 100) / 100 });
        setBrushTick((t) => t + 1);
      }
    } else if (g.kind === "finger") {
      // every pointer sample the browser collected since the last event, so a fast curve is followed and not cut short
      const native = e.nativeEvent as PointerEvent;
      const samples = native.getCoalescedEvents?.() ?? [];
      let box: { x: number; y: number; width: number; height: number } | null = null;
      for (const s of samples.length ? samples : [native]) {
        const b = g.stroke.move(toImage(s));
        if (b) box = box ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), width: Math.max(box.x + box.width, b.x + b.width) - Math.min(box.x, b.x), height: Math.max(box.y + box.height, b.y + b.height) - Math.min(box.y, b.y) } : b;
      }
      if (box) {
        // only the pixels this move wrote are copied to the canvas the layer shows; the layer itself is not re-encoded
        g.context.putImageData(g.imageData, 0, 0, box.x, box.y, box.width, box.height);
        if (screen.layers.find((l) => l.id === g.stroke.layerId)?.warp) setFinger((f) => f && { ...f, rev: f.rev + 1 });
        else layerRef.current?.batchDraw();
      }
    } else if (g.kind === "shape") setShapeDrag({ a: g.a, b: roundPoint(toImage(e)) });
    else if (g.kind === "ft") {
      const p = toImage(e);
      g.op = g.handle === "rotate" ? rotateFromDrag(g.box, g.start, p, e.shiftKey) : scaleFromDrag(g.box, g.handle, p, { shift: e.shiftKey, alt: e.altKey, stretch: g.stretch, min: g.min });
      editorStore.getState().setFreeTransformPreview(g.op);
    } else if (g.kind === "pick") {
      if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < MARQUEE_MIN_SCREEN_DRAG) return;
      g.moved = true;
      const box = boxFromPoints(g.a, toImage(e));
      const mode: MarqueeMode = e.altKey ? "contain" : "touch";
      setPickDrag({ box, mode, hits: marqueeHits(screen.layers, (l) => boxOf(l), box, mode, !(e.ctrlKey || e.metaKey)) });
    } else setMarquee({ a: g.a, b: toImage(e) });
  };

  const endGesture = (e: React.PointerEvent, commit: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || !screen) return;
    if (g.kind === "ft") {
      const st = editorStore.getState();
      if (commit && g.op) st.applyFreeTransform(g.op); // the whole drag is ONE undo step
      else st.setFreeTransformPreview(null);
      return;
    }
    if (g.kind === "pick") {
      setPickDrag(null);
      const st = editorStore.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      if (!commit) return;
      if (!g.moved) {
        if (!e.shiftKey && !ctrl) st.deselectAll(); // a click on an empty place clears the selection
        return;
      }
      const box = boxFromPoints(g.a, toImage(e));
      const hits = marqueeHits(screen.layers, (l) => boxOf(l), box, e.altKey ? "contain" : "touch", !ctrl);
      st.setLayerSelection(combineSelection(st.selectedLayerIds, hits, ctrl ? "toggle" : e.shiftKey ? "add" : "replace"));
      return;
    }
    if (g.kind === "finger") {
      setFinger(null);
      if (commit) g.stroke.finish(); // one stroke is one undo step, and a new picture; a stroke that did not move records nothing
      return;
    }
    if (g.kind === "brush") {
      const tool = editorStore.getState().activeTool;
      brushPoints.current = null;
      setBrushTick((t) => t + 1);
      // one stroke is one undo step; the bitmap is painted once, here, not while dragging
      if (commit && (tool === "brush" || tool === "eraser")) applyStroke({ store: editorStore, tool, points: g.points });
      return;
    }
    if (g.kind === "shape") {
      const st = editorStore.getState();
      const kind = SHAPE_TOOLS[st.activeTool];
      setShapeDrag(null);
      const made = commit && kind ? shapeFromDrag(kind, g.a, roundPoint(toImage(e)), st.drawStyle) : null;
      if (made) st.addVectorLayer(made.content, made.x, made.y); // one undo step; a click or a tiny drag makes nothing
      return;
    }
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
  // free transform: one box around the selection (always with two or more layers; for one layer only when switched on)
  const freeTransform = useEditorStore((s) => s.freeTransform);
  const ftPreview = useEditorStore((s) => s.ftPreview);
  const grid = useEditorStore((s) => s.grid);
  const opacityPreview = useEditorStore((s) => s.opacityPreview);
  const effectsPreview = useEditorStore((s) => s.effectsPreview);
  const previewOf = (l0: BitmapLayer): BitmapLayer => {
    const l1 = opacityPreview?.layerId === l0.id ? { ...l0, opacity: opacityPreview.opacity } : l0; // the opacity slider is being dragged
    const l = effectsPreview?.layerId === l0.id ? { ...l1, effects: effectsPreview.effects } : l1; // an effect value is being dragged
    return ftPreview?.[l.id] ? { ...l, transform: ftPreview[l.id].transform, ...(ftPreview[l.id].content ? { content: ftPreview[l.id].content } : {}) } : l;
  };
  const ftOn = screen && tool === "select" && compare === "off" && (selectedIds.length >= 2 || (freeTransform && selectedIds.length >= 1));
  const ftSelected = ftOn ? layers.filter((l) => selectedIds.includes(l.id)) : [];
  const ftSizes = (l: BitmapLayer) => (l.imageId ? images.get(l.imageId)?.raw : undefined);
  const ftBox = ftOn ? selectionBox(ftSelected, ftSizes) : null;
  const ftNow = ftBox && ftPreview ? selectionBox(ftSelected.map(previewOf), ftSizes) : null;

  // Dragging a selected layer drags the whole selection: the dragged layer's preview is in the store, the others follow by the same distance
  // (a locked one stays). Nothing is stored until the drop.
  const dragged = preview ? layers.find((l) => l.id === preview.layerId) : undefined;
  const groupDelta = preview && dragged && selectedIds.includes(preview.layerId) ? { dx: preview.x - dragged.transform.x, dy: preview.y - dragged.transform.y } : null;
  const placedAt = (layer: BitmapLayer): { x: number; y: number } =>
    preview && preview.layerId === layer.id ? { x: preview.x, y: preview.y } : groupDelta && selectedIds.includes(layer.id) && !layer.locked ? { x: layer.transform.x + groupDelta.dx, y: layer.transform.y + groupDelta.dy } : layer.transform;
  const bitmapSize = (layer: BitmapLayer) => (layer.imageId ? images.get(layer.imageId)?.raw : undefined);
  const boxOf = (layer: BitmapLayer, where: { x: number; y: number } = layer.transform): Box | null => layerBox({ ...layer, transform: { ...layer.transform, x: where.x, y: where.y } }, bitmapSize(layer));
  const groupBox = selectedIds.length > 1 && !comparing ? unionBox(layers.filter((l) => selectedIds.includes(l.id) && l.visible).map((l) => boxOf(l, placedAt(l))).filter((b): b is Box => !!b)) : null;

  /** a press on a layer: with Shift/Ctrl it joins or leaves the selection (and a layer that left is not dragged); without, a member of a
   *  selection keeps the selection so the group can be dragged, and anything else becomes the selection */
  const altCopy = useRef(false); // Alt was held when the press began: the drag makes copies and leaves the layers where they were
  const pressLayer = (id: string, additive: boolean, node: Konva.Node, addOnly = false, alt = false) => {
    const st = editorStore.getState();
    altCopy.current = alt && !additive;
    if (additive && addOnly) {
      // Shift+click adds (a layer already in the selection stays in it and can be dragged with the rest)
      if (!st.selectedLayerIds.includes(id)) st.toggleLayerSelection(id); // this layer only, not its group
      return;
    }
    if (additive) {
      st.toggleLayerSelection(id); // Ctrl+click: this one layer, even inside a group
      if (!editorStore.getState().selectedLayerIds.includes(id)) node.stopDrag();
      return;
    }
    if (!st.selectedLayerIds.includes(id)) st.selectLayerWithGroup(id);
  };

  /** while dragging: where the layer (or the group) would land, pulled onto the lines of other layers and the frame unless Alt is held */
  const dragMove = (layer: BitmapLayer, e: KonvaEventObject<DragEvent>) => {
    if (!screen) return;
    const st = editorStore.getState();
    let x = e.target.x() - screen.x;
    let y = e.target.y() - screen.y;
    let guides: ReturnType<typeof snapMove>["guides"] = [];
    if (st.snapEnabled && !e.evt.altKey) {
      const group = st.selectedLayerIds.includes(layer.id) ? st.selectedLayerIds : [layer.id];
      const dx = x - layer.transform.x;
      const dy = y - layer.transform.y;
      const movers = layers.filter((l) => group.includes(l.id) && (l.id === layer.id || !l.locked));
      const moving = unionBox(movers.map((l) => boxOf(l, { x: l.transform.x + dx, y: l.transform.y + dy })).filter((b): b is Box => !!b));
      const others = layers.filter((l) => l.visible && !group.includes(l.id)).map((l) => boxOf(l)).filter((b): b is Box => !!b);
      if (moving) {
        const r = snapMove(moving, others, screen, SNAP_SCREEN_PIXELS / st.view.zoom);
        x += r.dx;
        y += r.dy;
        guides = r.guides;
      }
    }
    if (st.grid.on && st.grid.snap) {
      // the layer's top-left corner lands on a grid line (the grid's own snap, apart from the line snap above)
      x = Math.round(x / st.grid.size) * st.grid.size;
      y = Math.round(y / st.grid.size) * st.grid.size;
    }
    x = Math.round(x);
    y = Math.round(y);
    e.target.position({ x: screen.x + x, y: screen.y + y }); // the layer is shown where it would land
    st.previewLayerDrag(layer.id, x, y);
    st.setSnapGuides(guides);
  };

  // The resize/rotate handles belong to the selected layer, and only while it can actually be changed.
  const layerRef = useRef<Konva.Layer>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const selected = layers.find((l) => l.id === selectedId);
  // a warped layer has no resize/rotate frame (its shape is not a rectangle); its panel fields and the warp tool change it
  const showHandles = tool === "select" && !comparing && selectedIds.length === 1 && !freeTransform && !!selected && selected.visible && !selected.locked && !selected.warp;
  const warpTarget = tool === "warp" && !comparing && warpSession && selectedIds.length === 1 && selectedId === warpSession.layerId ? layers.find((l) => l.id === warpSession.layerId) : undefined;
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const node = showHandles ? layerRef.current?.findOne(`.layer-${selectedId}`) : null;
    // a text box is resized by its width only (its letters keep their size), so it has just the side handles
    tr.enabledAnchors(selected?.content?.kind === "text" ? ["middle-left", "middle-right"] : ["top-left", "top-center", "top-right", "middle-right", "middle-left", "bottom-left", "bottom-center", "bottom-right"]);
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  });
  const originalX = screen ? (compare === "split" ? screen.x - screen.width - SPLIT_GAP : screen.x) : 0;
  const dragKind = SHAPE_TOOLS[tool];
  const shapePreview = shapeDrag && dragKind ? shapeFromDrag(dragKind, shapeDrag.a, shapeDrag.b, drawStyle) : null;
  const marqueeRect = marquee && screen ? selectionFromImagePoints(marquee.a, marquee.b, screen) : null;
  const frameOrigin = { x: screen?.x ?? 0, y: screen?.y ?? 0 };
  const labelAt = screen ? imageToClient({ x: 0, y: 0 }, { x: 0, y: 0 }, view, frameOrigin) : null;
  const tagAt = marqueeRect ? imageToClient({ x: marqueeRect.x, y: marqueeRect.y }, { x: 0, y: 0 }, view, frameOrigin) : null;

  const zoomBy = (factor: number) => editorStore.getState().setView(zoomAt(view, view.zoom * factor, { x: size.width / 2, y: size.height / 2 }));
  // keyboard zoom (Ctrl+0 fit, Ctrl+1 100%, Ctrl++ / Ctrl+-) arrives as an event from the shortcut handler, which does not know the viewport size
  const zoomRef = useRef({ view, size, screen, zoomBy });
  zoomRef.current = { view, size, screen, zoomBy };
  useEffect(() => {
    const on = (e: Event) => {
      const { view: v, size: sz, screen: sc, zoomBy: zb } = zoomRef.current;
      const what = (e as CustomEvent<string>).detail;
      if (!sc || sz.width === 0) return;
      if (what === "fit") editorStore.getState().setView(fitView(sz, sc));
      else if (what === "100") zb(1 / v.zoom);
      else if (what === "in") zb(ZOOM_STEP);
      else if (what === "out") zb(1 / ZOOM_STEP);
    };
    window.addEventListener("slc-zoom", on);
    return () => window.removeEventListener("slc-zoom", on);
  }, []);
  const cursor = tool === "hand" ? "grab" : tool === "text" ? "text" : tool === "memo" || tool === "auto" || tool === "finger" || tool === "liquify" ? "crosshair" : tool === "rect" || tool === "eyedropper" || tool === "brush" || tool === "eraser" || SHAPE_TOOLS[tool] ? "crosshair" : tool === "fill" ? "pointer" : "default";

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
      onPointerLeave={() => {
          editorStore.getState().hoverCandidateAt(null);
          setRing(null);
        }}
    >
      {hasSize && (
        <Stage
          width={size.width}
          height={size.height}
          x={view.panX}
          y={view.panY}
          scaleX={view.zoom}
          scaleY={view.zoom}
          
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
                {layers.map((baseLayer) => {
                  const layer = previewOf(baseLayer); // what a drag of a handle or slider would make, shown before anything is recorded
                  // a layer with effects is drawn as ONE picture (the layer with its effects), made by the same function as the PNG; its own node stays
                  // for clicking, dragging and the handles, but draws nothing
                  const fx = screen && hasEffects(layer.effects) && !comparing ? effectTileFor(layer, images, { width: screen.width, height: screen.height }) : null;
                  const node = (() => {
                  const image = layer.imageId ? images.get(layer.imageId)?.raw : undefined;
                  // while the radius slider is dragged the shape shows the value at once (nothing is in the history yet)
                  const content = layer.content?.kind === "rect" && cornerPreview?.layerId === layer.id ? { ...layer.content, cornerRadius: cornerPreview.cornerRadius } : layer.content;
                  if (!image && !content) return null;
                  const at = placedAt(layer);
                  const warp = image ? effectiveWarp(warpPreview?.layerId === layer.id ? warpPreview.warp : layer.warp, image.width, image.height) : undefined;
                  const movable = tool === "select";
                  const shared = {
                    name: `layer-${layer.id}`,
                    x: screen.x + at.x,
                    y: screen.y + at.y,
                    scaleX: layer.transform.scaleX,
                    scaleY: layer.transform.scaleY,
                    rotation: layer.transform.rotation,
                    opacity: fx ? 0 : layer.opacity,
                    globalCompositeOperation: (fx ? "source-over" : layer.blend ?? "source-over") as GlobalCompositeOperation, // the blend mode: the canvas mixes it the way the export does
                    visible: layer.visible && compare !== "original", // a hidden layer is neither drawn nor clickable; the original has no layers
                    draggable: movable && !layer.locked && !comparing,
                    listening: movable && layer.visible && !comparing,
                    onMouseDown: (e: KonvaEventObject<MouseEvent>) => pressLayer(layer.id, e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey, e.target, e.evt.shiftKey && !e.evt.ctrlKey && !e.evt.metaKey, e.evt.altKey),
                    onTouchStart: (e: KonvaEventObject<TouchEvent>) => pressLayer(layer.id, false, e.target),
                    // a plain click (no drag) on a member of a selection narrows the selection to that layer
                    onClick: (e: KonvaEventObject<MouseEvent>) => !(e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey) && editorStore.getState().selectedLayerIds.length > 1 && editorStore.getState().selectLayerWithGroup(layer.id),
                    onDblClick: () => layer.content?.kind === "text" && editorStore.getState().activeTool === "select" && editorStore.getState().beginTextEdit({ layerId: layer.id }),
                    onDblTap: () => layer.content?.kind === "text" && editorStore.getState().activeTool === "select" && editorStore.getState().beginTextEdit({ layerId: layer.id }),
                    onDragMove: (e: KonvaEventObject<DragEvent>) => dragMove(layer, e),
                    onDragEnd: (e: KonvaEventObject<DragEvent>) => {
              // one history step, on release. With Alt held at the press, the drop makes copies and the dragged layer goes back where it was.
              if (altCopy.current) {
                altCopy.current = false;
                const origin = layer.transform;
                editorStore.getState().commitLayerDragAsCopy();
                e.target.position({ x: screen.x + origin.x, y: screen.y + origin.y });
                e.target.getLayer()?.batchDraw();
              } else editorStore.getState().commitLayerDrag();
            },
                    onTransformEnd: (e: KonvaEventObject<Event>) => {
                      // handles were dragged: the node holds the new placement; the store keeps it (one history step) or refuses it
                      const node = e.target;
                      const ok = editorStore.getState().transformLayer(layer.id, { x: node.x() - screen.x, y: node.y() - screen.y, scaleX: node.scaleX(), scaleY: node.scaleY(), rotation: node.rotation() });
                      if (content) {
                        // a vector layer's size lives in its box (the store baked the scale in): the node goes back to scale 1
                        node.scaleX(1);
                        node.scaleY(1);
                        if (!ok) node.setAttrs({ x: screen.x + layer.transform.x, y: screen.y + layer.transform.y, rotation: layer.transform.rotation, width: content.width, height: content.height });
                      } else if (!ok) node.setAttrs({ x: screen.x + layer.transform.x, y: screen.y + layer.transform.y, scaleX: layer.transform.scaleX, scaleY: layer.transform.scaleY, rotation: layer.transform.rotation });
                    },
                    onMouseEnter: (e: KonvaEventObject<MouseEvent>) => movable && (e.target.getStage()!.container().style.cursor = "move"),
                    onMouseLeave: (e: KonvaEventObject<MouseEvent>) => (e.target.getStage()!.container().style.cursor = ""),
                  };
                  if (content) return <VectorShape key={layer.id} content={content} {...shared} />;
                  if (warp) {
                    // warped: drawn by the shared rasteriser, placed on a whole pixel, scale and rotation already baked in
                    return <WarpedShape key={layer.id} image={finger?.layerId === layer.id ? finger.raw : image!} rev={finger?.layerId === layer.id ? finger.rev : 0} warp={warp} placement={layer.transform} frame={{ x: -Math.round(at.x), y: -Math.round(at.y), width: screen.width, height: screen.height }} dragging={warpPreview?.layerId === layer.id || finger?.layerId === layer.id} {...shared} x={screen.x + Math.round(at.x)} y={screen.y + Math.round(at.y)} />;
                  }
                  return <KImage key={layer.id} image={finger?.layerId === layer.id ? finger.canvas : rawToCanvas(image!)} width={image!.width} height={image!.height} {...shared} />;
                })();
                  if (!fx || !node) return node;
                  const off = placedAt(layer);
                  return (
                    <Fragment key={layer.id}>
                      <KImage image={fx.canvas} x={screen.x + fx.x + (off.x - layer.transform.x)} y={screen.y + fx.y + (off.y - layer.transform.y)} width={fx.width} height={fx.height} opacity={layer.opacity} globalCompositeOperation={(layer.blend ?? "source-over") as GlobalCompositeOperation} visible={layer.visible && compare !== "original"} listening={false} />
                      {node}
                    </Fragment>
                  );
                })}
                {layers.map((baseLayer) => {
                  const layer = previewOf(baseLayer);
                  const image = layer.imageId ? images.get(layer.imageId)?.raw : undefined;
                  const box = layer.content ? { width: layer.content.width, height: layer.content.height } : image;
                  if (!box || !selectedIds.includes(layer.id) || !layer.visible || showHandles || comparing || layer.id === warpTarget?.id) return null; // with handles, their frame is the outline (the warp tool draws its own)
                  const at = placedAt(layer);
                  if (layer.warp && image && tool !== "warp") {
                    // the outline follows the bent shape
                    const t = { ...layer.transform, x: Math.round(at.x), y: Math.round(at.y) };
                    const pts = warpOutline(layer.warp).flatMap((p) => { const f = layerPointToFrame(t, p); return [screen.x + f.x, screen.y + f.y]; });
                    return <Line key={`sel-${layer.id}`} points={pts} closed stroke={ACCENT} strokeWidth={2} strokeScaleEnabled={false} dash={layer.locked ? [6, 4] : undefined} listening={false} />;
                  }
                  return <Rect key={`sel-${layer.id}`} x={screen.x + at.x} y={screen.y + at.y} scaleX={layer.transform.scaleX} scaleY={layer.transform.scaleY} rotation={layer.transform.rotation} width={box.width} height={box.height} stroke={ACCENT} strokeWidth={2} strokeScaleEnabled={false} dash={layer.locked ? [6, 4] : undefined} listening={false} />;
                })}
                {warpTarget && warpTarget.imageId && images.get(warpTarget.imageId) && (
                  <WarpHandles layer={warpTarget} image={images.get(warpTarget.imageId)!.raw} origin={{ x: screen.x, y: screen.y }} zoom={view.zoom} warp={warpPreview?.layerId === warpTarget.id ? warpPreview.warp : warpTarget.warp ?? null} mode={warpUi.mode} cols={warpUi.cols} rows={warpUi.rows} />
                )}
                {groupBox && screen && <Rect x={screen.x + groupBox.x} y={screen.y + groupBox.y} width={groupBox.width} height={groupBox.height} stroke={ACCENT} strokeWidth={1} strokeScaleEnabled={false} dash={[6, 4]} listening={false} />}
                {snapGuides.map((g, i) => (
                  <Line key={`guide-${i}`} points={[screen.x + g.x1, screen.y + g.y1, screen.x + g.x2, screen.y + g.y2]} stroke="#ff3d81" strokeWidth={1} strokeScaleEnabled={false} listening={false} />
                ))}
                {snapGuides.map((g, i) => g.label && <Text key={`guide-label-${i}`} x={screen.x + (g.x1 + g.x2) / 2} y={screen.y + (g.y1 + g.y2) / 2 - 12 / view.zoom} text={g.label} fontSize={11 / view.zoom} fill="#ff3d81" listening={false} />)}
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
                {shapePreview && (
                  <Shape
                    x={screen.x + shapePreview.x}
                    y={screen.y + shapePreview.y}
                    width={shapePreview.content.width}
                    height={shapePreview.content.height}
                    opacity={0.85}
                    listening={false}
                    sceneFunc={(ctx) => drawContent((ctx as unknown as { _context: DrawCtx })._context, shapePreview.content)}
                  />
                )}
                {brushPoints.current && (
                  <Shape
                    listening={false}
                    opacity={tool === "eraser" ? 0.45 : 1}
                    sceneFunc={(ctx) => {
                      const c = (ctx as unknown as { _context: CanvasRenderingContext2D })._context;
                      const pts = brushPoints.current;
                      if (!pts) return;
                      c.save();
                      c.translate(screen.x, screen.y);
                      c.lineCap = "round";
                      c.lineJoin = "round";
                      c.lineWidth = Math.max(1, Math.round(drawStyle.strokeWidth));
                      c.strokeStyle = tool === "eraser" ? "#ffffff" : drawStyle.stroke;
                      c.fillStyle = c.strokeStyle;
                      c.beginPath();
                      if (pts.length === 1) c.arc(pts[0].x, pts[0].y, c.lineWidth / 2, 0, Math.PI * 2), c.fill();
                      else {
                        c.moveTo(pts[0].x, pts[0].y);
                        for (const q of pts.slice(1)) c.lineTo(q.x, q.y);
                        c.stroke();
                      }
                      c.restore();
                    }}
                  />
                )}
                {grid.on && screen && compare !== "original" && (() => {
                  // the grid over the page: lines at multiples of its size (at most a few hundred, so a fine grid is skipped when zoomed far out)
                  const step = grid.size;
                  const nx = Math.floor(screen.width / step), ny = Math.floor(screen.height / step);
                  if (nx + ny > 600) return null;
                  const lines = [];
                  for (let i = 1; i <= nx; i++) lines.push(<Line key={`gx${i}`} points={[screen.x + i * step, screen.y, screen.x + i * step, screen.y + screen.height]} stroke="rgba(79,70,229,0.35)" strokeWidth={1} strokeScaleEnabled={false} listening={false} />);
                  for (let j = 1; j <= ny; j++) lines.push(<Line key={`gy${j}`} points={[screen.x, screen.y + j * step, screen.x + screen.width, screen.y + j * step]} stroke="rgba(79,70,229,0.35)" strokeWidth={1} strokeScaleEnabled={false} listening={false} />);
                  return <>{lines}</>;
                })()}
                {ring && (tool === "finger" || tool === "liquify") && !comparing && (() => {
                  // the brush ring: its radius in the layer's own pixels, shown in frame pixels through the layer's scale
                  const target = layers.find((l) => l.id === selectedId);
                  const k = target ? (Math.abs(target.transform.scaleX) + Math.abs(target.transform.scaleY)) / 2 : 1;
                  const r = ((tool === "liquify" ? liquifySize : fingerSize) / 2) * k;
                  return (
                    <>
                      <Circle x={screen.x + ring.x} y={screen.y + ring.y} radius={r} stroke="#ffffff" strokeWidth={3} strokeScaleEnabled={false} listening={false} />
                      <Circle x={screen.x + ring.x} y={screen.y + ring.y} radius={r} stroke="#111827" strokeWidth={1} strokeScaleEnabled={false} listening={false} />
                    </>
                  );
                })()}
                {ftBox && (
                  <>
                    <Rect x={screen.x + ftBox.x} y={screen.y + ftBox.y} width={ftBox.width} height={ftBox.height} stroke={ACCENT} strokeWidth={1} strokeScaleEnabled={false} dash={[4, 3]} listening={false} />
                    {ftNow && <Rect x={screen.x + ftNow.x} y={screen.y + ftNow.y} width={ftNow.width} height={ftNow.height} stroke="#ff3d81" strokeWidth={1} strokeScaleEnabled={false} dash={[2, 2]} listening={false} />}
                    <Line points={[screen.x + ftBox.x + ftBox.width / 2, screen.y + ftBox.y, screen.x + ftBox.x + ftBox.width / 2, screen.y + ftBox.y - ROTATE_GAP / view.zoom]} stroke={ACCENT} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
                    <Circle name="ft-handle-rotate" x={screen.x + ftBox.x + ftBox.width / 2} y={screen.y + ftBox.y - ROTATE_GAP / view.zoom} radius={6 / view.zoom} fill="#fff" stroke={ACCENT} strokeWidth={1.5} strokeScaleEnabled={false} />
                    {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map((h) => {
                      const hp = handlePoint(ftBox, h);
                      const hs = 9 / view.zoom;
                      return <Rect key={h} name={`ft-handle-${h}`} x={screen.x + hp.x - hs / 2} y={screen.y + hp.y - hs / 2} width={hs} height={hs} fill="#fff" stroke={ACCENT} strokeWidth={1.5} strokeScaleEnabled={false} />;
                    })}
                  </>
                )}
                {pickDrag && (
                  <>
                    <Rect x={screen.x + pickDrag.box.x} y={screen.y + pickDrag.box.y} width={pickDrag.box.width} height={pickDrag.box.height} stroke={ACCENT} strokeWidth={1} strokeScaleEnabled={false} dash={[5, 4]} fill="rgba(79,70,229,0.06)" listening={false} />
                    {pickDrag.hits.map((id) => {
                      const l = layers.find((x) => x.id === id);
                      const b = l && boxOf(l);
                      return b ? <Rect key={`pick-${id}`} x={screen.x + b.x} y={screen.y + b.y} width={b.width} height={b.height} stroke={ACCENT} strokeWidth={2} strokeScaleEnabled={false} dash={[3, 3]} listening={false} /> : null;
                    })}
                  </>
                )}
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
        <div data-testid="compare-badge" className="pointer-events-none absolute bottom-4 left-1/2 max-w-[90%] -translate-x-1/2 rounded-full bg-[#171a1f] px-3 py-1 text-center text-xs font-bold text-white">
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
      {pickDrag && screen && (
        <div data-testid="pick-tag" data-hits={pickDrag.hits.join(",")} data-mode={pickDrag.mode} className="pointer-events-none absolute rounded bg-[#4f46e5] px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ left: imageToClient({ x: pickDrag.box.x, y: pickDrag.box.y }, { x: 0, y: 0 }, view, frameOrigin).x, top: imageToClient({ x: pickDrag.box.x, y: pickDrag.box.y }, { x: 0, y: 0 }, view, frameOrigin).y - 22 }}>
          {pickDrag.hits.length}개 {pickDrag.mode === "contain" ? "(완전히 포함)" : "(닿으면)"}
        </div>
      )}
      {marqueeRect && tagAt && (
        <div data-testid="marquee-tag" className="pointer-events-none absolute rounded bg-[#ee6f43] px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ left: tagAt.x, top: tagAt.y - 22 }}>
          선택 영역 {marqueeRect.width} × {marqueeRect.height} px
        </div>
      )}

      <TextEditor />
      <MemoLayer />
      <CandidateOverlay />
      <CandidateBar />
      {screen && (
      <div className="absolute right-4 top-3 flex gap-1.5 rounded-[10px] border border-[var(--line)] bg-white/90 p-1.5 shadow-sm" onPointerDown={(e) => e.stopPropagation()}>
          <button className="btn mini" aria-label="축소" onClick={() => zoomBy(1 / ZOOM_STEP)}>−</button>
          <button className="btn mini min-w-14" data-testid="zoom-readout" aria-label="100%로 되돌리기" onClick={() => zoomBy(1 / view.zoom)}>{Math.round(view.zoom * 100)}%</button>
          <button className="btn mini" aria-label="확대" onClick={() => zoomBy(ZOOM_STEP)}>＋</button>
          <label className="ml-1 flex cursor-pointer items-center gap-1 border-l border-[var(--line)] pl-2 text-xs" title="끌 때 다른 레이어·프레임의 선과 8px 간격에 붙습니다. Alt를 누르고 있으면 잠시 꺼집니다.">
            <input data-testid="snap-toggle" type="checkbox" checked={snapEnabled} onChange={(e) => editorStore.getState().setSnapEnabled(e.target.checked)} />
            스냅
          </label>
          <label className="flex cursor-pointer items-center gap-1 border-l border-[var(--line)] pl-2 text-xs" title="격자를 화면 위에 보입니다 (PNG에는 들어가지 않습니다)">
            <input data-testid="grid-toggle" type="checkbox" checked={grid.on} onChange={(e) => editorStore.getState().setGrid({ on: e.target.checked })} />
            격자
          </label>
          {grid.on && (
            <>
              <select data-testid="grid-size" aria-label="격자 간격" value={grid.size} onChange={(e) => editorStore.getState().setGrid({ size: Number(e.target.value) })} className="rounded border border-[var(--line)] bg-white px-1 text-xs">
                {[8, 16, 32, 64, 100].map((n) => <option key={n} value={n}>{n}px</option>)}
              </select>
              <label className="flex cursor-pointer items-center gap-1 text-xs" title="끌 때 레이어의 왼쪽 위 모서리가 격자 선에 붙습니다">
                <input data-testid="grid-snap" type="checkbox" checked={grid.snap} onChange={(e) => editorStore.getState().setGrid({ snap: e.target.checked })} />
                격자 스냅
              </label>
            </>
          )}
          <button className="btn mini" onClick={() => hasSize && editorStore.getState().setView(fitView(size, screen))}>화면 맞춤</button>
        </div>
      )}
    </div>
  );
}
