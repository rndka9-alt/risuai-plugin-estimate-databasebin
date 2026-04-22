# database.bin

RisuAI 플러그인. 서버에 전송되는 `database.bin` 용량을 추산합니다.

## 기능

- RisuSave 블록 포맷(Config / Root / Characters / Modules)을 시뮬레이션하여 원본·gzip 크기 계산
- 블록별 비중을 누적 바 차트로 시각화
- Root 키·캐릭터별 Top 5 용량 표시
- 환경별(노드/노드 Remote/웹/로컬) 토글로 기준 전환 — 열 때 현재 환경 자동 선택
- `enableRemoteSaving` 적용 시 database.bin 크기 변화를 "노드 (Remote)" 탭으로 확인 가능
- RisuAI 테마 색상 자동 적용

## 설치

1. [Releases](https://github.com/rndka9-alt/risuai-plugin-estimate-databasebin/releases/latest)에서 `plugin.min.js` 다운로드
2. RisuAI 설정 → 플러그인 → 플러그인 추가 → 코드 붙여넣기
3. Settings 페이지에 "database.bin" 항목 생성됨

## 제한사항

- 플러그인 API 화이트리스트(24개 키)만 접근 가능. API 키, 프롬프트, botPresets, 글로벌 로어북 등은 추산에 미포함.
- `enableRemoteSaving` 상태는 플러그인 API 화이트리스트에 없어 직접 감지 불가. "노드 (Remote)" 탭으로 수동 전환하여 확인.
- 에셋(이미지 등)은 별도 저장되므로 추산에 미포함.

## 릴리즈

```bash
./release.sh minor "릴리즈 노트"
```

자세한 사용법은 `CLAUDE.md` 참고.

## 요구사항

- RisuAI Plugin API v3.0
- `CompressionStream` 지원 브라우저 (gzip 계산용)
