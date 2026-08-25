function getSheetHeaderRow(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0] || [];
}

const ORDER_IDEMPOTENCY_HEADER = 'idempotencyKey';
const ORDER_IDEMPOTENCY_COL = 23; // W열
const ORDER_COMMIT_STATUS_HEADER = 'commitStatus';
const ORDER_COMMIT_STATUS_COL = 24; // X열

function getOrderCreditState(isGuest, availableCredit, totalCredit) {
  const beforeCredit = Math.max(0, Number(availableCredit) || 0);
  const orderTotal = Math.max(0, Number(totalCredit) || 0);
  return {
    canOrder: beforeCredit >= orderTotal,
    beforeCredit,
    afterCredit: Math.max(0, beforeCredit - orderTotal),
    persistsBalance: isGuest === true,
  };
}

function isCommittedOrderRow(row, headers) {
  const statusIdx = headers.indexOf(ORDER_COMMIT_STATUS_HEADER);
  if (statusIdx === -1) return true;
  const status = String(row[statusIdx] || '').trim().toUpperCase();
  return status === '' || status === 'COMMITTED';
}

function normalizeIdempotencyKey(value) {
  return String(value || '').trim();
}

function isValidIdempotencyKey(value) {
  const key = normalizeIdempotencyKey(value);
  return key.length >= 8 && key.length <= 120 && /^[A-Za-z0-9._:-]+$/.test(key);
}

function getExistingIdempotentOrderResult(orderSheet, userSheet, headers, idempotencyKey, userId, knownValues) {
  const key = normalizeIdempotencyKey(idempotencyKey);
  const keyIdx = headers.indexOf(ORDER_IDEMPOTENCY_HEADER);
  if (!key || keyIdx === -1 || orderSheet.getLastRow() <= 1) return null;

  const colCount = Math.max(orderSheet.getLastColumn(), keyIdx + 1);
  const values = Array.isArray(knownValues)
    ? knownValues
    : orderSheet.getRange(2, 1, orderSheet.getLastRow() - 1, colCount).getValues();
  const matchedRows = values.filter(row =>
    isCommittedOrderRow(row, headers)
      && String(row[keyIdx] || '').trim() === key
      && String(row[2]) === String(userId)
  );
  if (matchedRows.length === 0) return null;

  const firstRow = matchedRows[0];
  const totalCredit = Number(firstRow[13] || matchedRows.reduce((sum, row) => sum + Number(row[7] || 0), 0));
  const result = {
    success: true,
    message: '이미 처리된 주문입니다.',
    orderNo: firstRow[1] || '',
    orderToken: firstRow[10] || '',
    nickname: firstRow[3] || '',
    totalPoint: totalCredit,
    items: matchedRows.map(row => ({
      snackId: row[4],
      snackName: row[5],
      quantity: Number(row[6] || 0),
      point: Number(row[7] || 0),
      totalPoint: Number(row[7] || 0),
    })),
    idempotencyKey: key,
    idempotentReplay: true,
  };

  try {
    if (String(userId) === 'guest') {
      const guestDeviceIdIdx = headers.indexOf('guestDeviceId');
      const authProviderIdx = headers.indexOf('authProvider');
      const guestKeyIdx = headers.indexOf('guestKey');
      const settings = getGuestSettings();
      const creditStatus = resolveGuestCreditWallet({
        guestDeviceId: guestDeviceIdIdx !== -1 ? firstRow[guestDeviceIdIdx] || '' : '',
        authProvider: authProviderIdx !== -1 ? firstRow[authProviderIdx] || '' : '',
        guestKey: guestKeyIdx !== -1 ? firstRow[guestKeyIdx] || '' : '',
      }, {
        settings,
        create: false,
      });
      if (creditStatus && creditStatus.success) {
        result.afterCredit = creditStatus.remainingCredit;
        result.beforeCredit = creditStatus.remainingCredit + totalCredit;
        result.bonusCredit = creditStatus.bonusCredit || 0;
      }
    } else if (userSheet) {
      const userValues = userSheet.getDataRange().getValues();
      const userRow = userValues.find((row, index) => index > 0 && String(row[0]) === String(userId));
      if (userRow) {
        const creditState = getOrderCreditState(false, userRow[2], totalCredit);
        result.afterCredit = creditState.afterCredit;
        result.beforeCredit = creditState.beforeCredit;
      }
    }
  } catch (error) {
    Logger.log('idempotent order result credit reconstruction failed: ' + (error && error.stack ? error.stack : error));
  }

  return result;
}

/**
  * 당일 특정 주문자의 간식별 주문 수량을 집계하여 { snackId: count } Map 형태로 반환
  */
function getUserTodaySnackCountsMap(guestKey, guestDeviceId, userId, knownRows, knownHeaders) {
  const countsMap = {};
  const cleanedGuestKey = String(guestKey || '').trim();
  const cleanedGuestDeviceId = String(guestDeviceId || '').trim();
  const cleanedUserId = String(userId || '').trim();
  if (!cleanedGuestKey && !cleanedGuestDeviceId && !cleanedUserId) return countsMap;

  const orderSheet = knownRows ? null : SpreadsheetApp.getActive().getSheetByName(SHEET.ORDERS);
  if (!knownRows && (!orderSheet || orderSheet.getLastRow() <= 1)) return countsMap;

  const headers = knownHeaders || getSheetHeaderRow(orderSheet);
  const deviceIdIdx = headers.indexOf('guestDeviceId');
  const guestKeyIdx = headers.indexOf('guestKey');
  const servedYnIdx = headers.indexOf('제공여부');
  const isGuest = !cleanedUserId || cleanedUserId === 'guest';
  const nowTime = new Date();

  const values = knownRows || orderSheet.getRange(2, 1, orderSheet.getLastRow() - 1, Math.max(orderSheet.getLastColumn(), 9)).getValues();

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (!isCommittedOrderRow(row, headers)) continue;
    const orderTime = row[0];
    if (!orderTime || !isSameKoreaDate(orderTime, nowTime)) continue;

    const status = row[servedYnIdx !== -1 ? servedYnIdx : 8];
    if (isCancelledOrderStatus(status)) continue;

    let isMatch = false;
    if (isGuest) {
      const rowDevice = deviceIdIdx !== -1 ? String(row[deviceIdIdx] || '').trim() : '';
      const rowGuestKey = guestKeyIdx !== -1 ? String(row[guestKeyIdx] || '').trim() : '';
      if ((cleanedGuestKey && rowGuestKey && rowGuestKey === cleanedGuestKey) ||
          (cleanedGuestDeviceId && rowDevice && rowDevice === cleanedGuestDeviceId)) {
        isMatch = true;
      }
    } else {
      if (String(row[2]).trim() === cleanedUserId) {
        isMatch = true;
      }
    }

    if (isMatch) {
      const snackId = Number(row[4]);
      const quantity = Number(row[6] || 0);
      if (snackId && quantity > 0) {
        countsMap[snackId] = (countsMap[snackId] || 0) + quantity;
      }
    }
  }

  return countsMap;
}
