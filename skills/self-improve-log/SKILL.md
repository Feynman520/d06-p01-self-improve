---
name: self-improve-log
description: Manually log a self-improvement record right now. Use when the user runs /self-improve-log or says "이거 기록해", "개선점 기록", "log this improvement point".
---

# self-improve-log — 수동 즉시 기록

방금 대화에서 드러난 개선점 1건을 self-improve MCP의 `log` 도구로 기록한다. 자동 감지가 놓친 것을 사용자가 직접 지목하는 통로다.

## 절차

1. **대상 특정** — 사용자가 인자로 지목했으면 그것을, 아니면 직전 대화에서 "결과가 사용자 의도와 어긋났던 순간"을 찾는다. 못 찾으면 무엇을 기록할지 한 번만 묻는다.
2. **한 문장 테스트** — 다음에도 써먹을 교훈을 한 문장으로 쓸 수 있는가? 못 쓰면(새 요구 추가·일회성 취향 조정 등) 기록 대상이 아니라고 답하고 중단한다.
3. **분류 선택** (5종 고정): `오해` 요구를 잘못 이해 / `지식 부족` 사용자·환경 고유 사실을 몰랐음 / `도구 실패` 도구·명령 실패 / `환경 문제` 설정·경로·권한 / `반복 비효율` 같은 수작업 반복(자동화 후보)
4. **`log` 호출** — `category`, `lesson`(일반화된 한 문장, 필수), `what_happened`, `user_wanted`, `solution_candidates`, `project`(현재 작업 폴더 절대경로), `agent`(claude|codex).
5. **한 줄 알림** — `📝 개선점 기록: "<lesson>" (<category>)`.
6. **자동 적용** — 반환값에 `ripe`가 있으면 그 기록들이 같은 교훈인지 확인한 뒤 `apply_rule`로 규칙을 적용하고 `📌 규칙 자동 적용: [R-nnn] …` 한 줄을 출력한다. `existing_artifact`가 있으면 새로 만들지 말고 그 산출물을 고친다. `recurrence_of_resolved`가 있으면 더 강한 처방(스킬·스크립트)을 검토한다.
7. 사용자가 "기록하지 마"라고 하면 저장된 기록 파일을 즉시 삭제한다.
