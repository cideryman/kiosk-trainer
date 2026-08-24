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
  guestWeeklyScheduleStartTime: '13:00',
  guestWeeklyScheduleEndTime: '15:00',
  guestWeeklyScheduleSkipDate: '',
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

console.log('Guest weekly schedule tests passed: 20 checks');
