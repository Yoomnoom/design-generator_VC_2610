"use client";

import { useEffect, useRef } from "react";
import { sortByZ } from "@/features/layer-transform/order";
import { RawImage } from "@/lib/image/raw-image";
import { selectScreen } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";
import { rawToCanvas } from "./raw-canvas";

const W = 40;
const H = 28;

/** a small preview of the layer's bitmap; the checkerboard is only a display aid for transparency */
function Thumb({ raw }: { raw: RawImage }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr;
    c.height = H * dpr;
    const g = c.getContext("2d")!;
    const scale = Math.min(c.width / raw.width, c.height / raw.height);
    const w = raw.width * scale;
    const h = raw.height * scale;
    g.imageSmoothingEnabled = true;
    g.drawImage(rawToCanvas(raw), (c.width - w) / 2, (c.height - h) / 2, w, h);
  }, [raw]);
  return (
    <canvas
      ref={ref}
      aria-hidden
      className="shrink-0 rounded border border-[var(--line)]"
      style={{ width: W, height: H, backgroundImage: "conic-gradient(#ddd 25%, #fff 0 50%, #ddd 0 75%, #fff 0)", backgroundSize: "8px 8px" }}
    />
  );
}

export default function LayerPanel() {
  const screen = useEditorStore(selectScreen);
  const images = useEditorStore((s) => s.images);
  const selectedId = useEditorStore((s) => s.selectedLayerIds[0]);
  if (!screen) return null;

  const front = sortByZ(screen.layers).reverse(); // the layer on top of the canvas is first in the list
  const index = front.findIndex((l) => l.id === selectedId);
  const has = index >= 0;
  const act = editorStore.getState();

  return (
    <section aria-label="레이어" className="border-b border-[var(--line)] px-3.5 py-3">
      <h3 className="mb-2.5 text-[13px] font-bold">
        레이어 <span className="font-normal text-[#999]" data-testid="layer-count">{front.length}</span>
      </h3>
      <div className="mb-2.5 grid grid-cols-4 gap-1.5">
        <button className="btn mini px-0" disabled={!has || index === 0} onClick={() => act.reorderLayer(selectedId, 1)}>앞으로</button>
        <button className="btn mini px-0" disabled={!has || index === front.length - 1} onClick={() => act.reorderLayer(selectedId, -1)}>뒤로</button>
        <button className="btn mini px-0" disabled={!has} onClick={() => act.duplicateLayer(selectedId)}>복제</button>
        <button className="btn mini px-0" disabled={!has} onClick={() => act.deleteLayer(selectedId)}>삭제</button>
      </div>
      {front.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">영역 추출 도구로 사각형을 드래그하면 레이어가 생깁니다.</p>
      ) : (
        <ul data-testid="layer-list" className="m-0 list-none p-0">
          {front.map((layer) => {
            const raw = layer.imageId ? images.get(layer.imageId)?.raw : undefined;
            const active = layer.id === selectedId;
            return (
              <li key={layer.id}>
                <button
                  type="button"
                  data-testid="layer-item"
                  data-layer-id={layer.id}
                  aria-current={active ? "true" : undefined}
                  onClick={() => act.selectLayer(layer.id)}
                  className={`mb-0.5 flex h-[38px] w-full cursor-pointer items-center gap-2 rounded-[7px] border-0 px-1.5 text-left text-xs ${active ? "bg-[var(--soft)] text-[var(--accent)]" : "bg-transparent hover:bg-[#f5f5f2]"}`}
                >
                  {raw && <Thumb raw={raw} />}
                  <span className="flex-1 truncate">{layer.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
