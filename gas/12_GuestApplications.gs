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
    if (status === GUEST_APPLICATION_STATUS.WAITLIST) {
      position++;
      row[table.map.waitlistPosition] = position;
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

function getGuestApplicationFullMessage(capacity) {
  return '1차 시범 이용 신청 ' + capacity + '명이 모두 접수되어 현재 모집을 마감했습니다. 추가 모집은 기관 담당자에게 문의해 주세요.';
}

function getGuestApplicationAdminFullMessage(capacity) {
  return '현재 1차 시범 신청 정원 ' + capacity + '명이 모두 차 있어 승인할 수 없습니다. 먼저 다른 신청을 반려 또는 중지해 주세요.';
}

function getGuestApplicationWaitlistMessage(position) {
  return '정원이 가득 차 대기자로 접수되었습니다. 대기 번호는 ' + position + '번입니다.';
}

function getGuestApplicationWaitlistFullMessage(limit) {
  return '대기자가 ' + limit + '명을 초과하여 추가 접수를 받지 않습니다. 기관 담당자에게 문의해 주세요.';
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
  const applicationOpen = configuredOpen && !waitlistFull;
  const waitlistActive = configuredOpen && applicationFull && !waitlistFull;
  const configuredClosedMessage = String(settings.guestApplicationClosedMessage || '');
  var applicationClosedReason = '';
  if (!configuredOpen) applicationClosedReason = 'MANUAL';
  else if (waitlistFull) applicationClosedReason = 'WAITLIST_FULL';
  else if (applicationFull) applicationClosedReason = 'FULL';
  return {
    success: true,
    applicationOpen,
    applicationOpenConfigured: configuredOpen,
    applicationFull,
    waitlistActive,
    waitlistFull,
    waitlistCount: capacity.waitlistCount,
    waitlistLimit,
    applicationClosedReason,
    capacity: capacity.capacity,
    activeCount: capacity.activeCount,
    remainingSlots: capacity.remainingSlots,
    cooldownWeeks: Number(settings.guestApplicationCooldownWeeks) || GUEST_APPLICATION_DEFAULT_COOLDOWN_WEEKS,
    target: String(settings.guestApplicationTarget || ''),
    operatingDays: String(settings.guestApplicationOperatingDays || ''),
    orderTime: String(settings.guestApplicationOrderTime || ''),
    deliveryTime: String(settings.guestApplicationDeliveryTime || ''),
    serviceArea: String(settings.guestApplicationArea || ''),
    usageGuide: String(settings.guestApplicationUsage || ''),
    preferredDayOptions: parseGuestApplicationDayOptions(settings.guestApplicationDayOptions),
    closedMessage: applicationClosedReason === 'FULL' ? getGuestApplicationFullMessage(capacity.capacity) : (applicationClosedReason === 'WAITLIST_FULL' ? getGuestApplicationWaitlistFullMessage(waitlistLimit) : configuredClosedMessage),
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
  if (relationType === 'OTHER' && !relationDetail) {
    return { success: false, message: '복지관과의 관계를 간단히 적어 주세요.' };
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
      relationDetail,
      phone,
      deliveryPlace,
      deliveryDetail,
      preferredDays,
      message,
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

    // WAITLIST 100명 초과 먼저 확인
    const waitlistLimit = getGuestApplicationWaitlistLimit(storedSettings);
    if (capacityState.waitlistCount >= waitlistLimit) {
      return {
        success: false,
        code: 'WAITLIST_FULL',
        message: getGuestApplicationWaitlistFullMessage(waitlistLimit),
        waitlistLimit,
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

    // 정원 확인: 미만이면 PENDING, 이상이면 WAITLIST
    var targetStatus;
    var waitlistPosition = '';
    var message;

    if (capacityState.applicationFull) {
      targetStatus = GUEST_APPLICATION_STATUS.WAITLIST;
      waitlistPosition = capacityState.waitlistCount + 1;
      message = getGuestApplicationWaitlistMessage(waitlistPosition);
    } else {
      targetStatus = GUEST_APPLICATION_STATUS.PENDING;
      message = '이용 신청이 접수되었습니다. 관리자가 확인 후 연락드립니다.';
    }

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
    clearGuestApplicationSettingsCache();

    var result = {
      success: true,
      applicationId,
      status: targetStatus,
      capacity: capacityState.capacity,
      message,
    };

    if (targetStatus === GUEST_APPLICATION_STATUS.WAITLIST) {
      result.waitlistPosition = waitlistPosition;
    } else {
      result.remainingSlots = Math.max(0, capacityState.remainingSlots - 1);
    }

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
  const counts = { ALL: applications.length, PENDING: 0, APPROVED: 0, REJECTED: 0, INACTIVE: 0, WAITLIST: 0, EXPIRED: 0 };
  applications.forEach(application => {
    if (Object.prototype.hasOwnProperty.call(counts, application.status)) counts[application.status]++;
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

  const visible = filter === 'ALL' ? applications : applications.filter(application => application.status === filter);
  return {
    success: true,
    counts: getGuestApplicationStatusCounts(applications, new Date()),
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
      updatedAt: application.updatedAt,
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
    const found = findGuestApplicationById(table, applicationId);
    if (!found) return { success: false, message: '신청 정보를 찾을 수 없습니다.' };
    if (found.object.anonymizedAt) return { success: false, message: '이미 익명화된 신청은 변경할 수 없습니다.' };

    const application = found.object;
    const previousStatus = application.status;

    // WAITLIST → PENDING 승격: 정원 여유 확인
    if (nextStatus === GUEST_APPLICATION_STATUS.PENDING && previousStatus === GUEST_APPLICATION_STATUS.WAITLIST) {
      const storedSettings = readGuestApplicationSettings();
      const capacityState = getGuestApplicationCapacityState(
        getGuestApplicationObjects(table),
        storedSettings.guestApplicationCapacity
      );
      if (capacityState.applicationFull) {
        return {
          success: false,
          code: 'APPLICATION_FULL',
          message: getGuestApplicationAdminFullMessage(capacityState.capacity),
          capacity: capacityState.capacity,
          activeCount: capacityState.activeCount,
          remainingSlots: 0,
        };
      }
    }

    // 비정원 상태 → 정원 상태 승격: 정원 확인
    if (
      nextStatus
      && !isGuestApplicationCapacityStatus(previousStatus)
      && isGuestApplicationCapacityStatus(nextStatus)
      && nextStatus !== GUEST_APPLICATION_STATUS.PENDING
    ) {
      // APPROVED로 직접 승격할 때
      const storedSettings = readGuestApplicationSettings();
      const capacityState = getGuestApplicationCapacityState(
        getGuestApplicationObjects(table),
        storedSettings.guestApplicationCapacity
      );
      if (capacityState.applicationFull) {
        return {
          success: false,
          code: 'APPLICATION_FULL',
          message: getGuestApplicationAdminFullMessage(capacityState.capacity),
          capacity: capacityState.capacity,
          activeCount: capacityState.activeCount,
          remainingSlots: 0,
        };
      }
    }

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
    GUEST_APPLICATION_HEADERS.forEach(function(header) {
      var idx = map[header];
      if (idx === undefined) return;
      var val = application[header];
      if (val instanceof Date) {
        row[idx] = val;
      } else if (val === '' || val === undefined || val === null) {
        row[idx] = '';
      } else {
        row[idx] = val;
      }
    });

    // 대기 순번 재계산 (공통 함수)
    reindexWaitlistPositions(table);

    // 변경된 행 배치 업데이트 (변경이 일어난 모든 행)
    var changedRows = [];
    var firstChangedIndex = -1;
    for (var i = 0; i < table.rows.length; i++) {
      var r = table.rows[i];
      // status 또는 waitlistPosition이 변경된 행 찾기
      if (String(r[map.updatedAt] || '') === String(now) || (found.rowIndex === i)) {
        changedRows.push(r);
        if (firstChangedIndex === -1) firstChangedIndex = i;
      }
    }

    if (changedRows.length > 0 && firstChangedIndex >= 0) {
      var batchedValues = changedRows.map(function(r) {
        return guestApplicationObjectToRow(guestApplicationRowToObject(r, map), headers);
      });
      sheet.getRange(firstChangedIndex + 2, 1, batchedValues.length, headers.length)
        .setValues(batchedValues);
    } else {
      // 단일 행만 변경된 경우
      const rowNumber = found.rowIndex + 2;
      sheet.getRange(rowNumber, 1, 1, table.headers.length)
        .setValues([guestApplicationObjectToRow(application, table.headers)]);
    }

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
    return {
      success: true,
      applicationId,
      status: application.status,
      retentionUntil: guestApplicationDateToIso(application.retentionUntil),
      message: '신청 정보가 저장되었습니다.',
    };
  } finally {
    lock.releaseLock();
  }
}

// ─── skipUntil / 건너뛰기 ───

function skipGuestApplicationWeek(data) {
  var applicationId = String((data && data.applicationId) || '').trim();
  if (!applicationId) return { success: false, message: '신청번호가 필요합니다.' };

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = ensureGuestApplicationSheet();
    var table = getGuestApplicationRows(sheet);
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

    // 모든 변경 행 수집 후 배치 업데이트
    var changedRows = [];
    for (var j = 0; j < table.rows.length; j++) {
      if (String(table.rows[j][map.updatedAt] || '') === String(now)) {
        changedRows.push(table.rows[j]);
      }
    }
    var firstIndex = table.rows.indexOf(changedRows[0]);
    if (changedRows.length > 0 && firstIndex >= 0) {
      var batchedValues = changedRows.map(function(r) {
        return guestApplicationObjectToRow(guestApplicationRowToObject(r, map), table.headers);
      });
      sheet.getRange(firstIndex + 2, 1, batchedValues.length, table.headers.length)
        .setValues(batchedValues);
    }

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
    return {
      success: true,
      applicationId: applicationId,
      status: GUEST_APPLICATION_STATUS.WAITLIST,
      skipUntil: guestApplicationDateToIso(nextMonday),
      message: '건너뛰기가 설정되었습니다.',
    };
  } finally {
    lock.releaseLock();
  }
}

// ─── 주간 자동 순환 ───

function rotateGuestApplicationWeekly() {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    var sheet = ensureGuestApplicationSheet();
    var table = getGuestApplicationRows(sheet);
    var settings = readGuestApplicationSettings();
    var applications = getGuestApplicationObjects(table);
    var capacity = getGuestApplicationCapacity(settings.guestApplicationCapacity);
    var now = new Date();
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

    // 5. 시트 업데이트 (배치 — setValues 1회)
    var changedRows = [];
    var firstIndex = -1;
    for (var u = 0; u < table.rows.length; u++) {
      if (String(table.rows[u][map.updatedAt] || '') === String(now)) {
        changedRows.push(table.rows[u]);
        if (firstIndex === -1) firstIndex = u;
      }
    }

    if (changedRows.length > 0 && firstIndex >= 0) {
      var batchedValues = changedRows.map(function(r) {
        return guestApplicationObjectToRow(guestApplicationRowToObject(r, map), table.headers);
      });
      sheet.getRange(firstIndex + 2, 1, batchedValues.length, table.headers.length)
        .setValues(batchedValues);
    }

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
  return { success: true, message: '이용 신청 설정이 저장되었습니다.' };
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

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = ensureGuestApplicationSheet();
    const table = getGuestApplicationRows(sheet);
    const now = new Date();
    const expired = collectExpiredGuestApplications(table, now);
    const clearFields = [
      'requestId', 'name', 'relationType', 'relationDetail', 'phone',
      'deliveryPlace', 'deliveryDetail', 'preferredDays', 'message', 'adminMemo'
    ];

    var changedRows = [];
    var firstIndex = -1;

    expired.forEach(item => {
      clearFields.forEach(field => { item.object[field] = ''; });
      item.object.anonymizedAt = now;
      item.object.updatedAt = now;
      item.object.waitlistPosition = '';
      item.object.skipUntil = '';
      item.object.cooldownUntil = '';

      var row = table.rows[item.rowIndex];
      var map = table.map;
      GUEST_APPLICATION_HEADERS.forEach(function(header) {
        var idx = map[header];
        if (idx === undefined) return;
        var val = item.object[header];
        row[idx] = val instanceof Date ? val : (val || '');
      });

      changedRows.push(item);
      if (firstIndex === -1 || item.rowIndex < firstIndex) firstIndex = item.rowIndex;
    });

    if (changedRows.length > 0 && firstIndex >= 0) {
      var batchedValues = changedRows.map(function(item) {
        return guestApplicationObjectToRow(item.object, table.headers);
      });
      sheet.getRange(firstIndex + 2, 1, batchedValues.length, table.headers.length)
        .setValues(batchedValues);
    }

    // 대기 순번 재계산
    reindexWaitlistPositions(table);

    safeAppendAdminLog(
      'anonymizeExpiredGuestApplications',
      'guestApplication',
      'expired',
      '만료 신청정보 정리',
      '',
      expired.length + '건',
      ''
    );
    return {
      success: true,
      count: expired.length,
      message: expired.length + '건의 만료 개인정보를 익명화했습니다.',
    };
  } finally {
    lock.releaseLock();
  }
}