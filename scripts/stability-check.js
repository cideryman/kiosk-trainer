#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_API_VERSION = '2026-08-25.1';
const API_URL = String(process.env.KIOSK_API_URL || '').trim();
const ADMIN_TOKEN = String(process.env.KIOSK_ADMIN_TOKEN || '').trim();
const MODE = String(process.env.KIOSK_STABILITY_MODE || 'read').trim().toLowerCase();
const CONCURRENCY = clampNumber(process.env.KIOSK_CONCURRENCY, 10, 1, 20);
const BURST_ENABLED = String(process.env.KIOSK_BURST || '').trim() === '1';
const OBSERVE_HOURS = clampNumber(process.env.KIOSK_OBSERVE_HOURS, 0, 0, 168);
const OBSERVE_INTERVAL_MINUTES = clampNumber(process.env.KIOSK_OBSERVE_INTERVAL_MINUTES, 240, 1, 1440);
const REQUEST_TIMEOUT_MS = clampNumber(process.env.KIOSK_TIMEOUT_MS, 40000, 5000, 120000);
const OUTPUT_DIR = path.resolve(__dirname, '..', 'tmp', 'stability-results');
const RUN_ID = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const endpointHash = API_URL
  ? crypto.createHash('sha256').update(API_URL).digest('hex').slice(0, 12)
  : '';
let requestSequence = 0;

const report = {
  schemaVersion: 1,
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  finishedAt: '',
  mode: MODE,
  endpointHash,
  expectedApiContractVersion: EXPECTED_API_VERSION,
  concurrency: CONCURRENCY,
  observation: {
    hours: OBSERVE_HOURS,
    intervalMinutes: OBSERVE_INTERVAL_MINUTES,
    rounds: 0
  },
  checks: [],
  requests: [],
  summary: {},
  manualChecks: [
    'Kakao login in production',
    'Weekly application rotation in staging',
    'Review image upload and privacy notice',
    'Desktop, 390px, and 320px browser smoke tests',
    'PWA update and offline shell behavior'
  ]
};

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatKstTime(dateValue) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23'
  }).format(dateValue);
}

function sanitizeText(value) {
  let text = String(value == null ? '' : value);
  if (ADMIN_TOKEN) text = text.split(ADMIN_TOKEN).join('[REDACTED]');
  text = text.replace(/https:\/\/script\.google\.com\/macros\/s\/[^/\s]+\/exec/g, '[GAS_ENDPOINT]');
  return text.slice(0, 300);
}

function addCheck(name, passed, detail = '') {
  const check = { name, passed: Boolean(passed), detail: sanitizeText(detail) };
  report.checks.push(check);
  const mark = check.passed ? 'PASS' : 'FAIL';
  process.stdout.write(`[${mark}] ${name}${detail ? ` - ${sanitizeText(detail)}` : ''}\n`);
  return check.passed;
}

function classifyError(error) {
  if (!error) return '';
  if (error.name === 'AbortError') return 'timeout';
  return 'network';
}

function responseCategory(data) {
  const message = String(data?.message || data?.error || '');
  if (/잠시 후|진행 중|처리 중/.test(message)) return 'lock';
  if (/재고/.test(message)) return 'stock';
  if (/온기/.test(message)) return 'credit';
  if (/권한/.test(message)) return 'auth';
  if (/이미/.test(message)) return 'duplicate';
  return data?.success === false ? 'api' : '';
}

async function requestApi(action, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const attempts = options.retryRead ? 2 : 1;
  const requestId = ++requestSequence;
  let lastResult = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
    const startedAt = Date.now();
    let status = 0;
    let responseBytes = 0;
    let data = null;
    let error = null;

    try {
      let url = `${API_URL}?action=${encodeURIComponent(action)}`;
      const fetchOptions = { method, redirect: 'follow', signal: controller.signal };
      if (method === 'GET' && options.params) {
        const params = new URLSearchParams(options.params);
        url += `&${params.toString()}`;
      }
      if (method === 'POST') {
        fetchOptions.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
        fetchOptions.body = JSON.stringify({ action, ...(options.body || {}) });
      }

      const response = await fetch(url, fetchOptions);
      status = response.status;
      const raw = await response.text();
      responseBytes = Buffer.byteLength(raw, 'utf8');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = JSON.parse(raw);
    } catch (caught) {
      error = caught;
    } finally {
      clearTimeout(timeout);
    }

    const metric = {
      requestId,
      action,
      method,
      kind: options.kind || 'read',
      attempt,
      status,
      durationMs: Date.now() - startedAt,
      responseBytes,
      transportSuccess: !error && status >= 200 && status < 300,
      apiSuccess: !error && data?.success !== false,
      errorType: classifyError(error) || responseCategory(data)
    };
    report.requests.push(metric);
    lastResult = { data, metric, error };

    if (!error || attempt === attempts) break;
    await wait(700);
  }

  return lastResult;
}

async function readApi(action, options = {}) {
  return requestApi(action, { ...options, retryRead: true, kind: options.kind || 'read' });
}

async function adminRead(action, body = {}, kind = 'read') {
  return readApi(action, {
    method: 'POST',
    body: { ...body, adminToken: ADMIN_TOKEN },
    kind
  });
}

async function adminWrite(action, body = {}, kind = 'write') {
  return requestApi(action, {
    method: 'POST',
    body: { ...body, adminToken: ADMIN_TOKEN },
    kind
  });
}

async function safeWrite(action, body = {}, kind = 'write') {
  let result = await adminWrite(action, body, kind);
  const retryable = result.error || result.metric.errorType === 'lock';
  if (!retryable) return result;
  await wait(800 + Math.floor(Math.random() * 500));
  return adminWrite(action, body, kind);
}

function assertContract(action, data) {
  return addCheck(
    `${action} contract version`,
    data?.apiContractVersion === EXPECTED_API_VERSION,
    `actual=${data?.apiContractVersion || 'missing'}`
  );
}

function isActive(value) {
  return ['TRUE', 'Y', 'O', 'YES', '\uC0AC\uC6A9', '\uC608'].includes(String(value ?? 'Y').trim().toUpperCase());
}

function isOnSale(value) {
  return ['TRUE', 'Y', 'O', 'YES', '\uD310\uB9E4', '\uC608'].includes(String(value ?? 'Y').trim().toUpperCase());
}

async function runReadSuite() {
  const specs = [
    ['healthCheck', {}],
    ['getUsers', { params: { includeInactive: 'Y' } }],
    ['getSnacks', { params: { includeHidden: 'Y', mode: 'user' } }],
    ['getSnacks', { params: { includeHidden: 'Y', mode: 'guest' } }],
    ['getGuestSettings', {}],
    ['getGuestApplicationSettings', {}],
    ['getPublicReviews', {}],
    ['getRecentReviews', {}],
    ['getPublicOrderFeed', {}]
  ];
  const results = {};

  for (const [action, options] of specs) {
    const key = `${action}:${JSON.stringify(options.params || {})}`;
    const result = await readApi(action, options);
    results[key] = result.data;
    addCheck(`${key} response`, !result.error && result.data?.success !== false, result.metric.errorType);
    if (result.data) assertContract(key, result.data);
  }

  const users = results['getUsers:{"includeInactive":"Y"}']?.users || [];
  addCheck('Public users exclude inactive rows', users.every(user => isActive(user.useYn ?? user.active)), `rows=${users.length}`);

  const userSnacks = results['getSnacks:{"includeHidden":"Y","mode":"user"}']?.snacks || [];
  addCheck('Public snacks exclude hidden rows', userSnacks.every(snack => isOnSale(snack.saleYn ?? snack.active)), `rows=${userSnacks.length}`);

  const feed = results['getPublicOrderFeed:{}']?.orders || [];
  const allowedFeedKeys = new Set([
    'timestamp', 'orderNo', 'nickname', 'snackName', 'quantity', 'servedYn',
    'deliveryType', 'isKakao', 'cancelTimestamp', 'cancelReason'
  ]);
  const forbiddenKeys = new Set([
    'userId', 'snackId', 'point', 'orderToken', 'deliveryFee', 'totalCredit',
    'deliveryPlace', 'guestKey', 'authProvider', 'cancelReasonDetail', 'idempotencyKey'
  ]);
  const feedKeysSafe = feed.every(order => (
    Object.keys(order).every(key => allowedFeedKeys.has(key))
    && Object.keys(order).every(key => !forbiddenKeys.has(key))
  ));
  addCheck('Public order feed field allowlist', feedKeysSafe, `rows=${feed.length}`);

  if (feed[0]?.orderNo) {
    const statusResult = await readApi('getOrderStatus', { params: { orderNo: feed[0].orderNo }, kind: 'security' });
    const statusKeys = Object.keys(statusResult.data || {});
    addCheck(
      'Public order status excludes sensitive fields',
      statusResult.data?.success !== false && statusKeys.every(key => !forbiddenKeys.has(key)),
      `keys=${statusKeys.length}`
    );
  }

  const legacyFeed = await readApi('getOrdersToday', { kind: 'security' });
  const legacySafe = (legacyFeed.data?.orders || []).every(order => Object.keys(order).every(key => !forbiddenKeys.has(key)));
  addCheck('Legacy order feed alias is sanitized', legacyFeed.data?.success !== false && legacySafe);

  const legacyGuestLookup = await readApi('getGuestOrdersToday', {
    params: { guestName: 'test' },
    kind: 'security'
  });
  addCheck('Legacy guest name lookup is retired', legacyGuestLookup.data?.success === false);

  const dashboardGet = await readApi('getAdminDashboard', { kind: 'security' });
  addCheck('Admin dashboard GET is denied', dashboardGet.data?.success === false);

  const dashboardNoToken = await readApi('getAdminDashboard', {
    method: 'POST',
    body: {},
    kind: 'security'
  });
  addCheck('Admin dashboard POST requires token', dashboardNoToken.data?.success === false);

  if (ADMIN_TOKEN) {
    for (const action of ['diagnoseSystem', 'getAdminDashboard', 'getKitchenDashboard', 'getAdminOrdersToday']) {
      const result = await adminRead(action);
      addCheck(`${action} authenticated response`, !result.error && result.data?.success !== false, result.metric.errorType);
      if (result.data) assertContract(action, result.data);
    }
  }
}

async function runObservationRound(round) {
  const actions = [
    ['healthCheck', {}],
    ['getUsers', {}],
    ['getSnacks', { params: { mode: 'user' } }],
    ['getPublicOrderFeed', {}],
    ['getGuestSettings', {}],
    ['getPublicReviews', {}]
  ];
  for (const [action, options] of actions) {
    const cold = await readApi(action, { ...options, kind: 'observation-cold' });
    const warm = await readApi(action, { ...options, kind: 'observation-warm' });
    addCheck(`Observation ${round} ${action}`, cold.data?.success !== false && warm.data?.success !== false);
  }
}

async function runBurstSuite() {
  const actions = [
    ['healthCheck', {}],
    ['getUsers', {}],
    ['getSnacks', { params: { mode: 'user' } }],
    ['getPublicOrderFeed', {}]
  ];
  for (const [action, options] of actions) {
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => readApi(action, { ...options, kind: 'burst' }))
    );
    addCheck(
      `Burst ${action} x${CONCURRENCY}`,
      results.every(result => !result.error && result.data?.success !== false),
      `success=${results.filter(result => !result.error && result.data?.success !== false).length}`
    );
    await wait(2000);
  }
}

async function getAdminDashboard() {
  return (await adminRead('getAdminDashboard', {}, 'verification')).data;
}

async function getAdminOrders() {
  return (await adminRead('getAdminOrdersToday', {}, 'verification')).data;
}

async function seedFixtures() {
  const prepared = await adminWrite('prepareStabilityFixtures', {}, 'setup');
  if (!prepared.data?.success) {
    throw new Error(prepared.data?.message || 'Cannot prepare fixed staging fixtures.');
  }

  const users = prepared.data.users || [];
  const snacks = prepared.data.snacks || [];
  const dashboard = await getAdminDashboard();
  const dashboardUserIds = new Set((dashboard?.users?.users || []).map(item => String(item.userId)));
  const dashboardSnackIds = new Set((dashboard?.snacks?.snacks || []).map(item => String(item.snackId)));
  const fixturesVisible = users.every(item => dashboardUserIds.has(String(item.userId)))
    && snacks.every(item => dashboardSnackIds.has(String(item.snackId)));
  if (!fixturesVisible) throw new Error('Fixed staging fixtures are not visible in the admin dashboard.');
  return { users, snacks };
}

async function resetCredit(userId) {
  return adminWrite('updateUserCredit', { userId, credit: 15, adminMemo: 'stability reset' }, 'setup');
}

async function resetStock(snackId, stock) {
  return adminWrite('updateSnackStock', { snackId, stock, adminMemo: 'stability reset' }, 'setup');
}

async function cancelOrders(orderNos) {
  for (const orderNo of [...new Set(orderNos.filter(Boolean))]) {
    await safeWrite('cancelOrder', {
      orderId: orderNo,
      cancelReason: 'stability test cleanup',
      adminMemo: 'stability cleanup'
    }, 'cleanup');
  }
}

async function verifyUserAndSnack(userId, snackId) {
  const dashboard = await getAdminDashboard();
  const user = (dashboard?.users?.users || []).find(item => String(item.userId) === String(userId));
  const snack = (dashboard?.snacks?.snacks || []).find(item => String(item.snackId) === String(snackId));
  return { user, snack };
}

async function runIdempotencyScenario(fixtures) {
  const user = fixtures.users[0];
  const snack = fixtures.snacks[0];
  await resetCredit(user.userId);
  await resetStock(snack.snackId, 30);
  const idempotencyKey = `stab.idem.${RUN_ID}`;
  const body = {
    userId: user.userId,
    items: [{ snackId: snack.snackId, quantity: 1 }],
    idempotencyKey
  };
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, () => safeWrite('placeOrder', body))
  );
  const successful = results.filter(result => result.data?.success);
  const orderNos = [...new Set(successful.map(result => result.data.orderNo))];
  addCheck('Idempotent concurrent requests all resolve', successful.length === CONCURRENCY, `success=${successful.length}`);
  addCheck('Idempotent concurrent requests create one order', orderNos.length === 1, `orders=${orderNos.length}`);

  const orders = await getAdminOrders();
  const storedRows = (orders?.orders || []).filter(order => order.orderNo === orderNos[0]);
  const state = await verifyUserAndSnack(user.userId, snack.snackId);
  addCheck('Idempotent order stored once', storedRows.length === 1, `rows=${storedRows.length}`);
  addCheck('Idempotent stock decremented once', Number(state.snack?.stock) === 29, `stock=${state.snack?.stock}`);
  addCheck('Idempotent credit decremented once', Number(state.user?.credit) === 14, `credit=${state.user?.credit}`);

  const firstCancel = await safeWrite('cancelOrder', { orderId: orderNos[0], adminMemo: 'stability cleanup' }, 'cleanup');
  const secondCancel = await safeWrite('cancelOrder', { orderId: orderNos[0], adminMemo: 'stability duplicate cancel' }, 'cleanup');
  addCheck('First cancel succeeds', firstCancel.data?.success === true);
  addCheck('Duplicate cancel has no second effect', secondCancel.data?.success === false);
  const cancelledState = await verifyUserAndSnack(user.userId, snack.snackId);
  addCheck('Cancel restores stock exactly once', Number(cancelledState.snack?.stock) === 30, `stock=${cancelledState.snack?.stock}`);
  addCheck('Cancel restores credit exactly once', Number(cancelledState.user?.credit) === 15, `credit=${cancelledState.user?.credit}`);
}

async function runOrderRollbackScenario(fixtures) {
  const user = fixtures.users[0];
  const snack = fixtures.snacks[0];
  for (const stage of ['order', 'stock', 'credit']) {
    await resetCredit(user.userId);
    await resetStock(snack.snackId, 30);
    const idempotencyKey = `stab.rollback.${stage}.${RUN_ID}`;
    const failed = await safeWrite('placeOrder', {
      userId: user.userId,
      items: [{ snackId: snack.snackId, quantity: 1 }],
      idempotencyKey,
      testFailureStage: stage
    }, 'business-rule');
    addCheck(`Rollback ${stage} failure is explicit`, failed.data?.success === false);
    const rolledBack = await verifyUserAndSnack(user.userId, snack.snackId);
    addCheck(`Rollback ${stage} restores stock`, Number(rolledBack.snack?.stock) === 30, `stock=${rolledBack.snack?.stock}`);
    addCheck(`Rollback ${stage} restores credit`, Number(rolledBack.user?.credit) === 15, `credit=${rolledBack.user?.credit}`);

    if (stage === 'credit') {
      const retried = await safeWrite('placeOrder', {
        userId: user.userId,
        items: [{ snackId: snack.snackId, quantity: 1 }],
        idempotencyKey
      });
      addCheck('Failed idempotency key can be retried', retried.data?.success === true);
      if (retried.data?.orderNo) await cancelOrders([retried.data.orderNo]);
    }
  }
}

async function runConcurrentScenario(fixtures) {
  const snack = fixtures.snacks[1];
  await resetStock(snack.snackId, CONCURRENCY);
  await Promise.all(fixtures.users.map(user => resetCredit(user.userId)));
  const results = await Promise.all(fixtures.users.map((user, index) => safeWrite('placeOrder', {
    userId: user.userId,
    items: [{ snackId: snack.snackId, quantity: 1 }],
    idempotencyKey: `stab.concurrent.${RUN_ID}.${index}`
  })));
  const successes = results.filter(result => result.data?.success);
  const orderNos = [...new Set(successes.map(result => result.data.orderNo))];
  addCheck('Unique concurrent orders succeed', successes.length === CONCURRENCY, `success=${successes.length}`);
  addCheck('Unique concurrent orders remain unique', orderNos.length === CONCURRENCY, `orders=${orderNos.length}`);

  const dashboard = await getAdminDashboard();
  const snackState = (dashboard?.snacks?.snacks || []).find(item => String(item.snackId) === String(snack.snackId));
  addCheck('Concurrent stock reaches zero exactly', Number(snackState?.stock) === 0, `stock=${snackState?.stock}`);
  await cancelOrders(orderNos);

  const restored = await getAdminDashboard();
  const restoredSnack = (restored?.snacks?.snacks || []).find(item => String(item.snackId) === String(snack.snackId));
  const restoredUsers = fixtures.users.map(user => (
    (restored?.users?.users || []).find(item => String(item.userId) === String(user.userId))
  ));
  addCheck('Concurrent cancellations restore stock', Number(restoredSnack?.stock) === CONCURRENCY, `stock=${restoredSnack?.stock}`);
  addCheck('Concurrent cancellations restore credits', restoredUsers.every(user => Number(user?.credit) === 15));
}

async function runOversubscriptionScenario(fixtures) {
  const snack = fixtures.snacks[2];
  await resetStock(snack.snackId, 5);
  await Promise.all(fixtures.users.map(user => resetCredit(user.userId)));
  const results = await Promise.all(fixtures.users.map((user, index) => safeWrite('placeOrder', {
    userId: user.userId,
    items: [{ snackId: snack.snackId, quantity: 1 }],
    idempotencyKey: `stab.oversub.${RUN_ID}.${index}`
  }, 'business-rule')));
  const successes = results.filter(result => result.data?.success);
  const failures = results.filter(result => !result.data?.success);
  addCheck('Oversubscription accepts only available stock', successes.length === 5, `success=${successes.length}`);
  addCheck('Oversubscription failures are explicit', failures.every(result => result.metric.errorType === 'stock'), `failures=${failures.length}`);

  const dashboard = await getAdminDashboard();
  const snackState = (dashboard?.snacks?.snacks || []).find(item => String(item.snackId) === String(snack.snackId));
  addCheck('Oversubscribed stock never becomes negative', Number(snackState?.stock) === 0, `stock=${snackState?.stock}`);
  await cancelOrders(successes.map(result => result.data.orderNo));
}

async function runGuestAndReviewScenario(fixtures) {
  const settingsResult = await readApi('getGuestSettings', { kind: 'verification' });
  const previousSettings = settingsResult.data || {};
  const snack = fixtures.snacks[0];
  await resetStock(snack.snackId, 30);
  let orderNo = '';
  try {
    for (const schedule of (previousSettings.guestAdditionalSchedules || [])) {
      const removed = await adminWrite('updateGuestSettings', {
        settingsAction: 'deleteAdditionalSchedule',
        scheduleId: schedule.scheduleId,
        adminMemo: 'stability additional schedule pause'
      }, 'setup');
      if (!removed.data?.success) throw new Error('Cannot pause guest additional schedule in staging.');
    }
    const scheduleDisabled = await adminWrite('updateGuestSettings', {
      settingsAction: 'updateWeeklySchedule',
      guestWeeklyScheduleEnabled: false,
      guestWeeklyScheduleDay: previousSettings.guestWeeklyScheduleDay || 3,
      guestWeeklyScheduleStartTime: previousSettings.guestWeeklyScheduleStartTime || '13:00',
      guestWeeklyScheduleEndTime: previousSettings.guestWeeklyScheduleEndTime || '15:00',
      adminMemo: 'stability guest schedule pause'
    }, 'setup');
    if (!scheduleDisabled.data?.success) throw new Error('Cannot pause guest weekly schedule in staging.');

    const opened = await adminWrite('updateGuestSettings', {
      settingsAction: 'openUntil',
      guestManualEndTime: formatKstTime(new Date(Date.now() + 15 * 60 * 1000)),
      adminMemo: 'stability guest test'
    }, 'setup');
    if (!opened.data?.success) throw new Error('Cannot open guest mode in staging.');

    const guestDeviceId = `STAB-${RUN_ID}`;
    const order = await safeWrite('placeOrder', {
      userId: 'guest',
      guestName: 'STAB Guest',
      guestDeviceId,
      orderStartedAt: new Date().toISOString(),
      deliveryType: 'pickup',
      items: [{ snackId: snack.snackId, quantity: 1 }],
      idempotencyKey: `stab.guest.${RUN_ID}`
    });
    addCheck('Guest staging order succeeds', order.data?.success === true);
    if (!order.data?.success) return;
    orderNo = order.data.orderNo;
    const orderToken = order.data.orderToken;

    const ownOrder = await readApi('getGuestOrderByToken', {
      method: 'POST',
      body: { tokens: [orderToken], includeArchived: false },
      kind: 'verification'
    });
    addCheck('Guest token reads only owned order', ownOrder.data?.success === true && ownOrder.data?.orders?.every(item => item.orderToken === orderToken));

    const served = await adminWrite('updateOrderServed', {
      orderId: orderNo,
      servedYn: 'Y',
      adminMemo: 'stability review test'
    });
    addCheck('Guest order reaches served state', served.data?.success === true);

    const reviewComment = `STAB review ${RUN_ID}`;
    const reviewBody = {
      orderId: orderNo,
      orderToken,
      guestName: 'STAB Guest',
      stamp: '최고예요',
      tags: '#stability',
      comment: reviewComment,
      isPublic: true
    };
    const review = await requestApi('submitReview', { method: 'POST', body: reviewBody, kind: 'write' });
    const duplicate = await requestApi('submitReview', { method: 'POST', body: reviewBody, kind: 'business-rule' });
    addCheck('Guest review succeeds once', review.data?.success === true);
    addCheck('Duplicate guest review is rejected', duplicate.data?.success === false);

    const replyText = `STAB reply ${RUN_ID}`;
    const reply = await safeWrite('submitReviewReply', {
      orderId: orderNo,
      replyText,
      adminMemo: 'stability review reply'
    });
    addCheck('Guest review reply succeeds', reply.data?.success === true);

    const publicReviews = await readApi('getPublicReviews', { kind: 'verification' });
    const publicRows = publicReviews.data?.reviews || publicReviews.data?.data || [];
    const publishedReview = publicRows.find(item => item.comment === reviewComment);
    addCheck('Published review cache is refreshed', Boolean(publishedReview), `rows=${publicRows.length}`);
    addCheck('Published reply cache is refreshed', publishedReview?.replyText === replyText);
  } finally {
    if (orderNo) await cancelOrders([orderNo]);
    await adminWrite('updateGuestSettings', { settingsAction: 'closeNow', adminMemo: 'stability manual close' }, 'cleanup');
    await adminWrite('updateGuestSettings', {
      settingsAction: 'updateWeeklySchedule',
      guestWeeklyScheduleEnabled: previousSettings.guestWeeklyScheduleEnabled === true,
      guestWeeklyScheduleDay: previousSettings.guestWeeklyScheduleDay || 3,
      guestWeeklyScheduleStartTime: previousSettings.guestWeeklyScheduleStartTime || '13:00',
      guestWeeklyScheduleEndTime: previousSettings.guestWeeklyScheduleEndTime || '15:00',
      adminMemo: 'stability schedule restore'
    }, 'cleanup');
    if (!previousSettings.guestWeeklyScheduleSkipped) {
      await adminWrite('updateGuestSettings', { settingsAction: 'resumeWeeklyScheduleOccurrence', adminMemo: 'stability schedule resume restore' }, 'cleanup');
    }
    for (const schedule of (previousSettings.guestAdditionalSchedules || [])) {
      await adminWrite('updateGuestSettings', {
        settingsAction: 'upsertAdditionalSchedule',
        date: schedule.date,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        adminMemo: 'stability additional schedule restore'
      }, 'cleanup');
    }
    const wasOpen = previousSettings.guestOpen === 'Y';
    if (wasOpen) {
      if (!previousSettings.guestWeeklyScheduleSkipped) {
        const previousCloseAt = new Date(previousSettings.guestCloseAt);
        const fallbackCloseAt = new Date(Date.now() + 10 * 60 * 1000);
        await adminWrite('updateGuestSettings', {
          settingsAction: 'openUntil',
          guestManualEndTime: formatKstTime(!isNaN(previousCloseAt.getTime()) && previousCloseAt > new Date() ? previousCloseAt : fallbackCloseAt),
          adminMemo: 'stability manual restore'
        }, 'cleanup');
      }
    }
  }
}

function applicationSettingsBody(settings, applicationOpen) {
  return {
    applicationOpen,
    capacity: settings.capacity || 100,
    target: settings.target,
    operatingDays: settings.operatingDays,
    orderTime: settings.orderTime,
    deliveryTime: settings.deliveryTime,
    serviceArea: settings.serviceArea,
    usageGuide: settings.usageGuide,
    preferredDayOptions: (settings.preferredDayOptions || []).join(','),
    closedMessage: settings.configuredClosedMessage || settings.closedMessage,
    cooldownWeeks: settings.cooldownWeeks,
    waitlistLimit: settings.waitlistLimit
  };
}

async function runApplicationScenario() {
  const settingsResult = await readApi('getGuestApplicationSettings', { kind: 'verification' });
  const settings = settingsResult.data || {};
  if (!settings.target || !(settings.preferredDayOptions || []).length) {
    addCheck('Application staging settings are usable', false, 'required settings missing');
    return;
  }

  try {
    const opened = await adminWrite('updateGuestApplicationSettings', {
      ...applicationSettingsBody(settings, true),
      adminMemo: 'stability application test'
    }, 'setup');
    if (!opened.data?.success) throw new Error('Cannot open applications in staging.');

    const phoneSuffix = String(Date.now()).slice(-8);
    const body = {
      requestId: `stab-application-${RUN_ID}`,
      name: 'STAB Applicant',
      relationType: 'OTHER',
      relationDetail: 'stability test',
      phone: `010${phoneSuffix}`,
      deliveryPlace: 'STAB Test Place',
      deliveryDetail: '',
      preferredDays: [settings.preferredDayOptions[0]],
      message: 'stability test',
      consent: true,
      website: ''
    };
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => requestApi('submitGuestApplication', {
        method: 'POST',
        body,
        kind: 'write',
        timeoutMs: 60000
      }))
    );
    const successes = results.filter(result => result.data?.success);
    const applicationIds = [...new Set(successes.map(result => result.data.applicationId))];
    addCheck('Application idempotency resolves all requests', successes.length === CONCURRENCY, `success=${successes.length}`);
    addCheck('Application idempotency creates one application', applicationIds.length === 1, `applications=${applicationIds.length}`);
  } finally {
    await adminWrite('updateGuestApplicationSettings', {
      ...applicationSettingsBody(settings, settings.applicationOpenConfigured === true),
      adminMemo: 'stability restore'
    }, 'cleanup');
  }
}

async function runFullSuite() {
  if (!ADMIN_TOKEN) throw new Error('KIOSK_ADMIN_TOKEN is required for full mode.');
  const diagnosis = await adminRead('diagnoseSystem', {}, 'preflight');
  const stagingReady = diagnosis.data?.mode === 'detailed'
    && diagnosis.data?.environment === 'staging'
    && diagnosis.data?.apiContractVersion === EXPECTED_API_VERSION;
  addCheck('Full mode staging guard', stagingReady, `environment=${diagnosis.data?.environment || 'missing'}`);
  if (!stagingReady) throw new Error('Full mode is blocked unless diagnoseSystem reports the expected staging environment.');

  const fixtures = await seedFixtures();
  addCheck('Stability fixtures are ready', fixtures.users.length === CONCURRENCY && fixtures.snacks.length === 3);
  await runIdempotencyScenario(fixtures);
  await runOrderRollbackScenario(fixtures);
  await runConcurrentScenario(fixtures);
  await runOversubscriptionScenario(fixtures);
  await runGuestAndReviewScenario(fixtures);
  await runApplicationScenario();
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[Math.max(0, index)];
}

function buildSummary() {
  const measuredKinds = new Set(['read', 'burst', 'observation-cold', 'observation-warm']);
  const measured = report.requests.filter(item => measuredKinds.has(item.kind));
  const firstAttempts = measured.filter(item => item.attempt === 1);
  const finalAttempts = [...measured.reduce((map, item) => {
    const previous = map.get(item.requestId);
    if (!previous || item.attempt > previous.attempt) map.set(item.requestId, item);
    return map;
  }, new Map()).values()];
  const grouped = {};
  for (const item of measured) {
    if (!grouped[item.action]) grouped[item.action] = [];
    grouped[item.action].push(item);
  }
  const byAction = {};
  for (const [action, rows] of Object.entries(grouped)) {
    const durations = rows.map(row => row.durationMs);
    byAction[action] = {
      requests: rows.length,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      maxMs: Math.max(...durations),
      successRate: rows.filter(row => row.transportSuccess && row.apiSuccess).length / rows.length
    };
  }
  const firstSuccesses = firstAttempts.filter(item => item.transportSuccess && item.apiSuccess).length;
  const finalSuccesses = finalAttempts.filter(item => item.transportSuccess && item.apiSuccess).length;
  const warmDurations = measured
    .filter(item => item.kind === 'observation-warm')
    .map(item => item.durationMs);
  const coldDurations = measured
    .filter(item => item.kind === 'observation-cold')
    .map(item => item.durationMs);
  const firstAttemptSuccessRate = firstAttempts.length ? firstSuccesses / firstAttempts.length : 0;
  const finalSuccessRate = finalAttempts.length ? finalSuccesses / finalAttempts.length : 0;
  const retryRate = finalAttempts.length
    ? measured.filter(item => item.attempt > 1).length / finalAttempts.length
    : 0;
  const acceptance = {
    finalSuccessRate: { value: finalSuccessRate, target: 1, passed: finalSuccessRate === 1 },
    firstAttemptSuccessRate: { value: firstAttemptSuccessRate, target: 0.95, passed: firstAttemptSuccessRate >= 0.95 },
    retryRate: { value: retryRate, targetMax: 0.05, passed: retryRate <= 0.05 },
    warmP95Ms: {
      value: warmDurations.length ? percentile(warmDurations, 0.95) : null,
      targetMax: 10000,
      passed: warmDurations.length ? percentile(warmDurations, 0.95) <= 10000 : null
    },
    coldMaxMs: {
      value: coldDurations.length ? Math.max(...coldDurations) : null,
      targetMax: 30000,
      passed: coldDurations.length ? Math.max(...coldDurations) <= 30000 : null
    }
  };
  const measuredAcceptance = Object.values(acceptance).filter(item => item.passed !== null);
  report.summary = {
    checks: report.checks.length,
    passedChecks: report.checks.filter(check => check.passed).length,
    failedChecks: report.checks.filter(check => !check.passed).length,
    finalSuccessRate,
    firstAttemptSuccessRate,
    retryRate,
    byAction,
    acceptance,
    classification: report.checks.some(check => !check.passed)
      ? 'immediate-fix'
      : (measuredAcceptance.some(item => item.passed === false) ? 'observe' : 'pass')
  };
}

function writeReport() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  buildSummary();
  const file = path.join(OUTPUT_DIR, `stability-${RUN_ID}-${MODE}.json`);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return file;
}

async function main() {
  if (!API_URL) throw new Error('KIOSK_API_URL is required.');
  if (!['read', 'full'].includes(MODE)) throw new Error('KIOSK_STABILITY_MODE must be read or full.');
  if (MODE === 'full' && CONCURRENCY !== 10) {
    throw new Error('Full mode requires KIOSK_CONCURRENCY=10.');
  }
  const parsedUrl = new URL(API_URL);
  if (parsedUrl.protocol !== 'https:' || !/\/exec$/.test(parsedUrl.pathname)) {
    throw new Error('KIOSK_API_URL must be an HTTPS Apps Script /exec URL.');
  }

  await runReadSuite();
  if (MODE === 'full') await runFullSuite();
  if (BURST_ENABLED) await runBurstSuite();

  if (OBSERVE_HOURS > 0) {
    const rounds = Math.max(1, Math.ceil((OBSERVE_HOURS * 60) / OBSERVE_INTERVAL_MINUTES));
    report.observation.rounds = rounds;
    for (let round = 1; round <= rounds; round++) {
      await runObservationRound(round);
      writeReport();
      if (round < rounds) await wait(OBSERVE_INTERVAL_MINUTES * 60 * 1000);
    }
  }

  report.finishedAt = new Date().toISOString();
  const file = writeReport();
  process.stdout.write(`\nResult: ${file}\n`);
  process.stdout.write(`Checks: ${report.summary.passedChecks}/${report.summary.checks} passed\n`);
  if (report.summary.failedChecks > 0) process.exitCode = 1;
}

main().catch(error => {
  addCheck('Runner completed', false, error.message || error);
  report.finishedAt = new Date().toISOString();
  const file = writeReport();
  process.stderr.write(`\nStability check failed: ${sanitizeText(error.message || error)}\n`);
  process.stderr.write(`Result: ${file}\n`);
  process.exitCode = 1;
});
