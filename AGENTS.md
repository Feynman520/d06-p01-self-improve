---
id: iris:6vm170gg
type: project
code: P01
status_scheme: task5
lifecycle: active
scope_boundary: [git, mcp, settings]
free_zone: true
frozen: true
tags:
- {kind: 소프트웨어/산출물 종류, value: Plugin}
relations:
  canonical: ['iris:t1qy9qdb/AGENTS.md']
created: '2026-09-04'
---
# P01-자기개선(Self-Improve) 〖Plugin〗

에이전트 중립(클로드코드·코덱스) 자기개선 루프 개발 프로젝트 — MCP 서버 + CLI + 수동 기록 스킬 1개. 설계 문서 = `docs/superpowers/specs/`(v1) · `docs/superpowers/plans/2026-09-07-self-improve-v2.md`(v2). 대상 사용자: 강의 수강 교사 + 개발자 본인(IRIS).

- 운영 인스턴스: 저장소 `C:\IRIS\_self-improvement`(`SELF_IMPROVE_DIR`), 루트 관리 구역 = `C:\IRIS\AGENTS.md`, 코덱스 등록 = `C:\IRIS\_agent\codex\config.toml`, 야간 채굴 = 작업 스케줄러 "self-improve nightly" 03:30. 클로드코드는 이 폴더를 디렉터리 마켓플레이스로 설치해 코드 수정이 즉시 반영된다.
- 텔레메트리는 v2에서 완전히 제거됐다(2026-09-07). 다시 넣지 않는다.
- 테스트: `node --test` (의존성 0, Node ≥18).

<!-- 상위(루트/R07/D06) AGENTS.md 규칙 재서술 금지 -->


> 상위 지침 로드(독립 git 저장소): 정본 = R07 AGENTS.md 〈독립 git 저장소 P의 상위 지침 로드〉(2026-09-04 Q8).
