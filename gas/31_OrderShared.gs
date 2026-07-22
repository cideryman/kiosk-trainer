function getSheetHeaderRow(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0] || [];
}

const ORDER_IDEMPOTENCY_HEADER = 'idempotencyKey';
const ORDER_IDEMPOTENCY_COL = 23; // W열

function normalizeIdempotencyKey(value) {
  return String(value || '').trim();
}

function isValidIdempotencyKey(value) {
  const key = normalizeIdempotencyKey(value);
  return key.length >= 8 && key.length <= 120 && /^[A-Za-z0-9._:-]+$/.test(key);
}

function getExistingIdempotentOrderResult(orderSheet, userSheet, headers, idempotencyKey, userId) {
  const key = normalizeIdempotencyKey(idempotencyKey);
  const keyIdx = headers.indexOf(ORDER_IDEMPOTENCY_HEADER);
  if (!key || keyIdx === -1 || orderSheet.getLastRow() <= 1) return null;

  const colCount = Math.max(orderSheet.getLastColumn(), keyIdx + 1);
  const values = orderSheet.getRange(2, 1, orderSheet.getLastRow() - 1, colCount).getValues();
  const matchedRows = values.filter(row =>
    String(row[keyIdx] || '').trim() === key && String(row[2]) === String(userId)
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
        const afterCredit = Number(userRow[2] || 0);
        result.afterCredit = afterCredit;
        result.beforeCredit = afterCredit + totalCredit;
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
function getUserTodaySnackCountsMap(guestKey, guestDeviceId, userId) {
  const countsMap = {};
  const cleanedGuestKey = String(guestKey || '').trim();
  const cleanedGuestDeviceId = String(guestDeviceId || '').trim();
  const cleanedUserId = String(userId || '').trim();
  if (!cleanedGuestKey && !cleanedGuestDeviceId && !cleanedUserId) return countsMap;

  const ss = SpreadsheetApp.getActive();
  const orderSheet = ss.getSheetByName(SHEET.ORDERS);
  if (!orderSheet || orderSheet.getLastRow() <= 1) return countsMap;

  const headers = getSheetHeaderRow(orderSheet);
  const deviceIdIdx = headers.indexOf('guestDeviceId');
  const guestKeyIdx = headers.indexOf('guestKey');
  const servedYnIdx = headers.indexOf('제공여부');
  const isGuest = !cleanedUserId || cleanedUserId === 'guest';
  const nowTime = new Date();

  const values = orderSheet.getRange(2, 1, orderSheet.getLastRow() - 1, Math.max(orderSheet.getLastColumn(), 9)).getValues();

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const orderTime = row[0];
    if (!orderTime || !isSameKoreaDate(orderTime, nowTime)) continue;

    const status = String(row[servedYnIdx !== -1 ? servedYnIdx : 8] || '').trim().toUpperCase();
    if (status === 'C' || status === 'CANCELLED' || status === 'CANCELED' || status === '취소' || status === '주문취소') continue;

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
