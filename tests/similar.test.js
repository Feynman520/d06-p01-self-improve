import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, findRelated } from '../server/lib/similar.js';

const rec = (id, lesson, category = '도구 실패') => ({ id, category, sections: { lesson, happened: '' } });

test('tokenize: 한국어/영어 토큰, 2자 미만·불용어 제거, 중복 제거', () => {
  const t = tokenize('표 포함 HWP 문서는 변환 실패한다 변환');
  assert.ok(t.includes('변환'));
  assert.ok(t.includes('hwp'));
  assert.equal(t.filter((x) => x === '변환').length, 1);
});

test('findRelated: 유사 기록만 연결, 무관 기록 제외', () => {
  const records = [
    rec('a', '표 포함 문서는 한글 변환이 실패한다'),
    rec('b', '급식 메뉴 조회는 나이스 API를 쓴다', '지식 부족'),
  ];
  const out = findRelated(records, { lesson: '표 있는 문서 한글 변환 실패 시 우회 필요', category: '도구 실패' });
  assert.deepEqual(out, ['a']);
});

test('findRelated: 빈 저장소면 빈 배열', () => {
  assert.deepEqual(findRelated([], { lesson: '아무거나', category: '오해' }), []);
});
