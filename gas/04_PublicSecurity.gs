const KAKAO_AUTH_PROOF_VERSION = 1;
const KAKAO_AUTH_PROOF_TTL_SECONDS = 12 * 60 * 60;
const KAKAO_AUTH_PROOF_MAX_LENGTH = 2048;
const KAKAO_AUTH_PROOF_CLOCK_SKEW_SECONDS = 60;

const PUBLIC_RATE_LIMIT_POLICIES = {
  placeOrder: { windowSeconds: 60, principalLimit: 5, globalLimit: 60 },
  submitGuestApplication: { windowSeconds: 600, principalLimit: 3, globalLimit: 30 },
  exchangeKakaoAuthCode: { windowSeconds: 600, principalLimit: 5, globalLimit: 60 },
};

function getKakaoAuthProofSecret_() {
  return String(PropertiesService.getScriptProperties().getProperty('KAKAO_AUTH_PROOF_SECRET') || '').trim();
}

function isKakaoAuthProofSecretConfigured_() {
  return getKakaoAuthProofSecret_().length >= 32;
}

function encodeWebSafeString_(value) {
  return Utilities.base64EncodeWebSafe(String(value || ''), Utilities.Charset.UTF_8).replace(/=+$/, '');
}

function decodeWebSafeString_(value) {
  const encoded = String(value || '');
  const padding = encoded.length % 4 === 0 ? '' : '='.repeat(4 - (encoded.length % 4));
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(encoded + padding)).getDataAsString('UTF-8');
}

function signKakaoAuthProofPart_(payloadPart, secret) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(String(payloadPart || ''), secret, Utilities.Charset.UTF_8)
  ).replace(/=+$/, '');
}

function constantTimeStringEquals_(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return difference === 0;
}

function createKakaoAuthProof_(guestKey, nowValue) {
  const normalizedGuestKey = String(guestKey || '').trim();
  const secret = getKakaoAuthProofSecret_();
  if (!isKakaoAuthProofSecretConfigured_()) throw new Error('KAKAO_AUTH_PROOF_SECRET은 32자 이상의 강한 무작위 값으로 설정해야 합니다.');
  if (!/^kakao_[A-Za-z0-9_-]{6,80}$/.test(normalizedGuestKey)) {
    throw new Error('카카오 게스트 식별값이 올바르지 않습니다.');
  }

  const issuedAt = Math.floor(new Date(nowValue || new Date()).getTime() / 1000);
  const payload = {
    v: KAKAO_AUTH_PROOF_VERSION,
    provider: 'kakao',
    sub: normalizedGuestKey,
    iat: issuedAt,
    exp: issuedAt + KAKAO_AUTH_PROOF_TTL_SECONDS,
    sid: Utilities.getUuid().replace(/-/g, ''),
  };
  const payloadPart = encodeWebSafeString_(JSON.stringify(payload));
  return {
    token: payloadPart + '.' + signKakaoAuthProofPart_(payloadPart, secret),
    payload,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

function kakaoAuthFailure_(errorCode, message) {
  return { success: false, errorCode, message };
}

function verifyKakaoAuthProof_(proof, nowValue) {
  const token = String(proof || '').trim();
  if (!token) return kakaoAuthFailure_('KAKAO_AUTH_REQUIRED', '카카오 로그인이 필요합니다. 다시 로그인해 주세요.');
  if (token.length > KAKAO_AUTH_PROOF_MAX_LENGTH) {
    return kakaoAuthFailure_('KAKAO_AUTH_INVALID', '카카오 로그인 확인 정보가 올바르지 않습니다.');
  }

  const secret = getKakaoAuthProofSecret_();
  if (!isKakaoAuthProofSecretConfigured_()) return kakaoAuthFailure_('KAKAO_AUTH_INVALID', '카카오 로그인 보안 설정을 확인해 주세요.');
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return kakaoAuthFailure_('KAKAO_AUTH_INVALID', '카카오 로그인 확인 정보가 올바르지 않습니다.');
  }

  const expectedSignature = signKakaoAuthProofPart_(parts[0], secret);
  if (!constantTimeStringEquals_(parts[1], expectedSignature)) {
    return kakaoAuthFailure_('KAKAO_AUTH_INVALID', '카카오 로그인 확인 정보가 올바르지 않습니다.');
  }

  let payload;
  try {
    payload = JSON.parse(decodeWebSafeString_(parts[0]));
  } catch (error) {
    return kakaoAuthFailure_('KAKAO_AUTH_INVALID', '카카오 로그인 확인 정보가 올바르지 않습니다.');
  }

  const issuedAt = Number(payload && payload.iat);
  const expiresAt = Number(payload && payload.exp);
  const nowSeconds = Math.floor(new Date(nowValue || new Date()).getTime() / 1000);
  if (!payload || payload.v !== KAKAO_AUTH_PROOF_VERSION || payload.provider !== 'kakao'
      || !/^kakao_[A-Za-z0-9_-]{6,80}$/.test(String(payload.sub || ''))
      || !Number.isInteger(issuedAt) || !Number.isInteger(expiresAt)
      || !/^[A-Za-z0-9]{16,80}$/.test(String(payload.sid || ''))
      || expiresAt - issuedAt !== KAKAO_AUTH_PROOF_TTL_SECONDS) {
    return kakaoAuthFailure_('KAKAO_AUTH_INVALID', '카카오 로그인 확인 정보가 올바르지 않습니다.');
  }
  if (issuedAt > nowSeconds + KAKAO_AUTH_PROOF_CLOCK_SKEW_SECONDS) {
    return kakaoAuthFailure_('KAKAO_AUTH_INVALID', '카카오 로그인 발급 시각이 올바르지 않습니다.');
  }
  if (expiresAt <= nowSeconds - KAKAO_AUTH_PROOF_CLOCK_SKEW_SECONDS) {
    return kakaoAuthFailure_('KAKAO_AUTH_EXPIRED', '카카오 로그인 시간이 만료되었습니다. 다시 로그인해 주세요.');
  }

  return {
    success: true,
    provider: 'kakao',
    guestKey: String(payload.sub),
    issuedAt: new Date(issuedAt * 1000).toISOString(),
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    sessionId: String(payload.sid),
  };
}

function getKakaoAuthProofLegacyUntil_() {
  const raw = String(PropertiesService.getScriptProperties().getProperty('KAKAO_AUTH_PROOF_LEGACY_UNTIL') || '').trim();
  if (!raw) return { configured: false, valid: true, active: false, value: '' };
  const timestamp = new Date(raw).getTime();
  return {
    configured: true,
    valid: Number.isFinite(timestamp),
    active: Number.isFinite(timestamp) && timestamp > Date.now(),
    value: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : raw,
  };
}

function resolveKakaoRequestIdentity_(data, options) {
  const request = data || {};
  const settings = options || {};
  const authProvider = String(request.authProvider || '').trim().toLowerCase();
  const claimedGuestKey = String(request.guestKey || '').trim();
  const proof = String(request.kakaoAuthProof || '').trim();
  const claimsKakao = authProvider === 'kakao' || !!claimedGuestKey || !!proof;
  if (!claimsKakao) {
    return settings.required === true
      ? kakaoAuthFailure_('KAKAO_AUTH_REQUIRED', '카카오 로그인이 필요합니다. 다시 로그인해 주세요.')
      : { success: true, isKakao: false, provider: '', guestKey: '' };
  }
  if (authProvider && authProvider !== 'kakao') {
    return kakaoAuthFailure_('KAKAO_AUTH_INVALID', '카카오 로그인 제공자 정보가 올바르지 않습니다.');
  }

  if (!proof) {
    const legacy = getKakaoAuthProofLegacyUntil_();
    if (legacy.active && isKakaoAuthProofSecretConfigured_() && authProvider === 'kakao'
        && /^kakao_[A-Za-z0-9_-]{6,80}$/.test(claimedGuestKey)) {
      return { success: true, isKakao: true, provider: 'kakao', guestKey: claimedGuestKey, legacy: true };
    }
    return kakaoAuthFailure_('KAKAO_AUTH_REQUIRED', '카카오 로그인이 갱신되었습니다. 다시 로그인해 주세요.');
  }

  const verified = verifyKakaoAuthProof_(proof);
  if (!verified.success) return verified;
  if (claimedGuestKey && claimedGuestKey !== verified.guestKey) {
    return kakaoAuthFailure_('KAKAO_AUTH_INVALID', '카카오 로그인 이용자 정보가 일치하지 않습니다.');
  }
  return Object.assign({ isKakao: true, legacy: false }, verified);
}

function hashPublicRateLimitKey_(value) {
  const secret = getKakaoAuthProofSecret_();
  if (!isKakaoAuthProofSecretConfigured_()) throw new Error('요청 제한 서명키가 설정되지 않았습니다.');
  return signKakaoAuthProofPart_('rate:' + String(value || ''), secret).slice(0, 32);
}

function checkPublicRateLimit_(policyName, principal, requestId, nowValue) {
  const policy = PUBLIC_RATE_LIMIT_POLICIES[policyName];
  if (!policy) return { success: true };
  const safePrincipal = String(principal || '').trim();
  if (!safePrincipal) return { success: true };

  let lock;
  let locked = false;
  try {
    const nowMs = new Date(nowValue || new Date()).getTime();
    const windowMs = policy.windowSeconds * 1000;
    const windowStart = Math.floor(nowMs / windowMs) * windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + windowMs - nowMs) / 1000));
    const cache = CacheService.getScriptCache();
    const principalHash = hashPublicRateLimitKey_(policyName + ':' + safePrincipal);
    const requestHash = requestId
      ? hashPublicRateLimitKey_(policyName + ':' + safePrincipal + ':' + String(requestId))
      : '';
    const prefix = 'p110:' + policyName + ':' + windowStart + ':';
    const seenKey = requestHash ? prefix + 'seen:' + requestHash : '';
    if (seenKey && cache.get(seenKey)) return { success: true, idempotentRetry: true };

    lock = LockService.getScriptLock();
    locked = lock.tryLock(250);
    if (!locked) return { success: true, failOpen: true };

    if (seenKey && cache.get(seenKey)) return { success: true, idempotentRetry: true };
    const principalKey = prefix + 'principal:' + principalHash;
    const globalKey = prefix + 'global';
    const principalCount = Number(cache.get(principalKey) || 0);
    const globalCount = Number(cache.get(globalKey) || 0);
    if (principalCount >= policy.principalLimit || globalCount >= policy.globalLimit) {
      return {
        success: false,
        errorCode: 'RATE_LIMITED',
        retryAfterSeconds,
        message: '요청이 너무 빠르게 반복되었습니다. 잠시 후 다시 시도해 주세요.',
      };
    }

    const cacheTtl = retryAfterSeconds + 5;
    cache.put(principalKey, String(principalCount + 1), cacheTtl);
    cache.put(globalKey, String(globalCount + 1), cacheTtl);
    if (seenKey) cache.put(seenKey, '1', cacheTtl);
    return { success: true, remaining: Math.max(0, policy.principalLimit - principalCount - 1) };
  } catch (error) {
    Logger.log(JSON.stringify({ event: 'public_rate_limit_fail_open', policy: String(policyName || '') }));
    return { success: true, failOpen: true };
  } finally {
    if (locked && lock) lock.releaseLock();
  }
}
