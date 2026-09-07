# self-improve v2 — 자동 적용 · 에이전트 중립 (2026-09-07)

## 왜 v2인가 (v1 두 달 실측, 2026-07-07 ~ 09-06)

- 기록 139건(하루 2.3건), 처방 적용 15건(10.8%), 정기 보고서 실행 0회.
- 같은 교훈 반복 기록 약 37건(27%), 반복 덩어리 중 해결 0건 → "기록은 되나 적용이 안 된다".
- 텔레메트리 190행은 전부 개발자 본인 기기. 익명화 실패 1행·빈 교훈 3행 → 보안·불필요로 **완전 삭제**.
- 코덱스에는 MCP 미등록 상태였음(코덱스 세션 1,200개 미수집).

## 설계 원칙

1. 사람이 잊어도 적용이 돌아간다: **2회 재발 시 자동 적용**(오해 분류는 3회).
2. 안전장치 4종: 관리 구역 격리(사람 글 무접촉) · 되돌리기 한 마디 · 처방 대장(수정 우선·신설 금지) · 스크립트 가드(미리보기 기본).
3. 에이전트 중립: 훅 없이 동작. 지시문은 루트 AGENTS.md 관리 구역, 채굴은 야간 예약 작업, 세션 연결은 시각·폴더 사후 매칭.
4. 시크릿·권한·배포·삭제·과금은 절대 자동화하지 않는다.

## 조각별 구현

| 조각 | 구현 |
|---|---|
| ⓪ 정리 | telemetry.js·apps-script.gs·telemetry 문서·테스트·report 스킬 삭제, `lesson_anonymized`/`language` 제거, GAS 스크립트·시트 휴지통 이동, 0.2.0 |
| ① 재발 감지 | `similar.js` `isSameLesson`(overlap≥5, ratio≥0.3, 양방향, 분류 무시 — 실데이터로 조정), `log` → `ripe` / `recurrence_of_resolved`, `rejected` 상태 |
| ② 관리 규칙 구역 | `managed.js` 표식 구역(사람 글 보존, CRLF 유지, 상한 30), `paths.js` 공통 조상·별칭·root 제한, `withLock` mkdir 잠금, `revoke` |
| ③ 처방 대장 | `registry.json` (A-nnn/R-nnn, records, version, trust, history), `findCoveringArtifact` → `already covered` 오류로 신설 차단 |
| ④ 자동 스킬·스크립트 | `skills.js` 중앙 원본 → 에이전트별 `si-<name>` 복사, `_guard.mjs`/`_guard.py` (미리보기 기본, `--apply`, `.trusted` 마커), 성공 3회 승격·지적 2회(성공 0) 퇴역 |
| ⑤ 세션 밖 순환 | `pending` 도구(익은 패턴·격상·후보 ≤3·퇴역 제안), `cli.js nightly` + Windows 작업 스케줄러 03:30 |
| ⑥ 저장소 안전 | `createRecord` wx 원자 생성, 교훈 길이 게이트(10–600), `stats`에 재발률·산출물 수·config 오류 |
| ⑦ 세션 채굴 | `mine.js` 클로드·코덱스 파서, 정정 문구·도구 오류·3-gram 반복(≥5세션, 대기열 최대 5), 시각·cwd 매칭 `linkSessions`, 대기열 50 |
| ⑧ 감독 초회 | `cli.js backfill` dry-run 제안서 → 사용자 입회하에 `--apply` |
| ⑨ 양쪽 설치 | `cli.js install --root --codex --schedule`: 루트 관리 구역 + 지시문, codex config.toml, 가드 설치, 예약 등록 |

## 실측 (2026-09-07)

- 테스트 30/30.
- 유사도 재조정 후 익은 패턴 6 → 12개.
- 채굴: 30일치 3,096파일(클로드+코덱스) 66초, 정정·오류 후보 658 + 반복 루프 579 → 대기열 50(루프 ≤5).

## 보류 (v2.1)

칭찬(성공 패턴) 기록, 정정 문구 사전 학습, 클로드코드 전용 훅(즉시 채굴·세션 id 즉시 기입).
