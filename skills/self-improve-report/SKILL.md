---
name: self-improve-report
description: Periodic self-improvement report — load open records, group patterns, prescribe fixes via the prescription ladder. Use when the user runs /self-improve-report or asks "개선 보고서", "improvement report".
---

# self-improve-report — 정기 보고

open 기록 전체를 패턴으로 묶고, 처방 사다리로 재발 방지책을 제안·적용한다.

## 절차

1. **로드** — `stats` 호출(저장 위치 `storage_dir`·집계 확보) → `search`(`{status: "open"}`)로 open 기록 전체 확보. open 0건이면 "기록 없음" + 권장 주기 안내만 출력하고 끝낸다.
2. **재발 감시 (최우선)** — 각 open 기록의 `related`에 있는 id를 `search`로 확인해 그중 resolved 기록이 있으면, 보고서 **최상단**에 ⚠️ **처방 무효** 경고를 놓는다(그 기록의 `resolution` 처방이 재발을 막지 못했다는 뜻 — 더 강한 처방으로 격상 검토).
3. **패턴 묶기** — 같은 분류 + `related` 연결 + 교훈 유사성으로 기록을 그룹화한다. 예: "한글 변환 실패 3회, 전부 표 포함 문서".
4. **처방 사다리** — 각 패턴마다 반드시 가벼운 칸부터 검토하고, 더 무거운 칸은 가벼운 칸이 왜 부족한지 근거가 있을 때만 올라간다:
   ① CLAUDE.md 규칙 몇 줄 → ② 스킬 제작 → ③ 스크립트/외부 라이브러리 → ④ MCP 도입·제작
   CLAUDE.md 처방이면 어느 레벨(폴더)의 CLAUDE.md에 넣을지 적절한 스코프 위치를 근거와 함께 제시한다(그 규칙이 적용돼야 하는 가장 좁은 범위를 고른다).
5. **보고서 출력 + 저장** — 처방마다 근거(기록 n건·id 목록), 처방 내용, 예상 효과, 적용 비용을 적고 **효과 대비 비용 순으로 정렬**한다. `stats`의 `by_month`에 기록 0건인 달(공백 기간)이 있으면 "감지 누락 가능성"으로 표시한다. 같은 내용을 `<storage_dir>/reports/YYYY-MM-DD-보고.md` 파일로 저장한다.
6. **승인 → 적용 → 일괄 resolve** — 사용자가 승인한 처방을 적용한 뒤, 해당 패턴의 기록 id들을 `resolve`(`ids`, `resolution`, `prescription_type`)로 일괄 처리한다.
7. **말미 안내** — "권장: 기록 10건 이상 또는 2~4주마다 이 보고를 실행하세요."
