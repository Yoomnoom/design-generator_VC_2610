# 寃利??湲?紐⑸줉

??뿉????PC??硫붾え由ш? 遺議깊빐 ?꾩껜 E2E쨌?꾨줈?뺤뀡 E2E쨌諛섎났 ?ㅽ뻾???뚮━吏 ?딅뒗?? ?뚮━吏 紐삵븳 寃利앹쓣 ?ш린???볤퀬, 諛??먮뒗 硫붾え由ш? ?ъ쑀濡쒖슱 ?????쒖꽌?濡??뚮┛ ??寃곌낵瑜??곴퀬 以꾩쓣 吏?대떎.

洹쒖튃: spec ?뚯씪 ?⑥쐞(`npx playwright test tests/e2e/<?뚯씪>`), workers=1, 釉뚮씪?곗? ?섎굹, 媛쒕컻 ?쒕쾭??耳??먯? ?딅뒗??Playwright媛 ?꾩슦怨??덈떎).

| 湲곕뒫 | 而ㅻ컠 | ?뚮젮????寃利?| ?뚮━吏 ?딆? ?댁쑀 |
|---|---|---|---|
| A 遺숈뿬?ｊ린쨌?쒕∼ ?덉씠??| 5fbbd45 | 媛쒕컻 E2E ?꾩껜(spec ?⑥쐞), ?꾨줈?뺤뀡 E2E ?꾩껜. 媛쒕퀎 ?듦낵: `paste`, `paste-layer`, `shortcuts` | ?꾩껜 ?ㅽ뻾 以?硫붾え由?遺議깆쑝濡??쒖뒪?쒖씠 以묐떒 |
| B ?덉씠??蹂??| 696c0e9 | 媛쒕컻쨌?꾨줈?뺤뀡 E2E ?꾩껜, ?꾨줈?뺤뀡?먯꽌 `PW_PERF=1` `warp-perf.spec.ts`(媛쒕컻 ?쒕쾭 痢≪젙留??덉쓬: 蹂???쒕옒洹?以?33ms 珥덇낵 ?꾨젅??24~56/200) | ?꾩? 媛숈쓬 |
| C ?먭????꾧뎄 | a88f81b | 媛쒕컻쨌?꾨줈?뺤뀡 E2E ?꾩껜, ?꾨줈?뺤뀡?먯꽌 `PW_PERF=1` `finger-perf.spec.ts` | ?꾩? 媛숈쓬 |
| 媛꾪뿉 ?ㅽ뙣 | - | `npx playwright test tests/e2e/brush.spec.ts --repeat-each=30` 濡??먯씤 ?뺤씤; `shortcuts.spec.ts` "?대┰蹂대뱶 ?곌린 嫄곕?" 耳?댁뒪??諛섎났 | ??洹쒖튃: 諛섎났 ?ㅽ뻾 湲덉? |
| 媛쒕컻 E2E ?⑥? spec | - | 留덉?留??꾩껜 ?ㅽ뻾? `app`(34)쨌`autosave`(21)쨌`brush`(19)源뚯? ?듦낵 ??以묐떒. ?섎㉧吏 spec? 媛쒕퀎 ?듦낵 ???⑹궛 誘명솗??| 硫붾え由?遺議?|
| D ?먯뀑 ?쇱씠釉뚮윭由?룻뀥?뚮┸ | 寃利??湲??꾨옒 而ㅻ컠) | 媛쒕컻 E2E ?꾩껜: ?뱁엳 ?쇱そ ?⑤꼸??諛붾뚯뿀?쇰?濡?`app`, `panels`, `handoff-9steps`, `autosave`, `compare`, `shortcuts`; ?꾨줈?뺤뀡 E2E ?꾩껜. ?듦낵: `assets.spec.ts` 6媛?媛쒕컻) | ??洹쒖튃 |
| 1 소스·템플릿 미리보기 그림 | (이 기능의 커밋) | 개발 E2E 전체(특히 `app`, `panels`, `handoff-9steps`, `compare`); 프로덕션 E2E 전체. 통과: `asset-preview.spec.ts` 4개, `assets.spec.ts` 6개(개발 서버) | 위 규칙(전체·프로덕션 실행 금지) |
| 2 시작 화면·빈 캔버스 | (이 기능의 커밋) | 개발 E2E 전체 — 특히 첫 화면 제목을 바꿨으므로 `app`, `autosave`, `handoff-9steps`(제목 검사 수정함, 아직 안 돌림), 내장 아이콘 이름을 "엑스"·"체크"로 바꾸고 `exportPngBytes` 닫기 버튼을 대화상자 범위로 좁혔으므로 `compare`, `lock-hide-rename`, `memo`, `panels`, `shortcuts`; 프로덕션 E2E 전체. 통과: `start-screen.spec.ts` 12개(DPR 1·2 포함), `asset-preview` 4, `assets` 6 | 위 규칙 |
| (2 보충) | - | pp.spec.ts 전체 34개 통과(D가 만든 locator("section") 중복을 main > section으로 고침) | - |
| 3 선택·그룹 단축키·단축키 설정 (스키마 v8) | (이 기능의 커밋) | 개발 E2E 전체와 프로덕션 E2E 전체. 특히 레이어 패널·선택 동작이 바뀌었으므로 pp, compare, lock-hide-rename, memo, handoff-9steps, utosave, 	ransform, shapes-layer, 	ext, rush. 통과: groups.spec.ts 10, shortcut-settings.spec.ts 6, multiselect 25(Shift 의미 바뀐 부분 고침), shortcuts 32, panels 18 | 위 규칙 |
| 4 도형 둥근 모서리 (스키마 v9) | (이 기능의 커밋) | 개발 E2E 전체와 프로덕션 E2E 전체. 특히 버전 숫자 검사를 7→9로 고친 `brush`, `memo`, `text`, `transform`(이 넷은 고치기만 하고 안 돌림). 통과: `corner-radius.spec.ts` 8, `shapes-layer` 17, `assets` 6, `asset-preview` 4, `start-screen` 12 | 위 규칙 |
| (보충) 3 이후 알게 된 것 | - | v8로 올릴 때 `brush`·`memo`·`shapes-layer`·`text`·`transform` E2E의 "버전 7" 검사가 깨졌는데 그때는 못 잡았다(4에서 9로 고침, `shapes-layer`만 돌려 통과). 나머지 spec을 돌려 확인해야 한다 | 같은 규칙 |
| S2 그룹 선택 버그·소스 그룹 삽입·그룹 넣기/빼기 | (S2 커밋) | 개발·프로덕션 E2E 전체; 특히 `assets`(삽입이 그룹이 됨), `multiselect`(Ctrl 클릭 의미), `panels`. 통과: `group-edit` 9, `groups` 10 | 전체 실행 금지 |
| S3 드래그 박스 선택·선택 개수·Space 손 | (S3 커밋) | 개발·프로덕션 E2E 전체; 특히 multiselect(Stage 빈 곳 mousedown 해제를 pointerup 클릭 해제로 옮김; 2개 재확인 통과, 나머지 23은 이전에 통과), compare, rush(Space 키). 통과: marquee 7, multiselect 25(일부 -g로) | 전체 실행 금지 |
| S4 자유 변형(선택 전체 상자·핸들·속성 입력, Shift+T) | (S4 커밋) | 개발·프로덕션 E2E 전체; 특히 `shortcut-settings`(항목 하나 늘어남, 통과), `multiselect`(통과), `panels`(레이어 패널 옆 속성 패널 문구 변경). 통과: `free-transform` 9(DPR 1·2, 200% 포함) | 전체 실행 금지 |
| S5a 포토샵 편의 1차(Alt+드래그 복제, Ctrl+0/1, 정렬·분배, 불투명도, 혼합 모드(스키마 v10), 뒤집기) | (S5a 커밋) | 개발·프로덕션 E2E 전체; 특히 `multiselect`(Alt 드래그 의미 변경 영향), `shortcut-settings`(항목 증가), `corner-radius`·`groups` 등 버전 숫자 검사를 10으로 고친 spec 전부. 통과: `photoshop-basics` 7(DPR 1·2 혼합 모드·불투명도 화면=PNG ≤1) | 전체 실행 금지 |
| S6 지우개 완화(추출·붙여넣은 비트맵)·도구별 상황 안내 | (S6 커밋) | 개발·프로덕션 E2E 전체. 통과: `brush` 19, `tool-hints` 4, `panels`+`app` 51(속성 패널 입력 수 검사 1곳 고침) | 전체 실행 금지 |
| S7 포토샵 단축키 프리셋(포토샵 기본·이전 기본값), 물리 키 기준, Ctrl+X/S/O/J·확대·레이어 순서 등 | (S7 커밋) | 개발·프로덕션 E2E 전체. 키가 바뀌어 고친 spec(`shortcuts`, `autosave`, `start-screen`, `finger`, `warp`, `shapes-layer`, `compare`, `multiselect`, `groups` 의 Ctrl+D→Ctrl+J 등): 앞의 다섯은 통과 확인, `autosave`·`compare`·`multiselect`·`groups`·`start-screen`은 키만 고치고 안 돌림. 통과: `shortcut-presets` 8, `shortcut-settings` 6, `shortcuts` 32, `finger`·`warp`·`shapes-layer` | 전체 실행 금지 |
| S8 도움말·도구 툴팁(설명+언제 쓰나)·첫 사용 안내 | (S8 커밋) | 개발·프로덕션 E2E 전체(첫 사용 안내 카드가 새 브라우저의 첫 화면마다 보이므로 모든 spec의 시작 화면에 영향 가능: 아직 `help`·`tool-hints`만 돌림). 상단 바 폭을 줄여 맞췄으므로 `app`·`panels` 재확인. 통과: `help` 6, `tool-hints` 4 | 전체 실행 금지 |
| B 유동화 도구·손가락 도구 개선 | (B 커밋) | 개발·프로덕션 E2E 전체; 프로덕션 빌드의 `PW_PERF=1 liquify-perf.spec.ts`(개발 서버만 측정). 통과: `liquify` 6, `finger` 8(무선택 드래그의 의미가 바뀌어 한 곳 고침), `liquify-perf`(개발 서버, 아래 보고) | 전체·프로덕션 실행 금지 |
| A1 레이어 효과(그림자·외곽선·색상 오버레이, 스키마 v11) | (A1 커밋) | 개발·프로덕션 E2E 전체; 프로덕션 빌드. 통과: `effects` 4(DPR 1·2, 화면=PNG ≤1) | 전체·프로덕션 실행 금지 |
| A2 래스터화·병합(Ctrl+E/Ctrl+Shift+E) | (A2 커밋) | 개발·프로덕션 E2E 전체; `shortcut-settings`·`shortcut-presets`(Ctrl+E가 이제 병합). 통과: `merge` 1 | 전체·프로덕션 실행 금지 |
| A6 캔버스 크기 조정(여백 추가·자르기) | (A6 커밋) | 개발·프로덕션 E2E 전체. 통과: `canvas-size` 2 | 전체·프로덕션 실행 금지 |
| A3 격자·색상 스와치(눈금자·가이드는 못 함) | (A3 커밋) | 개발·프로덕션 E2E 전체. 통과: `grid-swatches` 2 | 전체·프로덕션 실행 금지 |
| A4 image adjustments (brightness, contrast, saturation, hue, blur, sharpen; schema v12) | (A4 commit) | full dev + production E2E; production `adjust` spec; large-image frame timing in a browser (unit timing only: 3600x2700 blur about 4.6 s, colour 0.15 s, 480px preview 50-85 ms). Passed: `adjust` 3 (DPR 1 and 2, screen = PNG within 1) | full / production runs not allowed (memory) |

## 2026-10-15 밤 검증 결과 (위 표의 대기 항목은 모두 처리됨)

- [x] 개발 E2E 전체(spec 파일 단위, workers=1): 통과. 처음 실패 3건은 모두 테스트 경합이라 "현재 상태를 기다리게" 고침: `corner-radius`(복원 직후 `layers[0]` 읽기), `grid-swatches`(reload 뒤 복원 질문), `panels`(효과·조정 입력까지 세던 선택자).
- [x] 간헐 실패 반복: `shortcuts` x30 = 960 통과, `autosave` x30 = 630 통과, `brush` x30 = 568 통과·2 실패(지우개 Undo 직후 캔버스 픽셀을 한 번만 읽던 경합 → `expect.poll`로 고침), `grid-swatches` x30 통과.
- [x] **앱 버그 1건 수정**: 다른 탭 상태(`ready=true`)로 있다가 잠금을 이어받을 때 `ready`가 true인 채 저장본을 읽어 복원 질문이 늦게 떴다(`becomeOwner`가 `ready:false`로 되돌리지 않았다). 고친 뒤 30회 반복 통과.
- [x] 프로덕션 빌드 E2E(`NEXT_PUBLIC_E2E=1` 빌드, `PW_PROD=1`, spec 단위): 전부 통과. 처음 실패 1건(`lock-hide-rename`: (10,10) 클릭이 캔버스가 아니라 헤더라 선택 해제가 우연에 의존)은 테스트를 고쳤고 프로덕션 5회 반복 통과.
- [x] 큰 변형 레이어(3600×2700) 놓은 뒤 멈춤: 개발 서버에서 놓는 순간 약 5.1초(`releaseWallMs` 13090 − 8000) → 약 0.19초(8185 − 8000). 프로덕션은 약 0.11초, 놓은 뒤 가장 긴 프레임 39ms. 방법: 1.5백만 픽셀을 넘는 변형은 거친 그림을 바로 그리고 진짜 그림은 Web Worker에서 같은 `rasterizeWarped`로 만들어 바꾼다. 화면=PNG 차이는 `warp-staged.spec`(DPR 1·2)이 채널 최대 1 이하로 확인하고, 변이 검사(워커 결과를 무시)로 이 테스트가 실패함을 확인했다.
- [x] 프로덕션 성능(3600×2700 레이어): 변형 드래그 33ms 초과 프레임 1/163, 손가락 1/205, 유동화 79/303(개발과 같음, 무거움). 이미지 조정·효과는 **놓는 순간 편집기가 멈춘다**: 색 조정 약 0.17초, 그림자 약 2.0초, 흐림 20 약 3.2초(`adjust-effects-perf.spec.ts`). 이번 범위(새 기능 금지)라 고치지 않았다. 다음 작업 후보: 같은 Worker 방식.

## 2026-10-16 원본 잠금·원본 수정 (스키마 v13)

- [x] 단위 테스트 전체와 `tsc` 통과. 바뀐 spec만 실행: `source-edit`(새, 17), `finger`, `liquify`, `brush`, `compare`, `tool-hints`, `help`, `lock-hide-rename`, `adjust` 통과. 변이 검사 5건(잠금 검사 제거, 보존본 참조 제거, 보존 그림 해제, 비교 보기가 수정본을 보임, 되돌리기가 수정본 유지)이 모두 실패로 잡힘.
- [ ] 검증 대기: 개발·프로덕션 E2E 전체(규칙상 돌리지 않음), 프로덕션 빌드의 `source-edit` spec, 큰 원본(3600×2700)에서 손가락·유동화·이미지 조정 적용 시간과 메모리(보존본 때문에 그림 한 장이 더 남음), 실제 Chrome·Firefox·Safari 창.
- [ ] 검증 대기: 원본 이미지 조정은 실시간 미리보기가 없고 "원본에 적용" 때 한 번 계산한다(큰 원본의 흐림은 수 초 걸릴 수 있음, 측정하지 않음).
## 2026-10-16 도구 막대·패널 접기·폭 조절

- [x] 단위 테스트 전체(1151)·`tsc`, `layout-panels`(새, 12), `asset-preview`(좁은 창 테스트는 패널을 직접 펴도록 고침), `start-screen`, `help`, `shortcuts`, `source-edit`, `tool-hints` 통과. 변이 검사 3건(드래그 방향, 접힌 폭, 도구 누락)이 잡힘.
- [ ] 검증 대기: 개발·프로덕션 E2E 전체(규칙상 안 돌림; 나머지 spec 중 도구 막대 선택자나 패널 폭에 기대는 것이 더 있을 수 있음), 프로덕션 빌드의 `layout-panels`, 실제 브라우저 창(Firefox·Safari)에서의 `\`·`Ctrl+\` 키.
