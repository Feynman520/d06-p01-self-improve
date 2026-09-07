const STOP = new Set([
  'the', 'a', 'an', 'to', 'of', 'in', 'is', 'are', 'and', 'or', 'for', 'on', 'with', 'when', 'not', 'it', 'that', 'this',
  '것은', '것이', '경우', '하는', '한다', '했다', '된다', '해야', '때는', '그리고', '또는', '있는', '없는', '않는다', '않고',
  '위해', '통해', '대해', '반드시', '항상', '먼저', '뒤에', '전에', '그대로', '함께', '같은', '다른', '이후', '이전',
]);

export function tokenize(text) {
  return [...new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 2 && !STOP.has(t)),
  )];
}

// Korean particles/endings ('문서' vs '문서는') are absorbed by prefix matching.
const matches = (a, b) => a === b || (a.length >= 2 && b.length >= 2 && (a.startsWith(b) || b.startsWith(a)));

function overlapCount(ta, tb) {
  return ta.filter((x) => tb.some((y) => matches(x, y))).length;
}

// Loose linking — informational `related` list (unchanged from v1).
export function findRelated(records, { lesson, category }, max = 3) {
  const t = tokenize(lesson);
  return records
    .map((r) => {
      const rt = tokenize(`${r.sections?.lesson || ''} ${r.sections?.happened || ''}`);
      const overlap = overlapCount(t, rt);
      return { id: r.id, score: overlap + (r.category === category ? 1 : 0), overlap };
    })
    .filter((x) => x.overlap >= 2 && x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.id);
}

// "Same lesson" test used for ripeness — lesson text only, both directions.
// Tuned on 139 real Korean records (2026-09): true repeats sit at overlap 6–17 / ratio 0.30–0.71,
// unrelated pairs almost always below overlap 3 / ratio 0.2. Borderline pairs are confirmed by the model.
export const STRICT = { minOverlap: 5, minRatio: 0.3 };
export function similarity(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.length || !tb.length) return { overlap: 0, ratio: 0 };
  const overlap = Math.min(overlapCount(ta, tb), overlapCount(tb, ta));
  return { overlap, ratio: overlap / Math.min(ta.length, tb.length) };
}
export function isSameLesson(a, b, opts = STRICT) {
  const s = similarity(a, b);
  return s.overlap >= opts.minOverlap && s.ratio >= opts.minRatio;
}

const lessonOf = (r) => r.sections?.lesson || '';

// Records whose lesson matches `lesson`. Category is deliberately ignored: the same lesson is
// often filed under 도구 실패 one day and 환경 문제 the next.
export function findCluster(records, { lesson }, opts = STRICT) {
  return records
    .filter((r) => isSameLesson(lesson, lessonOf(r), opts))
    .map((r) => r.id);
}

// Greedy clustering of many records: each record joins the first cluster whose seed matches.
export function clusterRecords(records, opts = STRICT) {
  const clusters = [];
  for (const r of records) {
    const hit = clusters.find((c) => isSameLesson(c.seed, lessonOf(r), opts));
    if (hit) hit.ids.push(r.id);
    else clusters.push({ category: r.category, seed: lessonOf(r), ids: [r.id] });
  }
  return clusters;
}
