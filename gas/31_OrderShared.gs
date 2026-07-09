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
