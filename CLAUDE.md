# database.bin

RisuAI Plugin API v3.0 기반 플러그인.
서버에 전송되는 database.bin 용량을 추산한다. 접근 가능한 화이트리스트 데이터로 RisuSave 블록 포맷을 시뮬레이션하여 근사치를 제공한다.

## 빌드

```bash
npm run build     # esbuild(TS→JS 번들) + terser(minify)
npx tsc --noEmit  # 타입 체크만
```

산출물: `plugin.min.js` (배포용), `plugin.js` (중간 산출물, .gitignore)

## 릴리즈

```bash
./release.sh              # patch (0.2.0 → 0.2.1)
./release.sh minor        # minor (0.2.1 → 0.3.0)
./release.sh major        # major (0.3.0 → 1.0.0)
./release.sh patch "노트"  # 릴리즈 노트 지정
```

스크립트가 버전 범프 → 빌드 → 커밋 → 태그 → push → GitHub Release 생성을 일괄 처리한다.
`plugin.min.js`의 `@version`은 빌드 시 `package.json`에서 읽으므로, 버전은 `package.json`에서만 관리한다.
**`npm run build` 후 수동 커밋/push로 배포하지 않는다** — 버전 불일치가 발생할 수 있다.

## 코딩 규칙

### 타입 안전

- **`as`, `!` 타입 단언 금지.** 타입 가드(`instanceof`, `in`, `typeof`, 사용자 정의 가드)로 타입을 좁힌다.
- 불가피한 경우 `// @ts-expect-error` + 사유 주석으로 명시한다.
- `any`는 외부 데이터 경계(플러그인 API 응답, `db.characters[i]`)에서만 허용. 내부 로직에서는 구체적 타입을 사용한다.

### 테스트

- 기능 추가·변경 시 대응하는 테스트 코드를 **항상** 작성하거나 업데이트한다.
- 테스트 파일은 `src/__tests__/` 아래에 `*.test.ts`로 배치한다.

### 문서

- 기능이 변경될 때 `README.md`를 함께 업데이트한다.
- 설계 결정·기각 방향·제약사항이 변경되면 이 파일(CLAUDE.md)도 업데이트한다.

## 런타임 환경

- **RisuAI Plugin v3.0 iframe 샌드박스** 안에서 실행된다 (`allow-scripts`, `allow-modals`, `allow-downloads`).
- CSP: `connect-src 'none'` — 네트워크 요청 불가. `CompressionStream`(gzip)은 Web API라 사용 가능.
- `getDatabase()` 호출에 유저 권한 승인 필요. 첫 승인 후 해시 기반 캐싱.
- `showContainer('fullscreen')`이 호스트 측에서 iframe에 `z-index: 1000`을 강제 설정 — 플러그인에서 변경 불가.
- iframe 내부 `document`는 네이티브 (SafeDocument 아님). `getRootDocument()`만 SafeDocument 반환.

## 설계 우선순위

1. **P1 — 2초 규칙**: 첫 화면에서 "뭐가 큰가"가 2초 안에 보여야 한다. 상세 데이터는 접기/펼치기로 숨긴다.
2. **P2 — 테마 동기화**: RisuAI의 현재 테마 색상을 따른다. `getColorScheme()` 우선, 실패 시 프리셋 테이블 fallback.
3. **P3 — 최소 기능**: 메인 피처(용량 추산)만 제공. 부가 기능은 코드 비용 대비 가치를 따진다.

## 핵심 제약

- **화이트리스트 제한**: `getDatabase()`는 24개 키만 반환한다. API 키, 프롬프트, botPresets, 글로벌 로어북 등은 접근 불가하므로 추산에서 누락된다.
- **database.bin 직접 접근 불가**: 파일시스템, IndexedDB, 백업 API 모두 차단. 파싱된 JS 객체만 접근 가능.
- **Remote 캐릭터 미감지**: `enableRemoteSaving`이 `allowedDbKeys` 화이트리스트에 없어 직접 감지 불가. "노드 (Remote)" 탭으로 REMOTE 참조 블록 크기를 시뮬레이션하여 대응.
- **모달 z-index**: 호스트가 `z-index: 1000`을 강제하므로, 내부 CSS로 반투명 backdrop + 가운데 박스를 시뮬레이션한다.

## 백업/복원 (backup.ts)

- PNG tEXt 청크에 이중 데이터 임베딩: `chara` (표준 V2 카드, RisuAI 호환) + `risubackup` (풀 백업, 채팅 포함).
- RisuAI로 임포트하면 캐릭터 설정만 복원 (채팅 없음). 플러그인으로 복원하면 채팅까지 완전 복원.
- `CompressionStream`/`DecompressionStream`으로 gzip 압축. 미지원 브라우저는 에러.

## 기각된 방향

- **`getBackupFile()`로 실제 bin 크기 측정**: v2.1 마이그레이션 가이드에만 언급, v3 API에 미구현.
- **`getColorScheme()` 단독 의존**: 일부 RisuAI 버전에서 "API method not found" 발생. 프리셋 테이블 fallback 필수.
- **esbuild ESM 포맷**: 플러그인 코드가 `(async () => { ${userCode} })()` 안에 인라인 삽입되므로 export/import 구문이 남으면 SyntaxError. IIFE로 유지.
- **Blob 직접 다운로드 (`<a download>`)**: iframe 내부 document에서 이론상 가능하나, `allow-same-origin` 미설정 + opaque origin 환경에서 미검증. PNG 이미지 방식 채택.

## Git

- 커밋 시 `/commit-with-context`를 사용하여 의사결정 컨텍스트를 보존한다.
- 후속 작업 시 `git log`를 확인하여 기존 결정 배경과 기각된 방향을 참조한다.
- 커밋 완료 후, 릴리즈 배포 여부를 사용자에게 확인한다 (`./release.sh` 안내).
