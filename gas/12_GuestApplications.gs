const GUEST_APPLICATION_HEADERS = [
  'createdAt',
  'applicationId',
  'requestId',
  'name',
  'relationType',
  'relationDetail',
  'phone',
  'deliveryPlace',
  'deliveryDetail',
  'preferredDays',
  'message',
  'consentAt',
  'status',
  'contactedAt',
  'reviewedAt',
  'retentionUntil',
  'anonymizedAt',
  'adminMemo',
  'waitlistPosition',
  'skipUntil',
  'cooldownUntil',
  'updatedAt',
];

const GUEST_APPLICATION_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  INACTIVE: 'INACTIVE',
  WAITLIST: 'WAITLIST',
};

const GUEST_APPLICATION_RETENTION_DAYS = 30;
const GUEST_APPLICATION_DEFAULT_CAPACITY = 5;
const GUEST_APPLICATION_MAX_CAPACITY = 100;
const GUEST_APPLICATION_DEFAULT_COOLDOWN_WEEKS = 2;
const GUEST_APPLICATION_DEFAULT_WAITLIST_LIMIT = 100;
const GUEST_APPLICATION_DATE_HEADERS = [
  'createdAt', 'consentAt', 'contactedAt', 'reviewedAt',
  'retentionUntil', 'anonymizedAt', 'skipUntil', 'cooldownUntil', 'updatedAt'
];
const GUEST_APPLICATION_SETTINGS_CACHE_KEY = 'guestApplicationSettings.v4';
const GUEST_APPLICATION_SETTINGS_CACHE_TTL_SECONDS = 30;
const GUEST_APPLICATION_SETTINGS_DEFAULTS = {
  guestApplicationOpen: 'N',
  guestApplicationTarget: '영주시장애인복지관 봉사자·후원자와 관리자가 이용 가능하다고 인정한 관계자',
  guestApplicationOperatingDays: '매주 수요일',
  guestApplicationOrderTime: '운영일 오전 10시부터 오전 11시 30분까지\n\n운영 일정에 따라 주문 시간이 달라질 수 있으며, 정확한 시간은 별도로 안내합니다.',
  guestApplicationDeliveryTime: '오후 1시부터 주문 확인 순서에 따라 배달합니다.',
  guestApplicationArea: '복지관과 사전에 협의된 장소',
  guestApplicationUsage: '이용 신청과 관리자 확인을 완료한 뒤, 안내받은 배달왔삼 주문 페이지에서 직접 주문합니다.',
  guestApplicationDayOptions: '수요일',
  guestApplicationCapacity: String(GUEST_APPLICATION_DEFAULT_CAPACITY),
  guestApplicationClosedMessage: '현재 이용 신청을 받고 있지 않습니다. 기관 담당자에게 문의해 주세요.',
  guestApplicationCooldownWeeks: String(GUEST_APPLICATION_DEFAULT_COOLDOWN_WEEKS),
  guestApplicationWaitlistLimit: String(GUEST_APPLICATION_DEFAULT_WAITLIST_LIMIT),
  guestApplicationSchedulingMode: 'MANUAL',
  guestApplicationPaused: 'N',
  guestApplicationPauseWeek: '',
  guestApplicationPauseReason: '',
  guestApplicationEmailNotificationEnabled: 'N',
};
const GUEST_APPLICATION_SETTINGS_LEGACY_DEFAULTS = {
  guestApplicationTarget: '복지관 봉사자·후원자와 관리자가 인정하는 기타 관계자',
  guestApplicationOperatingDays: '운영일 별도 안내',
  guestApplicationOrderTime: '운영일에 별도 안내',
  guestApplicationDeliveryTime: '주문 확인 후 순차 배달',
  guestApplicationArea: '복지관과 협의된 장소',
  guestApplicationUsage: '승인 후 안내받은 배달왔삼 주문 페이지에서 직접 주문',
  guestApplicationDayOptions: '월요일,화요일,수요일,목요일,금요일',
};

// ─── 유틸리티: 자정 기준 날짜 비교 ───

function isDateBeforeOrEqual(dateValue, now) {
  if (!dateValue) return true;
  var d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (isNaN(d.getTime())) return true;
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return target <= today;
}

// ─── 유틸리티: 대기 순번 재계산 공통 함수 ───

function reindexWaitlistPositions(table) {
  var position = 0;
  for (var i = 0; i < table.rows.length; i++) {
    var row = table.rows[i];
    var status = String(row[table.map.status] || '').trim();
    var anonymized = table.map.anonymizedAt !== undefined && Boolean(row[table.map.anonymizedAt]);
    if (status === GUEST_APPLICATION_STATUS.WAITLIST && !anonymized) {
      position++;
      row[table.map.waitlistPosition] = position;
    } else if (table.map.waitlistPosition !== undefined) {
      row[table.map.waitlistPosition] = '';
    }
  }
}

// ─── 시트 관리 ───

function ensureGuestApplicationSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET.GUEST_APPLICATIONS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET.GUEST_APPLICATIONS);
  }

  const lastColumn = sheet.getLastColumn();
  const currentHeaders = lastColumn > 0
    ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(value => String(value || '').trim())
    : [];
  const headers = currentHeaders.filter(Boolean);
  let modified = headers.length === 0;

  GUEST_APPLICATION_HEADERS.forEach(header => {
    if (headers.indexOf(header) === -1) {
      headers.push(header);
      modified = true;
    }
  });

  if (modified) {
    if (sheet.getMaxColumns() < headers.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
    }
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  if (modified) {
    formatGuestApplicationSheet(sheet, headers);
  }

  return sheet;
}

function formatGuestApplicationSheet(sheet, headers) {
  sheet.setFrozenRows(1);
  GUEST_APPLICATION_DATE_HEADERS.forEach(header => {
    const column = headers.indexOf(header) + 1;
    if (column > 0) {
      sheet.getRange(2, column, Math.max(sheet.getMaxRows() - 1, 1), 1)
        .setNumberFormat('yyyy. m. d. hh:mm:ss');
    }
  });
}

// GAS 편집기에서 신규 시트를 먼저 만들고 헤더를 점검할 때 실행합니다.
function setupGuestApplicationSheet() {
  const sheet = ensureGuestApplicationSheet();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(value => String(value || '').trim());
  formatGuestApplicationSheet(sheet, headers);
  const migratedSettingsCount = migrateGuestApplicationLegacySettings();
  return '이용신청 시트 준비 완료: ' + sheet.getName() + ' / ' + GUEST_APPLICATION_HEADERS.length
    + '열 / 신청 설정 보정 ' + migratedSettingsCount + '건';
}

function getGuestApplicationHeaderMap(headers) {
  const map = {};
  (headers || []).forEach((header, index) => {
    const key = String(header || '').trim();
    if (key) map[key] = index;
  });
  return map;
}

function getGuestApplicationRows(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 1 || lastColumn < 1) {
    return { headers: [], map: {}, rows: [] };
  }
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map(value => String(value || '').trim());
  return {
    headers,
    map: getGuestApplicationHeaderMap(headers),
    rows: values.slice(1),
  };
}

function guestApplicationDateToIso(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function protectGuestApplicationSheetValue(value) {
  return typeof value === 'string' && /^[=+\-@]/.test(value) ? "'" + value : value;
}

function unprotectGuestApplicationSheetValue(value) {
  return typeof value === 'string' && /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}

function guestApplicationRowToObject(row, map) {
  const result = {};
  GUEST_APPLICATION_HEADERS.forEach(header => {
    const index = map[header];
    const value = index === undefined ? '' : row[index];
    result[header] = unprotectGuestApplicationSheetValue(value);
  });
  GUEST_APPLICATION_DATE_HEADERS.forEach(header => {
    result[header] = guestApplicationDateToIso(result[header]);
  });
  return result;
}

function guestApplicationObjectToRow(object, headers) {
  return headers.map(header => {
    const value = object[header] === undefined ? '' : object[header];
    if (!value || GUEST_APPLICATION_DATE_HEADERS.indexOf(header) === -1 || value instanceof Date) {
      return protectGuestApplicationSheetValue(value);
    }
    const date = new Date(value);
    return isNaN(date.getTime()) ? value : date;
  });
}

// ─── 설정 시트 ───

function getGuestApplicationSettingsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET.SETTINGS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET.SETTINGS);
    sheet.appendRow(['key', 'value']);
  }
  return sheet;
}

function readGuestApplicationSettings() {
  const sheet = getGuestApplicationSettingsSheet();
  const values = sheet.getDataRange().getValues();
  const settings = Object.assign({}, GUEST_APPLICATION_SETTINGS_DEFAULTS);
  const existingKeys = {};

  values.slice(1).forEach(row => {
    const key = String(row[0] || '').trim();
    if (!key) return;
    existingKeys[key] = true;
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      settings[key] = unprotectGuestApplicationSheetValue(row[1]);
    }
  });

  const missingRows = Object.keys(GUEST_APPLICATION_SETTINGS_DEFAULTS)
    .filter(key => !existingKeys[key])
    .map(key => [key, GUEST_APPLICATION_SETTINGS_DEFAULTS[key]]);
  if (missingRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, missingRows.length, 2).setValues(missingRows);
  }

  return settings;
}

// 명시적으로 초기화 함수를 실행했을 때만 예전 기본 문구를 최신 기본값으로 옮깁니다.
// 관리자가 직접 저장한 다른 값은 건드리지 않습니다.
function migrateGuestApplicationLegacySettings() {
  const sheet = getGuestApplicationSettingsSheet();
  const values = sheet.getDataRange().getValues();
  const existingValues = {};

  values.slice(1).forEach(row => {
    const key = String(row[0] || '').trim();
    if (key) existingValues[key] = unprotectGuestApplicationSheetValue(row[1]);
  });

  const valuesToWrite = {};
  Object.keys(GUEST_APPLICATION_SETTINGS_DEFAULTS).forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(existingValues, key)) {
      valuesToWrite[key] = GUEST_APPLICATION_SETTINGS_DEFAULTS[key];
      return;
    }

    if (
      Object.prototype.hasOwnProperty.call(GUEST_APPLICATION_SETTINGS_LEGACY_DEFAULTS, key)
      && String(existingValues[key] || '') === String(GUEST_APPLICATION_SETTINGS_LEGACY_DEFAULTS[key])
    ) {
      valuesToWrite[key] = GUEST_APPLICATION_SETTINGS_DEFAULTS[key];
    }
  });

  const migratedKeys = Object.keys(valuesToWrite);
  if (migratedKeys.length > 0) {
    setGuestApplicationSettingsValues(valuesToWrite);
    clearGuestApplicationSettingsCache();
  }
  return migratedKeys.length;
}

function parseGuestApplicationDayOptions(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\n,]/);
  const result = [];
  source.forEach(item => {
    const day = String(item || '').trim().slice(0, 20);
    if (day && result.indexOf(day) === -1) result.push(day);
  });
  return result.slice(0, 10);
}

function getGuestApplicationObjects(table) {
  return table.rows
    .filter(row => String(row[table.map.applicationId] || '').trim())
    .map(row => guestApplicationRowToObject(row, table.map));
}

// ─── 정원 & 대기 집계 ───

function isGuestApplicationCapacityStatus(status) {
  const normalized = String(status || '').trim().toUpperCase();
  return normalized === GUEST_APPLICATION_STATUS.PENDING || normalized === GUEST_APPLICATION_STATUS.APPROVED;
}

function parseGuestApplicationCapacity(value) {
  const capacity = Number(String(value === undefined || value === null ? '' : value).trim());
  return Number.isInteger(capacity) && capacity >= 1 && capacity <= GUEST_APPLICATION_MAX_CAPACITY
    ? capacity
    : null;
}

function getGuestApplicationCapacity(value) {
  return parseGuestApplicationCapacity(value) || GUEST_APPLICATION_DEFAULT_CAPACITY;
}

function getGuestApplicationWaitlistLimit(settings) {
  var limit = Number(String(settings.guestApplicationWaitlistLimit || '').trim());
  return Number.isInteger(limit) && limit >= 1 ? limit : GUEST_APPLICATION_DEFAULT_WAITLIST_LIMIT;
}

function getGuestApplicationCapacityState(applications, capacityValue) {
  const capacity = getGuestApplicationCapacity(capacityValue);
  var activeCount = 0;
  var waitlistCount = 0;
  for (var i = 0; i < (applications || []).length; i++) {
    const application = applications[i];
    if (application.anonymizedAt) continue;
    const status = String(application.status || '').trim().toUpperCase();
    if (status === GUEST_APPLICATION_STATUS.WAITLIST) {
      waitlistCount++;
    } else if (isGuestApplicationCapacityStatus(status)) {
      activeCount++;
    }
  }
  const remainingSlots = Math.max(0, capacity - activeCount);
  return {
    capacity,
    activeCount,
    waitlistCount,
    remainingSlots,
    applicationFull: remainingSlots === 0,
  };
}

function buildGuestApplicationSettingsResponse(settings, capacityState) {
  const configuredOpen = String(settings.guestApplicationOpen || 'N').toUpperCase() === 'Y';
  const capacity = capacityState || getGuestApplicationCapacityState([], settings.guestApplicationCapacity);
  const applicationFull = capacity.applicationFull === true;
  const waitlistLimit = getGuestApplicationWaitlistLimit(settings);
  const waitlistFull = capacity.waitlistCount >= waitlistLimit;
  // 모집 인원은 안내용 수치입니다. 신청 접수와 승인 여부를 제한하지 않습니다.
  const applicationOpen = configuredOpen;
  const waitlistActive = false;
  const configuredClosedMessage = String(settings.guestApplicationClosedMessage || '');
  var applicationClosedReason = '';
  if (!configuredOpen) applicationClosedReason = 'MANUAL';
  return {
    success: true,
    applicationOpen,
    applicationOpenConfigured: configuredOpen,
    applicationFull: false,
    capacityReached: applicationFull,
    capacityMode: 'ADVISORY',
    waitlistActive,
    waitlistFull: false,
    waitlistCount: capacity.waitlistCount,
    waitlistLimit,
    schedulingMode: String(settings.guestApplicationSchedulingMode || 'MANUAL').toUpperCase() === 'AUTO' ? 'AUTO' : 'MANUAL',
    paused: String(settings.guestApplicationPaused || 'N').toUpperCase() === 'Y',
    pauseWeek: String(settings.guestApplicationPauseWeek || ''),
    pauseReason: String(settings.guestApplicationPauseReason || ''),
    emailNotificationEnabled: String(settings.guestApplicationEmailNotificationEnabled || 'N').toUpperCase() === 'Y',
    applicationClosedReason,
    capacity: capacity.capacity,
    activeCount: capacity.activeCount,
    remainingSlots: null,
    cooldownWeeks: Number(settings.guestApplicationCooldownWeeks) || GUEST_APPLICATION_DEFAULT_COOLDOWN_WEEKS,
    target: String(settings.guestApplicationTarget || ''),
    operatingDays: String(settings.guestApplicationOperatingDays || ''),
    orderTime: String(settings.guestApplicationOrderTime || ''),
    deliveryTime: String(settings.guestApplicationDeliveryTime || ''),
    serviceArea: String(settings.guestApplicationArea || ''),
    usageGuide: String(settings.guestApplicationUsage || ''),
    preferredDayOptions: parseGuestApplicationDayOptions(settings.guestApplicationDayOptions),
    closedMessage: configuredClosedMessage,
    configuredClosedMessage,
  };
}

function getGuestApplicationSettings() {
  try {
    const cache = CacheService.getScriptCache();
    const cached = cache.get(GUEST_APPLICATION_SETTINGS_CACHE_KEY);
    if (cached) return JSON.parse(cached);

    const table = getGuestApplicationRows(ensureGuestApplicationSheet());
    const applications = getGuestApplicationObjects(table);
    const settings = readGuestApplicationSettings();
    const response = buildGuestApplicationSettingsResponse(
      settings,
      getGuestApplicationCapacityState(applications, settings.guestApplicationCapacity)
    );
    cache.put(
      GUEST_APPLICATION_SETTINGS_CACHE_KEY,
      JSON.stringify(response),
      GUEST_APPLICATION_SETTINGS_CACHE_TTL_SECONDS
    );
    return response;
  } catch (error) {
    return {
      success: false,
      applicationOpen: false,
      message: '이용 신청 안내를 불러오지 못했습니다.',
    };
  }
}

function clearGuestApplicationSettingsCache() {
  try {
    CacheService.getScriptCache().remove(GUEST_APPLICATION_SETTINGS_CACHE_KEY);
  } catch (error) {
    // 캐시 삭제 실패가 설정 저장 결과를 되돌리지는 않습니다.
  }
}

function cleanGuestApplicationText(value, maxLength) {
  const text = String(value === undefined || value === null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, maxLength);
}

function normalizeGuestApplicationPhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeGuestApplicationRelationType(value) {
  const normalized = String(value || '').trim().toUpperCase();
  const aliases = {
    '봉사자': 'VOLUNTEER',
    '후원자': 'SPONSOR',
    '기타': 'OTHER',
  };
  return aliases[normalized] || normalized;
}

function validateGuestApplication(data) {
  if (cleanGuestApplicationText(data.website, 200)) {
    return { success: false, message: '신청을 처리할 수 없습니다.' };
  }

  const lengthLimits = {
    name: 30,
    relationDetail: 80,
    deliveryPlace: 80,
    deliveryDetail: 160,
    message: 300,
  };
  const overLimitField = Object.keys(lengthLimits).find(field => String(data[field] || '').trim().length > lengthLimits[field]);
  if (overLimitField) {
    return { success: false, message: '입력 내용이 너무 깁니다. 각 항목의 글자 수를 줄여 주세요.' };
  }
  if (JSON.stringify(data.preferredDays || '').length > 240) {
    return { success: false, message: '이용 희망 요일 정보가 너무 깁니다.' };
  }

  const requestId = String(data.requestId || '').trim();
  const name = cleanGuestApplicationText(data.name, 30);
  const relationType = normalizeGuestApplicationRelationType(data.relationType);
  const relationDetail = cleanGuestApplicationText(data.relationDetail, 80);
  const phone = normalizeGuestApplicationPhone(data.phone);
  const deliveryPlace = cleanGuestApplicationText(data.deliveryPlace, 80);
  const deliveryDetail = cleanGuestApplicationText(data.deliveryDetail, 160);
  const message = cleanGuestApplicationText(data.message, 300);
  const preferredDays = parseGuestApplicationDayOptions(data.preferredDays).join(', ');
  const consent = data.consent === true || String(data.consent || '').toUpperCase() === 'TRUE' || String(data.consent || '').toUpperCase() === 'Y';

  if (!/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) {
    return { success: false, message: '신청 요청 정보가 올바르지 않습니다. 페이지를 새로 열어 다시 시도해 주세요.' };
  }
  if (!name) return { success: false, message: '이름을 입력해 주세요.' };
  if (['VOLUNTEER', 'SPONSOR', 'OTHER'].indexOf(relationType) === -1) {
    return { success: false, message: '복지관과의 관계를 선택해 주세요.' };
  }
  if (!/^0\d{8,10}$/.test(phone)) {
    return { success: false, message: '연락처를 숫자로 정확히 입력해 주세요.' };
  }
  if (!deliveryPlace) return { success: false, message: '배달받을 장소를 입력해 주세요.' };
  if (!preferredDays) return { success: false, message: '이용 희망 요일을 하나 이상 선택해 주세요.' };
  if (!consent) return { success: false, message: '개인정보 수집·이용에 동의해 주세요.' };

  return {
    success: true,
    value: {
      requestId,
      name,
      relationType,
      relationDetail: '',
      phone,
      deliveryPlace,
      deliveryDetail: '',
      preferredDays,
      message: '',
    },
  };
}

function createGuestApplicationId(rows, map, now) {
  const dateKey = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd');
  const prefix = 'APP-' + dateKey + '-';
  let maxSequence = 0;
  rows.forEach(row => {
    const applicationId = String(row[map.applicationId] || '');
    if (applicationId.indexOf(prefix) !== 0) return;
    const sequence = Number(applicationId.slice(prefix.length));
    if (!isNaN(sequence)) maxSequence = Math.max(maxSequence, sequence);
  });
  return prefix + String(maxSequence + 1).padStart(3, '0');
}

// ─── 신청 접수 ───

function submitGuestApplication(data) {
  const validation = validateGuestApplication(data || {});
  if (!validation.success) return validation;
  const input = validation.value;
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    const sheet = ensureGuestApplicationSheet();
    const table = getGuestApplicationRows(sheet);

    for (let index = 0; index < table.rows.length; index++) {
      const row = table.rows[index];
      if (String(row[table.map.requestId] || '') === input.requestId) {
        const existingStatus = String(row[table.map.status] || GUEST_APPLICATION_STATUS.PENDING);
        const existingPosition = String(row[table.map.waitlistPosition] || '');
        const result = {
          success: true,
          idempotent: true,
          applicationId: String(row[table.map.applicationId] || ''),
          status: existingStatus,
          message: '이미 접수된 신청 결과를 확인했습니다.',
        };
        if (existingStatus === GUEST_APPLICATION_STATUS.WAITLIST && existingPosition) {
          result.waitlistPosition = Number(existingPosition);
        }
        return result;
      }
    }

    const applications = getGuestApplicationObjects(table);
    const storedSettings = readGuestApplicationSettings();
    const capacityState = getGuestApplicationCapacityState(applications, storedSettings.guestApplicationCapacity);
    const currentSettings = buildGuestApplicationSettingsResponse(storedSettings, capacityState);
    if (!currentSettings.applicationOpenConfigured) {
      return {
        success: false,
        code: 'APPLICATION_CLOSED',
        message: currentSettings.closedMessage || '현재 이용 신청을 받고 있지 않습니다.',
      };
    }

    const requestedDays = parseGuestApplicationDayOptions(input.preferredDays);
    const allowedDays = currentSettings.preferredDayOptions || [];
    if (requestedDays.some(day => allowedDays.indexOf(day) === -1)) {
      return {
        success: false,
        code: 'INVALID_PREFERRED_DAY',
        message: '선택한 희망 요일이 현재 신청 안내와 다릅니다. 페이지를 새로고침해 주세요.',
      };
    }

    for (let index = 0; index < table.rows.length; index++) {
      const row = table.rows[index];
      const anonymizedAt = row[table.map.anonymizedAt];
      const storedPhone = normalizeGuestApplicationPhone(row[table.map.phone]);
      if (!anonymizedAt && storedPhone && storedPhone === input.phone) {
        return {
          success: false,
          code: 'DUPLICATE_PHONE',
          message: '이미 접수된 신청이 있습니다. 처리 상태는 기관 담당자에게 문의해 주세요.',
        };
      }
    }

    const now = new Date();
    const applicationId = createGuestApplicationId(table.rows, table.map, now);

    // 모집 안내 인원과 관계없이 신규 신청은 검토 대기로 접수합니다.
    var targetStatus = GUEST_APPLICATION_STATUS.PENDING;
    var waitlistPosition = '';
    var message = '이용 신청이 접수되었습니다. 관리자가 확인 후 연락드립니다.';

    const application = {
      createdAt: now,
      applicationId,
      requestId: input.requestId,
      name: input.name,
      relationType: input.relationType,
      relationDetail: input.relationDetail,
      phone: input.phone,
      deliveryPlace: input.deliveryPlace,
      deliveryDetail: input.deliveryDetail,
      preferredDays: input.preferredDays,
      message: input.message,
      consentAt: now,
      status: targetStatus,
      contactedAt: '',
      reviewedAt: '',
      retentionUntil: '',
      anonymizedAt: '',
      adminMemo: '',
      waitlistPosition: String(waitlistPosition),
      skipUntil: '',
      cooldownUntil: '',
      updatedAt: now,
    };

    sheet.appendRow(guestApplicationObjectToRow(application, table.headers));
    enqueueGuestApplicationNotification(application, { callerHoldsScriptLock: true });
    clearGuestApplicationSettingsCache();

    var result = {
      success: true,
      applicationId,
      status: targetStatus,
      capacity: capacityState.capacity,
      capacityMode: 'ADVISORY',
      message,
    };
    result.capacityReached = capacityState.applicationFull;

    return result;
  } finally {
    lock.releaseLock();
  }
}

// ─── 관리자용 조회 ───

function maskGuestApplicationPhone(phone) {
  const digits = normalizeGuestApplicationPhone(phone);
  if (digits.length < 7) return '연락처 비공개';
  return digits.slice(0, 3) + '-****-' + digits.slice(-4);
}

function summarizeGuestApplicationPlace(value) {
  const text = cleanGuestApplicationText(value, 80);
  return text.length > 24 ? text.slice(0, 24) + '…' : text;
}

function getGuestApplicationStatusCounts(applications, now) {
  const counts = { ALL: applications.length, PENDING: 0, APPROVED: 0, REJECTED: 0, INACTIVE: 0, WAITLIST: 0, EXPIRED: 0, TEST: 0 };
  applications.forEach(application => {
    if (Object.prototype.hasOwnProperty.call(counts, application.status)) counts[application.status]++;
    if (String(application.adminMemo || '').indexOf('[테스트]') === 0) counts.TEST++;
    const retentionTime = application.retentionUntil ? new Date(application.retentionUntil).getTime() : NaN;
    if (!application.anonymizedAt && !isNaN(retentionTime) && retentionTime <= now.getTime()) counts.EXPIRED++;
  });
  return counts;
}

function getGuestApplicationsForAdmin(data) {
  const sheet = ensureGuestApplicationSheet();
  const table = getGuestApplicationRows(sheet);
  const filter = String((data && data.status) || 'ALL').trim().toUpperCase();
  const statusRank = { PENDING: 0, WAITLIST: 1, APPROVED: 2, REJECTED: 3, INACTIVE: 4 };
  const applications = getGuestApplicationObjects(table);
  const storedSettings = readGuestApplicationSettings();
  const capacityState = getGuestApplicationCapacityState(applications, storedSettings.guestApplicationCapacity);
  const operationState = getGuestApplicationOperations({});

  applications.sort((a, b) => {
    const rankDiff = (statusRank[a.status] === undefined ? 9 : statusRank[a.status]) - (statusRank[b.status] === undefined ? 9 : statusRank[b.status]);
    if (rankDiff !== 0) return rankDiff;
    // WAITLIST는 waitlistPosition으로 정렬
    if (a.status === GUEST_APPLICATION_STATUS.WAITLIST && b.status === GUEST_APPLICATION_STATUS.WAITLIST) {
      const posA = Number(a.waitlistPosition) || 9999;
      const posB = Number(b.waitlistPosition) || 9999;
      return posA - posB;
    }
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });

  const visible = filter === 'ALL'
    ? applications
    : filter === 'CLOSED'
      ? applications.filter(application => [GUEST_APPLICATION_STATUS.REJECTED, GUEST_APPLICATION_STATUS.INACTIVE].indexOf(application.status) >= 0)
      : applications.filter(application => application.status === filter);
  const counts = getGuestApplicationStatusCounts(applications, new Date());
  counts.CLOSED = counts.REJECTED + counts.INACTIVE;
  return {
    success: true,
    counts,
    settings: buildGuestApplicationSettingsResponse(storedSettings, capacityState),
    applications: visible.map(application => ({
      applicationId: application.applicationId,
      createdAt: application.createdAt,
      name: application.anonymizedAt ? '익명화 완료' : application.name,
      relationType: application.relationType,
      phoneMasked: application.anonymizedAt ? '-' : maskGuestApplicationPhone(application.phone),
      deliverySummary: application.anonymizedAt ? '-' : summarizeGuestApplicationPlace(application.deliveryPlace),
      preferredDays: application.preferredDays,
      status: application.status,
      contactedAt: application.contactedAt,
      retentionUntil: application.retentionUntil,
      anonymizedAt: application.anonymizedAt,
      waitlistPosition: application.waitlistPosition,
      skipUntil: application.skipUntil,
      cooldownUntil: application.cooldownUntil,
      testMarked: String(application.adminMemo || '').indexOf('[테스트]') === 0,
      updatedAt: application.updatedAt,
      currentServiceWeek: operationState.serviceWeek,
      currentServiceStatus: operationState.byApplication[application.applicationId]?.status || '',
      lastCompletedAt: operationState.lastCompletedAt[application.applicationId] || '',
    })),
  };
}

function findGuestApplicationById(table, applicationId) {
  for (let index = 0; index < table.rows.length; index++) {
    if (String(table.rows[index][table.map.applicationId] || '') === applicationId) {
      return { rowIndex: index, object: guestApplicationRowToObject(table.rows[index], table.map) };
    }
  }
  return null;
}

function getGuestApplicationDetail(data) {
  const applicationId = String((data && data.applicationId) || '').trim();
  if (!applicationId) return { success: false, message: '신청번호가 필요합니다.' };
  const table = getGuestApplicationRows(ensureGuestApplicationSheet());
  const found = findGuestApplicationById(table, applicationId);
  if (!found) return { success: false, message: '신청 정보를 찾을 수 없습니다.' };

  const application = found.object;
  delete application.requestId;
  return { success: true, application };
}

function addGuestApplicationRetentionDate(now) {
  return new Date(now.getTime() + GUEST_APPLICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

// ─── 신청 상태 업데이트 (P21: WAITLIST 대응) ───

function updateGuestApplication(data) {
  const applicationId = String((data && data.applicationId) || '').trim();
  const requestId = String((data && data.requestId) || '').trim();
  const cachedResult = getCachedGuestApplicationMutationResult('update', requestId);
  if (cachedResult) return cachedResult;
  const nextStatus = data && data.status ? String(data.status).trim().toUpperCase() : '';
  if (!applicationId) return { success: false, message: '신청번호가 필요합니다.' };
  if (nextStatus && !GUEST_APPLICATION_STATUS[nextStatus]) {
    return { success: false, message: '올바르지 않은 신청 상태입니다.' };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = ensureGuestApplicationSheet();
    const table = getGuestApplicationRows(sheet);
    const beforeRows = cloneSheetRows_(table.rows);
    const found = findGuestApplicationById(table, applicationId);
    if (!found) return { success: false, message: '신청 정보를 찾을 수 없습니다.' };
    if (found.object.anonymizedAt) return { success: false, message: '이미 익명화된 신청은 변경할 수 없습니다.' };

    const application = found.object;
    const previousStatus = application.status;

    const now = new Date();
    if (nextStatus) {
      application.status = nextStatus;
      application.reviewedAt = now;
      const isRetention = (nextStatus === GUEST_APPLICATION_STATUS.REJECTED || nextStatus === GUEST_APPLICATION_STATUS.INACTIVE);
      application.retentionUntil = isRetention ? addGuestApplicationRetentionDate(now) : '';

      // WAITLIST/INACTIVE/REJECTED → 정원 상태가 아니면 waitlistPosition 초기화
      if (nextStatus !== GUEST_APPLICATION_STATUS.WAITLIST) {
        application.waitlistPosition = '';
        application.skipUntil = '';
        application.cooldownUntil = '';
      }
      // PENDING/APPROVED로 변경 시 cooldown/skip 초기화
      if (nextStatus === GUEST_APPLICATION_STATUS.PENDING || nextStatus === GUEST_APPLICATION_STATUS.APPROVED) {
        application.skipUntil = '';
        application.cooldownUntil = '';
      }
    }
    if (data.contacted !== undefined) {
      application.contactedAt = data.contacted === true || String(data.contacted).toUpperCase() === 'TRUE' ? now : '';
    }
    if (data.adminMemo !== undefined) {
      application.adminMemo = cleanGuestApplicationText(data.adminMemo, 500);
    }
    if (data.skipUntil !== undefined) {
      application.skipUntil = data.skipUntil;
    }
    application.updatedAt = now;

    // 대기 순번 재계산
    var row = table.rows[found.rowIndex];
    var headers = table.headers;
    var map = table.map;
    // 메모리 상의 row에 변경 사항 반영
    var serializedApplication = guestApplicationObjectToRow(application, headers);
    GUEST_APPLICATION_HEADERS.forEach(function(header) {
      var idx = map[header];
      if (idx === undefined) return;
      row[idx] = serializedApplication[idx];
    });

    // 대기 순번 재계산 (공통 함수)
    reindexWaitlistPositions(table);

    writeChangedSheetRows_(sheet, beforeRows, table.rows, 2, headers.length);

    clearGuestApplicationSettingsCache();
    safeAppendAdminLog(
      'updateGuestApplication',
      'guestApplication',
      applicationId,
      '이용 신청 처리',
      previousStatus,
      application.status,
      ''
    );
    const result = {
      success: true,
      applicationId,
      status: application.status,
      retentionUntil: guestApplicationDateToIso(application.retentionUntil),
      message: '신청 정보가 저장되었습니다.',
    };
    cacheGuestApplicationMutationResult('update', requestId, result);
    return result;
  } finally {
    lock.releaseLock();
  }
}

// 신청관리 목록에서 여러 신청자를 한 번에 처리합니다.
// 모든 대상과 상태를 먼저 검증한 뒤 전체 행을 한 번에 저장해 부분 처리를 막습니다.
function updateGuestApplications(data) {
  const ids = Array.isArray(data && data.applicationIds)
    ? [...new Set(data.applicationIds.map(String).map(value => value.trim()).filter(Boolean))]
    : [];
  const action = String((data && data.bulkAction) || '').trim().toUpperCase();
  const requestId = String((data && data.requestId) || '').trim();
  const cachedResult = getCachedGuestApplicationMutationResult('bulk-update-' + action, requestId);
  if (cachedResult) return cachedResult;
  const actionStatus = {
    APPROVE: GUEST_APPLICATION_STATUS.APPROVED,
    REJECT: GUEST_APPLICATION_STATUS.REJECTED,
    INACTIVATE: GUEST_APPLICATION_STATUS.INACTIVE,
  }[action] || '';
  const allowedStatuses = {
    APPROVE: [GUEST_APPLICATION_STATUS.PENDING, GUEST_APPLICATION_STATUS.WAITLIST, GUEST_APPLICATION_STATUS.REJECTED, GUEST_APPLICATION_STATUS.INACTIVE],
    REJECT: [GUEST_APPLICATION_STATUS.PENDING, GUEST_APPLICATION_STATUS.WAITLIST, GUEST_APPLICATION_STATUS.APPROVED],
    INACTIVATE: [GUEST_APPLICATION_STATUS.APPROVED, GUEST_APPLICATION_STATUS.WAITLIST],
    MARK_CONTACTED: Object.keys(GUEST_APPLICATION_STATUS).map(key => GUEST_APPLICATION_STATUS[key]),
  }[action] || [];
  if (!ids.length) return { success: false, message: '처리할 신청자를 선택해 주세요.' };
  if (!allowedStatuses.length) return { success: false, message: '올바르지 않은 일괄 처리입니다.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = ensureGuestApplicationSheet();
    const table = getGuestApplicationRows(sheet);
    const foundItems = ids.map(id => findGuestApplicationById(table, id));
    if (foundItems.some(item => !item)) return { success: false, message: '선택한 신청자 중 일부를 찾을 수 없습니다.' };
    if (foundItems.some(item => item.object.anonymizedAt)) return { success: false, message: '익명화된 신청자는 변경할 수 없습니다.' };
    if (foundItems.some(item => allowedStatuses.indexOf(item.object.status) === -1)) {
      return { success: false, message: '선택한 신청자의 현재 상태에서는 이 작업을 할 수 없습니다.' };
    }

    const now = new Date();
    foundItems.forEach(found => {
      const application = found.object;
      const previousStatus = application.status;
      if (actionStatus) {
        application.status = actionStatus;
        application.reviewedAt = now;
        const isRetention = actionStatus === GUEST_APPLICATION_STATUS.REJECTED || actionStatus === GUEST_APPLICATION_STATUS.INACTIVE;
        application.retentionUntil = isRetention ? addGuestApplicationRetentionDate(now) : '';
        if (actionStatus !== GUEST_APPLICATION_STATUS.WAITLIST) {
          application.waitlistPosition = '';
          application.skipUntil = '';
          application.cooldownUntil = '';
        }
        application.updatedAt = now;
        safeAppendAdminLog('updateGuestApplications', 'guestApplication', application.applicationId, '이용 신청 일괄 처리', previousStatus, application.status, 'action=' + action);
      } else if (action === 'MARK_CONTACTED') {
        application.contactedAt = now;
        application.updatedAt = now;
        safeAppendAdminLog('updateGuestApplications', 'guestApplication', application.applicationId, '신청자 연락 완료', '', guestApplicationDateToIso(now), '');
      }
      table.rows[found.rowIndex] = guestApplicationObjectToRow(application, table.headers);
    });
    reindexWaitlistPositions(table);
    const values = table.rows.map(row => row.slice(0, table.headers.length));
    if (values.length) sheet.getRange(2, 1, values.length, table.headers.length).setValues(values);
    clearGuestApplicationSettingsCache();
    const result = { success: true, count: ids.length, action, message: ids.length + '명의 신청자를 처리했습니다.' };
    cacheGuestApplicationMutationResult('bulk-update-' + action, requestId, result);
    return result;
  } finally {
    lock.releaseLock();
  }
}

// ─── skipUntil / 건너뛰기 ───

function skipGuestApplicationWeek(data) {
  var applicationId = String((data && data.applicationId) || '').trim();
  var requestId = String((data && data.requestId) || '').trim();
  var cachedResult = getCachedGuestApplicationMutationResult('skip', requestId);
  if (cachedResult) return cachedResult;
  if (!applicationId) return { success: false, message: '신청번호가 필요합니다.' };

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = ensureGuestApplicationSheet();
    var table = getGuestApplicationRows(sheet);
    var beforeRows = cloneSheetRows_(table.rows);
    var found = findGuestApplicationById(table, applicationId);
    if (!found) return { success: false, message: '신청 정보를 찾을 수 없습니다.' };
    if (found.object.anonymizedAt) return { success: false, message: '이미 익명화된 신청은 변경할 수 없습니다.' };

    var now = new Date();
    // 다음 주 월요일 00:00:00
    var nextMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var dayOfWeek = nextMonday.getDay(); // 0=일, 1=월, ...
    var daysUntilMonday = dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7;
    if (daysUntilMonday === 0) daysUntilMonday = 7;
    nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);

    var previousStatus = found.object.status;
    var updateData = {
      applicationId: applicationId,
      status: GUEST_APPLICATION_STATUS.WAITLIST,
      skipUntil: nextMonday,
      contacted: true,
    };

    // 메모리 상의 row 업데이트
    var row = table.rows[found.rowIndex];
    var map = table.map;
    row[map.status] = GUEST_APPLICATION_STATUS.WAITLIST;
    row[map.skipUntil] = nextMonday;
    row[map.contactedAt] = now;
    row[map.updatedAt] = now;

    // waitlistPosition = 현재 WAITLIST 최대 순번 + 1
    var maxPos = 0;
    for (var i = 0; i < table.rows.length; i++) {
      if (String(table.rows[i][map.status] || '').trim() === GUEST_APPLICATION_STATUS.WAITLIST) {
        var pos = Number(table.rows[i][map.waitlistPosition]) || 0;
        if (pos > maxPos) maxPos = pos;
      }
    }
    row[map.waitlistPosition] = maxPos + 1;

    // 대기 순번 재계산
    reindexWaitlistPositions(table);

    writeChangedSheetRows_(sheet, beforeRows, table.rows, 2, table.headers.length);

    clearGuestApplicationSettingsCache();
    safeAppendAdminLog(
      'skipGuestApplicationWeek',
      'guestApplication',
      applicationId,
      '이번 주 건너뛰기',
      previousStatus,
      GUEST_APPLICATION_STATUS.WAITLIST,
      ''
    );
    var result = {
      success: true,
      applicationId: applicationId,
      status: GUEST_APPLICATION_STATUS.WAITLIST,
      skipUntil: guestApplicationDateToIso(nextMonday),
      message: '건너뛰기가 설정되었습니다.',
    };
    cacheGuestApplicationMutationResult('skip', requestId, result);
    return result;
  } finally {
    lock.releaseLock();
  }
}

// ─── 주간 자동 순환 ───

function rotateGuestApplicationWeekly() {
  // P95: 기존 시간 트리거가 남아 있어도 신청 상태를 절대 자동 변경하지 않습니다.
  var serviceWeek = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  safeAppendAdminLog(
    'rotateGuestApplicationWeekly', 'guestApplication', serviceWeek,
    '주간 자동 순환 생략', '', '수동 주간 운영 정책', ''
  );
  return {
    success: true,
    skipped: true,
    serviceWeek: serviceWeek,
    message: '수동 주간 운영 정책이므로 신청자 상태를 변경하지 않았습니다.'
  };

  /* Legacy automatic rotation is intentionally unreachable and retained for rollback reference. */
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    var sheet = ensureGuestApplicationSheet();
    var table = getGuestApplicationRows(sheet);
    var beforeRows = cloneSheetRows_(table.rows);
    var settings = readGuestApplicationSettings();
    var applications = getGuestApplicationObjects(table);
    var now = new Date();
    var schedulingMode = String(settings.guestApplicationSchedulingMode || 'MANUAL').toUpperCase();
    var serviceWeek = getServiceWeekKey(now);
    var schedulingPaused = String(settings.guestApplicationPaused || 'N').toUpperCase() === 'Y';
    var pausedWeek = String(settings.guestApplicationPauseWeek || '');
    if (schedulingMode !== 'AUTO' || (schedulingPaused && (!pausedWeek || pausedWeek === serviceWeek))) {
      safeAppendAdminLog(
        'rotateGuestApplicationWeekly', 'guestApplication', serviceWeek,
        '주간 자동 순환 생략', '', schedulingPaused ? '운영 중단 주간' : '수동 운영 모드', ''
      );
      return { success: true, skipped: true, serviceWeek: serviceWeek, message: '수동 운영 모드 또는 중단 주간이어서 자동 순환을 실행하지 않았습니다.' };
    }
    var capacity = getGuestApplicationCapacity(settings.guestApplicationCapacity);
    var cooldownWeeks = Number(settings.guestApplicationCooldownWeeks) || GUEST_APPLICATION_DEFAULT_COOLDOWN_WEEKS;

    // cooldownDate: cooldownWeeks 후의 날짜 (자정 기준)
    var cooldownDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + cooldownWeeks * 7);

    var map = table.map;
    var rotatedCount = 0;

    // 1. APPROVED → WAITLIST (쿨다운 설정)
    var currentMaxPosition = 0;
    for (var i = 0; i < table.rows.length; i++) {
      if (String(table.rows[i][map.status] || '').trim() === 'WAITLIST') {
        var pos = Number(table.rows[i][map.waitlistPosition]) || 0;
        if (pos > currentMaxPosition) currentMaxPosition = pos;
      }
    }

    for (var r = 0; r < table.rows.length; r++) {
      if (String(table.rows[r][map.status] || '').trim() === 'APPROVED') {
        currentMaxPosition++;
        table.rows[r][map.status] = 'WAITLIST';
        table.rows[r][map.waitlistPosition] = currentMaxPosition;
        table.rows[r][map.cooldownUntil] = cooldownDate;
        table.rows[r][map.contactedAt] = '';
        table.rows[r][map.updatedAt] = now;
        rotatedCount++;
      }
    }

    // 2. WAITLIST → APPROVED (쿨다운/skipUntil 제외)
    var waitlistCandidates = [];
    for (var c = 0; c < table.rows.length; c++) {
      if (String(table.rows[c][map.status] || '').trim() !== 'WAITLIST') continue;
      var cooldownOk = isDateBeforeOrEqual(table.rows[c][map.cooldownUntil], now);
      var skipOk = isDateBeforeOrEqual(table.rows[c][map.skipUntil], now);
      if (cooldownOk && skipOk) {
        waitlistCandidates.push({
          index: c,
          row: table.rows[c],
          position: Number(table.rows[c][map.waitlistPosition]) || 9999,
        });
      }
    }

    waitlistCandidates.sort(function(a, b) { return a.position - b.position; });

    var promoted = waitlistCandidates.slice(0, capacity);
    for (var p = 0; p < promoted.length; p++) {
      promoted[p].row[map.status] = 'APPROVED';
      promoted[p].row[map.waitlistPosition] = '';
      promoted[p].row[map.contactedAt] = '';
      promoted[p].row[map.updatedAt] = now;
    }

    // 3. 빈 정원 처리
    var emptySlots = Math.max(0, capacity - promoted.length);
    if (emptySlots > 0 && String(settings.guestApplicationOpen || 'N').toUpperCase() !== 'Y') {
      setGuestApplicationSettingsValues({ guestApplicationOpen: 'Y' });
    }

    // 4. 대기 순번 재계산
    reindexWaitlistPositions(table);

    // 5. 실제로 변경된 행 구간만 정확한 물리 행에 저장한다.
    writeChangedSheetRows_(sheet, beforeRows, table.rows, 2, table.headers.length);

    clearGuestApplicationSettingsCache();

    // 6. 관리자 로그
    safeAppendAdminLog(
      'rotateGuestApplicationWeekly', 'guestApplication', 'weekly',
      '주간 서비스 자동 순환', '',
      '순환복귀 ' + rotatedCount + '건 / 신규승격 ' + promoted.length + '건 / 빈정원 ' + emptySlots + '건', ''
    );

    return {
      success: true,
      rotated: rotatedCount,
      promoted: promoted.length,
      emptySlots: emptySlots,
      remainingWaitlist: waitlistCandidates.length - promoted.length,
    };
  } catch (error) {
    safeAppendAdminLog(
      'rotateGuestApplicationWeekly', 'guestApplication', 'weekly',
      '주간 자동 순환 실패', '',
      '실패: ' + error.message, ''
    );
    return { success: false, error: error.message, message: '주간 자동 순환에 실패했습니다. 관리자가 수동으로 실행해 주세요.' };
  } finally {
    lock.releaseLock();
  }
}

function createWeeklyRotationTrigger() {
  // 기존 트리거 삭제
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'rotateGuestApplicationWeekly') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // 매주 월요일 오전 6시
  ScriptApp.newTrigger('rotateGuestApplicationWeekly')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(6)
    .create();

  return '주간 자동 순환 트리거가 생성되었습니다. 매주 월요일 오전 6시에 실행됩니다.';
}

// ─── 설정 저장 ───

function setGuestApplicationSettingsValues(valuesByKey) {
  const sheet = getGuestApplicationSettingsSheet();
  const values = sheet.getDataRange().getValues();
  const rowByKey = {};
  values.slice(1).forEach((row, index) => {
    const key = String(row[0] || '').trim();
    if (key) rowByKey[key] = index + 2;
  });

  const missingRows = [];
  Object.keys(valuesByKey).forEach(key => {
    const safeValue = protectGuestApplicationSheetValue(valuesByKey[key]);
    if (rowByKey[key]) sheet.getRange(rowByKey[key], 2).setValue(safeValue);
    else missingRows.push([key, safeValue]);
  });
  if (missingRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, missingRows.length, 2).setValues(missingRows);
  }
}

function updateGuestApplicationSettings(data) {
  const requestId = String((data && data.requestId) || '').trim();
  const cachedResult = getCachedGuestApplicationMutationResult('settings', requestId);
  if (cachedResult) return cachedResult;
  const dayOptions = parseGuestApplicationDayOptions(data.preferredDayOptions);
  if (dayOptions.length === 0) return { success: false, message: '희망 요일 선택지를 하나 이상 입력해 주세요.' };
  const hasCapacityInput = data.capacity !== undefined && data.capacity !== null && String(data.capacity).trim() !== '';
  const capacity = hasCapacityInput ? parseGuestApplicationCapacity(data.capacity) : null;
  if (hasCapacityInput && capacity === null) {
    return { success: false, message: '모집 정원은 1명부터 100명 사이의 정수로 입력해 주세요.' };
  }

  var values = {
    guestApplicationOpen: data.applicationOpen === true || String(data.applicationOpen).toUpperCase() === 'Y' ? 'Y' : 'N',
    guestApplicationTarget: cleanGuestApplicationText(data.target, 160),
    guestApplicationOperatingDays: cleanGuestApplicationText(data.operatingDays, 100),
    guestApplicationOrderTime: cleanGuestApplicationText(data.orderTime, 100),
    guestApplicationDeliveryTime: cleanGuestApplicationText(data.deliveryTime, 100),
    guestApplicationArea: cleanGuestApplicationText(data.serviceArea, 160),
    guestApplicationUsage: cleanGuestApplicationText(data.usageGuide, 240),
    guestApplicationDayOptions: dayOptions.join(','),
    guestApplicationClosedMessage: cleanGuestApplicationText(data.closedMessage, 240),
  };

  if (hasCapacityInput) values.guestApplicationCapacity = String(capacity);
  if (data.cooldownWeeks !== undefined && data.cooldownWeeks !== null) {
    var cw = Number(String(data.cooldownWeeks).trim());
    if (Number.isInteger(cw) && cw >= 1 && cw <= 12) {
      values.guestApplicationCooldownWeeks = String(cw);
    }
  }
  if (data.waitlistLimit !== undefined && data.waitlistLimit !== null) {
    var wl = Number(String(data.waitlistLimit).trim());
    if (Number.isInteger(wl) && wl >= 1) {
      values.guestApplicationWaitlistLimit = String(wl);
    }
  }
  if (data.emailNotificationEnabled !== undefined) {
    values.guestApplicationEmailNotificationEnabled = data.emailNotificationEnabled === true || String(data.emailNotificationEnabled).toUpperCase() === 'Y' ? 'Y' : 'N';
  }

  const requiredKeys = [
    'guestApplicationTarget', 'guestApplicationOperatingDays', 'guestApplicationOrderTime',
    'guestApplicationDeliveryTime', 'guestApplicationArea', 'guestApplicationUsage',
    'guestApplicationClosedMessage'
  ];
  if (requiredKeys.some(key => !values[key])) {
    return { success: false, message: '신청 안내 설정을 모두 입력해 주세요.' };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    setGuestApplicationSettingsValues(values);
    clearGuestApplicationSettingsCache();
  } finally {
    lock.releaseLock();
  }
  safeAppendAdminLog(
    'updateGuestApplicationSettings',
    'settings',
    'guestApplications',
    '이용 신청 설정',
    '',
    values.guestApplicationOpen === 'Y' ? '운영 중' : '마감',
    ''
  );
  const result = { success: true, message: '이용 신청 설정이 저장되었습니다.' };
  cacheGuestApplicationMutationResult('settings', requestId, result);
  return result;
}

// ─── 만료 개인정보 익명화 ───

function collectExpiredGuestApplications(table, now) {
  return table.rows.map((row, index) => ({
    rowIndex: index,
    object: guestApplicationRowToObject(row, table.map),
  })).filter(item => {
    if (!item.object.applicationId || item.object.anonymizedAt || !item.object.retentionUntil) return false;
    const retentionTime = new Date(item.object.retentionUntil).getTime();
    return !isNaN(retentionTime) && retentionTime <= now.getTime();
  });
}

function auditExpiredGuestApplications() {
  const table = getGuestApplicationRows(ensureGuestApplicationSheet());
  const expired = collectExpiredGuestApplications(table, new Date());
  return {
    success: true,
    count: expired.length,
    applications: expired.map(item => ({
      applicationId: item.object.applicationId,
      status: item.object.status,
      retentionUntil: item.object.retentionUntil,
    })),
    message: expired.length ? '익명화 가능한 신청 정보가 ' + expired.length + '건 있습니다.' : '익명화할 만료 신청 정보가 없습니다.',
  };
}

function anonymizeExpiredGuestApplications(data) {
  if (String((data && data.confirmText) || '').trim() !== '신청정보정리') {
    return { success: false, message: '확인 문구 신청정보정리를 정확히 입력해 주세요.' };
  }
  const requestId = String((data && data.requestId) || '').trim();
  const cachedResult = getCachedGuestApplicationMutationResult('anonymize', requestId);
  if (cachedResult) return cachedResult;

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  var spreadsheet = null;
  var sheet = null;
  var backup = null;
  try {
    spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    sheet = ensureGuestApplicationSheet();
    const table = getGuestApplicationRows(sheet);
    const now = new Date();
    const expired = collectExpiredGuestApplications(table, now);
    if (expired.length === 0) {
      const emptyResult = {
        success: true,
        count: 0,
        verified: true,
        rolledBack: false,
        recoveryRequired: false,
        cleanupRequired: false,
        backupSheetName: '',
        message: '익명화할 만료 신청 정보가 없습니다.',
      };
      cacheGuestApplicationMutationResult('anonymize', requestId, emptyResult);
      return emptyResult;
    }

    const beforeRows = cloneSheetRows_(table.rows);
    const clearFields = [
      'requestId', 'name', 'relationType', 'relationDetail', 'phone',
      'deliveryPlace', 'deliveryDetail', 'preferredDays', 'message', 'adminMemo'
    ];

    expired.forEach(item => {
      clearFields.forEach(field => { item.object[field] = ''; });
      item.object.anonymizedAt = now;
      item.object.updatedAt = now;
      item.object.waitlistPosition = '';
      item.object.skipUntil = '';
      item.object.cooldownUntil = '';

      var row = table.rows[item.rowIndex];
      var map = table.map;
      var serialized = guestApplicationObjectToRow(item.object, table.headers);
      GUEST_APPLICATION_HEADERS.forEach(function(header) {
        var idx = map[header];
        if (idx === undefined) return;
        row[idx] = serialized[idx];
      });
    });

    reindexWaitlistPositions(table);

    backup = createUniqueSheetBackup_(spreadsheet, sheet, SHEET.GUEST_APPLICATIONS + '_임시백업');
    writeChangedSheetRows_(sheet, beforeRows, table.rows, 2, table.headers.length);

    var expectedValues = [table.headers].concat(table.rows);
    if (!verifyExactSheetValues_(sheet, expectedValues)) {
      throw new Error('익명화 저장 후 데이터 검증에 실패했습니다.');
    }

    var cleanupRequired = !deleteSheetQuietly_(spreadsheet, backup.sheet);

    safeAppendAdminLog(
      'anonymizeExpiredGuestApplications',
      'guestApplication',
      'expired',
      '만료 신청정보 정리',
      '',
      expired.length + '건',
      ''
    );
    const result = {
      success: true,
      count: expired.length,
      verified: true,
      rolledBack: false,
      recoveryRequired: false,
      cleanupRequired: cleanupRequired,
      backupSheetName: cleanupRequired ? backup.name : '',
      message: cleanupRequired
        ? expired.length + '건을 익명화했지만 임시 백업 삭제에 실패했습니다. 개인정보 보호를 위해 ' + backup.name + ' 시트를 직접 삭제해 주세요.'
        : expired.length + '건의 만료 개인정보를 익명화하고 결과를 검증했습니다.',
    };
    cacheGuestApplicationMutationResult('anonymize', requestId, result);
    return result;
  } catch (error) {
    var rolledBack = false;
    var recoveryRequired = false;
    var cleanupRequired = false;
    var backupSheetName = backup ? backup.name : '';

    if (backup && sheet) {
      try {
        restoreSheetFromBackup_(sheet, backup.sheet);
        rolledBack = true;
        cleanupRequired = !deleteSheetQuietly_(spreadsheet, backup.sheet);
        if (!cleanupRequired) backupSheetName = '';
      } catch (restoreError) {
        recoveryRequired = true;
      }
    }

    safeAppendAdminLog(
      'anonymizeExpiredGuestApplications',
      'guestApplication',
      'expired',
      '만료 신청정보 정리 실패',
      '',
      rolledBack ? '자동 복구 완료' : '자동 복구 필요',
      ''
    );
    return {
      success: false,
      count: 0,
      verified: false,
      rolledBack: rolledBack,
      recoveryRequired: recoveryRequired,
      cleanupRequired: cleanupRequired,
      backupSheetName: backupSheetName,
      message: recoveryRequired
        ? '익명화 중 오류가 발생했고 자동 복구에도 실패했습니다. ' + backupSheetName + ' 시트를 보존하고 관리자에게 알려 주세요.'
        : (rolledBack
          ? '익명화 중 오류가 발생해 원래 데이터로 자동 복구했습니다.' + (cleanupRequired ? ' 남은 임시 백업 ' + backupSheetName + ' 시트를 삭제해 주세요.' : '')
          : '익명화를 시작하지 못했습니다: ' + error.message),
    };
  } finally {
    lock.releaseLock();
  }
}
