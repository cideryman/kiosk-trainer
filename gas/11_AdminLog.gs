function appendAdminLog(action, targetType, targetId, targetName, beforeValue, afterValue, memo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET.LOGS);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET.LOGS);
    sheet.appendRow(['timestamp', 'action', 'targetType', 'targetId', 'targetName', 'beforeValue', 'afterValue', 'memo']);
  }

  sheet.appendRow([
    new Date(),
    action,
    targetType,
    targetId,
    targetName || '',
    beforeValue,
    afterValue,
    memo || ''
  ]);
}

function safeAppendAdminLog(action, targetType, targetId, targetName, beforeValue, afterValue, memo) {
  try {
    appendAdminLog(action, targetType, targetId, targetName, beforeValue, afterValue, memo);
  } catch (error) {
    Logger.log('appendAdminLog failed: ' + (error && error.stack ? error.stack : error));
  }
}
