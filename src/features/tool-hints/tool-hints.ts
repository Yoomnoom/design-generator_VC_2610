import { liquifyTargetProblem } from "@/features/liquify/liquify";
import { strokeTargetProblem } from "@/features/brush/brush";
import { isGeneratedPage } from "@/lib/project/blank";
import { BitmapLayer, ScreenNode } from "@/lib/project/schema";
import { SOURCE_ERASER_MESSAGE, SOURCE_HOW_TO, SOURCE_LOCKED_MESSAGE } from "@/features/source-edit/source-edit";
import type { Tool } from "@/store/editor-store";

/* One line for the status bar and the tool's tooltip: what the tool does now, or - when it cannot be used in this state - why not and what
 * to do next. Pure: the state in, a sentence out. */

export type ToolHint = { usable: boolean; text: string };
export type HintState = {
  screen: ScreenNode | null;
  selected: BitmapLayer[];
  comparing: boolean;
  /** the original picture ("배경(원본)") is the selected thing: and whether it is still locked (the default) */
  source?: { selected: boolean; locked: boolean };
};

const NEEDS_EDIT: Tool[] = ["liquify", "rect", "fill", "line", "box", "ellipse", "brush", "eraser", "text", "memo", "auto", "warp", "finger"];

export function toolHint(tool: Tool, s: HintState): ToolHint {
  const ok = (text: string): ToolHint => ({ usable: true, text });
  const no = (text: string): ToolHint => ({ usable: false, text });
  if (!s.screen) return no("먼저 캡처를 올리거나 '새 프로젝트'에서 빈 캔버스·템플릿으로 시작하세요.");
  if (s.comparing && NEEDS_EDIT.includes(tool)) return no("비교 보기 중에는 편집할 수 없습니다. 위쪽의 '수정본'을 눌러 돌아오세요.");
  const one = s.selected.length === 1 ? s.selected[0] : undefined;
  switch (tool) {
    case "select":
      return ok("선택 · 레이어를 끌어 옮기고, 빈 곳을 끌면 상자로 여러 개를 고릅니다 (Alt+끌기: 복제)");
    case "hand":
      return ok("이동 · 드래그로 화면을 옮깁니다 (어느 도구에서나 Space를 누르고 끌면 잠시 손)");
    case "rect":
      return isGeneratedPage(s.screen.source.fileName) ? no("영역 추출: 스크린샷이 없는 화면(빈 캔버스·템플릿)입니다. 캡처를 올리면 쓸 수 있습니다.") : ok("영역 추출 · 드래그한 사각형을 레이어로 떼어 냅니다");
    case "auto":
      return isGeneratedPage(s.screen.source.fileName) ? no("자동 후보: 스크린샷이 없는 화면(빈 캔버스·템플릿)입니다. 캡처를 올리면 쓸 수 있습니다.") : ok("자동 후보 · 점선 후보를 클릭하고 Enter로 추출합니다");
    case "fill":
      return s.screen.backgroundPatches.length === 0 ? no("배경 채움: 먼저 영역 추출로 카드를 떼어 낸 뒤, 채워진 자리를 클릭하세요.") : ok("배경 채움 · 추출하고 채워진 자리를 클릭해 색을 바꿉니다");
    case "line":
    case "box":
    case "ellipse":
      return ok("드래그해서 그립니다. 색과 굵기는 오른쪽 위 그리기 설정에서 정합니다");
    case "brush":
      if (s.source?.selected) return s.source.locked ? no(`브러시: ${SOURCE_LOCKED_MESSAGE}.`) : ok("브러시 · 원본 그림에 직접 그립니다(실행 취소 1단계, 처음 올린 그림은 보존됩니다)");
      return ok("브러시 · 드래그로 그립니다. 새 레이어에 그려지고, 방금 그린 브러시 레이어를 선택해 두면 거기에 이어집니다");
    case "eraser": {
      if (s.source?.selected) return no(`지우개: ${SOURCE_ERASER_MESSAGE}`);
      const problem = strokeTargetProblem(one, true);
      return problem ? no(`지우개: ${problem}`) : ok("지우개 · 선택한 이미지 레이어의 그림을 지웁니다 (새 그림으로 바뀌어 실행 취소가 됩니다)");
    }
    case "text":
      return ok("텍스트 · 클릭하고 입력합니다. Ctrl+Enter로 확정, Esc로 취소");
    case "memo":
      return ok("메모 · 클릭해서 핀을 꽂습니다 (PNG에는 기본으로 들어가지 않습니다)");
    case "eyedropper":
      return ok("스포이트 · 화면의 색을 읽어 그리기 색으로 씁니다");
    case "warp":
      if (!one) return no("변형: 이미지 레이어를 하나만 선택하세요(영역 추출한 레이어 등).");
      if (one.content || !one.imageId) return no("변형: 도형·텍스트 레이어는 대상이 아닙니다. 이미지 레이어를 선택하세요.");
      if (one.locked) return no("변형: 잠긴 레이어입니다. 잠금을 풀고 다시 시도하세요.");
      return ok("변형 · 모서리·격자점을 끌어 기울이기·원근·왜곡을 합니다. Enter 확정, Esc 취소");
    case "liquify": {
      if (!one && s.source?.selected) return s.source.locked ? no(`유동화: ${SOURCE_LOCKED_MESSAGE}.`) : ok("유동화 · 원본 그림의 모양을 밀고 부풀리고 오므립니다(실행 취소 1단계)");
      const problem = liquifyTargetProblem(one, !!one?.imageId);
      return problem ? no(`유동화: ${problem}`) : ok("유동화 · 끌어서 모양을 밀고, 부풀리고, 오므립니다. 위쪽 설정에서 방식·크기·강도를 고릅니다");
    }
    case "finger": {
      if (!one && s.source?.selected) return s.source.locked ? no(`손가락: ${SOURCE_LOCKED_MESSAGE}.`) : ok("손가락 · 원본 그림을 끄는 방향으로 번지게 합니다(실행 취소 1단계)");
      if (!one) return no(`손가락: 이미지 레이어를 하나만 선택하세요. ${SOURCE_HOW_TO}`);
      if (one.content || !one.imageId) return no("손가락: 도형·텍스트 레이어는 번지게 할 수 없습니다. 이미지 레이어를 선택하세요.");
      if (one.locked) return no("손가락: 잠긴 레이어입니다. 잠금을 풀고 다시 시도하세요.");
      if (!one.visible) return no("손가락: 숨긴 레이어입니다. 먼저 보이게 하세요.");
      return ok("손가락 · 끄는 방향으로 색을 번지게 합니다");
    }
  }
}