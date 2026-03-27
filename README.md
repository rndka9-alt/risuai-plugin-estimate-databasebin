# DB Size Estimator

RisuAI 플러그인. 서버에 전송되는 `database.bin` 용량을 추산합니다.

## 기능

- RisuSave 블록 포맷(Config / Root / Characters / Modules)을 시뮬레이션하여 원본·gzip 크기 계산
- 블록별 비중을 누적 바 차트로 시각화
- Root 키·캐릭터별 Top 5 용량 표시
- 환경(Node/Web/Tauri)에 따른 전송 크기 안내
- RisuAI 테마 색상 자동 적용

## 설치

1. RisuAI 설정 → 플러그인
2. 플러그인 추가 → `plugin.js` 코드 붙여넣기
3. Settings 페이지에 "DB Size Estimator" 항목 생성됨

## 제한사항

- 플러그인 API 화이트리스트(24개 키)만 접근 가능. API 키, 프롬프트, botPresets, 글로벌 로어북 등은 추산에 미포함.
- Remote 캐릭터(별도 파일 분리 저장)는 감지 불가하여 실제보다 크게 추산될 수 있음.
- 에셋(이미지 등)은 별도 저장되므로 추산에 미포함.

## 요구사항

- RisuAI Plugin API v3.0
- `CompressionStream` 지원 브라우저 (gzip 계산용)
