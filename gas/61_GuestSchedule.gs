const GUEST_WEEKLY_SCHEDULE_WEEKDAY = 3; // 기존 운영 기본값: 수요일
const GUEST_WEEKLY_SCHEDULE_ALLOWED_DAYS = [1, 2, 3, 4, 5];
const GUEST_WEEKLY_SCHEDULE_TIME_ZONE = 'Asia/Seoul';
const GUEST_WEEKLY_SCHEDULE_UTC_OFFSET_MINUTES = 9 * 60;
const GUEST_WEEKLY_SCHEDULE_DEFAULT_START_TIME = '13:00';
const GUEST_WEEKLY_SCHEDULE_DEFAULT_END_TIME = '15:00';
const GUEST_SCHEDULE_DAY_NAMES = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

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
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(normalized) ? normalized : fallbackValue;
}

function normalizeGuestScheduleWeekday(value) {
  const weekday = Number(value);
  return GUEST_WEEKLY_SCHEDULE_ALLOWED_DAYS.includes(weekday) ? weekday : GUEST_WEEKLY_SCHEDULE_WEEKDAY;
}

function getGuestScheduleWeekdayName(value) {
  return GUEST_SCHEDULE_DAY_NAMES[normalizeGuestScheduleWeekday(value)] || '수요일';
}

function formatGuestScheduleKoreanDate(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!match) return String(dateKey || '');
  const weekday = getGuestScheduleDateWeekday(dateKey);
  const weekdayName = GUEST_SCHEDULE_DAY_NAMES[weekday] || '';
  return `${Number(match[2])}월 ${Number(match[3])}일(${weekdayName.slice(0, 1)})`;
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
  return [String(year).padStart(4, '0'), String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
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

function getGuestScheduleDateWeekday(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!match) return -1;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

function isValidGuestScheduleDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return formatGuestScheduleDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()) === dateKey;
}

function buildGuestScheduleInstant(dateKey, timeValue) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(timeValue || ''));
  if (!dateMatch || !timeMatch) return null;
  return new Date(Date.UTC(
    Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]),
    Number(timeMatch[1]), Number(timeMatch[2])
  ) - GUEST_WEEKLY_SCHEDULE_UTC_OFFSET_MINUTES * 60 * 1000);
}

function normalizeGuestAdditionalSchedules(rawValue) {
  let parsed = rawValue;
  if (typeof rawValue === 'string') {
    if (!rawValue.trim()) return [];
    try {
      parsed = JSON.parse(rawValue);
    } catch (error) {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const seenDates = {};
  return parsed.map(item => {
    const date = String(item && item.date || '').trim();
    const startTime = normalizeGuestScheduleTime(item && item.startTime, '');
    const endTime = normalizeGuestScheduleTime(item && item.endTime, '');
    if (!isValidGuestScheduleDateKey(date) || !startTime || !endTime) return null;
    if (!buildGuestScheduleInstant(date, startTime) || getGuestScheduleTimeMinutes(startTime) >= getGuestScheduleTimeMinutes(endTime)) return null;
    if (seenDates[date]) return null;
    seenDates[date] = true;
    return {
      scheduleId: String(item.scheduleId || ('additional-' + date)).trim(),
      date,
      startTime,
      endTime
    };
  }).filter(Boolean).sort((a, b) => (a.date + 'T' + a.startTime).localeCompare(b.date + 'T' + b.startTime));
}

function getGuestScheduleTargetDate(nowValue, weekdayValue, endTimeValue) {
  const parts = getGuestScheduleKstParts(nowValue);
  const todayKey = formatGuestScheduleDateKey(parts.year, parts.month, parts.day);
  const weekday = normalizeGuestScheduleWeekday(weekdayValue);
  let daysUntilTarget = (weekday - parts.weekday + 7) % 7;
  if (daysUntilTarget === 0 && parts.minutes >= getGuestScheduleTimeMinutes(endTimeValue)) daysUntilTarget = 7;
  return addGuestScheduleDays(todayKey, daysUntilTarget);
}

function getNextGuestWeeklyScheduleDate(nowValue, weekdayValue, startTimeValue) {
  const parts = getGuestScheduleKstParts(nowValue);
  const todayKey = formatGuestScheduleDateKey(parts.year, parts.month, parts.day);
  const weekday = normalizeGuestScheduleWeekday(weekdayValue);
  let daysUntilTarget = (weekday - parts.weekday + 7) % 7;
  if (daysUntilTarget === 0 && parts.minutes >= getGuestScheduleTimeMinutes(startTimeValue)) daysUntilTarget = 7;
  return addGuestScheduleDays(todayKey, daysUntilTarget);
}

function getGuestScheduleTargetWednesday(nowValue, endTimeValue) {
  return getGuestScheduleTargetDate(nowValue, GUEST_WEEKLY_SCHEDULE_WEEKDAY, endTimeValue);
}

function getNextGuestScheduleWednesday(nowValue, startTimeValue) {
  return getNextGuestWeeklyScheduleDate(nowValue, GUEST_WEEKLY_SCHEDULE_WEEKDAY, startTimeValue);
}

function buildGuestScheduleOccurrence(source, scheduleId, date, startTime, endTime) {
  return {
    source,
    scheduleId: scheduleId || '',
    date,
    weekday: getGuestScheduleDateWeekday(date),
    startTime,
    endTime,
    startAt: buildGuestScheduleInstant(date, startTime),
    endAt: buildGuestScheduleInstant(date, endTime)
  };
}

function serializeGuestScheduleOccurrence(occurrence) {
  if (!occurrence) return null;
  return {
    source: occurrence.source,
    scheduleId: occurrence.scheduleId || '',
    date: occurrence.date,
    weekday: occurrence.weekday,
    startTime: occurrence.startTime,
    endTime: occurrence.endTime,
    startAt: occurrence.startAt ? occurrence.startAt.toISOString() : '',
    endAt: occurrence.endAt ? occurrence.endAt.toISOString() : ''
  };
}

function resolveGuestOperatingState(rawSettings, nowValue) {
  const settings = rawSettings || {};
  const parts = getGuestScheduleKstParts(nowValue);
  const now = parts.now;
  const nowMillis = now.getTime();
  const todayKey = formatGuestScheduleDateKey(parts.year, parts.month, parts.day);
  const weekday = normalizeGuestScheduleWeekday(settings.guestWeeklyScheduleDay);
  const startTime = normalizeGuestScheduleTime(settings.guestWeeklyScheduleStartTime, GUEST_WEEKLY_SCHEDULE_DEFAULT_START_TIME);
  const endTime = normalizeGuestScheduleTime(settings.guestWeeklyScheduleEndTime, GUEST_WEEKLY_SCHEDULE_DEFAULT_END_TIME);
  const weeklyEnabled = parseGuestScheduleBoolean(settings.guestWeeklyScheduleEnabled, false);
  const additionalSchedules = normalizeGuestAdditionalSchedules(settings.guestAdditionalSchedulesJson || settings.guestAdditionalSchedules);
  const menuMode = String(settings.guestMenuMode || 'normal').trim().toLowerCase();
  const skipDate = /^\d{4}-\d{2}-\d{2}$/.test(String(settings.guestWeeklyScheduleSkipDate || '').trim())
    ? String(settings.guestWeeklyScheduleSkipDate).trim()
    : '';
  const targetScheduleDate = getGuestScheduleTargetDate(now, weekday, endTime);
  const targetOccurrenceSkipped = weeklyEnabled && skipDate === targetScheduleDate;
  const todayOccurrenceSkipped = weeklyEnabled && skipDate === todayKey;
  const scheduleSuppressedByEvent = menuMode !== 'normal' && (weeklyEnabled || additionalSchedules.some(item => item.date >= todayKey));

  const todayWeekly = buildGuestScheduleOccurrence('weekly', '', todayKey, startTime, endTime);
  const weeklyOccurrenceToday = weeklyEnabled
    && !scheduleSuppressedByEvent
    && parts.weekday === weekday
    && !todayOccurrenceSkipped;
  const weeklyActive = Boolean(weeklyOccurrenceToday && nowMillis >= todayWeekly.startAt.getTime() && nowMillis < todayWeekly.endAt.getTime());

  const additionalOccurrences = additionalSchedules
    .filter(item => item.date >= todayKey)
    .map(item => buildGuestScheduleOccurrence('additional', item.scheduleId, item.date, item.startTime, item.endTime));
  const activeAdditionalOccurrences = scheduleSuppressedByEvent ? [] : additionalOccurrences.filter(item => (
    item.date === todayKey && nowMillis >= item.startAt.getTime() && nowMillis < item.endAt.getTime()
  ));
  const additionalActive = activeAdditionalOccurrences.length > 0;

  const rawManualCloseAt = settings.guestCloseAt ? new Date(settings.guestCloseAt) : null;
  const validManualCloseAt = rawManualCloseAt && !isNaN(rawManualCloseAt.getTime()) ? rawManualCloseAt : null;
  const manualRequested = String(settings.guestOpen || 'N').toUpperCase() === 'Y';
  const manualActive = Boolean(
    manualRequested
    && (!validManualCloseAt || nowMillis < validManualCloseAt.getTime())
    && !todayOccurrenceSkipped
  );

  const activeOccurrences = [];
  if (weeklyActive) activeOccurrences.push(todayWeekly);
  activeOccurrences.push(...activeAdditionalOccurrences);
  if (manualActive) activeOccurrences.push({ source: 'manual', scheduleId: '', date: todayKey, startAt: null, endAt: validManualCloseAt });
  const hasUnlimitedManual = manualActive && !validManualCloseAt;
  const sourcePriority = { weekly: 1, additional: 2, manual: 3 };
  const effectiveOccurrence = hasUnlimitedManual ? activeOccurrences.find(item => item.source === 'manual') : activeOccurrences
    .filter(item => item.endAt)
    .sort((a, b) => (b.endAt.getTime() - a.endAt.getTime()) || (sourcePriority[b.source] - sourcePriority[a.source]))[0] || null;
  const isGuestOpenNow = weeklyActive || additionalActive || manualActive;
  const effectiveCloseAt = hasUnlimitedManual ? null : (effectiveOccurrence ? effectiveOccurrence.endAt : null);
  const guestOpenSource = isGuestOpenNow && effectiveOccurrence ? effectiveOccurrence.source : (isGuestOpenNow ? 'manual' : 'closed');

  const completionCloseTimes = [];
  if (weeklyOccurrenceToday && nowMillis >= todayWeekly.endAt.getTime()) completionCloseTimes.push(todayWeekly.endAt);
  if (!scheduleSuppressedByEvent) {
    additionalOccurrences.forEach(item => {
      if (item.date === todayKey && nowMillis >= item.endAt.getTime()) completionCloseTimes.push(item.endAt);
    });
  }
  if (manualRequested && validManualCloseAt && nowMillis >= validManualCloseAt.getTime() && !todayOccurrenceSkipped) {
    completionCloseTimes.push(validManualCloseAt);
  }
  const completionGraceCloseAt = completionCloseTimes.sort((a, b) => b.getTime() - a.getTime())[0] || null;

  const upcomingScheduledOccurrences = [];
  let nextWeeklyOccurrence = null;
  if (weeklyEnabled && !scheduleSuppressedByEvent) {
    let nextWeeklyDate = getNextGuestWeeklyScheduleDate(now, weekday, startTime);
    if (skipDate === nextWeeklyDate) nextWeeklyDate = addGuestScheduleDays(nextWeeklyDate, 7);
    nextWeeklyOccurrence = buildGuestScheduleOccurrence('weekly', '', nextWeeklyDate, startTime, endTime);
    upcomingScheduledOccurrences.push(nextWeeklyOccurrence);
  }
  if (!scheduleSuppressedByEvent) {
    additionalOccurrences.forEach(item => {
      if (item.startAt.getTime() > nowMillis) upcomingScheduledOccurrences.push(item);
    });
  }
  upcomingScheduledOccurrences.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const nextGuestScheduleOccurrence = upcomingScheduledOccurrences[0] || null;
  const nextScheduledOpenAt = nextGuestScheduleOccurrence ? nextGuestScheduleOccurrence.startAt : null;

  const boundaryTimes = [];
  if (weeklyEnabled && !scheduleSuppressedByEvent) {
    if (weeklyOccurrenceToday && todayWeekly.startAt.getTime() > nowMillis) boundaryTimes.push(todayWeekly.startAt);
    if (weeklyOccurrenceToday && todayWeekly.endAt.getTime() > nowMillis) boundaryTimes.push(todayWeekly.endAt);
    if (!weeklyOccurrenceToday && nextWeeklyOccurrence) boundaryTimes.push(nextWeeklyOccurrence.startAt);
  }
  if (!scheduleSuppressedByEvent) {
    additionalOccurrences.forEach(item => {
      if (item.startAt.getTime() > nowMillis) boundaryTimes.push(item.startAt);
      if (item.date === todayKey && item.endAt.getTime() > nowMillis && nowMillis >= item.startAt.getTime()) boundaryTimes.push(item.endAt);
    });
  }
  if (manualActive && validManualCloseAt) boundaryTimes.push(validManualCloseAt);
  const nextStateChangeAt = boundaryTimes.filter(Boolean).sort((a, b) => a.getTime() - b.getTime())[0] || null;

  return {
    weeklyEnabled,
    weekday,
    weekdayName: getGuestScheduleWeekdayName(weekday),
    startTime,
    endTime,
    skipDate,
    targetScheduleDate,
    targetOccurrenceSkipped,
    todayOccurrenceSkipped,
    scheduleSuppressedByEvent,
    weeklyActive,
    additionalActive,
    activeAdditionalScheduleIds: activeAdditionalOccurrences.map(item => item.scheduleId),
    manualActive,
    isGuestOpenNow,
    guestOpenSource,
    effectiveCloseAt,
    completionGraceCloseAt,
    additionalSchedules: additionalOccurrences.map(item => ({
      scheduleId: item.scheduleId,
      date: item.date,
      startTime: item.startTime,
      endTime: item.endTime,
      isActive: activeAdditionalOccurrences.some(active => active.scheduleId === item.scheduleId)
    })),
    nextScheduledDate: nextGuestScheduleOccurrence ? nextGuestScheduleOccurrence.date : '',
    nextScheduledOpenAt,
    nextGuestSchedule: serializeGuestScheduleOccurrence(nextGuestScheduleOccurrence),
    nextStateChangeAt,
    remainingSeconds: effectiveCloseAt ? Math.max(0, Math.floor((effectiveCloseAt.getTime() - nowMillis) / 1000)) : 0
  };
}
