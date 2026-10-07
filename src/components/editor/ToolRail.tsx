"use client";

import { Tool } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";

const TOOLS: { id: Tool; icon: string; label: string; title: string }[] = [
  { id: "select", icon: "↖", label: "선택", title: "레이어를 선택하고 드래그해서 옮깁니다" },
  { id: "hand", icon: "✋", label: "이동", title: "드래그해서 화면을 옮깁니다" },
  { id: "rect", icon: "▱", label: "영역 추출", title: "드래그한 사각형을 이미지 레이어로 추출합니다" },
  { id: "fill", icon: "▨", label: "배경 채움", title: "추출하고 남은 배경 패치를 클릭해 색을 바꿉니다" },
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
