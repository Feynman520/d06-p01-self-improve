# self-improve

**English: [README.md](README.md)**

코딩 에이전트(클로드코드·코덱스)를 위한 **에이전트 중립 자기개선 루프**. 에이전트와 함께 일할수록 에이전트가 사용자에게 맞춰집니다. 사용자가 결과를 고친 순간을 기록하고, 같은 교훈이 다시 나타나면 **자동으로 적용**합니다 — 지시 파일의 규칙 한 줄, 스킬, 또는 가드가 달린 스크립트로. 한 줄 알림이 뜨고, 한 마디로 되돌릴 수 있습니다.

모든 데이터는 사용자 PC에만 있습니다. 텔레메트리는 없습니다.

## 어떻게 돌아가나

```text
① 기록   — 에이전트가 정정 순간을 기록한다 (또는 야간 채굴기가 세션 기록에서 찾아낸다)
      ↓
② 감지   — 서버가 같은 교훈의 재발을 알아챈다 (2회째; 오해·취향 교훈은 3회째)
      ↓
③ 적용   — 해당 프로젝트들을 모두 덮는 가장 좁은 AGENTS.md/CLAUDE.md의 관리 구역에 규칙 한 줄을 쓴다
      ↓
④ 성장   — 절차형 교훈은 스킬로(모든 에이전트에 동기화), 반복 수작업은 가드 스크립트로
      ↓
⑤ 학습   — 쓸 때마다 성공/지적을 보고; 스크립트는 신뢰를 얻고, 나쁜 산출물은 퇴역하며, "R-003 빼"로 무엇이든 되돌린다
```

| 요소 | 방식 |
|---|---|
| 기록 | 교훈 1건 = 마크다운 1파일, `SELF_IMPROVE_DIR/records/` (기본 = 현재 폴더의 `.self-improve/`) |
| 익음 판정 | 실제 한국어·영어 교훈으로 조정한 단어 겹침 유사도. 적용 전 모델이 "같은 교훈인가"를 확인 |
| 규칙 | AGENTS.md(또는 CLAUDE.md)의 `<!-- self-improve:begin … end -->` 구역 안에만 씀. 사람 글은 건드리지 않음. 파일당 상한·잠금 |
| 레벨 | 지시 파일이 이미 있는 가장 좁은 공통 조상 폴더. `root` 위로는 올라가지 않음 |
| 스킬 | `SELF_IMPROVE_DIR/skills/<이름>/SKILL.md`에 원본, 각 에이전트 스킬 폴더에 `si-<이름>`으로 복사 |
| 스크립트 | `SELF_IMPROVE_DIR/scripts/`, 반드시 `_guard.mjs`/`_guard.py` 사용: 기본 미리보기, `--apply`로 실행, 성공 3회면 자동 신뢰 |
| 처방 대장 | `registry.json`이 산출물 ↔ 기록 ↔ 버전 ↔ 신뢰를 관리. 같은 교훈은 새로 만들지 않고 기존 산출물을 고침 |
| 채굴 | `cli.js nightly`가 클로드(`projects/*.jsonl`)·코덱스(`sessions/**/rollout-*.jsonl`) 세션 기록에서 사용자 정정·도구 오류·반복 도구 순서를 찾아 후보 대기열에 넣음 |
| 자동화 금지 | 시크릿·권한·배포·삭제·과금 — 지시문이 자동 산출물에 넣지 못하게 함 |

## MCP 도구

| 도구 | 용도 |
|---|---|
| `log` | 기록 저장. `ripe`(재발 도달)와 `recurrence_of_resolved`(해결된 교훈 재발)를 돌려줌 |
| `pending` | 세션 시작 시 호출: 익은 패턴, 격상 대상, 채굴 후보(≤3), 퇴역 제안 |
| `apply_rule` | 관리 구역에 규칙 기입, 대장 등록, 기록 해결 |
| `register_artifact` | 스킬(에이전트들에 동기화) 또는 가드 스크립트 등록 |
| `feedback` | 산출물에 `success`/`correction` → 신뢰·승격·퇴역 |
| `revoke` | 산출물 되돌리기. 기록은 `rejected`가 되어 다시 적용되지 않음 |
| `dismiss` | 채굴 후보 버리기 |
| `search` / `stats` / `resolve` | 기록 조회, 재발률·산출물 수, 수동 해결(규칙 실재 검증) |

## 설치

```
git clone https://github.com/Feynman520/d06-p01-self-improve
cd d06-p01-self-improve
set SELF_IMPROVE_DIR=C:\중앙\저장소          # 권장 (모든 프로젝트가 한 저장소를 씀)
node server/cli.js install --root C:\작업공간 --codex --schedule
```

- `--root` 작업공간 루트 `AGENTS.md`의 관리 구역에 에이전트 지시문을 씀(없으면 `AGENTS.md` + `CLAUDE.md` 껍데기 생성). **모든 에이전트가 같은 지시문을 읽음.**
- `--codex` `$CODEX_HOME/config.toml`에 MCP 서버 등록.
- `--schedule` 야간 채굴 예약 등록(Windows 작업 스케줄러; 다른 OS는 crontab 한 줄 출력).
- 클로드코드: `/plugin marketplace add Feynman520/d06-p01-self-improve` → `/plugin install self-improve@self-improve`, 플러그인 env에 `SELF_IMPROVE_DIR` 추가.

Node.js 18 이상. 런타임 의존성 0.

## CLI

```
node server/cli.js install [--root DIR] [--codex] [--schedule]
node server/cli.js mine [--days N]      # 지금 세션 기록 채굴
node server/cli.js nightly              # 채굴 + 세션 연결 + <저장소>/logs 기록
node server/cli.js backfill [--apply]   # 첫 실행: 기존 열린 기록 군집 → 제안서 (기본 dry-run)
node server/cli.js status
```

## 설정 (`SELF_IMPROVE_DIR/config.json`)

```json
{
  "root": "C:\\작업공간",
  "path_aliases": { "C:\\옛\\작업공간": "C:\\작업공간" },
  "rule_cap": 30,
  "ripe_threshold": { "default": 2, "오해": 3 },
  "mine_days": 30,
  "candidates_per_session": 3,
  "retire_after_days": 60
}
```

## 되돌리기

에이전트에게 말하면 됩니다: `규칙 R-003 빼` / `그 스킬 빼`. 규칙 줄·스킬·스크립트가 제거되고 산출물은 퇴역, 기록은 `rejected`로 바뀝니다.

## 라이선스

MIT

## 기여

의견과 PR 안내는 [CONTRIBUTING.md](CONTRIBUTING.md)를, 보안 문제 신고는 [SECURITY.md](SECURITY.md)를 봐 주세요.
