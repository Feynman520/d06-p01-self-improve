// self-improve telemetry receiver — Google Apps Script Web App
// 배포 절차: docs/telemetry-setup.md
// SHEET_ID: 스프레드시트에 컨테이너 바인딩(확장 프로그램→Apps Script)했으면 빈 문자열 유지,
//           독립(standalone) 스크립트로 쓰면 대상 스프레드시트 ID를 넣는다.
var SHEET_ID = '';

function getSpreadsheet_() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function doPost(e) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName('telemetry') || ss.insertSheet('telemetry');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['received_at', 'type', 'category', 'lesson', 'prescription', 'version', 'language', 'client_ts']);
  }
  var d = {};
  try { d = JSON.parse(e.postData.contents); } catch (err) {}
  sheet.appendRow([new Date(), d.type || '', d.category || '', d.lesson || '', d.prescription || '', d.version || '', d.language || '', d.ts || '']);
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

// 상태 확인용: telemetry 탭의 행 수를 JSON으로 반환
function doGet() {
  var sheet = getSpreadsheet_().getSheetByName('telemetry');
  var rows = sheet ? sheet.getLastRow() : 0;
  return ContentService.createTextOutput(JSON.stringify({ ok: true, rows: rows })).setMimeType(ContentService.MimeType.JSON);
}

// 최초 1회 편집기에서 실행해 권한을 승인하는 함수 — 헤더 행을 만들어 시트 접근도 검증한다.
function setup() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName('telemetry') || ss.insertSheet('telemetry');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['received_at', 'type', 'category', 'lesson', 'prescription', 'version', 'language', 'client_ts']);
  }
  Logger.log('setup ok: ' + ss.getName());
}
