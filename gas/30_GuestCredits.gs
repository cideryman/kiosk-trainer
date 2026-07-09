function isSameKoreaDate(dateValue, now) {
  if (!dateValue) return false;
  try {
    const tz = 'Asia/Seoul';
    const d1 = Utilities.formatDate(new Date(dateValue), tz, 'yyyy-MM-dd');
    const d2 = Utilities.formatDate(now || new Date(), tz, 'yyyy-MM-dd');
    return d1 === d2;
  } catch(e) {
    return false;
  }
}

function isClosedOrderStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  return [
    'cancelled', 'canceled', '취소', '관리자취소',
    '제공완료', '배달완료', '완료', 'completed', 'done', 'y', 'c'
  ].includes(s);
}

function getGuestCreditPeriodKey(dateValue) {
  let date = dateValue instanceof Date ? dateValue : new Date(dateValue || new Date());
  if (isNaN(date.getTime())) {
    date = new Date();
  }
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function splitGuestCreditDeviceIds(value) {
  return String(value || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
}

function mergeGuestCreditDeviceIds(currentIds, nextId) {
  const merged = [];
  (currentIds || []).forEach(id => {
    const normalized = String(id || '').trim();
    if (normalized && merged.indexOf(normalized) === -1) {
      merged.push(normalized);
    }
  });

  const normalizedNextId = String(nextId || '').trim();
  if (normalizedNextId && merged.indexOf(normalizedNextId) === -1) {
    merged.push(normalizedNextId);
  }

  return merged.slice(-20);
}

function ensureGuestCreditSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET.GUEST_CREDITS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET.GUEST_CREDITS);
  }

  const currentHeaders = sheet.getDataRange().getValues()[0] || [];
  const requiredHeaders = [
    'periodKey',
    'guestDeviceId',
    'guestKey',
    'baseCredit',
    'bonusCredit',
    'creditLimit',
    'usedCredit',
    'remainingCredit',
    'updatedAt',
  ];
  const headers = currentHeaders.filter(h => h !== '');
  let modified = headers.length === 0;

  requiredHeaders.forEach(header => {
    if (headers.indexOf(header) === -1) {
      headers.push(header);
      modified = true;
    }
  });

  if (modified) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  return sheet;
}

function getKakaoGuestBonusCredit(settings) {
  return Number(settings && settings.kakaoGuestBonusCredit !== undefined ? settings.kakaoGuestBonusCredit : 2);
}

function resolveGuestCreditWallet(data, options) {
  const opts = options || {};
  const settings = opts.settings || getGuestSettings();
  const periodKey = opts.periodKey || getGuestCreditPeriodKey();
  const guestDeviceId = String(data.guestDeviceId || '').trim();
  const requestedGuestKey = String(data.guestKey || '').trim();
  const authProvider = String(data.authProvider || '').trim().toLowerCase();
  const guestKey = authProvider === 'kakao' && requestedGuestKey ? requestedGuestKey : '';
  const spendCredit = Number(opts.spendCredit || 0);
  const refundCredit = Number(opts.refundCredit || 0);

  const sheet = ensureGuestCreditSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const idx = {
    periodKey: headers.indexOf('periodKey'),
    guestDeviceId: headers.indexOf('guestDeviceId'),
    guestKey: headers.indexOf('guestKey'),
    baseCredit: headers.indexOf('baseCredit'),
    bonusCredit: headers.indexOf('bonusCredit'),
    creditLimit: headers.indexOf('creditLimit'),
    usedCredit: headers.indexOf('usedCredit'),
    remainingCredit: headers.indexOf('remainingCredit'),
    updatedAt: headers.indexOf('updatedAt'),
  };

  const matched = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    let rowPeriodKey = '';
    const rawPeriodVal = row[idx.periodKey];
    if (rawPeriodVal instanceof Date) {
      rowPeriodKey = Utilities.formatDate(rawPeriodVal, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else {
      rowPeriodKey = String(rawPeriodVal || '').trim();
    }
    if (rowPeriodKey !== periodKey) continue;
    const rowDeviceId = String(row[idx.guestDeviceId] || '').trim();
    const rowDeviceIds = splitGuestCreditDeviceIds(rowDeviceId);
    const rowGuestKey = String(row[idx.guestKey] || '').trim();
    const matchByDevice = guestDeviceId && rowDeviceIds.indexOf(guestDeviceId) !== -1;
    const matchByGuestKey = guestKey && rowGuestKey && rowGuestKey === guestKey;
    if (matchByDevice || matchByGuestKey) {
      matched.push({
        rowNumber: i + 1,
        row,
        guestDeviceId: rowDeviceId,
        guestDeviceIds: rowDeviceIds,
        guestKey: rowGuestKey,
      });
    }
  }

  const baseCredit = Number(settings.guestBaseCredit || 10);
  const hasKakaoLink = !!guestKey || matched.some(item => item.guestKey);
  const bonusCredit = hasKakaoLink ? getKakaoGuestBonusCredit(settings) : 0;
  const creditLimit = baseCredit + bonusCredit;
  let usedCredit = matched.reduce((sum, item) => sum + Number(item.row[idx.usedCredit] || 0), 0);

  if (spendCredit > 0) {
    if (creditLimit - usedCredit < spendCredit) {
      return {
        success: false,
        periodKey,
        baseCredit,
        bonusCredit,
        creditLimit,
        usedCredit,
        remainingCredit: Math.max(0, creditLimit - usedCredit),
        message: `크레딧이 부족합니다. 오늘 남은 크레딧: ${Math.max(0, creditLimit - usedCredit)}개`,
      };
    }
    usedCredit += spendCredit;
  }

  if (refundCredit > 0) {
    usedCredit = Math.max(0, usedCredit - refundCredit);
  }

  const remainingCredit = Math.max(0, creditLimit - usedCredit);
  const shouldPersist = opts.create || spendCredit > 0 || refundCredit > 0 || matched.length > 1;
  if (shouldPersist) {
    const primary = matched[0] || null;
    let mergedDeviceIds = [];
    matched.forEach(item => {
      (item.guestDeviceIds || splitGuestCreditDeviceIds(item.guestDeviceId)).forEach(deviceId => {
        mergedDeviceIds = mergeGuestCreditDeviceIds(mergedDeviceIds, deviceId);
      });
    });
    const nextDeviceId = mergeGuestCreditDeviceIds(mergedDeviceIds, guestDeviceId).join(',');
    const nextGuestKey = guestKey || (primary ? primary.guestKey : '');
    const nextRow = [
      periodKey,
      nextDeviceId,
      nextGuestKey,
      baseCredit,
      bonusCredit,
      creditLimit,
      usedCredit,
      remainingCredit,
      new Date(),
    ];

    if (primary) {
      sheet.getRange(primary.rowNumber, 1, 1, nextRow.length).setValues([nextRow]);
      for (let i = matched.length - 1; i >= 1; i--) {
        sheet.deleteRow(matched[i].rowNumber);
      }
    } else if (nextDeviceId || nextGuestKey) {
      sheet.appendRow(nextRow);
    }
  }

  return {
    success: true,
    periodKey,
    guestDeviceId: guestDeviceId || (matched[0] && matched[0].guestDeviceId) || '',
    guestKey: guestKey || (matched[0] && matched[0].guestKey) || '',
    baseCredit,
    bonusCredit,
    creditLimit,
    usedCredit,
    remainingCredit,
  };
}

function getGuestCreditStatus(data) {
  const status = resolveGuestCreditWallet(data || {}, { create: false });
  if (!status.success) return status;
  return {
    success: true,
    periodKey: status.periodKey,
    baseCredit: status.baseCredit,
    bonusCredit: status.bonusCredit,
    creditLimit: status.creditLimit,
    usedCredit: status.usedCredit,
    remainingCredit: status.remainingCredit,
  };
}
