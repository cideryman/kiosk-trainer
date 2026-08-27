const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const properties = {
  KAKAO_AUTH_PROOF_SECRET: 'test-proof-secret-with-at-least-32-characters'
};
const cacheValues = new Map();
let uuid = 0;
const toBuffer = value => Array.isArray(value) ? Buffer.from(value) : Buffer.from(String(value), 'utf8');
const context = {
  console,
  Date,
  JSON,
  Math,
  Number,
  String,
  Logger: { log: () => {} },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: key => properties[key] || null,
    setProperty: (key, value) => { properties[key] = String(value); },
    deleteProperty: key => { delete properties[key]; }
  }) },
  CacheService: { getScriptCache: () => ({
    get: key => cacheValues.has(key) ? cacheValues.get(key) : null,
    put: (key, value) => { cacheValues.set(key, String(value)); },
    remove: key => cacheValues.delete(key)
  }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  Utilities: {
    Charset: { UTF_8: 'UTF-8' },
    base64EncodeWebSafe: value => toBuffer(value).toString('base64url'),
    base64DecodeWebSafe: value => Array.from(Buffer.from(String(value), 'base64url')),
    computeHmacSha256Signature: (value, key) => Array.from(crypto.createHmac('sha256', String(key)).update(String(value)).digest()),
    newBlob: value => ({ getDataAsString: () => toBuffer(value).toString('utf8') }),
    getUuid: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'gas/04_PublicSecurity.gs'), 'utf8'), context);

const guestKey = 'kakao_abcdefghijklmnopqrstuvwxyz123456';
const issuedAt = new Date('2026-08-28T00:00:00.000Z');
const proof = context.createKakaoAuthProof_(guestKey, issuedAt);
assert.equal(context.verifyKakaoAuthProof_(proof.token, new Date('2026-08-28T06:00:00.000Z')).guestKey, guestKey);
assert.equal(proof.expiresAt, '2026-08-28T12:00:00.000Z');

const [payloadPart, signaturePart] = proof.token.split('.');
assert.equal(context.verifyKakaoAuthProof_(`${payloadPart}.${signaturePart.slice(0, -1)}x`, issuedAt).errorCode, 'KAKAO_AUTH_INVALID');
assert.equal(context.verifyKakaoAuthProof_(proof.token, new Date('2026-08-28T12:02:00.000Z')).errorCode, 'KAKAO_AUTH_EXPIRED');

const futureProof = context.createKakaoAuthProof_(guestKey, new Date('2026-08-29T00:00:00.000Z'));
assert.equal(context.verifyKakaoAuthProof_(futureProof.token, issuedAt).errorCode, 'KAKAO_AUTH_INVALID');

const decoded = JSON.parse(context.decodeWebSafeString_(payloadPart));
decoded.v = 99;
const wrongVersionPart = context.encodeWebSafeString_(JSON.stringify(decoded));
const wrongVersionToken = `${wrongVersionPart}.${context.signKakaoAuthProofPart_(wrongVersionPart, properties.KAKAO_AUTH_PROOF_SECRET)}`;
assert.equal(context.verifyKakaoAuthProof_(wrongVersionToken, issuedAt).errorCode, 'KAKAO_AUTH_INVALID');

assert.equal(context.resolveKakaoRequestIdentity_({ authProvider: 'kakao', guestKey }).errorCode, 'KAKAO_AUTH_REQUIRED');
properties.KAKAO_AUTH_PROOF_LEGACY_UNTIL = new Date(Date.now() + 60_000).toISOString();
assert.equal(context.resolveKakaoRequestIdentity_({ authProvider: 'kakao', guestKey }).legacy, true);
delete properties.KAKAO_AUTH_PROOF_SECRET;
assert.equal(context.resolveKakaoRequestIdentity_({ authProvider: 'kakao', guestKey }).errorCode, 'KAKAO_AUTH_REQUIRED');
assert.equal(context.verifyKakaoAuthProof_(proof.token, issuedAt).errorCode, 'KAKAO_AUTH_INVALID');
assert.throws(() => context.createKakaoAuthProof_(guestKey), /32자/);
properties.KAKAO_AUTH_PROOF_SECRET = 'test-proof-secret-with-at-least-32-characters';
delete properties.KAKAO_AUTH_PROOF_LEGACY_UNTIL;

const currentProof = context.createKakaoAuthProof_(guestKey);
assert.equal(context.resolveKakaoRequestIdentity_({
  authProvider: 'kakao', guestKey: 'kakao_other_user_123456', kakaoAuthProof: currentProof.token
}).errorCode, 'KAKAO_AUTH_INVALID');

cacheValues.clear();
for (let i = 1; i <= 5; i++) {
  assert.equal(context.checkPublicRateLimit_('placeOrder', `kakao:${guestKey}`, `order-${i}`).success, true);
}
assert.equal(context.checkPublicRateLimit_('placeOrder', `kakao:${guestKey}`, 'order-1').idempotentRetry, true);
const limitedOrder = context.checkPublicRateLimit_('placeOrder', `kakao:${guestKey}`, 'order-6');
assert.equal(limitedOrder.errorCode, 'RATE_LIMITED');
assert(limitedOrder.retryAfterSeconds > 0);

cacheValues.clear();
for (let i = 1; i <= 3; i++) {
  assert.equal(context.checkPublicRateLimit_('submitGuestApplication', 'phone:01012345678', `application-${i}`).success, true);
}
assert.equal(context.checkPublicRateLimit_('submitGuestApplication', 'phone:01012345678', 'application-1').idempotentRetry, true);
assert.equal(context.checkPublicRateLimit_('submitGuestApplication', 'phone:01012345678', 'application-4').errorCode, 'RATE_LIMITED');
assert(!JSON.stringify(Array.from(cacheValues.keys())).includes('01012345678'));
assert(!JSON.stringify(Array.from(cacheValues.keys())).includes(guestKey));

const source = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
vm.runInContext(source('gas/10_KakaoGuests.gs'), context);
vm.runInContext(source('gas/30_GuestCredits.gs'), context);
vm.runInContext(source('gas/31_OrderShared.gs'), context);
vm.runInContext(source('gas/40_Orders.gs'), context);
const orderHeaders = [
  '주문시간', '주문번호', '이용자ID', '별명', '간식ID', '간식명', '수량', '차감포인트',
  '제공여부', 'cancelTimestamp', 'orderToken', 'deliveryType', 'deliveryFee', 'totalCredit',
  'reviewed', 'deliveryPlace', 'cancelReason', 'cancelReasonDetail', 'guestDeviceId', 'authProvider',
  'guestKey', 'deliveryAddress', 'idempotencyKey', 'commitStatus'
];
const makeOrderRow = rowGuestKey => [
  new Date(), 'ORD-1', 'guest', '손님', 1, '간식', 1, 1, 'N', '', 'O-TOKEN', 'pickup', 0, 1,
  false, '', '', '', 'device-test', 'kakao', rowGuestKey, '', 'secure-order-replay', 'COMMITTED'
];
const replaySheet = { getLastRow: () => 3, getLastColumn: () => orderHeaders.length };
assert.equal(context.getExistingIdempotentOrderResult(
  replaySheet, null, orderHeaders, 'secure-order-replay', 'guest', [makeOrderRow(guestKey), makeOrderRow(guestKey)], { guestKey }
).success, true);
assert.equal(context.getExistingIdempotentOrderResult(
  replaySheet, null, orderHeaders, 'secure-order-replay', 'guest', [makeOrderRow(guestKey), makeOrderRow('kakao_other_user_123456')], { guestKey }
).errorCode, 'UNAUTHORIZED_ORDER');
const forgedRequest = {
  authProvider: 'kakao',
  guestKey,
  kakaoAuthProof: currentProof.token.slice(0, -1) + 'x'
};
assert.equal(context.getGuestProfileByGuestKey(forgedRequest).errorCode, 'KAKAO_AUTH_INVALID');
assert.equal(context.getGuestCreditStatus(forgedRequest).errorCode, 'KAKAO_AUTH_INVALID');
assert.equal(context.getGuestOrdersByGuestKey(forgedRequest).errorCode, 'KAKAO_AUTH_INVALID');
assert.equal(context.placeOrder({
  userId: 'guest',
  items: [{ snackId: 1, quantity: 1 }],
  idempotencyKey: 'secure-order-1',
  guestDeviceId: 'device-test',
  ...forgedRequest
}).errorCode, 'KAKAO_AUTH_INVALID');
assert.equal(context.getGuestCreditStatus({ authProvider: 'kakao', guestKey }).errorCode, 'KAKAO_AUTH_REQUIRED');

assert(source('gas/10_KakaoGuests.gs').includes('kakaoAuthProof: proof.token'));
assert(source('gas/30_GuestCredits.gs').includes('resolveKakaoRequestIdentity_'));
assert(source('gas/40_Orders.gs').includes("checkPublicRateLimit_('placeOrder'"));
assert(source('gas/12_GuestApplications.gs').includes("checkPublicRateLimit_(\n    'submitGuestApplication'"));
assert(source('gas/01_Router.gs').includes("action === 'getSnacks'"));
assert(source('js/app.js').includes('kakaoAuthProof: auth.kakaoAuthProof'));
assert(source('js/menu.js').includes("method: 'POST'"));
assert(source('js/config.js').includes("kakaoAuthProof: '[REDACTED]'"));
assert(!source('gas/40_Orders.gs').includes('setOptionalCell(kakaoAuthProof'));

console.log('P110 Kakao auth security tests passed: proof, expiry, binding, legacy cutoff, rate limits, privacy');
