// Google Apps Script API 설정
const DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycbxKY36tTxlOMw0WvKEBn2ljbYVgwsdkcyGFS6HPJ9_UPux8bq0xROvNK9E1NCBam0Qe/exec";
const API_CONTRACT_VERSION = '2026-08-27.1';

function createMockOrderToken() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return `O-${globalThis.crypto.randomUUID().replace(/-/g, '')}`;
    }
  } catch (_) {}
  let token = '';
  for (let i = 0; i < 32; i++) token += Math.floor(Math.random() * 16).toString(16);
  return `O-${token}`;
}

function resolveApiUrl() {
  try {
    const hostname = String(window.location.hostname || '').toLowerCase();
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    if (!isLocal) return DEFAULT_API_URL;

    const params = new URLSearchParams(window.location.search);
    const override = params.get('apiUrl') || localStorage.getItem('KIOSK_API_URL_OVERRIDE') || '';
    if (/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(override)) {
      return override;
    }
  } catch (error) {
    console.warn('[API Config] 로컬 API URL 재정의를 확인하지 못했습니다.', error);
  }
  return DEFAULT_API_URL;
}

const API_URL = resolveApiUrl();

// 게스트 기본 설정 상수
const GUEST_DEFAULT_CREDIT = 10;
const GUEST_DELIVERY_FEE = 3;
const GUEST_ORDER_COMPLETION_GRACE_MINUTES = 5;
const MOCK_GUEST_WEEKLY_SCHEDULE_WEEKDAY = 3;
const MOCK_GUEST_WEEKLY_SCHEDULE_OFFSET_MINUTES = 9 * 60;
const ADMIN_MAX_USER_CREDIT = 15;
const ADMIN_MIN_USER_ORDER_LIMIT = 1;
const DEFAULT_USER_ORDER_LIMIT = 10;
const ADMIN_MAX_SNACK_STOCK = 30;
const MOCK_GUEST_APPLICATION_DEFAULT_CAPACITY = 5;
const MOCK_GUEST_APPLICATION_MAX_CAPACITY = 100;

// 로컬 테스트용 Mock 데이터 강제 사용 여부
// - 주의: 테스트 시에는 true, 실제 운영 배포 시에는 false로 설정해야 합니다.
// - false: 실제 API 호출 (실패 시 Mock으로 자동 폴백하지 않고 실제 에러 메시지 노출)
// - true: 항상 로컬 Mock 데이터를 사용하여 동작 테스트 및 검증 진행
const USE_MOCK = false;

const DEBUG = false;

function getMockGuestScheduleParts(nowValue) {
  const now = nowValue instanceof Date ? new Date(nowValue.getTime()) : new Date(nowValue || new Date());
  const safeNow = isNaN(now.getTime()) ? new Date() : now;
  const shifted = new Date(safeNow.getTime() + MOCK_GUEST_WEEKLY_SCHEDULE_OFFSET_MINUTES * 60 * 1000);
  return {
    now: safeNow,
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  };
}

function formatMockGuestScheduleDateKey(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addMockGuestScheduleDays(dateKey, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0)));
  return formatMockGuestScheduleDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function buildMockGuestScheduleInstant(dateKey, timeValue) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(timeValue || ''));
  if (!dateMatch || !timeMatch) return null;
  return new Date(Date.UTC(
    Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]),
    Number(timeMatch[1]), Number(timeMatch[2])
  ) - MOCK_GUEST_WEEKLY_SCHEDULE_OFFSET_MINUTES * 60 * 1000);
}

function getMockGuestScheduleDateWeekday(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay() : -1;
}

function normalizeMockGuestScheduleWeekday(value) {
  const weekday = Number(value);
  return [1, 2, 3, 4, 5].includes(weekday) ? weekday : MOCK_GUEST_WEEKLY_SCHEDULE_WEEKDAY;
}

function normalizeMockGuestAdditionalSchedules(rawValue) {
  let parsed = rawValue;
  if (typeof rawValue === 'string') {
    try { parsed = JSON.parse(rawValue || '[]'); } catch (_) { parsed = []; }
  }
  if (!Array.isArray(parsed)) return [];
  const seenDates = new Set();
  return parsed.map(item => {
    const date = String(item?.date || '').trim();
    const startTime = String(item?.startTime || '').trim();
    const endTime = String(item?.endTime || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) || startTime >= endTime || seenDates.has(date)) return null;
    seenDates.add(date);
    return { scheduleId: String(item.scheduleId || `additional-${date}`), date, startTime, endTime };
  }).filter(Boolean).sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
}

function getNextMockGuestWeeklyDate(nowValue, weekday, boundaryTime, useEndBoundary = false) {
  const parts = getMockGuestScheduleParts(nowValue);
  const todayKey = formatMockGuestScheduleDateKey(parts.year, parts.month, parts.day);
  const boundaryMinutes = Number(boundaryTime.slice(0, 2)) * 60 + Number(boundaryTime.slice(3));
  let days = (weekday - parts.weekday + 7) % 7;
  if (days === 0 && parts.minutes >= boundaryMinutes) days = 7;
  return addMockGuestScheduleDays(todayKey, days);
}

function resolveMockGuestOperatingState(settingsValue, nowValue) {
  const settings = settingsValue || {};
  const parts = getMockGuestScheduleParts(nowValue);
  const now = parts.now;
  const nowMillis = now.getTime();
  const todayKey = formatMockGuestScheduleDateKey(parts.year, parts.month, parts.day);
  const startTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(settings.guestWeeklyScheduleStartTime || '')) ? settings.guestWeeklyScheduleStartTime : '13:00';
  const endTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(settings.guestWeeklyScheduleEndTime || '')) ? settings.guestWeeklyScheduleEndTime : '15:00';
  const weekday = normalizeMockGuestScheduleWeekday(settings.guestWeeklyScheduleDay);
  const weeklyEnabled = settings.guestWeeklyScheduleEnabled === true || String(settings.guestWeeklyScheduleEnabled).toUpperCase() === 'TRUE';
  const skipDate = /^\d{4}-\d{2}-\d{2}$/.test(String(settings.guestWeeklyScheduleSkipDate || '')) ? settings.guestWeeklyScheduleSkipDate : '';
  const additionalSchedules = normalizeMockGuestAdditionalSchedules(settings.guestAdditionalSchedules || settings.guestAdditionalSchedulesJson);
  const menuMode = String(settings.guestMenuMode || 'normal').toLowerCase();
  const targetScheduleDate = getNextMockGuestWeeklyDate(now, weekday, endTime, true);
  const targetOccurrenceSkipped = weeklyEnabled && skipDate === targetScheduleDate;
  const todayOccurrenceSkipped = weeklyEnabled && skipDate === todayKey;
  const scheduleSuppressedByEvent = menuMode !== 'normal' && (weeklyEnabled || additionalSchedules.some(item => item.date >= todayKey));
  const todayStartAt = buildMockGuestScheduleInstant(todayKey, startTime);
  const todayEndAt = buildMockGuestScheduleInstant(todayKey, endTime);
  const weeklyOccurrenceToday = weeklyEnabled && !scheduleSuppressedByEvent
    && parts.weekday === weekday && !todayOccurrenceSkipped;
  const weeklyActive = weeklyOccurrenceToday && nowMillis >= todayStartAt.getTime() && nowMillis < todayEndAt.getTime();
  const additionalOccurrences = additionalSchedules.filter(item => item.date >= todayKey).map(item => ({
    ...item,
    source: 'additional',
    startAt: buildMockGuestScheduleInstant(item.date, item.startTime),
    endAt: buildMockGuestScheduleInstant(item.date, item.endTime)
  }));
  const activeAdditional = scheduleSuppressedByEvent ? [] : additionalOccurrences.filter(item => item.date === todayKey && nowMillis >= item.startAt.getTime() && nowMillis < item.endAt.getTime());
  const manualCloseAt = settings.guestCloseAt ? new Date(settings.guestCloseAt) : null;
  const manualRequested = String(settings.guestOpen || 'N').toUpperCase() === 'Y';
  const validManualCloseAt = manualCloseAt && !isNaN(manualCloseAt.getTime()) ? manualCloseAt : null;
  const manualActive = Boolean(manualRequested && (!validManualCloseAt || nowMillis < validManualCloseAt.getTime()) && !todayOccurrenceSkipped);
  const candidates = [];
  if (weeklyActive) candidates.push({ source: 'weekly', endAt: todayEndAt });
  activeAdditional.forEach(item => candidates.push({ source: 'additional', endAt: item.endAt }));
  if (manualActive) candidates.push({ source: 'manual', endAt: validManualCloseAt });
  const unlimitedManual = manualActive && !validManualCloseAt;
  const priority = { weekly: 1, additional: 2, manual: 3 };
  const effective = unlimitedManual ? { source: 'manual', endAt: null } : candidates.filter(item => item.endAt).sort((a, b) => (b.endAt - a.endAt) || priority[b.source] - priority[a.source])[0];
  const effectiveCloseAt = effective?.endAt || null;
  const isGuestOpenNow = weeklyActive || activeAdditional.length > 0 || manualActive;
  const guestOpenSource = isGuestOpenNow ? (effective?.source || 'manual') : 'closed';
  const completionTimes = [];
  if (weeklyOccurrenceToday && now >= todayEndAt) completionTimes.push(todayEndAt);
  if (!scheduleSuppressedByEvent) additionalOccurrences.forEach(item => {
    if (item.date === todayKey && nowMillis >= item.endAt.getTime()) completionTimes.push(item.endAt);
  });
  if (manualRequested && validManualCloseAt && now >= validManualCloseAt && !todayOccurrenceSkipped) completionTimes.push(validManualCloseAt);
  const completionGraceCloseAt = completionTimes.sort((a, b) => b - a)[0] || null;
  const upcoming = [];
  if (weeklyEnabled && !scheduleSuppressedByEvent) {
    let date = getNextMockGuestWeeklyDate(now, weekday, startTime);
    if (skipDate === date) date = addMockGuestScheduleDays(date, 7);
    upcoming.push({ source: 'weekly', scheduleId: '', date, weekday, startTime, endTime, startAt: buildMockGuestScheduleInstant(date, startTime), endAt: buildMockGuestScheduleInstant(date, endTime) });
  }
  if (!scheduleSuppressedByEvent) additionalOccurrences.forEach(item => { if (item.startAt > now) upcoming.push({ ...item, weekday: getMockGuestScheduleDateWeekday(item.date) }); });
  upcoming.sort((a, b) => a.startAt - b.startAt);
  const nextGuestSchedule = upcoming[0] || null;
  const boundaries = [];
  if (weeklyOccurrenceToday && todayStartAt > now) boundaries.push(todayStartAt);
  if (weeklyOccurrenceToday && todayEndAt > now) boundaries.push(todayEndAt);
  if (!weeklyOccurrenceToday && weeklyEnabled && !scheduleSuppressedByEvent) {
    const nextWeekly = upcoming.find(item => item.source === 'weekly');
    if (nextWeekly) boundaries.push(nextWeekly.startAt);
  }
  if (!scheduleSuppressedByEvent) additionalOccurrences.forEach(item => {
    if (item.startAt > now) boundaries.push(item.startAt);
    if (item.date === todayKey && item.startAt <= now && item.endAt > now) boundaries.push(item.endAt);
  });
  if (manualActive && validManualCloseAt) boundaries.push(validManualCloseAt);
  const nextStateChangeAt = boundaries.sort((a, b) => a - b)[0] || null;
  return {
    weeklyEnabled, weekday, weekdayName: ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'][weekday],
    startTime, endTime, skipDate, targetScheduleDate, targetOccurrenceSkipped, todayOccurrenceSkipped,
    scheduleSuppressedByEvent, weeklyActive, additionalActive: activeAdditional.length > 0,
    activeAdditionalScheduleIds: activeAdditional.map(item => item.scheduleId), isGuestOpenNow, guestOpenSource,
    effectiveCloseAt, completionGraceCloseAt,
    additionalSchedules: additionalOccurrences.map(item => ({ scheduleId: item.scheduleId, date: item.date, startTime: item.startTime, endTime: item.endTime, isActive: activeAdditional.some(active => active.scheduleId === item.scheduleId) })),
    nextScheduledOpenAt: nextGuestSchedule?.startAt || null,
    nextGuestSchedule: nextGuestSchedule ? { source: nextGuestSchedule.source, scheduleId: nextGuestSchedule.scheduleId, date: nextGuestSchedule.date, weekday: nextGuestSchedule.weekday, startTime: nextGuestSchedule.startTime, endTime: nextGuestSchedule.endTime, startAt: nextGuestSchedule.startAt.toISOString(), endAt: nextGuestSchedule.endAt.toISOString() } : null,
    nextStateChangeAt,
    remainingSeconds: effectiveCloseAt ? Math.max(0, Math.floor((effectiveCloseAt - now) / 1000)) : 0
  };
}

function safeLog(...args) {
  if (!DEBUG) return;
  console.log(...args);
}

safeLog("API_URL:", API_URL);
safeLog("USE_MOCK:", USE_MOCK);

// 로컬 테스트 및 API 오류 대응을 위한 Mock 데이터
const MOCK_DATA = {
  getUsers: {
    success: true,
    users: [
      { userId: "user001", nickname: "이니", credit: 10, useYn: "Y", imageUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80" },
      { userId: "user002", nickname: "준이", credit: 15, useYn: "Y", imageUrl: "" },
      { userId: "user003", nickname: "민이", credit: 8, useYn: "Y", imageUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80" },
      { userId: "user004", nickname: "후니", credit: 15, useYn: "Y", imageUrl: "" },
      { userId: "user005", nickname: "수지", credit: 12, useYn: "Y", imageUrl: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80" },
      { userId: "user006", nickname: "영이", credit: 5, useYn: "Y", imageUrl: "" }
    ]
  },
  getSnacks: {
    success: true,
    snacks: [
      { snackId: 1, name: "초코칩 쿠키", point: 1, imageUrl: "", saleYn: "Y", stock: 5, target: "user" },
      { snackId: 2, name: "감자칩", point: 2, imageUrl: "", saleYn: "Y", stock: 3, target: "user" },
      { snackId: 3, name: "사이다", point: 1, imageUrl: "", saleYn: "Y", stock: 0, target: "guest" }, // 품절 테스트용
      { snackId: 4, name: "오렌지주스", point: 3, imageUrl: "", saleYn: "Y", stock: 10, target: "guest" },
      { snackId: 5, name: "초코우유", point: 2, imageUrl: "", saleYn: "Y", stock: 1, target: "user" }, // 1개 남은 것 테스트용
      { snackId: 6, name: "하리보 젤리", point: 1, imageUrl: "", saleYn: "Y", stock: 8, target: "guest" }
    ]
  },
  placeOrder: {
    success: true,
    message: "주문이 완료되었습니다!"
  },
  submitReviewReply: {
    success: true,
    message: "후기 답글이 성공적으로 등록되었습니다."
  },
  getOrdersToday: {
    success: true,
    orders: [
      { timestamp: new Date(Date.now() - 3600000 * 3).toISOString(), orderNo: "ORD-20260716-00001", nickname: "길동이", snackName: "초코우유", quantity: 1, point: 2, servedYn: "N", deliveryType: "delivery", deliveryPlace: "A동 101호", deliveryFee: 3 },
      { timestamp: new Date(Date.now() - 3600000 * 2).toISOString(), orderNo: "ORD-20260716-00002", nickname: "이니", snackName: "초코칩 쿠키", quantity: 2, point: 2, servedYn: "N", deliveryType: "pickup" },
      { timestamp: new Date(Date.now() - 3600000).toISOString(), orderNo: "ORD-20260716-00003", nickname: "준이", snackName: "사이다", quantity: 1, point: 1, servedYn: "Y", deliveryType: "pickup" },
      { timestamp: new Date().toISOString(), orderNo: "ORD-20260716-00004", nickname: "민이", snackName: "감자칩", quantity: 1, point: 2, servedYn: "N", deliveryType: "delivery", deliveryPlace: "B동 202호", deliveryFee: 3 }
    ]
  }
};

const MOCK_GUEST_APPLICATION_SETTINGS = {
  success: true,
  applicationOpen: true,
  target: '영주시장애인복지관 봉사자·후원자와 관리자가 이용 가능하다고 인정한 관계자',
  operatingDays: '매주 수요일',
  orderTime: '운영일 오전 10시부터 오전 11시 30분까지\n\n운영 일정에 따라 주문 시간이 달라질 수 있으며, 정확한 시간은 별도로 안내합니다.',
  deliveryTime: '오후 1시부터 주문 확인 순서에 따라 배달합니다.',
  serviceArea: '복지관과 사전에 협의된 장소',
  usageGuide: '이용 신청과 관리자 확인을 완료한 뒤, 안내받은 배달왔삼 주문 페이지에서 직접 주문합니다.',
  preferredDayOptions: ['수요일'],
  capacity: MOCK_GUEST_APPLICATION_DEFAULT_CAPACITY,
  closedMessage: '현재 이용 신청을 받고 있지 않습니다.',
  schedulingMode: 'MANUAL',
  paused: false,
  pauseWeek: '',
  pauseReason: '',
  emailNotificationEnabled: false
};

let MOCK_GUEST_APPLICATION_OPERATIONS = [];

let MOCK_GUEST_APPLICATIONS = [
  {
    createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    applicationId: 'APP-20260712-001',
    requestId: 'mock_guest_application_0001',
    name: '김봉사',
    relationType: 'VOLUNTEER',
    relationDetail: '',
    phone: '01012345678',
    deliveryPlace: '원당로 OO반점',
    deliveryDetail: '도착하면 담당자에게 알려주세요.',
    preferredDays: '수요일',
    message: '오후 운영일을 선호합니다.',
    consentAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    status: 'PENDING',
    contactedAt: '',
    reviewedAt: '',
    retentionUntil: '',
    anonymizedAt: '',
    adminMemo: '',
    updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
  }
];

function getMockGuestApplicationCounts(applications) {
  const counts = { ALL: applications.length, PENDING: 0, APPROVED: 0, REJECTED: 0, INACTIVE: 0, EXPIRED: 0, TEST: 0 };
  applications.forEach(application => {
    if (Object.prototype.hasOwnProperty.call(counts, application.status)) counts[application.status]++;
    if (String(application.adminMemo || '').startsWith('[테스트]')) counts.TEST++;
  });
  counts.CLOSED = counts.REJECTED + counts.INACTIVE;
  return counts;
}

function getMockGuestApplicationCapacity(value) {
  const capacity = Number(String(value === undefined || value === null ? '' : value).trim());
  return Number.isInteger(capacity) && capacity >= 1 && capacity <= MOCK_GUEST_APPLICATION_MAX_CAPACITY
    ? capacity
    : MOCK_GUEST_APPLICATION_DEFAULT_CAPACITY;
}

function getMockGuestApplicationCapacityState(
  applications = MOCK_GUEST_APPLICATIONS,
  capacityValue = MOCK_GUEST_APPLICATION_SETTINGS.capacity
) {
  const capacity = getMockGuestApplicationCapacity(capacityValue);
  const activeCount = applications.reduce((count, application) => {
    if (application.anonymizedAt) return count;
    return ['PENDING', 'APPROVED'].includes(String(application.status || '').toUpperCase())
      ? count + 1
      : count;
  }, 0);
  const remainingSlots = Math.max(0, capacity - activeCount);
  return {
    capacity,
    activeCount,
    remainingSlots,
    applicationFull: remainingSlots === 0
  };
}

function getMockGuestApplicationSettingsResponse() {
  const capacityState = getMockGuestApplicationCapacityState();
  const applicationOpenConfigured = MOCK_GUEST_APPLICATION_SETTINGS.applicationOpen === true;
  const applicationClosedReason = !applicationOpenConfigured ? 'MANUAL' : '';
  const configuredClosedMessage = MOCK_GUEST_APPLICATION_SETTINGS.closedMessage || '';
  return {
    ...JSON.parse(JSON.stringify(MOCK_GUEST_APPLICATION_SETTINGS)),
    applicationOpen: applicationOpenConfigured,
    applicationOpenConfigured,
    applicationClosedReason,
    ...capacityState,
    applicationFull: false,
    capacityReached: capacityState.applicationFull,
    capacityMode: 'ADVISORY',
    waitlistActive: false,
    waitlistFull: false,
    remainingSlots: null,
    closedMessage: configuredClosedMessage,
    configuredClosedMessage
  };
}

function getMockGuestApplicationList(status) {
  const all = MOCK_GUEST_APPLICATIONS.slice();
  const visible = !status || status === 'ALL'
    ? all
    : status === 'CLOSED'
      ? all.filter(application => ['REJECTED', 'INACTIVE'].includes(application.status))
      : all.filter(application => application.status === status);
  return visible.map(application => ({
    applicationId: application.applicationId,
    createdAt: application.createdAt,
    name: application.name,
    relationType: application.relationType,
    phoneMasked: application.phone ? `${application.phone.slice(0, 3)}-****-${application.phone.slice(-4)}` : '-',
    deliverySummary: application.deliveryPlace,
    preferredDays: application.preferredDays,
    status: application.status,
    contactedAt: application.contactedAt,
    retentionUntil: application.retentionUntil,
    anonymizedAt: application.anonymizedAt,
    testMarked: String(application.adminMemo || '').includes('[테스트]'),
    currentServiceWeek: '',
    currentServiceStatus: '',
    lastCompletedAt: '',
    updatedAt: application.updatedAt
  }));
}

function getMockApplicationServiceWeek(value) {
  const date = value ? new Date(value + (String(value).length === 10 ? 'T00:00:00' : '')) : new Date();
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

function getMockGuestApplicationOperations(serviceWeek) {
  const week = getMockApplicationServiceWeek(serviceWeek);
  const rows = MOCK_GUEST_APPLICATION_OPERATIONS.filter(row => row.serviceWeek === week);
  const byApplication = {};
  rows.forEach(row => { byApplication[row.applicationId] = row; });
  const lastCompletedAt = {};
  const completedServiceCount = {};
  const completedKeys = new Set();
  MOCK_GUEST_APPLICATION_OPERATIONS.forEach(row => {
    if (row.status !== 'COMPLETED') return;
    const completedKey = `${row.applicationId}|${row.serviceWeek}`;
    if (completedKeys.has(completedKey)) return;
    completedKeys.add(completedKey);
    completedServiceCount[row.applicationId] = (completedServiceCount[row.applicationId] || 0) + 1;
    if (!lastCompletedAt[row.applicationId] || row.completedAt > lastCompletedAt[row.applicationId]) {
      lastCompletedAt[row.applicationId] = row.completedAt;
    }
  });
  const candidates = MOCK_GUEST_APPLICATIONS
    .filter(application => application.status === 'APPROVED')
    .map(application => ({
      applicationId: application.applicationId,
      name: application.name,
      preferredDays: application.preferredDays,
      currentServiceStatus: byApplication[application.applicationId]?.status || '',
      lastCompletedAt: lastCompletedAt[application.applicationId] || ''
    }));
  const applications = MOCK_GUEST_APPLICATIONS
    .filter(application => !application.anonymizedAt)
    .map(application => ({
      applicationId: application.applicationId,
      name: application.name,
      status: application.status,
      preferredDays: application.preferredDays,
      waitlistPosition: application.waitlistPosition || '',
      contactedAt: application.contactedAt || '',
      testMarked: String(application.adminMemo || '').startsWith('[테스트]'),
       currentServiceStatus: byApplication[application.applicationId]?.status || '',
       currentOperationId: byApplication[application.applicationId]?.operationId || '',
       lastCompletedAt: lastCompletedAt[application.applicationId] || '',
       completedServiceCount: completedServiceCount[application.applicationId] || 0,
       scheduledWeeks: MOCK_GUEST_APPLICATION_OPERATIONS
         .filter(row => row.applicationId === application.applicationId && row.status !== 'CANCELLED')
         .map(row => row.serviceWeek)
         .filter((week, index, weeks) => weeks.indexOf(week) === index)
         .sort()
     }));
  const configured = getMockGuestApplicationSettingsResponse();
  return {
    serviceWeek: week,
    settings: {
      ...configured,
      mode: configured.schedulingMode || 'MANUAL',
      paused: configured.paused === true,
      pauseWeek: configured.pauseWeek || '',
      pauseReason: configured.pauseReason || ''
    },
    operations: rows,
    candidates,
    applications,
    lastCompletedAt
  };
}

/**
 * 구글 드라이브 이미지 주소를 브라우저에서 직접 표시 가능한 썸네일 주소로 변환
 */
function convertDriveImageUrl(url) {
  if (!url) return '';
  const text = String(url).trim();

  // 구글 드라이브 주소인지 확인
  const isDrive = text.includes("drive.google.com") || text.includes("docs.google.com");
  
  if (isDrive) {
    // 1) /d/파일ID/ 형식 추출
    const dMatch = text.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (dMatch && dMatch[1]) {
      return `https://drive.google.com/thumbnail?id=${dMatch[1]}&sz=w500`;
    }
    // 2) id=파일ID 형식 추출
    const idMatch = text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idMatch && idMatch[1]) {
      return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w500`;
    }
  }

  // 3) 만약 HTTP/HTTPS 주소가 아니면서 특정 알파벳/숫자/대시/언더바 조합인 경우 단순 파일 ID로 보고 구글 드라이브 주소로 치환
  // (ID는 보통 25자 이상의 고유 식별값임. 1, 2, user001 등 짧은 문자열과 혼동 방지)
  if (!text.startsWith("http") && /^[a-zA-Z0-9_-]{25,}$/.test(text)) {
    return `https://drive.google.com/thumbnail?id=${text}&sz=w500`;
  }

  return text;
}
// API 호출 캐시 저장소 (정적/기초 데이터 로딩 부하 경감용)
const API_CACHE = {};

const API_DIAGNOSTICS = (() => {
  const enabled = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('apiDebug') === '1';
  const maxRecords = 300;
  const requests = [];
  const flows = [];
  const activeSignatures = new Map();
  let sequence = 0;

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const round = value => Math.round(Number(value || 0) * 10) / 10;

  function trimRecords(list) {
    if (list.length > maxRecords) list.splice(0, list.length - maxRecords);
  }

  function percentile(values, ratio) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
    return round(sorted[Math.max(0, index)]);
  }

  function beginRequest(action, method, params) {
    if (!enabled) return null;
    const paramKeys = params ? Object.keys(params).sort().join(',') : '';
    const signature = `${method}:${action}:${paramKeys}`;
    const activeCount = activeSignatures.get(signature) || 0;
    activeSignatures.set(signature, activeCount + 1);
    return {
      id: ++sequence,
      action,
      method,
      signature,
      startedAt: now(),
      duplicateInFlight: activeCount > 0,
      concurrentAtStart: [...activeSignatures.values()].reduce((sum, count) => sum + count, 0)
    };
  }

  function finishRequest(context, details = {}) {
    if (!context) return;
    const activeCount = activeSignatures.get(context.signature) || 1;
    if (activeCount <= 1) activeSignatures.delete(context.signature);
    else activeSignatures.set(context.signature, activeCount - 1);

    const record = {
      id: context.id,
      page: window.location.pathname.split('/').pop() || 'index.html',
      action: context.action,
      method: context.method,
      source: details.source || 'network',
      durationMs: round(now() - context.startedAt),
      networkMs: round(details.networkMs),
      parseMs: round(details.parseMs),
      responseChars: Number(details.responseChars) || 0,
      success: details.success !== false,
      status: Number(details.status) || 0,
      duplicateInFlight: context.duplicateInFlight,
      concurrentAtStart: context.concurrentAtStart,
      timestamp: new Date().toISOString(),
      error: details.error ? String(details.error).slice(0, 160) : ''
    };
    requests.push(record);
    trimRecords(requests);
    console.debug(`[API 진단] ${JSON.stringify(record)}`);
  }

  function startFlow(name) {
    if (!enabled) return null;
    return { name, startedAt: now(), requestStartId: sequence + 1 };
  }

  function finishFlow(context) {
    if (!context) return;
    const relatedRequests = requests.filter(record => record.id >= context.requestStartId);
    const flow = {
      page: window.location.pathname.split('/').pop() || 'index.html',
      name: context.name,
      durationMs: round(now() - context.startedAt),
      requestCount: relatedRequests.length,
      duplicateCount: relatedRequests.filter(record => record.duplicateInFlight).length,
      timestamp: new Date().toISOString()
    };
    flows.push(flow);
    trimRecords(flows);
    console.debug(`[화면 로드 진단] ${JSON.stringify(flow)}`);
  }

  function summarize(list, key) {
    const groups = {};
    list.forEach(item => {
      const name = item[key];
      if (!groups[name]) groups[name] = [];
      groups[name].push(item);
    });
    return Object.entries(groups).map(([name, items]) => {
      const durations = items.map(item => item.durationMs);
      return {
        name,
        count: items.length,
        medianMs: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        maxMs: round(Math.max(...durations)),
        duplicates: items.filter(item => item.duplicateInFlight).length,
        errors: items.filter(item => item.success === false).length
      };
    }).sort((a, b) => b.p95Ms - a.p95Ms);
  }

  function report() {
    return {
      enabled,
      page: typeof window !== 'undefined' ? window.location.href : '',
      generatedAt: new Date().toISOString(),
      totals: {
        requests: requests.length,
        networkRequests: requests.filter(item => item.source === 'network').length,
        cacheHits: requests.filter(item => item.source === 'cache').length,
        duplicates: requests.filter(item => item.duplicateInFlight).length,
        errors: requests.filter(item => item.success === false).length
      },
      actions: summarize(requests, 'action'),
      flows: summarize(flows, 'name'),
      requestTimeline: [...requests],
      flowTimeline: [...flows]
    };
  }

  function clear() {
    requests.length = 0;
    flows.length = 0;
    activeSignatures.clear();
  }

  return { enabled, beginRequest, finishRequest, startFlow, finishFlow, report, clear };
})();

if (typeof window !== 'undefined') {
  window.ApiDiagnostics = API_DIAGNOSTICS;
}

const warnedApiContractVersions = new Set();

function getApiContractStatus(response) {
  const actual = String(response?.apiContractVersion || '').trim();
  return {
    expected: API_CONTRACT_VERSION,
    actual,
    compatible: actual === API_CONTRACT_VERSION
  };
}

function warnIfApiContractMismatched(action, response) {
  const status = getApiContractStatus(response);
  if (status.compatible) return;
  const warningKey = status.actual || '(missing)';
  if (warnedApiContractVersions.has(warningKey)) return;
  warnedApiContractVersions.add(warningKey);
  console.warn(
    `[API Contract] ${action} 응답 버전이 다릅니다. expected=${status.expected}, actual=${warningKey}`
  );
}

if (typeof window !== 'undefined') {
  window.getApiContractStatus = getApiContractStatus;
}

/**
 * Apps Script API 통신을 담당하는 헬퍼 함수
 * @param {string} action - API 요청 액션 (getUsers, getSnacks, placeOrder, getPublicOrderFeed)
 * @param {Object} [options] - fetch 옵션 (method, body 등)
 * @returns {Promise<Object>} API 응답 데이터
 */
async function fetchAPI(action, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const requestedTimeoutMs = Number(options.timeoutMs);
  const defaultTimeoutMs = method === 'POST'
    || action === 'getAdminDashboard'
    || action === 'getKitchenDashboard'
    ? 40000
    : 20000;
  const timeoutMs = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs >= 1000
    ? Math.min(requestedTimeoutMs, 120000)
    : defaultTimeoutMs;
  const diagnosticRequest = API_DIAGNOSTICS.beginRequest(action, method, options.params);

  // 1. 뮤테이션(쓰기 작업) 발생 시 모든 캐시 삭제하여 정합성 유지
  const isMutation = /^(update|delete|place|cancel|submit|toggle|archive|add|autoFill|skip|anonymize)/.test(action);
  if (isMutation) {
    for (const key in API_CACHE) {
      delete API_CACHE[key];
    }
  }

  // 2. 캐시 조회 (GET 요청이면서 getUsers인 경우 2분 캐싱 적용)
  const isCacheable = method === 'GET' && (action === 'getUsers');
  const cacheKey = `${action}_${options.params ? JSON.stringify(options.params) : ''}`;
  if (isCacheable) {
    const cached = API_CACHE[cacheKey];
    if (cached && (Date.now() - cached.timestamp < 120000)) { // 2분 캐시
      safeLog(`[API Cache Hit] Using cached data for ${action}`);
      API_DIAGNOSTICS.finishRequest(diagnosticRequest, {
        source: 'cache',
        success: cached.data?.success !== false
      });
      return cached.data;
    }
  }

  if (typeof USE_MOCK !== 'undefined' && USE_MOCK) {
    console.log(`[API Mock] USE_MOCK이 활성화되어 있어 Mock 데이터를 사용합니다. Action: ${action}`);
    const mockData = getMockFallback(action, options);
    API_DIAGNOSTICS.finishRequest(diagnosticRequest, {
      source: 'mock',
      success: mockData?.success !== false,
      responseChars: API_DIAGNOSTICS.enabled ? JSON.stringify(mockData || {}).length : 0
    });
    return mockData;
  }

  let url = `${API_URL}?action=${action}`;

  // GET 요청 파라미터 매핑
  if (method === 'GET' && options.params) {
    const queryParams = new URLSearchParams(options.params).toString();
    url += `&${queryParams}`;
  }

  const fetchOptions = {
    method: method,
    mode: 'cors',
    redirect: 'follow', // GAS Web App Redirect 필수 처리
  };

  // 일반 조회는 20초, 관리자 POST와 통합 대시보드는 GAS 콜드 스타트를 고려해 40초를 사용합니다.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.warn(`[API Timeout] ${action} 요청이 ${timeoutMs}ms 동안 응답이 없어 강제 중단합니다.`);
    controller.abort();
  }, timeoutMs);
  fetchOptions.signal = controller.signal;

  // POST 요청 설정
  if (method === 'POST') {
    // GAS가 JSON을 잘 파싱할 수 있게 text/plain으로 보내거나 standard json으로 보냄.
    // 여기서는 명세 상의 POST JSON을 따름
    fetchOptions.headers = {
      'Content-Type': 'text/plain;charset=utf-8' // CORS preflight 회피 및 GAS 파싱 호환성용
    };
    
    // API 명세 상 action이 body 안에 포함되어야 하므로 placeOrder 등의 액션을 body에 같이 전달
    const requestBody = {
      action: action,
      ...options.body
    };
    fetchOptions.body = JSON.stringify(requestBody);
    
    // POST는 쿼리 파라미터 없이 본래 URL로 전송
    url = API_URL;
  }

  try {
    safeLog("API Request", { url, method, action });
    const networkStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const response = await fetch(url, fetchOptions);
    const networkFinishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const parseStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const data = await response.json();
    const parseFinishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    safeLog("API Response", data);
    warnIfApiContractMismatched(action, data);

    // 구글 드라이브 이미지 URL 변환 처리
    if (data && data.success) {
      if (Array.isArray(data.users)) {
        data.users = data.users.map(u => ({
          ...u,
          imageUrl: convertDriveImageUrl(u.imageUrl)
        }));
      }
      if (Array.isArray(data.snacks)) {
        data.snacks = data.snacks.map(s => ({
          ...s,
          imageUrl: convertDriveImageUrl(s.imageUrl)
        }));
      }

      // 캐시 저장
      if (isCacheable) {
        API_CACHE[cacheKey] = {
          data: data,
          timestamp: Date.now()
        };
      }
    }

    API_DIAGNOSTICS.finishRequest(diagnosticRequest, {
      source: 'network',
      networkMs: networkFinishedAt - networkStartedAt,
      parseMs: parseFinishedAt - parseStartedAt,
      responseChars: API_DIAGNOSTICS.enabled ? JSON.stringify(data || {}).length : 0,
      success: data?.success !== false,
      status: response.status
    });
    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    const isTimeout = error && error.name === 'AbortError';
    API_DIAGNOSTICS.finishRequest(diagnosticRequest, {
      source: 'network',
      success: false,
      error
    });
    console.error("API Error", error);
    console.warn(`[API Warning] 실제 API 호출 실패 혹은 CORS 발생. Mock 데이터를 사용합니다. Action: ${action}`, error);
    // 에러 발생 시 사용자 경험 중단을 막기 위해 Mock 데이터로 폴백 제공
    return {
      success: false,
      message: isTimeout
        ? '서버 응답이 늦어 연결 시간이 초과되었습니다.'
        : '데이터 연결에 실패했습니다.',
      networkError: true,
      errorType: isTimeout ? 'timeout' : 'network',
      error: String(error)
    };
  }
}

/**
 * 데이터 변경이 없는 조회 요청을 일시적인 GAS 네트워크 오류에 한해 한 번 재시도합니다.
 * POST 형식의 관리자 조회에도 쓰지만, 저장·수정 액션에는 사용하지 않습니다.
 */
async function fetchAPIReadWithRetry(action, options = {}) {
  const requestOptions = {
    ...options,
    timeoutMs: options.timeoutMs ?? 40000
  };
  let response = await fetchAPI(action, requestOptions);
  if (!response?.networkError) return response;

  await new Promise(resolve => setTimeout(resolve, 700));
  response = await fetchAPI(action, requestOptions);
  return response;
}

function getMockSnacks() {
  let cached = localStorage.getItem('mockSnacks');
  if (!cached) {
    localStorage.setItem('mockSnacks', JSON.stringify(MOCK_DATA.getSnacks.snacks));
    return MOCK_DATA.getSnacks.snacks;
  }
  return JSON.parse(cached);
}

function saveMockSnacks(snacks) {
  localStorage.setItem('mockSnacks', JSON.stringify(snacks));
}

function parseMockMaxPerPerson(value) {
  const text = String(value == null ? '' : value).trim();
  if (text === '') return 0;
  const parsed = Number(text);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * API 호출 실패 시 로컬에서 응답할 Mock 데이터 처리기
 */
function getMockFallback(action, options) {
  let res;
  if (action === 'healthCheck') {
    res = { success: true, status: 'ok' };
  } else if (action === 'getAdminDashboard') {
    const snacks = { success: true, snacks: getMockSnacks() };
    const users = JSON.parse(JSON.stringify(MOCK_DATA.getUsers));
    res = { success: snacks.success !== false, snacks, users };
  } else if (action === 'getKitchenDashboard') {
    const orders = getMockFallback('getAdminOrdersToday', {});
    const users = JSON.parse(JSON.stringify(MOCK_DATA.getUsers));
    const snacks = { success: true, snacks: getMockSnacks() };
    const guestSettings = getMockFallback('getGuestSettings', {});
    const deliveryPlaceAliases = getMockFallback('getDeliveryPlaceAliases', {});
    res = { success: orders.success !== false, orders, users, snacks, guestSettings, deliveryPlaceAliases };
  } else if (action === 'getAdminOrdersToday') {
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    const mockOrders = [...localOrders, ...MOCK_DATA.getOrdersToday.orders];
    res = {
      success: true,
      orders: mockOrders.map(order => ({ ...order, reviewed: order.reviewed || false })),
      orderSheetRowCount: mockOrders.length,
      deliveryPlaceAliases: getMockFallback('getDeliveryPlaceAliases', {})
    };
  } else if (action === 'getDeliveryPlaceAliases') {
    res = { success: true, aliases: [] };
  } else if (action === 'updateDeliveryPlaceAliases') {
    res = { success: true, aliases: options.body?.aliases || [], message: '배송지 별칭을 저장했습니다.' };
  } else if (action === 'getUsers') {
    res = JSON.parse(JSON.stringify(MOCK_DATA.getUsers));
    res.users = res.users.filter(u => {
      const active = String(u.useYn ?? u.active ?? 'Y').trim().toUpperCase();
      return active === 'TRUE' || active === '사용' || active === 'Y' || active === 'O' || active === '예';
    });
  } else if (action === 'getSnacks') {
    res = {
      success: true,
      snacks: getMockSnacks()
    };
    res.snacks = res.snacks.filter(s => {
      const active = String(s.saleYn ?? s.active ?? 'Y').trim().toUpperCase();
      return active === 'TRUE' || active === '판매' || active === 'Y' || active === 'O' || active === '예';
    });
    const mode = options.params?.mode;
    if (mode) {
      const cleanedMode = String(mode).trim().toLowerCase();
      const parseTargetList = (t) => {
        const str = String(t || 'user').toLowerCase();
        return str.split(',').map(s => s.trim()).filter(Boolean);
      };
      if (cleanedMode === 'user' || cleanedMode === 'kiosk') {
        res.snacks = res.snacks.filter(s => {
          const tList = parseTargetList(s.target);
          return tList.includes('user');
        });
      } else if (cleanedMode === 'guest') {
        const settings = getMockGuestSettings();
        const menuMode = String(settings.guestMenuMode || 'normal').toLowerCase();
        if (menuMode === 'event') {
          res.snacks = res.snacks.filter(s => {
            const tList = parseTargetList(s.target);
            return tList.includes('event') || tList.includes('campaign');
          });
        } else {
          res.snacks = res.snacks.filter(s => {
            const tList = parseTargetList(s.target);
            return tList.includes('guest');
          });
        }
      }
    }
  } else if (action === 'getGuestApplicationSettings') {
    res = getMockGuestApplicationSettingsResponse();
  } else if (action === 'submitGuestApplication') {
    const body = options.body || {};
    const requestId = String(body.requestId || '').trim();
    const existingRequest = MOCK_GUEST_APPLICATIONS.find(application => application.requestId === requestId);
    const settings = getMockGuestApplicationSettingsResponse();
    const normalizedPhone = String(body.phone || '').replace(/\D/g, '');
    const duplicatePhone = MOCK_GUEST_APPLICATIONS.find(application => (
      !application.anonymizedAt
      && String(application.phone || '').replace(/\D/g, '') === normalizedPhone
    ));

    if (existingRequest) {
      res = {
        success: true,
        idempotent: true,
        applicationId: existingRequest.applicationId,
        status: existingRequest.status,
        message: '이미 접수된 Mock 신청 결과를 확인했습니다.'
      };
    } else if (!settings.applicationOpenConfigured) {
      res = { success: false, code: 'APPLICATION_CLOSED', message: settings.closedMessage };
    } else if (duplicatePhone && normalizedPhone) {
      res = { success: false, code: 'DUPLICATE_PHONE', message: '이미 접수된 신청이 있습니다.' };
    } else {
      const now = new Date().toISOString();
      const applicationId = 'APP-MOCK-' + String(Date.now()).slice(-6);
      MOCK_GUEST_APPLICATIONS.push({
        createdAt: now,
        applicationId,
        requestId,
        name: body.name || 'Mock 신청자',
        relationType: body.relationType || 'OTHER',
        relationDetail: body.relationDetail || '',
        phone: normalizedPhone,
        deliveryPlace: body.deliveryPlace || '',
        deliveryDetail: body.deliveryDetail || '',
        preferredDays: Array.isArray(body.preferredDays) ? body.preferredDays.join(', ') : String(body.preferredDays || ''),
        message: body.message || '',
        consentAt: now,
        status: 'PENDING',
        contactedAt: '',
        reviewedAt: '',
        retentionUntil: '',
        anonymizedAt: '',
        adminMemo: '',
        updatedAt: now
      });
      res = {
        success: true,
        applicationId,
        status: 'PENDING',
        capacity: settings.capacity,
        capacityMode: 'ADVISORY',
        capacityReached: settings.capacityReached === true,
        message: 'Mock 이용 신청이 접수되었습니다.'
      };
    }
  } else if (action === 'getGuestApplicationsForAdmin') {
    const status = String(options.body?.status || 'ALL').toUpperCase();
    res = {
      success: true,
      counts: getMockGuestApplicationCounts(MOCK_GUEST_APPLICATIONS),
      settings: getMockGuestApplicationSettingsResponse(),
      applications: getMockGuestApplicationList(status)
    };
  } else if (action === 'getGuestApplicationDetail') {
    const application = MOCK_GUEST_APPLICATIONS.find(item => item.applicationId === options.body?.applicationId);
    res = application
      ? { success: true, application: JSON.parse(JSON.stringify(application)) }
      : { success: false, message: '신청 정보를 찾을 수 없습니다.' };
  } else if (action === 'updateGuestApplication') {
    const application = MOCK_GUEST_APPLICATIONS.find(item => item.applicationId === options.body?.applicationId);
    if (!application) {
      res = { success: false, message: '신청 정보를 찾을 수 없습니다.' };
    } else {
      const now = new Date().toISOString();
      const nextStatus = options.body?.status ? String(options.body.status).toUpperCase() : '';
      if (nextStatus) {
        application.status = nextStatus;
        application.reviewedAt = now;
        application.retentionUntil = ['REJECTED', 'INACTIVE'].includes(application.status)
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          : '';
      }
      if (options.body?.contacted !== undefined) application.contactedAt = options.body.contacted ? now : '';
      if (options.body?.adminMemo !== undefined) application.adminMemo = options.body.adminMemo;
      application.updatedAt = now;
      res = { success: true, applicationId: application.applicationId, status: application.status, message: 'Mock 신청 정보가 저장되었습니다.' };
    }
  } else if (action === 'updateGuestApplicationSettings') {
    const hasCapacityInput = options.body?.capacity !== undefined && options.body?.capacity !== null && String(options.body.capacity).trim() !== '';
    const capacityInput = hasCapacityInput ? Number(options.body.capacity) : null;
    if (hasCapacityInput && (!Number.isInteger(capacityInput) || capacityInput < 1 || capacityInput > MOCK_GUEST_APPLICATION_MAX_CAPACITY)) {
      res = { success: false, message: '모집 정원은 1명부터 100명 사이의 정수로 입력해 주세요.' };
    } else {
      MOCK_GUEST_APPLICATION_SETTINGS.applicationOpen = Boolean(options.body?.applicationOpen);
      MOCK_GUEST_APPLICATION_SETTINGS.target = options.body?.target || '';
      MOCK_GUEST_APPLICATION_SETTINGS.operatingDays = options.body?.operatingDays || '';
      MOCK_GUEST_APPLICATION_SETTINGS.orderTime = options.body?.orderTime || '';
      MOCK_GUEST_APPLICATION_SETTINGS.deliveryTime = options.body?.deliveryTime || '';
      MOCK_GUEST_APPLICATION_SETTINGS.serviceArea = options.body?.serviceArea || '';
      MOCK_GUEST_APPLICATION_SETTINGS.usageGuide = options.body?.usageGuide || '';
      MOCK_GUEST_APPLICATION_SETTINGS.preferredDayOptions = String(options.body?.preferredDayOptions || '').split(',').map(day => day.trim()).filter(Boolean);
      if (hasCapacityInput) MOCK_GUEST_APPLICATION_SETTINGS.capacity = capacityInput;
      MOCK_GUEST_APPLICATION_SETTINGS.closedMessage = options.body?.closedMessage || '';
      res = { success: true, message: 'Mock 신청 설정이 저장되었습니다.' };
    }
  } else if (action === 'getGuestApplicationOperations') {
    res = { success: true, ...getMockGuestApplicationOperations(options.body?.serviceWeek) };
  } else if (action === 'updateGuestApplicationSchedulingSettings') {
    res = {
      success: true,
      settings: { ...getMockGuestApplicationSettingsResponse(), mode: 'MANUAL', paused: false, pauseWeek: '', pauseReason: '' },
      message: '주간 운영은 선택한 날짜와 대상 확정으로 관리합니다.'
    };
  } else if (action === 'assignGuestApplicationsToWeek') {
    const week = getMockApplicationServiceWeek(options.body?.serviceWeek);
    const ids = Array.isArray(options.body?.applicationIds) ? options.body.applicationIds.map(String) : [];
    if (!ids.length) {
      res = { success: false, message: '이번 주 운영 대상자를 선택해 주세요.' };
    } else if (ids.some(id => MOCK_GUEST_APPLICATION_OPERATIONS.some(row => row.serviceWeek === week && row.applicationId === id && ['SELECTED', 'COMPLETED'].includes(row.status)))) {
      res = { success: false, message: '이미 이번 주 운영 기록이 있는 신청자가 포함되어 있습니다.' };
    } else {
      const now = new Date().toISOString();
      ids.forEach((id, index) => MOCK_GUEST_APPLICATION_OPERATIONS.push({
        operationId: `OP-MOCK-${Date.now()}-${index}`,
        applicationId: id,
        name: MOCK_GUEST_APPLICATIONS.find(application => application.applicationId === id)?.name || id,
        serviceWeek: week,
        status: 'SELECTED',
        selectedAt: now,
        completedAt: '',
        adminMemo: '',
        createdAt: now,
        updatedAt: now
      }));
      res = { success: true, serviceWeek: week, count: ids.length, message: '이번 주 운영 대상자를 확정했습니다.' };
    }
  } else if (action === 'completeGuestApplicationOperations') {
    const ids = Array.isArray(options.body?.operationIds) ? options.body.operationIds.map(String) : [];
    const now = new Date().toISOString();
    let count = 0;
    MOCK_GUEST_APPLICATION_OPERATIONS.forEach(row => {
      if (ids.includes(row.operationId) && row.status === 'SELECTED') {
        row.status = 'COMPLETED';
        row.completedAt = now;
        row.updatedAt = now;
        count++;
      }
    });
    res = { success: true, count, message: `${count}명의 서비스 제공을 완료했습니다.` };
  } else if (action === 'cancelGuestApplicationOperations') {
    const ids = Array.isArray(options.body?.operationIds) ? options.body.operationIds.map(String) : [];
    let count = 0;
    MOCK_GUEST_APPLICATION_OPERATIONS.forEach(row => {
      if (ids.includes(row.operationId) && row.status === 'SELECTED') {
        row.status = 'CANCELLED';
        row.adminMemo = '[확정 취소] ' + String(row.adminMemo || '').replace(/^\[확정 취소\]\s*/, '');
        row.updatedAt = new Date().toISOString();
        count++;
      }
    });
    res = count
      ? { success: true, cancelled: count, message: `${count}명의 이번 주 운영 확정을 취소했습니다.` }
      : { success: false, message: '선택한 대상 중 확정 취소할 수 있는 운영 대상이 없습니다.' };
  } else if (action === 'repairGuestApplicationOperationDuplicates') {
    res = options.body?.confirmText === '운영기록중복정리'
      ? { success: true, cancelled: 0, backupName: '이용운영기록_목업백업', message: '중복 운영 기록이 없습니다.' }
      : { success: false, message: '확인 문구 운영기록중복정리를 정확히 입력해 주세요.' };
  } else if (action === 'markGuestApplicationTestData') {
    const application = MOCK_GUEST_APPLICATIONS.find(item => item.applicationId === options.body?.applicationId);
    if (!application) {
      res = { success: false, message: '신청 정보를 찾을 수 없습니다.' };
    } else {
      application.adminMemo = '[테스트] ' + String(application.adminMemo || '').replace(/^\[테스트\]\s*/, '');
      application.updatedAt = new Date().toISOString();
      res = { success: true, message: '테스트 신청으로 표시했습니다.' };
    }
  } else if (action === 'deleteTestGuestApplications') {
    if (String(options.body?.confirmText || '').trim() !== '테스트신청정리') {
      res = { success: false, message: '확인 문구 테스트신청정리를 정확히 입력해 주세요.' };
    } else {
      const ids = Array.isArray(options.body?.applicationIds) ? options.body.applicationIds.map(String) : [];
      const before = MOCK_GUEST_APPLICATIONS.length;
      MOCK_GUEST_APPLICATIONS = MOCK_GUEST_APPLICATIONS.filter(application => !ids.includes(application.applicationId) || !String(application.adminMemo || '').startsWith('[테스트]'));
      res = { success: true, deleted: before - MOCK_GUEST_APPLICATIONS.length, message: `${before - MOCK_GUEST_APPLICATIONS.length}건의 테스트 신청을 정리했습니다.` };
    }
  } else if (action === 'auditExpiredGuestApplications') {
    res = { success: true, count: 0, applications: [], message: '익명화할 만료 신청 정보가 없습니다.' };
  } else if (action === 'anonymizeExpiredGuestApplications') {
    res = options.body?.confirmText === '신청정보정리'
      ? {
          success: true,
          count: 0,
          verified: true,
          rolledBack: false,
          recoveryRequired: false,
          cleanupRequired: false,
          backupSheetName: '',
          message: '익명화할 만료 신청 정보가 없습니다.'
        }
      : { success: false, message: '확인 문구 신청정보정리를 정확히 입력해 주세요.' };
  } else if (action === 'getGuestSettings') {
    const settings = getMockGuestSettings();
    const operatingState = resolveMockGuestOperatingState(settings);
    let message = '게스트 주문이 마감되었습니다.';
    if (operatingState.isGuestOpenNow) {
      message = operatingState.effectiveCloseAt
        ? `오늘 ${new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(operatingState.effectiveCloseAt)}까지 주문할 수 있습니다.`
        : '배달왔삼 주문이 운영 중입니다.';
    } else if (operatingState.scheduleSuppressedByEvent) {
      message = '행사 모드에서는 예약 운영이 자동으로 열리지 않습니다.';
    } else if (operatingState.nextGuestSchedule) {
      const next = operatingState.nextGuestSchedule;
      message = `다음 운영은 ${next.date} ${next.startTime}~${next.endTime}입니다.`;
    }

      res = {
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
        guestBaseCredit: settings.guestBaseCredit,
        kakaoGuestBonusCredit: settings.kakaoGuestBonusCredit ?? 2,
        guestDeliveryFee: settings.guestDeliveryFee,
        guestDefaultDeliveryPlace: settings.guestDefaultDeliveryPlace ?? '사무실 원탁',
        guestAllowRandomDisplayName: settings.guestAllowRandomDisplayName !== false,
        adminOrderEmailNotificationEnabled: settings.adminOrderEmailNotificationEnabled !== false,
        guestMenuMode: settings.guestMenuMode || 'normal',
        guestEventName: settings.guestEventName || '장애인식 개선 캠페인',
        guestOrderGraceMinutes: GUEST_ORDER_COMPLETION_GRACE_MINUTES,
        isGuestOpenNow: operatingState.isGuestOpenNow,
        remainingSeconds: operatingState.remainingSeconds,
        message
      };
  } else if (action === 'getKakaoLoginConfig') {
    res = {
      success: true,
      clientId: 'mock-kakao-client-id',
      message: 'Mock 카카오 설정입니다.'
    };
  } else if (action === 'exchangeKakaoAuthCode') {
    if (!options.body?.code) {
      res = { success: false, message: '카카오 인증 코드가 누락되었습니다.' };
    } else {
      res = {
        success: true,
        provider: 'kakao',
        guestKey: 'kakao_mock_guest',
        message: 'Mock 카카오 연결이 완료되었습니다.'
      };
    }
  } else if (action === 'getGuestCreditStatus') {
    res = resolveMockGuestCreditWallet(options.body || {}, { create: false });
  } else if (action === 'updateGuestSettings') {
    const settingsAction = options.body?.settingsAction;
    const settings = getMockGuestSettings();
    const now = new Date();
    const currentState = resolveMockGuestOperatingState(settings, now);

    if (['open20', 'open30', 'open60', 'openCustom', 'openUntil'].includes(settingsAction) && currentState.todayOccurrenceSkipped) {
      res = { success: false, message: '이번 회차 운영 중단을 먼저 해제해 주세요.' };
      return Object.assign({}, res, { apiContractVersion: API_CONTRACT_VERSION, serverTime: new Date().toISOString() });
    }

    if (settingsAction === 'openUntil') {
      const endTime = String(options.body?.guestManualEndTime || '').trim();
      const today = getMockGuestScheduleParts(now);
      const closeAt = buildMockGuestScheduleInstant(formatMockGuestScheduleDateKey(today.year, today.month, today.day), endTime);
      if (!closeAt || closeAt <= now) {
        res = { success: false, message: '오늘 현재 시각보다 늦은 종료 시각을 선택해 주세요.' };
        return Object.assign({}, res, { apiContractVersion: API_CONTRACT_VERSION, serverTime: new Date().toISOString() });
      }
      settings.guestOpen = 'Y';
      settings.guestCloseAt = closeAt.toISOString();
      appendMockAdminLog('updateGuestSettings', 'settings', 'guestOpen', '게스트 운영', 'N', `Y (오늘 ${endTime}까지)`, options.body?.adminMemo);
    } else if (settingsAction === 'open20') {
      settings.guestOpen = 'Y';
      settings.guestCloseAt = new Date(now.getTime() + 20 * 60 * 1000).toISOString();
      appendMockAdminLog('updateGuestSettings', 'settings', 'guestOpen', '게스트 운영', 'N', 'Y (20분)', options.body?.adminMemo);
    } else if (settingsAction === 'open30') {
      settings.guestOpen = 'Y';
      settings.guestCloseAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
      appendMockAdminLog('updateGuestSettings', 'settings', 'guestOpen', '게스트 운영', 'N', 'Y (30분)', options.body?.adminMemo);
    } else if (settingsAction === 'open60') {
      settings.guestOpen = 'Y';
      settings.guestCloseAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
      appendMockAdminLog('updateGuestSettings', 'settings', 'guestOpen', '게스트 운영', 'N', 'Y (60분)', options.body?.adminMemo);
    } else if (settingsAction === 'openCustom') {
      const minutes = Number(options.body?.minutes || 10);
      settings.guestOpen = 'Y';
      settings.guestCloseAt = new Date(now.getTime() + minutes * 60 * 1000).toISOString();
      appendMockAdminLog('updateGuestSettings', 'settings', 'guestOpen', '게스트 운영', 'N', 'Y (' + minutes + '분)', options.body?.adminMemo);
    } else if (settingsAction === 'closeNow') {
      settings.guestOpen = 'N';
      settings.guestCloseAt = '';
      if (currentState.weeklyActive) {
        const today = getMockGuestScheduleParts(now);
        settings.guestWeeklyScheduleSkipDate = formatMockGuestScheduleDateKey(today.year, today.month, today.day);
      }
      if (currentState.activeAdditionalScheduleIds.length > 0) {
        settings.guestAdditionalSchedules = normalizeMockGuestAdditionalSchedules(settings.guestAdditionalSchedules)
          .filter(item => !currentState.activeAdditionalScheduleIds.includes(item.scheduleId));
      }
      appendMockAdminLog('updateGuestSettings', 'settings', 'guestOpen', '게스트 운영', 'Y', currentState.weeklyActive || currentState.additionalActive ? 'N (현재 일정 운영 종료)' : 'N (즉시 마감)', options.body?.adminMemo);
    } else if (settingsAction === 'updateWeeklySchedule') {
      const weekday = Number(options.body?.guestWeeklyScheduleDay);
      const startTime = String(options.body?.guestWeeklyScheduleStartTime || '').trim();
      const endTime = String(options.body?.guestWeeklyScheduleEndTime || '').trim();
      if (![1, 2, 3, 4, 5].includes(weekday) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) || startTime >= endTime) {
        res = { success: false, message: '정기 운영 시간을 올바르게 입력해 주세요.' };
        return Object.assign({}, res, { apiContractVersion: API_CONTRACT_VERSION, serverTime: new Date().toISOString() });
      }
      if (normalizeMockGuestScheduleWeekday(settings.guestWeeklyScheduleDay) !== weekday) settings.guestWeeklyScheduleSkipDate = '';
      settings.guestWeeklyScheduleEnabled = options.body?.guestWeeklyScheduleEnabled === true;
      settings.guestWeeklyScheduleDay = weekday;
      settings.guestWeeklyScheduleStartTime = startTime;
      settings.guestWeeklyScheduleEndTime = endTime;
      appendMockAdminLog('updateGuestSettings', 'settings', 'guestWeeklySchedule', '정기 운영', '', `${settings.guestWeeklyScheduleEnabled ? 'ON' : 'OFF'} ${weekday} ${startTime}~${endTime}`, options.body?.adminMemo);
    } else if (settingsAction === 'skipWeeklyScheduleOccurrence') {
      if (!currentState.weeklyEnabled) {
        res = { success: false, message: '정기 자동 운영을 먼저 켜 주세요.' };
        return Object.assign({}, res, { apiContractVersion: API_CONTRACT_VERSION, serverTime: new Date().toISOString() });
      }
      settings.guestWeeklyScheduleSkipDate = currentState.targetScheduleDate;
      const today = getMockGuestScheduleParts(now);
      if (currentState.targetScheduleDate === formatMockGuestScheduleDateKey(today.year, today.month, today.day)) {
        settings.guestOpen = 'N';
        settings.guestCloseAt = '';
      }
      appendMockAdminLog('updateGuestSettings', 'settings', 'guestWeeklyScheduleSkipDate', '정기 운영 회차 중단', '', currentState.targetScheduleDate, options.body?.adminMemo);
    } else if (settingsAction === 'resumeWeeklyScheduleOccurrence') {
      const previousSkipDate = settings.guestWeeklyScheduleSkipDate || '';
      settings.guestWeeklyScheduleSkipDate = '';
      appendMockAdminLog('updateGuestSettings', 'settings', 'guestWeeklyScheduleSkipDate', '정기 운영 회차 재개', previousSkipDate, '', options.body?.adminMemo);
    } else if (settingsAction === 'upsertAdditionalSchedule') {
      const date = String(options.body?.date || '').trim();
      const startTime = String(options.body?.startTime || '').trim();
      const endTime = String(options.body?.endTime || '').trim();
      const requestedId = String(options.body?.scheduleId || '').trim();
      const today = getMockGuestScheduleParts(now);
      const todayKey = formatMockGuestScheduleDateKey(today.year, today.month, today.day);
      const endAt = buildMockGuestScheduleInstant(date, endTime);
      const schedules = normalizeMockGuestAdditionalSchedules(settings.guestAdditionalSchedules).filter(item => item.date >= todayKey);
      const existingIndex = requestedId ? schedules.findIndex(item => item.scheduleId === requestedId) : -1;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < todayKey || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) || startTime >= endTime || !endAt || endAt <= now) {
        res = { success: false, message: '추가 운영 날짜와 시간을 올바르게 입력해 주세요.' };
        return Object.assign({}, res, { apiContractVersion: API_CONTRACT_VERSION, serverTime: new Date().toISOString() });
      }
      if ((requestedId && existingIndex < 0) || schedules.some(item => item.date === date && item.scheduleId !== requestedId)) {
        res = { success: false, message: requestedId && existingIndex < 0 ? '수정할 추가 운영 일정을 찾을 수 없습니다.' : '같은 날짜에는 추가 운영을 하나만 등록할 수 있습니다.' };
        return Object.assign({}, res, { apiContractVersion: API_CONTRACT_VERSION, serverTime: new Date().toISOString() });
      }
      const scheduleId = requestedId || (globalThis.crypto?.randomUUID?.() || `mock-${Date.now()}`);
      const schedule = { scheduleId, date, startTime, endTime };
      if (existingIndex >= 0) schedules[existingIndex] = schedule;
      else schedules.push(schedule);
      schedules.sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
      settings.guestAdditionalSchedules = schedules;
      appendMockAdminLog('updateGuestSettings', 'settings', 'guestAdditionalSchedules', requestedId ? '추가 운영 수정' : '추가 운영 등록', '', `${date} ${startTime}~${endTime}`, options.body?.adminMemo);
    } else if (settingsAction === 'deleteAdditionalSchedule') {
      const scheduleId = String(options.body?.scheduleId || '').trim();
      const schedules = normalizeMockGuestAdditionalSchedules(settings.guestAdditionalSchedules);
      if (!schedules.some(item => item.scheduleId === scheduleId)) {
        res = { success: false, message: '취소할 추가 운영 일정을 찾을 수 없습니다.' };
        return Object.assign({}, res, { apiContractVersion: API_CONTRACT_VERSION, serverTime: new Date().toISOString() });
      }
      settings.guestAdditionalSchedules = schedules.filter(item => item.scheduleId !== scheduleId);
      appendMockAdminLog('updateGuestSettings', 'settings', 'guestAdditionalSchedules', '추가 운영 취소', scheduleId, '', options.body?.adminMemo);
    } else if (settingsAction === 'updateMenuMode') {
      settings.guestMenuMode = String(options.body?.guestMenuMode || 'normal').toLowerCase();
      if (options.body?.guestEventName !== undefined) {
        settings.guestEventName = String(options.body?.guestEventName).trim();
      }
      appendMockAdminLog('updateGuestSettings', 'settings', 'guestMenuMode', '게스트 메뉴 모드', '', settings.guestMenuMode === 'event' ? `행사 모드 (${settings.guestEventName})` : '배달왔삼 기본 모드', options.body?.adminMemo);
    } else if (settingsAction === 'updateValues') {
      settings.guestBaseCredit = Number(options.body?.guestBaseCredit);
      settings.guestDeliveryFee = Number(options.body?.guestDeliveryFee);
      settings.guestDefaultDeliveryPlace = String(options.body?.guestDefaultDeliveryPlace ?? '사무실 원탁').trim();
      if (options.body?.guestAllowRandomDisplayName !== undefined) {
        settings.guestAllowRandomDisplayName = options.body.guestAllowRandomDisplayName !== false;
      }
      if (options.body?.adminOrderEmailNotificationEnabled !== undefined) {
        settings.adminOrderEmailNotificationEnabled = options.body.adminOrderEmailNotificationEnabled !== false;
      }
      if (options.body?.guestMenuMode !== undefined) {
        settings.guestMenuMode = String(options.body.guestMenuMode).toLowerCase();
      }
      if (options.body?.guestEventName !== undefined) {
        settings.guestEventName = String(options.body.guestEventName).trim();
      }
      appendMockAdminLog('updateGuestSettings', 'settings', 'guestValues', '게스트 설정 변경', '', `온기:${settings.guestBaseCredit}, 배달비:${settings.guestDeliveryFee}, 기본배달지:${settings.guestDefaultDeliveryPlace}`, options.body?.adminMemo);
    }

    saveMockGuestSettings(settings);
    res = { success: true, message: '게스트 운영 설정이 변경되었습니다.' };
  } else if (action === 'getOrderStatus') {
    const identifier = options.params?.orderNo || options.params?.orderToken;
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    const allMockOrders = [...localOrders, ...MOCK_DATA.getOrdersToday.orders];
    const matched = allMockOrders.find(o => o.orderNo === identifier || o.orderToken === identifier);
    if (matched) {
      res = {
        success: true,
        orderNo: matched.orderNo,
        servedYn: matched.servedYn || 'N',
        cancelTimestamp: matched.cancelTimestamp || '',
        deliveryType: matched.deliveryType || 'pickup',
        reviewed: matched.reviewed || false,
        cancelReason: matched.cancelReason || ''
      };
    } else {
      res = {
        success: false,
        message: '해당 주문을 찾을 수 없습니다.'
      };
    }
  } else if (action === 'getGuestOrdersByGuestKey') {
    const authProvider = options.body?.authProvider;
    const guestKey = options.body?.guestKey;
    const includeArchived = options.body?.includeArchived === true;
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    const mockArchived = includeArchived ? JSON.parse(localStorage.getItem('mockArchivedOrders') || '[]') : [];
    const allMockOrders = [...localOrders, ...mockArchived, ...MOCK_DATA.getOrdersToday.orders];
    const todayStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const matchedOrders = allMockOrders.filter(o => {
      const isToday = o.timestamp && o.timestamp.slice(2, 10).replace(/-/g, '') === todayStr;
      if (!includeArchived && !isToday) return false;
      return o.userId === 'guest' && o.authProvider === authProvider && o.guestKey === guestKey;
    });

    res = {
      success: true,
      orders: matchedOrders.map(o => ({ ...o, reviewed: o.reviewed || false }))
    };
  } else if (action === 'getGuestProfileByGuestKey') {
    const authProvider = options.body?.authProvider;
    const guestKey = options.body?.guestKey;
    const profiles = JSON.parse(localStorage.getItem('mockGuestProfiles') || '{}');
    if (authProvider !== 'kakao' || !guestKey) {
      res = { success: false, message: '카카오 연결 정보가 누락되었습니다.' };
    } else {
      res = {
        success: true,
        profile: profiles[guestKey] || null
      };
    }
  } else if (action === 'deleteGuestProfileByGuestKey') {
    const authProvider = options.body?.authProvider;
    const guestKey = options.body?.guestKey;
    const profiles = JSON.parse(localStorage.getItem('mockGuestProfiles') || '{}');
    if (authProvider !== 'kakao' || !guestKey) {
      res = { success: false, message: '카카오 연결 정보가 누락되었습니다.' };
    } else {
      delete profiles[guestKey];
      localStorage.setItem('mockGuestProfiles', JSON.stringify(profiles));
      res = { success: true, message: '저장된 게스트 정보가 삭제되었습니다.' };
    }
  } else if (action === 'updateGuestProfileByGuestKey') {
    const authProvider = options.body?.authProvider;
    const guestKey = options.body?.guestKey;
    const displayName = options.body?.displayName;
    const deliveryPlace = options.body?.deliveryPlace;
    const profiles = JSON.parse(localStorage.getItem('mockGuestProfiles') || '{}');
    if (authProvider !== 'kakao' || !guestKey) {
      res = { success: false, message: '카카오 연결 정보가 누락되었습니다.' };
    } else if (!displayName) {
      res = { success: false, message: '주문표시명을 입력해 주세요.' };
    } else {
      profiles[guestKey] = {
        displayName: String(displayName).trim(),
        deliveryPlace: String(deliveryPlace || '').trim(),
        updatedAt: new Date().toISOString()
      };
      localStorage.setItem('mockGuestProfiles', JSON.stringify(profiles));
      res = {
        success: true,
        message: '프로필 정보가 수정되었습니다.',
        profile: profiles[guestKey]
      };
    }
  } else if (action === 'getPublicOrderFeed' || action === 'getOrdersToday') {
    // 로컬 스토리지에 저장된 테스트용 주문 내역이 있으면 그것을 병합
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    const mockOrders = [...localOrders, ...MOCK_DATA.getOrdersToday.orders];
    res = {
      success: true,
      orders: mockOrders.map(o => ({
        timestamp: o.timestamp,
        orderNo: o.orderNo,
        nickname: o.nickname,
        snackName: o.snackName,
        quantity: o.quantity,
        servedYn: o.servedYn || 'N',
        deliveryType: o.deliveryType || 'pickup',
        isKakao: o.authProvider === 'kakao',
        cancelTimestamp: o.cancelTimestamp || '',
        cancelReason: o.cancelReason || ''
      }))
    };
  } else if (action === 'placeOrder') {
    // 주문 완료 시 로컬 스토리지에 임시 주문 추가 (관리자 화면에서 확인 가능하게)
    const userId = options.body?.userId || 'unknown';
    const items = options.body?.items || [];
    if (!Array.isArray(items) || items.length === 0) {
      return { success: false, message: '주문 정보가 부족합니다.' };
    }
    const normalizedItems = [];
    const itemIndexBySnackId = {};
    for (const item of items) {
      const snackIdKey = String(item?.snackId == null ? '' : item.snackId).trim();
      const quantity = Number(item?.quantity);
      if (!snackIdKey || !Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
        return { success: false, message: '주문 간식 수량이 올바르지 않습니다.' };
      }
      if (Object.prototype.hasOwnProperty.call(itemIndexBySnackId, snackIdKey)) {
        normalizedItems[itemIndexBySnackId[snackIdKey]].quantity += quantity;
      } else {
        itemIndexBySnackId[snackIdKey] = normalizedItems.length;
        normalizedItems.push({ snackId: item.snackId, quantity });
      }
    }
    const isGuest = (userId === 'guest');
    const idempotencyKey = String(options.body?.idempotencyKey || '').trim();
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    const idempotentRows = idempotencyKey
      ? localOrders.filter(o => o.idempotencyKey === idempotencyKey && String(o.userId) === String(userId))
      : [];
    if (idempotentRows.length > 0) {
      const firstRow = idempotentRows[0];
      const replayTotal = Number(firstRow.totalCredit || idempotentRows.reduce((sum, row) => sum + Number(row.point || 0), 0));
      const selectedUser = JSON.parse(localStorage.getItem('selectedUser') || 'null');
      const storedUser = !isGuest
        ? MOCK_DATA.getUsers.users.find(user => String(user.userId) === String(userId))
        : null;
      const replayBeforeCredit = isGuest
        ? (selectedUser ? Number(selectedUser.credit || 0) + replayTotal : undefined)
        : Number(storedUser?.credit || selectedUser?.credit || 0);
      return {
        ...JSON.parse(JSON.stringify(MOCK_DATA.placeOrder)),
        orderNo: firstRow.orderNo || '',
        orderToken: firstRow.orderToken || '',
        totalPoint: replayTotal,
        beforeCredit: replayBeforeCredit,
        afterCredit: replayBeforeCredit === undefined
          ? undefined
          : Math.max(0, replayBeforeCredit - replayTotal),
        idempotencyKey,
        idempotentReplay: true
      };
    }

    // 게스트 주문 시 운영 상태 검증
    if (isGuest) {
      const gSettings = getMockGuestSettings();
      const now = new Date();
      const operatingState = resolveMockGuestOperatingState(gSettings, now);
      if (!operatingState.isGuestOpenNow) {
        const closeAt = operatingState.completionGraceCloseAt;
        const startedAt = new Date(options.body?.orderStartedAt || '');
        const graceEndsAt = closeAt
          ? new Date(closeAt.getTime() + GUEST_ORDER_COMPLETION_GRACE_MINUTES * 60 * 1000)
          : null;
        const canCompleteStartedOrder = Boolean(
          closeAt && graceEndsAt && !Number.isNaN(startedAt.getTime())
          && startedAt < closeAt && now <= graceEndsAt
        );
        if (!canCompleteStartedOrder) {
          return {
            success: false,
            message: closeAt ? '주문 운영 종료 후 완료 가능 시간이 지났습니다.' : '게스트 주문이 마감되었습니다.'
          };
        }
      }

      const hasKakaoKey = options.body?.authProvider === 'kakao' && options.body?.guestKey;
      if (!options.body?.guestDeviceId && !hasKakaoKey) {
        return { success: false, message: '게스트 주문 확인 정보가 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.' };
      }
    }
    
    // 사용자 이름 매핑
    let nickname = '게스트';
    if (isGuest) {
      nickname = (options.body?.guestName || '게스트') + ' (비회원)';
    } else {
      const users = MOCK_DATA.getUsers.users;
      const user = users.find(u => u.userId === userId) || { nickname: "알수없음" };
      nickname = user.nickname;
    }
    
    // 간식 이름 매핑
    const snacks = MOCK_DATA.getSnacks.snacks;
    
    const timestampStr = new Date().toISOString();
    const todayStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const allMockOrders = [...localOrders, ...MOCK_DATA.getOrdersToday.orders];
    const todayMockOrders = allMockOrders.filter(o => {
      if (!o.timestamp) return false;
      const oDateStr = o.timestamp.slice(2, 10).replace(/-/g, '');
      return oDateStr === todayStr;
    });
    let maxSeq = 0;
    todayMockOrders.forEach(o => {
      const orderNoStr = String(o.orderNo || '');
      const parts = orderNoStr.split('-');
      if (parts.length >= 3) {
        const num = Number(parts[2]);
        if (!isNaN(num) && num > maxSeq) {
          maxSeq = num;
        }
      }
    });
    const seq = maxSeq + 1;
    const generatedOrderNo = `ORD-${todayStr}-${String(seq).padStart(3, '0')}`;
    const orderToken = createMockOrderToken();

    const deliveryType = options.body?.deliveryType || 'pickup';
    const deliveryPlace = (deliveryType === 'delivery') ? String(options.body?.deliveryPlace || '').trim() : '';
    // 게스트 배달비는 서버 설정값 기준으로 재계산
    let deliveryFee = 0;
    let gSettings = null;
    if (isGuest && deliveryType === 'delivery') {
      gSettings = getMockGuestSettings();
      deliveryFee = gSettings.guestDeliveryFee;
    } else {
      deliveryFee = Number(options.body?.deliveryFee || 0);
    }

    const snackTotalCost = normalizedItems.reduce((sum, item) => {
      const snack = snacks.find(s => s.snackId === item.snackId) || { point: 1 };
      return sum + (Number(snack.point || 0) * Number(item.quantity || 0));
    }, 0);
    const totalCost = snackTotalCost + deliveryFee;
    let guestCreditUpdate = null;
    if (isGuest) {
      const authProvider = options.body?.authProvider === 'kakao' ? 'kakao' : '';
      guestCreditUpdate = resolveMockGuestCreditWallet({
        guestDeviceId: options.body?.guestDeviceId || '',
        authProvider,
        guestKey: authProvider === 'kakao' ? options.body?.guestKey || '' : ''
      }, {
        settings: gSettings || getMockGuestSettings(),
        spendCredit: totalCost,
        create: true
      });
      if (!guestCreditUpdate.success) {
        return guestCreditUpdate;
      }
    } else {
      const storedUser = MOCK_DATA.getUsers.users.find(user => String(user.userId) === String(userId));
      const orderLimit = Number(storedUser?.credit || 0);
      if (orderLimit < totalCost) {
        return {
          success: false,
          message: '1회 주문 한도를 넘었습니다.',
          currentCredit: orderLimit,
          totalPoint: totalCost,
        };
      }
    }

    const newOrders = normalizedItems.map(item => {
      const snack = snacks.find(s => s.snackId === item.snackId) || { name: `간식 ${item.snackId}`, point: 1 };
      return {
        timestamp: timestampStr,
        orderNo: generatedOrderNo,
        orderToken: orderToken,
        userId: userId,
        nickname: nickname,
        snackId: item.snackId,
        snackName: snack.name,
        quantity: item.quantity,
        point: snack.point * item.quantity,
        servedYn: 'N',
        deliveryType: deliveryType,
        deliveryFee: deliveryFee,
        totalCredit: totalCost,
        deliveryPlace: deliveryPlace,
        guestDeviceId: isGuest ? String(options.body?.guestDeviceId || '') : '',
        authProvider: isGuest && options.body?.authProvider === 'kakao' ? 'kakao' : '',
        guestKey: isGuest && options.body?.guestKey ? String(options.body.guestKey) : '',
        idempotencyKey: idempotencyKey,
        reviewed: false
      };
    });

    localStorage.setItem('mockOrders', JSON.stringify([...newOrders, ...localOrders]));
    const shouldRememberGuestProfile = options.body?.rememberGuestProfile === true || String(options.body?.rememberGuestProfile || '').trim().toUpperCase() === 'Y';
    if (isGuest && options.body?.authProvider === 'kakao' && options.body?.guestKey && shouldRememberGuestProfile) {
      const guestKey = String(options.body.guestKey);
      const profiles = JSON.parse(localStorage.getItem('mockGuestProfiles') || '{}');
      const currentProfile = profiles[guestKey] || {};
      profiles[guestKey] = {
        displayName: String(options.body?.guestName || currentProfile.displayName || '').trim(),
        deliveryPlace: deliveryPlace || currentProfile.deliveryPlace || '',
        updatedAt: new Date().toISOString()
      };
      localStorage.setItem('mockGuestProfiles', JSON.stringify(profiles));
    }

    // 배달왔삼 온기만 영구 차감한다. 일반 키오스크 값은 1회 주문 한도다.
    const selectedUser = JSON.parse(localStorage.getItem('selectedUser'));
    if (selectedUser && isGuest && guestCreditUpdate) {
      selectedUser.credit = guestCreditUpdate.remainingCredit;
      localStorage.setItem('selectedUser', JSON.stringify(selectedUser));
    }

    res = JSON.parse(JSON.stringify(MOCK_DATA.placeOrder));
    res.orderNo = generatedOrderNo;
    res.orderToken = orderToken;
    res.totalPoint = totalCost;
    res.idempotencyKey = idempotencyKey;
    if (guestCreditUpdate) {
      res.beforeCredit = guestCreditUpdate.remainingCredit + totalCost;
      res.afterCredit = guestCreditUpdate.remainingCredit;
      res.bonusCredit = guestCreditUpdate.bonusCredit || 0;
    } else {
      const storedUser = MOCK_DATA.getUsers.users.find(user => String(user.userId) === String(userId));
      const orderLimit = Number(storedUser?.credit || 0);
      res.beforeCredit = orderLimit;
      res.afterCredit = Math.max(0, orderLimit - totalCost);
    }
  } else if (action === 'updateOrderServed') {
    const orderId = String(options.body?.orderId || '').trim();
    const servedYn = String(options.body?.servedYn || 'N').trim().toUpperCase();
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    const matched = [...localOrders, ...MOCK_DATA.getOrdersToday.orders]
      .filter(order => String(order.orderNo || '') === orderId);
    if (!orderId || !['N', 'P', 'R', 'Y'].includes(servedYn)) {
      res = { success: false, verified: false, message: '주문번호 또는 제공 상태 값이 올바르지 않습니다.' };
    } else if (matched.length === 0) {
      res = { success: false, verified: false, message: '해당 주문 기록을 찾을 수 없습니다.' };
    } else if (matched.some(order => String(order.servedYn || 'N').toUpperCase() === 'C')) {
      res = { success: false, verified: false, message: '취소된 품목이 포함된 주문은 제공 상태를 변경할 수 없습니다.' };
    } else {
      const beforeStatuses = matched.map(order => order.servedYn || 'N');
      matched.forEach(order => { order.servedYn = servedYn; });
      localStorage.setItem('mockOrders', JSON.stringify(localOrders));
      appendMockAdminLog('updateOrderServed', 'order', orderId, matched[0].nickname, beforeStatuses.join(','), servedYn, options.body?.adminMemo);
      res = {
        success: true,
        verified: true,
        rolledBack: false,
        recoveryRequired: false,
        cleanupRequired: false,
        backupSheetNames: [],
        message: `주문번호 ${orderId}의 모든 품목을 '${servedYn}' 상태로 업데이트했습니다. (총 ${matched.length}건)`
      };
    }
  } else if (action === 'updateUserCredit') {
    const userId = options.body?.userId;
    const credit = Number(options.body?.credit || 0);
    if (!Number.isInteger(credit) || credit < ADMIN_MIN_USER_ORDER_LIMIT || credit > ADMIN_MAX_USER_CREDIT) {
      res = { success: false, message: `1회 주문 한도는 ${ADMIN_MIN_USER_ORDER_LIMIT}~${ADMIN_MAX_USER_CREDIT} 범위로 입력해 주세요.` };
    } else {
    const users = MOCK_DATA.getUsers.users;
    const user = users.find(u => String(u.userId) === String(userId));
    if (user) {
      appendMockAdminLog('updateUserCredit', 'user', userId, user.nickname, user.credit, credit, options.body?.adminMemo);
      user.credit = credit;
    }
    const selectedUser = JSON.parse(localStorage.getItem('selectedUser'));
    if (selectedUser && String(selectedUser.userId) === String(userId)) {
      selectedUser.credit = credit;
      localStorage.setItem('selectedUser', JSON.stringify(selectedUser));
    }
    res = {
      success: true,
      message: "1회 주문 한도를 업데이트했습니다."
    };
    }
  } else if (action === 'addUser') {
    const nickname = options.body?.nickname || "새 이용자";
    const rawCredit = options.body?.credit;
    const credit = rawCredit === undefined || rawCredit === null || String(rawCredit).trim() === ''
      ? DEFAULT_USER_ORDER_LIMIT
      : Number(rawCredit);
    const imageUrl = options.body?.imageUrl || "";
    const useYn = options.body?.useYn || "Y";
    if (!Number.isInteger(credit) || credit < ADMIN_MIN_USER_ORDER_LIMIT || credit > ADMIN_MAX_USER_CREDIT) {
      res = { success: false, message: `1회 주문 한도는 ${ADMIN_MIN_USER_ORDER_LIMIT}~${ADMIN_MAX_USER_CREDIT} 범위로 입력해 주세요.` };
    } else {
    const users = MOCK_DATA.getUsers.users;
    const maxId = users.reduce((max, u) => {
      const match = String(u.userId || '').match(/(\d+)$/);
      const idNumber = match ? Number(match[1]) : 0;
      return idNumber > max ? idNumber : max;
    }, 0);
    const newUserId = `user${String(maxId + 1).padStart(3, '0')}`;
    users.push({
      userId: newUserId,
      nickname,
      credit,
      useYn,
      imageUrl
    });
    appendMockAdminLog('addUser', 'user', newUserId, nickname, '', JSON.stringify({ credit, useYn }), options.body?.adminMemo);
    res = {
      success: true,
      message: "신규 이용자를 등록했습니다.",
      userId: newUserId
    };
    }
  } else if (action === 'updateUserActive') {
    const userId = options.body?.userId;
    const useYn = String(options.body?.useYn || 'N').toUpperCase() === 'Y' ? 'Y' : 'N';
    const users = MOCK_DATA.getUsers.users;
    const user = users.find(u => String(u.userId) === String(userId));
    if (user) {
      appendMockAdminLog('updateUserActive', 'user', userId, user.nickname, user.useYn ?? user.active ?? 'Y', useYn, options.body?.adminMemo);
      user.useYn = useYn;
      user.active = useYn;
    }
    res = {
      success: true,
      message: "이용자 상태를 업데이트했습니다.",
      useYn
    };
  } else if (action === 'updateSnackStock') {
    const snackId = Number(options.body?.snackId);
    const stock = Number(options.body?.stock || 0);
    if (!Number.isFinite(stock) || stock < 0 || stock > ADMIN_MAX_SNACK_STOCK) {
      res = { success: false, message: `간식 재고는 0~${ADMIN_MAX_SNACK_STOCK} 범위로 입력해 주세요.` };
    } else {
    const snacks = getMockSnacks();
    const snack = snacks.find(s => s.snackId === snackId);
    if (snack) {
      appendMockAdminLog('updateSnackStock', 'snack', snackId, snack.name, snack.stock, stock, options.body?.adminMemo);
      snack.stock = stock;
      saveMockSnacks(snacks);
    }
    res = {
      success: true,
      message: "재고를 업데이트했습니다."
    };
    }
  } else if (action === 'updateSnackSale') {
    const snackId = Number(options.body?.snackId);
    const saleYn = String(options.body?.saleYn || 'N').toUpperCase() === 'Y' ? 'Y' : 'N';
    const snacks = getMockSnacks();
    const snack = snacks.find(s => Number(s.snackId) === snackId);
    if (snack) {
      appendMockAdminLog('updateSnackSale', 'snack', snackId, snack.name, snack.saleYn ?? snack.active ?? 'Y', saleYn, options.body?.adminMemo);
      snack.saleYn = saleYn;
      snack.active = saleYn;
      saveMockSnacks(snacks);
    }
    res = {
      success: true,
      message: "간식 판매 상태를 업데이트했습니다.",
      saleYn
    };
  } else if (action === 'addSnack') {
    const name = options.body?.name || "새로운 간식";
    const point = Number(options.body?.point || 1);
    const imageUrl = options.body?.imageUrl || "";
    const stock = Number(options.body?.stock || 0);
    const saleYn = options.body?.saleYn || "Y";
    const target = options.body?.target || "user";
    const maxPerPerson = parseMockMaxPerPerson(options.body?.maxPerPerson);
    const snacks = getMockSnacks();
    if (!Number.isFinite(stock) || stock < 0 || stock > ADMIN_MAX_SNACK_STOCK) {
      res = { success: false, message: `간식 재고는 0~${ADMIN_MAX_SNACK_STOCK} 범위로 입력해 주세요.` };
    } else if (maxPerPerson === null) {
      res = { success: false, message: "1인당 제한 수량은 0 또는 양의 정수로 입력해 주세요." };
    } else {
    const maxId = snacks.reduce((max, s) => s.snackId > max ? s.snackId : max, 0);
    const newSnackId = maxId + 1;
    const newSnack = {
      snackId: newSnackId,
      name: name,
      point: point,
      imageUrl: imageUrl,
      saleYn: saleYn,
      stock: stock,
      target: target,
      maxPerPerson: maxPerPerson
    };
    snacks.push(newSnack);
    saveMockSnacks(snacks);
    appendMockAdminLog('addSnack', 'snack', newSnackId, name, '', JSON.stringify({ point, saleYn, stock, target, maxPerPerson }), options.body?.adminMemo);
    res = {
      success: true,
      message: "신규 간식을 등록했습니다.",
      snackId: newSnackId
    };
    }
  } else if (action === 'updateSnack') {
    const snackId = Number(options.body?.snackId);
    const name = options.body?.name;
    const point = Number(options.body?.point);
    const imageUrl = options.body?.imageUrl;
    const stock = Number(options.body?.stock);
    const saleYn = options.body?.saleYn;
    const target = options.body?.target || 'user';
    const maxPerPerson = parseMockMaxPerPerson(options.body?.maxPerPerson);
    const snacks = getMockSnacks();
    const snack = snacks.find(s => s.snackId === snackId);
    if (!Number.isFinite(stock) || stock < 0 || stock > ADMIN_MAX_SNACK_STOCK) {
      res = { success: false, message: `간식 재고는 0~${ADMIN_MAX_SNACK_STOCK} 범위로 입력해 주세요.` };
    } else if (maxPerPerson === null) {
      res = { success: false, message: "1인당 제한 수량은 0 또는 양의 정수로 입력해 주세요." };
    } else if (snack) {
      appendMockAdminLog('updateSnack', 'snack', snackId, name, 
        JSON.stringify({ name: snack.name, point: snack.point, imageUrl: snack.imageUrl, saleYn: snack.saleYn, stock: snack.stock, target: snack.target, maxPerPerson: snack.maxPerPerson || 0 }),
        JSON.stringify({ name, point, imageUrl, saleYn, stock, target, maxPerPerson }),
        options.body?.adminMemo
      );
      snack.name = name;
      snack.point = point;
      snack.imageUrl = imageUrl;
      snack.stock = stock;
      snack.saleYn = saleYn;
      snack.active = saleYn;
      snack.target = target;
      snack.maxPerPerson = maxPerPerson;
      saveMockSnacks(snacks);
    }
    res = {
      success: true,
      message: "간식 정보를 수정했습니다."
    };
  } else if (action === 'updateUser') {
    const userId = options.body?.userId;
    const nickname = options.body?.nickname;
    const credit = Number(options.body?.credit || 0);
    const imageUrl = options.body?.imageUrl || '';
    const useYn = options.body?.useYn || 'Y';
    const users = MOCK_DATA.getUsers.users;
    const user = users.find(u => String(u.userId) === String(userId));
    if (!Number.isInteger(credit) || credit < ADMIN_MIN_USER_ORDER_LIMIT || credit > ADMIN_MAX_USER_CREDIT) {
      res = { success: false, message: `1회 주문 한도는 ${ADMIN_MIN_USER_ORDER_LIMIT}~${ADMIN_MAX_USER_CREDIT} 범위로 입력해 주세요.` };
    } else if (user) {
      appendMockAdminLog('updateUser', 'user', userId, nickname,
        JSON.stringify({ nickname: user.nickname, credit: user.credit, imageUrl: user.imageUrl, useYn: user.useYn }),
        JSON.stringify({ nickname, credit, imageUrl, useYn }),
        options.body?.adminMemo
      );
      user.nickname = nickname;
      user.credit = credit;
      user.imageUrl = imageUrl;
      user.useYn = useYn;
      user.active = useYn;
    }
    res = {
      success: true,
      message: "이용자 정보를 수정했습니다."
    };
  } else if (action === 'cancelOrder' || action === 'userCancelOrder') {
    const baseResult = {
      success: false,
      verified: false,
      alreadyCancelled: false,
      refundApplied: false,
      restoredItemCount: 0,
      rolledBack: false,
      recoveryRequired: false,
      cleanupRequired: false,
      backupSheetNames: []
    };
    const orderId = String(options.body?.orderId || '').trim();
    const requestToken = String(options.body?.orderToken || '').trim();
    const isUserCancellation = action === 'userCancelOrder';
    const localOrdersBeforeRaw = localStorage.getItem('mockOrders');
    const walletBeforeRaw = localStorage.getItem('mockGuestCreditWallets');
    const localOrders = JSON.parse(localOrdersBeforeRaw || '[]');
    const fixedOrders = MOCK_DATA.getOrdersToday.orders;
    const allOrders = [...localOrders, ...fixedOrders];
    const seed = isUserCancellation
      ? allOrders.filter(o => String(o.orderNo || '') === orderId || String(o.orderToken || '') === orderId)
      : allOrders.filter(o => String(o.orderNo || '') === orderId);

    if (!orderId || seed.length === 0) {
      res = { ...baseResult, message: '해당 주문 기록을 찾을 수 없습니다.' };
    } else {
      const canonicalOrderNo = String(seed[0].orderNo || '');
      const matched = allOrders.filter(o => String(o.orderNo || '') === canonicalOrderNo);
      const sameValue = (field, normalizer = value => String(value ?? '').trim()) => {
        const first = normalizer(matched[0]?.[field]);
        return matched.every(item => normalizer(item[field]) === first) ? first : null;
      };
      const userId = sameValue('userId');
      const storedToken = sameValue('orderToken');
      const totalCredit = sameValue('totalCredit', value => {
        if (value === '' || value == null) return NaN;
        return Number(value);
      });
      const statuses = matched.map(o => String(o.servedYn || 'N').trim().toUpperCase());
      const cancelledCount = statuses.filter(status => status === 'C').length;

      if (!canonicalOrderNo || userId === null || storedToken === null || totalCredit === null || !Number.isFinite(totalCredit) || totalCredit < 0) {
        res = { ...baseResult, message: '동일 주문의 이용자·토큰·총 온기 구조가 올바르지 않습니다.' };
      } else if (isUserCancellation && (!storedToken || !requestToken || storedToken !== requestToken)) {
        res = {
          ...baseResult,
          message: storedToken
            ? '주문 확인 정보(토큰)가 일치하지 않거나 누락되었습니다.'
            : '이 주문은 이용자 취소용 토큰이 없어 관리자만 취소할 수 있습니다.'
        };
      } else if (cancelledCount === matched.length) {
        res = {
          ...baseResult,
          success: true,
          verified: true,
          alreadyCancelled: true,
          message: '이미 취소된 주문입니다. 재고와 온기는 다시 변경하지 않았습니다.'
        };
      } else if (cancelledCount > 0) {
        res = { ...baseResult, message: '동일 주문 안에 취소 상태가 섞여 있어 작업을 중단했습니다.' };
      } else if (isUserCancellation && statuses.some(status => status !== 'N')) {
        res = { ...baseResult, message: '일부 품목의 준비가 이미 시작되어 주문 전체를 취소할 수 없습니다. 관리자에게 문의해주세요.' };
      } else {
        const snacksSnapshot = JSON.parse(JSON.stringify(MOCK_DATA.getSnacks.snacks));
        const fixedOrdersSnapshot = JSON.parse(JSON.stringify(fixedOrders));
        const snackRestores = new Map();
        let restoredItemCount = 0;
        let validationError = '';
        matched.forEach(item => {
          const quantity = Number(item.quantity);
          const snack = MOCK_DATA.getSnacks.snacks.find(candidate =>
            (item.snackId != null && String(candidate.snackId) === String(item.snackId))
              || (!item.snackId && candidate.name === item.snackName)
          );
          if (!Number.isInteger(quantity) || quantity <= 0 || !snack || !Number.isFinite(Number(snack.stock)) || Number(snack.stock) < 0) {
            validationError = '주문 간식·수량·재고 구조가 올바르지 않습니다.';
            return;
          }
          snackRestores.set(snack, (snackRestores.get(snack) || 0) + quantity);
          restoredItemCount += quantity;
        });

        if (validationError) {
          res = { ...baseResult, message: validationError };
        } else {
          try {
            snackRestores.forEach((quantity, snack) => { snack.stock = Number(snack.stock) + quantity; });
            saveMockSnacks(MOCK_DATA.getSnacks.snacks);
            let refundApplied = false;
            if (userId === 'guest' && totalCredit > 0) {
              const first = matched[0];
              const refund = resolveMockGuestCreditWallet({
                orderTime: first.timestamp,
                guestDeviceId: first.guestDeviceId || '',
                authProvider: first.authProvider || '',
                guestKey: first.guestKey || ''
              }, {
                periodKey: getMockGuestCreditPeriodKey(first.timestamp || new Date()),
                refundCredit: totalCredit,
                create: true
              });
              if (!refund?.success) throw new Error(refund?.message || '게스트 온기 환불에 실패했습니다.');
              refundApplied = true;
            }
            const cancelTimestamp = new Date().toISOString();
            matched.forEach(item => {
              item.servedYn = 'C';
              item.cancelTimestamp = cancelTimestamp;
              item.cancelReason = isUserCancellation ? '이용자 직접 취소' : String(options.body?.cancelReason || '관리자 취소');
              item.cancelReasonDetail = isUserCancellation ? '' : String(options.body?.cancelReasonDetail || '');
            });
            localStorage.setItem('mockOrders', JSON.stringify(localOrders));
            appendMockAdminLog(action, 'order', canonicalOrderNo, matched[0].nickname, statuses.join(','), 'C', options.body?.adminMemo);
            res = {
              ...baseResult,
              success: true,
              verified: true,
              refundApplied,
              restoredItemCount,
              message: refundApplied
                ? `주문이 취소되었습니다. 온기 ${totalCredit}개 환불과 재고 ${restoredItemCount}개 복구를 확인했습니다.`
                : `주문이 취소되었습니다. 재고 ${restoredItemCount}개 복구를 확인했습니다.`
            };
          } catch (error) {
            MOCK_DATA.getSnacks.snacks = snacksSnapshot;
            MOCK_DATA.getOrdersToday.orders = fixedOrdersSnapshot;
            saveMockSnacks(snacksSnapshot);
            if (localOrdersBeforeRaw == null) localStorage.removeItem('mockOrders');
            else localStorage.setItem('mockOrders', localOrdersBeforeRaw);
            if (walletBeforeRaw == null) localStorage.removeItem('mockGuestCreditWallets');
            else localStorage.setItem('mockGuestCreditWallets', walletBeforeRaw);
            res = {
              ...baseResult,
              rolledBack: true,
              message: '주문 취소 처리에 실패해 주문·재고·온기를 모두 원래 상태로 복구했습니다.'
            };
          }
        }
      }
    }
  } else if (action === 'uploadImage') {
    const type = options.body?.type || 'unknown';
    const fileName = options.body?.fileName;
    const base64Data = options.body?.base64Data || '';

    if (!base64Data || !fileName || !type) {
      res = { success: false, message: '필수 매개변수(base64Data, fileName, type)가 누락되었습니다.' };
    } else if (base64Data.length > 4700000) {
      res = { success: false, message: '이미지 파일 크기가 너무 큽니다. 3.5MB 이하의 파일만 업로드 가능합니다.' };
    } else if (!/^data:(image\/(jpeg|png|webp|gif|jpg));base64,/i.test(base64Data)) {
      res = { success: false, message: '허용되지 않는 파일 형식입니다. 이미지 파일(jpg, jpeg, png, webp, gif)만 업로드할 수 있습니다.' };
    } else if (type === 'review') {
      const orderToken = String(options.body?.orderToken || '').trim();
      const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
      const allMockOrders = [...localOrders, ...MOCK_DATA.getOrdersToday.orders];
      const matchedOrders = allMockOrders.filter(o =>
        String(o.orderToken || '').trim() === orderToken && String(o.userId || '') === 'guest'
      );

      if (!orderToken) {
        res = { success: false, message: '주문 확인 정보(토큰)가 없어 이미지를 업로드할 수 없습니다.' };
      } else if (matchedOrders.length === 0) {
        res = { success: false, message: '유효하지 않은 주문 정보입니다.' };
      } else if (!matchedOrders.some(o => o.servedYn === 'Y' || o.status === '수령완료')) {
        res = { success: false, message: '수령완료된 주문만 후기 사진을 업로드할 수 있습니다.' };
      } else if (!options.body?.reviewEdit && matchedOrders.some(o => o.reviewed === true || String(o.reviewed).toUpperCase() === 'TRUE' || String(o.reviewed).toUpperCase() === 'Y')) {
        res = { success: false, message: '이미 응원 메시지를 남긴 주문입니다.' };
      } else {
        res = {
          success: true,
          imageUrl: `https://drive.google.com/uc?export=view&id=mock_file_id_${type}_${Date.now()}`
        };
      }
    } else if (type === 'user' || type === 'snack') {
      res = {
        success: true,
        imageUrl: `https://drive.google.com/uc?export=view&id=mock_file_id_${type}_${Date.now()}`
      };
    } else {
      res = { success: false, message: '올바르지 않은 이미지 타입입니다.' };
    }
  } else if (action === 'submitReview') {
    const orderId = options.body?.orderId;
    const guestName = options.body?.guestName;
    const stamp = options.body?.stamp || '';
    const tags = options.body?.tags || '';
    const comment = options.body?.comment || '';
    const isPublic = options.body?.isPublic !== false && options.body?.isPublic !== 'false';
    const imageUrl = options.body?.imageUrl || '';

    if (!orderId || !guestName) {
      res = { success: false, message: '필수 매개변수가 누락되었습니다.' };
    } else {
      const mockReviews = JSON.parse(localStorage.getItem('mockReviews') || '[]');
      const alreadyExists = mockReviews.some(r => r.orderId === orderId);
      if (alreadyExists) {
        res = { success: false, message: '이미 후기가 작성된 주문번호입니다.' };
      } else {
        mockReviews.push({
          createdAt: new Date().toISOString(),
          orderId,
          guestName,
          stamp,
          tags,
          comment,
          isPublic,
          imageUrl,
          updatedAt: '',
          editCount: 0
        });
        localStorage.setItem('mockReviews', JSON.stringify(mockReviews));

        // local orders reviewed 상태 업데이트
        const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
        const updatedLocalOrders = localOrders.map(o => {
          if (o.orderNo === orderId) {
            return { ...o, reviewed: true };
          }
          return o;
        });
        localStorage.setItem('mockOrders', JSON.stringify(updatedLocalOrders));

        // memory orders reviewed 상태 업데이트
        MOCK_DATA.getOrdersToday.orders.forEach(o => {
          if (o.orderNo === orderId) {
            o.reviewed = true;
          }
        });

        res = { success: true, message: '후기가 등록되었습니다.' };
      }
    }
  } else if (action === 'getGuestReview') {
    const orderId = String(options.body?.orderId || '');
    const orderToken = String(options.body?.orderToken || '');
    const mockReviews = JSON.parse(localStorage.getItem('mockReviews') || '[]');
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    const mockArchived = JSON.parse(localStorage.getItem('mockArchivedOrders') || '[]');
    const allOrders = [...localOrders, ...mockArchived, ...MOCK_DATA.getOrdersToday.orders];
    const ownsOrder = allOrders.some(o => String(o.orderNo || '') === orderId && String(o.orderToken || '') === orderToken);
    const matches = mockReviews.filter(r => String(r.orderId || '') === orderId);
    if (!ownsOrder) {
      res = { success: false, message: '주문 확인 정보(토큰)가 일치하지 않습니다.' };
    } else if (matches.length !== 1) {
      res = { success: false, message: matches.length ? '중복 후기 데이터가 있습니다.' : '작성된 후기를 찾을 수 없습니다.' };
    } else {
      const review = { ...matches[0] };
      const expiresAt = new Date(new Date(review.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000);
      review.editable = Date.now() <= expiresAt.getTime();
      review.editExpiresAt = expiresAt.toISOString();
      res = { success: true, review };
    }
  } else if (action === 'updateGuestReview') {
    const orderId = String(options.body?.orderId || '');
    const orderToken = String(options.body?.orderToken || '');
    const mockReviews = JSON.parse(localStorage.getItem('mockReviews') || '[]');
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    const mockArchived = JSON.parse(localStorage.getItem('mockArchivedOrders') || '[]');
    const allOrders = [...localOrders, ...mockArchived, ...MOCK_DATA.getOrdersToday.orders];
    const ownsOrder = allOrders.some(o => String(o.orderNo || '') === orderId && String(o.orderToken || '') === orderToken);
    const matches = mockReviews.filter(r => String(r.orderId || '') === orderId);
    if (!ownsOrder || matches.length !== 1) {
      res = { success: false, message: !ownsOrder ? '주문 확인 정보(토큰)가 일치하지 않습니다.' : '수정할 후기를 찾을 수 없습니다.' };
    } else {
      const review = matches[0];
      const expiresAt = new Date(new Date(review.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000);
      if (Date.now() > expiresAt.getTime()) {
        res = { success: false, message: '후기 작성 후 7일이 지나 수정할 수 없습니다.' };
      } else {
        review.stamp = options.body?.stamp || '';
        review.tags = options.body?.tags || '';
        review.comment = options.body?.comment || '';
        review.isPublic = options.body?.isPublic !== false && options.body?.isPublic !== 'false';
        if (options.body?.imageAction === 'replace') review.imageUrl = options.body?.imageUrl || '';
        if (options.body?.imageAction === 'remove') review.imageUrl = '';
        review.updatedAt = new Date().toISOString();
        review.editCount = Number(review.editCount || 0) + 1;
        localStorage.setItem('mockReviews', JSON.stringify(mockReviews));
        res = { success: true, message: '후기가 수정되었습니다.', review: { ...review, editable: true, editExpiresAt: expiresAt.toISOString() } };
      }
    }
  } else if (action === 'getRecentReviews') {
    const mockReviews = JSON.parse(localStorage.getItem('mockReviews') || '[]');
    const publicReviews = mockReviews
      .filter(r => r.isPublic === true || String(r.isPublic).toUpperCase() === 'TRUE' || r.isPublic === 'Y')
      .map(r => ({
        createdAt: r.createdAt,
        orderId: r.orderId,
        guestName: r.guestName,
        stamp: r.stamp,
        tags: r.tags,
        comment: r.comment,
        imageUrl: r.imageUrl || '',
        replyText: r.replyText || '',
        replyCreatedAt: r.replyCreatedAt || '',
        updatedAt: r.updatedAt || '',
        editCount: Number(r.editCount || 0)
      }))
      .reverse()
      .slice(0, 10);

    res = { success: true, reviews: publicReviews };
  } else if (action === 'getReviewsForAdmin') {
    const mockReviews = JSON.parse(localStorage.getItem('mockReviews') || '[]');
    const sortedReviews = [...mockReviews].reverse();
    res = { success: true, reviews: sortedReviews };
  } else if (action === 'toggleReviewVisibility') {
    const createdAt = options.body?.createdAt;
    const isPublic = options.body?.isPublic;
    const mockReviews = JSON.parse(localStorage.getItem('mockReviews') || '[]');
    const matched = mockReviews.find(r => String(r.createdAt) === String(createdAt));
    if (matched) {
            matched.isPublic = isPublic;
      localStorage.setItem('mockReviews', JSON.stringify(mockReviews));
      res = { success: true, message: '후기 공개 상태가 변경되었습니다.' };
    } else {
      res = { success: false, message: '해당 후기를 찾을 수 없습니다.' };
    }
  } else if (action === 'submitReviewReply') {
    const orderId = options.body?.orderId;
    const replyText = options.body?.replyText || '';
    const mockReviews = JSON.parse(localStorage.getItem('mockReviews') || '[]');
    const matched = mockReviews.find(r => String(r.orderId) === String(orderId));
    if (matched) {
      matched.replyText = replyText;
      matched.replyCreatedAt = new Date().toISOString();
      localStorage.setItem('mockReviews', JSON.stringify(mockReviews));
      res = { success: true, message: '후기 답글이 성공적으로 등록되었습니다.' };
    } else {
      res = { success: false, message: '해당 주문의 후기를 찾을 수 없습니다.' };
    }
  } else if (action === 'getGuestOrderByToken') {
    const tokens = options.body?.tokens || [];
    const includeArchived = options.body?.includeArchived === true;
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    const mockArchived = includeArchived ? JSON.parse(localStorage.getItem('mockArchivedOrders') || '[]') : [];
    const allMockOrders = [...localOrders, ...mockArchived, ...MOCK_DATA.getOrdersToday.orders];
    const matchedOrders = allMockOrders.filter(o =>
      String(o.userId || '') === 'guest' && o.orderToken && tokens.includes(o.orderToken)
    );
    res = {
      success: true,
      orders: matchedOrders.map(o => ({
        timestamp: o.timestamp,
        orderNo: o.orderNo,
        userId: 'guest',
        nickname: o.nickname,
        snackId: o.snackId || 1,
        snackName: o.snackName,
        quantity: o.quantity,
        point: o.point,
        servedYn: o.servedYn || 'N',
        cancelTimestamp: o.cancelTimestamp || '',
        orderToken: o.orderToken || '',
        deliveryType: o.deliveryType || 'pickup',
        deliveryFee: o.deliveryFee || 0,
        totalCredit: o.totalCredit || 0,
        reviewed: o.reviewed || false,
        deliveryPlace: o.deliveryPlace || '',
        authProvider: o.authProvider || '',
        guestKey: o.guestKey || '',
        cancelReason: o.cancelReason || '',
        cancelReasonDetail: o.cancelReasonDetail || ''
      }))
    };
  } else if (action === 'updateSnacksOrder') {
    const items = options.body?.items || [];
    const snacks = getMockSnacks();
    items.forEach(item => {
      const snack = snacks.find(s => String(s.snackId) === String(item.snackId));
      if (snack) {
        snack.displayOrder = Number(item.displayOrder);
      }
    });
    snacks.sort((a, b) => {
      const oA = typeof a.displayOrder !== 'undefined' ? a.displayOrder : 9999;
      const oB = typeof b.displayOrder !== 'undefined' ? b.displayOrder : 9999;
      return oA - oB;
    });
    saveMockSnacks(snacks);
    res = { success: true, message: '표시 순서를 저장했습니다.' };
  } else if (action === 'auditArchiveOldOrders') {
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    const archivedOrders = JSON.parse(localStorage.getItem('mockArchivedOrders') || '[]');
    const orderKeys = localOrders.map(order => `${order.orderNo || ''}|${order.snackId || ''}`);
    const archiveKeys = archivedOrders.map(order => `${order.orderNo || ''}|${order.snackId || ''}`);
    const duplicateKeys = keys => [...new Set(keys.filter(key => key !== '|'))]
      .filter(key => keys.filter(candidate => candidate === key).length > 1);
    const orderRowsWithoutKey = orderKeys.filter(key => key.startsWith('|') || key.endsWith('|')).length;
    const archiveRowsWithoutKey = archiveKeys.filter(key => key.startsWith('|') || key.endsWith('|')).length;
    const duplicateOrderKeyValues = duplicateKeys(orderKeys);
    const duplicateArchiveKeyValues = duplicateKeys(archiveKeys);
    const duplicateOrderKeys = duplicateOrderKeyValues.length;
    const duplicateArchiveKeys = duplicateArchiveKeyValues.length;
    const safeToRun = orderRowsWithoutKey === 0 && archiveRowsWithoutKey === 0
      && duplicateOrderKeys === 0 && duplicateArchiveKeys === 0;
    res = {
      success: true,
      dryRun: true,
      message: safeToRun ? '보관 전 점검이 완료되었습니다.' : '보관 전 점검에서 안전 문제를 발견했습니다.',
      summary: {
        safeToRun,
        requiredHeadersPresent: true,
        missingRequiredHeaders: [],
        orderRows: localOrders.length,
        archiveRows: archivedOrders.length,
        orderColumns: 24,
        archiveColumns: 23,
        headersEqual: false,
        headersCompatible: true,
        missingInArchive: ['commitStatus'],
        extraInArchive: [],
        overlapKeys: [...new Set(orderKeys.filter(key => key !== '|' && archiveKeys.includes(key)))].length,
        duplicateOrderKeys,
        duplicateArchiveKeys,
        archiveOnlyKeys: [...new Set(archiveKeys.filter(key => key !== '|' && !orderKeys.includes(key)))].length,
        orderOnlyKeys: [...new Set(orderKeys.filter(key => key !== '|' && !archiveKeys.includes(key)))].length,
        orderRowsWithoutKey,
        archiveRowsWithoutKey,
        sampleDuplicateOrderKeys: duplicateOrderKeyValues.slice(0, 10),
        sampleDuplicateKeys: duplicateArchiveKeyValues.slice(0, 10)
      }
    };
  } else if (action === 'archiveOldOrders') {
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    const todayStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');

    const currentOrders = [];
    const archivedOrders = [];

    localOrders.forEach(o => {
      if (o.timestamp) {
        const orderDateStr = o.timestamp.slice(2, 10).replace(/-/g, '');
        if (orderDateStr === todayStr) {
          currentOrders.push(o);
        } else {
          archivedOrders.push(o);
        }
      } else {
        currentOrders.push(o);
      }
    });

    if (archivedOrders.length > 0) {
      const allArchived = JSON.parse(localStorage.getItem('mockArchivedOrders') || '[]');
      localStorage.setItem('mockArchivedOrders', JSON.stringify([...allArchived, ...archivedOrders]));
      localStorage.setItem('mockOrders', JSON.stringify(currentOrders));
    }

    res = {
      success: true,
      movedCount: archivedOrders.length,
      archiveCount: JSON.parse(localStorage.getItem('mockArchivedOrders') || '[]').length,
      verified: true,
      rolledBack: false,
      recoveryRequired: false,
      cleanupRequired: false,
      orderBackupSheetName: archivedOrders.length ? '주문내역_자동백업_목업' : '',
      archiveBackupSheetName: archivedOrders.length ? '주문보관_자동백업_목업' : '',
      archiveCreated: false,
      message: archivedOrders.length
        ? `${archivedOrders.length}건의 지난 주문을 보관하고 검증했습니다.`
        : '보관할 지난 주문이 없습니다.'
    };
  } else if (action === 'autoFillEmptySnackIds') {
    const snacks = getMockSnacks();
    let hasInvalid = false;
    let hasDuplicate = false;
    const existingIds = [];
    const emptyCount = snacks.filter(s => !s.snackId).length;

    const idCounts = {};
    snacks.forEach(s => {
      if (!s.snackId && s.snackId !== 0) return;
      existingIds.push(s.snackId);
      if (isNaN(Number(s.snackId)) || String(s.snackId).trim() === '') hasInvalid = true;
      idCounts[s.snackId] = (idCounts[s.snackId] || 0) + 1;
      if (idCounts[s.snackId] > 1) hasDuplicate = true;
    });

    if (hasInvalid || hasDuplicate) {
      res = { success: false, message: '경고: 간식 목록에 숫자가 아닌 ID나 중복된 ID가 존재합니다. 시트를 직접 확인해주세요.', hasError: true };
    } else if (emptyCount === 0) {
      res = { success: true, filledCount: 0, message: '모든 간식ID가 정상입니다.' };
    } else {
      let maxId = 0;
      existingIds.forEach(id => {
        const num = Number(id);
        if (num > maxId) maxId = num;
      });
      let filled = 0;
      snacks.forEach(s => {
        if (!s.snackId && s.snackId !== 0) {
          maxId++;
          s.snackId = maxId;
          filled++;
        }
      });
      saveMockSnacks(snacks);
      res = { success: true, filledCount: filled, message: `${filled}개의 빈 간식ID를 자동으로 채웠습니다.` };
    }
  } else if (action === 'verifyAdminAccess') {
    const adminToken = String(options.body?.adminToken || '').trim();
    res = adminToken
      ? { success: true, message: '관리자 권한이 확인되었습니다.' }
      : { success: false, message: '관리자 권한이 없습니다.' };
  } else if (action === 'diagnoseSystem') {
    const adminToken = options.body?.adminToken;
    if (!adminToken) {
      res = {
        success: true,
        mode: 'basic',
        message: '구글 앱스 스크립트(GAS) 서버와 통신은 정상이나, 상세 정보를 확인하려면 관리자 비밀번호를 입력해 주세요.'
      };
    } else {
      res = {
        success: true,
        mode: 'detailed',
        overallStatus: 'OK',
        apiContractVersion: API_CONTRACT_VERSION,
        environment: 'staging',
        sheets: {
          '간식목록': { exists: true, status: 'OK' },
          '이용자목록': { exists: true, status: 'OK' },
          '주문내역': { exists: true, status: 'OK' },
          '관리자로그': { exists: true, status: 'OK' },
          '운영설정': { exists: true, status: 'OK' },
          '후기내역': { exists: true, status: 'OK' },
          '주문보관': { exists: true, status: 'OK' },
          '게스트프로필': { exists: true, status: 'OK' },
          '게스트크레딧': { exists: true, status: 'OK' },
          '이용신청': { exists: true, status: 'OK' }
        },
        properties: {
          'APP_ENV': { configured: true, required: true, description: '배포 환경 구분(production 또는 staging)', status: 'OK' },
          'ADMIN_TOKEN': { configured: true, required: true, description: '관리자 API 요청 토큰', status: 'OK' },
          'KAKAO_REST_API_KEY': { configured: true, required: true, description: '카카오 로그인 API 키', status: 'OK' },
          'KAKAO_GUEST_KEY_SALT': { configured: true, required: true, description: '게스트 식별키 암호화 솔트', status: 'OK' },
          'KAKAO_CLIENT_SECRET': { configured: false, required: false, description: '카카오 로그인 보안 비밀키 (선택)', status: 'INFO' }
        },
        triggers: {
          weeklyRotation: { status: 'OK', count: 1, handler: 'rotateGuestApplicationWeekly' }
        },
        cache: {
          scriptCache: { status: 'OK', roundTrip: true }
        },
        timingsMs: {
          spreadsheetConnection: 3,
          sheetChecks: 12,
          properties: 1,
          triggers: 1,
          cache: 2,
          total: 19
        }
      };
    }
  } else {
    res = { success: false, error: "액션을 찾을 수 없습니다." };
  }

  // 구글 드라이브 이미지 URL 변환 적용
  if (res && res.success) {
    if (Array.isArray(res.users)) {
      res.users = res.users.map(u => ({
        ...u,
        imageUrl: convertDriveImageUrl(u.imageUrl)
      }));
    }
    if (Array.isArray(res.snacks)) {
      res.snacks = res.snacks.map(s => ({
        ...s,
        imageUrl: convertDriveImageUrl(s.imageUrl)
      }));
    }
  }

  return Object.assign({}, res || {}, {
    apiContractVersion: API_CONTRACT_VERSION,
    serverTime: new Date().toISOString()
  });
}

function getMockGuestSettings() {
  try {
    const cached = localStorage.getItem('mockGuestSettings');
    if (cached) return JSON.parse(cached);
  } catch (e) {}
  // 기본값 반환 (마감 상태)
  return {
    guestOpen: 'N',
    guestCloseAt: '',
    guestWeeklyScheduleEnabled: false,
    guestWeeklyScheduleDay: 3,
    guestWeeklyScheduleStartTime: '13:00',
    guestWeeklyScheduleEndTime: '15:00',
    guestWeeklyScheduleSkipDate: '',
    guestAdditionalSchedules: [],
    guestBaseCredit: GUEST_DEFAULT_CREDIT,
    kakaoGuestBonusCredit: 2,
    guestDeliveryFee: GUEST_DELIVERY_FEE,
    guestDefaultDeliveryPlace: '사무실 원탁',
    guestAllowRandomDisplayName: true,
    adminOrderEmailNotificationEnabled: true
  };
}

function saveMockGuestSettings(settings) {
  localStorage.setItem('mockGuestSettings', JSON.stringify(settings));
}

function getMockGuestCreditPeriodKey(dateValue) {
  const date = dateValue ? new Date(dateValue) : new Date();
  const validDate = isNaN(date.getTime()) ? new Date() : date;
  const year = validDate.getFullYear();
  const month = String(validDate.getMonth() + 1).padStart(2, '0');
  const day = String(validDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function splitMockGuestCreditDeviceIds(value) {
  return String(value || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
}

function mergeMockGuestCreditDeviceIds(currentIds, nextId) {
  const merged = [];
  (currentIds || []).forEach(id => {
    const normalized = String(id || '').trim();
    if (normalized && !merged.includes(normalized)) {
      merged.push(normalized);
    }
  });

  const normalizedNextId = String(nextId || '').trim();
  if (normalizedNextId && !merged.includes(normalizedNextId)) {
    merged.push(normalizedNextId);
  }

  return merged.slice(-20);
}

function getMockKakaoGuestBonusCredit(settings) {
  return Number(settings && settings.kakaoGuestBonusCredit !== undefined ? settings.kakaoGuestBonusCredit : 2);
}

function resolveMockGuestCreditWallet(data = {}, options = {}) {
  const settings = options.settings || getMockGuestSettings();
  const periodKey = options.periodKey || getMockGuestCreditPeriodKey();
  const guestDeviceId = String(data.guestDeviceId || '').trim();
  const requestedGuestKey = String(data.guestKey || '').trim();
  const authProvider = String(data.authProvider || '').trim().toLowerCase();
  const guestKey = authProvider === 'kakao' && requestedGuestKey ? requestedGuestKey : '';
  const spendCredit = Number(options.spendCredit || 0);
  const refundCredit = Number(options.refundCredit || 0);
  const wallets = JSON.parse(localStorage.getItem('mockGuestCreditWallets') || '[]');

  const matched = wallets
    .map((wallet, index) => ({
      ...wallet,
      index,
      guestDeviceIds: splitMockGuestCreditDeviceIds(wallet.guestDeviceId)
    }))
    .filter(wallet => {
      if (String(wallet.periodKey || '') !== periodKey) return false;
      const matchByDevice = guestDeviceId && wallet.guestDeviceIds.includes(guestDeviceId);
      const matchByGuestKey = guestKey && String(wallet.guestKey || '') === guestKey;
      return matchByDevice || matchByGuestKey;
    });

  const baseCredit = Number(settings.guestBaseCredit || GUEST_DEFAULT_CREDIT);
  const hasKakaoLink = !!guestKey || matched.some(wallet => wallet.guestKey);
  const bonusCredit = hasKakaoLink ? getMockKakaoGuestBonusCredit(settings) : 0;
  const creditLimit = baseCredit + bonusCredit;
  let usedCredit = matched.reduce((sum, wallet) => sum + Number(wallet.usedCredit || 0), 0);

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
        message: `보낼 온기가 부족합니다. 오늘 남은 온기: ${Math.max(0, creditLimit - usedCredit)}개`
      };
    }
    usedCredit += spendCredit;
  }

  if (refundCredit > 0) {
    usedCredit = Math.max(0, usedCredit - refundCredit);
  }

  const remainingCredit = Math.max(0, creditLimit - usedCredit);
  const shouldPersist = options.create || spendCredit > 0 || refundCredit > 0 || matched.length > 1;
  if (shouldPersist) {
    const primary = matched[0] || null;
    let mergedDeviceIds = [];
    matched.forEach(wallet => {
      wallet.guestDeviceIds.forEach(deviceId => {
        mergedDeviceIds = mergeMockGuestCreditDeviceIds(mergedDeviceIds, deviceId);
      });
    });

    const nextWallet = {
      periodKey,
      guestDeviceId: mergeMockGuestCreditDeviceIds(mergedDeviceIds, guestDeviceId).join(','),
      guestKey: guestKey || (primary ? primary.guestKey : ''),
      baseCredit,
      bonusCredit,
      creditLimit,
      usedCredit,
      remainingCredit,
      updatedAt: new Date().toISOString()
    };

    if (primary) {
      wallets[primary.index] = nextWallet;
      const removeIndexes = new Set(matched.slice(1).map(wallet => wallet.index));
      localStorage.setItem('mockGuestCreditWallets', JSON.stringify(wallets.filter((_, index) => !removeIndexes.has(index))));
    } else if (nextWallet.guestDeviceId || nextWallet.guestKey) {
      wallets.push(nextWallet);
      localStorage.setItem('mockGuestCreditWallets', JSON.stringify(wallets));
    }
  }

  return {
    success: true,
    periodKey,
    baseCredit,
    bonusCredit,
    creditLimit,
    usedCredit,
    remainingCredit
  };
}

function appendMockAdminLog(action, targetType, targetId, targetName, beforeValue, afterValue, memo) {
  try {
    const logs = JSON.parse(localStorage.getItem('mockAdminLogs') || '[]');
    logs.push({
      timestamp: new Date().toISOString(),
      action,
      targetType,
      targetId,
      targetName,
      beforeValue,
      afterValue,
      memo: memo || ''
    });
    localStorage.setItem('mockAdminLogs', JSON.stringify(logs));
  } catch (e) {
    console.warn('Mock 관리자 로그 저장 실패:', e);
  }
}
