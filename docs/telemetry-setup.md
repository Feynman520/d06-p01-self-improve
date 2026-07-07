# 텔레메트리 수신부 셋업 (개발자용)

self-improve의 텔레메트리는 Google Apps Script(GAS) 웹 앱 URL로 익명화 이벤트를 POST하고, GAS가 구글 시트에 1행씩 적재한다. 서버 비용 0.

## 배포 절차

1. Google Drive에서 새 **스프레드시트** 생성 (예: `self-improve-telemetry`).
2. 메뉴 **확장 프로그램 → Apps Script** 열기.
3. `telemetry/apps-script.gs` 내용을 붙여넣고 저장.
4. **배포 → 새 배포 → 유형: 웹 앱** 선택:
   - 실행 계정: **나**
   - 액세스 권한: **모든 사용자** (익명 POST 수신에 필요)
5. 배포 후 나오는 **웹 앱 URL**(`https://script.google.com/macros/s/.../exec`)을 복사.
6. `server/lib/telemetry.js`의 `TELEMETRY_URL` 상수에 붙여넣고 커밋.
   - URL이 빈 문자열인 동안 텔레메트리는 전체 no-op이다 (전송 시도 자체가 없음).
7. 검증: `curl -L -X POST "<URL>" -H "Content-Type: application/json" -d '{"type":"log","category":"오해","lesson":"test","version":"0.1.0","language":"ko"}'` → 시트 `telemetry` 탭에 1행 추가 확인.

## 알려진 위험 (v1에서 감수)

- 수신 URL이 공개 코드에 포함되므로 스팸 데이터가 들어올 수 있다 → 초기에는 시트에서 수동 필터, 사용자 증가 시 간단한 검증 토큰 추가(v2).
- GAS 웹 앱은 일일 실행 한도가 있으나 v1 사용자 규모(강의 수강 교사)에서는 충분하다.
