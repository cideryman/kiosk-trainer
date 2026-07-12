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
  'updatedAt',
];

const GUEST_APPLICATION_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  INACTIVE: 'INACTIVE',
};

const GUEST_APPLICATION_RETENTION_DAYS = 30;
const GUEST_APPLICATION_CAPACITY = 5;
const GUEST_APPLICATION_FULL_MESSAGE = '1차 시범 이용 신청 5명이 모두 접수되어 현재 모집을 마감했습니다. 추가 모집은 기관 담당자에게 문의해 주세요.';
const GUEST_APPLICATION_ADMIN_FULL_MESSAGE = '현재 1차 시범 신청 정원 5명이 모두 차 있어 승인할 수 없습니다. 먼저 다른 신청을 반려 또는 중지해 주세요.';
const GUEST_APPLICATION_DATE_HEADERS = [
  'createdAt', 'consentAt', 'contactedAt', 'reviewedAt',
  'retentionUntil', 'anonymizedAt', 'updatedAt'
];
const GUEST_APPLICATION_SETTINGS_CACHE_KEY = 'guestApplicationSettings.v2';
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
  guestApplicationClosedMessage: '현재 이용 신청을 받고 있지 않습니다. 기관 담당자에게 문의해 주세요.',
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

function isGuestApplicationCapacityStatus(status) {
  const normalized = String(status || '').trim().toUpperCase();
  return normalized === GUEST_APPLICATION_STATUS.PENDING || normalized === GUEST_APPLICATION_STATUS.APPROVED;
}

function getGuestApplicationCapacityState(applications) {
  const activeCount = (applications || []).reduce((count, application) => {
    if (application.anonymizedAt) return count;
    return isGuestApplicationCapacityStatus(application.status) ? count + 1 : count;
  }, 0);
  const remainingSlots = Math.max(0, GUEST_APPLICATION_CAPACITY - activeCount);
  return {
    capacity: GUEST_APPLICATION_CAPACITY,
    activeCount,
    remainingSlots,
    applicationFull: remainingSlots === 0,
  };
}

function buildGuestApplicationSettingsResponse(settings, capacityState) {
  const configuredOpen = String(settings.guestApplicationOpen || 'N').toUpperCase() === 'Y';
  const capacity = capacityState || getGuestApplicationCapacityState([]);
  const applicationFull = capacity.applicationFull === true;
  const applicationOpen = configuredOpen && !applicationFull;
  const configuredClosedMessage = String(settings.guestApplicationClosedMessage || '');
  const applicationClosedReason = !configuredOpen ? 'MANUAL' : (applicationFull ? 'FULL' : '');
  return {
    success: true,
    applicationOpen,
    applicationOpenConfigured: configuredOpen,
    applicationFull,
    applicationClosedReason,
    capacity: capacity.capacity,
    activeCount: capacity.activeCount,
    remainingSlots: capacity.remainingSlots,
    target: String(settings.guestApplicationTarget || ''),
    operatingDays: String(settings.guestApplicationOperatingDays || ''),
    orderTime: String(settings.guestApplicationOrderTime || ''),
    deliveryTime: String(settings.guestApplicationDeliveryTime || ''),
    serviceArea: String(settings.guestApplicationArea || ''),
    usageGuide: String(settings.guestApplicationUsage || ''),
    preferredDayOptions: parseGuestApplicationDayOptions(settings.guestApplicationDayOptions),
    closedMessage: applicationClosedReason === 'FULL' ? GUEST_APPLICATION_FULL_MESSAGE : configuredClosedMessage,
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
    const response = buildGuestApplicationSettingsResponse(
      readGuestApplicationSettings(),
      getGuestApplicationCapacityState(applications)
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
        return {
          success: true,
          idempotent: true,
          applicationId: String(row[table.map.applicationId] || ''),
          status: String(row[table.map.status] || GUEST_APPLICATION_STATUS.PENDING),
          message: '이미 접수된 신청 결과를 확인했습니다.',
        };
      }
    }

    const applications = getGuestApplicationObjects(table);
    const capacityState = getGuestApplicationCapacityState(applications);
    const currentSettings = buildGuestApplicationSettingsResponse(readGuestApplicationSettings(), capacityState);
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

    if (capacityState.applicationFull) {
      return {
        success: false,
        code: 'APPLICATION_FULL',
        message: GUEST_APPLICATION_FULL_MESSAGE,
        capacity: capacityState.capacity,
        activeCount: capacityState.activeCount,
        remainingSlots: 0,
      };
    }

    const now = new Date();
    const applicationId = createGuestApplicationId(table.rows, table.map, now);
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
      status: GUEST_APPLICATION_STATUS.PENDING,
      contactedAt: '',
      reviewedAt: '',
      retentionUntil: '',
      anonymizedAt: '',
      adminMemo: '',
      updatedAt: now,
    };

    sheet.appendRow(guestApplicationObjectToRow(application, table.headers));
    clearGuestApplicationSettingsCache();
    return {
      success: true,
      applicationId,
      status: GUEST_APPLICATION_STATUS.PENDING,
      capacity: capacityState.capacity,
      remainingSlots: Math.max(0, capacityState.remainingSlots - 1),
      message: '이용 신청이 접수되었습니다. 관리자가 확인 후 연락드립니다.',
    };
  } finally {
    lock.releaseLock();
  }
}

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
  const counts = { ALL: applications.length, PENDING: 0, APPROVED: 0, REJECTED: 0, INACTIVE: 0, EXPIRED: 0 };
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
  const statusRank = { PENDING: 0, APPROVED: 1, REJECTED: 2, INACTIVE: 3 };
  const applications = getGuestApplicationObjects(table);
  const capacityState = getGuestApplicationCapacityState(applications);

  applications.sort((a, b) => {
    const rankDiff = (statusRank[a.status] === undefined ? 9 : statusRank[a.status]) - (statusRank[b.status] === undefined ? 9 : statusRank[b.status]);
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });

  const visible = filter === 'ALL' ? applications : applications.filter(application => application.status === filter);
  return {
    success: true,
    counts: getGuestApplicationStatusCounts(applications, new Date()),
    settings: buildGuestApplicationSettingsResponse(readGuestApplicationSettings(), capacityState),
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
    if (
      nextStatus
      && !isGuestApplicationCapacityStatus(previousStatus)
      && isGuestApplicationCapacityStatus(nextStatus)
    ) {
      const capacityState = getGuestApplicationCapacityState(getGuestApplicationObjects(table));
      if (capacityState.applicationFull) {
        return {
          success: false,
          code: 'APPLICATION_FULL',
          message: GUEST_APPLICATION_ADMIN_FULL_MESSAGE,
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
      application.retentionUntil = (nextStatus === GUEST_APPLICATION_STATUS.REJECTED || nextStatus === GUEST_APPLICATION_STATUS.INACTIVE)
        ? addGuestApplicationRetentionDate(now)
        : '';
    }
    if (data.contacted !== undefined) {
      application.contactedAt = data.contacted === true || String(data.contacted).toUpperCase() === 'TRUE' ? now : '';
    }
    if (data.adminMemo !== undefined) {
      application.adminMemo = cleanGuestApplicationText(data.adminMemo, 500);
    }
    application.updatedAt = now;

    const rowNumber = found.rowIndex + 2;
    sheet.getRange(rowNumber, 1, 1, table.headers.length)
      .setValues([guestApplicationObjectToRow(application, table.headers)]);
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

  const values = {
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

    expired.forEach(item => {
      clearFields.forEach(field => { item.object[field] = ''; });
      item.object.anonymizedAt = now;
      item.object.updatedAt = now;
      sheet.getRange(item.rowIndex + 2, 1, 1, table.headers.length)
        .setValues([guestApplicationObjectToRow(item.object, table.headers)]);
    });

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
