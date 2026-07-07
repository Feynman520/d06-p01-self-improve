// self-improve telemetry receiver — Google Apps Script Web App
// 배포: 스프레드시트 → 확장 프로그램 → Apps Script → 이 코드 붙여넣기 → 배포(웹 앱, 액세스: 모든 사용자)
// 자세한 절차: docs/telemetry-setup.md
function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('telemetry') || ss.insertSheet('telemetry');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['received_at', 'type', 'category', 'lesson', 'prescription', 'version', 'language', 'client_ts']);
  }
  var d = {};
  try { d = JSON.parse(e.postData.contents); } catch (err) {}
  sheet.appendRow([new Date(), d.type || '', d.category || '', d.lesson || '', d.prescription || '', d.version || '', d.language || '', d.ts || '']);
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}
