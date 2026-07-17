#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const errors = [];
const notes = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function fail(message) {
  errors.push(message);
}

function section(source, startHeading, endHeading) {
  const start = source.indexOf(startHeading);
  if (start < 0) {
    fail(`섹션을 찾을 수 없습니다: ${startHeading}`);
    return '';
  }
  const end = endHeading ? source.indexOf(endHeading, start + startHeading.length) : source.length;
  if (endHeading && end < 0) {
    fail(`섹션 끝을 찾을 수 없습니다: ${endHeading}`);
    return source.slice(start);
  }
  return source.slice(start, end);
}

function tableRows(source, expectedColumns) {
  return source.split(/\r?\n/)
    .filter(line => /^\|/.test(line))
    .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()))
    .filter(cells => cells.length === expectedColumns)
    .filter(cells => !cells.every(cell => /^:?-+:?$/.test(cell)))
    .filter(cells => !['순서', 'ID'].includes(cells[0]));
}

function checkLocalLinks(files) {
  for (const relativePath of files) {
    const source = read(relativePath);
    const base = path.dirname(path.join(root, relativePath));
    const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
    let match;
    while ((match = linkPattern.exec(source))) {
      let target = match[1].trim().replace(/^<|>$/g, '');
      if (/^(https?:|mailto:|file:|#)/i.test(target)) continue;
      target = target.split('#')[0];
      if (!target) continue;
      try {
        target = decodeURIComponent(target);
      } catch (_) {
        fail(`${relativePath}: 링크 인코딩을 해석할 수 없습니다: ${target}`);
        continue;
      }
      if (!fs.existsSync(path.resolve(base, target))) {
        fail(`${relativePath}: 존재하지 않는 로컬 링크: ${target}`);
      }
    }
  }
}

const handoff = read('handoff.md');
const verification = read('docs/handoff/verification.md');
const workLog = read('docs/handoff/work-log.md');
const serviceWorker = read('service-worker.js');
const applicationGas = read('gas/12_GuestApplications.gs');
const databaseSchema = read('docs/handoff/database-schema.md');

const currentSection = section(handoff, '## 현재 우선순위', '### 보류 과제');
const deferredSection = section(handoff, '### 보류 과제', '### 운영 모니터링');
const currentRows = tableRows(currentSection, 6);
const deferredRows = tableRows(deferredSection, 4);

if (currentRows.length === 0) fail('현재 우선순위 표에 작업이 없습니다.');

const allowedCurrentStatuses = new Set([
  '검토 대기',
  '구현 대기',
  '구현 중',
  '구현 완료·배포 대기',
  '배포 완료·수동 검증 대기'
]);

const ids = [];
for (const [order, id, task, status, nextAction, verificationLink] of currentRows) {
  if (!/^\d+$/.test(order)) fail(`${id || task}: 순서는 정수여야 합니다.`);
  if (!/^[PV]\d+$/.test(id)) fail(`현재 작업 ID 형식이 잘못됐습니다: ${id}`);
  if (!allowedCurrentStatuses.has(status)) fail(`${id}: 허용되지 않은 현재 상태: ${status}`);
  if (!task || !nextAction || !verificationLink) fail(`${id}: 작업·다음 행동·검증 절차를 모두 기록해야 합니다.`);
  ids.push(id);
}

for (const [id, task, status, condition] of deferredRows) {
  if (!/^P\d+$/.test(id)) fail(`보류 작업 ID 형식이 잘못됐습니다: ${id}`);
  if (status !== '보류') fail(`${id}: 보류 표의 상태는 '보류'여야 합니다.`);
  if (!task || !condition) fail(`${id}: 작업과 재검토 조건을 기록해야 합니다.`);
  ids.push(id);
}

const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicateIds.length) fail(`현재·보류 작업 번호가 중복됐습니다: ${[...new Set(duplicateIds)].join(', ')}`);

const nextIdMatch = handoff.match(/새 작업은 `P(\d+)`부터/);
if (!nextIdMatch) {
  fail('다음 신규 작업 번호를 찾을 수 없습니다.');
} else {
  const nextId = Number(nextIdMatch[1]);
  const maxId = Math.max(...ids.filter(id => id.startsWith('P')).map(id => Number(id.slice(1))));
  if (nextId <= maxId) fail(`다음 작업 번호 P${nextId}가 현재 최대 번호 P${maxId}보다 크지 않습니다.`);
  notes.push(`다음 신규 작업 번호 P${nextId}`);
}

if (fs.existsSync(path.join(root, 'docs/handoff/active-work.md'))) {
  fail('active-work.md가 다시 생성됐습니다. 현재 작업 상태는 handoff.md에만 기록해야 합니다.');
}

const verificationHeadings = verification.split(/\r?\n/).filter(line => /^#{1,6}\s/.test(line));
for (const heading of verificationHeadings) {
  if (/대기|완료/.test(heading)) fail(`verification.md 제목에 상태 표현이 있습니다: ${heading}`);
}

const incompleteWorkLogHeadings = workLog.split(/\r?\n/)
  .filter(line => /^##\s/.test(line))
  .filter(line => /대기|보류|폐기|구현 중/.test(line));
if (incompleteWorkLogHeadings.length) {
  fail(`work-log.md에 완료되지 않은 상태의 제목이 있습니다: ${incompleteWorkLogHeadings.join(', ')}`);
}

const handoffCache = handoff.match(/kiosk-cache-v\d+/)?.[0];
const workerCache = serviceWorker.match(/kiosk-cache-v\d+/)?.[0];
if (!handoffCache || !workerCache || handoffCache !== workerCache) {
  fail(`서비스 워커 캐시 버전 불일치: handoff=${handoffCache || '없음'}, service-worker=${workerCache || '없음'}`);
} else {
  notes.push(`캐시 ${handoffCache}`);
}

const headerBlock = applicationGas.match(/const GUEST_APPLICATION_HEADERS\s*=\s*\[([\s\S]*?)\];/);
const headers = headerBlock ? [...headerBlock[1].matchAll(/'([^']+)'/g)].map(match => match[1]) : [];
if (headers.length !== 22 || headers[0] !== 'createdAt' || headers.at(-1) !== 'updatedAt') {
  fail(`이용신청 헤더 계약 불일치: ${headers.length}열, first=${headers[0]}, last=${headers.at(-1)}`);
}
if (!handoff.includes('`이용신청` 22') || !databaseSchema.includes('### 이용신청 A:V')) {
  fail('handoff.md 또는 database-schema.md의 이용신청 22열 계약이 누락됐습니다.');
} else {
  notes.push('이용신청 A:V 22열');
}

if (!/GUEST_APPLICATION_DEFAULT_CAPACITY\s*=\s*5/.test(applicationGas)
    || !/GUEST_APPLICATION_MAX_CAPACITY\s*=\s*100/.test(applicationGas)
    || !handoff.includes('1~100명')) {
  fail('신청 정원 기본값 5·상한 100 계약이 문서 또는 GAS와 일치하지 않습니다.');
} else {
  notes.push('신청 정원 5~100 계약 확인');
}

checkLocalLinks([
  'handoff.md',
  'docs/handoff/architecture.md',
  'docs/handoff/asset-sources.md',
  'docs/handoff/database-schema.md',
  'docs/handoff/decisions.md',
  'docs/handoff/verification.md',
  'docs/handoff/work-log.md'
]);

if (errors.length) {
  console.error('Handoff check failed:');
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Handoff check passed: ${ids.length} current/deferred IDs`);
notes.forEach(note => console.log(`- ${note}`));
