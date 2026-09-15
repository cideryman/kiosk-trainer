#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const scheduleSource = fs.readFileSync(path.join(root, 'gas/61_GuestSchedule.gs'), 'utf8');
const settingsSource = fs.readFileSync(path.join(root, 'gas/60_Settings.gs'), 'utf8');
const ordersSource = fs.readFileSync(path.join(root, 'gas/40_Orders.gs'), 'utf8').replace(/\r\n/g, '\n');
const mockSource = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8').replace(/\r\n/g, '\n');

// 1. Verify buildGuestSettingsResponse in gas/60_Settings.gs
const context = {
  Date,
  Math,
  Number,
  String,
  Boolean,
  Array,
  Object,
  JSON,
  RegExp,
  isNaN,
  GUEST_ORDER_COMPLETION_GRACE_MINUTES: 5,
  Logger: { log() {} }
};
vm.createContext(context);
vm.runInContext(scheduleSource, context, { filename: '61_GuestSchedule.gs' });
vm.runInContext(settingsSource, context, { filename: '60_Settings.gs' });

// Test ordersList with kiosk users + guest users
const sampleOrders = [
  { orderNo: 'ORD-K1', userId: 'user001', deliveryType: 'pickup', cancelTimestamp: '' },
  { orderNo: 'ORD-K2', userId: 'user002', deliveryType: 'pickup', cancelTimestamp: '' },
  { orderNo: 'ORD-K3', userId: 'user003', deliveryType: 'pickup', cancelTimestamp: '' },
  { orderNo: 'ORD-K4', userId: 'user004', deliveryType: 'pickup', cancelTimestamp: '' },
  { orderNo: 'ORD-K5', userId: 'user005', deliveryType: 'pickup', cancelTimestamp: '' },
  { orderNo: 'ORD-G1', userId: 'guest', deliveryType: 'delivery', cancelTimestamp: '' },
  { orderNo: 'ORD-G2', userId: 'guest', deliveryType: 'pickup', cancelTimestamp: '' },
  { orderNo: 'ORD-G3', userId: 'guest', deliveryType: 'pickup', cancelTimestamp: '2026-09-15T09:00:00Z' }, // canceled
];

const mockSettings = {
  guestOpen: 'Y',
  guestMaxOrderCount: 5,
  guestMaxDeliveryCount: 2,
  guestWeeklyScheduleEnabled: 'FALSE'
};

const result = context.buildGuestSettingsResponse(mockSettings, sampleOrders);

assert.equal(result.todayOrderCount, 2, '게스트 유효 주문만 카운트되어야 함 (취소 및 키오스크 제외)');
assert.equal(result.todayDeliveryCount, 1, '게스트 배달 주문만 카운트되어야 함');
assert.equal(result.remainingOrderCount, 3, '잔여 정원은 5 - 2 = 3이어야 함');
assert.equal(result.isOrderCapped, false, '키오스크 5건이 있어도 게스트 정원이 마감되면 안 됨');

// If 5 guest orders exist, it should cap
const fullGuestOrders = [
  { orderNo: 'ORD-G1', userId: 'guest', deliveryType: 'delivery', cancelTimestamp: '' },
  { orderNo: 'ORD-G2', userId: 'guest', deliveryType: 'pickup', cancelTimestamp: '' },
  { orderNo: 'ORD-G3', userId: 'guest', deliveryType: 'pickup', cancelTimestamp: '' },
  { orderNo: 'ORD-G4', userId: 'guest', deliveryType: 'pickup', cancelTimestamp: '' },
  { orderNo: 'ORD-G5', userId: 'guest', deliveryType: 'pickup', cancelTimestamp: '' },
];
const fullResult = context.buildGuestSettingsResponse(mockSettings, fullGuestOrders);
assert.equal(fullResult.todayOrderCount, 5, '게스트 주문 5건 집계');
assert.equal(fullResult.isOrderCapped, true, '게스트 주문이 5건 도달 시 마감되어야 함');

// 2. Verify gas/40_Orders.gs placeOrder filtering
assert(
  /const rowUserId = String\(r\[userIdIdx\].*?\)\.trim\(\);\s*if \(rowUserId !== 'guest'\) continue;/.test(ordersSource),
  'placeOrder 내부 orderRowsSnapshot 집계 루프에서 rowUserId !== guest 시 건너뛰어야 함'
);

// 3. Verify js/config.js mock implementation filtering
assert(
  mockSource.includes("allOrdersForCap.forEach(o => {\n        if (!o.cancelTimestamp && o.orderNo && o.userId === 'guest')"),
  'js/config.js getGuestSettings mock에서 userId === guest 필터링이 적용되어야 함'
);
assert(
  mockSource.includes("allOrdersForOrderCap.forEach(o => {\n        if (!o.cancelTimestamp && o.orderNo && o.userId === 'guest')"),
  'js/config.js placeOrder mock에서 userId === guest 필터링이 적용되어야 함'
);

console.log('P125 guest order capping separation tests passed successfully!');
