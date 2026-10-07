# Claude Code 구현 핸드오프 v0.2

## 함께 전달할 파일

1. `Screenshot_Layer_Canvas_PRD_v0.2.md`
2. `Screenshot_Layer_Canvas_Wireframe_v2.html`
3. 이 문서 `Claude_Code_Handoff_Screenshot_Layer_Canvas_v0.2.md`
4. `CLAUDE.md` (새 프로젝트 폴더의 루트에 둘 것)

참고 프로젝트:

- 실행 화면: https://lnkiai.github.io/m3e-canvas/
- GitHub: https://github.com/lnkiai/m3e-canvas

## 문서 우선순위

세 문서가 충돌하면 **핸드오프 v0.2 > PRD v0.2 > 와이어프레임 v2** 순서로 따른다. 와이어프레임은 화면 구조와 인터랙션 참고용이며, 기능 범위의 근거가 아니다. 와이어프레임에서 회색 "나중에" 표시가 붙은 항목은 Phase 1에서 구현하지 않는다.

---

## Claude Code에 처음 보낼 요청문

아래 내용을 그대로 복사해서 Claude Code에 전달하세요.

```text
첨부한 4개 파일을 먼저 끝까지 읽고, 요구사항을 임의로 확대하지 말고 작업해 주세요.

- Screenshot_Layer_Canvas_PRD_v0.2.md: 제품 범위와 기능 정의
- Screenshot_Layer_Canvas_Wireframe_v2.html: 화면 구조와 인터랙션 참고 시안 (기능 범위의 근거가 아님)
- Claude_Code_Handoff_Screenshot_Layer_Canvas_v0.2.md: 개발 순서와 금지사항
- CLAUDE.md: 프로젝트 작업 규칙. 새 프로젝트 폴더를 만들면 루트에 그대로 배치하세요.

문서가 충돌하면 핸드오프 > PRD > 와이어프레임 순서로 따르세요.

참고 프로젝트는 M3E Canvas입니다.
- https://lnkiai.github.io/m3e-canvas/
- https://github.com/lnkiai/m3e-canvas

목표는 M3E Canvas를 복제하는 것이 아닙니다. 웹·앱 스크린샷을 업로드하고, 화면 일부를 비트맵 레이어로 추출해 캔버스에서 재배치한 뒤 PNG로 저장하는 웹앱을 만드는 것입니다.

중요한 범위 제한:
1. MVP에서 스크린샷을 HTML/React 컴포넌트로 변환하지 않습니다.
2. OCR 텍스트 편집, SVG 복원, AI 코드 생성은 구현하지 않습니다.
3. AI 자동 분해를 구현한 것처럼 가짜 UI만 만들지 않습니다.
4. 1차 목표는 수동 사각형 추출이 실제로 작동하는 수직 기능입니다.
5. 외부 AI API나 유료 API를 추가하지 않습니다.
6. 체크무늬를 결과 이미지에 합성하지 않습니다. 투명 결과는 실제 알파 채널이어야 합니다.
7. PRD에 없는 기능을 임의로 추가하지 않습니다.
8. 와이어프레임의 "나중에" 표시 항목(자동 분석, 마스크, 합치기, 텍스트, 정렬 자동화, 원본 비교, 프롬프트, 원본 배치 복구, 잠금)은 Phase 1에서 구현하지 않습니다.
9. 레이어 크기 조절·회전은 Phase 1.5입니다. 데이터 모델의 scaleX/scaleY/rotation 필드는 두되 1/1/0으로 고정합니다.
10. 화면 라벨과 PNG 출력 크기는 고정값이 아니라 업로드한 원본 이미지 크기를 따릅니다. 와이어프레임의 1440×900은 예시값입니다.
11. M3E Canvas는 Editor.tsx의 캔버스 이동·확대와 Undo/Redo 구조, lib/project.ts의 스키마 검증 방식만 참고하고, 코드는 복사하지 말고 이 프로젝트에 맞게 새로 작성하세요. 라이선스는 MIT이지만 lib/shapes.ts는 Apache 2.0 포팅 코드이므로 가져오지 마세요.

첫 작업에서는 코드를 바로 대규모로 작성하지 말고 다음 순서로 진행하세요.

1. 첨부 문서의 요구사항을 구현/시뮬레이션/후속 범위로 구분해 요약
2. M3E Canvas 저장소의 참고할 부분과 새로 작성해야 할 부분 분석 (복사가 아니라 방식 참고)
3. 신규 프로젝트와 M3E Canvas 포크 중 하나를 선택하고 근거 제시
4. 아래 6개 질문에 답하면서 MVP 폴더 구조, 데이터 모델, 상태 관리, Undo/Redo 전략 작성
   Q1. M3E Canvas 포크와 신규 구현 중 무엇을 선택했으며, 그 이유는 무엇인가?
   Q2. 화면 좌표와 원본 이미지 좌표를 어떻게 분리할 것인가?
   Q3. 원본 및 추출 이미지 Blob을 어떻게 영속화할 것인가?
   Q4. Undo/Redo에서 이미지 데이터를 복제하지 않는 방법은 무엇인가?
   Q5. PNG 내보내기 해상도를 어떻게 보장할 것인가?
   Q6. Phase 1에서 의도적으로 구현하지 않을 기능은 무엇인가?
5. Phase 1 구현 계획을 파일 단위로 제시
6. 내가 승인한 후에 구현 시작

기술 기본값:
- Next.js App Router
- TypeScript
- React
- Tailwind CSS
- Konva.js 우선 검토
- 브라우저 로컬 저장 우선
- 테스트: Vitest + Playwright

Phase 1의 필수 완료 흐름:
이미지 업로드 → 원본 크기 화면 프레임 표시 → 사각형 영역 선택 → 선택 영역을 독립 이미지 레이어로 생성 → 드래그 이동 → 원래 자리를 배경색으로 채움 → 원본 크기 PNG 출력

최종 보고에서는 반드시 아래를 구분하세요.
- 실제 구현 완료
- 테스트 완료
- 시뮬레이션/목업 상태
- 구현하지 않은 기능
- 알려진 오류와 다음 작업
```

---

## 프로젝트 구현 원칙

### 제품의 정체성

이 제품은 디자인 파일 복원기가 아니다. 캡처 이미지를 빠르게 재조합하는 **시각적 목업 편집기**다.

### MVP의 핵심

```text
업로드
→ 영역 선택
→ 이미지 레이어 생성
→ 레이어 이동
→ 빈자리 정리
→ PNG 출력
```

이 흐름이 실제로 작동하기 전에는 자동 분해, OCR, AI 프롬프트 생성, 화면 연결 기능을 추가하지 않는다.

### 신규 프로젝트를 우선 검토하는 이유

M3E Canvas는 UI 컴포넌트 노드 중심이다. 본 제품은 원본 래스터 이미지, 크롭 좌표, 추출된 비트맵, 캔버스 좌표와 변형값, 배경 복원 영역이 중심이다. 전체를 포크하면 컴포넌트 모델과 이미지 레이어 모델이 충돌할 수 있다. 캔버스 이동·확대, 선택, 단축키, Undo/Redo UX는 참고하되 데이터 모델은 새로 설계하는 방향을 우선 검토한다. 최종 선택은 저장소 분석 후 근거와 함께 제안한다.

## Phase 1 상세 범위

### 반드시 구현

- PNG/JPG 파일 선택 및 드래그앤드롭
- 업로드한 원본 이미지 보존
- 원본 크기 기준 화면 프레임 (라벨은 업로드 이미지 크기에서 계산)
- 사각형 선택 도구와 선택 영역 미리보기
- 선택 영역을 독립 Canvas/ImageBitmap 레이어로 생성
- 레이어 선택, 이동, 복제, 삭제
- 레이어 앞뒤 순서 변경
- 뷰포트 확대·축소·이동 (200% 확대에서도 좌표 정확)
- 배경 대표색 추출, 추출 전 위치를 대표 배경색으로 채우기
- Undo/Redo (50단계 이상)
- 원본 크기 PNG 저장
- 단일 화면 프로젝트 JSON 저장 및 불러오기

### 구현하지 않음 (Phase 1 제외)

- SAM 등 AI 세그멘테이션, 자동 분석, 클릭 기반 객체 후보
- 마스크 보정, 합치기·나누기
- OCR 텍스트 변환, 텍스트 도구, 폰트 추정
- 정렬 자동화(8px 간격 등), 정렬 가이드·스냅
- 원본/수정본 비교
- 변경사항 프롬프트 출력
- 다중 화면
- 레이어 크기 조절·회전
- 레이어 잠금·숨김·이름 변경 UI, 그룹화, 다중 선택
- 원본 배치 복구 버튼
- URL 자동 캡처, 복잡한 배경 인페인팅, 반응형 화면 자동 생성
- HTML/React 코드 변환
- 사용자 계정과 서버 저장

### 후속 단계

- Phase 1.5: 크기 조절·회전, 잠금·숨김·이름 변경, 원본/수정본 비교, 키보드 단축키
- Phase 2: 다중 선택·그룹, 정렬 가이드·스냅, 다중 화면

## 권장 상태 모델

PRD v0.2 11장의 `Project > screens[]` 구조를 따른다. Phase 1에서는 `screens`에 화면 하나만 허용한다.

```ts
type Project = {
  id: string;
  name: string;
  version: 1;
  canvas: { zoom: number; panX: number; panY: number };
  screens: ScreenNode[];            // Phase 1: 길이 1
};

type ScreenNode = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;                    // 원본 이미지 너비
  height: number;                   // 원본 이미지 높이
  source: { imageId: string; fileName: string };
  backgroundPatches: BackgroundPatch[];
  layers: BitmapLayer[];
};

type BitmapLayer = {
  id: string;
  name: string;
  crop: { x: number; y: number; width: number; height: number };
  imageId?: string;
  transform: {
    x: number;
    y: number;
    scaleX: 1;                      // Phase 1 고정
    scaleY: 1;                      // Phase 1 고정
    rotation: 0;                    // Phase 1 고정
  };
  zIndex: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
};

type BackgroundPatch = {
  id: string;
  rect: { x: number; y: number; width: number; height: number };
  fill: string;
};

// UI 상태 (프로젝트 파일에 저장하지 않아도 됨)
type EditorUiState = {
  activeScreenId: string;
  selectedLayerIds: string[];
  activeTool: "select" | "hand" | "rect" | "fill";
};
```

원본 이미지 픽셀 데이터를 매번 상태 히스토리에 복사하지 않는다. Undo/Redo에는 좌표, 레이어, 패치 등 직렬화 가능한 명령 또는 상태 차이만 기록한다.

## 권장 폴더 구조

```text
src/
  app/
    page.tsx
    layout.tsx
  components/
    editor/
      EditorShell.tsx
      TopBar.tsx
      ToolRail.tsx
      SourcePanel.tsx
      CanvasViewport.tsx
      ScreenFrame.tsx
      LayerPanel.tsx
      PropertyPanel.tsx
      ExportDialog.tsx
  features/
    import-image/
    rectangle-extract/
    layer-transform/
    background-fill/
    project-persistence/
    export-image/
  store/
    editor-store.ts
    history.ts
  lib/
    image/
      sample-background.ts
      crop-bitmap.ts
      render-export.ts
    project/
      schema.ts
      migrate.ts
  tests/
    unit/
    e2e/
```

## 구현 시 주의사항

### 이미지 좌표

- 화면 표시 좌표와 원본 픽셀 좌표를 분리한다.
- 확대·축소 상태와 관계없이 추출 결과는 원본 픽셀 기준이어야 한다.
- 고해상도 출력에서 CSS 좌표를 그대로 사용하지 않는다.
- devicePixelRatio로 인해 결과 크기가 달라지지 않도록 테스트한다.

### 화면 크기 표시와 PNG 출력 크기

- 화면 라벨은 `원본 너비 × 원본 높이`를 동적으로 표시한다. 1440×900 같은 고정값을 코드에 두지 않는다.
- PNG 출력 기본값은 업로드한 원본 크기다. 출력 대화상자에도 실제 크기를 표시한다.

### 배경색 추출

- 선택 영역 내부가 아니라 바깥 1~5px 테두리에서 색상을 샘플링한다.
- 평균값보다 중앙값 또는 빈도가 높은 색을 우선 검토한다.
- 샘플 색상 편차가 임계값보다 크면 자동 채우기를 중단하고 사용자에게 색상을 선택하게 한다.

### 투명도

- 편집기 안에서 투명 영역 확인용 패턴을 표시할 수는 있다.
- PNG 내보내기 결과에는 확인용 패턴이 절대 포함되면 안 된다.
- 투명 출력은 실제 RGBA 알파 채널을 사용한다.

### 프로젝트 저장

- Blob URL은 브라우저 재시작 후 유효하지 않다.
- 원본과 추출 이미지는 IndexedDB에 Blob으로 저장하거나 프로젝트 파일에 포함해야 한다.
- JSON만 저장하면서 임시 URL을 기록하는 방식은 금지한다.
- `version` 필드와 `migrate.ts`로 이후 스키마 변경(크기 조절, 다중 화면)에 대비한다.

## 테스트 요구사항

### 단위 테스트

- 화면 좌표를 원본 픽셀 좌표로 변환 (zoom 100%, 200%, pan 포함)
- 사각형 크롭 결과 크기
- 배경색 샘플링
- zIndex 정렬
- Undo/Redo
- 프로젝트 스키마 직렬화와 복원 (`screens[]` 구조, 길이 1 검증)

### E2E 테스트

1. 테스트 이미지 업로드, 화면 라벨이 원본 크기와 일치하는지 확인
2. 지정 좌표로 영역 선택
3. 새 레이어 생성 확인
4. 200% 확대 상태에서 영역 선택 후 원본 픽셀 위치 확인
5. 레이어 이동
6. 원본 위치의 배경 패치 확인
7. PNG 다운로드 실행, 결과 크기가 원본과 일치하는지 확인
8. 프로젝트 저장 후 재로딩
9. 위치와 레이어 순서 복원 확인

## Phase 1 완료 조건

- 예제 웹앱 캡처 한 장으로 전체 흐름이 실제 작동한다.
- 선택한 영역의 크기와 레이어 크기가 일치한다.
- 200% 확대 상태에서도 원본 픽셀 기준 추출 위치가 틀어지지 않는다.
- 결과 PNG 크기가 원본 캡처 크기와 정확히 일치한다.
- 프로젝트를 다시 열었을 때 모든 레이어 위치와 순서가 복구된다.
- 자동 분해처럼 보이기만 하는 가짜 기능이 없다.
- 빌드, 타입 검사, 단위 테스트, E2E 테스트 결과를 보고한다.

## 변경 이력

- v0.1: 초안
- v0.2: PRD·와이어프레임과 범위 통일, `screens[]` 구조 채택, 확대·축소 유지, 크기 조절·회전·비교·정렬 제외, 6개 질문을 요청문에 포함, 원본 크기 기준 라벨·PNG 명시, 문서 우선순위 추가
