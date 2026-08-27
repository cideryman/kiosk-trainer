const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const ORDER_HEADERS = [
  '주문시간', '주문번호', '이용자ID', '별명', '간식ID', '간식명', '수량',
  '차감포인트', '제공여부', 'cancelTimestamp', 'orderToken', 'deliveryType',
  'deliveryFee', 'totalCredit', 'reviewed', 'deliveryAddress', 'cancelReason',
  'cancelReasonDetail', 'guestDeviceId', 'authProvider', 'guestKey', '',
  'idempotencyKey', 'commitStatus'
];
const SNACK_HEADERS = ['간식ID', '간식명', '포인트', '이미지', '판매여부', '재고', '대상', '정렬', '1인제한'];
const CREDIT_HEADERS = [
  'periodKey', 'guestDeviceId', 'guestKey', 'baseCredit', 'bonusCredit',
  'creditLimit', 'usedCredit', 'remainingCredit', 'updatedAt'
];

function clone(value) {
  return value.map(row => row.map(cell => cell instanceof Date ? new Date(cell.getTime()) : cell));
}

function isFilled(value) {
  return value !== '' && value !== null && value !== undefined;
}

class FakeRange {
  constructor(sheet, row, column, numRows, numColumns) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.numRows = numRows;
    this.numColumns = numColumns;
  }

  getNumRows() { return this.numRows; }
  getNumColumns() { return this.numColumns; }

  getValues() {
    const values = [];
    for (let r = 0; r < this.numRows; r++) {
      const row = [];
      for (let c = 0; c < this.numColumns; c++) {
        row.push(this.sheet.data[this.row - 1 + r]?.[this.column - 1 + c] ?? '');
      }
      values.push(row);
    }
    return clone(values);
  }

  setValues(values) {
    if (this.sheet.failNextWrite) {
      this.sheet.failNextWrite = false;
      throw new Error('injected sheet write failure');
    }
    for (let r = 0; r < this.numRows; r++) {
      while (this.sheet.data.length < this.row + r) this.sheet.data.push([]);
      const target = this.sheet.data[this.row - 1 + r];
      for (let c = 0; c < this.numColumns; c++) {
        while (target.length < this.column + c) target.push('');
        const value = values[r][c];
        target[this.column - 1 + c] = value instanceof Date ? new Date(value.getTime()) : value;
      }
    }
    return this;
  }

  setValue(value) { return this.setValues([[value]]); }
  setNumberFormat() { return this; }
  copyTo(targetRange) { targetRange.setValues(this.getValues()); return targetRange; }
}

class FakeSheet {
  constructor(spreadsheet, name, data) {
    this.spreadsheet = spreadsheet;
    this.name = name;
    this.data = clone(data || [['']]);
    this.maxRows = Math.max(100, this.data.length);
    this.maxColumns = Math.max(26, ...this.data.map(row => row.length));
    this.frozenRows = 0;
    this.frozenColumns = 0;
    this.failNextWrite = false;
  }

  getName() { return this.name; }
  setName(name) {
    delete this.spreadsheet.sheets[this.name];
    this.name = name;
    this.spreadsheet.sheets[name] = this;
    return this;
  }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) if (this.data[i].some(isFilled)) return i + 1;
    return 0;
  }
  getLastColumn() {
    let last = 0;
    this.data.forEach(row => row.forEach((value, index) => { if (isFilled(value)) last = Math.max(last, index + 1); }));
    return last;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxColumns; }
  getDataRange() {
    return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }
  getRange(row, column, numRows = 1, numColumns = 1) { return new FakeRange(this, row, column, numRows, numColumns); }
  insertRowsAfter(_after, count) { this.maxRows += count; }
  insertColumnsAfter(_after, count) { this.maxColumns += count; }
  clear() { this.data = [['']]; return this; }
  copyTo(spreadsheet) {
    const copy = new FakeSheet(spreadsheet, `${this.name}_copy_${spreadsheet.copySequence++}`, this.getDataRange().getValues());
    spreadsheet.sheets[copy.name] = copy;
    return copy;
  }
  getFrozenRows() { return this.frozenRows; }
  getFrozenColumns() { return this.frozenColumns; }
  setFrozenRows(value) { this.frozenRows = value; return this; }
  setFrozenColumns(value) { this.frozenColumns = value; return this; }
}

class FakeSpreadsheet {
  constructor(sheetData) {
    this.sheets = {};
    this.copySequence = 1;
    this.failDelete = false;
    Object.entries(sheetData).forEach(([name, data]) => { this.sheets[name] = new FakeSheet(this, name, data); });
  }
  getSheetByName(name) { return this.sheets[name] || null; }
  deleteSheet(sheet) {
    if (this.failDelete) throw new Error('injected backup cleanup failure');
    delete this.sheets[sheet.getName()];
  }
}

function makeOrderRow({
  orderNo = 'ORD-260826-001', userId = 'guest', token = 'G-legacy-token',
  snackId = 'S1', snackName = '쿠키', quantity = 1, point = 2,
  status = 'N', totalCredit = 5
} = {}) {
  return [
    new Date('2026-08-26T03:00:00.000Z'), orderNo, userId, userId === 'guest' ? '배달손님' : '회원',
    snackId, snackName, quantity, point, status, '', token, 'pickup', 0, totalCredit,
    false, '', '', '', userId === 'guest' ? 'device-1' : '', '', '', '', 'idem-12345678', 'COMMITTED'
  ];
}

function makeEnvironment({ orders, snacks, usedCredit = 8 } = {}) {
  const scriptProperties = {};
  const spreadsheet = new FakeSpreadsheet({
    주문내역: [ORDER_HEADERS, ...(orders || [])],
    간식목록: [SNACK_HEADERS, ...(snacks || [
      ['S1', '쿠키', 2, '', 'Y', 10, 'all', 1, 0],
      ['S2', '우유', 1, '', 'Y', 4, 'all', 2, 0]
    ])],
    게스트크레딧: [CREDIT_HEADERS, ['2026-08-26', 'device-1', '', 10, 0, 10, usedCredit, 10 - usedCredit, new Date()]]
  });
  let uuidSequence = 0;
  let refundCalls = 0;
  let refundFailure = false;
  const context = {
    console,
    Date,
    APP_ENV: 'staging',
    SHEET: { ORDERS: '주문내역', SNACKS: '간식목록', GUEST_CREDITS: '게스트크레딧' },
    SpreadsheetApp: {
      getActive: () => spreadsheet,
      getActiveSpreadsheet: () => spreadsheet,
      flush: () => {}
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      formatDate: () => '20260826_120000',
      getUuid: () => `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}`
    },
    Session: { getScriptTimeZone: () => 'Asia/Seoul' },
    Logger: { log: () => {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => scriptProperties[key] || null,
      setProperty: (key, value) => { scriptProperties[key] = String(value); }
    }) },
    isCancelledOrderStatus: status => String(status || '').trim().toUpperCase() === 'C',
    clearSnackReadCache: () => {},
    clearOrderReadCache: () => {},
    clearUserReadCache: () => {},
    safeAppendAdminLog: () => {},
    getGuestCreditPeriodKey: () => '2026-08-26',
    createPublicApiError: (message, code) => Object.assign(new Error(message), { publicApiError: true, publicCode: code }),
    getSafeApiErrorResponse: (_action, error) => ({
      success: false,
      message: error.publicApiError ? error.message : '요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      errorCode: error.publicApiError ? error.publicCode : 'INTERNAL_ERROR'
    })
  };
  vm.createContext(context);
  for (const relativePath of ['gas/02_SheetSafety.gs', 'gas/03_RecoveryAlerts.gs', 'gas/31_OrderShared.gs', 'gas/40_Orders.gs']) {
    vm.runInContext(fs.readFileSync(path.join(root, relativePath), 'utf8'), context, { filename: relativePath });
  }
  context.ensureOrderHeaders = () => 'ok';
  context.ensureGuestCreditSheet = () => spreadsheet.getSheetByName('게스트크레딧');
  context.resolveGuestCreditWallet = (_data, options = {}) => {
    if (refundFailure && Number(options.refundCredit || 0) > 0) throw new Error('injected refund failure');
    const creditSheet = spreadsheet.getSheetByName('게스트크레딧');
    const row = creditSheet.getRange(2, 1, 1, CREDIT_HEADERS.length).getValues()[0];
    let used = Number(row[6] || 0);
    if (Number(options.refundCredit || 0) > 0) {
      refundCalls++;
      used = Math.max(0, used - Number(options.refundCredit));
      row[6] = used;
      row[7] = Math.max(0, Number(row[5] || 0) - used);
      row[8] = new Date();
      creditSheet.getRange(2, 1, 1, CREDIT_HEADERS.length).setValues([row]);
    }
    return { success: true, creditLimit: Number(row[5]), usedCredit: used, remainingCredit: Number(row[5]) - used };
  };
  return {
    context,
    spreadsheet,
    setRefundFailure(value) { refundFailure = value; },
    getRefundCalls() { return refundCalls; }
    , getRecoveryAlerts() { return context.getOrderRecoveryAlertsSummary_(); }
  };
}

function sheetValues(env, name) {
  return env.spreadsheet.getSheetByName(name).getDataRange().getValues();
}

function snapshot(env) {
  return JSON.stringify({
    orders: sheetValues(env, '주문내역'),
    snacks: sheetValues(env, '간식목록'),
    credits: sheetValues(env, '게스트크레딧')
  });
}

function assertNoTemporaryBackups(env) {
  assert.deepStrictEqual(
    Object.keys(env.spreadsheet.sheets).filter(name => name.includes('임시백업')),
    []
  );
}

(function testOpaqueTokens() {
  const env = makeEnvironment({ orders: [makeOrderRow()] });
  const first = env.context.createOrderSecurityToken_();
  const second = env.context.createOrderSecurityToken_();
  assert.match(first, /^O-[0-9a-f]{32}$/i);
  assert.notStrictEqual(first, second);
})();

(function testGuestMultiItemCancellationAndIdempotency() {
  const env = makeEnvironment({ orders: [
    makeOrderRow({ quantity: 1, point: 2 }),
    makeOrderRow({ quantity: 2, point: 4 }),
    makeOrderRow({ snackId: 'S2', snackName: '우유', quantity: 1, point: 1 })
  ] });
  const result = env.context.userCancelOrder({ orderId: 'ORD-260826-001', orderToken: 'G-legacy-token' });
  assert.strictEqual(result.success, true, JSON.stringify(result));
  assert.strictEqual(result.verified, true);
  assert.strictEqual(result.refundApplied, true);
  assert.strictEqual(result.restoredItemCount, 4);
  assert.strictEqual(env.getRefundCalls(), 1);
  assert.deepStrictEqual(sheetValues(env, '주문내역').slice(1).map(row => row[8]), ['C', 'C', 'C']);
  assert.strictEqual(sheetValues(env, '간식목록')[1][5], 13);
  assert.strictEqual(sheetValues(env, '간식목록')[2][5], 5);
  assert.strictEqual(sheetValues(env, '게스트크레딧')[1][6], 3);
  assertNoTemporaryBackups(env);

  const afterFirst = snapshot(env);
  const repeat = env.context.userCancelOrder({ orderId: 'ORD-260826-001', orderToken: 'G-legacy-token' });
  assert.strictEqual(repeat.success, true);
  assert.strictEqual(repeat.alreadyCancelled, true);
  assert.strictEqual(repeat.refundApplied, false);
  assert.strictEqual(repeat.restoredItemCount, 0);
  assert.strictEqual(snapshot(env), afterFirst);
  assert.strictEqual(env.getRefundCalls(), 1);
})();

(function testRegularOrderHasNoCreditRefund() {
  const env = makeEnvironment({ orders: [makeOrderRow({ userId: 'U1', token: 'O-member-token', totalCredit: 2 })] });
  const result = env.context.userCancelOrder({ orderId: 'ORD-260826-001', orderToken: 'O-member-token' });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.refundApplied, false);
  assert.strictEqual(env.getRefundCalls(), 0);
  assert.strictEqual(sheetValues(env, '게스트크레딧')[1][6], 8);
})();

(function testUnsafeRequestsDoNotWrite() {
  const cases = [
    {
      name: 'missing token',
      orders: [makeOrderRow()],
      request: { orderId: 'ORD-260826-001' }
    },
    {
      name: 'wrong token',
      orders: [makeOrderRow()],
      request: { orderId: 'ORD-260826-001', orderToken: 'wrong' }
    },
    {
      name: 'legacy member without token',
      orders: [makeOrderRow({ userId: 'U1', token: '', totalCredit: 2 })],
      request: { orderId: 'ORD-260826-001', orderToken: '' }
    },
    {
      name: 'mixed served state',
      orders: [makeOrderRow(), makeOrderRow({ snackId: 'S2', snackName: '우유', status: 'P' })],
      request: { orderId: 'ORD-260826-001', orderToken: 'G-legacy-token' }
    },
    {
      name: 'mixed token',
      orders: [makeOrderRow(), makeOrderRow({ snackId: 'S2', snackName: '우유', token: 'different' })],
      request: { orderId: 'ORD-260826-001', orderToken: 'G-legacy-token' }
    },
    {
      name: 'mixed user',
      orders: [makeOrderRow(), makeOrderRow({ userId: 'U2', snackId: 'S2', snackName: '우유' })],
      request: { orderId: 'ORD-260826-001', orderToken: 'G-legacy-token' }
    },
    {
      name: 'mixed total credit',
      orders: [makeOrderRow(), makeOrderRow({ snackId: 'S2', snackName: '우유', totalCredit: 6 })],
      request: { orderId: 'ORD-260826-001', orderToken: 'G-legacy-token' }
    },
    {
      name: 'invalid quantity',
      orders: [makeOrderRow({ quantity: 0 })],
      request: { orderId: 'ORD-260826-001', orderToken: 'G-legacy-token' }
    },
    {
      name: 'missing snack',
      orders: [makeOrderRow({ snackId: 'missing' })],
      request: { orderId: 'ORD-260826-001', orderToken: 'G-legacy-token' }
    }
  ];
  cases.forEach(testCase => {
    const env = makeEnvironment({ orders: testCase.orders });
    const before = snapshot(env);
    const result = env.context.userCancelOrder(testCase.request);
    assert.strictEqual(result.success, false, testCase.name);
    assert.strictEqual(snapshot(env), before, testCase.name);
    assertNoTemporaryBackups(env);
  });
})();

(function testAdminCanCancelStartedOrder() {
  const env = makeEnvironment({ orders: [makeOrderRow({ status: 'Y' })] });
  const result = env.context.cancelOrder({ orderId: 'ORD-260826-001', cancelReason: '관리자 확인' });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.verified, true);
  assert.strictEqual(sheetValues(env, '주문내역')[1][8], 'C');
})();

(function testAdminCanCancelLegacyTokenlessMemberOrder() {
  const env = makeEnvironment({ orders: [makeOrderRow({ userId: 'U1', token: '', status: 'P', totalCredit: 2 })] });
  const result = env.context.cancelOrder({ orderId: 'ORD-260826-001' });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.refundApplied, false);
  assert.strictEqual(sheetValues(env, '주문내역')[1][8], 'C');
})();

(function testInsufficientRecordedGuestUsageDoesNotOverRefund() {
  const env = makeEnvironment({ orders: [makeOrderRow({ totalCredit: 5 })], usedCredit: 2 });
  const before = snapshot(env);
  const result = env.context.userCancelOrder({ orderId: 'ORD-260826-001', orderToken: 'G-legacy-token' });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.refundApplied, false);
  assert.strictEqual(snapshot(env), before);
  assertNoTemporaryBackups(env);
})();

(function testEveryCancellationStageRollsBackAllSheets() {
  ['cancel-stock', 'cancel-refund', 'cancel-order', 'cancel-verification'].forEach(stage => {
    const env = makeEnvironment({ orders: [makeOrderRow(), makeOrderRow({ snackId: 'S2', snackName: '우유' })] });
    const before = snapshot(env);
    const result = env.context.userCancelOrder({
      orderId: 'ORD-260826-001',
      orderToken: 'G-legacy-token',
      __testFailStage: stage
    });
    assert.strictEqual(result.success, false, stage);
    assert.strictEqual(result.rolledBack, true, stage);
    assert.strictEqual(result.recoveryRequired, false, stage);
    assert.strictEqual(snapshot(env), before, stage);
    assertNoTemporaryBackups(env);
  });
})();

(function testRefundFailureRollsBack() {
  const env = makeEnvironment({ orders: [makeOrderRow()] });
  const before = snapshot(env);
  env.setRefundFailure(true);
  const result = env.context.userCancelOrder({ orderId: 'ORD-260826-001', orderToken: 'G-legacy-token' });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.rolledBack, true);
  assert.strictEqual(snapshot(env), before);
})();

(function testRecoveryFailureKeepsBackups() {
  const env = makeEnvironment({ orders: [makeOrderRow()] });
  env.context.restoreSheetFromBackup_ = () => { throw new Error('injected restore failure'); };
  const result = env.context.userCancelOrder({
    orderId: 'ORD-260826-001', orderToken: 'G-legacy-token', __testFailStage: 'cancel-stock'
  });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.recoveryRequired, true);
  assert.strictEqual(result.cleanupRequired, true);
  assert.strictEqual(result.backupSheetNames.length, 3);
  result.backupSheetNames.forEach(name => assert.ok(env.spreadsheet.getSheetByName(name)));
  assert.strictEqual(env.getRecoveryAlerts().openCount, 1, '복구 실패 경고 영구 기록');
})();

(function testCleanupFailureReportsBackupNames() {
  const env = makeEnvironment({ orders: [makeOrderRow()] });
  env.spreadsheet.failDelete = true;
  const result = env.context.userCancelOrder({ orderId: 'ORD-260826-001', orderToken: 'G-legacy-token' });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.verified, true);
  assert.strictEqual(result.cleanupRequired, true);
  assert.strictEqual(result.backupSheetNames.length, 3);
  assert.strictEqual(env.getRecoveryAlerts().openCount, 1, '백업 삭제 실패 경고 영구 기록');
})();

(function testRollbackCleanupFailureKeepsRecoveredBackups() {
  const env = makeEnvironment({ orders: [makeOrderRow()] });
  const before = snapshot(env);
  env.spreadsheet.failDelete = true;
  const result = env.context.userCancelOrder({
    orderId: 'ORD-260826-001', orderToken: 'G-legacy-token', __testFailStage: 'cancel-order'
  });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.rolledBack, true);
  assert.strictEqual(result.recoveryRequired, false);
  assert.strictEqual(result.cleanupRequired, true);
  assert.strictEqual(result.backupSheetNames.length, 3);
  assert.strictEqual(snapshot(env), before);
})();

(function testServedStatusIsAllOrNothing() {
  const env = makeEnvironment({ orders: [makeOrderRow(), makeOrderRow({ snackId: 'S2', snackName: '우유' })] });
  const success = env.context.updateOrderServed({ orderId: 'ORD-260826-001', servedYn: 'P' });
  assert.strictEqual(success.success, true);
  assert.strictEqual(success.verified, true);
  assert.deepStrictEqual(sheetValues(env, '주문내역').slice(1).map(row => row[8]), ['P', 'P']);

  const beforeFailure = snapshot(env);
  const failure = env.context.updateOrderServed({
    orderId: 'ORD-260826-001', servedYn: 'Y', __testFailStage: 'served-write'
  });
  assert.strictEqual(failure.success, false);
  assert.strictEqual(failure.rolledBack, true);
  assert.strictEqual(snapshot(env), beforeFailure);
})();

console.log('Order cancellation safety tests passed.');
