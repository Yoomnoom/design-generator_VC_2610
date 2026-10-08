"use client";

import { useEffect, useRef } from "react";
import { sortByZ } from "@/features/layer-transform/order";
import { RawImage } from "@/lib/image/raw-image";
import { selectScreen } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";
import { LayerContent } from "@/lib/project/schema";
import { DrawCtx, contentBounds, drawContent } from "@/lib/image/vector";
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

/** the same drawing the canvas and the export use, scaled to fit the thumbnail */
function ContentThumb({ content }: { content: LayerContent }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr;
    c.height = H * dpr;
    const g = c.getContext("2d")!;
    const b = contentBounds(content);
    const scale = Math.min((W - 6) / b.width, (H - 6) / b.height) * dpr;
    g.translate((c.width - b.width * scale) / 2 - b.x * scale, (c.height - b.height * scale) / 2 - b.y * scale);
    g.scale(scale, scale);
    drawContent(g as unknown as DrawCtx, content);
  }, [content]);
  return <canvas ref={ref} aria-hidden data-testid="vector-thumb" className="shrink-0 rounded border border-[var(--line)] bg-white" style={{ width: W, height: H }} />;
}

const icon = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const EyeIcon = () => (
  <svg {...icon}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const EyeOffIcon = () => (
  <svg {...icon}>
    <path d="M10.7 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    <path d="m2 2 20 20" />
  </svg>
);
const LockIcon = () => (
  <svg {...icon}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);
const UnlockIcon = () => (
  <svg {...icon}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 7.5-2" />
  </svg>
);

const iconButton = "grid h-[30px] w-[30px] shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-[#6b7280] hover:bg-[#ebebe6] focus-visible:outline-2 focus-visible:outline-[var(--accent)]";

export default function LayerPanel() {
  const screen = useEditorStore(selectScreen);
  const images = useEditorStore((s) => s.images);
  const selectedIds = useEditorStore((s) => s.selectedLayerIds);
  const selectedId = selectedIds[0];
  const comparing = useEditorStore((s) => s.compareMode !== "off");
  if (!screen) return null;

  const front = sortByZ(screen.layers).reverse(); // the layer on top of the canvas is first in the list
  const index = front.findIndex((l) => l.id === selectedId);
  const selected = front[index];
  const has = index >= 0;
  const multi = selectedIds.length > 1;
  const unlockedSelected = front.filter((l) => selectedIds.includes(l.id) && !l.locked).length;
  const act = editorStore.getState();

  return (
    <section aria-label="레이어" className="border-b border-[var(--line)] px-3.5 py-3">
      <h3 className="mb-2.5 text-[13px] font-bold">
        레이어 <span className="font-normal text-[#999]" data-testid="layer-count">{front.length}</span>
      </h3>
      <div className="mb-2.5 grid grid-cols-4 gap-1.5">
        <button className="btn mini px-0" disabled={!has || multi || index === 0 || comparing} onClick={() => act.reorderLayer(selectedId, 1)}>앞으로</button>
        <button className="btn mini px-0" disabled={!has || multi || index === front.length - 1 || comparing} onClick={() => act.reorderLayer(selectedId, -1)}>뒤로</button>
        <button className="btn mini px-0" disabled={!has || multi || comparing} title={multi ? "여러 레이어는 복제할 수 없습니다. 하나만 선택하세요" : "복제 (Ctrl+D)"} onClick={() => act.duplicateLayer(selectedId)}>복제</button>
        <button className="btn mini px-0" disabled={!has || (multi ? unlockedSelected === 0 : selected?.locked) || comparing} title={multi ? "선택한 레이어를 모두 삭제합니다 (잠긴 것은 제외, Delete)" : selected?.locked ? "잠긴 레이어는 삭제할 수 없습니다" : "삭제 (Delete)"} onClick={() => (multi ? act.deleteSelectedLayers() : act.deleteLayer(selectedId))}>삭제</button>
      </div>
      {multi && (
        <p data-testid="multi-note" className="mb-2 text-xs text-[var(--accent)]">
          {selectedIds.length}개 선택됨 · 끌기와 방향키로 함께 이동, Delete로 삭제
        </p>
      )}
      {front.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">영역 추출 도구로 사각형을 드래그하면 레이어가 생깁니다.</p>
      ) : (
        <ul data-testid="layer-list" className="m-0 list-none p-0">
          {front.map((layer) => {
            const raw = layer.imageId ? images.get(layer.imageId)?.raw : undefined;
            const active = selectedIds.includes(layer.id);
            return (
              <li key={layer.id} data-hidden={layer.visible ? undefined : "true"} data-locked={layer.locked ? "true" : undefined} className={`mb-0.5 flex items-center rounded-[7px] ${active ? "bg-[var(--soft)] text-[var(--accent)]" : "hover:bg-[#f5f5f2]"}`}>
                <button
                  type="button"
                  data-testid="layer-item"
                  data-layer-id={layer.id}
                  aria-current={active ? "true" : undefined}
                  onClick={(e) => (e.shiftKey || e.ctrlKey || e.metaKey ? act.toggleLayerSelection(layer.id) : act.selectLayer(layer.id))}
                  className={`flex h-[38px] min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent px-1.5 text-left text-xs text-inherit ${layer.visible ? "" : "opacity-45"}`}
                >
                  {layer.content ? <ContentThumb content={layer.content} /> : raw && <Thumb raw={raw} />}
                  <span className={`flex-1 truncate ${layer.visible ? "" : "line-through"}`}>{layer.name}</span>
                </button>
                <button type="button" disabled={comparing} className={iconButton} aria-pressed={!layer.visible} aria-label={layer.visible ? `${layer.name} 숨기기` : `${layer.name} 보이기`} title={layer.visible ? "숨기기" : "보이기"} onClick={() => act.setLayerVisible(layer.id, !layer.visible)}>
                  {layer.visible ? <EyeIcon /> : <EyeOffIcon />}
                </button>
                <button type="button" disabled={comparing} className={iconButton} aria-pressed={layer.locked} aria-label={layer.locked ? `${layer.name} 잠금 해제` : `${layer.name} 잠그기`} title={layer.locked ? "잠금 해제" : "잠그기 (이동·삭제 불가)"} onClick={() => act.setLayerLocked(layer.id, !layer.locked)}>
                  {layer.locked ? <LockIcon /> : <UnlockIcon />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
