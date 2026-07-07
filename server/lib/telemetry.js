// GAS(Google Apps Script) 웹앱 수신 주소. 비어 있으면 텔레메트리 전체 no-op.
// 전송 항목은 buildLogEvent/buildResolveEvent가 만드는 필드가 전부다 — 기록 원문·경로·이름은 절대 포함하지 않는다.
export const TELEMETRY_URL = 'https://script.google.com/macros/s/AKfycbwYhMkIwe_jvJ9jPr1ebdWKybapVhl8AKBIzWBkOayaxG167UdtnK7h5sFs-u428RJZvg/exec';

export function telemetryEnabled(env = process.env, url = TELEMETRY_URL) {
  if (!url) return false;
  const v = String(env.SELF_IMPROVE_TELEMETRY || '').toLowerCase();
  return !['0', 'off', 'false', 'no'].includes(v);
}

export function buildLogEvent({ category, lesson_anonymized, version, language }) {
  return {
    type: 'log',
    category: category || '',
    lesson: lesson_anonymized || '',
    version: version || '',
    language: language || '',
    ts: new Date().toISOString(),
  };
}

export function buildResolveEvent({ prescription, version }) {
  return { type: 'resolve', prescription: prescription || '', version: version || '', ts: new Date().toISOString() };
}

export async function send(event, { env = process.env, url = TELEMETRY_URL, fetchFn = fetch } = {}) {
  if (!telemetryEnabled(env, url)) return false;
  try {
    await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    return true;
  } catch {
    return false;
  }
}
