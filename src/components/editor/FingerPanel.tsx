"use client";

import { editorStore, useEditorStore } from "@/store/use-editor-store";

/** The finger tool's brush: size (in the layer's own pixels), strength and edge softness. Shown while the finger tool is on. */
export default function FingerPanel() {
  const tool = useEditorStore((s) => s.activeTool);
  const style = useEditorStore((s) => s.fingerStyle);
  if (tool !== "finger") return null;
  const set = editorStore.getState().setFingerStyle;
  const field = (key: "size" | "strength" | "softness", label: string, min: number, max: number, unit: string, hint: string) => (
    <label className="grid grid-cols-[64px_1fr_46px] items-center gap-2 text-xs" title={hint}>
      <span className="font-bold">{label}</span>
      <input data-testid={`finger-${key}`} type="range" min={min} max={max} value={style[key]} onChange={(e) => set({ [key]: Number(e.target.value) })} />
      <span className="text-right tabular-nums text-[var(--muted)]">
        {style[key]}
        {unit}
      </span>
    </label>
  );
  return (
    <section aria-label="손가락 설정" data-testid="finger-panel" className="border-b border-[var(--line)] px-3.5 py-3">
      <h3 className="mb-2.5 text-[13px] font-bold">손가락 (번짐)</h3>
      <div className="grid gap-2">
        {field("size", "크기", 2, 300, "px", "브러시 지름입니다. 레이어 자신의 픽셀 기준입니다.")}
        {field("strength", "강도", 1, 100, "%", "한 번 칠할 때 끌려가는 색의 비율입니다. 낮을수록 색이 빨리 옅어집니다.")}
        {field("softness", "부드러움", 0, 100, "%", "가장자리의 부드러움입니다. 0이면 딱딱한 원, 100이면 중심에서 서서히 약해집니다.")}
      </div>
      <p className="mb-0 mt-2 text-[11px] text-[var(--muted)]">선택한 이미지 레이어 위에서 끌면 시작한 자리의 색이 끄는 방향으로 번집니다. 레이어 밖으로는 번지지 않습니다. 원본은 기본으로 잠겨 있어 바뀌지 않습니다('배경(원본)'의 잠금을 풀고 선택하면 원본에도 쓸 수 있습니다).</p>
    </section>
  );
}