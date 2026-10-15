"use client";

import { LIQUIFY_MODE_LABEL } from "@/features/liquify/liquify";
import { LIQUIFY_MODES } from "@/lib/image/liquify";
import { editorStore, useEditorStore } from "@/store/use-editor-store";

const MODE_HINT = { push: "끄는 방향으로 모양이 밀립니다.", bloat: "누르거나 끌면 중심에서 바깥으로 부풀어 오릅니다.", pucker: "누르거나 끌면 중심으로 오므라듭니다.", restore: "문지른 곳을 유동화를 시작했을 때의 모양으로 되돌립니다." } as const;

/** The liquify brush: mode, size (in the layer's own pixels), strength and edge softness. Shown while the liquify tool is on. */
export default function LiquifyPanel() {
  const tool = useEditorStore((s) => s.activeTool);
  const style = useEditorStore((s) => s.liquifyStyle);
  if (tool !== "liquify") return null;
  const set = editorStore.getState().setLiquifyStyle;
  const field = (key: "size" | "strength" | "softness", label: string, min: number, max: number, unit: string, hint: string) => (
    <label className="grid grid-cols-[64px_1fr_46px] items-center gap-2 text-xs" title={hint}>
      <span className="font-bold">{label}</span>
      <input data-testid={`liquify-${key}`} type="range" min={min} max={max} value={style[key]} onChange={(e) => set({ [key]: Number(e.target.value) })} />
      <span className="text-right tabular-nums text-[var(--muted)]">
        {style[key]}
        {unit}
      </span>
    </label>
  );
  return (
    <section aria-label="유동화 설정" data-testid="liquify-panel" className="border-b border-[var(--line)] px-3.5 py-3">
      <h3 className="mb-2 text-[13px] font-bold">유동화 (모양 밀기)</h3>
      <div role="radiogroup" aria-label="유동화 방식" className="mb-2 grid grid-cols-2 gap-1">
        {LIQUIFY_MODES.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={style.mode === m} data-testid={`liquify-mode-${m}`} title={MODE_HINT[m]} className={`btn mini px-0 ${style.mode === m ? "primary" : ""}`} onClick={() => set({ mode: m })}>
            {LIQUIFY_MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <div className="grid gap-2">
        {field("size", "크기", 4, 600, "px", "브러시 지름입니다. 레이어 자신의 픽셀 기준이고, 화면의 원이 영향 범위입니다.")}
        {field("strength", "강도", 1, 100, "%", "한 번에 얼마나 움직일지입니다. 높을수록 포인터를 더 따라 움직입니다.")}
        {field("softness", "부드러움", 0, 100, "%", "가장자리의 부드러움입니다. 0이면 가장자리까지 같은 힘, 100이면 중심에서 서서히 약해집니다.")}
      </div>
      <p className="mb-0 mt-2 text-[11px] text-[var(--muted)]">{MODE_HINT[style.mode]} 이미지 레이어 하나에 쓰고, 원본은 기본으로 잠겨 있어 바뀌지 않습니다('배경(원본)'의 잠금을 풀고 선택하면 원본에도 쓸 수 있습니다). 레이어 밖으로 밀려난 부분은 사라집니다. 손가락은 색을 번지게 하고 유동화는 모양을 밀어 바꿉니다.</p>
    </section>
  );
}