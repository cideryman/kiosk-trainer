#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function cloneValue(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(cloneValue);
  return value;
}

function equalMatrix(left, right) {
  if (left.length !== right.length) return false;
  return left.every((row, rowIndex) => row.length === right[rowIndex].length
    && row.every((value, columnIndex) => {
      const other = right[rowIndex][columnIndex];
      if (value instanceof Date || other instanceof Date) {
        return new Date(value).getTime() === new Date(other).getTime();
      }
      return value === other;
    }));
}

class FakeRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }

  getNumRows() { return this.rowCount; }
  getNumColumns() { return this.columnCount; }
  getValues() {
    const result = [];
    for (let r = 0; r < this.rowCount; r++) {
      const row = [];
      for (let c = 0; c < this.columnCount; c++) {
        row.push(cloneValue(this.sheet.values[this.row - 1 + r]?.[this.column - 1 + c] ?? ''));
      }
      result.push(row);
    }
    return result;
  }

  setValues(values) {
    this.sheet.setValueCalls += 1;
    if (this.sheet.failSetValuesCount > 0) {
      this.sheet.failSetValuesCount -= 1;
      throw new Error('강제 반복 setValues 실패');
    }
    if (this.sheet.failNextSetValues) {
      this.sheet.failNextSetValues = false;
      throw new Error('강제 setValues 실패');
    }
    if (values.length !== this.rowCount || values.some(row => row.length !== this.columnCount)) {
      throw new Error('setValues 크기 불일치');
    }
    this.sheet.ensureSize(this.row - 1 + this.rowCount, this.column - 1 + this.columnCount);
    for (let r = 0; r < this.rowCount; r++) {
      for (let c = 0; c < this.columnCount; c++) {
        this.sheet.values[this.row - 1 + r][this.column - 1 + c] = cloneValue(values[r][c]);
      }
    }
    if (this.sheet.corruptAfterNextSetValues) {
      this.sheet.corruptAfterNextSetValues = false;
      this.sheet.values[this.row - 1][this.column - 1] = '__CORRUPTED__';
    }
    return this;
  }

  copyTo(destination) {
    destination.setValues(this.getValues());
    return destination;
  }

  setNumberFormat() { return this; }
}

class FakeSheet {
  constructor(spreadsheet, name, values = [['']]) {
    this.spreadsheet = spreadsheet;
    this.name = name;
    this.values = cloneValue(values);
    this.maxRows = Math.max(this.values.length, 20);
    this.maxColumns = Math.max(...this.values.map(row => row.length), 1, 26);
    this.setValueCalls = 0;
    this.failNextSetValues = false;
    this.failSetValuesCount = 0;
    this.corruptAfterNextSetValues = false;
    this.failDeleteRows = false;
    this.frozenRows = 0;
    this.frozenColumns = 0;
    this.ensureSize(this.maxRows, this.maxColumns);
  }

  ensureSize(rows, columns) {
    this.maxRows = Math.max(this.maxRows, rows);
    this.maxColumns = Math.max(this.maxColumns, columns);
    while (this.values.length < this.maxRows) this.values.push([]);
    this.values.forEach(row => { while (row.length < this.maxColumns) row.push(''); });
  }

  getName() { return this.name; }
  setName(name) {
    this.spreadsheet.sheets.delete(this.name);
    this.name = name;
    this.spreadsheet.sheets.set(name, this);
    return this;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxColumns; }
  getFrozenRows() { return this.frozenRows; }
  getFrozenColumns() { return this.frozenColumns; }
  setFrozenRows(value) { this.frozenRows = value; return this; }
  setFrozenColumns(value) { this.frozenColumns = value; return this; }
  insertRowsAfter(after, count) { this.ensureSize(after + count, this.maxColumns); return this; }
  insertColumnsAfter(after, count) { this.ensureSize(this.maxRows, after + count); return this; }
  getLastRow() {
    for (let r = this.values.length - 1; r >= 0; r--) {
      if (this.values[r].some(value => value !== '')) return r + 1;
    }
    return 0;
  }
  getLastColumn() {
    let last = 0;
    this.values.forEach(row => row.forEach((value, index) => { if (value !== '') last = Math.max(last, index + 1); }));
    return last;
  }
  getDataRange() {
    return new FakeRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }
  getRange(row, column, rowCount, columnCount) { return new FakeRange(this, row, column, rowCount, columnCount); }
  clearContents() {
    this.values.forEach(row => row.fill(''));
    return this;
  }
  clear() { return this.clearContents(); }
  copyTo(spreadsheet) {
    return spreadsheet.addSheet(`Copy of ${this.name}`, this.getDataRange().getValues());
  }
  deleteRows(start, count) {
    if (this.failDeleteRows) {
      this.failDeleteRows = false;
      throw new Error('강제 deleteRows 실패');
    }
    this.values.splice(start - 1, count);
    this.maxRows -= count;
    return this;
  }
}

class FakeSpreadsheet {
  constructor() {
    this.sheets = new Map();
    this.failDeletePrefix = '';
  }
  addSheet(name, values) {
    const sheet = new FakeSheet(this, name, values);
    this.sheets.set(name, sheet);
    return sheet;
  }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) { return this.addSheet(name, [['']]); }
  deleteSheet(sheet) {
    if (this.failDeletePrefix && sheet.getName().startsWith(this.failDeletePrefix)) {
      throw new Error('강제 deleteSheet 실패');
    }
    this.sheets.delete(sheet.getName());
  }
}

function makeContext(spreadsheet) {
  const cache = new Map();
  const context = {
    console,
    Date,
    Math,
    Number,
    String,
    Boolean,
    RegExp,
    Set,
    Map,
    JSON,
    Object,
    Array,
    isNaN,
    Utilities: {
      formatDate: date => date.toISOString().replace(/[-:T]/g, '').slice(0, 15).replace('.', '')
    },
    Session: { getScriptTimeZone: () => 'Asia/Seoul' },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      flush: () => {},
      CopyPasteType: { PASTE_NORMAL: 'PASTE_NORMAL' }
    },
    LockService: {
      getScriptLock: () => ({ waitLock: () => {}, tryLock: () => true, releaseLock: () => {} })
    },
    CacheService: {
      getScriptCache: () => ({
        get: key => cache.get(key) || null,
        put: (key, value) => cache.set(key, value),
        remove: key => cache.delete(key)
      })
    },
    SHEET: { GUEST_APPLICATIONS: '이용신청', ORDERS: '주문내역', ARCHIVE: '주문보관' },
    safeAppendAdminLog: () => {},
    clearGuestApplicationSettingsCache: () => {},
    clearOrderReadCache: () => {}
  };
  vm.createContext(context);
  for (const relativePath of ['gas/02_SheetSafety.gs', 'gas/12_GuestApplications.gs', 'gas/14_GuestApplicationOperations.gs', 'gas/40_Orders.gs']) {
    const source = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
  }
  context.safeAppendAdminLog = () => {};
  context.clearGuestApplicationSettingsCache = () => {};
  context.clearOrderReadCache = () => {};
  return context;
}

function guestRow(headers, overrides) {
  const base = {
    createdAt: new Date('2026-01-01T00:00:00Z'), applicationId: '', requestId: 'REQ', name: '이름',
    relationType: '관계', relationDetail: '상세', phone: '010-0000-0000', deliveryPlace: '장소',
    deliveryDetail: '상세장소', preferredDays: '수요일', message: '메시지', consentAt: new Date('2026-01-01T00:00:00Z'),
    status: 'WAITLIST', contactedAt: '', reviewedAt: '', retentionUntil: '', anonymizedAt: '', adminMemo: '메모',
    waitlistPosition: '', skipUntil: '', cooldownUntil: '', updatedAt: new Date('2026-01-01T00:00:00Z')
  };
  const value = { ...base, ...overrides };
  return headers.map(header => cloneValue(value[header] ?? ''));
}

function runGuestSafetyTests() {
  const spreadsheet = new FakeSpreadsheet();
  const context = makeContext(spreadsheet);
  const headers = vm.runInContext('GUEST_APPLICATION_HEADERS.slice()', context);
  const expired = new Date('2025-01-01T00:00:00Z');
  const future = new Date('2099-01-01T00:00:00Z');
  const values = [headers,
    guestRow(headers, { applicationId: 'A1', name: '삭제1', retentionUntil: expired, waitlistPosition: 1 }),
    guestRow(headers, { applicationId: 'A2', name: '보존', phone: '010-2222-2222', status: 'APPROVED', retentionUntil: future }),
    guestRow(headers, { applicationId: 'A3', name: '삭제3', status: 'REJECTED', retentionUntil: expired }),
    guestRow(headers, { applicationId: 'A4', name: '대기', retentionUntil: future, waitlistPosition: 4 })
  ];
  const sheet = spreadsheet.addSheet('이용신청', values);
  const result = context.anonymizeExpiredGuestApplications({ confirmText: '신청정보정리', requestId: 'anon-success' });
  assert.equal(result.success, true, '익명화 성공');
  assert.equal(result.count, 2, '비연속 만료 행 2건 처리');
  assert.equal(result.verified, true, '익명화 결과 검증');
  assert.equal(result.backupSheetName, '', '성공한 개인정보 임시 백업 삭제');
  const actual = sheet.getRange(1, 1, 5, headers.length).getValues();
  const id = headers.indexOf('applicationId');
  const name = headers.indexOf('name');
  const phone = headers.indexOf('phone');
  const waitlist = headers.indexOf('waitlistPosition');
  assert.equal(actual[1][id], 'A1');
  assert.equal(actual[1][name], '');
  assert.equal(actual[2][name], '보존', '중간 비대상 행 보존');
  assert.equal(actual[2][phone], '010-2222-2222', '중간 개인정보 덮어쓰기 없음');
  assert.equal(actual[3][id], 'A3');
  assert.equal(actual[3][name], '');
  assert.equal(actual[4][waitlist], 1, '익명화 제외 대기 순번 재계산 저장');

  const beforeFailure = sheet.getRange(1, 1, 5, headers.length).getValues();
  sheet.getRange(2, headers.indexOf('retentionUntil') + 1, 1, 1).setValues([[expired]]);
  sheet.getRange(2, headers.indexOf('anonymizedAt') + 1, 1, 1).setValues([['']]);
  sheet.getRange(2, name + 1, 1, 1).setValues([['재시도']]);
  const failureSnapshot = sheet.getRange(1, 1, 5, headers.length).getValues();
  sheet.failNextSetValues = true;
  const failed = context.anonymizeExpiredGuestApplications({ confirmText: '신청정보정리', requestId: 'anon-write-fail' });
  assert.equal(failed.success, false, '익명화 쓰기 실패 반환');
  assert.equal(failed.rolledBack, true, '익명화 쓰기 실패 자동 복구');
  assert(equalMatrix(sheet.getRange(1, 1, 5, headers.length).getValues(), failureSnapshot), '익명화 원본 복구');

  sheet.corruptAfterNextSetValues = true;
  const verificationFailed = context.anonymizeExpiredGuestApplications({ confirmText: '신청정보정리', requestId: 'anon-verify-fail' });
  assert.equal(verificationFailed.success, false, '익명화 검증 실패 반환');
  assert.equal(verificationFailed.rolledBack, true, '익명화 검증 실패 자동 복구');
  assert(equalMatrix(sheet.getRange(1, 1, 5, headers.length).getValues(), failureSnapshot), '검증 실패 후 원본 복구');

  spreadsheet.failDeletePrefix = '이용신청_임시백업_';
  const cleanup = context.anonymizeExpiredGuestApplications({ confirmText: '신청정보정리', requestId: 'anon-cleanup-fail' });
  assert.equal(cleanup.success, true, '백업 삭제 실패여도 익명화 결과는 성공');
  assert.equal(cleanup.cleanupRequired, true, '개인정보 백업 수동 삭제 경고');
  assert(spreadsheet.getSheetByName(cleanup.backupSheetName), '삭제 실패 임시 백업 보존');
  spreadsheet.failDeletePrefix = '';
  assert(beforeFailure.length === 5);

  const mutationSpreadsheet = new FakeSpreadsheet();
  const mutationContext = makeContext(mutationSpreadsheet);
  const mutationRows = [headers,
    guestRow(headers, { applicationId: 'M1', status: 'WAITLIST', waitlistPosition: 1, retentionUntil: future }),
    guestRow(headers, { applicationId: 'M2', status: 'WAITLIST', waitlistPosition: 9, retentionUntil: future }),
    guestRow(headers, { applicationId: 'M3', status: 'APPROVED', name: '건너뛸 사람', retentionUntil: future })
  ];
  const mutationSheet = mutationSpreadsheet.addSheet('이용신청', mutationRows);
  const updated = mutationContext.updateGuestApplication({ applicationId: 'M1', status: 'APPROVED', requestId: 'update-safe' });
  assert.equal(updated.success, true, '신청 상태 수정 성공');
  let mutationValues = mutationSheet.getRange(1, 1, 4, headers.length).getValues();
  assert.equal(mutationValues[2][waitlist], 1, '상태 수정 후 다른 실제 행의 대기 순번 저장');
  assert.equal(mutationValues[3][name], '건너뛸 사람', '비연속 변경 사이 행 보존');
  const skipped = mutationContext.skipGuestApplicationWeek({ applicationId: 'M3', requestId: 'skip-safe' });
  assert.equal(skipped.success, true, '이번 주 건너뛰기 성공');
  mutationValues = mutationSheet.getRange(1, 1, 4, headers.length).getValues();
  assert.equal(mutationValues[2][waitlist], 1, '기존 대기 순번 유지');
  assert.equal(mutationValues[3][waitlist], 2, '건너뛴 신청의 실제 행 순번 저장');
  const guestSource = fs.readFileSync(path.resolve(__dirname, '../gas/12_GuestApplications.gs'), 'utf8');
  assert(/Legacy automatic rotation[\s\S]*writeChangedSheetRows_/.test(guestSource), '레거시 주간 순환도 정확한 행 쓰기 사용');

  const recoverySpreadsheet = new FakeSpreadsheet();
  const recoveryContext = makeContext(recoverySpreadsheet);
  const recoverySheet = recoverySpreadsheet.addSheet('이용신청', [headers,
    guestRow(headers, { applicationId: 'R1', name: '복구대상', retentionUntil: expired, waitlistPosition: 1 })
  ]);
  recoverySheet.failSetValuesCount = 2;
  const recoveryFailed = recoveryContext.anonymizeExpiredGuestApplications({ confirmText: '신청정보정리', requestId: 'anon-recovery-fail' });
  assert.equal(recoveryFailed.success, false, '익명화 복구 실패 반환');
  assert.equal(recoveryFailed.recoveryRequired, true, '익명화 수동 복구 필요 표시');
  assert(recoverySpreadsheet.getSheetByName(recoveryFailed.backupSheetName), '복구 실패 개인정보 백업 보존');
}

function orderHeaders() {
  return ['주문시간', '주문번호', '간식ID', ...Array.from({ length: 20 }, (_, index) => `열${index + 4}`), 'commitStatus'];
}

function orderRow(header, timestamp, orderNo, snackId, marker) {
  return header.map((name, index) => {
    if (name === '주문시간') return timestamp;
    if (name === '주문번호') return orderNo;
    if (name === '간식ID') return snackId;
    return index === 3 ? marker : '';
  });
}

function runOrderSafetyTests() {
  const spreadsheet = new FakeSpreadsheet();
  const context = makeContext(spreadsheet);
  const header = orderHeaders();
  const archiveHeader = header.slice(0, 23);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const existingOld = orderRow(archiveHeader, new Date(today.getTime() - 48 * 60 * 60 * 1000), 'OLD-0', 'S0', '기존');
  const oldOrder = orderRow(header, yesterday, 'OLD-1', 'S1', '이동');
  const todayOrder = orderRow(header, today, 'TODAY-1', 'S2', '보존');
  const orderSheet = spreadsheet.addSheet('주문내역', [header, oldOrder, todayOrder]);
  spreadsheet.addSheet('주문보관', [archiveHeader, existingOld]);

  const audit = context.auditArchiveOldOrders();
  assert.equal(audit.summary.safeToRun, true, '23열 보관 시트 호환 점검');
  assert.equal(audit.summary.requiredHeadersPresent, true);
  const result = context.archiveOldOrders({ archiveConfirm: '주문보관확인', adminMemo: '' });
  assert.equal(result.success, true, '주문 보관 성공');
  assert.equal(result.verified, true, '주문 보관 양쪽 검증');
  assert.equal(result.movedCount, 1);
  assert(spreadsheet.getSheetByName(result.orderBackupSheetName), '주문내역 백업 영구 보관');
  assert(spreadsheet.getSheetByName(result.archiveBackupSheetName), '주문보관 백업 영구 보관');
  const remaining = orderSheet.getDataRange().getValues();
  assert.equal(remaining.length, 2, '헤더와 오늘 주문만 유지');
  assert.equal(remaining[1][1], 'TODAY-1', '오늘 주문 보존');
  const archived = spreadsheet.getSheetByName('주문보관').getDataRange().getValues();
  assert.equal(archived[0].length, 23, '기존 23열 보관 계약 유지');
  assert.equal(archived.length, 3, '기존 주문과 이동 주문 보관');

  const duplicateSpreadsheet = new FakeSpreadsheet();
  const duplicateContext = makeContext(duplicateSpreadsheet);
  duplicateSpreadsheet.addSheet('주문내역', [header, oldOrder, oldOrder]);
  duplicateSpreadsheet.addSheet('주문보관', [archiveHeader]);
  assert.equal(duplicateContext.auditArchiveOldOrders().summary.safeToRun, false, '주문내역 중복 차단');
  assert.equal(duplicateContext.auditArchiveOldOrders().summary.duplicateOrderKeys, 1);
  const keyless = orderRow(header, yesterday, '', 'S1', '키없음');
  duplicateSpreadsheet.getSheetByName('주문내역').values = cloneValue([header, keyless]);
  assert.equal(duplicateContext.auditArchiveOldOrders().summary.safeToRun, false, '키 없는 주문 차단');

  const mismatchSpreadsheet = new FakeSpreadsheet();
  const mismatchContext = makeContext(mismatchSpreadsheet);
  mismatchSpreadsheet.addSheet('주문내역', [header, oldOrder]);
  mismatchSpreadsheet.addSheet('주문보관', [['주문번호', '주문시간', '간식ID']]);
  assert.equal(mismatchContext.auditArchiveOldOrders().summary.safeToRun, false, '호환되지 않는 보관 헤더 차단');

  const failureSpreadsheet = new FakeSpreadsheet();
  const failureContext = makeContext(failureSpreadsheet);
  const failureOrders = [header, oldOrder, todayOrder];
  const failureArchive = [archiveHeader, existingOld];
  const failureOrderSheet = failureSpreadsheet.addSheet('주문내역', failureOrders);
  const failureArchiveSheet = failureSpreadsheet.addSheet('주문보관', failureArchive);
  failureOrderSheet.failDeleteRows = true;
  const failed = failureContext.archiveOldOrders({ archiveConfirm: '주문보관확인' });
  assert.equal(failed.success, false, '행 삭제 실패 반환');
  assert.equal(failed.rolledBack, true, '주문 양쪽 자동 복구');
  assert(equalMatrix(failureOrderSheet.getRange(1, 1, failureOrders.length, header.length).getValues(), failureOrders), '주문내역 원본 복구');
  assert(equalMatrix(failureArchiveSheet.getRange(1, 1, failureArchive.length, archiveHeader.length).getValues(), failureArchive), '주문보관 원본 복구');

  const archiveFailureSpreadsheet = new FakeSpreadsheet();
  const archiveFailureContext = makeContext(archiveFailureSpreadsheet);
  const archiveFailureOrders = archiveFailureSpreadsheet.addSheet('주문내역', failureOrders);
  const archiveFailureTarget = archiveFailureSpreadsheet.addSheet('주문보관', failureArchive);
  archiveFailureTarget.corruptAfterNextSetValues = true;
  const archiveVerificationFailed = archiveFailureContext.archiveOldOrders({ archiveConfirm: '주문보관확인' });
  assert.equal(archiveVerificationFailed.success, false, '보관 시트 검증 실패 반환');
  assert.equal(archiveVerificationFailed.rolledBack, true, '보관 시트 검증 실패 자동 복구');
  assert(equalMatrix(archiveFailureOrders.getRange(1, 1, failureOrders.length, header.length).getValues(), failureOrders));
  assert(equalMatrix(archiveFailureTarget.getRange(1, 1, failureArchive.length, archiveHeader.length).getValues(), failureArchive));

  const recoveryFailureSpreadsheet = new FakeSpreadsheet();
  const recoveryFailureContext = makeContext(recoveryFailureSpreadsheet);
  const recoveryFailureOrders = recoveryFailureSpreadsheet.addSheet('주문내역', failureOrders);
  recoveryFailureSpreadsheet.addSheet('주문보관', failureArchive);
  recoveryFailureOrders.failDeleteRows = true;
  recoveryFailureOrders.failSetValuesCount = 1;
  const orderRecoveryFailed = recoveryFailureContext.archiveOldOrders({ archiveConfirm: '주문보관확인' });
  assert.equal(orderRecoveryFailed.success, false, '주문 복구 실패 반환');
  assert.equal(orderRecoveryFailed.recoveryRequired, true, '주문 수동 복구 필요 표시');
  assert(recoveryFailureSpreadsheet.getSheetByName(orderRecoveryFailed.orderBackupSheetName), '주문 복구 실패 백업 보존');

  const newArchiveSpreadsheet = new FakeSpreadsheet();
  const newArchiveContext = makeContext(newArchiveSpreadsheet);
  newArchiveSpreadsheet.addSheet('주문내역', [header, oldOrder, todayOrder]);
  const created = newArchiveContext.archiveOldOrders({ archiveConfirm: '주문보관확인' });
  assert.equal(created.success, true, '신규 주문보관 시트 생성');
  assert.equal(created.archiveCreated, true);
}

runGuestSafetyTests();
runOrderSafetyTests();
console.log('P104 data safety tests passed.');
