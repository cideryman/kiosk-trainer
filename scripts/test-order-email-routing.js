#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
  Logger: { log() {} }
};
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, '../gas/40_Orders.gs'), 'utf8'),
  context,
  { filename: '40_Orders.gs' }
);
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, '../gas/41_EmailQueue.gs'), 'utf8'),
  context,
  { filename: '41_EmailQueue.gs' }
);

const shouldEnqueue = context.shouldEnqueueOrderNotification;
assert.equal(shouldEnqueue(false, { adminOrderEmailNotificationEnabled: true }), false, '키오스크 ON은 큐 등록 안 함');
assert.equal(shouldEnqueue(false, { adminOrderEmailNotificationEnabled: false }), false, '키오스크 OFF는 큐 등록 안 함');
assert.equal(shouldEnqueue(true, { adminOrderEmailNotificationEnabled: true }), true, '배달왔삼 포장 ON은 큐 등록');
assert.equal(shouldEnqueue(true, { adminOrderEmailNotificationEnabled: true }), true, '배달왔삼 배달 ON은 큐 등록');
assert.equal(shouldEnqueue(true, { adminOrderEmailNotificationEnabled: false }), false, '배달왔삼 OFF는 큐 등록 안 함');

const existingOrderRow = [
  new Date('2026-08-24T00:00:00Z'), 'ORD-260824-001', '', '', '', 'PENDING', 0, '', '', '', 'ORDER', 'ORD-260824-001'
];
const fakeSheet = {
  getLastRow() { return 2; },
  getRange() { return { getValues() { return [existingOrderRow]; } }; }
};
assert.equal(
  context.hasQueuedNotification(fakeSheet, 'ORDER', 'ORD-260824-001'),
  true,
  '같은 주문번호는 중복 큐 등록 차단'
);

console.log('Order email routing tests passed: 6 checks');
