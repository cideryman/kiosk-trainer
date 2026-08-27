const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const ORDER_HEADERS = [
  '주문시간', '주문번호', '이용자ID', '별명', '간식ID', '간식명', '수량',
  '차감포인트', '제공여부', 'cancelTimestamp', 'orderToken', 'deliveryType',
  'deliveryFee', 'totalCredit', 'reviewed', 'deliveryPlace', 'cancelReason',
  'cancelReasonDetail', 'guestDeviceId', 'authProvider', 'guestKey', '',
  'idempotencyKey', 'commitStatus'
];

function orderRow({ orderNo = 'ORDER-1', userId = 'guest', token = 'TOKEN-ONE', status = 'Y', snackId = 1 } = {}) {
  return [
    new Date('2026-08-27T03:00:00Z'), orderNo, userId, '손님', snackId, '쿠키', 1,
    2, status, '', token, 'pickup', 0, 2, false, '', '', '', 'device-1', '', '', '',
    'order-idempotency-1', 'COMMITTED'
  ];
}

class Sheet {
  constructor(name, values) {
    this.name = name;
    this.values = values;
  }
  getName() { return this.name; }
  getLastRow() { return this.values.length; }
  getLastColumn() { return Math.max(...this.values.map(row => row.length)); }
  getDataRange() { return { getValues: () => this.values.map(row => row.slice()) }; }
  getRange(row, column, rows = 1, columns = 1) {
    return {
      getValues: () => Array.from({ length: rows }, (_, r) =>
        Array.from({ length: columns }, (_, c) => this.values[row - 1 + r]?.[column - 1 + c] ?? '')
      )
    };
  }
}

function makeOrderContext(rows) {
  const sheets = {
    주문내역: new Sheet('주문내역', [ORDER_HEADERS, ...rows]),
    주문보관: new Sheet('주문보관', [ORDER_HEADERS])
  };
  let lockCalls = 0;
  const spreadsheet = { getSheetByName: name => sheets[name] || null };
  const context = {
    console,
    Date,
    JSON,
    Math,
    isFinite,
    SHEET: { ORDERS: '주문내역', ARCHIVE: '주문보관' },
    SpreadsheetApp: { getActive: () => spreadsheet, getActiveSpreadsheet: () => spreadsheet },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => { lockCalls++; return true; }, releaseLock: () => {} }) },
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'Asia/Seoul' },
    Utilities: { getUuid: () => '00000000-0000-4000-8000-000000000001' },
    createPublicApiError: (message, code) => Object.assign(new Error(message), { publicApiError: true, publicCode: code }),
    getSafeApiErrorResponse: (_action, error) => ({ success: false, message: error.message, errorCode: error.publicCode || 'INTERNAL_ERROR' })
  };
  vm.createContext(context);
  vm.runInContext(read('gas/31_OrderShared.gs'), context);
  vm.runInContext(`${read('gas/40_Orders.gs')}\nthis.securityApi = { verifyOrderOwnership_, getOrderStatus, placeOrder };`, context);
  return { api: context.securityApi, getLockCalls: () => lockCalls };
}

{
  const { api } = makeOrderContext([orderRow(), orderRow({ snackId: 2 })]);
  assert.strictEqual(api.verifyOrderOwnership_({ orderId: 'ORDER-1', orderToken: 'TOKEN-ONE' }, { requireGuest: true }).success, true);
  assert.strictEqual(api.verifyOrderOwnership_({ orderId: 'ORDER-1', orderToken: 'WRONG' }, { requireGuest: true }).success, false);
  assert.strictEqual(api.verifyOrderOwnership_({ orderId: 'ORDER-1', orderToken: '' }, { requireGuest: true }).success, false);
  assert.strictEqual(api.getOrderStatus({ orderToken: 'TOKEN-ONE' }).success, true);
  assert.strictEqual(api.getOrderStatus({ orderNo: 'ORDER-1' }).success, false);
}

{
  const { api } = makeOrderContext([orderRow(), orderRow({ token: 'TOKEN-TWO', snackId: 2 })]);
  assert.strictEqual(api.verifyOrderOwnership_({ orderId: 'ORDER-1', orderToken: 'TOKEN-ONE' }, { requireGuest: true }).success, false);
  assert.strictEqual(api.getOrderStatus({ orderToken: 'TOKEN-ONE' }).success, false);
}

{
  const { api } = makeOrderContext([orderRow({ userId: 'USER-1' })]);
  assert.strictEqual(api.verifyOrderOwnership_({ orderId: 'ORDER-1', orderToken: 'TOKEN-ONE' }, { requireGuest: true }).success, false);
}

{
  const { api, getLockCalls } = makeOrderContext([orderRow()]);
  const missing = api.placeOrder({ userId: 'guest', items: [{ snackId: 1, quantity: 1 }] });
  const malformed = api.placeOrder({ userId: 'guest', items: [{ snackId: 1, quantity: 1 }], idempotencyKey: 'bad key' });
  assert.strictEqual(missing.success, false);
  assert.strictEqual(malformed.success, false);
  assert.strictEqual(getLockCalls(), 0, 'invalid idempotency keys must fail before acquiring the order lock');
}

{
  const context = { console, Array, String };
  vm.createContext(context);
  vm.runInContext(`${read('gas/60_Settings.gs')}\nthis.sanitizeEvent = sanitizeGuestEventNameHtml_;`, context);
  const sanitize = context.sanitizeEvent;
  const allowed = sanitize('<b><font color="#E11D48">안전 행사</font></b>');
  assert.strictEqual(allowed.success, true);
  assert.match(allowed.html, /<strong>/);
  assert.match(allowed.html, /#E11D48/);
  const hostile = sanitize('<img src=x onerror=alert(1)><span style="color:#000000" onclick="x">안전</span><script>alert(1)</script>');
  assert.strictEqual(hostile.success, true);
  assert.doesNotMatch(hostile.html, /script|onerror|onclick|#000000|<img/i);
  assert.doesNotMatch(sanitize('&lt;script&gt;안전&lt;/script&gt;').html, /<script>/i);
  assert.strictEqual(sanitize('가'.repeat(21)).success, false);
}

{
  const context = {
    console,
    ADMIN_MAX_SNACK_STOCK: 30,
    ADMIN_MAX_SNACK_POINT: 15,
    ADMIN_MAX_SNACK_PER_PERSON: 30
  };
  vm.createContext(context);
  vm.runInContext(`${read('gas/21_Snacks.gs')}\nthis.parseSnackInteger = parseSnackInteger_; this.parseMax = parseMaxPerPerson;`, context);
  assert.strictEqual(context.parseSnackInteger('1', 1, 15), 1);
  assert.strictEqual(context.parseSnackInteger('15', 1, 15), 15);
  assert.strictEqual(context.parseSnackInteger('1.5', 1, 15), null);
  assert.strictEqual(context.parseSnackInteger('16', 1, 15), null);
  assert.strictEqual(context.parseMax('30'), 30);
  assert.strictEqual(context.parseMax('31'), null);
}

const configSource = read('gas/00_Config.gs');
const routerSource = read('gas/01_Router.gs');
const reviewSource = read('gas/70_Reviews.gs');
const mediaSource = read('gas/50_Media.gs');
const mockSource = read('js/config.js');
assert.match(configSource, /'ensureOrderHeaders'/);
assert.match(configSource, /errorCode:\s*'INTERNAL_ERROR'/);
assert.doesNotMatch(routerSource, /ALLOW_LEGACY_ADMIN_GET|isLegacyAdminGetEnabled/);
assert.match(routerSource, /getOrdersToday[\s\S]*getPublicOrderFeed\(\)/);
assert.doesNotMatch(reviewSource, /function submitReview\(data\) \{\s*ensureOrderHeaders\(\)/);
assert.match(reviewSource, /verifyOrderOwnership_/);
assert.match(mediaSource, /requireOrderId:\s*true/);
assert.match(mediaSource, /requireGuest:\s*true/);
assert.match(mockSource, /const API_CONTRACT_VERSION = '2026-08-28\.1'/);
assert.match(mockSource, /getMockOrderOwnership/);
assert.match(mockSource, /sanitizeMockGuestEventName/);

console.log('API input security tests passed: ownership, idempotency, admin boundary, numeric ranges, event HTML, public errors');
