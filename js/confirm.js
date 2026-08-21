let user = null;
let cart = [];
let deliveryType = 'pickup';

// sessionStorage에서 서버 설정값 읽기 (폴백: config.js 상수)
function getGuestFee() {
  return Number(sessionStorage.getItem('guestDeliveryFee')) || GUEST_DELIVERY_FEE;
}

const CONFIRM_NICKNAME_WORDS = {
  adjectives: ["행복한", "씩씩한", "반짝이는", "따뜻한", "용감한", "즐거운", "친절한", "신나는", "멋진", "귀여운", "사랑스러운", "슬기로운"],
  nouns: ["토끼", "해바라기", "연필", "커피잔", "구름", "별", "나무", "고양이", "강아지", "도토리", "바람", "하늘"],
  special: ["해냄이", "쭉쭉이", "여비"]
};

function generateConfirmRandomNickname() {
  const isSpecial = Math.random() < 0.08;
  const adj = CONFIRM_NICKNAME_WORDS.adjectives[Math.floor(Math.random() * CONFIRM_NICKNAME_WORDS.adjectives.length)];
  if (isSpecial) {
    const char = CONFIRM_NICKNAME_WORDS.special[Math.floor(Math.random() * CONFIRM_NICKNAME_WORDS.special.length)];
    return `${adj} ${char}`;
  }
  const noun = CONFIRM_NICKNAME_WORDS.nouns[Math.floor(Math.random() * CONFIRM_NICKNAME_WORDS.nouns.length)];
  return `${adj} 삼각지 ${noun}`;
}

function getHeaderDisplayName() {
  if (!user) return '';
  const isGuest = user.userId === 'guest';
  if (isGuest && user.needsGuestInfo) return '주문자 정보 입력 전';
  return user.nickname || (isGuest ? '게스트' : '');
}

function renderUserBadge() {
  const badgeContainer = document.getElementById('user-badge-container');
  if (!badgeContainer || !user) return;
  const isGuest = user.userId === 'guest';
  badgeContainer.innerHTML =
    `<span class="user-badge">${AppState.escapeHtml(getHeaderDisplayName())}${isGuestPreviewMode() ? ' (미리보기)' : (isGuest ? ' (비회원)' : ' 님')}</span>`;
}

function hasSavedKakaoGuestProfile() {
  return !!(
    user &&
    user.userId === 'guest' &&
    user.authProvider === 'kakao' &&
    user.guestKey &&
    user.guestProfileSaved &&
    String(user.nickname || '').trim()
  );
}

function getGuestOrderDisplayName() {
  if (!user || user.userId !== 'guest') return '';
  if (hasSavedKakaoGuestProfile()) {
    return String(user.nickname || '').trim();
  }
  const nameInput = document.getElementById('guest-name-confirm-input');
  return nameInput ? nameInput.value.trim() : String(user.nickname || '').trim();
}

function syncGuestOrderDisplayName(name) {
  if (!user || user.userId !== 'guest') return;
  user.nickname = name;
  user.needsGuestInfo = false;
  AppState.setSelectedUser(user);
  renderUserBadge();
}

function applyLocalGuestDisplayNamePolicy() {
  if (!user || user.userId !== 'guest') return;
  const input = document.getElementById('guest-name-confirm-input');
  const randomButton = document.getElementById('btn-confirm-random-name');
  const policyNotice = document.getElementById('local-guest-name-policy');
  const policyValue = document.getElementById('local-guest-name-value');
  const isLocalGuest = !isGuestPreviewMode() && !(user.authProvider === 'kakao' && user.guestKey);
  const savedName = isLocalGuest ? AppState.getLocalGuestDisplayName() : '';
  const isLocked = Boolean(savedName);
  const allowRandomDisplayName = sessionStorage.getItem('guestAllowRandomDisplayName') === 'true';

  if (isLocked && input) {
    input.value = savedName;
  }
  if (input) {
    input.readOnly = isLocked;
    input.setAttribute('aria-readonly', String(isLocked));
  }
  if (randomButton) randomButton.hidden = isLocked || !allowRandomDisplayName;
  if (policyNotice) policyNotice.hidden = !isLocked;
  if (policyValue) policyValue.textContent = savedName;
}

async function refreshConfirmGuestSettings() {
  if (!user || user.userId !== 'guest' || isGuestPreviewMode()) return;

  try {
    const settingsRes = await fetchAPIReadWithRetry('getGuestSettings', { timeoutMs: 30000 });
    if (!settingsRes || !settingsRes.success) return;

    if (settingsRes.guestBaseCredit !== undefined) {
      sessionStorage.setItem('guestBaseCredit', String(settingsRes.guestBaseCredit));
    }
    if (settingsRes.kakaoGuestBonusCredit !== undefined) {
      sessionStorage.setItem('kakaoGuestBonusCredit', String(settingsRes.kakaoGuestBonusCredit));
    }
    if (settingsRes.guestDeliveryFee !== undefined) {
      sessionStorage.setItem('guestDeliveryFee', String(settingsRes.guestDeliveryFee));
    }
    if (settingsRes.guestDefaultDeliveryPlace !== undefined) {
      sessionStorage.setItem('guestDefaultDeliveryPlace', String(settingsRes.guestDefaultDeliveryPlace ?? '사무실 원탁'));
    }
    sessionStorage.setItem('guestAllowRandomDisplayName', String(settingsRes.guestAllowRandomDisplayName === true));
    applyLocalGuestDisplayNamePolicy();
    updateBill();
  } catch (error) {
    console.warn('확인 화면 게스트 설정 재조회 실패:', error);
    applyLocalGuestDisplayNamePolicy();
  }
}

function isGuestPreviewMode() {
  return sessionStorage.getItem('guestPreviewMode') === 'Y' || !!(user && user.previewMode);
}

const ORDER_IDEMPOTENCY_STORAGE_KEY = 'pendingPlaceOrderIdempotency';

function generateOrderIdempotencyKey() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return `order-${window.crypto.randomUUID()}`;
  }
  const randomPart = Math.random().toString(36).slice(2, 12);
  return `order-${Date.now()}-${randomPart}`;
}

function buildOrderAttemptSignature(isGuest, selectedDeliveryType, deliveryPlace) {
  const normalizedItems = cart
    .map(item => ({
      snackId: String(item.snackId),
      quantity: Number(item.quantity || 0),
    }))
    .sort((a, b) => a.snackId.localeCompare(b.snackId));

  return JSON.stringify({
    userId: user ? String(user.userId || '') : '',
    guestDeviceId: isGuest ? AppState.getGuestDeviceId() : '',
    authProvider: isGuest && user && user.authProvider === 'kakao' ? 'kakao' : '',
    guestKey: isGuest && user && user.guestKey ? String(user.guestKey) : '',
    nickname: isGuest && user ? String(user.nickname || '') : '',
    deliveryType: isGuest ? selectedDeliveryType : 'pickup',
    deliveryPlace: isGuest && selectedDeliveryType === 'delivery' ? String(deliveryPlace || '').trim() : '',
    items: normalizedItems,
  });
}

function getOrderIdempotencyKey(signature) {
  try {
    const stored = JSON.parse(sessionStorage.getItem(ORDER_IDEMPOTENCY_STORAGE_KEY) || 'null');
    if (stored && stored.signature === signature && stored.key) {
      return stored.key;
    }
  } catch (error) {
    console.warn('주문 중복 방지 키 읽기 실패:', error);
  }

  const key = generateOrderIdempotencyKey();
  sessionStorage.setItem(ORDER_IDEMPOTENCY_STORAGE_KEY, JSON.stringify({
    key,
    signature,
    createdAt: new Date().toISOString(),
  }));
  return key;
}

function clearOrderIdempotencyKey() {
  sessionStorage.removeItem(ORDER_IDEMPOTENCY_STORAGE_KEY);
}

function shouldClearOrderIdempotencyKeyOnFailure(message) {
  const text = String(message || '');
  return [
    '재고',
    '크레딧',
    '포인트',
    '잔액',
    '마감',
    '운영 시간이 종료',
    '찾을 수 없습니다',
    '주문할 수 없는',
    '진행 중인 주문',
    '올바르지',
  ].some(pattern => text.includes(pattern));
}

function getMissingSessionFallbackUrl() {
  const hasGuestFlowHint =
    sessionStorage.getItem('guestPreviewMode') === 'Y' ||
    sessionStorage.getItem('guestRemainingCredit') ||
    sessionStorage.getItem('guestCreditLimit');
  return hasGuestFlowHint ? 'guest.html' : 'index.html?type=kiosk';
}

function renderGuestPreviewNotice() {
  if (!isGuestPreviewMode()) return;
  const mainContent = document.getElementById('main-content');
  if (!mainContent || document.getElementById('guest-preview-confirm-notice')) return;

  const notice = document.createElement('div');
  notice.id = 'guest-preview-confirm-notice';
  notice.style.cssText = 'width:100%;box-sizing:border-box;text-align:center;padding:12px 14px;background-color:#E0F7F5;border:3px solid #2EC4B6;border-radius:var(--radius-sm);font-size:16px;font-weight:850;color:#005F59;line-height:1.45;word-break:keep-all;margin-bottom:8px;';
  notice.innerHTML = '🛵 배달왔삼 미리보기입니다.<br><span style="font-size:14px;font-weight:750;">이 화면에서 실제 주문은 전송되지 않습니다.</span>';
  mainContent.insertBefore(notice, mainContent.firstElementChild);
}

async function refreshGuestCreditStatus() {
  if (!user || user.userId !== 'guest') return null;
  if (isGuestPreviewMode()) return null;

  try {
    const body = {
      guestDeviceId: AppState.getGuestDeviceId()
    };
    if (user.authProvider === 'kakao' && user.guestKey) {
      body.authProvider = 'kakao';
      body.guestKey = user.guestKey;
    }

    const res = await fetchAPIReadWithRetry('getGuestCreditStatus', {
      method: 'POST',
      body,
      timeoutMs: 30000
    });

    const remainingCredit = Number(res && res.remainingCredit);
    if (res && res.success && !Number.isNaN(remainingCredit)) {
      user.credit = remainingCredit;
      user.guestCreditLimit = Number(res.creditLimit || remainingCredit);
      user.guestBonusCredit = Number(res.bonusCredit || 0);
      AppState.setSelectedUser(user);
      sessionStorage.setItem('guestRemainingCredit', String(remainingCredit));
      sessionStorage.setItem('guestCreditLimit', String(res.creditLimit || remainingCredit));
      sessionStorage.setItem('kakaoGuestBonusCredit', String(res.bonusCredit || 0));
      document.getElementById('my-credit-num').textContent = user.credit ?? 0;
      updateBill();
      return res;
    }
  } catch (error) {
    console.warn('게스트 크레딧 상태 로드 실패:', error);
  }

  return null;
}

// ── 계산서 업데이트 ──────────────────────────────────────────
function updateBill() {
  const isGuest = (user && user.userId === 'guest');
  const fee = getGuestFee();
  const deliveryFee = (isGuest && deliveryType === 'delivery') ? fee : 0;
  const snackPoints = cart.reduce((sum, item) => sum + (item.point * item.quantity), 0);
  const totalPoints = snackPoints + deliveryFee;
  const remainPoints = user.credit - totalPoints;

  // 동전 아이콘 숫자만 업데이트 (HTML 구조는 고정)
  document.getElementById('use-credit-num').textContent = snackPoints;

  if (isGuest && deliveryType === 'delivery') {
    document.getElementById('delivery-fee-row').style.display = 'flex';
    document.getElementById('delivery-fee-num').textContent = fee;
  } else {
    document.getElementById('delivery-fee-row').style.display = 'none';
    document.getElementById('delivery-fee-num').textContent = 0;
  }

  const remainNumEl = document.getElementById('remain-credit-num');
  const remainDisplayEl = document.getElementById('remain-credit');
  remainNumEl.textContent = Math.max(0, remainPoints);

  const submitBtn = document.getElementById('btn-submit');
  const errorBox  = document.getElementById('error-message-box');

  if (remainPoints < 0) {
    remainDisplayEl.className = 'bill-coin-display deficit';
    submitBtn.disabled = true;
    submitBtn.textContent = '온기 부족 🥺';
    errorBox.textContent = '⚠️ 보유한 온기보다 주문 금액이 많아 주문할 수 없습니다.';
    errorBox.style.display = 'block';
  } else {
    remainDisplayEl.className = 'bill-coin-display';
    submitBtn.disabled = cart.length === 0;
    submitBtn.textContent = cart.length === 0
      ? '담은 간식 없음'
      : (isGuestPreviewMode() ? '미리보기 종료' : '온기 한 조각 담아 주문하기 ❤️');
    errorBox.style.display = 'none';
  }
}

// ── 수량 변경 ────────────────────────────────────────────────
function changeQty(snackId, delta) {
  const idx = cart.findIndex(i => i.snackId == snackId);
  if (idx === -1) return;

  if (delta > 0 && cart[idx].quantity >= (cart[idx].stock ?? 999)) {
    AppState.vibrate([100, 50, 100]); // 경고성 더블 진동
    AppState.playWarningSound();
    const errorBox = document.getElementById('error-message-box');
    if (errorBox) {
      errorBox.textContent = "⚠️ 재고가 부족해서 더 담을 수 없어요!";
      errorBox.style.display = 'block';
      setTimeout(() => {
        errorBox.style.display = 'none';
      }, 3000);
    }
    return;
  }

  cart[idx].quantity += delta;

  if (cart[idx].quantity <= 0) {
    removeItem(snackId);
    return;
  }

  // 수량 텍스트만 갱신 (DOM 재렌더 없이)
  const qtyEl = document.querySelector(`[data-qty-snack="${snackId}"]`);
  const subEl = document.querySelector(`[data-sub-snack="${snackId}"]`);
  const unitEl = document.querySelector(`[data-unit-snack="${snackId}"]`);
  if (qtyEl) qtyEl.textContent = cart[idx].quantity;
  
  // 플러스 버튼 활성/비활성 상태 갱신
  const plusBtn = document.querySelector(`#confirm-plus-${snackId}`);
  if (plusBtn) {
    const isMaxStock = cart[idx].quantity >= (cart[idx].stock ?? 999);
    if (isMaxStock) {
      plusBtn.disabled = true;
      plusBtn.style.backgroundColor = '#E9ECEF';
      plusBtn.style.color = '#CED4DA';
      plusBtn.style.cursor = 'not-allowed';
    } else {
      plusBtn.disabled = false;
      plusBtn.style.backgroundColor = 'var(--primary-color)';
      plusBtn.style.color = 'white';
      plusBtn.style.cursor = 'pointer';
    }
  }

  // 소계 및 단가 갱신
  if (subEl || unitEl) {
    const isGuest = (user && user.userId === 'guest');
    const p = cart[idx].point;
    const subTotal = p * cart[idx].quantity;
    
    if (isGuest) {
      if (unitEl) unitEl.innerHTML = `단가 <span style="color:var(--primary-color);font-weight:800;">❤️ ${p}개</span>`;
      if (subEl) subEl.innerHTML = `🛒 합계 <span style="color:var(--primary-color);font-weight:800;">❤️ ${subTotal}개</span>`;
    } else {
      const maxC = 5;
      if (unitEl) {
        const uCoins = Math.min(p, maxC);
        const uExtra = p > maxC ? `<span style="font-size:14px;font-weight:800;color:var(--text-muted);margin-left:4px">+${p - maxC}</span>` : '';
        unitEl.innerHTML = '❤️'.repeat(uCoins) + uExtra;
      }
      if (subEl) {
        const sCoins = Math.min(subTotal, maxC);
        const sExtra = subTotal > maxC ? `<span style="font-size:14px;font-weight:800;color:var(--text-muted);margin-left:4px">+${subTotal - maxC}</span>` : '';
        subEl.innerHTML = '❤️'.repeat(sCoins) + sExtra;
      }
    }
  }

  AppState.setCart(cart);
  updateBill();
  AppState.vibrate(30);
  AppState.playClickSound();
}

// ── 항목 삭제 ────────────────────────────────────────────────
function removeItem(snackId) {
  const cardEl = document.querySelector(`[data-card-snack="${snackId}"]`);

  // 슬라이드-아웃 애니메이션
  if (cardEl) {
    cardEl.classList.add('removing');
    cardEl.addEventListener('animationend', () => {
      cardEl.remove();
      finishRemove(snackId);
    }, { once: true });
  } else {
    finishRemove(snackId);
  }

  AppState.vibrate([40, 30, 40]);
  AppState.playWarningSound();
}

function finishRemove(snackId) {
  cart = cart.filter(i => i.snackId != snackId);
  AppState.setCart(cart);
  updateBill();

  if (cart.length === 0) {
    document.getElementById('order-item-list').innerHTML =
      `<div class="cart-empty-hint">🛒 담은 간식이 없어요!<br>이전으로 돌아가서 간식을 골라주세요.</div>`;
    AppState.speak('담은 간식이 없습니다. 이전 화면으로 이동해주세요.');
  }
}

// ── 리스트 렌더링 ────────────────────────────────────────────
function renderOrderList() {
  const listEl = document.getElementById('order-item-list');
  listEl.innerHTML = '';

  if (cart.length === 0) {
    listEl.innerHTML = `<div class="cart-empty-hint">🛒 담은 간식이 없어요!</div>`;
    return;
  }

  cart.forEach(item => {
    const itemImgUrl   = AppState.convertDriveImageUrl(item.imageUrl);
    const safeImgUrl   = AppState.escapeAttr(itemImgUrl);
    const safeName     = AppState.escapeHtml(item.name);
    const safeEmoji    = AppState.escapeHtml(AppState.getSnackEmoji(item.name));
    const safeSnackId  = AppState.escapeAttr(String(item.snackId));

    let imgHTML = '';
    if (itemImgUrl && itemImgUrl.trim() !== '') {
      imgHTML = `<img src="${safeImgUrl}" alt="${safeName}" class="order-item-img"
                  onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" loading="lazy">`;
    }
    const emojiHTML = `<div class="order-item-emoji-fallback" style="${itemImgUrl ? 'display:none;' : 'display:flex;'}">${safeEmoji}</div>`;

    let unitHTML = '';
    let subtotalHTML = '';
    const isGuest = (user && user.userId === 'guest');

    if (isGuest) {
      unitHTML = `단가 <span style="color:var(--primary-color);font-weight:800;">❤️ ${item.point}개</span>`;
      subtotalHTML = `🛒 합계 <span style="color:var(--primary-color);font-weight:800;">❤️ ${item.point * item.quantity}개</span>`;
    } else {
      const maxCoins = 5;
      const uCoins = Math.min(item.point, maxCoins);
      const uExtra = item.point > maxCoins ? `<span style="font-size:14px;font-weight:800;color:var(--text-muted);margin-left:4px">+${item.point - maxCoins}</span>` : '';
      unitHTML = '❤️'.repeat(uCoins) + uExtra;
      
      const sTotal = item.point * item.quantity;
      const sCoins = Math.min(sTotal, maxCoins);
      const sExtra = sTotal > maxCoins ? `<span style="font-size:14px;font-weight:800;color:var(--text-muted);margin-left:4px">+${sTotal - maxCoins}</span>` : '';
      subtotalHTML = '❤️'.repeat(sCoins) + sExtra;
    }

    const cardEl = document.createElement('div');
    cardEl.className = 'order-item-editable';
    cardEl.setAttribute('data-card-snack', safeSnackId);
    cardEl.innerHTML = `
      <!-- 이미지 -->
      <div class="order-item-img-container">
        ${imgHTML}
        ${emojiHTML}
      </div>

      <!-- 이름 + 소계 -->
      <div class="confirm-item-info">
        <div class="confirm-item-name">${safeName}</div>
        <div class="confirm-item-unit" data-unit-snack="${safeSnackId}" style="display: flex; align-items: center; gap: 4px;">${unitHTML}</div>
        <div class="confirm-item-subtotal" data-sub-snack="${safeSnackId}" style="display: flex; align-items: center; gap: 4px; margin-top: 2px;">${subtotalHTML}</div>
      </div>

      <!-- 수량 조절 + 삭제 -->
      <div class="confirm-item-controls">
        <div class="confirm-qty-row">
          <button class="confirm-btn-qty confirm-btn-minus" id="confirm-minus-${safeSnackId}" aria-label="${safeName} 수량 줄이기">−</button>
          <span class="confirm-qty-val" data-qty-snack="${safeSnackId}">${Number(item.quantity)}</span>
          ${(() => {
            const isMax = item.quantity >= (item.stock ?? 999);
            return `<button class="confirm-btn-qty confirm-btn-plus" id="confirm-plus-${safeSnackId}" aria-label="${safeName} 수량 늘리기" ${isMax ? 'disabled style="background-color:#E9ECEF;color:#CED4DA;cursor:not-allowed;"' : ''}>+</button>`;
          })()}
        </div>
        <button class="confirm-btn-delete" id="confirm-del-${safeSnackId}" aria-label="${safeName} 삭제">🗑</button>
      </div>
    `;

    listEl.appendChild(cardEl);

    // 이벤트 바인딩 (터치 보정 적용)
    const minusBtn  = cardEl.querySelector(`#confirm-minus-${safeSnackId}`);
    const plusBtn   = cardEl.querySelector(`#confirm-plus-${safeSnackId}`);
    const deleteBtn = cardEl.querySelector(`#confirm-del-${safeSnackId}`);

    minusBtn.addEventListener('pointerdown', e => e.stopPropagation());
    AppState.bindCardTap(minusBtn, e => {
      e.stopPropagation();
      changeQty(item.snackId, -1);
    });

    plusBtn.addEventListener('pointerdown', e => e.stopPropagation());
    AppState.bindCardTap(plusBtn, e => {
      e.stopPropagation();
      changeQty(item.snackId, 1);
    });

    deleteBtn.addEventListener('pointerdown', e => e.stopPropagation());
    AppState.bindCardTap(deleteBtn, e => {
      e.stopPropagation();
      removeItem(item.snackId);
    });
  });
}

// ── 초기화 ───────────────────────────────────────────────────
function initData() {
  user = AppState.getSelectedUser();
  cart = AppState.getCart();

  if (!user || cart.length === 0) {
    if (user && user.userId === 'guest') {
      window.location.href = 'guest.html';
    } else if (user && user.userId !== 'guest') {
      window.location.href = 'index.html?type=kiosk';
    } else {
      window.location.href = getMissingSessionFallbackUrl();
    }
    return;
  }

  const isGuest = (user.userId === 'guest');
  if (isGuestPreviewMode()) {
    user.previewMode = true;
    AppState.setSelectedUser(user);
  }
  renderUserBadge();
  
  // 보유 크레딧 숫자만 업데이트 (HTML 구조에 🪙 아이콘 포함)
  if (isGuest && !isGuestPreviewMode()) {
    const serverRemainingCredit = sessionStorage.getItem('guestRemainingCredit');
    if (serverRemainingCredit !== null && serverRemainingCredit !== '') {
      user.credit = Number(serverRemainingCredit);
      AppState.setSelectedUser(user);
    } else if (typeof user.credit !== 'number') {
      user.credit = Number(sessionStorage.getItem('guestBaseCredit')) || GUEST_DEFAULT_CREDIT;
      AppState.setSelectedUser(user);
    }
  }
  document.getElementById('my-credit-num').textContent = user.credit ?? 0;

  if (isGuest) {
    const firstRowSpan = document.querySelector('.bill-row span');
    if (firstRowSpan) {
      firstRowSpan.textContent = '보유 온기';
    }

    // 게스트일 경우 수령방식 박스 노출 및 바인딩
    const deliverySelectBox = document.getElementById('delivery-select-box');
    if (deliverySelectBox) {
      deliverySelectBox.style.display = 'flex';
      
      const btnPickup = document.getElementById('btn-delivery-pickup');
      const btnDeliver = document.getElementById('btn-delivery-deliver');
      const deliveryPlaceBox = document.getElementById('delivery-place-box');
      const deliveryPlaceInput = document.getElementById('delivery-place-input');
      const rememberGuestProfileBox = document.getElementById('remember-guest-profile-box');
      const rememberGuestProfileInput = document.getElementById('remember-guest-profile-input');
      const guestOrdererInfoBox = document.getElementById('guest-orderer-info-box');
      const guestNameEntryBox = document.getElementById('guest-name-entry-box');
      const guestNameInput = document.getElementById('guest-name-confirm-input');
      const guestSavedProfileBox = document.getElementById('guest-saved-profile-box');
      const btnConfirmRandomName = document.getElementById('btn-confirm-random-name');
      
      const fee = getGuestFee();
      btnDeliver.textContent = `배달 (+3❤️)`;

      if (guestOrdererInfoBox) {
        guestOrdererInfoBox.style.display = isGuestPreviewMode() ? 'none' : 'flex';
      }

      if (hasSavedKakaoGuestProfile()) {
        if (guestNameEntryBox) guestNameEntryBox.style.display = 'none';
        if (guestSavedProfileBox) {
          guestSavedProfileBox.textContent = `카카오 저장 정보: ${user.nickname} 님`;
          guestSavedProfileBox.style.display = 'block';
        }
      } else {
        if (guestNameEntryBox) guestNameEntryBox.style.display = 'flex';
        if (guestSavedProfileBox) guestSavedProfileBox.style.display = 'none';
        if (guestNameInput) {
          guestNameInput.value = user.needsGuestInfo ? '' : (user.nickname || '');
        }
        applyLocalGuestDisplayNamePolicy();
      }

      if (btnConfirmRandomName && guestNameInput) {
        AppState.bindCardTap(btnConfirmRandomName, () => {
          guestNameInput.value = generateConfirmRandomNickname();
          guestNameInput.focus();
          AppState.vibrate(40);
        });
      }

      // 기본 배달지 설정
      if (deliveryPlaceInput) {
        const storedDefaultPlace = sessionStorage.getItem('guestDefaultDeliveryPlace');
        const defaultPlace = storedDefaultPlace === null ? '사무실 원탁' : storedDefaultPlace;
        deliveryPlaceInput.value = user.rememberedDeliveryPlace || defaultPlace;
      }

      if (rememberGuestProfileBox && user.authProvider === 'kakao' && user.guestKey) {
        rememberGuestProfileBox.style.display = 'flex';
        if (rememberGuestProfileInput) {
          rememberGuestProfileInput.checked = false;
        }
      }

      btnPickup.addEventListener('click', () => {
        deliveryType = 'pickup';
        btnPickup.className = 'btn btn-secondary';
        btnDeliver.className = 'btn btn-gray';
        if (deliveryPlaceBox) deliveryPlaceBox.style.display = 'none';
        updateBill();
      });
      
      btnDeliver.addEventListener('click', () => {
        deliveryType = 'delivery';
        btnPickup.className = 'btn btn-gray';
        btnDeliver.className = 'btn btn-secondary';
        if (deliveryPlaceBox) deliveryPlaceBox.style.display = 'flex';
        if (deliveryPlaceInput) deliveryPlaceInput.focus();
        updateBill();
      });
    }
  }

  renderOrderList();
  renderGuestPreviewNotice();
  updateBill();
}

// ── 주문 제출 ────────────────────────────────────────────────
async function submitOrder() {
  if (cart.length === 0) return;
  if (isGuestPreviewMode()) {
    alert('미리보기 모드입니다. 실제 주문은 접수되지 않습니다.');
    AppState.resetAll();
    sessionStorage.setItem('guestPreviewMode', 'Y');
    window.location.href = 'guest.html?preview=1';
    return;
  }

  const isGuest = (user.userId === 'guest');
  if (isGuest) {
    let guestName = getGuestOrderDisplayName();
    const savedLocalName = !(user.authProvider === 'kakao' && user.guestKey)
      ? AppState.getLocalGuestDisplayName()
      : '';
    if (savedLocalName) {
      guestName = savedLocalName;
      const guestNameInput = document.getElementById('guest-name-confirm-input');
      if (guestNameInput) guestNameInput.value = savedLocalName;
    }
    if (!guestName) {
      const errorBox = document.getElementById('error-message-box');
      const guestNameInput = document.getElementById('guest-name-confirm-input');
      if (errorBox) {
        errorBox.textContent = '⚠️ 주문표시명을 입력해 주세요.';
        errorBox.style.display = 'block';
      }
      alert('주문표시명을 입력해 주세요.');
      if (guestNameInput) guestNameInput.focus();
      AppState.vibrate([100, 100]);
      return;
    }
    syncGuestOrderDisplayName(guestName);
  }

  const loadingOverlay = document.getElementById('loading-overlay');
  const errorBox       = document.getElementById('error-message-box');
  const btnSubmit      = document.getElementById('btn-submit');
  const btnPrev        = document.getElementById('btn-prev');

  if (loadingOverlay) loadingOverlay.style.display = 'flex';
  if (errorBox) errorBox.style.display = 'none';
  if (btnSubmit) btnSubmit.disabled = true;
  if (btnPrev) btnPrev.disabled   = true;

  if (isGuest) {
    try {
      await refreshGuestCreditStatus();
    } catch (error) {
      console.warn('게스트 크레딧 갱신 실패:', error);
    }
  }

  const fee = getGuestFee();
  const deliveryFee = (isGuest && deliveryType === 'delivery') ? fee : 0;
  const snackPoints  = cart.reduce((sum, i) => sum + i.point * i.quantity, 0);
  const totalPoints = snackPoints + deliveryFee;
  const remainPoints = user.credit - totalPoints;

  let deliveryPlace = '';
  if (isGuest && deliveryType === 'delivery') {
    const deliveryPlaceInput = document.getElementById('delivery-place-input');
    deliveryPlace = deliveryPlaceInput ? deliveryPlaceInput.value.trim() : '';
    if (!deliveryPlace) {
      alert('배달지를 입력해 주세요.');
      if (loadingOverlay) loadingOverlay.style.display = 'none';
      if (btnSubmit) btnSubmit.disabled = false;
      if (btnPrev) btnPrev.disabled   = false;
      if (deliveryPlaceInput) deliveryPlaceInput.focus();
      return;
    }
  }

  const orderPayload = {
    userId: user.userId,
    items: cart.map(item => ({ snackId: item.snackId, quantity: item.quantity }))
  };
  const idempotencySignature = buildOrderAttemptSignature(isGuest, deliveryType, deliveryPlace);
  const idempotencyKey = getOrderIdempotencyKey(idempotencySignature);
  orderPayload.idempotencyKey = idempotencyKey;

  if (isGuest) {
    orderPayload.guestName = user.nickname;
    orderPayload.deliveryType = deliveryType;
    orderPayload.deliveryFee = deliveryFee;
    orderPayload.deliveryPlace = deliveryPlace;
    orderPayload.orderStartedAt = sessionStorage.getItem('guestOrderStartedAt') || '';
    orderPayload.guestDeviceId = AppState.getGuestDeviceId();
    if (user.authProvider === 'kakao' && user.guestKey) {
      orderPayload.authProvider = 'kakao';
      orderPayload.guestKey = user.guestKey;
      const rememberGuestProfileInput = document.getElementById('remember-guest-profile-input');
      orderPayload.rememberGuestProfile = !!(rememberGuestProfileInput && rememberGuestProfileInput.checked);
    }
  }

  try {
    const response = await fetchAPI('placeOrder', { method: 'POST', body: orderPayload });

    if (response && response.success) {
      const parsedAfterCredit = Number(response.afterCredit);
      let responseRemainPoints = !Number.isNaN(parsedAfterCredit)
        ? parsedAfterCredit
        : remainPoints;
      if (isGuest && totalPoints > 0 && responseRemainPoints > user.credit) {
        console.warn('게스트 주문 후 잔액 응답이 현재 보유 크레딧보다 커서 로컬 계산값을 사용합니다.', {
          beforeCredit: user.credit,
          responseAfterCredit: response.afterCredit,
          totalPoints
        });
        responseRemainPoints = Math.max(0, user.credit - totalPoints);
      }
      user.credit = responseRemainPoints;
      AppState.setSelectedUser(user);
      if (isGuest && !(user.authProvider === 'kakao' && user.guestKey)) {
        AppState.setLocalGuestDisplayName(user.nickname);
      }

      const lastOrder = {
        userId:       user.userId,
        nickname:     user.nickname,
        usedPoints:   totalPoints,
        remainPoints: responseRemainPoints,
        orderNo:      response.orderNo || '',
        orderToken:   response.orderToken || '',
        deliveryType: isGuest ? deliveryType : 'pickup',
        deliveryPlace: isGuest && deliveryType === 'delivery' ? deliveryPlace : '',
        authProvider: isGuest && user.authProvider === 'kakao' ? 'kakao' : '',
        guestKey: isGuest && user.guestKey ? user.guestKey : '',
        idempotencyKey: idempotencyKey,
        items:        cart.map(item => ({ name: item.name, quantity: item.quantity }))
      };

      localStorage.setItem('lastOrderSummary', JSON.stringify(lastOrder));

      // 게스트인 경우 guestOrders 배열에 누적 저장
      if (user.userId === 'guest') {
        const guestOrders = JSON.parse(localStorage.getItem('guestOrders') || '[]');
        const hasSameGuestOrder = guestOrders.some(order =>
          (response.orderToken && order.orderToken === response.orderToken) ||
          (response.orderNo && order.orderNo === response.orderNo)
        );
        if (!hasSameGuestOrder) {
          guestOrders.push({
            orderNo: response.orderNo || '',
            orderToken: response.orderToken || '',
            guestName: user.nickname,
            createdAt: new Date().toISOString(),
            status: 'N',
            deliveryType: deliveryType,
            deliveryPlace: deliveryType === 'delivery' ? deliveryPlace : '',
            authProvider: user.authProvider === 'kakao' ? 'kakao' : '',
            guestKey: user.guestKey || '',
            idempotencyKey: idempotencyKey,
            items: cart.map(item => ({ name: item.name, quantity: item.quantity }))
          });
        }
        localStorage.setItem('guestOrders', JSON.stringify(guestOrders));
        sessionStorage.setItem('guestRemainingCredit', String(responseRemainPoints));
      }

      clearOrderIdempotencyKey();
      sessionStorage.removeItem('guestOrderStartedAt');
      AppState.clearCart();
      setTimeout(() => { window.location.href = 'complete.html'; }, 500);
    } else {
      throw new Error(response.message || '서버 오류가 발생했습니다.');
    }
  } catch (error) {
    console.error('주문 제출 중 오류:', error);
    loadingOverlay.style.display = 'none';
    btnSubmit.disabled = false;
    btnPrev.disabled   = false;

    let displayMessage = '인터넷 연결이 불안정합니다. 잠시 후 다시 시도해 주세요.';
    const errStr = String(error.message || '');

    if (errStr.includes('재고'))               displayMessage = '간식의 남은 수량이 부족해서 주문할 수 없어요!';
    else if (errStr.includes('크레딧') || errStr.includes('포인트') || errStr.includes('잔액') || errStr.includes('온기'))
      displayMessage = '보낼 온기가 부족해서 주문할 수 없어요!';
    else if (errStr)                            displayMessage = errStr;

    if (shouldClearOrderIdempotencyKeyOnFailure(displayMessage)) {
      clearOrderIdempotencyKey();
    }

    errorBox.textContent = `⚠️ 주문 실패: ${displayMessage}`;
    errorBox.style.display = 'block';
    alert(`주문 실패\n\n${displayMessage}`);
    AppState.vibrate([100, 100, 100]);
  }
}

// ── 바인딩 ───────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  initData();
  refreshConfirmGuestSettings();
  if (!isGuestPreviewMode()) {
    refreshGuestCreditStatus();
  }

  // 유휴 시간 자동 로그아웃 초기화 (70초 유휴 + 10초 경고)
  AppState.initIdleTimeout(70000, 10000);

  AppState.bindCardTap(document.getElementById('btn-prev'), () => {
    window.location.href = 'menu.html';
  });

  AppState.bindCardTap(document.getElementById('btn-submit'), () => {
    submitOrder();
  });
});
