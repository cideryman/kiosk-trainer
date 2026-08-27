#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APPLICATION_HEADERS = [
  'createdAt', 'applicationId', 'requestId', 'name', 'relationType', 'relationDetail',
  'phone', 'deliveryPlace', 'deliveryDetail', 'preferredDays', 'message', 'consentAt',
  'status', 'contactedAt', 'reviewedAt', 'retentionUntil', 'anonymizedAt', 'adminMemo',
  'waitlistPosition', 'skipUntil', 'cooldownUntil', 'updatedAt'
];
const OPERATION_HEADERS = [
  'operationId', 'applicationId', 'serviceWeek', 'status',
  'selectedAt', 'completedAt', 'adminMemo', 'createdAt', 'updatedAt'
];

function createSheet(rows) {
  const writes = [];
  return {
    rows,
    writes,
    getLastRow() { return rows.length + 1; },
    getRange(startRow, startColumn, rowCount, columnCount) {
      return {
        setValues(values) {
          writes.push({ startRow, startColumn, rowCount, columnCount, values });
        }
      };
    }
  };
}

function mapHeaders(headers) {
  return Object.fromEntries(headers.map((header, index) => [header, index]));
}

function applicationRow(id, status) {
  const row = Array(APPLICATION_HEADERS.length).fill('');
  row[APPLICATION_HEADERS.indexOf('applicationId')] = id;
  row[APPLICATION_HEADERS.indexOf('requestId')] = `request_${id}_123456`;
  row[APPLICATION_HEADERS.indexOf('name')] = id;
  row[APPLICATION_HEADERS.indexOf('relationType')] = 'OTHER';
  row[APPLICATION_HEADERS.indexOf('phone')] = `0101234${id.slice(-4).padStart(4, '0')}`;
  row[APPLICATION_HEADERS.indexOf('deliveryPlace')] = '테스트 장소';
  row[APPLICATION_HEADERS.indexOf('preferredDays')] = '수요일';
  row[APPLICATION_HEADERS.indexOf('status')] = status;
  return row;
}

function operationRow(operationId, applicationId, status, serviceWeek = '2026-08-31') {
  const row = Array(OPERATION_HEADERS.length).fill('');
  row[0] = operationId;
  row[1] = applicationId;
  row[2] = serviceWeek;
  row[3] = status;
  return row;
}

function createContext() {
  const cache = new Map();
  const logs = [];
  const lock = { waitLock() {}, releaseLock() {} };
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
    Set,
    Map,
    isNaN,
    Logger: { log() {} },
    Utilities: {
      formatDate(value, _zone, format) {
        const date = new Date(value);
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(date);
        const dateText = ['year', 'month', 'day']
          .map(type => parts.find(part => part.type === type).value)
          .join('-');
        return format === 'yyyyMMdd' ? dateText.replace(/-/g, '') : dateText;
      }
    },
    Session: { getScriptTimeZone() { return 'Asia/Seoul'; } },
    LockService: { getScriptLock() { return lock; } },
    CacheService: {
      getScriptCache() {
        return {
          get(key) { return cache.get(key) || null; },
          put(key, value) { cache.set(key, value); }
        };
      }
    },
    SpreadsheetApp: { flush() {} },
    safeAppendAdminLog(...args) { logs.push(args); },
    clearGuestApplicationSettingsCache() {},
    SHEET: { GUEST_APPLICATION_OPERATIONS: '이용운영기록' }
  };
  context.__cache = cache;
  context.__logs = logs;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.resolve(__dirname, '../gas/12_GuestApplications.gs'), 'utf8'),
    context,
    { filename: '12_GuestApplications.gs' }
  );
  vm.runInContext(
    fs.readFileSync(path.resolve(__dirname, '../gas/14_GuestApplicationOperations.gs'), 'utf8'),
    context,
    { filename: '14_GuestApplicationOperations.gs' }
  );
  return context;
}

function installTables(context, applicationRows, operationRows) {
  const applicationSheet = createSheet(applicationRows);
  const operationSheet = createSheet(operationRows);
  const applicationTable = {
    sheet: applicationSheet,
    headers: APPLICATION_HEADERS,
    map: mapHeaders(APPLICATION_HEADERS),
    rows: applicationRows
  };
  const operationTable = {
    sheet: operationSheet,
    headers: OPERATION_HEADERS,
    map: mapHeaders(OPERATION_HEADERS),
    rows: operationRows
  };
  context.ensureGuestApplicationSheet = () => applicationSheet;
  context.getGuestApplicationRows = () => applicationTable;
  context.getGuestApplicationOperationTable = () => operationTable;
  return { applicationSheet, operationSheet, applicationTable, operationTable };
}

const context = createContext();
const minimalApplication = context.validateGuestApplication({
  requestId: 'request_1234567890',
  name: '신청자',
  relationType: 'OTHER',
  phone: '01012345678',
  deliveryPlace: '복지관',
  preferredDays: ['수요일'],
  consent: true,
  website: ''
});
assert.equal(minimalApplication.success, true, '간소화 신청서 필수값만으로 접수 가능');
assert.equal(minimalApplication.value.relationDetail, '', '관계 설명은 빈 값 저장');
assert.equal(minimalApplication.value.deliveryDetail, '', '상세 전달 방법은 빈 값 저장');
assert.equal(minimalApplication.value.message, '', '자유 메시지는 빈 값 저장');

let tables = installTables(context, [
  applicationRow('APP-001', 'PENDING'),
  applicationRow('APP-002', 'WAITLIST'),
  applicationRow('APP-003', 'APPROVED')
], []);
let result = context.updateGuestApplications({
  applicationIds: ['APP-001', 'APP-002'],
  bulkAction: 'APPROVE',
  requestId: 'bulk-approve-1'
});
assert.equal(result.success, true, '여러 신청자 승인 성공');
assert.equal(result.count, 2, '승인 대상 수 반환');
assert.equal(tables.applicationTable.rows[0][12], 'APPROVED', '첫 신청자 승인');
assert.equal(tables.applicationTable.rows[1][12], 'APPROVED', '둘째 신청자 승인');
assert.equal(tables.applicationSheet.writes.length, 1, '일괄 승인은 단일 배치 저장');
const writesAfterApprove = tables.applicationSheet.writes.length;
result = context.updateGuestApplications({
  applicationIds: ['APP-001', 'APP-002'],
  bulkAction: 'APPROVE',
  requestId: 'bulk-approve-1'
});
assert.equal(result.success, true, '같은 requestId는 기존 성공 결과 반환');
assert.equal(tables.applicationSheet.writes.length, writesAfterApprove, '재시도는 중복 저장하지 않음');

tables = installTables(context, [
  applicationRow('APP-011', 'PENDING'),
  applicationRow('APP-012', 'APPROVED')
], []);
const rowsBeforeMixedBulk = JSON.stringify(tables.applicationTable.rows);
const mixedLogCount = context.__logs.length;
const mixedCacheCount = context.__cache.size;
result = context.updateGuestApplications({
  applicationIds: ['APP-011', 'APP-012'],
  bulkAction: 'APPROVE',
  requestId: 'bulk-mixed-1'
});
assert.equal(result.success, false, '허용되지 않은 상태가 섞인 승인은 전체 거부');
assert.equal(JSON.stringify(tables.applicationTable.rows), rowsBeforeMixedBulk, '혼합 승인은 메모리 상태도 무변경');
assert.equal(tables.applicationSheet.writes.length, 0, '혼합 승인은 시트 무변경');
assert.equal(context.__logs.length, mixedLogCount, '실패한 일괄 승인은 관리자 로그를 남기지 않음');
assert.equal(context.__cache.size, mixedCacheCount, '실패한 일괄 승인은 결과 캐시를 남기지 않음');

tables = installTables(context, [
  applicationRow('APP-101', 'APPROVED'),
  applicationRow('APP-102', 'APPROVED'),
  applicationRow('APP-103', 'INACTIVE')
], [
  operationRow('OPS-1', 'APP-101', 'SELECTED'),
  operationRow('OPS-2', 'APP-102', 'SELECTED'),
  operationRow('OPS-3', 'APP-103', 'SELECTED'),
  operationRow('OPS-4', 'APP-101', 'COMPLETED')
]);
const originalOperations = JSON.stringify(tables.operationTable.rows);
const completeFailureLogCount = context.__logs.length;
const completeFailureCacheCount = context.__cache.size;
result = context.completeGuestApplicationOperations({ operationIds: ['OPS-1', 'MISSING'], requestId: 'complete-missing' });
assert.equal(result.success, false, '누락 ID가 섞인 완료 전체 거부');
assert.equal(JSON.stringify(tables.operationTable.rows), originalOperations, '누락 완료 요청 무변경');
result = context.completeGuestApplicationOperations({ operationIds: ['OPS-1', 'OPS-4'], requestId: 'complete-status' });
assert.equal(result.success, false, '완료 불가능 상태가 섞인 요청 전체 거부');
assert.equal(JSON.stringify(tables.operationTable.rows), originalOperations, '상태 혼합 완료 요청 무변경');
result = context.completeGuestApplicationOperations({ operationIds: ['OPS-1', 'OPS-3'], requestId: 'complete-inactive' });
assert.equal(result.success, false, '미승인 신청자 포함 완료 전체 거부');
assert.equal(tables.operationSheet.writes.length, 0, '실패한 완료 요청은 시트·로그 저장 전 중단');
assert.equal(context.__logs.length, completeFailureLogCount, '실패한 완료 요청은 관리자 로그를 남기지 않음');
assert.equal(context.__cache.size, completeFailureCacheCount, '실패한 완료 요청은 결과 캐시를 남기지 않음');

result = context.completeGuestApplicationOperations({ operationIds: ['OPS-1', 'OPS-1', 'OPS-2'], requestId: 'complete-ok' });
assert.equal(result.success, true, '정상 운영 일정 일괄 완료');
assert.equal(result.completed, 2, '중복 ID 제거 후 완료 수 반환');
assert.equal(tables.operationTable.rows[0][3], 'COMPLETED', '첫 운영 완료');
assert.equal(tables.operationTable.rows[1][3], 'COMPLETED', '둘째 운영 완료');
assert.equal(tables.operationSheet.writes.length, 1, '완료는 단일 배치 저장');
const completionWrites = tables.operationSheet.writes.length;
result = context.completeGuestApplicationOperations({ operationIds: ['OPS-1', 'OPS-2'], requestId: 'complete-ok' });
assert.equal(result.success, true, '완료 재시도는 캐시 성공 응답');
assert.equal(tables.operationSheet.writes.length, completionWrites, '완료 재시도는 중복 저장하지 않음');

tables = installTables(context, [applicationRow('APP-201', 'APPROVED')], [
  operationRow('OPS-C1', 'APP-201', 'SELECTED'),
  operationRow('OPS-C2', 'APP-201', 'COMPLETED')
]);
const cancelBefore = JSON.stringify(tables.operationTable.rows);
const cancelFailureLogCount = context.__logs.length;
const cancelFailureCacheCount = context.__cache.size;
result = context.cancelGuestApplicationOperations({ operationIds: ['OPS-C1', 'OPS-C2'], requestId: 'cancel-mixed' });
assert.equal(result.success, false, '확정 취소 불가능 상태 혼합 전체 거부');
assert.equal(JSON.stringify(tables.operationTable.rows), cancelBefore, '혼합 확정 취소 무변경');
result = context.cancelGuestApplicationOperations({ operationIds: ['OPS-C1', 'UNKNOWN'], requestId: 'cancel-missing' });
assert.equal(result.success, false, '누락 ID 포함 확정 취소 전체 거부');
assert.equal(tables.operationSheet.writes.length, 0, '실패한 확정 취소는 시트 무변경');
assert.equal(context.__logs.length, cancelFailureLogCount, '실패한 확정 취소는 관리자 로그를 남기지 않음');
assert.equal(context.__cache.size, cancelFailureCacheCount, '실패한 확정 취소는 결과 캐시를 남기지 않음');
result = context.cancelGuestApplicationOperations({ operationIds: ['OPS-C1', 'OPS-C1'], requestId: 'cancel-ok' });
assert.equal(result.success, true, '정상 운영 일정 확정 취소');
assert.equal(result.cancelled, 1, '중복 ID 제거 후 취소 수 반환');
assert.equal(tables.operationTable.rows[0][3], 'CANCELLED', '운영 일정 취소 상태 저장');
assert.equal(tables.operationSheet.writes.length, 1, '확정 취소는 단일 배치 저장');

tables = installTables(context, [
  applicationRow('APP-301', 'APPROVED'),
  applicationRow('APP-302', 'INACTIVE')
], []);
result = context.assignGuestApplicationsToWeek({
  applicationIds: ['APP-301', 'APP-302'],
  serviceWeek: '2026-09-02',
  requestId: 'assign-mixed'
});
assert.equal(result.success, false, '승인되지 않은 신청자가 섞인 운영 확정 전체 거부');
assert.equal(tables.operationSheet.writes.length, 0, '실패한 운영 확정은 시트 무변경');
tables.operationTable.rows.push(operationRow('OPS-EXISTING', 'APP-301', 'SELECTED', '2026-08-31'));
result = context.assignGuestApplicationsToWeek({
  applicationIds: ['APP-301'],
  serviceWeek: '2026-09-02',
  requestId: 'assign-duplicate'
});
assert.equal(result.success, false, '같은 신청자·같은 주차 중복 확정 차단');

const adminSource = fs.readFileSync(path.resolve(__dirname, '../js/admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.resolve(__dirname, '../admin.html'), 'utf8');
const applyHtml = fs.readFileSync(path.resolve(__dirname, '../guest-apply.html'), 'utf8');
assert(adminSource.includes("label: '이용 가능'") && adminSource.includes("label: '확인할 신청'") && adminSource.includes("label: '종료'"), '신청자 세 그룹 유지');
assert(adminHtml.includes('신청자') && adminHtml.includes('설정') && adminHtml.includes('개인정보 파기'), '신청관리 세 탭 유지');
assert(adminSource.includes('application-operation-inline-schedule') && adminSource.includes('운영 추가'), '행 안 운영 일정 추가 유지');
assert(!applyHtml.includes('name="relationDetail"') && !applyHtml.includes('name="deliveryDetail"') && !applyHtml.includes('name="message"'), '공개 신청서 선택 입력 제거 유지');

console.log('Guest application management tests passed: all checks');
