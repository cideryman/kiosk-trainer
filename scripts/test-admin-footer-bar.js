#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

console.log('--- [Test 1] settings.html, admin.html, reviews.html 본문 하단 푸터 바 및 상단 헤더 버튼 검증 ---');

const targets = ['settings.html', 'admin.html', 'reviews.html'];

for (const target of targets) {
  const content = read(target);
  
  // 1. footer 요소 존재 검증
  assert(content.includes('class="admin-content-footer"'), `${target}: admin-content-footer 클래스가 누락되었습니다.`);
  
  // 2. data-app-update-button 존재 검증
  assert(content.includes('data-app-update-button'), `${target}: data-app-update-button 속성이 누락되었습니다.`);
  assert(content.includes('data-app-update-label'), `${target}: data-app-update-label 속성이 누락되었습니다.`);
  
  // 3. data-admin-toolbar-lock 존재 검증
  assert(content.includes('data-admin-toolbar-lock'), `${target}: data-admin-toolbar-lock 속성이 누락되었습니다.`);
  
  // 4. data-app-update-status 존재 검증
  assert(content.includes('data-app-update-status'), `${target}: data-app-update-status 속성이 누락되었습니다.`);
  
  // 5. main 태그 내부에 위치하는지 검증
  const footerIndex = content.indexOf('class="admin-content-footer"');
  const mainCloseIndex = content.indexOf('</main>');
  assert(footerIndex !== -1 && mainCloseIndex !== -1 && footerIndex < mainCloseIndex, `${target}: 푸터 바가 </main> 이전에 위치해야 합니다.`);
  
  // 6. 상단 헤더 업데이트 버튼 및 상단 알림 배너 존재 검증 (P128 상단 빠른 접근 개선)
  assert(content.includes('admin-header-update-banner'), `${target}: admin-header-update-banner 요소가 누락되었습니다.`);
  
  console.log(`✓ ${target}: 상단 헤더 빠른 버튼 & 하단 유틸리티 푸터 바 검증 통과`);
}

console.log('--- [Test 2] css/style.css 스타일 검증 ---');
const css = read('css/style.css');
assert(css.includes('.admin-content-footer'), 'css/style.css: .admin-content-footer 스타일 누락');
assert(css.includes('.btn-footer-utility'), 'css/style.css: .btn-footer-utility 스타일 누락');
assert(css.includes('.btn-footer-update'), 'css/style.css: .btn-footer-update 스타일 누락');
assert(css.includes('.btn-footer-logout'), 'css/style.css: .btn-footer-logout 스타일 누락');
assert(css.includes('.admin-footer-status'), 'css/style.css: .admin-footer-status 스타일 누락');
assert(css.includes('.admin-header-update-banner'), 'css/style.css: .admin-header-update-banner 스타일 누락');
console.log('✓ css/style.css: 상단 배너, 푸터 바 및 버튼 스타일 정의 검증 통과');

console.log('--- [Test 3] 캐시 버전 일치 검증 (kiosk-cache-v376) ---');
const sw = read('service-worker.js');
const handoff = read('handoff.md');
assert(sw.includes('kiosk-cache-v376'), 'service-worker.js: kiosk-cache-v376 누락');
assert(handoff.includes('kiosk-cache-v376'), 'handoff.md: kiosk-cache-v376 누락');
console.log('✓ service-worker.js & handoff.md: kiosk-cache-v376 캐시 일치 검증 통과');

console.log('\n✅ 모든 P128 상단/하단 업데이트 및 나가기 버튼 단위 테스트 성공!');
