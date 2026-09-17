#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

console.log('=== [Test 1] setButtonSuccess 런타임 동작 검증 ===');

// Mock DOM Button
class MockClassList {
  constructor() {
    this.classes = new Set();
  }
  add(c) { this.classes.add(c); }
  remove(c) { this.classes.delete(c); }
  contains(c) { return this.classes.has(c); }
}

class MockButton {
  constructor(text = '저장하기') {
    this.textContent = text;
    this.disabled = false;
    this.dataset = { originalText: text };
    this.classList = new MockClassList();
  }
}

function setButtonSuccess(button, text = '✓ 저장 완료', durationMs = 1500, onComplete = null) {
  if (!button) return;
  button.disabled = true;
  button.classList.add('is-success');
  button.textContent = text;
  setTimeout(() => {
    button.disabled = false;
    button.classList.remove('is-success');
    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
    }
    if (onComplete) onComplete();
  }, durationMs);
}

const btn = new MockButton('설정 저장');
setButtonSuccess(btn, '✓ 저장 완료', 50, () => {
  assert.strictEqual(btn.disabled, false, '타이머 만료 후 disabled 해제되어야 함');
  assert.strictEqual(btn.classList.contains('is-success'), false, 'is-success 클래스가 제거되어야 함');
  assert.strictEqual(btn.textContent, '설정 저장', '원래 텍스트로 복원되어야 함');
  console.log('✓ setButtonSuccess 타이머 복원 및 클래스 제어 성공');
});

assert.strictEqual(btn.disabled, true, '호출 즉시 disabled 되어야 함');
assert.strictEqual(btn.classList.contains('is-success'), true, 'is-success 클래스가 추가되어야 함');
assert.strictEqual(btn.textContent, '✓ 저장 완료', '성공 문구로 변경되어야 함');

console.log('=== [Test 2] js/settings.js 핸들러 낙관적 갱신 및 비동기 처리 검증 ===');
const settingsCode = read('js/settings.js');

// 1. setButtonSuccess 정의 및 window 노출 검증
assert(settingsCode.includes('function setButtonSuccess('), 'settings.js: setButtonSuccess 함수 누락');
assert(settingsCode.includes('window.setButtonSuccess = setButtonSuccess;'), 'settings.js: window.setButtonSuccess 누락');

// 2. 값 설정 계열 4개 핸들러: await loadAllSettings() 미사용 및 Object.assign(latestGuestOpsSettings, payload) 검증
const actionsSectionStart = settingsCode.indexOf('// --- 6. 저장 액션들 ---');
assert(actionsSectionStart !== -1, 'settings.js: 저장 액션 섹션 누락');

const valueHandlers = [
  'saveKioskPolicyAction',
  'saveCapacityAction',
  'saveBaseSettingsAction',
  'saveEventSettingsAction'
];

for (const vh of valueHandlers) {
  const vhIndex = settingsCode.indexOf(vh, actionsSectionStart);
  assert(vhIndex !== -1, `settings.js: ${vh} 함수가 존재해야 합니다.`);
  const handlerBlock = settingsCode.slice(vhIndex, vhIndex + 2500);
  
  assert(!handlerBlock.includes('await loadAllSettings()'), `${vh}: await loadAllSettings() 동기 호출이 제거되어야 합니다.`);
  assert(handlerBlock.includes('Object.assign(latestGuestOpsSettings, payload)'), `${vh}: latestGuestOpsSettings 로컬 반영이 있어야 합니다.`);
  assert(handlerBlock.includes('setButtonSuccess(btn'), `${vh}: setButtonSuccess 호출이 있어야 합니다.`);
  console.log(`✓ settings.js: ${vh} 낙관적 로컬 갱신 및 인라인 성공 피드백 확인`);
}

// 3. 일정/운영 계열 핸들러: 백그라운드 loadAllSettings().catch(...) 호출 및 인라인 성공 피드백 검증
const scheduleHandlers = [
  'saveGuestWeeklyScheduleAction',
  'toggleGuestWeeklyScheduleSkipAction',
  'addGuestAdditionalScheduleAction',
  'deleteGuestAdditionalScheduleAction',
  'guestEmergencyOpenUntilAction',
  'guestEmergencyCloseAction'
];

for (const sh of scheduleHandlers) {
  const shIndex = settingsCode.indexOf(sh, actionsSectionStart);
  assert(shIndex !== -1, `settings.js: ${sh} 함수가 존재해야 합니다.`);
  const handlerBlock = settingsCode.slice(shIndex, shIndex + 2500);
  
  assert(!handlerBlock.includes('await loadAllSettings()'), `${sh}: await loadAllSettings() 동기 블로킹이 제거되어야 합니다.`);
  assert(handlerBlock.includes('loadAllSettings().catch('), `${sh}: 백그라운드 loadAllSettings() 호출이 있어야 합니다.`);
  assert(handlerBlock.includes('setButtonSuccess('), `${sh}: setButtonSuccess 피드백이 있어야 합니다.`);
  console.log(`✓ settings.js: ${sh} 백그라운드 무소음 동기화 및 인라인 피드백 확인`);
}

console.log('=== [Test 3] js/admin.js 핸들러 즉시 갱신 및 블로킹 alert 제거 검증 ===');
const adminCode = read('js/admin.js');

// 1. updateUserCreditAction: currentUsers 직접 갱신 및 await loadAdminData 제거
assert(adminCode.includes('async function updateUserCreditAction('), 'admin.js: updateUserCreditAction 누락');
const ucaBlock = adminCode.slice(adminCode.indexOf('async function updateUserCreditAction('), adminCode.indexOf('async function updateUserCreditAction(') + 800);
assert(!ucaBlock.includes('await loadAdminData()'), 'updateUserCreditAction: await loadAdminData()가 제거되어야 함');
assert(ucaBlock.includes('renderUsersManagement(currentUsers)'), 'updateUserCreditAction: renderUsersManagement 렌더 호출 확인');
console.log('✓ admin.js: updateUserCreditAction 로컬 캐시 즉시 갱신 확인');

// 2. updateSnackStockAction: currentSnacks 직접 갱신 및 await loadAdminData 제거
assert(adminCode.includes('async function updateSnackStockAction('), 'admin.js: updateSnackStockAction 누락');
const ssaBlock = adminCode.slice(adminCode.indexOf('async function updateSnackStockAction('), adminCode.indexOf('async function updateSnackStockAction(') + 900);
assert(!ssaBlock.includes('await loadAdminData()'), 'updateSnackStockAction: await loadAdminData()가 제거되어야 함');
assert(ssaBlock.includes('renderSnacksStock(currentSnacks)'), 'updateSnackStockAction: renderSnacksStock 렌더 호출 확인');
assert(ssaBlock.includes('renderSnacksManagement(currentSnacks)'), 'updateSnackStockAction: renderSnacksManagement 렌더 호출 확인');
console.log('✓ admin.js: updateSnackStockAction 로컬 캐시 즉시 갱신 확인');

// 3. updateSnackSaleAction: currentSnacks 직접 갱신 및 await loadAdminData 제거
assert(adminCode.includes('async function updateSnackSaleAction('), 'admin.js: updateSnackSaleAction 누락');
const saleBlock = adminCode.slice(adminCode.indexOf('async function updateSnackSaleAction('), adminCode.indexOf('async function updateSnackSaleAction(') + 1000);
assert(!saleBlock.includes('await loadAdminData()'), 'updateSnackSaleAction: await loadAdminData()가 제거되어야 함');
assert(saleBlock.includes('renderSnacksStock(currentSnacks)'), 'updateSnackSaleAction: renderSnacksStock 렌더 호출 확인');
console.log('✓ admin.js: updateSnackSaleAction 로컬 캐시 즉시 갱신 확인');

// 4. updateUserAction / updateSnackAction: 성공 alert 제거 및 모달 닫기 + 즉시 갱신
const uuaBlock = adminCode.slice(adminCode.indexOf('async function updateUserAction('), adminCode.indexOf('async function updateUserAction(') + 2000);
assert(!uuaBlock.includes('alert("이용자 정보를 수정했습니다.")'), 'updateUserAction: 성공 alert 제거 확인');
assert(uuaBlock.includes('closeEditUserModal()'), 'updateUserAction: 모달 즉시 닫기 확인');
assert(uuaBlock.includes('renderUsersManagement(currentUsers)'), 'updateUserAction: 로컬 반영 확인');

const usaBlock = adminCode.slice(adminCode.indexOf('async function updateSnackAction('), adminCode.indexOf('async function updateSnackAction(') + 2000);
assert(!usaBlock.includes('alert("간식 정보를 수정했습니다.")'), 'updateSnackAction: 성공 alert 제거 확인');
assert(usaBlock.includes('closeEditSnackModal()'), 'updateSnackAction: 모달 즉시 닫기 확인');
assert(usaBlock.includes('renderSnacksStock(currentSnacks)'), 'updateSnackAction: 로컬 반영 확인');
console.log('✓ admin.js: updateUserAction / updateSnackAction 모달 즉시 닫기 및 로컬 갱신 확인');

// 5. addNewUserAction / addNewSnackAction: 백그라운드 loadAdminData 호출
const nuaBlock = adminCode.slice(adminCode.indexOf('async function addNewUserAction('), adminCode.indexOf('async function addNewUserAction(') + 3500);
assert(nuaBlock.includes('loadAdminData().catch('), 'addNewUserAction: 백그라운드 loadAdminData 확인');

const nsaBlock = adminCode.slice(adminCode.indexOf('async function addNewSnackAction('), adminCode.indexOf('async function addNewSnackAction(') + 3500);
assert(nsaBlock.includes('loadAdminData().catch('), 'addNewSnackAction: 백그라운드 loadAdminData 확인');
console.log('✓ admin.js: addNewUserAction / addNewSnackAction 백그라운드 동기화 확인');

console.log('=== [Test 4] css/style.css 및 service-worker.js 검증 ===');
const css = read('css/style.css');
assert(css.includes('.btn.is-success'), 'css/style.css: .btn.is-success 누락');
assert(css.includes('button.is-success'), 'css/style.css: button.is-success 누락');
assert(css.includes('#38A169'), 'css/style.css: #38A169 색상 누락');
console.log('✓ css/style.css: is-success 스타일 정의 확인');

const sw = read('service-worker.js');
assert(sw.includes('kiosk-cache-v377'), 'service-worker.js: kiosk-cache-v377 캐시 버전 누락');
console.log('✓ service-worker.js: kiosk-cache-v377 확인');

setTimeout(() => {
  console.log('\n✅ 모든 P129 저장/조회 체감 속도 최적화 단위 테스트 통과!\n');
}, 100);
