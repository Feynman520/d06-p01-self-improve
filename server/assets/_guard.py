"""self-improve script guard (Python). Generated scripts import this and branch on `apply`.

    from _guard import guard
    g = guard(__file__)
    if not g.apply:
        print('[미리보기] would write X')   # dry-run until trusted

Rules: dry-run by default; `--apply` forces a real run; a `<script>.trusted` marker
(written by the plugin after repeated successes) makes real runs the default; `--dry-run` always wins.
"""
import os
import sys
from types import SimpleNamespace


def guard(script_path, argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    trusted = os.path.exists(script_path + '.trusted')
    dry = '--dry-run' in argv
    forced = '--apply' in argv
    apply = (not dry) and (forced or trusted)
    args = [a for a in argv if a not in ('--dry-run', '--apply')]
    if not apply:
        why = '--dry-run 지정' if trusted else '아직 신뢰 승격 전 — 실제 실행은 --apply'
        print(f'[self-improve] 미리보기 모드 ({why})', file=sys.stderr)
    return SimpleNamespace(apply=apply, trusted=trusted, args=args)
