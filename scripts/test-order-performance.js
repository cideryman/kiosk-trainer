#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ordersSource = fs.readFileSync(path.resolve(__dirname, '../gas/40_Orders.gs'), 'utf8');
const queueSource = fs.readFileSync(path.resolve(__dirname, '../gas/41_EmailQueue.gs'), 'utf8');

const orderContext = {
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
vm.createContext(orderContext);
vm.runInContext(ordersSource, orderContext, { filename: '40_Orders.gs' });

assert.equal(orderContext.createOrderPerformanceState_({}), null, '일반 주문 응답은 계측을 포함하지 않음');
const performanceState = orderContext.createOrderPerformanceState_({ perfDebug: 1 });
assert(performanceState, 'perfDebug=1은 계측 상태를 생성');
assert.equal(
  orderContext.measureOrderPerformanceStep_(performanceState, 'ordersRead', () => 'ok'),
  'ok',
  '계측 래퍼는 콜백 결과를 보존'
);
const measuredResponse = orderContext.finishOrderPerformanceResponse_({ success: true }, performanceState);
assert.equal(measuredResponse.success, true, '계측은 기존 성공 응답을 보존');
assert(Number.isFinite(measuredResponse._timings.ordersRead), '단계별 계측값 포함');
assert(Number.isFinite(measuredResponse._timings.total), '전체 계측값 포함');
assert(
  ordersSource.includes('getUserValuesForRead(userSheet)'),
  '일반 주문은 5분 이용자 읽기 캐시를 사용'
);
assert(
  ordersSource.includes("enqueueOrderNotification(notificationContext, { uniqueCommittedOrder: true })"),
  '커밋된 신규 주문은 이메일 큐 빠른 경로를 사용'
);

assert(
  queueSource.includes('getOrderEmailQueueLock()'),
  '이메일 큐는 주문 트랜잭션과 분리된 잠금을 사용'
);
assert(
  queueSource.includes('sheet.getRange(2, 6, values.length, 3)'),
  '큐 선점은 상태 관련 F:H 열만 갱신'
);
assert(
  queueSource.includes('sheet.getRange(2, 6, values.length, 5)'),
  '큐 결과는 상태 관련 F:J 열만 갱신'
);
assert(
  !queueSource.includes("sheet.appendRow([\n      now,\n      orderNo"),
  '주문 큐 적재는 appendRow 전체 행 호출을 사용하지 않음'
);

console.log('Order performance tests passed: 12 checks');
