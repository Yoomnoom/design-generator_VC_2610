import type { Tool } from "@/store/editor-store";

/* The words of the help: one line for what a tool does, when to reach for it, an example, and the usual reasons it does not work.
 * Tool tooltips, the help panel and the first-use guide all read from here, so they cannot disagree. */

export type HelpId = Tool | "free-transform" | "sources";
export type ToolHelp = { label: string; summary: string; when: string; example: string; stuck?: string; action?: string };

export const TOOL_HELP: Record<HelpId, ToolHelp> = {
  select: { label: "선택", summary: "레이어를 고르고 끌어서 옮깁니다. 빈 곳을 끌면 상자로 여러 개를 고릅니다.", when: "레이어를 옮기거나 여러 개를 한꺼번에 고를 때.", example: "카드를 끌어 옆으로 옮기기. Alt+끌기로 복제, Shift/Ctrl+클릭으로 여러 개 선택.", action: "tool-select" },
  hand: { label: "이동", summary: "드래그로 화면(보기)을 옮깁니다. 어느 도구에서나 Space를 누른 채 끌어도 됩니다.", when: "확대한 화면의 다른 부분을 볼 때.", example: "200%로 확대한 뒤 이 도구로 끌어 원하는 곳으로 이동.", action: "tool-hand" },
  rect: { label: "영역 추출", summary: "드래그한 사각형을 이미지 레이어로 떼어 내고 원래 자리는 배경색으로 채웁니다.", when: "캡처 속 카드·버튼·글자를 따로 옮기고 싶을 때.", example: "카드 둘레를 드래그 → 레이어가 생기고 원래 자리는 주변 색으로 메워집니다.", stuck: "빈 캔버스·템플릿에는 스크린샷이 없어 쓸 수 없습니다. 배경이 너무 다양하면 색을 물어봅니다.", action: "tool-rect" },
  auto: { label: "자동 후보", summary: "화면을 분석해 영역 후보를 점선으로 보여 줍니다. 클릭해 고르고 Enter로 추출합니다.", when: "정확히 드래그하기 어려운 요소를 빨리 고를 때.", example: "버튼 위를 클릭 → 점선 후보 → 같은 자리를 다시 클릭하면 한 단계 큰 후보 → Enter.", stuck: "사진·질감이 많은 화면은 후보를 못 찾을 수 있습니다. 스크린샷이 없는 화면에서는 쓸 수 없습니다.", action: "tool-auto" },
  fill: { label: "배경 채움", summary: "추출 후 채워진 자리를 클릭해 색을 바꿉니다. 그림자·그라데이션에서 색이 어색할 때 씁니다.", when: "추출한 자리의 배경색이 주변과 어긋나 보일 때.", example: "카드를 떼어 낸 뒤 이 도구로 그 빈자리를 클릭 → 색을 골라 바꿉니다.", stuck: "먼저 영역 추출로 무언가를 떼어 낸 뒤에만 채워진 자리가 생깁니다." },
  line: { label: "선", summary: "드래그해서 직선을 그립니다 (도형 레이어).", when: "구분선이나 화살표 줄을 넣을 때.", example: "두 카드 사이를 드래그해 구분선을 긋고, 오른쪽 위 설정에서 색·굵기를 바꿉니다.", action: "tool-line" },
  box: { label: "사각형", summary: "드래그해서 사각형을 그립니다. 속성 패널에서 모서리를 둥글게 할 수 있습니다.", when: "버튼·카드의 바탕이나 강조 상자를 만들 때.", example: "드래그로 사각형을 만들고 모서리 반지름을 12로 올려 둥근 카드 바탕으로.", action: "tool-box" },
  ellipse: { label: "원", summary: "드래그해서 원·타원을 그립니다.", when: "아바타 자리나 알림 점을 넣을 때.", example: "작은 원을 그려 빨간 알림 점으로 쓰기.", action: "tool-ellipse" },
  brush: { label: "브러시", summary: "드래그로 자유롭게 그립니다. 새 브러시 레이어에 그려지고, 선택해 두면 거기에 이어 그립니다.", when: "손으로 표시하거나 간단히 덧그릴 때.", example: "색을 고르고 카드 주위에 동그라미를 그려 강조.", stuck: "변형(warp)했거나 크기·회전을 바꾼 레이어에는 그릴 수 없습니다. '변형 초기화' 후 다시 그리세요.", action: "tool-brush" },
  eraser: { label: "지우개", summary: "선택한 이미지 레이어의 그림을 지웁니다 (추출한·붙여넣은·그린 레이어).", when: "추출한 레이어의 군더더기를 없앨 때.", example: "카드 레이어를 선택하고 가장자리에 남은 배경을 문지르기. 실행 취소로 되돌릴 수 있습니다.", stuck: "원본 스크린샷, 도형·텍스트, 잠긴·숨긴·변형한 레이어에는 쓸 수 없습니다.", action: "tool-eraser" },
  text: { label: "텍스트", summary: "클릭하고 글자를 입력해 텍스트 상자를 만듭니다. Ctrl+Enter 확정, Esc 취소.", when: "새 문구를 넣거나 기존 글자를 덮어 쓸 때.", example: "버튼 위를 클릭해 '확인'을 입력. 두 번 클릭하면 고칩니다.", action: "tool-text" },
  memo: { label: "메모", summary: "클릭해서 메모 핀을 꽂습니다. 편집용이며 PNG에는 기본으로 들어가지 않습니다.", when: "수정 지시나 확인할 점을 화면 위에 적어 둘 때.", example: "카드에 핀을 꽂고 '여기 문구 교체'라고 적기. 내보내기에서 '메모 포함'을 켜면 PNG에도 나옵니다.", action: "tool-memo" },
  warp: { label: "변형", summary: "이미지 레이어의 모서리·격자점을 끌어 기울이기·원근·왜곡을 합니다. 원본 픽셀은 바뀌지 않습니다.", when: "화면 캡처를 비스듬히 놓거나 목업 위에 맞춰 늘릴 때.", example: "카드 레이어를 선택 → 변형 → 모서리 하나를 끌어 원근을 주고 Enter.", stuck: "이미지(비트맵) 레이어 하나만 선택해야 합니다. 변형한 레이어에 브러시를 쓰려면 '변형 초기화'를 먼저 누르세요.", action: "tool-warp" },
  liquify: { label: "유동화", summary: "이미지 레이어의 모양을 끌어서 밀고(밀기), 부풀리고, 오므리고, 원래대로 복원합니다. 손가락은 색을 번지게 하고 유동화는 모양을 밀어 바꿉니다.", when: "얼굴·물체의 윤곽을 다듬거나 요소를 살짝 늘리고 줄일 때.", example: "버튼 레이어의 모서리를 밀기로 바깥으로 당기고, 어색해진 곳은 복원으로 되돌립니다. 부풀리기·오므리기는 누르기만 해도 적용됩니다.", stuck: "이미지(비트맵) 레이어 하나를 선택해야 합니다. 원본 스크린샷, 도형·텍스트·메모, 변형(warp)한 레이어(변형 초기화 후 가능), 잠긴·숨긴 레이어는 안 됩니다. 레이어 밖으로 밀려난 부분은 사라집니다.", action: "tool-liquify" },
  finger: { label: "손가락", summary: "끄는 방향으로 색을 번지게 합니다.", when: "경계를 부드럽게 흐리거나 얼룩을 밀어 정리할 때.", example: "추출한 레이어의 거친 가장자리를 바깥쪽으로 살짝 끌어 다듬기.", stuck: "이미지 레이어 하나를 선택해야 합니다. 원본 스크린샷과 도형·텍스트는 바뀌지 않습니다.", action: "tool-finger" },
  eyedropper: { label: "스포이트", summary: "화면의 색을 읽어 그리기 색으로 씁니다.", when: "기존 화면과 같은 색의 도형·글자를 만들 때.", example: "버튼 색을 찍은 뒤 사각형을 그리면 같은 색으로 나옵니다.", action: "tool-eyedropper" },
  "free-transform": { label: "자유 변형", summary: "선택한 레이어 전체를 감싸는 상자로 크기·회전을 한꺼번에 바꿉니다.", when: "그림자와 버튼처럼 여러 레이어를 같은 비율로 키우거나 돌릴 때.", example: "버튼 묶음을 선택 → 모서리를 끌면 모두 같은 비율로 커집니다. Shift = 비율 유지, Alt = 중심 기준.", stuck: "잠긴 레이어는 변하지 않고, 변형(warp)한 레이어는 크기가 안 바뀝니다. 기울어진 레이어가 섞이면 비율 유지로만 바뀝니다.", action: "free-transform" },
  sources: { label: "소스·템플릿", summary: "왼쪽 패널에서 내장 부품(버튼·카드·입력창…), 내 소스, 템플릿을 그림으로 보고 넣습니다.", when: "처음부터 만들지 않고 부품이나 화면 틀로 시작할 때.", example: "버튼 카드를 클릭하면 화면 가운데에 그룹으로 들어갑니다. 레이어를 골라 '내 소스'에 저장해 두고 다시 쓸 수도 있습니다." },
};

/** every tool of the tool rail has help */
export const HELP_ORDER: HelpId[] = ["select", "hand", "rect", "auto", "fill", "line", "box", "ellipse", "brush", "eraser", "text", "memo", "warp", "liquify", "finger", "eyedropper", "free-transform", "sources"];

/** the tooltip: what it does, when to use it, and the key (the caller passes the live key text) */
export const toolTooltip = (id: HelpId, key: string | null): string => {
  const h = TOOL_HELP[id];
  return `${h.label}: ${h.summary} ${h.when}${key ? ` (${key})` : ""}`;
};

export const COMMON_STUCK: { problem: string; answer: string }[] = [
  { problem: "지우개가 안 지워져요", answer: "지우개는 추출한·붙여넣은·그린 이미지 레이어를 하나 선택했을 때만 씁니다. 원본 스크린샷, 도형·텍스트, 잠긴·숨긴·변형한 레이어는 지울 수 없습니다." },
  { problem: "변형한 레이어에 브러시나 지우개가 안 돼요", answer: "속성 패널의 '변형 초기화'를 누르면 다시 쓸 수 있습니다. (변형은 이미지를 바꾸지 않고 값만 저장하기 때문입니다.)" },
  { problem: "배경 채움을 눌러도 아무 일이 없어요", answer: "먼저 영역 추출로 카드를 떼어 낸 뒤, 그 자리에 생긴 채워진 곳을 클릭하세요." },
  { problem: "영역 추출·자동 후보가 꺼져 있어요", answer: "빈 캔버스나 템플릿으로 시작한 화면에는 잘라 낼 스크린샷이 없습니다. 캡처를 올리면 쓸 수 있습니다." },
  { problem: "레이어가 움직이지 않아요", answer: "잠긴 레이어는 움직이지 않습니다. 레이어 목록의 자물쇠를 눌러 풀고, 비교 보기 중이면 '수정본'으로 돌아오세요." },
  { problem: "단축키가 안 먹어요", answer: "글자를 입력하는 칸이나 창이 열려 있으면 단축키는 멈춥니다. Ctrl+T·N·W는 브라우저가 먼저 처리해서 쓸 수 없습니다(자유 변형은 Shift+T)." },
];

export type OnboardingStep = { title: string; body: string };
export const ONBOARDING: OnboardingStep[] = [
  { title: "1. 시작하기", body: "캡처를 올리거나, 빈 캔버스·템플릿으로 시작하세요. 편집 중에는 위쪽 '새 프로젝트'로 다시 고를 수 있습니다." },
  { title: "2. 떼어 내거나 넣기", body: "캡처에서는 '영역 추출'(M)로 요소를 레이어로 떼어 내고, 왼쪽 '소스·템플릿'에서 버튼·카드 같은 부품을 클릭해 넣습니다." },
  { title: "3. 옮기고 바꾸기", body: "선택 도구로 끌어 옮기고, 여러 개는 빈 곳을 끌어 상자로 고르세요. 크기·회전은 '자유 변형'(Shift+T), 모양은 변형·손가락 도구로." },
  { title: "4. PNG로 저장", body: "위쪽 'PNG 내보내기'로 원본 크기 그대로 저장합니다. 작업은 'Ctrl+S'로 프로젝트 파일에도 저장할 수 있고, 자동 임시저장도 됩니다." },
];
export const ONBOARDING_KEY = "slc-onboarded";