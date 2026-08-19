/**
 * 20. 게스트 운영 설정 조회
 */
function upsertSettingValue(sheet, key, value) {
  writeSettingValuesBatch(sheet, { [key]: value });
}

function getDefaultGuestSettings() {
  return {
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
    guestAllowRandomDisplayName: 'TRUE',
    adminOrderEmailNotificationEnabled: 'TRUE',
    guestOrderLimitPolicyVersion: 'creditWalletV1',
    guestMenuMode: 'normal',
    guestEventName: '장애인식 개선 캠페인',
    guestEventEmblemBase64: ''
  };
}

function writeSettingValuesBatch(sheet, updates) {
  let values = sheet.getLastRow() > 0
    ? sheet.getRange(1, 1, sheet.getLastRow(), 2).getValues()
    : [];
  if (values.length === 0 || String(values[0][0] || '').trim() !== 'key') {
    values.unshift(['key', 'value']);
  }
  const rowByKey = {};
  for (let i = 1; i < values.length; i++) {
    const key = String(values[i][0] || '').trim();
    if (key) rowByKey[key] = i;
  }
  Object.keys(updates).forEach(key => {
    if (Object.prototype.hasOwnProperty.call(rowByKey, key)) {
      values[rowByKey[key]][1] = updates[key];
    } else {
      rowByKey[key] = values.length;
      values.push([key, updates[key]]);
    }
  });
  sheet.getRange(1, 1, values.length, 2).setValues(values);
}

function ensureGuestSettingsSchema() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('운영설정 초기화 락을 획득하지 못했습니다.');
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET.SETTINGS);
    if (!sheet) sheet = ss.insertSheet(SHEET.SETTINGS);
    const currentValues = sheet.getLastRow() > 0
      ? sheet.getRange(1, 1, sheet.getLastRow(), 2).getValues()
      : [];
    const existingKeys = {};
    currentValues.slice(1).forEach(row => {
      const key = String(row[0] || '').trim();
      if (key) existingKeys[key] = true;
    });
    const defaults = getDefaultGuestSettings();
    const missing = {};
    Object.keys(defaults).forEach(key => {
      if (!existingKeys[key]) missing[key] = defaults[key];
    });
    if (!existingKeys.guestOrderLimitPolicyVersion) {
      missing.guestAllowMultipleOrders = 'TRUE';
      missing.guestOrderLimitPolicyVersion = 'creditWalletV1';
    }
    writeSettingValuesBatch(sheet, missing);
    clearGuestSettingsCache();
    return { success: true, addedKeys: Object.keys(missing) };
  } finally {
    lock.releaseLock();
  }
}

const GUEST_SETTINGS_CACHE_KEY = 'guestSettings.v1';
const GUEST_SETTINGS_CACHE_TTL_SECONDS = 300;

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

function parseSettingBoolean(val, defaultValue = true) {
  if (val === undefined || val === null || val === '') return defaultValue;
  if (typeof val === 'boolean') return val;
  const s = String(val).trim().toUpperCase();
  if (s === 'FALSE' || s === 'N' || s === '0') return false;
  if (s === 'TRUE' || s === 'Y' || s === '1') return true;
  return defaultValue;
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
    guestDefaultDeliveryPlace: settings.guestDefaultDeliveryPlace === undefined || settings.guestDefaultDeliveryPlace === null
      ? '사무실 원탁'
      : String(settings.guestDefaultDeliveryPlace),
    todayDeliveryTeamEnabled: parseSettingBoolean(settings.todayDeliveryTeamEnabled, true),
    todayDeliveryTeamTitle: settings.todayDeliveryTeamTitle || '📦 오늘의 배달팀',
    todayDeliveryTeamMembers: settings.todayDeliveryTeamMembers || '',
    todayDeliveryTeamMessage: settings.todayDeliveryTeamMessage || '',
    guestAllowMultipleOrders: parseSettingBoolean(settings.guestAllowMultipleOrders, true),
    guestAllowRandomDisplayName: parseSettingBoolean(settings.guestAllowRandomDisplayName, true),
    adminOrderEmailNotificationEnabled: parseSettingBoolean(settings.adminOrderEmailNotificationEnabled, true),
    guestMenuMode: String(settings.guestMenuMode || 'normal').toLowerCase(),
    guestEventName: settings.guestEventName || '장애인식 개선 캠페인',
    guestEventEmblemBase64: settings.guestEventEmblemBase64 || '',
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
  const sheet = ss.getSheetByName(SHEET.SETTINGS);
  const settings = getDefaultGuestSettings();
  if (sheet && sheet.getLastRow() > 1) {
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    values.forEach(row => {
      const key = String(row[0] || '').trim();
      if (key) settings[key] = row[1];
    });
  }

  setGuestSettingsCache(settings);
  return buildGuestSettingsResponse(settings);
}

/**
 * 21. 게스트 운영 설정 변경
 */
function updateGuestSettings(data) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, message: '다른 설정 변경을 처리 중입니다. 잠시 후 다시 시도해 주세요.' };
  }
  try {
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
    const guestAllowMultipleOrders = data.guestAllowMultipleOrders !== undefined ? (parseSettingBoolean(data.guestAllowMultipleOrders, true) ? 'TRUE' : 'FALSE') : undefined;
    const guestAllowRandomDisplayName = data.guestAllowRandomDisplayName !== undefined ? (parseSettingBoolean(data.guestAllowRandomDisplayName, true) ? 'TRUE' : 'FALSE') : undefined;
    const adminOrderEmailNotificationEnabled = data.adminOrderEmailNotificationEnabled !== undefined ? (parseSettingBoolean(data.adminOrderEmailNotificationEnabled, true) ? 'TRUE' : 'FALSE') : undefined;

    const updates = {
      guestBaseCredit,
      guestDeliveryFee,
      guestDefaultDeliveryPlace,
      todayDeliveryTeamEnabled,
      todayDeliveryTeamTitle,
      todayDeliveryTeamMembers,
      todayDeliveryTeamMessage
    };
    if (guestAllowMultipleOrders !== undefined) updates.guestAllowMultipleOrders = guestAllowMultipleOrders;
    if (guestAllowRandomDisplayName !== undefined) updates.guestAllowRandomDisplayName = guestAllowRandomDisplayName;
    if (adminOrderEmailNotificationEnabled !== undefined) updates.adminOrderEmailNotificationEnabled = adminOrderEmailNotificationEnabled;
    if (data.guestMenuMode !== undefined) updates.guestMenuMode = String(data.guestMenuMode).trim().toLowerCase();
    if (data.guestEventName !== undefined) updates.guestEventName = String(data.guestEventName).trim();
    if (data.guestEventEmblemBase64 !== undefined) updates.guestEventEmblemBase64 = String(data.guestEventEmblemBase64).trim();
    writeSettingValuesBatch(sheet, updates);

    safeAppendAdminLog('updateGuestSettings', 'settings', 'guestValues', '게스트 설정 변경', '', `온기:${guestBaseCredit}, 배달비:${guestDeliveryFee}, 기본배달지:${guestDefaultDeliveryPlace}`, data.adminMemo);
    clearGuestSettingsCache();
    return {
      success: true,
      message: '게스트 설정이 저장되었습니다.',
      guestBaseCredit: Number(guestBaseCredit || 10),
      guestDeliveryFee: Number(guestDeliveryFee || 3),
      guestDefaultDeliveryPlace: guestDefaultDeliveryPlace === undefined || guestDefaultDeliveryPlace === null
        ? '사무실 원탁'
        : String(guestDefaultDeliveryPlace),
      todayDeliveryTeamEnabled: parseSettingBoolean(todayDeliveryTeamEnabled, true),
      todayDeliveryTeamTitle,
      todayDeliveryTeamMembers,
      todayDeliveryTeamMessage,
      guestAllowRandomDisplayName: guestAllowRandomDisplayName === undefined
        ? true
        : parseSettingBoolean(guestAllowRandomDisplayName, true),
      adminOrderEmailNotificationEnabled: adminOrderEmailNotificationEnabled === undefined
        ? true
        : parseSettingBoolean(adminOrderEmailNotificationEnabled, true),
      guestMenuMode: data.guestMenuMode !== undefined
        ? String(data.guestMenuMode || 'normal').trim().toLowerCase()
        : undefined,
      guestEventName: data.guestEventName !== undefined
        ? String(data.guestEventName || '장애인식 개선 캠페인').trim()
        : undefined,
      guestEventEmblemBase64: data.guestEventEmblemBase64 !== undefined
        ? String(data.guestEventEmblemBase64 || '').trim()
        : undefined,
    };
  } else if (action === 'updateMenuMode') {
    const guestMenuMode = String(data.guestMenuMode || 'normal').trim().toLowerCase();
    const guestEventName = String(data.guestEventName || '장애인식 개선 캠페인').trim();
    const updates = { guestMenuMode };
    if (data.guestEventName !== undefined) updates.guestEventName = guestEventName;
    writeSettingValuesBatch(sheet, updates);
    safeAppendAdminLog('updateGuestSettings', 'settings', 'guestMenuMode', '게스트 메뉴 모드 변경', '', `${guestMenuMode === 'event' ? '행사 모드 (' + guestEventName + ')' : '배달왔삼 기본 모드'}`, data.adminMemo);
    clearGuestSettingsCache();
    return { success: true, message: '게스트 메뉴 모드가 변경되었습니다.' };
  } else {
    return { success: false, message: '알 수 없는 설정 변경 요청입니다.' };
  }

  writeSettingValuesBatch(sheet, { guestOpen, guestCloseAt });

  safeAppendAdminLog('updateGuestSettings', 'settings', 'guestOpen', '게스트 운영', logBefore, logAfter, data.adminMemo);
  clearGuestSettingsCache();

  return { success: true, message: '게스트 운영 상태가 변경되었습니다.' };
  } finally {
    lock.releaseLock();
  }
}
