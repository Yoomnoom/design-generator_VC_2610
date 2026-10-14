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
