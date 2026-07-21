/**
 * 20. 게스트 운영 설정 조회
 */
function upsertSettingValue(sheet, key, value) {
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

const GUEST_SETTINGS_CACHE_KEY = 'guestSettings.v1';
const GUEST_SETTINGS_CACHE_TTL_SECONDS = 30;

function getGuestSettingsCache() {
  try {
    const cached = CacheService.getScriptCache().get(GUEST_SETTINGS_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    Logger.log('getGuestSettings cache read failed: ' + (error && error.stack ? error.stack : error));
    return null;
  }
}

function setGuestSettingsCache(settings) {
  try {
    CacheService
      .getScriptCache()
      .put(GUEST_SETTINGS_CACHE_KEY, JSON.stringify(settings), GUEST_SETTINGS_CACHE_TTL_SECONDS);
  } catch (error) {
    Logger.log('getGuestSettings cache write failed: ' + (error && error.stack ? error.stack : error));
  }
}

function clearGuestSettingsCache() {
  try {
    CacheService.getScriptCache().remove(GUEST_SETTINGS_CACHE_KEY);
  } catch (error) {
    Logger.log('getGuestSettings cache clear failed: ' + (error && error.stack ? error.stack : error));
  }
}

function buildGuestSettingsResponse(settings) {
  const now = new Date();
  let isGuestOpenNow = false;
  let remainingSeconds = 0;
  let message = '';

  if (settings.guestOpen === 'Y') {
    if (settings.guestCloseAt) {
      const closeAt = new Date(settings.guestCloseAt);
      const diff = Math.floor((closeAt.getTime() - now.getTime()) / 1000);
      if (diff > 0) {
        isGuestOpenNow = true;
        remainingSeconds = diff;
        message = '게스트 주문이 운영 중입니다.';
      } else {
        isGuestOpenNow = false;
        message = '게스트 주문 운영 시간이 종료되었습니다.';
      }
    } else {
      isGuestOpenNow = true;
      message = '게스트 주문이 운영 중입니다 (종료시각 미설정).';
    }
  } else {
    isGuestOpenNow = false;
    message = '게스트 주문이 마감되었습니다.';
  }

  return {
    success: true,
    guestOpen: settings.guestOpen,
    guestCloseAt: settings.guestCloseAt,
    guestBaseCredit: Number(settings.guestBaseCredit || 10),
    kakaoGuestBonusCredit: Number(settings.kakaoGuestBonusCredit || 2),
    guestDeliveryFee: Number(settings.guestDeliveryFee || 3),
    guestDefaultDeliveryPlace: settings.guestDefaultDeliveryPlace || '사무실 원탁',
    todayDeliveryTeamEnabled: settings.todayDeliveryTeamEnabled === true || String(settings.todayDeliveryTeamEnabled).toLowerCase() === 'true',
    todayDeliveryTeamTitle: settings.todayDeliveryTeamTitle || '📦 오늘의 배달팀',
    todayDeliveryTeamMembers: settings.todayDeliveryTeamMembers || '',
    todayDeliveryTeamMessage: settings.todayDeliveryTeamMessage || '',
    guestAllowMultipleOrders: String(settings.guestAllowMultipleOrders || 'TRUE').toUpperCase() !== 'FALSE',
    guestMenuMode: String(settings.guestMenuMode || 'normal').toLowerCase(),
    guestEventName: settings.guestEventName || '장애인식 개선 캠페인',
    guestOrderGraceMinutes: GUEST_ORDER_COMPLETION_GRACE_MINUTES,
    isGuestOpenNow,
    remainingSeconds,
    message
  };
}

function canCompleteStartedGuestOrder(settings, orderStartedAt, nowValue) {
  if (!settings || settings.guestOpen !== 'Y') return false;
  if (settings.isGuestOpenNow) return true;
  if (!settings.guestCloseAt || !orderStartedAt) return false;

  const closeAt = new Date(settings.guestCloseAt);
  const startedAt = new Date(orderStartedAt);
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue || new Date());
  if (
    isNaN(closeAt.getTime()) ||
    isNaN(startedAt.getTime()) ||
    isNaN(now.getTime())
  ) {
    return false;
  }

  const graceEndsAt = new Date(
    closeAt.getTime() + GUEST_ORDER_COMPLETION_GRACE_MINUTES * 60 * 1000
  );
  return startedAt.getTime() <= closeAt.getTime() && now.getTime() <= graceEndsAt.getTime();
}

function getGuestSettings() {
  const cachedSettings = getGuestSettingsCache();
  if (cachedSettings) {
    return buildGuestSettingsResponse(cachedSettings);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET.SETTINGS);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET.SETTINGS);
    sheet.appendRow(['key', 'value']);
  }

  const values = sheet.getDataRange().getValues();
  const settings = {
    guestOpen: 'N',
    guestCloseAt: '',
    guestBaseCredit: 10,
    kakaoGuestBonusCredit: 2,
    guestDeliveryFee: 3,
    guestDefaultDeliveryPlace: '사무실 원탁',
    todayDeliveryTeamEnabled: true,
    todayDeliveryTeamTitle: '📦 오늘의 배달팀',
    todayDeliveryTeamMembers: '김○○|배달 담당, 박○○|상품 준비 담당',
    todayDeliveryTeamMessage: '맛있게 준비해서 배달하겠습니다!',
    welcomeTitle: '배달왔삼에 오신 것을 환영합니다 😊',
    welcomeSubtitle: '오늘의 간식을 주문해보세요!',
    guestAllowMultipleOrders: 'TRUE',
    guestOrderLimitPolicyVersion: 'creditWalletV1',
    guestMenuMode: 'normal',
    guestEventName: '장애인식 개선 캠페인'
  };

  const existingKeys = [];
  values.slice(1).forEach(row => {
    const key = String(row[0]).trim();
    if (key) {
      settings[key] = row[1];
      existingKeys.push(key);
    }
  });

  // 누락된 기본 설정값이 있다면 시트에 자동 추가
  const defaultSettings = {
    guestOpen: 'N',
    guestCloseAt: '',
    guestBaseCredit: 10,
    kakaoGuestBonusCredit: 2,
    guestDeliveryFee: 3,
    guestDefaultDeliveryPlace: '사무실 원탁',
    todayDeliveryTeamEnabled: true,
    todayDeliveryTeamTitle: '📦 오늘의 배달팀',
    todayDeliveryTeamMembers: '김○○|배달 담당, 박○○|상품 준비 담당',
    todayDeliveryTeamMessage: '맛있게 준비해서 배달하겠습니다!',
    welcomeTitle: '배달왔삼에 오신 것을 환영합니다 😊',
    welcomeSubtitle: '오늘의 간식을 주문해보세요!',
    guestAllowMultipleOrders: 'TRUE',
    guestOrderLimitPolicyVersion: 'creditWalletV1',
    guestMenuMode: 'normal',
    guestEventName: '장애인식 개선 캠페인'
  };

  for (const key in defaultSettings) {
    if (existingKeys.indexOf(key) === -1) {
      sheet.appendRow([key, defaultSettings[key]]);
    }
  }

  if (existingKeys.indexOf('guestOrderLimitPolicyVersion') === -1) {
    settings.guestAllowMultipleOrders = 'TRUE';
    settings.guestOrderLimitPolicyVersion = 'creditWalletV1';
    upsertSettingValue(sheet, 'guestAllowMultipleOrders', 'TRUE');
    upsertSettingValue(sheet, 'guestOrderLimitPolicyVersion', 'creditWalletV1');
  }

  setGuestSettingsCache(settings);
  return buildGuestSettingsResponse(settings);
}

/**
 * 21. 게스트 운영 설정 변경
 */
function updateGuestSettings(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET.SETTINGS);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET.SETTINGS);
    sheet.appendRow(['key', 'value']);
  }

  const action = data.settingsAction;
  const now = new Date();
  let guestOpen = 'N';
  let guestCloseAt = '';
  let logBefore = 'N';
  let logAfter = 'N';

  if (action === 'open20') {
    guestOpen = 'Y';
    guestCloseAt = new Date(now.getTime() + 20 * 60 * 1000).toISOString();
    logAfter = 'Y (20분)';
  } else if (action === 'open30') {
    guestOpen = 'Y';
    guestCloseAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
    logAfter = 'Y (30분)';
  } else if (action === 'open60') {
    guestOpen = 'Y';
    guestCloseAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    logAfter = 'Y (60분)';
  } else if (action === 'openCustom') {
    const minutes = Number(data.minutes || 10);
    guestOpen = 'Y';
    guestCloseAt = new Date(now.getTime() + minutes * 60 * 1000).toISOString();
    logAfter = 'Y (' + minutes + '분)';
  } else if (action === 'closeNow') {
    guestOpen = 'N';
    logBefore = 'Y';
    logAfter = 'N (즉시 마감)';
  } else if (action === 'updateValues') {
    const guestBaseCredit = data.guestBaseCredit;
    const guestDeliveryFee = data.guestDeliveryFee;
    const guestDefaultDeliveryPlace = data.guestDefaultDeliveryPlace;
    const todayDeliveryTeamEnabled = data.todayDeliveryTeamEnabled !== undefined ? data.todayDeliveryTeamEnabled : true;
    const todayDeliveryTeamTitle = data.todayDeliveryTeamTitle || '📦 오늘의 배달팀';
    const todayDeliveryTeamMembers = data.todayDeliveryTeamMembers || '';
    const todayDeliveryTeamMessage = data.todayDeliveryTeamMessage || '';
    const guestAllowMultipleOrders = data.guestAllowMultipleOrders !== undefined ? (data.guestAllowMultipleOrders ? 'TRUE' : 'FALSE') : undefined;

    const values = sheet.getDataRange().getValues();
    let rowCredit = -1;
    let rowFee = -1;
    let rowDeliveryPlace = -1;
    let rowTeamEnabled = -1;
    let rowTeamTitle = -1;
    let rowTeamMembers = -1;
    let rowTeamMessage = -1;
    let rowAllowMultiple = -1;
    for (let i = 1; i < values.length; i++) {
      const key = String(values[i][0]).trim();
      if (key === 'guestBaseCredit') rowCredit = i + 1;
      if (key === 'guestDeliveryFee') rowFee = i + 1;
      if (key === 'guestDefaultDeliveryPlace') rowDeliveryPlace = i + 1;
      if (key === 'todayDeliveryTeamEnabled') rowTeamEnabled = i + 1;
      if (key === 'todayDeliveryTeamTitle') rowTeamTitle = i + 1;
      if (key === 'todayDeliveryTeamMembers') rowTeamMembers = i + 1;
      if (key === 'todayDeliveryTeamMessage') rowTeamMessage = i + 1;
      if (key === 'guestAllowMultipleOrders') rowAllowMultiple = i + 1;
    }

    if (rowCredit > 0) {
      sheet.getRange(rowCredit, 2).setValue(guestBaseCredit);
    } else {
      sheet.appendRow(['guestBaseCredit', guestBaseCredit]);
    }

    if (rowFee > 0) {
      sheet.getRange(rowFee, 2).setValue(guestDeliveryFee);
    } else {
      sheet.appendRow(['guestDeliveryFee', guestDeliveryFee]);
    }

    if (rowDeliveryPlace > 0) {
      sheet.getRange(rowDeliveryPlace, 2).setValue(guestDefaultDeliveryPlace);
    } else {
      sheet.appendRow(['guestDefaultDeliveryPlace', guestDefaultDeliveryPlace]);
    }

    if (rowTeamEnabled > 0) {
      sheet.getRange(rowTeamEnabled, 2).setValue(todayDeliveryTeamEnabled);
    } else {
      sheet.appendRow(['todayDeliveryTeamEnabled', todayDeliveryTeamEnabled]);
    }

    if (rowTeamTitle > 0) {
      sheet.getRange(rowTeamTitle, 2).setValue(todayDeliveryTeamTitle);
    } else {
      sheet.appendRow(['todayDeliveryTeamTitle', todayDeliveryTeamTitle]);
    }

    if (rowTeamMembers > 0) {
      sheet.getRange(rowTeamMembers, 2).setValue(todayDeliveryTeamMembers);
    } else {
      sheet.appendRow(['todayDeliveryTeamMembers', todayDeliveryTeamMembers]);
    }

    if (rowTeamMessage > 0) {
      sheet.getRange(rowTeamMessage, 2).setValue(todayDeliveryTeamMessage);
    } else {
      sheet.appendRow(['todayDeliveryTeamMessage', todayDeliveryTeamMessage]);
    }

    if (guestAllowMultipleOrders !== undefined) {
      if (rowAllowMultiple > 0) {
        sheet.getRange(rowAllowMultiple, 2).setValue(guestAllowMultipleOrders);
      } else {
        sheet.appendRow(['guestAllowMultipleOrders', guestAllowMultipleOrders]);
      }
    }

    if (data.guestMenuMode !== undefined) {
      upsertSettingValue(sheet, 'guestMenuMode', String(data.guestMenuMode).trim().toLowerCase());
    }
    if (data.guestEventName !== undefined) {
      upsertSettingValue(sheet, 'guestEventName', String(data.guestEventName).trim());
    }

    safeAppendAdminLog('updateGuestSettings', 'settings', 'guestValues', '게스트 설정 변경', '', `크레딧:${guestBaseCredit}, 배달비:${guestDeliveryFee}, 기본배달지:${guestDefaultDeliveryPlace}`, data.adminMemo);
    clearGuestSettingsCache();
    return { success: true, message: '게스트 설정이 저장되었습니다.' };
  } else if (action === 'updateMenuMode') {
    const guestMenuMode = String(data.guestMenuMode || 'normal').trim().toLowerCase();
    const guestEventName = String(data.guestEventName || '장애인식 개선 캠페인').trim();
    upsertSettingValue(sheet, 'guestMenuMode', guestMenuMode);
    if (data.guestEventName !== undefined) {
      upsertSettingValue(sheet, 'guestEventName', guestEventName);
    }
    safeAppendAdminLog('updateGuestSettings', 'settings', 'guestMenuMode', '게스트 메뉴 모드 변경', '', `${guestMenuMode === 'event' ? '행사 모드 (' + guestEventName + ')' : '배달왔삼 기본 모드'}`, data.adminMemo);
    clearGuestSettingsCache();
    return { success: true, message: '게스트 메뉴 모드가 변경되었습니다.' };
  } else {
    return { success: false, message: '알 수 없는 설정 변경 요청입니다.' };
  }

  const values = sheet.getDataRange().getValues();
  let rowOpen = -1;
  let rowCloseAt = -1;

  for (let i = 1; i < values.length; i++) {
    const key = String(values[i][0]).trim();
    if (key === 'guestOpen') rowOpen = i + 1;
    if (key === 'guestCloseAt') rowCloseAt = i + 1;
  }

  if (rowOpen > 0) {
    sheet.getRange(rowOpen, 2).setValue(guestOpen);
  } else {
    sheet.appendRow(['guestOpen', guestOpen]);
  }

  if (rowCloseAt > 0) {
    sheet.getRange(rowCloseAt, 2).setValue(guestCloseAt);
  } else {
    sheet.appendRow(['guestCloseAt', guestCloseAt]);
  }

  safeAppendAdminLog('updateGuestSettings', 'settings', 'guestOpen', '게스트 운영', logBefore, logAfter, data.adminMemo);
  clearGuestSettingsCache();

  return { success: true, message: '게스트 운영 상태가 변경되었습니다.' };
}
