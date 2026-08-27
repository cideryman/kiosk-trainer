/**
 * 20. 게스트 운영 설정 조회
 */
const GUEST_EVENT_NAME_COLORS = ['#E11D48', '#2563EB', '#7C3AED', '#059669', '#D97706', '#1E293B'];

function decodeGuestEventHtmlEntities_(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, function(_, code) { return String.fromCharCode(Number(code)); })
    .replace(/&#x([0-9a-f]+);/gi, function(_, code) { return String.fromCharCode(parseInt(code, 16)); })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function escapeGuestEventHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeGuestEventNameHtml_(rawValue) {
  const source = String(rawValue == null ? '' : rawValue);
  const tokens = source.match(/<[^>]*>|[^<]+/g) || [];
  const segments = [];
  let bold = false;
  let color = '';

  tokens.forEach(function(token) {
    if (token.charAt(0) === '<') {
      const tag = token.trim();
      if (/^<\/?(?:b|strong)\s*>$/i.test(tag)) {
        bold = tag.charAt(1) !== '/';
        return;
      }
      if (/^<\/(?:font|span)\s*>$/i.test(tag)) {
        color = '';
        bold = false;
        return;
      }
      if (/^<(?:br|div)\b/i.test(tag) || /^<\/div\s*>$/i.test(tag)) {
        segments.push({ text: ' ', bold: bold, color: color });
        return;
      }
      if (/^<(?:font|span)\b/i.test(tag)) {
        const colorMatch = tag.match(/(?:color\s*=\s*["']?|color\s*:\s*)(#[0-9a-f]{6})/i);
        const candidate = colorMatch ? colorMatch[1].toUpperCase() : '';
        color = GUEST_EVENT_NAME_COLORS.indexOf(candidate) !== -1 ? candidate : '';
        if (/font-weight\s*:\s*(?:bold|[7-9]00)/i.test(tag)) bold = true;
      }
      return;
    }
    const decoded = decodeGuestEventHtmlEntities_(token).replace(/[\r\n\t]+/g, ' ');
    if (decoded) segments.push({ text: decoded, bold: bold, color: color });
  });

  const visibleText = segments.map(function(segment) { return segment.text; }).join('').replace(/\s+/g, ' ').trim();
  const visibleLength = Array.from(visibleText).length;
  if (visibleLength < 1 || visibleLength > 20) {
    return { success: false, message: '행사명은 1~20자로 입력해 주세요.' };
  }

  let remaining = visibleLength;
  const htmlParts = [];
  segments.forEach(function(segment) {
    if (remaining <= 0) return;
    const chars = Array.from(segment.text.replace(/\s+/g, ' '));
    const text = chars.slice(0, remaining).join('');
    remaining -= chars.length;
    if (!text) return;
    let html = escapeGuestEventHtml_(text);
    if (segment.bold) html = '<strong>' + html + '</strong>';
    if (segment.color) html = '<span style="color:' + segment.color + '">' + html + '</span>';
    htmlParts.push(html);
  });
  return { success: true, html: htmlParts.join('').trim(), text: visibleText };
}

function upsertSettingValue(sheet, key, value) {
  writeSettingValuesBatch(sheet, { [key]: value });
}

function getDefaultGuestSettings() {
  return {
    guestOpen: 'N',
    guestCloseAt: '',
    guestWeeklyScheduleEnabled: 'FALSE',
    guestWeeklyScheduleDay: 3,
    guestWeeklyScheduleStartTime: '13:00',
    guestWeeklyScheduleEndTime: '15:00',
    guestWeeklyScheduleSkipDate: '',
    guestAdditionalSchedulesJson: '[]',
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
  const operatingState = resolveGuestOperatingState(settings, now);
  const eventNameResult = sanitizeGuestEventNameHtml_(settings.guestEventName || '장애인식 개선 캠페인');
  const safeEventName = eventNameResult.success ? eventNameResult.html : '장애인식 개선 캠페인';
  let message = '게스트 주문이 마감되었습니다.';
  if (operatingState.isGuestOpenNow) {
    message = operatingState.effectiveCloseAt
      ? `오늘 ${Utilities.formatDate(operatingState.effectiveCloseAt, GUEST_WEEKLY_SCHEDULE_TIME_ZONE, 'HH:mm')}까지 주문할 수 있습니다.`
      : '배달왔삼 주문이 운영 중입니다.';
  } else if (operatingState.scheduleSuppressedByEvent) {
    message = '행사 모드에서는 예약 운영이 자동으로 열리지 않습니다.';
  } else if (operatingState.targetOccurrenceSkipped) {
    const nextSchedule = operatingState.nextGuestSchedule;
    message = nextSchedule
      ? `이번 정기 운영은 쉬어갑니다. 다음 운영은 ${formatGuestScheduleKoreanDate(nextSchedule.date)} ${nextSchedule.startTime}~${nextSchedule.endTime}입니다.`
      : '이번 정기 운영은 쉬어갑니다.';
  } else if (operatingState.nextGuestSchedule) {
    const nextSchedule = operatingState.nextGuestSchedule;
    message = `다음 운영은 ${formatGuestScheduleKoreanDate(nextSchedule.date)} ${nextSchedule.startTime}~${nextSchedule.endTime}입니다.`;
  } else if (String(settings.guestOpen || 'N').toUpperCase() === 'Y' && settings.guestCloseAt) {
    message = '게스트 주문 운영 시간이 종료되었습니다.';
  }

  return {
    success: true,
    guestOpen: settings.guestOpen,
    guestCloseAt: settings.guestCloseAt,
    guestWeeklyScheduleEnabled: operatingState.weeklyEnabled,
    guestWeeklyScheduleDay: operatingState.weekday,
    guestWeeklyScheduleDayName: operatingState.weekdayName,
    guestWeeklyScheduleStartTime: operatingState.startTime,
    guestWeeklyScheduleEndTime: operatingState.endTime,
    guestWeeklyScheduleSkipDate: operatingState.skipDate,
    guestWeeklyScheduleTargetDate: operatingState.targetScheduleDate,
    guestWeeklyScheduleSkipped: operatingState.targetOccurrenceSkipped,
    guestWeeklyScheduleSuppressedByEvent: operatingState.scheduleSuppressedByEvent,
    guestAdditionalSchedules: operatingState.additionalSchedules,
    activeGuestAdditionalScheduleIds: operatingState.activeAdditionalScheduleIds,
    guestOpenSource: operatingState.guestOpenSource,
    effectiveGuestCloseAt: operatingState.effectiveCloseAt ? operatingState.effectiveCloseAt.toISOString() : '',
    guestCompletionGraceCloseAt: operatingState.completionGraceCloseAt ? operatingState.completionGraceCloseAt.toISOString() : '',
    nextGuestOpenAt: operatingState.nextScheduledOpenAt ? operatingState.nextScheduledOpenAt.toISOString() : '',
    nextGuestSchedule: operatingState.nextGuestSchedule,
    nextGuestStateChangeAt: operatingState.nextStateChangeAt ? operatingState.nextStateChangeAt.toISOString() : '',
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
    guestEventName: safeEventName,
    guestEventEmblemBase64: settings.guestEventEmblemBase64 || '',
    guestOrderGraceMinutes: GUEST_ORDER_COMPLETION_GRACE_MINUTES,
    isGuestOpenNow: operatingState.isGuestOpenNow,
    remainingSeconds: operatingState.remainingSeconds,
    message
  };
}

function canCompleteStartedGuestOrder(settings, orderStartedAt, nowValue) {
  if (!settings) return false;
  if (settings.isGuestOpenNow) return true;
  if (!settings.guestCompletionGraceCloseAt || !orderStartedAt) return false;

  const closeAt = new Date(settings.guestCompletionGraceCloseAt);
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
  return startedAt.getTime() < closeAt.getTime() && now.getTime() <= graceEndsAt.getTime();
}

function readGuestSettingsFromSheet(sheet) {
  const settings = getDefaultGuestSettings();
  if (sheet && sheet.getLastRow() > 1) {
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    values.forEach(row => {
      const key = String(row[0] || '').trim();
      if (key) settings[key] = row[1];
    });
  }
  return settings;
}

function getGuestSettings() {
  const cachedSettings = getGuestSettingsCache();
  if (cachedSettings) {
    return buildGuestSettingsResponse(cachedSettings);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.SETTINGS);
  const settings = readGuestSettingsFromSheet(sheet);

  setGuestSettingsCache(settings);
  return buildGuestSettingsResponse(settings);
}

function getGuestAdditionalSchedulesForMutation(settings) {
  const rawValue = settings && settings.guestAdditionalSchedulesJson;
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return { success: true, schedules: [] };
  }
  let parsed;
  try {
    parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
  } catch (error) {
    return { success: false, message: '추가 운영 일정 데이터가 손상되어 있습니다. 원본을 확인해 주세요.' };
  }
  if (!Array.isArray(parsed)) {
    return { success: false, message: '추가 운영 일정 형식이 올바르지 않습니다.' };
  }
  const schedules = normalizeGuestAdditionalSchedules(parsed);
  if (schedules.length !== parsed.length) {
    return { success: false, message: '추가 운영 일정에 잘못되거나 중복된 값이 있습니다. 원본을 확인해 주세요.' };
  }
  return { success: true, schedules };
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
  const currentSettings = readGuestSettingsFromSheet(sheet);
  const currentOperatingState = resolveGuestOperatingState(currentSettings, now);
  let guestOpen = 'N';
  let guestCloseAt = '';
  let logBefore = 'N';
  let logAfter = 'N';

  if (['open20', 'open30', 'open60', 'openCustom', 'openUntil'].includes(action) && currentOperatingState.todayOccurrenceSkipped) {
    return { success: false, message: '이번 회차 운영 중단을 먼저 해제해 주세요.' };
  }

  if (action === 'openUntil') {
    const closeTime = normalizeGuestScheduleTime(data.guestManualEndTime, '');
    const closeInstant = closeTime ? buildGuestScheduleInstant(getGuestScheduleDateKey(now), closeTime) : null;
    if (!closeInstant || closeInstant.getTime() <= now.getTime()) {
      return { success: false, message: '오늘 현재 시각보다 늦은 종료 시각을 선택해 주세요.' };
    }
    guestOpen = 'Y';
    guestCloseAt = closeInstant.toISOString();
    logAfter = `Y (오늘 ${closeTime}까지)`;
  } else if (action === 'open20') {
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
    const closeUpdates = { guestOpen, guestCloseAt: '' };
    if (currentOperatingState.weeklyActive) {
      closeUpdates.guestWeeklyScheduleSkipDate = getGuestScheduleDateKey(now);
      logAfter += ` · 이번 ${currentOperatingState.weekdayName} 정기 운영 종료`;
    }
    if (currentOperatingState.activeAdditionalScheduleIds.length > 0) {
      const additionalState = getGuestAdditionalSchedulesForMutation(currentSettings);
      if (!additionalState.success) return additionalState;
      const activeIds = currentOperatingState.activeAdditionalScheduleIds;
      const remaining = additionalState.schedules.filter(item => !activeIds.includes(item.scheduleId));
      closeUpdates.guestAdditionalSchedulesJson = JSON.stringify(remaining);
      logAfter += ' · 활성 추가 운영 취소';
    }
    writeSettingValuesBatch(sheet, closeUpdates);
    safeAppendAdminLog('updateGuestSettings', 'settings', 'guestOpen', '게스트 운영', logBefore, logAfter, data.adminMemo);
    clearGuestSettingsCache();
    return { success: true, message: (currentOperatingState.weeklyActive || currentOperatingState.additionalActive) ? '현재 일정 운영을 마감했습니다.' : '게스트 주문을 즉시 마감했습니다.' };
  } else if (action === 'updateWeeklySchedule') {
    const enabled = parseSettingBoolean(data.guestWeeklyScheduleEnabled, false);
    const weekday = Number(data.guestWeeklyScheduleDay);
    const startTime = String(data.guestWeeklyScheduleStartTime || '').trim();
    const endTime = String(data.guestWeeklyScheduleEndTime || '').trim();
    if (!GUEST_WEEKLY_SCHEDULE_ALLOWED_DAYS.includes(weekday)) {
      return { success: false, message: '정기 운영 요일은 월요일부터 금요일 중에서 선택해 주세요.' };
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) {
      return { success: false, message: '정기 운영 시간을 HH:MM 형식으로 입력해 주세요.' };
    }
    if (getGuestScheduleTimeMinutes(startTime) >= getGuestScheduleTimeMinutes(endTime)) {
      return { success: false, message: '정기 운영 종료 시각은 시작 시각보다 늦어야 합니다.' };
    }
    const updates = {
      guestWeeklyScheduleEnabled: enabled ? 'TRUE' : 'FALSE',
      guestWeeklyScheduleDay: weekday,
      guestWeeklyScheduleStartTime: startTime,
      guestWeeklyScheduleEndTime: endTime
    };
    if (normalizeGuestScheduleWeekday(currentSettings.guestWeeklyScheduleDay) !== weekday) {
      updates.guestWeeklyScheduleSkipDate = '';
    }
    const weekdayName = getGuestScheduleWeekdayName(weekday);
    writeSettingValuesBatch(sheet, updates);
    safeAppendAdminLog('updateGuestSettings', 'settings', 'guestWeeklySchedule', '정기 운영', '', `${enabled ? 'ON' : 'OFF'} ${weekdayName} ${startTime}~${endTime}`, data.adminMemo);
    clearGuestSettingsCache();
    return {
      success: true,
      message: enabled ? `매주 ${weekdayName} ${startTime}~${endTime} 자동 운영을 저장했습니다.` : '정기 자동 운영을 껐습니다.',
      guestWeeklyScheduleEnabled: enabled,
      guestWeeklyScheduleDay: weekday,
      guestWeeklyScheduleStartTime: startTime,
      guestWeeklyScheduleEndTime: endTime
    };
  } else if (action === 'skipWeeklyScheduleOccurrence') {
    if (!currentOperatingState.weeklyEnabled) {
      return { success: false, message: '정기 자동 운영을 먼저 켜 주세요.' };
    }
    const skipDate = currentOperatingState.targetScheduleDate;
    const skipUpdates = { guestWeeklyScheduleSkipDate: skipDate };
    if (skipDate === getGuestScheduleDateKey(now)) {
      skipUpdates.guestOpen = 'N';
      skipUpdates.guestCloseAt = '';
    }
    writeSettingValuesBatch(sheet, skipUpdates);
    safeAppendAdminLog('updateGuestSettings', 'settings', 'guestWeeklyScheduleSkipDate', '정기 운영 회차 중단', '', skipDate, data.adminMemo);
    clearGuestSettingsCache();
    return { success: true, message: `${formatGuestScheduleKoreanDate(skipDate)} 정기 운영을 쉬도록 설정했습니다.`, guestWeeklyScheduleSkipDate: skipDate };
  } else if (action === 'resumeWeeklyScheduleOccurrence') {
    const resumedDate = String(currentSettings.guestWeeklyScheduleSkipDate || '').trim();
    writeSettingValuesBatch(sheet, { guestWeeklyScheduleSkipDate: '' });
    safeAppendAdminLog('updateGuestSettings', 'settings', 'guestWeeklyScheduleSkipDate', '정기 운영 회차 재개', resumedDate, '', data.adminMemo);
    clearGuestSettingsCache();
    return { success: true, message: '정기 운영 중단을 해제했습니다.', guestWeeklyScheduleSkipDate: '' };
  } else if (action === 'upsertAdditionalSchedule') {
    const additionalState = getGuestAdditionalSchedulesForMutation(currentSettings);
    if (!additionalState.success) return additionalState;
    const date = String(data.date || '').trim();
    const startTime = normalizeGuestScheduleTime(data.startTime, '');
    const endTime = normalizeGuestScheduleTime(data.endTime, '');
    const requestedId = String(data.scheduleId || '').trim();
    const todayKey = getGuestScheduleDateKey(now);
    if (!isValidGuestScheduleDateKey(date) || date < todayKey) {
      return { success: false, message: '오늘 이후의 올바른 추가 운영 날짜를 선택해 주세요.' };
    }
    if (!startTime || !endTime || getGuestScheduleTimeMinutes(startTime) >= getGuestScheduleTimeMinutes(endTime)) {
      return { success: false, message: '추가 운영 종료 시각은 시작 시각보다 늦어야 합니다.' };
    }
    const endInstant = buildGuestScheduleInstant(date, endTime);
    if (!endInstant || endInstant.getTime() <= now.getTime()) {
      return { success: false, message: '이미 종료된 시간으로 추가 운영을 등록할 수 없습니다.' };
    }
    const schedules = additionalState.schedules.filter(item => item.date >= todayKey);
    const existingIndex = requestedId ? schedules.findIndex(item => item.scheduleId === requestedId) : -1;
    if (requestedId && existingIndex < 0) {
      return { success: false, message: '수정할 추가 운영 일정을 찾을 수 없습니다.' };
    }
    if (schedules.some(item => item.date === date && item.scheduleId !== requestedId)) {
      return { success: false, message: '같은 날짜에는 추가 운영을 하나만 등록할 수 있습니다.' };
    }
    const scheduleId = requestedId || Utilities.getUuid();
    const schedule = { scheduleId, date, startTime, endTime };
    if (existingIndex >= 0) schedules[existingIndex] = schedule;
    else schedules.push(schedule);
    schedules.sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
    writeSettingValuesBatch(sheet, { guestAdditionalSchedulesJson: JSON.stringify(schedules) });
    safeAppendAdminLog('updateGuestSettings', 'settings', 'guestAdditionalSchedules', requestedId ? '추가 운영 수정' : '추가 운영 등록', '', `${date} ${startTime}~${endTime}`, data.adminMemo);
    clearGuestSettingsCache();
    return { success: true, message: `${formatGuestScheduleKoreanDate(date)} ${startTime}~${endTime} 추가 운영을 저장했습니다.`, schedule };
  } else if (action === 'deleteAdditionalSchedule') {
    const additionalState = getGuestAdditionalSchedulesForMutation(currentSettings);
    if (!additionalState.success) return additionalState;
    const scheduleId = String(data.scheduleId || '').trim();
    const removed = additionalState.schedules.find(item => item.scheduleId === scheduleId);
    if (!removed) return { success: false, message: '취소할 추가 운영 일정을 찾을 수 없습니다.' };
    const schedules = additionalState.schedules.filter(item => item.scheduleId !== scheduleId && item.date >= getGuestScheduleDateKey(now));
    writeSettingValuesBatch(sheet, { guestAdditionalSchedulesJson: JSON.stringify(schedules) });
    safeAppendAdminLog('updateGuestSettings', 'settings', 'guestAdditionalSchedules', '추가 운영 취소', `${removed.date} ${removed.startTime}~${removed.endTime}`, '', data.adminMemo);
    clearGuestSettingsCache();
    return { success: true, message: `${formatGuestScheduleKoreanDate(removed.date)} 추가 운영을 취소했습니다.` };
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
    const eventNameResult = data.guestEventName !== undefined
      ? sanitizeGuestEventNameHtml_(data.guestEventName)
      : null;
    if (eventNameResult && !eventNameResult.success) return eventNameResult;

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
    if (eventNameResult) updates.guestEventName = eventNameResult.html;
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
        ? eventNameResult.html
        : undefined,
      guestEventEmblemBase64: data.guestEventEmblemBase64 !== undefined
        ? String(data.guestEventEmblemBase64 || '').trim()
        : undefined,
    };
  } else if (action === 'updateMenuMode') {
    const guestMenuMode = String(data.guestMenuMode || 'normal').trim().toLowerCase();
    const eventNameResult = sanitizeGuestEventNameHtml_(data.guestEventName || '장애인식 개선 캠페인');
    if (!eventNameResult.success) return eventNameResult;
    const guestEventName = eventNameResult.html;
    const updates = { guestMenuMode };
    if (data.guestEventName !== undefined) updates.guestEventName = guestEventName;
    writeSettingValuesBatch(sheet, updates);
    safeAppendAdminLog('updateGuestSettings', 'settings', 'guestMenuMode', '게스트 메뉴 모드 변경', '', `${guestMenuMode === 'event' ? '행사 모드 (' + eventNameResult.text + ')' : '배달왔삼 기본 모드'}`, data.adminMemo);
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
