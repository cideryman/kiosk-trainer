const assert = require('assert');

// Mock window and browser environment
global.window = {
  ...global,
  addEventListener: () => {}
};
global.localStorage = {
  getItem: () => '',
  setItem: () => '',
  removeItem: () => ''
};
global.AdminAuth = {
  storageKey: 'test_admin_token',
  isUnlocked: () => true,
  requireToken: () => 'test_token',
  focus: () => {}
};
global.API_DIAGNOSTICS = {
  createFlow: () => ({ id: 'test', addStep: () => {}, markSuccess: () => {}, markError: () => {} }),
  finishFlow: () => {}
};
const makeMockEl = () => ({
  style: {},
  textContent: '',
  innerHTML: '',
  value: '',
  classList: { toggle: () => {} },
  appendChild: () => {},
  querySelectorAll: () => [],
  addEventListener: () => {}
});

global.document = {
  getElementById: () => makeMockEl(),
  querySelectorAll: () => [],
  createElement: () => makeMockEl()
};
global.fetchAPIReadWithRetry = async () => ({
  success: true,
  orders: { success: true, orders: [] },
  users: { success: true, users: [] }
});
global.AppState = {
  vibrate: () => {},
  playClickSound: () => {},
  escapeHtml: (s) => String(s || ''),
  escapeAttr: (s) => String(s || '')
};
global.withAdminToken = (obj) => obj;
global.clearAdminTokenIfDenied = () => {};
global.ADMIN_WRITE_TIMEOUT_MS = 10000;

// Load module functions
const { getColumnStepInfo } = require('../js/kitchen.js');

console.log('--- [Test 1] getColumnStepInfo 단계 계산 검증 ---');

// 1. 빈 목록 검증
const emptyRes = getColumnStepInfo('kiosk', []);
assert.strictEqual(emptyRes.targetStatus, null);
assert.strictEqual(emptyRes.count, 0);
assert.strictEqual(emptyRes.label, '진행할 주문 없음');
console.log('✓ Test 1-1: 빈 목록 시 진행할 주문 없음 통과');

// 2. 전체 접수중('N') 주문
const allN = [
  { orderNo: 'ORD-1', servedYn: 'N' },
  { orderNo: 'ORD-2', servedYn: 'N' },
  { orderNo: 'ORD-3', servedYn: '' }
];
const resN = getColumnStepInfo('kiosk', allN);
assert.strictEqual(resN.targetStatus, 'P');
assert.strictEqual(resN.count, 3);
assert.strictEqual(resN.label, '☕ 모두 준비시작');
assert.deepStrictEqual(resN.targetOrderNos, ['ORD-1', 'ORD-2', 'ORD-3']);
console.log('✓ Test 1-2: 접수중(N) 주문 준비시작(P) 단계 전환 계산 통과');

// 3. 접수중('N') + 준비중('P') 혼합 상태 -> 가장 앞선 단계(N -> P) 우선 승급
const mixedNP = [
  { orderNo: 'ORD-1', servedYn: 'P' },
  { orderNo: 'ORD-2', servedYn: 'N' },
  { orderNo: 'ORD-3', servedYn: 'P' }
];
const resMixedNP = getColumnStepInfo('kiosk', mixedNP);
assert.strictEqual(resMixedNP.targetStatus, 'P');
assert.strictEqual(resMixedNP.count, 1);
assert.deepStrictEqual(resMixedNP.targetOrderNos, ['ORD-2']);
console.log('✓ Test 1-3: 혼합 상태에서 미시작 주문 우선 일괄 준비시작 계산 통과');

// 4. 전체 준비중('P') 주문 -> 키오스크/포장: 🔔 모두 준비완료, 배달: 🛵 모두 배달출발
const allP = [
  { orderNo: 'ORD-1', servedYn: 'P' },
  { orderNo: 'ORD-2', servedYn: 'P' }
];
const resKioskP = getColumnStepInfo('kiosk', allP);
assert.strictEqual(resKioskP.targetStatus, 'R');
assert.strictEqual(resKioskP.count, 2);
assert.strictEqual(resKioskP.label, '🔔 모두 준비완료');

const resDelivP = getColumnStepInfo('delivery', allP);
assert.strictEqual(resDelivP.targetStatus, 'R');
assert.strictEqual(resDelivP.count, 2);
assert.strictEqual(resDelivP.label, '🛵 모두 배달출발');
console.log('✓ Test 1-4: 준비중(P) 주문 준비완료/배달출발(R) 단계 전환 계산 통과');

// 5. 전체 준비완료/배달출발('R') 주문 -> 키오스크/포장: 📦 모두 수령완료, 배달: 📦 모두 배달완료
const allR = [
  { orderNo: 'ORD-1', servedYn: 'R' }
];
const resKioskR = getColumnStepInfo('kiosk', allR);
assert.strictEqual(resKioskR.targetStatus, 'Y');
assert.strictEqual(resKioskR.count, 1);
assert.strictEqual(resKioskR.label, '📦 모두 수령완료');

const resDelivR = getColumnStepInfo('delivery', allR);
assert.strictEqual(resDelivR.targetStatus, 'Y');
assert.strictEqual(resDelivR.count, 1);
assert.strictEqual(resDelivR.label, '📦 모두 배달완료');
console.log('✓ Test 1-5: 준비완료(R) 주문 수령완료/배달완료(Y) 단계 전환 계산 통과');

// 6. 이미 완료(Y)되거나 취소(C)된 주문 필터링
const completedAndCanceled = [
  { orderNo: 'ORD-1', servedYn: 'Y' },
  { orderNo: 'ORD-2', servedYn: 'C' }
];
const resDone = getColumnStepInfo('kiosk', completedAndCanceled);
assert.strictEqual(resDone.targetStatus, null);
assert.strictEqual(resDone.count, 0);
assert.strictEqual(resDone.label, '진행할 주문 없음');
console.log('✓ Test 1-6: 완료/취소 주문 필터링 및 제외 검증 통과');

console.log('--- [Test 2] 순차 처리 큐 (Sequential Queue) 비동기 순서 검증 ---');

async function testQueueSequence() {
  const processedOrder = [];
  let inFlight = 0;
  let maxConcurrency = 0;

  // Mock fetchAPI with artificial delay to verify sequential execution
  global.fetchAPI = async (endpoint, options) => {
    inFlight++;
    maxConcurrency = Math.max(maxConcurrency, inFlight);
    await new Promise(r => setTimeout(r, 20));
    processedOrder.push(options.body.orderId);
    inFlight--;
    return { success: true };
  };
  global.silentRefreshAdminData = async () => {};
  global.renderData = () => {};
  global.pendingUpdates = new Map();
  global.recentStatusUpdates = new Map();
  global.currentOrders = [];

  const { enqueueOrderMutation } = require('../js/kitchen.js');

  // Enqueue 5 mutations concurrently
  const promises = [];
  for (let i = 1; i <= 5; i++) {
    const oNo = `TEST-ORDER-${i}`;
    global.pendingUpdates.set(oNo, 'P');
    promises.push(enqueueOrderMutation({
      type: 'updateStatus',
      orderNo: oNo,
      nextStatus: 'P',
      originalStates: []
    }));
  }

  await Promise.all(promises);

  assert.strictEqual(maxConcurrency, 1, '최대 동시 실행 수는 엄격하게 1이어야 합니다 (GAS ScriptLock 방지)');
  assert.deepStrictEqual(processedOrder, [
    'TEST-ORDER-1',
    'TEST-ORDER-2',
    'TEST-ORDER-3',
    'TEST-ORDER-4',
    'TEST-ORDER-5'
  ], '큐에 들어간 순서대로 정확히 1건씩 순차 실행되어야 합니다');

  console.log('✓ Test 2-1: 동시 5건 요청이 동시성 1로 완벽히 순차 직렬화되어 처리됨');
}

testQueueSequence().then(() => {
  console.log('\n✅ 모든 P127 단계별 일괄 진행 및 순차 큐 단위 테스트 성공!');
}).catch(err => {
  console.error('❌ 테스트 실패:', err);
  process.exit(1);
});
