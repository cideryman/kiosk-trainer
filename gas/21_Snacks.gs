/**
 * 6. 간식 목록 조회
 */
const SNACKS_READ_CACHE_KEY = 'snacks.readValues.v1';
const SNACKS_READ_CACHE_TTL_SECONDS = 300;

function getSnackValuesForRead(sheet) {
  try {
    const cached = CacheService.getScriptCache().get(SNACKS_READ_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (error) {
    Logger.log('snacks read cache read failed: ' + (error && error.stack ? error.stack : error));
  }

  const values = sheet.getDataRange().getValues();
  try {
    CacheService
      .getScriptCache()
      .put(SNACKS_READ_CACHE_KEY, JSON.stringify(values), SNACKS_READ_CACHE_TTL_SECONDS);
  } catch (error) {
    Logger.log('snacks read cache write failed: ' + (error && error.stack ? error.stack : error));
  }
  return values;
}

function clearSnackReadCache() {
  try {
    CacheService.getScriptCache().remove(SNACKS_READ_CACHE_KEY);
  } catch (error) {
    Logger.log('snacks read cache clear failed: ' + (error && error.stack ? error.stack : error));
  }
}

function parseSnackTargetList(rawTarget) {
  const str = String(rawTarget || 'user').trim().toLowerCase();
  const list = str.split(',').map(s => s.trim()).filter(s => s);
  return list.length > 0 ? list : ['user'];
}

function getSnacks(includeHidden, mode, guestKey, guestDeviceId, userId) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET.SNACKS);
  const values = getSnackValuesForRead(sheet);
  const rows = values.slice(1);
  const shouldIncludeHidden = String(includeHidden || '').trim().toUpperCase() === 'Y';

  const activeRows = rows
    .filter(row => row[0] || row[1])
    .filter(row => {
      if (shouldIncludeHidden) return true;
      const active = String(row[4]).trim().toUpperCase();
      return (
        active === 'TRUE' ||
        active === '판매' ||
        active === 'Y' ||
        active === 'O' ||
        active === '예'
      );
    });

  // 1인당 수량 제한(maxPerPerson > 0) 설정이 있는 간식이 존재할 때만 주문목록 시트 조회 (Lazy Evaluation)
  const hasPerPersonLimit = activeRows.some(row => Number(row[8] || 0) > 0);
  const hasGuestIdent = !!(String(guestKey || '').trim() || String(guestDeviceId || '').trim() || (userId && userId !== 'guest'));
  const todayCounts = (hasPerPersonLimit && hasGuestIdent)
    ? getUserTodaySnackCountsMap(guestKey, guestDeviceId, userId)
    : {};

  let snacks = activeRows.map(row => {
    const snackId = Number(row[0]);
    const stock = Number(row[5] || 0);
    const rawTarget = row[7] ? String(row[7]).trim().toLowerCase() : 'user';
    const targetList = parseSnackTargetList(rawTarget);
    const maxPerPerson = Number(row[8] || 0);
    const todayOrderedCount = Number(todayCounts[snackId] || 0);

    return {
      snackId: snackId,
      name: row[1],
      point: Number(row[2]),
      imageUrl: makeImageUrl(row[3]),
      active: row[4],
      saleYn: row[4],
      stock,
      soldOut: stock <= 0,
      displayOrder: Number(row[6] || 0),
      target: rawTarget,
      targetList: targetList,
      maxPerPerson: maxPerPerson,
      todayOrderedCount: todayOrderedCount,
    };
  });

  if (mode) {
    const cleanedMode = String(mode).trim().toLowerCase();
    if (cleanedMode === 'guest') {
      const settings = getGuestSettings();
      const menuMode = String(settings.guestMenuMode || 'normal').toLowerCase();
      if (menuMode === 'event') {
        snacks = snacks.filter(s => s.targetList.includes('event') || s.targetList.includes('campaign'));
      } else {
        snacks = snacks.filter(s => s.targetList.includes('guest'));
      }
    } else if (cleanedMode === 'user' || cleanedMode === 'kiosk') {
      snacks = snacks.filter(s => s.targetList.includes('user'));
    }
  }

  return {
    success: true,
    snacks,
  };
}

function isActiveValue(value) {
  const v = String(value || '').trim().toUpperCase();
  return v === 'Y' || v === 'TRUE' || v === '활성' || v === '판매' || v === 'O' || v === '예';
}

function canOrderSnack(snackRow, mode) {
  if (!isActiveValue(snackRow[4])) {
    return false;
  }

  const rawTarget = String(snackRow[7] || 'user').trim().toLowerCase();
  const targetList = parseSnackTargetList(rawTarget);

  if (mode === 'guest') {
    const settings = getGuestSettings();
    const menuMode = String(settings.guestMenuMode || 'normal').toLowerCase();
    if (menuMode === 'event') {
      return targetList.includes('event') || targetList.includes('campaign');
    }
    return targetList.includes('guest');
  }

  if (mode === 'user' || mode === 'kiosk') {
    return targetList.includes('user');
  }

  return false;
}

/**
 * 13. 간식 재고 수량 조정 API
 */
function updateSnackStock(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.SNACKS);
  var rows = sheet.getDataRange().getValues();
  var snackId = Number(data.snackId);
  var newStock = Number(data.stock);

  if (!isFinite(newStock) || newStock < 0 || newStock > ADMIN_MAX_SNACK_STOCK) {
    return { success: false, message: '간식 재고는 0~' + ADMIN_MAX_SNACK_STOCK + ' 범위로 입력해 주세요.' };
  }

  for (var i = 1; i < rows.length; i++) {
    if (Number(rows[i][0]) === snackId) {
      var beforeStock = Number(rows[i][5] || 0);
      sheet.getRange(i + 1, 6).setValue(newStock);
      safeAppendAdminLog('updateSnackStock', 'snack', snackId, rows[i][1], beforeStock, newStock, data.adminMemo);
      clearSnackReadCache();
      return { success: true, message: '재고를 업데이트했습니다.' };
    }
  }
  return { success: false, message: '간식을 찾을 수 없습니다.' };
}

/**
 * 14. 간식 판매/숨김 상태 변경 API
 */
function updateSnackSale(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.SNACKS);
  var rows = sheet.getDataRange().getValues();
  var snackId = Number(data.snackId);
  var saleYn = String(data.saleYn || 'N').toUpperCase() === 'Y' ? 'Y' : 'N';

  for (var i = 1; i < rows.length; i++) {
    if (Number(rows[i][0]) === snackId) {
      var beforeSaleYn = rows[i][4] || '';
      sheet.getRange(i + 1, 5).setValue(saleYn);
      safeAppendAdminLog('updateSnackSale', 'snack', snackId, rows[i][1], beforeSaleYn, saleYn, data.adminMemo);
      clearSnackReadCache();
      return { success: true, message: '간식 판매 상태를 업데이트했습니다.', saleYn: saleYn };
    }
  }

  return { success: false, message: '간식을 찾을 수 없습니다.' };
}

function cleanSnackTarget(rawTarget) {
  var str = String(rawTarget || 'user').trim().toLowerCase();
  var validTargets = ['user', 'guest', 'event', 'campaign'];
  var list = str.split(',')
    .map(function(s) { return s.trim(); })
    .filter(function(s) { return validTargets.indexOf(s) !== -1; });
  return list.length > 0 ? list.join(',') : 'user';
}

/**
 * 15. 신규 간식 품목 등록 API
 */
function addSnack(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.SNACKS);
  var rows = sheet.getDataRange().getValues();

  var maxId = 0;
  for (var i = 1; i < rows.length; i++) {
    var id = Number(rows[i][0]);
    if (id > maxId) maxId = id;
  }
  var newSnackId = maxId + 1;
  var target = cleanSnackTarget(data.target);
  var initialStock = Number(data.stock || 0);

  if (!isFinite(initialStock) || initialStock < 0 || initialStock > ADMIN_MAX_SNACK_STOCK) {
    return { success: false, message: '간식 재고는 0~' + ADMIN_MAX_SNACK_STOCK + ' 범위로 입력해 주세요.' };
  }

  var maxPerPerson = Number(data.maxPerPerson || 0);

  var newRow = [
    newSnackId,
    data.name,
    Number(data.point || 1),
    data.imageUrl || "",
    data.saleYn || "Y",
    initialStock,
    0, // displayOrder
    target,
    maxPerPerson
  ];

  sheet.appendRow(newRow);
  safeAppendAdminLog('addSnack', 'snack', newSnackId, data.name, '', JSON.stringify({ point: Number(data.point || 1), saleYn: data.saleYn || 'Y', stock: initialStock, target: target, maxPerPerson: maxPerPerson }), data.adminMemo);
  clearSnackReadCache();
  return { success: true, message: '신규 간식을 등록했습니다.', snackId: newSnackId };
}

/**
 * 17. 간식 정보 전체 수정 API
 */
function updateSnack(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.SNACKS);
  var rows = sheet.getDataRange().getValues();
  var snackId = Number(data.snackId);
  var name = String(data.name || '').trim();
  var point = Number(data.point);
  var imageUrl = String(data.imageUrl || '').trim();
  var stock = Number(data.stock);
  var saleYn = String(data.saleYn || 'Y').toUpperCase() === 'Y' ? 'Y' : 'N';
  var target = cleanSnackTarget(data.target);
  var maxPerPerson = Number(data.maxPerPerson || 0);

  if (!snackId) {
    return { success: false, message: '간식 ID가 필요합니다.' };
  }
  if (!name) {
    return { success: false, message: '간식 이름이 필요합니다.' };
  }
  if (!isFinite(stock) || stock < 0 || stock > ADMIN_MAX_SNACK_STOCK) {
    return { success: false, message: '간식 재고는 0~' + ADMIN_MAX_SNACK_STOCK + ' 범위로 입력해 주세요.' };
  }

  for (var i = 1; i < rows.length; i++) {
    if (Number(rows[i][0]) === snackId) {
      var beforeName = rows[i][1];
      var beforePoint = rows[i][2];
      var beforeImageUrl = rows[i][3];
      var beforeSaleYn = rows[i][4];
      var beforeStock = rows[i][5];
      var beforeTarget = cleanSnackTarget(rows[i][7]);
      var beforeMaxPerPerson = Number(rows[i][8] || 0);

      sheet.getRange(i + 1, 2).setValue(name);
      sheet.getRange(i + 1, 3).setValue(point);
      sheet.getRange(i + 1, 4).setValue(imageUrl);
      sheet.getRange(i + 1, 5).setValue(saleYn);
      sheet.getRange(i + 1, 6).setValue(stock);
      sheet.getRange(i + 1, 8).setValue(target);
      sheet.getRange(i + 1, 9).setValue(maxPerPerson);

      safeAppendAdminLog('updateSnack', 'snack', snackId, name,
        JSON.stringify({ name: beforeName, point: beforePoint, imageUrl: beforeImageUrl, saleYn: beforeSaleYn, stock: beforeStock, target: beforeTarget, maxPerPerson: beforeMaxPerPerson }),
        JSON.stringify({ name: name, point: point, imageUrl: imageUrl, saleYn: saleYn, stock: stock, target: target, maxPerPerson: maxPerPerson }),
        data.adminMemo
      );
      clearSnackReadCache();
      return { success: true, message: '간식 정보를 수정했습니다.' };
    }
  }
  return { success: false, message: '간식을 찾을 수 없습니다.' };
}

/**
 * 18. 간식 표시 순서 일괄 업데이트 API
 * items: [{ snackId, displayOrder }] 배열을 받아 G열을 업데이트합니다.
 */
function updateSnacksOrder(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.SNACKS);
  var rows = sheet.getDataRange().getValues();
  var items = data.items; // [{ snackId, displayOrder }]

  if (!items || !Array.isArray(items) || items.length === 0) {
    return { success: false, message: '순서 데이터가 없습니다.' };
  }

  // snackId → displayOrder 맵 구성
  var orderMap = {};
  items.forEach(function(item) {
    orderMap[String(item.snackId)] = Number(item.displayOrder);
  });

  // 해당 행의 G열(7번째 열)을 업데이트
  for (var i = 1; i < rows.length; i++) {
    var snackId = String(rows[i][0]);
    if (orderMap.hasOwnProperty(snackId)) {
      sheet.getRange(i + 1, 7).setValue(orderMap[snackId]);
    }
  }

  clearSnackReadCache();
  return { success: true, message: '표시 순서를 저장했습니다.' };
}

/**
 * 27. 빈 간식ID 자동 채우기 기능
 * 비어 있는 간식ID를 기존 가장 높은 숫자 ID부터 순차적으로 채웁니다.
 * 중복되거나 숫자가 아닌 ID가 발견될 경우 경고를 반환합니다.
 */
function autoFillEmptySnackIds() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, message: '다른 작업이 진행 중입니다.', hasError: true };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET.SNACKS);
    if (!sheet) {
      return { success: false, message: '간식목록 시트를 찾을 수 없습니다.', hasError: true };
    }

    const range = sheet.getDataRange();
    const values = range.getValues();
    if (values.length <= 1) {
      return { success: true, filledCount: 0, message: '간식 데이터가 없습니다.' };
    }

    const rows = values.slice(1);
    const existingIds = [];
    const emptyRowsIndexes = [];

    // 1. 유효성 검사 및 데이터 수집
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const snackId = row[0];
      const snackName = row[1];

      // 이름도 없고 ID도 없으면 빈 줄로 간주
      if (!snackId && !snackName) continue;

      if (!snackId) {
        emptyRowsIndexes.push(i + 1); // 데이터 행 인덱스 (sheet rows is i + 2)
      } else {
        existingIds.push(String(snackId).trim());
      }
    }

    // 빈 ID가 없다면 조기 종료
    if (emptyRowsIndexes.length === 0) {
      return { success: true, filledCount: 0, message: '모든 간식ID가 정상입니다.' };
    }

    // 2. 숫자가 아닌 ID나 중복 ID 검사 (오류 시 자동 수정 중단)
    const idCounts = {};
    let hasInvalid = false;
    let hasDuplicate = false;

    existingIds.forEach(id => {
      if (isNaN(Number(id)) || id === '') {
        hasInvalid = true;
      }
      idCounts[id] = (idCounts[id] || 0) + 1;
      if (idCounts[id] > 1) {
        hasDuplicate = true;
      }
    });

    if (hasInvalid || hasDuplicate) {
      return {
        success: false,
        message: '경고: 간식 목록에 숫자가 아닌 ID나 중복된 ID가 존재합니다. 시트를 직접 확인해주세요.',
        hasError: true
      };
    }

    // 3. 가장 큰 ID 찾기 및 빈 ID 채우기
    let maxId = 0;
    existingIds.forEach(id => {
      const num = Number(id);
      if (num > maxId) maxId = num;
    });

    let currentId = maxId;
    let filledCount = 0;

    emptyRowsIndexes.forEach(rowIndex => {
      currentId++;
      // sheet index는 1-based, 헤더 고려하여 +1
      sheet.getRange(rowIndex + 1, 1).setValue(currentId);
      filledCount++;
    });

    clearSnackReadCache();
    return {
      success: true,
      filledCount: filledCount,
      message: `${filledCount}개의 빈 간식ID를 자동으로 채웠습니다.`
    };
  } finally {
lock.releaseLock();
  }
}
