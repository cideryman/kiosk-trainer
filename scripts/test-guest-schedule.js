#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '../gas/61_GuestSchedule.gs'), 'utf8');
const context = { Date, Math, Number, String, Boolean, RegExp, isNaN };
vm.createContext(context);
vm.runInContext(source, context, { filename: '61_GuestSchedule.gs' });
context.GUEST_ORDER_COMPLETION_GRACE_MINUTES = 5;
const settingsSource = fs.readFileSync(path.resolve(__dirname, '../gas/60_Settings.gs'), 'utf8');
vm.runInContext(settingsSource, context, { filename: '60_Settings.gs' });

const resolve = context.resolveGuestOperatingState;
const base = {
  guestWeeklyScheduleEnabled: 'TRUE',
  guestWeeklyScheduleDay: 3,
  guestWeeklyScheduleStartTime: '13:00',
  guestWeeklyScheduleEndTime: '15:00',
  guestWeeklyScheduleSkipDate: '',
  guestAdditionalSchedulesJson: '[]',
  guestMenuMode: 'normal',
  guestOpen: 'N',
  guestCloseAt: ''
};

function at(value, overrides = {}) {
  return resolve({ ...base, ...overrides }, new Date(value));
}

assert.equal(at('2026-08-25T12:59:00+09:00').isGuestOpenNow, false, '화요일은 마감');
assert.equal(at('2026-08-26T12:59:00+09:00').isGuestOpenNow, false, '수요일 12:59는 마감');
assert.equal(at('2026-08-26T13:00:00+09:00').guestOpenSource, 'weekly', '수요일 13:00 자동 개방');
assert.equal(at('2026-08-26T14:59:59+09:00').isGuestOpenNow, true, '수요일 14:59 운영');

const naturalClose = at('2026-08-26T15:00:00+09:00');
assert.equal(naturalClose.isGuestOpenNow, false, '수요일 15:00 신규 주문 마감');
assert.equal(naturalClose.completionGraceCloseAt.toISOString(), '2026-08-26T06:00:00.000Z', '자연 마감 유예 기준 보존');
assert.equal(
  new Date('2026-08-26T15:05:00+09:00').getTime() <= naturalClose.completionGraceCloseAt.getTime() + 5 * 60 * 1000,
  true,
  '15:05까지 완료 유예'
);
assert.equal(
  new Date('2026-08-26T15:05:01+09:00').getTime() <= naturalClose.completionGraceCloseAt.getTime() + 5 * 60 * 1000,
  false,
  '15:05 이후 완료 차단'
);
const completionSettings = {
  isGuestOpenNow: false,
  guestCompletionGraceCloseAt: naturalClose.completionGraceCloseAt.toISOString()
};
assert.equal(context.canCompleteStartedGuestOrder(completionSettings, '2026-08-26T14:59:59+09:00', '2026-08-26T15:05:00+09:00'), true, '15시 전 시작 주문은 15:05까지 허용');
assert.equal(context.canCompleteStartedGuestOrder(completionSettings, '2026-08-26T15:00:00+09:00', '2026-08-26T15:01:00+09:00'), false, '15시 시작 주문은 거절');
assert.equal(context.canCompleteStartedGuestOrder(completionSettings, '2026-08-26T14:59:59+09:00', '2026-08-26T15:05:01+09:00'), false, '15:05 이후 완료 거절');

const skipped = at('2026-08-26T14:00:00+09:00', { guestWeeklyScheduleSkipDate: '2026-08-26' });
assert.equal(skipped.isGuestOpenNow, false, '이번 회차 중단 시 당일 재개방 차단');
assert.equal(skipped.completionGraceCloseAt, null, '즉시 중단에는 완료 유예 없음');
assert.equal(skipped.nextScheduledDate, '2026-09-02', '중단 후 다음 수요일 자동 복귀');
assert.equal(
  at('2026-09-02T13:00:00+09:00', { guestWeeklyScheduleSkipDate: '2026-08-26' }).isGuestOpenNow,
  true,
  '지난 중단일은 다음 주에 영향 없음'
);

assert.equal(at('2026-08-26T14:00:00+09:00', { guestMenuMode: 'event' }).isGuestOpenNow, false, '행사 모드 자동 개방 차단');
assert.equal(at('2026-08-26T14:00:00+09:00', { guestMenuMode: 'event' }).scheduleSuppressedByEvent, true, '행사 모드 억제 사유');

const manualOverlap = at('2026-08-26T14:00:00+09:00', {
  guestOpen: 'Y',
  guestCloseAt: '2026-08-26T16:00:00+09:00'
});
assert.equal(manualOverlap.guestOpenSource, 'manual', '더 늦게 끝나는 수동 운영 우선');
assert.equal(manualOverlap.effectiveCloseAt.toISOString(), '2026-08-26T07:00:00.000Z', '수동 마감까지 운영');
assert.equal(at('2026-08-25T14:00:00+09:00', { guestOpen: 'Y', guestCloseAt: '' }).guestOpenSource, 'manual', '종료시각 없는 기존 수동 운영 호환');

assert.equal(at('2026-08-26T14:00:00+09:00', { guestWeeklyScheduleEnabled: 'FALSE' }).isGuestOpenNow, false, '자동 일정 OFF');
assert.equal(at('2026-08-26T15:00:00+09:00').targetScheduleDate, '2026-09-02', '마감 이후 중단 대상은 다음 수요일');

const thursdaySchedule = at('2026-08-27T10:00:00+09:00', {
  guestWeeklyScheduleDay: 4,
  guestWeeklyScheduleStartTime: '09:00',
  guestWeeklyScheduleEndTime: '12:00'
});
assert.equal(thursdaySchedule.weekdayName, '목요일', '정기 요일을 목요일로 변경');
assert.equal(thursdaySchedule.isGuestOpenNow, true, '목요일 가변 정기 일정 자동 개방');

const additionalJson = JSON.stringify([
  { scheduleId: 'extra-thu', date: '2026-08-27', startTime: '09:00', endTime: '12:00' },
  { scheduleId: 'extra-fri', date: '2026-08-28', startTime: '10:00', endTime: '11:00' }
]);
const additionalActive = at('2026-08-27T10:00:00+09:00', {
  guestWeeklyScheduleEnabled: 'FALSE',
  guestAdditionalSchedulesJson: additionalJson
});
assert.equal(additionalActive.guestOpenSource, 'additional', '날짜 지정 추가 운영 자동 개방');
assert.deepEqual(additionalActive.activeAdditionalScheduleIds, ['extra-thu'], '활성 추가 일정 ID 반환');

const nearestAdditional = at('2026-08-26T08:00:00+09:00', {
  guestAdditionalSchedulesJson: JSON.stringify([
    { scheduleId: 'extra-near', date: '2026-08-26', startTime: '09:00', endTime: '11:00' }
  ])
});
assert.equal(nearestAdditional.nextGuestSchedule.scheduleId, 'extra-near', '정기 일정보다 가까운 추가 운영 우선 안내');

const overlapAdditional = at('2026-08-26T14:00:00+09:00', {
  guestAdditionalSchedulesJson: JSON.stringify([
    { scheduleId: 'extra-long', date: '2026-08-26', startTime: '14:00', endTime: '16:00' }
  ])
});
assert.equal(overlapAdditional.guestOpenSource, 'additional', '더 늦게 끝나는 추가 운영을 실효 출처로 선택');
assert.equal(overlapAdditional.effectiveCloseAt.toISOString(), '2026-08-26T07:00:00.000Z', '정기·추가 중 가장 늦은 마감 적용');

const overlapBoundary = at('2026-08-26T13:30:00+09:00', {
  guestAdditionalSchedulesJson: JSON.stringify([
    { scheduleId: 'extra-later', date: '2026-08-26', startTime: '14:00', endTime: '16:00' }
  ])
});
assert.equal(overlapBoundary.nextStateChangeAt.toISOString(), '2026-08-26T05:00:00.000Z', '운영 중 겹치는 일정 시작 경계에서 재조회');

const skippedWithAdditional = at('2026-08-26T14:00:00+09:00', {
  guestWeeklyScheduleSkipDate: '2026-08-26',
  guestOpen: 'Y',
  guestCloseAt: '2026-08-26T16:00:00+09:00',
  guestAdditionalSchedulesJson: JSON.stringify([
    { scheduleId: 'extra-kept', date: '2026-08-26', startTime: '13:00', endTime: '15:30' }
  ])
});
assert.equal(skippedWithAdditional.manualActive, false, '중단일에는 긴급 수동 운영 차단');
assert.equal(skippedWithAdditional.guestOpenSource, 'additional', '정기 회차 중단과 별도 추가 운영은 분리');

const eventSuppression = at('2026-08-27T10:00:00+09:00', {
  guestWeeklyScheduleEnabled: 'FALSE',
  guestMenuMode: 'event',
  guestAdditionalSchedulesJson: additionalJson
});
assert.equal(eventSuppression.isGuestOpenNow, false, '행사 모드에서 추가 일정 자동 개방 억제');
assert.equal(eventSuppression.nextGuestSchedule, null, '행사 모드에서 다음 자동 운영 미노출');

const normalizedDuplicate = context.normalizeGuestAdditionalSchedules(JSON.stringify([
  { scheduleId: 'first', date: '2026-08-27', startTime: '09:00', endTime: '12:00' },
  { scheduleId: 'duplicate', date: '2026-08-27', startTime: '13:00', endTime: '14:00' }
]));
assert.equal(normalizedDuplicate.length, 1, '날짜당 추가 일정 하나만 정규화');

const fakeRows = [['key', 'value']];
const fakeSheet = {
  getLastRow: () => fakeRows.length,
  appendRow: row => fakeRows.push(row.slice()),
  getRange(row, column, rowCount, columnCount) {
    return {
      getValues: () => Array.from({ length: rowCount }, (_, rowIndex) => (
        Array.from({ length: columnCount }, (_, columnIndex) => fakeRows[row - 1 + rowIndex]?.[column - 1 + columnIndex] ?? '')
      )),
      setValues(values) {
        values.forEach((valueRow, rowIndex) => {
          const targetIndex = row - 1 + rowIndex;
          if (!fakeRows[targetIndex]) fakeRows[targetIndex] = [];
          valueRow.forEach((value, columnIndex) => { fakeRows[targetIndex][column - 1 + columnIndex] = value; });
        });
      }
    };
  }
};
context.SHEET = { SETTINGS: '운영설정' };
context.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: () => fakeSheet, insertSheet: () => fakeSheet }) };
context.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
context.CacheService = { getScriptCache: () => ({ remove: () => {}, get: () => null, put: () => {} }) };
context.Logger = { log: () => {} };
context.Utilities = {
  getUuid: () => 'test-schedule-id',
  formatDate: date => date.toISOString().slice(11, 16)
};
context.safeAppendAdminLog = () => {};

const createdSchedule = context.updateGuestSettings({
  settingsAction: 'upsertAdditionalSchedule',
  date: '2099-01-02',
  startTime: '09:00',
  endTime: '12:00'
});
assert.equal(createdSchedule.success, true, '추가 일정 생성');
assert.equal(createdSchedule.schedule.scheduleId, 'test-schedule-id', '추가 일정 서버 ID 발급');
const duplicateSchedule = context.updateGuestSettings({
  settingsAction: 'upsertAdditionalSchedule',
  date: '2099-01-02',
  startTime: '13:00',
  endTime: '14:00'
});
assert.equal(duplicateSchedule.success, false, '같은 날짜 추가 일정 중복 거부');
const editedSchedule = context.updateGuestSettings({
  settingsAction: 'upsertAdditionalSchedule',
  scheduleId: 'test-schedule-id',
  date: '2099-01-03',
  startTime: '10:00',
  endTime: '13:00'
});
assert.equal(editedSchedule.success, true, '추가 일정 행 수정');
const deletedSchedule = context.updateGuestSettings({ settingsAction: 'deleteAdditionalSchedule', scheduleId: 'test-schedule-id' });
assert.equal(deletedSchedule.success, true, '추가 일정 취소');

const kitchenHtml = fs.readFileSync(path.resolve(__dirname, '../kitchen.html'), 'utf8');
const kitchenJs = fs.readFileSync(path.resolve(__dirname, '../js/kitchen.js'), 'utf8');
['input-guest-weekly-schedule-day', 'input-guest-additional-date', 'guest-additional-schedule-list', 'input-guest-manual-end', 'btn-guest-open-until'].forEach(id => {
  assert.equal(kitchenHtml.includes(`id="${id}"`), true, `주방 새 일정 컨트롤 존재: ${id}`);
});
['btn-guest-open20', 'btn-guest-open30', 'btn-guest-open60', 'btn-guest-open-custom', 'input-custom-minutes'].forEach(id => {
  assert.equal(kitchenHtml.includes(`id="${id}"`), false, `주방 분 단위 운영 컨트롤 제거: ${id}`);
});
assert.equal(kitchenJs.includes("settingsAction: 'upsertAdditionalSchedule'"), true, '추가 일정 저장 API 연결');
assert.equal(kitchenJs.includes("settingsAction: 'deleteAdditionalSchedule'"), true, '추가 일정 취소 API 연결');

console.log('Guest schedule tests passed: recurring, additional, manual, grace, suppression');
