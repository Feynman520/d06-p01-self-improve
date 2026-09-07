import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, findRelated, isSameLesson, findCluster, clusterRecords } from '../server/lib/similar.js';

const rec = (id, lesson, category = '도구 실패') => ({ id, category, sections: { lesson, happened: '' } });

test('tokenize: 소문자·중복 제거·불용어 제거·2자 이상', () => {
  assert.deepEqual(tokenize('The HWP 변환은 the 표 표'), ['hwp', '변환은']);
});

test('findRelated: 느슨한 연결 (정보용), 최대 3건', () => {
  const recs = [rec('1', '표 포함 문서는 한글 변환이 실패한다'), rec('2', '보고서는 표로 정리한다', '오해'), rec('3', '한글 변환 실패 시 표를 먼저 제거한다')];
  assert.deepEqual(findRelated(recs, { lesson: '표 있는 문서 한글 변환 실패', category: '도구 실패' }), ['1', '3']);
});

test('isSameLesson: 같은 교훈의 다른 표현은 통과, 단어 몇 개만 겹치면 거부', () => {
  const a = '큰 파일을 한 번의 Write로 만들면 응답 스트림이 끊기므로 조각으로 나눠 append로 이어붙인다';
  const b = '대용량 산출물 파일은 한 번의 큰 Write로 생성하지 말고 작은 조각으로 나눠 append로 이어붙여 스트림 끊김을 막는다';
  const c = 'Write 도구로 만든 PowerShell 스크립트는 BOM이 없어 한글이 깨지므로 저장 직후 UTF-8 BOM을 붙인다';
  assert.equal(isSameLesson(a, b), true);
  assert.equal(isSameLesson(a, c), false);
  assert.equal(isSameLesson('', a), false);
});

test('findCluster: 분류가 달라도 같은 교훈이면 묶고, 다른 교훈은 제외', () => {
  const recs = [rec('1', '큰 파일은 조각으로 나눠 append 로 써서 스트림 끊김을 막는다'), rec('2', '큰 파일은 조각으로 나눠 append 로 써서 스트림 끊김을 막는다', '환경 문제'), rec('3', '전혀 다른 교훈이다 정말로')];
  assert.deepEqual(findCluster(recs, { lesson: '큰 파일은 조각 append 로 써서 스트림 끊김을 막는다', category: '도구 실패' }), ['1', '2']);
});

test('clusterRecords: 탐욕 군집', () => {
  const recs = [
    rec('1', '큰 파일은 조각으로 나눠 append 로 써서 스트림 끊김을 막는다'),
    rec('2', '큰 파일은 조각으로 나눠 append 로 써야 스트림 끊김이 없다'),
    rec('3', 'PowerShell 5.1 인코딩 미지정으로 한글이 깨지므로 -Encoding utf8 을 붙인다', '환경 문제'),
  ];
  const cs = clusterRecords(recs);
  assert.equal(cs.length, 2);
  assert.deepEqual(cs[0].ids, ['1', '2']);
});
