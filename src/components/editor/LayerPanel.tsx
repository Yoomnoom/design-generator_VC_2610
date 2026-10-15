"use client";

import { useEffect, useRef, useState } from "react";
import { formatBinding } from "@/features/shortcuts/shortcuts";
import { useBindings } from "@/features/shortcuts/shortcut-store";
import { isGeneratedPage } from "@/lib/project/blank";
import { panelRows, wholeGroupOf } from "@/features/groups/groups";
import { sortByZ } from "@/features/layer-transform/order";
import { RawImage } from "@/lib/image/raw-image";
import { SOURCE_NAME, isSourceEdited, isSourceLocked } from "@/features/source-edit/source-edit";
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
  const collapsed = useEditorStore((s) => s.collapsedGroups);
  const sourceSelected = useEditorStore((s) => s.sourceSelected);
  const bindings = useBindings();
  const key = (a: keyof typeof bindings) => formatBinding(bindings[a]);
  const dragIds = useRef<string[]>([]); // the layers being dragged in the list (HTML drag and drop)
  const [renamingGroup, setRenamingGroup] = useState<{ id: string; text: string } | null>(null);
  if (!screen) return null;

  const front = sortByZ(screen.layers).reverse(); // the layer on top of the canvas is first in the list
  const rows = panelRows(screen.layers, screen.groups ?? [], new Set(collapsed));
  const whole = wholeGroupOf(screen.layers, selectedIds); // the selection is exactly one group
  const startDrag = (ids: string[]) => (e: React.DragEvent) => {
    dragIds.current = ids;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", ids.join(","));
  };
  const allowDrop = (e: React.DragEvent) => {
    if (dragIds.current.length > 0 && !comparing) e.preventDefault();
  };
  /** dropped on a group header or between its layers: the layers join that group; dropped on a layer that is in no group: they leave their groups */
  const dropOn = (groupId: string | undefined) => (e: React.DragEvent) => {
    e.preventDefault();
    const ids = dragIds.current;
    dragIds.current = [];
    if (ids.length === 0) return;
    if (groupId) act.addToGroup(groupId, ids);
    else if (ids.some((id) => screen.layers.find((l) => l.id === id)?.groupId)) act.removeFromGroup(ids);
  };
  const anyGrouped = front.some((l) => l.groupId && selectedIds.includes(l.id));
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
        <button className="btn mini px-0" disabled={!has || (multi && !whole) || comparing} title={multi && !whole ? "여러 레이어는 복제할 수 없습니다. 하나만 선택하거나 그룹 전체를 선택하세요" : `복제 (${key("duplicate")})`} onClick={() => (whole ? act.duplicateGroup(whole) : act.duplicateLayer(selectedId))}>복제</button>
        <button className="btn mini px-0" disabled={!has || (multi ? unlockedSelected === 0 : selected?.locked) || comparing} title={multi ? `선택한 레이어를 모두 삭제합니다 (잠긴 것은 제외, ${key("delete")})` : selected?.locked ? "잠긴 레이어는 삭제할 수 없습니다" : `삭제 (${key("delete")})`} onClick={() => (multi ? act.deleteSelectedLayers() : act.deleteLayer(selectedId))}>삭제</button>
      </div>
      <div className="mb-2.5 grid grid-cols-3 gap-1.5">
        <button data-testid="group-make" className="btn mini px-0" disabled={comparing || selectedIds.length < 2} title={`선택한 레이어를 하나의 그룹으로 묶습니다 (${key("group")})`} onClick={() => act.groupSelected()}>그룹</button>
        <button data-testid="group-remove" className="btn mini px-0" disabled={comparing || !anyGrouped} title="선택한 레이어를 그룹에서 뺍니다(그룹은 남습니다; 남은 레이어가 하나뿐이면 그룹이 풀립니다)" onClick={() => act.removeFromGroup(selectedIds)}>빼기</button>
        <button data-testid="group-release" className="btn mini px-0" disabled={comparing || !anyGrouped} title={`선택한 레이어가 속한 그룹을 풉니다. 레이어는 그대로 남습니다 (${key("ungroup")})`} onClick={() => act.ungroupSelected()}>해제</button>
      </div>
      {multi && (
        <p data-testid="multi-note" className="mb-2 text-xs text-[var(--accent)]">
          {selectedIds.length}개 선택됨 · 끌기와 방향키로 함께 이동, Delete로 삭제
        </p>
      )}
      {front.length === 0 ? (
        <p data-testid="layer-empty" className="text-xs text-[var(--muted)]">{isGeneratedPage(screen.source.fileName) ? "레이어가 없습니다. 왼쪽 소스·템플릿에서 부품을 넣거나, 사각형·원·선·텍스트·브러시로 직접 그려 보세요." : "영역 추출 도구로 사각형을 드래그하면 레이어가 생깁니다."}</p>
      ) : (
        <ul data-testid="layer-list" className="m-0 list-none p-0">
          {rows.map((row) => {
            if (row.kind === "group") {
              const g = row.group;
              const ids = row.members.map((m) => m.id);
              const active = ids.every((id) => selectedIds.includes(id));
              const folded = collapsed.includes(g.id);
              return (
                <li key={`group-${g.id}`} draggable={!comparing} onDragStart={startDrag(ids)} onDragOver={allowDrop} onDrop={dropOn(g.id)} data-testid="group-row" data-group-id={g.id} data-folded={folded ? "true" : undefined} className={`mb-0.5 mt-1 flex items-center rounded-[7px] ${active ? "bg-[var(--soft)] text-[var(--accent)]" : "bg-[#f5f5f2]"}`}>
                  <button type="button" data-testid="group-toggle" aria-expanded={!folded} aria-label={`${g.name} ${folded ? "펼치기" : "접기"}`} title={folded ? "펼치기" : "접기"} className={iconButton} onClick={() => act.toggleGroupCollapsed(g.id)}>
                    {folded ? "▸" : "▾"}
                  </button>
                  {renamingGroup?.id === g.id ? (
                    <form
                      className="flex min-w-0 flex-1 gap-1 pr-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        act.renameGroup(g.id, renamingGroup.text);
                        setRenamingGroup(null);
                      }}
                    >
                      <input data-testid="group-rename-input" autoFocus maxLength={60} value={renamingGroup.text} onChange={(e) => setRenamingGroup({ id: g.id, text: e.target.value })} onBlur={() => setRenamingGroup(null)} onKeyDown={(e) => e.key === "Escape" && setRenamingGroup(null)} className="min-w-0 flex-1 rounded border border-[var(--line)] bg-white px-1 text-xs text-black" />
                    </form>
                  ) : (
                    <button
                      type="button"
                      data-testid="group-item"
                      aria-current={active ? "true" : undefined}
                      title="클릭: 그룹 선택 · Ctrl+클릭: 선택에 더하기/빼기 · Shift+클릭: 범위 선택 · 더블클릭: 이름 변경"
                      onClick={(e) => (e.shiftKey ? act.selectRange(ids[0]) : e.ctrlKey || e.metaKey ? act.toggleLayerSelection(ids[0], true) : act.selectGroup(g.id))}
                      onDoubleClick={() => !comparing && setRenamingGroup({ id: g.id, text: g.name })}
                      className="flex h-[32px] min-w-0 flex-1 cursor-pointer items-center gap-1 border-0 bg-transparent px-1 text-left text-xs font-bold text-inherit"
                    >
                      <span className="truncate">{g.name}</span>
                      <span className="font-normal text-[#999]">{ids.length}</span>
                    </button>
                  )}
                  <button type="button" data-testid="group-rename" disabled={comparing} className="btn mini mr-1 px-1" onClick={() => setRenamingGroup({ id: g.id, text: g.name })}>이름</button>
                </li>
              );
            }
            const layer = row.layer;
            const raw = layer.imageId ? images.get(layer.imageId)?.raw : undefined;
            const active = selectedIds.includes(layer.id);
            return (
              <li key={layer.id} draggable={!comparing} onDragStart={startDrag(active ? selectedIds : [layer.id])} onDragOver={allowDrop} onDrop={dropOn(layer.groupId)} data-hidden={layer.visible ? undefined : "true"} data-locked={layer.locked ? "true" : undefined} data-in-group={row.inGroup ? "true" : undefined} className={`mb-0.5 flex items-center rounded-[7px] ${row.inGroup ? "ml-5" : ""} ${active ? "bg-[var(--soft)] text-[var(--accent)]" : "hover:bg-[#f5f5f2]"}`}>
                <button
                  type="button"
                  data-testid="layer-item"
                  data-layer-id={layer.id}
                  aria-current={active ? "true" : undefined}
                  onClick={(e) => (e.shiftKey ? act.selectRange(layer.id) : e.ctrlKey || e.metaKey ? act.toggleLayerSelection(layer.id) : act.selectLayer(layer.id))}
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
      {(() => {
        // the original picture, always the last row (it is under every layer): select it to edit it, and its lock (locked by default)
        const locked = isSourceLocked(screen.source);
        const sourceRaw = images.get(screen.source.imageId)?.raw;
        return (
          <div data-testid="source-row" data-locked={locked ? "true" : "false"} data-selected={sourceSelected ? "true" : undefined} className={`mt-1.5 flex items-center rounded-[7px] border-t border-[var(--line)] pt-1 ${sourceSelected ? "bg-[var(--soft)] text-[var(--accent)]" : "hover:bg-[#f5f5f2]"}`}>
            <button type="button" data-testid="source-item" aria-current={sourceSelected ? "true" : undefined} onClick={() => act.selectSource()} className="flex h-[38px] min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent px-1.5 text-left text-xs text-inherit" title="원본 그림을 고르면 브러시·손가락·유동화·이미지 조정을 쓸 수 있습니다(잠금을 풀어야 합니다)">
              {sourceRaw && <Thumb raw={sourceRaw} />}
              <span className="flex-1 truncate">{SOURCE_NAME}{isSourceEdited(screen.source) ? " · 수정됨" : ""}</span>
            </button>
            <button type="button" data-testid="source-lock" disabled={comparing} className={iconButton} aria-pressed={locked} aria-label={locked ? `${SOURCE_NAME} 잠금 해제` : `${SOURCE_NAME} 잠그기`} title={locked ? "잠긴 원본입니다. 눌러서 잠금 해제" : "잠금이 풀려 있습니다. 눌러서 다시 잠그기"} onClick={() => act.setSourceLocked(!locked)}>
              {locked ? <LockIcon /> : <UnlockIcon />}
            </button>
          </div>
        );
      })()}
    </section>
  );
}
