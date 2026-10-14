"use client";

import { Tool } from "@/store/editor-store";
import { formatBinding, ConfigurableAction } from "@/features/shortcuts/shortcuts";
import { useBindings } from "@/features/shortcuts/shortcut-store";
import { toolHint } from "@/features/tool-hints/tool-hints";
import { isGeneratedPage } from "@/lib/project/blank";
import { selectScreen } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";

/** tools that cut from the screenshot: with no screenshot (a blank canvas, a template) there is nothing to cut from */
const NEEDS_SCREENSHOT: Tool[] = ["rect", "auto"];

const TOOLS: { id: Tool; icon: string; label: string; title: string }[] = [
  { id: "select", icon: "↖", label: "선택", title: "레이어를 선택하고 드래그해서 옮깁니다 (V)" },
  { id: "hand", icon: "✋", label: "이동", title: "드래그해서 화면을 옮깁니다 (H)" },
  { id: "rect", icon: "▱", label: "영역 추출", title: "드래그한 사각형을 이미지 레이어로 추출합니다 (R)" },
  { id: "auto", icon: "✦", label: "자동 후보", title: "화면을 분석해 영역 후보(점선)를 보여 줍니다. 클릭하면 가장 작은 후보가, 같은 자리를 다시 클릭하면 한 단계 큰 후보가 선택되고, Enter로 추출합니다 (A)" },
  { id: "fill", icon: "▨", label: "배경 채움", title: "추출하고 남은 배경 패치를 클릭해 색을 바꿉니다" },
  { id: "line", icon: "╱", label: "선", title: "드래그해서 직선을 그립니다 (L)" },
  { id: "box", icon: "□", label: "사각형", title: "드래그해서 사각형을 그립니다 (M)" },
  { id: "ellipse", icon: "○", label: "원", title: "드래그해서 원·타원을 그립니다 (O)" },
  { id: "brush", icon: "🖌", label: "브러시", title: "드래그해서 자유롭게 그립니다. 새 비트맵 레이어에 그려집니다 (B)" },
  { id: "eraser", icon: "⌫", label: "지우개", title: "브러시로 그린 레이어의 그림을 지웁니다. 원본과 다른 레이어는 지울 수 없습니다 (E)" },
  { id: "text", icon: "T", label: "텍스트", title: "클릭하고 글자를 입력해 텍스트 상자를 만듭니다. 두 번 클릭하면 고칩니다 (T)" },
  { id: "memo", icon: "💬", label: "메모", title: "클릭해서 메모 핀을 꽂습니다. 편집용이며 PNG에는 기본으로 들어가지 않습니다 (N)" },
  { id: "warp", icon: "◩", label: "변형", title: "선택한 이미지 레이어의 모서리·격자점을 끌어 기울이기·원근·왜곡·뒤틀기를 합니다. 원본 픽셀은 바뀌지 않습니다. Enter로 확정, Esc로 취소합니다 (W)" },
  { id: "finger", icon: "☝", label: "손가락", title: "이미지 레이어 위에서 끌면 시작한 자리의 색이 끄는 방향으로 번집니다. 크기·강도·부드러움을 정할 수 있고, 원본 스크린샷과 도형·텍스트 레이어는 바뀌지 않습니다 (F)" },
  { id: "eyedropper", icon: "💧", label: "스포이트", title: "화면의 색을 읽어 그리기 색으로 씁니다 (I)" },
];

const ACTION_OF: Partial<Record<Tool, ConfigurableAction>> = { select: "tool-select", hand: "tool-hand", rect: "tool-rect", auto: "tool-auto", line: "tool-line", box: "tool-box", ellipse: "tool-ellipse", brush: "tool-brush", eraser: "tool-eraser", text: "tool-text", memo: "tool-memo", warp: "tool-warp", finger: "tool-finger", eyedropper: "tool-eyedropper" };
/** the tool's tooltip with the key the user has set (the texts above end in the default key, which is replaced) */
const titleWith = (t: { id: Tool; title: string }, bindings: ReturnType<typeof useBindings>) => {
  const a = ACTION_OF[t.id];
  return a ? `${t.title.replace(/\s*\([A-Za-z]\)$/, "")} (${formatBinding(bindings[a])})` : t.title;
};

export default function ToolRail({ enabled }: { enabled: boolean }) {
  const active = useEditorStore((s) => s.activeTool);
  const bindings = useBindings();
  const freeTransform = useEditorStore((s) => s.freeTransform);
  const screen = useEditorStore(selectScreen);
  const selectedIds = useEditorStore((s) => s.selectedLayerIds);
  const comparing = useEditorStore((s) => s.compareMode !== "off");
  const hintState = { screen, selected: screen ? screen.layers.filter((l) => selectedIds.includes(l.id)) : [], comparing };
  const plain = useEditorStore((s) => isGeneratedPage(selectScreen(s)?.source.fileName ?? ""));
  return (
    <nav aria-label="도구" className="overflow-auto border-r border-[var(--line)] bg-[var(--panel)] px-2 py-2.5">
      {TOOLS.map((t) => (
        <button key={t.id} className="tool" aria-pressed={active === t.id} disabled={!enabled || (plain && NEEDS_SCREENSHOT.includes(t.id))} data-unusable={enabled && !toolHint(t.id, hintState).usable ? "true" : undefined} title={enabled && !toolHint(t.id, hintState).usable ? `${t.label} (지금은 쓸 수 없음): ${toolHint(t.id, hintState).text}` : titleWith(t, bindings)} onClick={() => editorStore.getState().setTool(t.id)}>
          <b aria-hidden>{t.icon}</b>
          <span>{t.label}</span>
        </button>
      ))}
      <button className="tool" data-testid="rail-free-transform" aria-pressed={freeTransform} disabled={!enabled} title={`자유 변형: 선택한 레이어 전체를 감싸는 상자로 크기·회전을 한꺼번에 바꿉니다 (${formatBinding(bindings["free-transform"])})`} onClick={() => editorStore.getState().setFreeTransform(!freeTransform)}>
        <b aria-hidden>⤢</b>
        <span>자유 변형</span>
      </button>
    </nav>
  );
}
