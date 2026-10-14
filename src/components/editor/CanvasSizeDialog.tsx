"use client";

import { useEffect, useState } from "react";
import { checkCanvasSize } from "@/lib/project/blank";
import { normalizeHex } from "@/lib/image/color";
import { editorStore } from "@/store/use-editor-store";

/** The canvas size: a new width and height, where the old page sits in the new one (nine anchors), whether layers follow the picture, and the
 *  margin colour. Cropping drops the part outside the new page; the limit is 8192 on a side, as for an upload. */
export default function CanvasSizeDialog({ width, height, onClose }: { width: number; height: number; onClose: () => void }) {
  const [w, setW] = useState(String(width));
  const [h, setH] = useState(String(height));
  const [ax, setAx] = useState<0 | 1 | 2>(1);
  const [ay, setAy] = useState<0 | 1 | 2>(1);
  const [layers, setLayers] = useState<"follow" | "stay">("follow");
  const [margin, setMargin] = useState(false);
  const [colour, setColour] = useState("#ffffff");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const size = checkCanvasSize(w, h);
  const note = !size.ok ? size.error : size.width < width || size.height < height ? "작아지는 쪽은 잘립니다 (실행 취소로 되돌릴 수 있습니다)." : null;
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/30">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="csize-title"
        data-testid="canvas-size-dialog"
        className="w-[420px] max-w-[94vw] rounded-[14px] border border-[var(--line)] bg-white p-[18px] shadow-[var(--shadow)]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!size.ok) return;
          const hex = margin ? normalizeHex(colour) : null;
          const why = editorStore.getState().resizeCanvas({ width: size.width, height: size.height, ax, ay, layers, fill: hex });
          if (why) setError(why);
          else onClose();
        }}
      >
        <h2 id="csize-title" className="m-0 mb-1 text-lg font-bold">캔버스 크기</h2>
        <p className="mb-3 text-xs text-[var(--muted)]">지금 {width} × {height}px. 늘리면 여백이 생기고 줄이면 잘립니다. 한 변은 8192px까지.</p>
        <div className="mb-3 flex items-center gap-2 text-sm">
          <label className="flex items-center gap-1">가로 <input data-testid="csize-width" inputMode="numeric" className="w-24 rounded border border-[var(--line)] px-2 py-1" value={w} onChange={(e) => (setW(e.target.value), setError(null))} /></label>
          <span>×</span>
          <label className="flex items-center gap-1">세로 <input data-testid="csize-height" inputMode="numeric" className="w-24 rounded border border-[var(--line)] px-2 py-1" value={h} onChange={(e) => (setH(e.target.value), setError(null))} /></label>
        </div>
        <div className="mb-3 flex gap-4">
          <div>
            <div className="mb-1 text-xs font-bold">기준점 (기존 화면의 자리)</div>
            <div role="radiogroup" aria-label="기준점" className="grid w-[84px] grid-cols-3 gap-1">
              {([0, 1, 2] as const).flatMap((y) => ([0, 1, 2] as const).map((x) => (
                <button key={`${x}${y}`} type="button" role="radio" aria-checked={ax === x && ay === y} data-testid={`csize-anchor-${x}${y}`} aria-label={`기준점 ${["위", "가운데", "아래"][y]} ${["왼쪽", "가운데", "오른쪽"][x]}`} className={`h-6 rounded border ${ax === x && ay === y ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--line)] bg-[var(--panel)]"}`} onClick={() => (setAx(x), setAy(y))} />
              )))}
            </div>
          </div>
          <div className="grid flex-1 content-start gap-1.5 text-xs">
            <div className="font-bold">레이어</div>
            <label className="flex items-center gap-1.5"><input type="radio" name="csize-layers" data-testid="csize-follow" checked={layers === "follow"} onChange={() => setLayers("follow")} />그림을 따라 움직임</label>
            <label className="flex items-center gap-1.5"><input type="radio" name="csize-layers" data-testid="csize-stay" checked={layers === "stay"} onChange={() => setLayers("stay")} />페이지 위치 그대로</label>
            <label className="mt-1 flex items-center gap-1.5"><input type="checkbox" data-testid="csize-margin" checked={margin} onChange={(e) => setMargin(e.target.checked)} />여백 색
              <input type="color" data-testid="csize-colour" value={colour} disabled={!margin} onChange={(e) => setColour(e.target.value)} className="h-6 w-8 cursor-pointer p-0.5 disabled:opacity-40" />
            </label>
            <span className="text-[11px] text-[var(--muted)]">{margin ? "여백이 이 색으로 채워집니다." : "여백은 투명입니다 (PNG에서도 투명)."}</span>
          </div>
        </div>
        {(error || note) && <p role={error || !size.ok ? "alert" : "status"} data-testid="csize-note" className={`mb-3 text-xs ${error || !size.ok ? "text-[#b3361b]" : "text-[#8a5a12]"}`}>{error ?? note}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" data-testid="csize-cancel" className="btn" onClick={onClose}>취소</button>
          <button type="submit" data-testid="csize-apply" className="btn primary" disabled={!size.ok}>적용</button>
        </div>
      </form>
    </div>
  );
}