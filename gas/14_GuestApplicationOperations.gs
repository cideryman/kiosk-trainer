const GUEST_APPLICATION_OPERATION_HEADERS = [
  'operationId', 'applicationId', 'serviceWeek', 'status',
  'selectedAt', 'completedAt', 'adminMemo', 'createdAt', 'updatedAt'
];

const GUEST_APPLICATION_OPERATION_STATUS = {
  SELECTED: 'SELECTED',
  COMPLETED: 'COMPLETED',
  ON_HOLD: 'ON_HOLD',
  CANCELLED: 'CANCELLED',
};

function ensureGuestApplicationOperationsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET.GUEST_APPLICATION_OPERATIONS);
  if (!sheet) sheet = ss.insertSheet(SHEET.GUEST_APPLICATION_OPERATIONS);
  const current = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(value => String(value || '').trim())
    : [];
  const headersMatch = GUEST_APPLICATION_OPERATION_HEADERS.every((header, index) => current[index] === header);
  if (!headersMatch) {
    if (sheet.getMaxColumns() < GUEST_APPLICATION_OPERATION_HEADERS.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), GUEST_APPLICATION_OPERATION_HEADERS.length - sheet.getMaxColumns());
    }
    sheet.getRange(1, 1, 1, GUEST_APPLICATION_OPERATION_HEADERS.length).setValues([GUEST_APPLICATION_OPERATION_HEADERS]);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function setupGuestApplicationOperationsSheet() {
  const sheet = ensureGuestApplicationOperationsSheet();
  return '이용운영기록 시트 준비 완료: ' + sheet.getName() + ' / ' + GUEST_APPLICATION_OPERATION_HEADERS.length + '열';
}

function getGuestApplicationOperationTable() {
  const sheet = ensureGuestApplicationOperationsSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || GUEST_APPLICATION_OPERATION_HEADERS;
  const map = {};
  headers.forEach((header, index) => { if (header) map[String(header).trim()] = index; });
  return { sheet, headers, map, rows: values.slice(1) };
}

function guestApplicationOperationDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function guestApplicationOperationToObject(row, map) {
  const result = {};
  GUEST_APPLICATION_OPERATION_HEADERS.forEach(header => {
    result[header] = map[header] === undefined ? '' : row[map[header]];
  });
  if (result.serviceWeek instanceof Date && !isNaN(result.serviceWeek.getTime())) {
    result.serviceWeek = Utilities.formatDate(result.serviceWeek, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  } else {
    result.serviceWeek = String(result.serviceWeek || '').trim();
  }
  ['selectedAt', 'completedAt', 'createdAt', 'updatedAt'].forEach(header => {
    result[header] = guestApplicationOperationDate(result[header]);
  });
  return result;
}

function guestApplicationOperationToRow(object, headers) {
  return headers.map(header => {
    const value = object[header] === undefined ? '' : object[header];
    if (['selectedAt', 'completedAt', 'createdAt', 'updatedAt'].indexOf(header) >= 0 && value) {
      const date = new Date(value);
      return isNaN(date.getTime()) ? value : date;
    }
    return value;
  });
}

function getServiceWeekKey(value) {
  const source = value ? new Date(value) : new Date();
  if (isNaN(source.getTime())) throw new Error('운영 주차 날짜가 올바르지 않습니다.');
  const date = new Date(source.getFullYear(), source.getMonth(), source.getDate());
  const day = date.getDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - daysFromMonday);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function getApplicationOperationSettings() {
  const settings = readGuestApplicationSettings();
  return {
    mode: String(settings.guestApplicationSchedulingMode || 'MANUAL').toUpperCase() === 'AUTO' ? 'AUTO' : 'MANUAL',
    paused: String(settings.guestApplicationPaused || 'N').toUpperCase() === 'Y',
    pauseWeek: String(settings.guestApplicationPauseWeek || ''),
    pauseReason: String(settings.guestApplicationPauseReason || ''),
    capacity: getGuestApplicationCapacity(settings.guestApplicationCapacity),
  };
}

function isApplicationWeekPaused(settings, serviceWeek) {
  return settings.paused && (!settings.pauseWeek || settings.pauseWeek === serviceWeek);
}

function getGuestApplicationOperationRequestCacheKey(action, requestId) {
  const normalized = String(requestId || '').trim();
  return normalized ? 'guest-op:' + action + ':' + normalized.slice(0, 120).replace(/[^A-Za-z0-9._:-]/g, '_') : '';
}

function getCachedGuestApplicationOperationResult(action, requestId) {
  const key = getGuestApplicationOperationRequestCacheKey(action, requestId);
  if (!key) return null;
  try {
    const value = CacheService.getScriptCache().get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) { return null; }
}

function cacheGuestApplicationOperationResult(action, requestId, result) {
  const key = getGuestApplicationOperationRequestCacheKey(action, requestId);
  if (!key) return;
  try { CacheService.getScriptCache().put(key, JSON.stringify(result), 21600); } catch (error) { /* cache failure does not fail the operation */ }
}

function getGuestApplicationOperations(data) {
  const serviceWeek = getServiceWeekKey(data && data.serviceWeek);
  const table = getGuestApplicationOperationTable();
  const applicationObjects = getGuestApplicationObjects(getGuestApplicationRows(ensureGuestApplicationSheet()));
  const applicationById = {};
  applicationObjects.forEach(item => { applicationById[item.applicationId] = item; });
  const operations = table.rows
    .filter(row => String(row[table.map.applicationId] || '').trim())
    .map(row => {
      const item = guestApplicationOperationToObject(row, table.map);
      return { ...item, name: applicationById[item.applicationId]?.name || item.applicationId };
    });
  const current = operations.filter(item => item.serviceWeek === serviceWeek && item.status !== GUEST_APPLICATION_OPERATION_STATUS.CANCELLED);
  const latestCompleted = {};
  operations.filter(item => item.status === GUEST_APPLICATION_OPERATION_STATUS.COMPLETED).forEach(item => {
    if (!latestCompleted[item.applicationId] || String(item.completedAt) > String(latestCompleted[item.applicationId])) {
      latestCompleted[item.applicationId] = item.completedAt;
    }
  });
  const byApplication = {};
  current.forEach(item => {
    const previous = byApplication[item.applicationId];
    if (!previous || previous.status === GUEST_APPLICATION_OPERATION_STATUS.CANCELLED || item.status !== GUEST_APPLICATION_OPERATION_STATUS.CANCELLED) {
      byApplication[item.applicationId] = item;
    }
  });
  const candidates = applicationObjects
    .filter(item => item.status === GUEST_APPLICATION_STATUS.APPROVED)
    .map(item => ({
      applicationId: item.applicationId,
      name: item.name,
      preferredDays: item.preferredDays,
      currentServiceStatus: byApplication[item.applicationId]?.status || '',
      lastCompletedAt: latestCompleted[item.applicationId] || '',
    }))
    .sort((a, b) => String(a.lastCompletedAt || '').localeCompare(String(b.lastCompletedAt || '')) || String(a.applicationId).localeCompare(String(b.applicationId)));
  return {
    success: true,
    serviceWeek,
    settings: getApplicationOperationSettings(),
    operations: current,
    byApplication,
    lastCompletedAt: latestCompleted,
    candidates,
  };
}

function createGuestApplicationOperationId(serviceWeek, sequence) {
  return 'OPS-' + serviceWeek.replace(/-/g, '') + '-' + String(sequence).padStart(3, '0');
}

function assignGuestApplicationsToWeek(data) {
  const ids = Array.isArray(data && data.applicationIds)
    ? [...new Set(data.applicationIds.map(String).map(value => value.trim()).filter(Boolean))]
    : [];
  if (!ids.length) return { success: false, message: '이번 주 운영 대상자를 하나 이상 선택해 주세요.' };
  const serviceWeek = getServiceWeekKey(data && data.serviceWeek);
  const requestId = String((data && data.requestId) || '').trim();
  const cachedResult = getCachedGuestApplicationOperationResult('assign', requestId);
  if (cachedResult) return cachedResult;
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const scheduling = getApplicationOperationSettings();
    if (isApplicationWeekPaused(scheduling, serviceWeek)) return { success: false, message: '이번 주 운영이 중단되어 대상자를 확정할 수 없습니다.' };
    const table = getGuestApplicationRows(ensureGuestApplicationSheet());
    const applications = getGuestApplicationObjects(table);
    const selected = ids.map(id => applications.find(item => item.applicationId === id)).filter(Boolean);
    if (selected.length !== ids.length) return { success: false, message: '선택한 신청자 중 일부를 찾을 수 없습니다.' };
    if (selected.some(item => item.status !== GUEST_APPLICATION_STATUS.APPROVED)) {
      return { success: false, message: '승인된 신청자만 이번 주 운영 대상으로 선택할 수 있습니다.' };
    }
    const operationTable = getGuestApplicationOperationTable();
    const existing = operationTable.rows.map(row => guestApplicationOperationToObject(row, operationTable.map));
    const current = existing.filter(item => item.serviceWeek === serviceWeek);
    const currentActive = current.filter(item => [GUEST_APPLICATION_OPERATION_STATUS.SELECTED, GUEST_APPLICATION_OPERATION_STATUS.COMPLETED].indexOf(item.status) >= 0);
    if (currentActive.length + ids.length > scheduling.capacity) return { success: false, message: '이번 주 운영 정원을 초과했습니다.' };
    if (ids.some(id => current.some(item => item.applicationId === id && item.status !== GUEST_APPLICATION_OPERATION_STATUS.CANCELLED))) {
      return { success: false, message: '같은 신청자가 이번 주 운영에 이미 포함되어 있습니다.' };
    }
    const now = new Date();
    let sequence = existing.length + 1;
    const rows = ids.map(applicationId => ({
      operationId: createGuestApplicationOperationId(serviceWeek, sequence++),
      applicationId,
      serviceWeek,
      status: GUEST_APPLICATION_OPERATION_STATUS.SELECTED,
      selectedAt: now,
      completedAt: '',
      adminMemo: String((data && data.adminMemo) || '').trim().slice(0, 500),
      createdAt: now,
      updatedAt: now,
    }));
    const values = rows.map(row => guestApplicationOperationToRow(row, operationTable.headers));
    operationTable.sheet.getRange(operationTable.sheet.getLastRow() + 1, 1, values.length, operationTable.headers.length).setValues(values);
    safeAppendAdminLog('assignGuestApplicationsToWeek', 'guestApplication', serviceWeek, '이번 주 운영 확정', '', ids.join(', '), requestId);
    const result = { success: true, serviceWeek, assigned: rows.map(row => row.operationId), message: ids.length + '명을 이번 주 운영 대상으로 확정했습니다.' };
    cacheGuestApplicationOperationResult('assign', requestId, result);
    return result;
  } finally {
    lock.releaseLock();
  }
}

function completeGuestApplicationOperations(data) {
  const ids = Array.isArray(data && data.operationIds) ? data.operationIds.map(String).map(value => value.trim()).filter(Boolean) : [];
  if (!ids.length) return { success: false, message: '서비스 완료 처리할 대상을 선택해 주세요.' };
  const requestId = String((data && data.requestId) || '').trim();
  const cachedResult = getCachedGuestApplicationOperationResult('complete', requestId);
  if (cachedResult) return cachedResult;
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const table = getGuestApplicationOperationTable();
    const idSet = new Set(ids);
    const now = new Date();
    let completed = 0;
    table.rows.forEach(row => {
      const operationId = String(row[table.map.operationId] || '').trim();
      if (!idSet.has(operationId)) return;
      const status = String(row[table.map.status] || '').trim();
      if (status !== GUEST_APPLICATION_OPERATION_STATUS.SELECTED) return;
      row[table.map.status] = GUEST_APPLICATION_OPERATION_STATUS.COMPLETED;
      row[table.map.completedAt] = now;
      row[table.map.updatedAt] = now;
      completed++;
    });
    if (!completed) return { success: false, message: '선택한 대상 중 완료 처리 가능한 대상이 없습니다.' };
    const values = table.rows.map(row => row.slice(0, table.headers.length));
    table.sheet.getRange(2, 1, values.length, table.headers.length).setValues(values);
    safeAppendAdminLog('completeGuestApplicationOperations', 'guestApplication', ids.join(','), '서비스 제공 완료', '', completed + '건', String((data && data.requestId) || ''));
    const result = { success: true, completed, message: completed + '건을 서비스 제공 완료로 처리했습니다.' };
    cacheGuestApplicationOperationResult('complete', requestId, result);
    return result;
  } finally {
    lock.releaseLock();
  }
}

function updateGuestApplicationSchedulingSettings(data) {
  const mode = String((data && data.mode) || 'MANUAL').trim().toUpperCase();
  if (['MANUAL', 'AUTO'].indexOf(mode) === -1) return { success: false, message: '운영 방식이 올바르지 않습니다.' };
  const paused = data && (data.paused === true || String(data.paused).toUpperCase() === 'Y') ? 'Y' : 'N';
  const pauseWeek = paused ? (data.pauseWeek ? getServiceWeekKey(data.pauseWeek) : getServiceWeekKey()) : '';
  const pauseReason = String((data && data.pauseReason) || '').trim().slice(0, 160);
  if (paused && !pauseReason) return { success: false, message: '운영 중단 사유를 입력해 주세요.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    setGuestApplicationSettingsValues({
      guestApplicationSchedulingMode: mode,
      guestApplicationPaused: paused,
      guestApplicationPauseWeek: pauseWeek,
      guestApplicationPauseReason: pauseReason,
    });
    clearGuestApplicationSettingsCache();
    safeAppendAdminLog('updateGuestApplicationSchedulingSettings', 'settings', pauseWeek || 'global', '주간 운영 설정', '', mode + '/' + paused, pauseReason);
    return { success: true, settings: getApplicationOperationSettings(), message: '주간 운영 설정이 저장되었습니다.' };
  } finally {
    lock.releaseLock();
  }
}

function repairGuestApplicationOperationDuplicates(data) {
  if (String((data && data.confirmText) || '').trim() !== '운영기록중복정리') {
    return { success: false, message: '확인 문구 운영기록중복정리를 정확히 입력해 주세요.' };
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const table = getGuestApplicationOperationTable();
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const backupBaseName = '이용운영기록_자동백업_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    let backupName = backupBaseName;
    let backupIndex = 2;
    while (spreadsheet.getSheetByName(backupName)) backupName = backupBaseName + '_' + backupIndex++;
    table.sheet.copyTo(spreadsheet).setName(backupName);
    const grouped = {};
    table.rows.forEach((row, index) => {
      const item = guestApplicationOperationToObject(row, table.map);
      if (!item.applicationId || !item.serviceWeek) return;
      const key = item.applicationId + '|' + item.serviceWeek;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({ row, index, item });
    });
    let cancelled = 0;
    Object.keys(grouped).forEach(key => {
      const entries = grouped[key].sort((a, b) => {
        const aTime = new Date(a.item.createdAt || a.item.selectedAt || 0).getTime() || 0;
        const bTime = new Date(b.item.createdAt || b.item.selectedAt || 0).getTime() || 0;
        return aTime - bTime || a.index - b.index;
      });
      const keeper = entries.find(entry => entry.item.status !== GUEST_APPLICATION_OPERATION_STATUS.CANCELLED) || entries[0];
      entries.forEach(entry => {
        if (entry === keeper) return;
        const statusIndex = table.map.status;
        const memoIndex = table.map.adminMemo;
        const updatedIndex = table.map.updatedAt;
        entry.row[statusIndex] = GUEST_APPLICATION_OPERATION_STATUS.CANCELLED;
        entry.row[memoIndex] = '[중복 정리] ' + String(entry.row[memoIndex] || '').slice(0, 480);
        entry.row[updatedIndex] = new Date();
        cancelled++;
      });
    });
    if (cancelled) {
      const values = table.rows.map(row => row.slice(0, table.headers.length));
      table.sheet.getRange(2, 1, values.length, table.headers.length).setValues(values);
    }
    safeAppendAdminLog('repairGuestApplicationOperationDuplicates', 'guestApplicationOperation', table.sheet.getName(), '주간 운영 중복 정리', '', cancelled + '건 CANCELLED', backupName);
    return { success: true, cancelled, backupName, message: cancelled + '건의 중복 운영 기록을 정리했습니다. 백업: ' + backupName };
  } finally {
    lock.releaseLock();
  }
}

function markGuestApplicationTestData(data) {
  const applicationId = String((data && data.applicationId) || '').trim();
  if (!applicationId) return { success: false, message: '신청번호가 필요합니다.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = ensureGuestApplicationSheet();
    const table = getGuestApplicationRows(sheet);
    const found = findGuestApplicationById(table, applicationId);
    if (!found || found.object.anonymizedAt) return { success: false, message: '테스트 표시할 신청을 찾을 수 없습니다.' };
    found.object.adminMemo = '[테스트] ' + String(found.object.adminMemo || '').replace(/^\[테스트\]\s*/, '').slice(0, 490);
    found.object.updatedAt = new Date();
    sheet.getRange(found.rowIndex + 2, 1, 1, table.headers.length).setValues([guestApplicationObjectToRow(found.object, table.headers)]);
    return { success: true, message: '테스트 신청으로 표시했습니다.' };
  } finally { lock.releaseLock(); }
}

function deleteTestGuestApplications(data) {
  if (String((data && data.confirmText) || '').trim() !== '테스트신청정리') return { success: false, message: '확인 문구 테스트신청정리를 정확히 입력해 주세요.' };
  const ids = Array.isArray(data && data.applicationIds) ? data.applicationIds.map(String).map(value => value.trim()).filter(Boolean) : [];
  if (!ids.length) return { success: false, message: '정리할 테스트 신청을 선택해 주세요.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const operationTable = getGuestApplicationOperationTable();
    const used = new Set(operationTable.rows.map(row => String(row[operationTable.map.applicationId] || '').trim()));
    const sheet = ensureGuestApplicationSheet();
    const table = getGuestApplicationRows(sheet);
    const deletable = [];
    ids.forEach(id => {
      const found = findGuestApplicationById(table, id);
      if (found && String(found.object.adminMemo || '').indexOf('[테스트]') === 0 && !used.has(id)) deletable.push(found.rowIndex + 2);
    });
    deletable.sort((a, b) => b - a).forEach(rowNumber => sheet.deleteRow(rowNumber));
    safeAppendAdminLog('deleteTestGuestApplications', 'guestApplication', ids.join(','), '테스트 신청 정리', '', deletable.length + '건', '');
    return { success: true, deleted: deletable.length, message: deletable.length + '건의 테스트 신청을 정리했습니다.' };
  } finally { lock.releaseLock(); }
}
