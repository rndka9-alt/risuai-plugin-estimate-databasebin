# DB Size Estimator

RisuAI Plugin API v3.0 기반 플러그인.
서버에 전송되는 database.bin 용량을 추산한다. 접근 가능한 화이트리스트 데이터로 RisuSave 블록 포맷을 시뮬레이션하여 근사치를 제공한다.

## 런타임 환경

- **RisuAI Plugin v3.0 iframe 샌드박스** 안에서 실행된다 (`allow-scripts`, `allow-modals`, `allow-downloads`).
- CSP: `connect-src 'none'` — 네트워크 요청 불가. `CompressionStream`(gzip)은 Web API라 사용 가능.
- `getDatabase()` 호출에 유저 권한 승인 필요. 첫 승인 후 해시 기반 캐싱.
- `showContainer('fullscreen')`이 호스트 측에서 iframe에 `z-index: 1000`을 강제 설정 — 플러그인에서 변경 불가.

## 설계 우선순위

1. **P1 — 2초 규칙**: 첫 화면에서 "뭐가 큰가"가 2초 안에 보여야 한다. 상세 데이터는 접기/펼치기로 숨긴다.
2. **P2 — 테마 동기화**: RisuAI의 현재 테마 색상을 따른다. `getColorScheme()` 우선, 실패 시 프리셋 테이블 fallback.
3. **P3 — 최소 기능**: 메인 피처(용량 추산)만 제공. 부가 기능은 코드 비용 대비 가치를 따진다.

## 핵심 제약

- **화이트리스트 제한**: `getDatabase()`는 24개 키만 반환한다. API 키, 프롬프트, botPresets, 글로벌 로어북 등은 접근 불가하므로 추산에서 누락된다.
- **database.bin 직접 접근 불가**: 파일시스템, IndexedDB, 백업 API 모두 차단. 파싱된 JS 객체만 접근 가능.
- **Remote 캐릭터 미감지**: 별도 파일로 분리 저장된 캐릭터는 감지 불가하여 실제보다 크게 추산될 수 있다.
- **모달 z-index**: 호스트가 `z-index: 1000`을 강제하므로, 내부 CSS로 반투명 backdrop + 가운데 박스를 시뮬레이션한다.

## 기각된 방향

- **`getBackupFile()`로 실제 bin 크기 측정**: v2.1 마이그레이션 가이드에만 언급, v3 API에 미구현.
- **`getColorScheme()` 단독 의존**: d.ts 타입 정의와 v3.svelte.ts 구현체 모두 존재하나, 일부 RisuAI 버전에서 "API method not found" 발생. 프리셋 테이블 fallback 필수.
- **누락 키 하드코딩 목록**: Database 인터페이스의 ~87개 키를 정적으로 나열했으나, RisuAI 버전 변경 시 자동 반영 안 됨. 삭제함.

## Git

- 커밋 시 `/commit-with-context`를 사용하여 의사결정 컨텍스트를 보존한다.
- 후속 작업 시 `git log`를 확인하여 기존 결정 배경과 기각된 방향을 참조한다.

## 문서

- 플러그인 UI 구조, 접근 가능 데이터 범위 등이 변경되면 README.md도 함께 업데이트한다.
