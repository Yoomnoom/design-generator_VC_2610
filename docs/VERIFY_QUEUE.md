# 검증 대기 목록

낮에는 이 PC의 메모리가 부족해 전체 E2E·프로덕션 E2E·반복 실행을 돌리지 않는다. 돌리지 못한 검증을 여기에 쌓고, 밤(또는 메모리가 여유로울 때)에 순서대로 돌린 뒤 결과를 적고 줄을 지운다.

규칙: spec 파일 단위(`npx playwright test tests/e2e/<파일>`), workers=1, 브라우저 하나, 개발 서버는 켜 두지 않는다(Playwright가 띄우고 끈다).

| 기능 | 커밋 | 돌려야 할 검증 | 돌리지 않은 이유 |
|---|---|---|---|
| A 붙여넣기·드롭 레이어 | 5fbbd45 | 개발 E2E 전체(spec 단위), 프로덕션 E2E 전체. 개별 통과: `paste`, `paste-layer`, `shortcuts` | 전체 실행 중 메모리 부족으로 시스템이 중단 |
| B 레이어 변형 | 696c0e9 | 개발·프로덕션 E2E 전체, 프로덕션에서 `PW_PERF=1` `warp-perf.spec.ts`(개발 서버 측정만 있음: 변형 드래그 중 33ms 초과 프레임 24~56/200) | 위와 같음 |
| C 손가락 도구 | a88f81b | 개발·프로덕션 E2E 전체, 프로덕션에서 `PW_PERF=1` `finger-perf.spec.ts` | 위와 같음 |
| 간헐 실패 | - | `npx playwright test tests/e2e/brush.spec.ts --repeat-each=30` 로 원인 확인; `shortcuts.spec.ts` "클립보드 쓰기 거부" 케이스도 반복 | 낮 규칙: 반복 실행 금지 |
| 개발 E2E 남은 spec | - | 마지막 전체 실행은 `app`(34)·`autosave`(21)·`brush`(19)까지 통과 후 중단. 나머지 spec은 개별 통과 외 합산 미확인 | 메모리 부족 |
| D 에셋 라이브러리·템플릿 | 검증 대기(아래 커밋) | 개발 E2E 전체: 특히 왼쪽 패널이 바뀌었으므로 `app`, `panels`, `handoff-9steps`, `autosave`, `compare`, `shortcuts`; 프로덕션 E2E 전체. 통과: `assets.spec.ts` 6개(개발) | 낮 규칙 |