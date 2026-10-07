import { isOnlyMoved } from "@/lib/geometry/layer-transform";
import { MAX_BRUSH_SIZE, MAX_STROKE_POINTS, MIN_BRUSH_SIZE, PaintStroke, Pt, paintStroke } from "@/lib/image/brush-raster";
import { BitmapLayer } from "@/lib/project/schema";
import { EditorStoreApi, selectScreen } from "@/store/editor-store";

export type StrokeOutcome = { status: "painted"; layerId: string } | { status: "nothing" } | { status: "refused"; reason: string };

/** Whether a layer can take the next brush stroke or an eraser stroke, and if not, why (in words for the user). */
export function strokeTargetProblem(layer: BitmapLayer | undefined): string | null {
  if (!layer || !layer.drawn || !layer.imageId) return "브러시로 직접 그린 레이어를 먼저 선택하세요.";
  if (layer.locked) return "잠긴 레이어에는 그릴 수 없습니다. 잠금을 풀어 주세요.";
  if (!layer.visible) return "숨긴 레이어에는 그릴 수 없습니다. 먼저 보이게 해 주세요.";
  if (!isOnlyMoved(layer.transform)) return "크기나 회전을 바꾼 레이어에는 그릴 수 없습니다. '크기·회전 초기화'를 먼저 눌러 주세요.";
  return null;
}

/** One stroke, finished: paints it, and records ONE undo step.
 *  - The brush continues the selected brush layer when it can take it, and otherwise starts a new brush layer.
 *  - The eraser works only on the selected brush layer; anywhere else it refuses and says why. The capture and extracted or
 *    vector layers are never changed. */
export function applyStroke(args: { store: EditorStoreApi; tool: "brush" | "eraser"; points: readonly Pt[]; paint?: PaintStroke }): StrokeOutcome {
  const { store, tool, paint = paintStroke } = args;
  const state = store.getState();
  const screen = selectScreen(state);
  if (!screen || args.points.length === 0) return { status: "nothing" };
  if (state.compareMode !== "off") return { status: "nothing" }; // nothing can be edited while comparing

  const erase = tool === "eraser";
  const selected = screen.layers.find((l) => l.id === state.selectedLayerIds[0]);
  const problem = strokeTargetProblem(selected);
  if (erase && problem) {
    state.setNotice(`지우개를 쓸 수 없습니다. ${problem}`);
    return { status: "refused", reason: problem };
  }
  const continuing = !problem && selected ? selected : null;
  const base = continuing ? { raw: state.images.get(continuing.imageId!)!.raw, x: continuing.transform.x, y: continuing.transform.y } : null;

  const painted = paint(
    base,
    { points: args.points.slice(0, MAX_STROKE_POINTS), size: Math.min(Math.max(Math.round(state.drawStyle.strokeWidth), MIN_BRUSH_SIZE), MAX_BRUSH_SIZE), color: state.drawStyle.stroke, erase },
    { width: screen.width, height: screen.height },
  );
  if (!painted) return { status: "nothing" };
  const layerId = state.commitBitmapEdit({ layerId: continuing?.id ?? null, raw: painted.raw, x: painted.x, y: painted.y, label: erase ? "지우개 획" : "브러시 획" });
  return layerId ? { status: "painted", layerId } : { status: "refused", reason: "그릴 수 없는 상태입니다." };
}
