/**
 * 시트 파괴 작업에 공통으로 사용하는 안전 보조 함수.
 * 백업 시트는 원본과 같은 스프레드시트 안에 생성한다.
 */

function cloneSheetRows_(rows) {
  return (rows || []).map(function(row) { return row.slice(); });
}

function sheetCellValuesEqual_(left, right) {
  if (left instanceof Date || right instanceof Date) {
    var leftDate = left instanceof Date ? left : new Date(left);
    var rightDate = right instanceof Date ? right : new Date(right);
    return !isNaN(leftDate.getTime()) && !isNaN(rightDate.getTime())
      && leftDate.getTime() === rightDate.getTime();
  }
  if (typeof left === 'number' && typeof right === 'number' && isNaN(left) && isNaN(right)) {
    return true;
  }
  return left === right;
}

function sheetRowValuesEqual_(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  for (var i = 0; i < left.length; i++) {
    if (!sheetCellValuesEqual_(left[i], right[i])) return false;
  }
  return true;
}

function sheetMatrixValuesEqual_(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  for (var i = 0; i < left.length; i++) {
    if (!sheetRowValuesEqual_(left[i], right[i])) return false;
  }
  return true;
}

function createUniqueSheetBackup_(spreadsheet, sourceSheet, namePrefix) {
  var timeKey = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  var baseName = String(namePrefix || sourceSheet.getName() + '_자동백업') + '_' + timeKey;
  var backupName = baseName;
  var suffix = 2;
  while (spreadsheet.getSheetByName(backupName)) {
    backupName = baseName + '_' + suffix;
    suffix += 1;
  }
  var backupSheet = sourceSheet.copyTo(spreadsheet).setName(backupName);
  return { sheet: backupSheet, name: backupName };
}

function ensureSheetGridSize_(sheet, rowCount, columnCount) {
  if (sheet.getMaxRows() < rowCount) {
    sheet.insertRowsAfter(sheet.getMaxRows(), rowCount - sheet.getMaxRows());
  }
  if (sheet.getMaxColumns() < columnCount) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), columnCount - sheet.getMaxColumns());
  }
}

function restoreSheetFromBackup_(targetSheet, backupSheet) {
  var backupRange = backupSheet.getDataRange();
  var rowCount = Math.max(backupRange.getNumRows(), 1);
  var columnCount = Math.max(backupRange.getNumColumns(), 1);
  ensureSheetGridSize_(targetSheet, rowCount, columnCount);
  targetSheet.clear();
  backupRange.copyTo(targetSheet.getRange(1, 1, rowCount, columnCount));
  if (typeof backupSheet.getFrozenRows === 'function' && typeof targetSheet.setFrozenRows === 'function') {
    targetSheet.setFrozenRows(backupSheet.getFrozenRows());
  }
  if (typeof backupSheet.getFrozenColumns === 'function' && typeof targetSheet.setFrozenColumns === 'function') {
    targetSheet.setFrozenColumns(backupSheet.getFrozenColumns());
  }
  SpreadsheetApp.flush();
  var restored = targetSheet.getRange(1, 1, rowCount, columnCount).getValues();
  var expected = backupRange.getValues();
  if (!sheetMatrixValuesEqual_(restored, expected)) {
    throw new Error('백업 복원 후 데이터 검증에 실패했습니다.');
  }
}

function verifyExactSheetValues_(sheet, expectedValues) {
  var values = expectedValues || [];
  if (values.length === 0) return sheet.getLastRow() === 0;
  var columnCount = values[0].length;
  var actual = sheet.getRange(1, 1, values.length, columnCount).getValues();
  return sheet.getLastRow() === values.length && sheetMatrixValuesEqual_(actual, values);
}

function collectChangedRowGroups_(beforeRows, afterRows) {
  if (!Array.isArray(beforeRows) || !Array.isArray(afterRows) || beforeRows.length !== afterRows.length) {
    throw new Error('변경 전후 행 수가 일치하지 않습니다.');
  }
  var changedIndexes = [];
  for (var i = 0; i < beforeRows.length; i++) {
    if (!sheetRowValuesEqual_(beforeRows[i], afterRows[i])) changedIndexes.push(i);
  }
  var groups = [];
  changedIndexes.forEach(function(index) {
    var last = groups.length ? groups[groups.length - 1] : null;
    if (last && index === last.end + 1) {
      last.end = index;
    } else {
      groups.push({ start: index, end: index });
    }
  });
  return groups;
}

function writeChangedSheetRows_(sheet, beforeRows, afterRows, firstDataRow, columnCount) {
  var groups = collectChangedRowGroups_(beforeRows, afterRows);
  groups.forEach(function(group) {
    var values = afterRows.slice(group.start, group.end + 1).map(function(row) {
      return row.slice(0, columnCount);
    });
    sheet.getRange(firstDataRow + group.start, 1, values.length, columnCount).setValues(values);
  });
  SpreadsheetApp.flush();
  return {
    changedRows: groups.reduce(function(total, group) { return total + group.end - group.start + 1; }, 0),
    groups: groups
  };
}

function deleteSheetQuietly_(spreadsheet, sheet) {
  if (!sheet) return true;
  try {
    spreadsheet.deleteSheet(sheet);
    return true;
  } catch (error) {
    return false;
  }
}
