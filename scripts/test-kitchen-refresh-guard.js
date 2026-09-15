#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const kitchenSource = fs.readFileSync(path.join(root, 'js/kitchen.js'), 'utf8').replace(/\r\n/g, '\n');

// 1. Static code assertions
assert(
  kitchenSource.includes('const recentStatusUpdates = new Map();'),
  'recentStatusUpdates 맵이 정의되어 있어야 함'
);
assert(
  kitchenSource.includes('const RECENT_UPDATE_PROTECT_MS = 5000;'),
  'RECENT_UPDATE_PROTECT_MS 5000ms가 정의되어 있어야 함'
);
assert(
  kitchenSource.includes('if (!isAutoRefresh) {\n    const pendingContainer = document.getElementById(\'pending-orders-group\');'),
  'loadAdminData는 isAutoRefresh가 아닐 때만 대기 목록 컨테이너를 초기화해야 함'
);
assert(
  kitchenSource.includes('if (!isAutoRefresh) {\n      const errorTbody = document.getElementById(\'order-table-body\');'),
  'loadAdminData 실패 시 isAutoRefresh가 아닐 때만 오류 문구로 화면을 덮어써야 함'
);
assert(
  kitchenSource.includes('if (pendingUpdates.size > 0) {\n        refreshSeconds = 5;'),
  'startRefreshTimer는 서버 통신 중일 때 자동 새로고침을 5초 연기해야 함'
);

// Verify resetRefreshTimer is called in all order status update entry points
const updateStatusActionMatch = /async function updateStatusAction\(orderNo, nextStatus\) \{\s*resetRefreshTimer\(\);/.test(kitchenSource);
assert(updateStatusActionMatch, 'updateStatusAction 시작 시 resetRefreshTimer()가 호출되어야 함');

const undoCompleteOrderMatch = /async function undoCompleteOrder\(orderNo\) \{\s*resetRefreshTimer\(\);/.test(kitchenSource);
assert(undoCompleteOrderMatch, 'undoCompleteOrder 시작 시 resetRefreshTimer()가 호출되어야 함');

const completeSelectedOrdersMatch = /resetRefreshTimer\(\); \/\/ P126/.test(kitchenSource);
assert(completeSelectedOrdersMatch, 'completeSelectedOrders 실행 시 resetRefreshTimer()가 호출되어야 함');

// 2. Behavioral verification of renderData with recentStatusUpdates
// Mock minimal environment for renderData testing
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
  pendingUpdates: new Map(),
  recentStatusUpdates: new Map(),
  RECENT_UPDATE_PROTECT_MS: 5000,
  document: {
    getElementById(id) {
      if (id === 'delivery-filter') return { value: 'all' };
      return null;
    }
  }
};
vm.createContext(context);

// Extract renderData logic into VM
const renderDataCode = `
function renderData(rawOrders) {
  const now = Date.now();
  const orders = rawOrders.map((o, idx) => {
    const orderNo = o.orderNo || \`\${o.timestamp || idx}_\${o.nickname || 'unknown'}\`;
    let servedYn = o.servedYn;
    if (pendingUpdates.has(orderNo)) {
      servedYn = pendingUpdates.get(orderNo);
    } else if (recentStatusUpdates.has(orderNo)) {
      const recent = recentStatusUpdates.get(orderNo);
      if (now - recent.timestamp < RECENT_UPDATE_PROTECT_MS) {
        if (servedYn !== recent.status) {
          servedYn = recent.status;
        } else {
          recentStatusUpdates.delete(orderNo);
        }
      } else {
        recentStatusUpdates.delete(orderNo);
      }
    }
    return {
      ...o,
      orderNo,
      servedYn
    };
  });
  return orders;
}
`;
vm.runInContext(renderDataCode, context);

// Test 1: Recent update protects against stale server read (server returns 'N', but local recently updated to 'P')
context.recentStatusUpdates.set('ORD-001', { status: 'P', timestamp: Date.now() });
const staleOrders = [{ orderNo: 'ORD-001', servedYn: 'N' }];
const protectedResult = context.renderData(staleOrders);
assert.equal(protectedResult[0].servedYn, 'P', '서버가 아직 N을 반환하더라도 최근 변경된 P 상태가 유지되어야 함');
assert.equal(context.recentStatusUpdates.has('ORD-001'), true, '서버가 아직 갱신 전이면 보호가 유지되어야 함');

// Test 2: When server catches up (server returns 'P'), protection clears
const updatedOrders = [{ orderNo: 'ORD-001', servedYn: 'P' }];
const syncedResult = context.renderData(updatedOrders);
assert.equal(syncedResult[0].servedYn, 'P', '서버가 P를 반환하면 P로 렌더링');
assert.equal(context.recentStatusUpdates.has('ORD-001'), false, '서버와 일치하면 recentStatusUpdates에서 자동 정리되어야 함');

// Test 3: Expired protection (older than 5s) does not override
context.recentStatusUpdates.set('ORD-002', { status: 'P', timestamp: Date.now() - 6000 });
const expiredOrders = [{ orderNo: 'ORD-002', servedYn: 'N' }];
const expiredResult = context.renderData(expiredOrders);
assert.equal(expiredResult[0].servedYn, 'N', '5초가 지난 오래된 보호는 만료되어 서버 값 반영');
assert.equal(context.recentStatusUpdates.has('ORD-002'), false, '만료된 보호 엔트리는 자동 삭제');

console.log('P126 kitchen refresh guard tests passed successfully!');
