"use client";

import { Tool } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";

const TOOLS: { id: Tool; icon: string; label: string; title: string }[] = [
  { id: "select", icon: "↖", label: "선택", title: "레이어를 선택하고 드래그해서 옮깁니다 (V)" },
  { id: "hand", icon: "✋", label: "이동", title: "드래그해서 화면을 옮깁니다 (H)" },
  { id: "rect", icon: "▱", label: "영역 추출", title: "드래그한 사각형을 이미지 레이어로 추출합니다 (R)" },
  { id: "fill", icon: "▨", label: "배경 채움", title: "추출하고 남은 배경 패치를 클릭해 색을 바꿉니다" },
  { id: "line", icon: "╱", label: "선", title: "드래그해서 직선을 그립니다 (L)" },
  { id: "box", icon: "□", label: "사각형", title: "드래그해서 사각형을 그립니다 (M)" },
  { id: "ellipse", icon: "○", label: "원", title: "드래그해서 원·타원을 그립니다 (O)" },
  { id: "brush", icon: "🖌", label: "브러시", title: "드래그해서 자유롭게 그립니다. 새 비트맵 레이어에 그려집니다 (B)" },
  { id: "eraser", icon: "⌫", label: "지우개", title: "브러시로 그린 레이어의 그림을 지웁니다. 원본과 다른 레이어는 지울 수 없습니다 (E)" },
  { id: "eyedropper", icon: "💧", label: "스포이트", title: "화면의 색을 읽어 그리기 색으로 씁니다 (I)" },
];

export default function ToolRail({ enabled }: { enabled: boolean }) {
  const active = useEditorStore((s) => s.activeTool);
  return (
    <nav aria-label="도구" className="overflow-auto border-r border-[var(--line)] bg-[var(--panel)] px-2 py-2.5">
      {TOOLS.map((t) => (
        <button key={t.id} className="tool" aria-pressed={active === t.id} disabled={!enabled} title={t.title} onClick={() => editorStore.getState().setTool(t.id)}>
          <b aria-hidden>{t.icon}</b>
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
