#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sharedSource = fs.readFileSync(path.join(root, 'gas/31_OrderShared.gs'), 'utf8');
const usersSource = fs.readFileSync(path.join(root, 'gas/20_Users.gs'), 'utf8');
const orderSource = fs.readFileSync(path.join(root, 'gas/40_Orders.gs'), 'utf8');
const setupSource = fs.readFileSync(path.join(root, 'gas/00_Setup.gs'), 'utf8');
const mockSource = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');

const context = { Math, Number, String, Boolean, Array, Object, JSON, RegExp, isNaN, Logger: { log() {} } };
vm.createContext(context);
vm.runInContext(sharedSource, context, { filename: '31_OrderShared.gs' });

const usersContext = {
  Math,
  Number,
  String,
  isFinite,
  ADMIN_MIN_USER_ORDER_LIMIT: 1,
  ADMIN_MAX_USER_CREDIT: 15
};
vm.createContext(usersContext);
vm.runInContext(usersSource, usersContext, { filename: '20_Users.gs' });

assert.deepEqual(
  JSON.parse(JSON.stringify(context.getOrderCreditState(false, 10, 10))),
  { canOrder: true, beforeCredit: 10, afterCredit: 0, persistsBalance: false },
  '일반 키오스크는 한도 10 안에서 주문하고 영구 차감하지 않아야 함'
);
assert.equal(usersContext.isValidUserOrderLimit(1), true, '최소 한도 1을 허용해야 함');
assert.equal(usersContext.isValidUserOrderLimit(15), true, '최대 한도 15를 허용해야 함');
assert.equal(usersContext.isValidUserOrderLimit(0), false, '한도 0을 거부해야 함');
assert.equal(usersContext.isValidUserOrderLimit(1.5), false, '소수 한도를 거부해야 함');
assert.deepEqual(
  JSON.parse(JSON.stringify(context.getOrderCreditState(false, 10, 11))),
  { canOrder: false, beforeCredit: 10, afterCredit: 0, persistsBalance: false },
  '일반 키오스크는 한도 초과 주문을 차단해야 함'
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.getOrderCreditState(true, 10, 3))),
  { canOrder: true, beforeCredit: 10, afterCredit: 7, persistsBalance: true },
  '배달왔삼은 기존 지갑 차감 상태를 유지해야 함'
);

assert(orderSource.includes('if (isGuest) {\n      const walletUpdate = resolveGuestCreditWallet'), '게스트만 지갑을 영구 차감해야 함');
assert(!orderSource.includes('transaction.userSheet\n              .getRange'), '일반 주문 실패 롤백에서 이용자 한도를 쓰면 안 됨');
assert(!orderSource.includes('const newCredit = currentCredit + point'), '일반 주문 취소에서 한도를 환불하면 안 됨');
assert(setupSource.includes("DEFAULT_USER_ORDER_LIMIT"), '활성 이용자 기본 한도 마이그레이션이 있어야 함');
assert(setupSource.includes("copyTo(ss).setName(backupName)"), '마이그레이션 전에 이용자목록을 백업해야 함');
assert(!mockSource.includes('Math.max(0, selectedUser.credit - totalCost)'), 'Mock 일반 주문도 한도를 차감하면 안 됨');
assert(!mockSource.includes('user.credit = (user.credit || 0) + (item.point || 0)'), 'Mock 일반 취소도 한도를 환불하면 안 됨');

console.log('Kiosk per-order limit tests passed: 14 checks');
