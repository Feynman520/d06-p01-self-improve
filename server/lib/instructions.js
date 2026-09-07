// One text, two homes: the root AGENTS.md managed block (read by every agent) and the MCP
// `instructions` field (Claude Code). Keep it short — it is loaded into every session.
export const INSTRUCTIONS = `### 자기개선(self-improve) 지시문
1. **세션 시작** — self-improve \`pending\`을 한 번 호출한다. 돌아온 익은 패턴·채굴 후보(최대 3건)는 **사용자의 첫 요청을 끝낸 직후** 처리한다. 사용자 요청보다 먼저 하지 않는다.
2. **기록** — 사용자 요청을 끝낸 직후 다음 순간이 있었으면 \`log\`를 호출한다: ① 결과를 정정·재요청 ② "앞으로는 …" 규칙 선언 ③ 도구·명령 실패 후 우회 ④ 같은 수작업 반복. 재사용 교훈을 한 문장으로 못 쓰면 기록하지 않는다(새 요구·일회성 취향 제외). 기록 후 한 줄만 출력: \`📝 개선점 기록: "<교훈>" (<분류>)\`. 사용자가 반대하면 기록을 삭제한다.
3. **자동 적용** — \`log\`가 \`ripe\`를 돌려주면 그 기록들이 정말 같은 교훈인지 확인한 뒤 \`apply_rule\`로 규칙을 적용하고 한 줄 알림(도구·셸·OS처럼 환경 전반의 교훈이면 \`level\`을 작업공간 루트로 지정하고, 특정 프로젝트 고유 교훈이면 \`suggested_level\`을 따른다): \`📌 규칙 자동 적용: [R-nnn] <규칙> (되돌리기: "규칙 R-nnn 빼")\`. \`ripe.existing_artifact\`가 있으면 새로 만들지 말고 그 산출물을 고친 뒤 \`feedback\`(correction)을 보낸다. \`recurrence_of_resolved\`가 있으면 그 처방이 실패한 것이므로 한 단계 강한 처방(규칙→스킬→스크립트)을 검토한다.
4. **스킬·스크립트** — 같은 절차형 교훈이 3회 이상이면 \`<저장소>/skills/<이름>/SKILL.md\`를 써서 \`register_artifact\`한다. 반복 수작업이면 \`<저장소>/scripts/\`에 가드(\`_guard.mjs\`·\`_guard.py\`)를 쓰는 스크립트를 만들어 스크래치 폴더에서 자체 시험한 뒤 \`register_artifact\`한다. 신뢰 승격 전 스크립트는 미리보기가 기본이며 실제 실행은 \`--apply\`를 붙여 결과를 사용자에게 보인다. **시크릿·권한·배포·삭제·과금을 다루는 일은 자동 산출물에 넣지 않는다.**
5. **사용 표시·피드백** — 자동 산출물을 쓸 때 한 줄 표시: \`🔧 자동 <스킬|스크립트> <이름> 사용\`. 결과가 좋았으면 \`feedback\` success, 사용자가 지적하면 \`feedback\` correction 후 그 산출물을 고친다.
6. **되돌리기** — 사용자가 "규칙 R-nnn 빼", "그 스킬 빼"라고 하면 \`revoke\`를 호출한다.`;

export const MCP_INSTRUCTIONS = `self-improve is active (agent-neutral self-improvement loop).\n\n${INSTRUCTIONS}`;
