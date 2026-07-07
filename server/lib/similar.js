const STOP = new Set([
  'the', 'a', 'an', 'to', 'of', 'in', 'is', 'are', 'and', 'or', 'for', 'on', 'with', 'when',
  '것은', '것이', '경우', '하는', '있는', '한다', '했다', '된다', '해야', '때는', '그리고', '또는',
]);

export function tokenize(text) {
  return [...new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 2 && !STOP.has(t)),
  )];
}

// 한국어 조사·어미 변형('문서' vs '문서는')을 접두 일치로 흡수한다.
const matches = (a, b) => a === b || a.startsWith(b) || b.startsWith(a);

export function findRelated(records, { lesson, category }, max = 3) {
  const t = tokenize(lesson);
  return records
    .map((r) => {
      const rt = tokenize(`${r.sections?.lesson || ''} ${r.sections?.happened || ''}`);
      const overlap = t.filter((x) => rt.some((y) => matches(x, y))).length;
      return { id: r.id, score: overlap + (r.category === category ? 1 : 0), overlap };
    })
    .filter((x) => x.overlap >= 2 && x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.id);
}
