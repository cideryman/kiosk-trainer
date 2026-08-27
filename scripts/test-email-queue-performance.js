#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HEADERS = [
  'createdAt', 'orderNo', 'recipient', 'subject', 'body', 'status',
  'attemptCount', 'nextAttemptAt', 'sentAt', 'lastError', 'notificationType', 'referenceId'
];

function createSheet(initialRows = [HEADERS]) {
  const rows = initialRows.map(row => row.slice());
  const reads = [];
  const writes = [];
  return {
    rows,
    reads,
    writes,
    getLastColumn() { return Math.max(0, ...rows.map(row => row.length)); },
    getLastRow() { return rows.length; },
    getRange(startRow, startColumn, rowCount = 1, columnCount = 1) {
      return {
        getValues() {
          reads.push({ startRow, startColumn, rowCount, columnCount });
          return Array.from({ length: rowCount }, (_, rowOffset) => (
            Array.from({ length: columnCount }, (_, columnOffset) => (
              rows[startRow - 1 + rowOffset]?.[startColumn - 1 + columnOffset] ?? ''
            ))
          ));
        },
        setValues(values) {
          writes.push({ startRow, startColumn, rowCount, columnCount });
          values.forEach((valueRow, rowOffset) => {
            const targetIndex = startRow - 1 + rowOffset;
            if (!rows[targetIndex]) rows[targetIndex] = [];
            valueRow.forEach((value, columnOffset) => {
              rows[targetIndex][startColumn - 1 + columnOffset] = value;
            });
          });
        }
      };
    }
  };
}

function createContext(sheet, sendEmail) {
  const cache = new Map([
    ['emailQueue.schema.v2', HEADERS.join('|')],
    ['emailQueue.recipient.v1', 'admin@example.com']
  ]);
  const lock = {
    locked: false,
    allow: true,
    tryLock() {
      if (!this.allow) return false;
      this.locked = true;
      return true;
    },
    hasLock() { return this.locked; },
    releaseLock() { this.locked = false; }
  };
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
    SHEET: { EMAIL_QUEUE: '이메일알림큐' },
    Logger: { log() {} },
    Utilities: {
      formatDate(value) { return new Date(value).toISOString().slice(0, 19).replace('T', ' '); }
    },
    Session: {
      getScriptTimeZone() { return 'Asia/Seoul'; },
      getEffectiveUser() { return { getEmail() { return 'fallback@example.com'; } }; }
    },
    PropertiesService: {
      getScriptProperties() { return { getProperty() { return 'admin@example.com'; } }; }
    },
    CacheService: {
      getScriptCache() {
        return {
          get(key) { return cache.get(key) || null; },
          put(key, value) { cache.set(key, value); }
        };
      }
    },
    LockService: {
      getDocumentLock() { return lock; },
      getScriptLock() { return lock; }
    },
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return {
          getSheetByName() { return sheet; },
          insertSheet() { return sheet; }
        };
      }
    },
    MailApp: { sendEmail }
  };
  context.__lock = lock;
  return context;
}

function loadQueue(context) {
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.resolve(__dirname, '../gas/41_EmailQueue.gs'), 'utf8'),
    context,
    { filename: '41_EmailQueue.gs' }
  );
}

const fastSheet = createSheet();
const fastContext = createContext(fastSheet, () => {});
loadQueue(fastContext);
const orderContext = {
  orderNo: 'ORD-260827-001',
  nickname: '테스트',
  deliveryType: 'pickup',
  items: [{ snackName: '간식', quantity: 1, totalPoint: 1 }],
  totalPoint: 1,
  timestamp: Date.now()
};
const queued = fastContext.enqueueOrderNotification(orderContext, { uniqueCommittedOrder: true });
assert.equal(queued.queued, true, '커밋 주문 빠른 경로가 큐에 적재');
assert.equal(fastSheet.rows.length, 2, '큐 행 한 건 생성');
assert.equal(fastSheet.reads.length, 0, '빠른 경로는 헤더·중복 전체 읽기를 생략');
assert(fastSheet.writes.some(write => write.columnCount === 12), '단일 setValues로 A:L 적재');

const duplicate = fastContext.enqueueOrderNotification(orderContext);
assert.equal(duplicate.duplicate, true, '일반 호출은 기존 중복 차단 유지');
assert.equal(fastSheet.rows.length, 2, '중복 호출은 행을 추가하지 않음');

fastContext.__lock.allow = false;
const busy = fastContext.enqueueOrderNotification({ ...orderContext, orderNo: 'ORD-260827-002' }, { uniqueCommittedOrder: true });
assert.equal(busy.queued, false, '큐 잠금 실패는 주문과 분리된 실패로 반환');
assert(/잠금/.test(busy.error), '큐 잠금 실패 원인 포함');

const sentSheet = createSheet([
  HEADERS,
  [new Date(), 'ORD-SENT', 'admin@example.com', 'subject', 'body', 'PENDING', 0, new Date(0), '', '', 'ORDER', 'ORD-SENT']
]);
const sentContext = createContext(sentSheet, () => {});
loadQueue(sentContext);
const sentResult = sentContext.processOrderEmailQueue();
assert.equal(sentResult.sent, 1, '대기 메일 발송 성공');
assert.equal(sentSheet.rows[1][5], 'SENT', '성공 행 SENT 전환');
assert.equal(sentSheet.rows[1][6], 1, '성공 시도 횟수 기록');
assert(sentSheet.writes.some(write => write.startColumn === 6 && write.columnCount === 3), '선점은 F:H만 기록');
assert(sentSheet.writes.some(write => write.startColumn === 6 && write.columnCount === 5), '결과는 F:J만 기록');

const retrySheet = createSheet([
  HEADERS,
  [new Date(), 'ORD-FAIL', 'admin@example.com', 'subject', 'body', 'PENDING', 0, new Date(0), '', '', 'ORDER', 'ORD-FAIL']
]);
const retryContext = createContext(retrySheet, () => { throw new Error('mail failed'); });
loadQueue(retryContext);
const expectedDelays = [1, 5, 15];
expectedDelays.forEach((minutes, index) => {
  const before = Date.now();
  retryContext.processOrderEmailQueue();
  assert.equal(retrySheet.rows[1][5], 'PENDING', `실패 ${index + 1}회는 재시도 대기`);
  assert.equal(retrySheet.rows[1][6], index + 1, `실패 ${index + 1}회 시도 횟수`);
  const delayMs = new Date(retrySheet.rows[1][7]).getTime() - before;
  assert(delayMs >= minutes * 60 * 1000 - 1000, `${minutes}분 재시도 간격 적용`);
  retrySheet.rows[1][7] = new Date(0);
});
retryContext.processOrderEmailQueue();
assert.equal(retrySheet.rows[1][5], 'FAILED', '4번째 실패 후 최종 FAILED');
assert.equal(retrySheet.rows[1][6], 4, '최종 시도 횟수 4회');

console.log('Email queue performance tests passed: 22 checks');
