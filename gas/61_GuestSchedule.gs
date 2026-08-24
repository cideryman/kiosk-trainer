const GUEST_WEEKLY_SCHEDULE_WEEKDAY = 3; // 수요일
const GUEST_WEEKLY_SCHEDULE_TIME_ZONE = 'Asia/Seoul';
const GUEST_WEEKLY_SCHEDULE_UTC_OFFSET_MINUTES = 9 * 60;
const GUEST_WEEKLY_SCHEDULE_DEFAULT_START_TIME = '13:00';
const GUEST_WEEKLY_SCHEDULE_DEFAULT_END_TIME = '15:00';

function parseGuestScheduleBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue === true;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toUpperCase();
  if (['TRUE', 'Y', '1'].includes(normalized)) return true;
  if (['FALSE', 'N', '0'].includes(normalized)) return false;
  return defaultValue === true;
}

function normalizeGuestScheduleTime(value, fallbackValue) {
  const normalized = String(value || '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)
    ? normalized
    : fallbackValue;
}

function getGuestScheduleTimeMinutes(value) {
  const parts = String(value || '').split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function getGuestScheduleKstParts(nowValue) {
  const parsed = nowValue instanceof Date ? new Date(nowValue.getTime()) : new Date(nowValue || new Date());
  const safeNow = isNaN(parsed.getTime()) ? new Date() : parsed;
  const shifted = new Date(safeNow.getTime() + GUEST_WEEKLY_SCHEDULE_UTC_OFFSET_MINUTES * 60 * 1000);
  return {
    now: safeNow,
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  };
}

function formatGuestScheduleDateKey(year, month, day) {
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0')
  ].join('-');
}

function getGuestScheduleDateKey(nowValue) {
  const parts = getGuestScheduleKstParts(nowValue);
  return formatGuestScheduleDateKey(parts.year, parts.month, parts.day);
}

function addGuestScheduleDays(dateKey, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0)));
  return formatGuestScheduleDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function buildGuestScheduleInstant(dateKey, timeValue) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(timeValue || ''));
  if (!dateMatch || !timeMatch) return null;
  const utcMillis = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2])
  ) - GUEST_WEEKLY_SCHEDULE_UTC_OFFSET_MINUTES * 60 * 1000;
  return new Date(utcMillis);
}

function getGuestScheduleTargetWednesday(nowValue, endTimeValue) {
  const parts = getGuestScheduleKstParts(nowValue);
  const todayKey = formatGuestScheduleDateKey(parts.year, parts.month, parts.day);
  let daysUntilWednesday = (GUEST_WEEKLY_SCHEDULE_WEEKDAY - parts.weekday + 7) % 7;
  const endMinutes = getGuestScheduleTimeMinutes(endTimeValue);
  if (daysUntilWednesday === 0 && parts.minutes >= endMinutes) daysUntilWednesday = 7;
  return addGuestScheduleDays(todayKey, daysUntilWednesday);
}

function getNextGuestScheduleWednesday(nowValue, startTimeValue) {
  const parts = getGuestScheduleKstParts(nowValue);
  const todayKey = formatGuestScheduleDateKey(parts.year, parts.month, parts.day);
  let daysUntilWednesday = (GUEST_WEEKLY_SCHEDULE_WEEKDAY - parts.weekday + 7) % 7;
  const startMinutes = getGuestScheduleTimeMinutes(startTimeValue);
  if (daysUntilWednesday === 0 && parts.minutes >= startMinutes) daysUntilWednesday = 7;
  return addGuestScheduleDays(todayKey, daysUntilWednesday);
}

function resolveGuestOperatingState(rawSettings, nowValue) {
  const settings = rawSettings || {};
  const parts = getGuestScheduleKstParts(nowValue);
  const now = parts.now;
  const todayKey = formatGuestScheduleDateKey(parts.year, parts.month, parts.day);
  const startTime = normalizeGuestScheduleTime(
    settings.guestWeeklyScheduleStartTime,
    GUEST_WEEKLY_SCHEDULE_DEFAULT_START_TIME
  );
  const endTime = normalizeGuestScheduleTime(
    settings.guestWeeklyScheduleEndTime,
    GUEST_WEEKLY_SCHEDULE_DEFAULT_END_TIME
  );
  const weeklyEnabled = parseGuestScheduleBoolean(settings.guestWeeklyScheduleEnabled, false);
  const menuMode = String(settings.guestMenuMode || 'normal').trim().toLowerCase();
  const skipDate = /^\d{4}-\d{2}-\d{2}$/.test(String(settings.guestWeeklyScheduleSkipDate || '').trim())
    ? String(settings.guestWeeklyScheduleSkipDate).trim()
    : '';
  const targetScheduleDate = getGuestScheduleTargetWednesday(now, endTime);
  const targetOccurrenceSkipped = weeklyEnabled && skipDate === targetScheduleDate;
  const todayOccurrenceSkipped = weeklyEnabled && skipDate === todayKey;
  const scheduleSuppressedByEvent = weeklyEnabled && menuMode !== 'normal';

  const todayStartAt = buildGuestScheduleInstant(todayKey, startTime);
  const todayEndAt = buildGuestScheduleInstant(todayKey, endTime);
  const weeklyOccurrenceToday = weeklyEnabled
    && !scheduleSuppressedByEvent
    && parts.weekday === GUEST_WEEKLY_SCHEDULE_WEEKDAY
    && !todayOccurrenceSkipped;
  const weeklyActive = Boolean(
    weeklyOccurrenceToday
    && todayStartAt
    && todayEndAt
    && now.getTime() >= todayStartAt.getTime()
    && now.getTime() < todayEndAt.getTime()
  );

  const rawManualCloseAt = settings.guestCloseAt ? new Date(settings.guestCloseAt) : null;
  const validManualCloseAt = rawManualCloseAt && !isNaN(rawManualCloseAt.getTime()) ? rawManualCloseAt : null;
  const manualRequested = String(settings.guestOpen || 'N').toUpperCase() === 'Y';
  const manualActive = Boolean(
    manualRequested
    && (!validManualCloseAt || now.getTime() < validManualCloseAt.getTime())
    && !todayOccurrenceSkipped
  );

  const activeCloseTimes = [];
  if (weeklyActive) activeCloseTimes.push(todayEndAt);
  if (manualActive) activeCloseTimes.push(validManualCloseAt);
  const finiteEffectiveCloseAt = activeCloseTimes.sort((a, b) => b.getTime() - a.getTime())[0] || null;
  const isGuestOpenNow = weeklyActive || manualActive;
  const effectiveCloseAt = manualActive && !validManualCloseAt ? null : finiteEffectiveCloseAt;
  let guestOpenSource = 'closed';
  if (isGuestOpenNow) {
    guestOpenSource = manualActive && (!weeklyActive || !validManualCloseAt || validManualCloseAt.getTime() > todayEndAt.getTime())
      ? 'manual'
      : 'weekly';
  }

  const completionCloseTimes = [];
  if (weeklyOccurrenceToday && todayEndAt && now.getTime() >= todayEndAt.getTime()) {
    completionCloseTimes.push(todayEndAt);
  }
  if (manualRequested && validManualCloseAt && now.getTime() >= validManualCloseAt.getTime() && !todayOccurrenceSkipped) {
    completionCloseTimes.push(validManualCloseAt);
  }
  const completionGraceCloseAt = completionCloseTimes.sort((a, b) => b.getTime() - a.getTime())[0] || null;

  let nextScheduledDate = '';
  let nextScheduledOpenAt = null;
  if (weeklyEnabled && !scheduleSuppressedByEvent) {
    nextScheduledDate = getNextGuestScheduleWednesday(now, startTime);
    if (skipDate && skipDate === nextScheduledDate) nextScheduledDate = addGuestScheduleDays(nextScheduledDate, 7);
    nextScheduledOpenAt = buildGuestScheduleInstant(nextScheduledDate, startTime);
  }

  const nextStateChangeAt = isGuestOpenNow ? effectiveCloseAt : nextScheduledOpenAt;
  return {
    weeklyEnabled,
    startTime,
    endTime,
    skipDate,
    targetScheduleDate,
    targetOccurrenceSkipped,
    todayOccurrenceSkipped,
    scheduleSuppressedByEvent,
    weeklyActive,
    manualActive,
    isGuestOpenNow,
    guestOpenSource,
    effectiveCloseAt,
    completionGraceCloseAt,
    nextScheduledDate,
    nextScheduledOpenAt,
    nextStateChangeAt,
    remainingSeconds: effectiveCloseAt
      ? Math.max(0, Math.floor((effectiveCloseAt.getTime() - now.getTime()) / 1000))
      : 0
  };
}
