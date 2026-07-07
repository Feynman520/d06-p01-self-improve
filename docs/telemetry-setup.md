# 텔레메트리 수신부 셋업 (개발자용)

self-improve의 텔레메트리는 Google Apps Script(GAS) 웹 앱 URL로 익명화 이벤트를 POST하고, GAS가 구글 시트에 1행씩 적재한다. 서버 비용 0.

> **현재 상태: 배포 완료 (2026-07-07).** 수신 시트 `self-improve-telemetry`(sejunham@gmail.com Drive), 스크립트 `self-improve telemetry receiver`(standalone, v2), URL은 `server/lib/telemetry.js`의 `TELEMETRY_URL`에 기입됨. 아래는 재배포·이전 시 절차.

## 배포 절차 (수동 — 컨테이너 바인딩 방식)

1. Google Drive에서 새 **스프레드시트** 생성 (예: `self-improve-telemetry`).
2. 메뉴 **확장 프로그램 → Apps Script** 열기.
3. `telemetry/apps-script.gs` 내용을 붙여넣고 저장 (`SHEET_ID`는 빈 문자열 유지).
4. 함수 선택에서 **`setup` 실행** → 권한 검토 → 허용 (최초 1회 소유자 승인).
5. **배포 → 새 배포 → 유형: 웹 앱** 선택:
   - 실행 계정: **나**
   - 액세스 권한: **모든 사용자** (익명 POST 수신에 필요)
6. 웹 앱 URL(`https://script.google.com/macros/s/.../exec`)을 `server/lib/telemetry.js`의 `TELEMETRY_URL`에 기입하고 커밋.
   - URL이 빈 문자열인 동안 텔레메트리는 전체 no-op이다.
7. 검증: 브라우저로 URL 열기(GET) → `{"ok":true,"rows":N}` 확인. POST 테스트 후 rows 증가 확인.

## 배포 절차 (자동 — Apps Script REST API, standalone 방식)

clasp가 이 환경에서 실패할 때 사용한 방식. 요건: ① `script.google.com/home/usersettings`에서 Apps Script API 토글 ON, ② script 스코프 포함 OAuth 토큰.

1. `POST /v1/projects` → scriptId
2. `PUT /v1/projects/{id}/content` — `apps-script.gs`(단, `SHEET_ID`에 대상 시트 ID 기입) + manifest(`webapp: {executeAs: USER_DEPLOYING, access: ANYONE_ANONYMOUS}`)
3. `POST /v1/projects/{id}/versions` → `POST /v1/projects/{id}/deployments`
4. **주의: API 배포는 편집기의 권한 승인 단계가 생략된다** — 소유자가 편집기에서 `setup`을 1회 실행해 승인해야 익명 접근이 열린다.

## 알려진 위험 (v1에서 감수)

- 수신 URL이 공개 코드에 포함되므로 스팸 데이터가 들어올 수 있다 → 초기에는 시트에서 수동 필터, 사용자 증가 시 간단한 검증 토큰 추가(v2).
- GAS 웹 앱은 일일 실행 한도가 있으나 v1 사용자 규모(강의 수강 교사)에서는 충분하다.
