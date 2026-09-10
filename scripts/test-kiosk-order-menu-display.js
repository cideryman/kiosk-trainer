const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

// 1. 파일 내용 정적 검증
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
const swJs = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

assert(indexHtml.includes('id="friendly-notice-menu-box"'), 'index.html에 friendly-notice-menu-box가 있어야 함');
assert(indexHtml.includes('id="friendly-notice-menu-items"'), 'index.html에 friendly-notice-menu-items가 있어야 함');
assert(indexHtml.includes('btn-friendly-notice-close'), 'index.html에 닫기 버튼이 있어야 함');
assert(indexHtml.includes('friendlyNoticeTimer = setTimeout'), 'index.html에 6초 자동 닫힘 타이머가 있어야 함');

assert(styleCss.includes('.friendly-notice-menu-box'), 'css/style.css에 friendly-notice-menu-box 스타일이 있어야 함');
assert(styleCss.includes('.friendly-notice-menu-label'), 'css/style.css에 friendly-notice-menu-label 스타일이 있어야 함');
assert(styleCss.includes('.friendly-notice-menu-items'), 'css/style.css에 friendly-notice-menu-items 스타일이 있어야 함');

assert(swJs.includes('kiosk-cache-v356'), 'service-worker.js가 kiosk-cache-v356이어야 함');

// 2. updateKioskUserStatusesFromFeed 로직 동작 검증
const scriptContext = {
  window: {},
  document: {
    querySelectorAll: () => [],
    getElementById: () => null
  },
  sessionStorage: {
    getItem: () => null,
    setItem: () => {}
  },
  currentKioskUserStatuses: {},
  currentKioskOrderPolicy: 'once_daily',
  currentKioskCooldownMinutes: 60,
  applyUserCardStatuses: () => {}
};
vm.createContext(scriptContext);

// index.html에서 updateKioskUserStatusesFromFeed 및 openFriendlyNotice 추출 및 실행
const updateFnMatch = indexHtml.match(/function updateKioskUserStatusesFromFeed[\s\S]*?\n    function applyUserCardStatuses/);
assert(updateFnMatch, 'updateKioskUserStatusesFromFeed 함수가 추출되어야 함');
const updateFnCode = updateFnMatch[0].replace('function applyUserCardStatuses', '');
vm.runInContext(updateFnCode, scriptContext);

// 테스트 케이스 A: 단일 품목 준비 중 (N)
const testOrdersA = [
  { userId: 'U1', nickname: '길동이', snackName: '초코파이', quantity: 1, servedYn: 'N', timestamp: new Date().toISOString() }
];
scriptContext.updateKioskUserStatusesFromFeed(testOrdersA, 'once_daily', 60);
const statusU1 = scriptContext.currentKioskUserStatuses['U1'];
assert.equal(statusU1.status, 'PREPARING');
assert.equal(statusU1.itemsText, '초코파이 1개');
assert(statusU1.speakText.includes('초코파이 1개를 열심히 준비하고 있어요'), '자연스러운 목적격 조사 "를"이 포함되어야 함');

// 테스트 케이스 B: 복수 품목/다중 행 주문 준비 완료 (R)
const testOrdersB = [
  { userId: 'U2', nickname: '영희', snackName: '포도주스', quantity: 1, servedYn: 'R', timestamp: new Date().toISOString() },
  { userId: 'U2', nickname: '영희', snackName: '샌드위치', quantity: 2, servedYn: 'R', timestamp: new Date().toISOString() }
];
scriptContext.updateKioskUserStatusesFromFeed(testOrdersB, 'once_daily', 60);
const statusU2 = scriptContext.currentKioskUserStatuses['U2'];
assert.equal(statusU2.status, 'READY');
assert(statusU2.itemsText.includes('포도주스 1개'), '포도주스 1개가 포함되어야 함');
assert(statusU2.itemsText.includes('샌드위치 2개'), '샌드위치 2개가 포함되어야 함');
assert(statusU2.speakText.includes('가 준비되었습니다'), '자연스러운 주격 조사 "가"가 포함되어야 함');

// 테스트 케이스 C: 수령 완료 건 (Y) - itemsText 없음
const testOrdersC = [
  { userId: 'U3', nickname: '철수', snackName: '과자', quantity: 1, servedYn: 'Y', timestamp: new Date().toISOString() }
];
scriptContext.updateKioskUserStatusesFromFeed(testOrdersC, 'once_daily', 60);
const statusU3 = scriptContext.currentKioskUserStatuses['U3'];
assert.equal(statusU3.status, 'SERVED');
assert.equal(statusU3.itemsText, undefined, 'SERVED 상태에서는 itemsText가 없어야 함');

// 테스트 케이스 D: 동일 품목 수량 합산 검증
const testOrdersD = [
  { userId: 'U4', nickname: '민수', snackName: '초코우유', quantity: 1, servedYn: 'P', timestamp: new Date().toISOString() },
  { userId: 'U4', nickname: '민수', snackName: '초코우유', quantity: 2, servedYn: 'P', timestamp: new Date().toISOString() }
];
scriptContext.updateKioskUserStatusesFromFeed(testOrdersD, 'once_daily', 60);
const statusU4 = scriptContext.currentKioskUserStatuses['U4'];
assert.equal(statusU4.status, 'PREPARING');
assert.equal(statusU4.itemsText, '초코우유 3개', '동일 품목 수량이 3개로 합산되어야 함');

console.log('All P116 kiosk order menu display & TTS tests PASSED!');
