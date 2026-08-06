let user = null;
let snacks = [];
let cart = []; // { snackId, name, point, quantity }

function isGuestMenuBrowseMode() {
  return new URLSearchParams(window.location.search).get('browse') === 'guest';
}

function isGuestPreviewMode() {
  return sessionStorage.getItem('guestPreviewMode') === 'Y' || !!(user && user.previewMode);
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
  if (!mainContent || document.getElementById('guest-preview-menu-notice')) return;

  const notice = document.createElement('div');
  notice.id = 'guest-preview-menu-notice';
  notice.style.cssText = 'width:100%;box-sizing:border-box;text-align:center;padding:12px 14px;background-color:#E0F7F5;border:3px solid #2EC4B6;border-radius:var(--radius-sm);font-size:16px;font-weight:850;color:#005F59;line-height:1.45;word-break:keep-all;margin-bottom:8px;';
  notice.innerHTML = '🛵 배달왔삼 미리보기입니다.<br><span style="font-size:14px;font-weight:750;">실제 주문은 접수되지 않습니다.</span>';
  mainContent.insertBefore(notice, mainContent.firstElementChild);
}

function prepareGuestMenuBrowseMode() {
  user = {
    userId: 'guest',
    nickname: '메뉴 미리보기',
    credit: 0,
    browseMode: true,
  };
  cart = [];

  document.title = '배달왔삼 - 메뉴 미리보기';
  const title = document.querySelector('.kiosk-title');
  if (title) title.textContent = '🛵 배달왔삼 메뉴';

  const badgeContainer = document.getElementById('user-badge-container');
  if (badgeContainer) {
    badgeContainer.innerHTML = '<span class="user-badge">메뉴 미리보기</span>';
  }

  const creditBadge = document.querySelector('.credit-badge');
  if (creditBadge) creditBadge.style.display = 'none';

  const guideText = document.querySelector('.guide-text');
  if (guideText) {
    guideText.innerHTML = '현재 준비 중인 <span>간식 메뉴</span>입니다.<br><span style="font-size:16px;color:var(--text-muted);">주문 운영이 시작되면 배달왔삼에서 주문할 수 있어요.</span>';
  }

  const cartSummary = document.querySelector('.cart-summary');
  if (cartSummary) cartSummary.style.display = 'none';

  const btnBack = document.getElementById('btn-back');
  if (btnBack) {
    btnBack.textContent = '배달왔삼으로 돌아가기';
    btnBack.style.flex = '1';
  }

  const btnNext = document.getElementById('btn-next');
  if (btnNext) btnNext.style.display = 'none';
}

function renderCreditUI() {
  const creditAmount = document.getElementById('user-credit');
  if (creditAmount) {
    creditAmount.textContent = user ? (user.credit ?? 0) : 0;
  }

  if (user && user.userId === 'guest') {
    const hintEl = document.getElementById('guest-delivery-hint');
    if (hintEl) {
      hintEl.style.display = 'block';
      const fee = Number(sessionStorage.getItem('guestDeliveryFee')) || GUEST_DELIVERY_FEE;
      const maxSnackCredit = Math.max(0, (Number(user.credit) || 0) - fee);
      document.getElementById('guest-delivery-fee-text').textContent = fee;
      document.getElementById('guest-max-snack-credit').textContent = maxSnackCredit;
    }
  }
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
      renderCreditUI();
      updateCartSummary();
      return res;
    }
  } catch (error) {
    console.warn('게스트 크레딧 상태 로드 실패:', error);
  }

  return null;
}

// 1. 유저 정보 체크
function checkUserSession() {
  user = AppState.getSelectedUser();
  if (!user) {
    // 유저 정보 없으면 메인으로 튕김
    window.location.href = getMissingSessionFallbackUrl();
    return;
  }
  
  // 유저 헤더 렌더링
  const badgeContainer = document.getElementById('user-badge-container');
  const isGuest = (user.userId === 'guest');
  if (isGuestPreviewMode()) {
    user.previewMode = true;
    AppState.setSelectedUser(user);
  }
  const userSuffix = isGuestPreviewMode() ? ' (미리보기)' : (isGuest ? ' (체험)' : ' 님');
  const displayName = isGuest && user.needsGuestInfo
    ? '주문자 정보 입력 전'
    : (user.nickname || (isGuest ? '게스트' : ''));
  badgeContainer.innerHTML = `<span class="user-badge">${AppState.escapeHtml(displayName)}${userSuffix}</span>`;
  
  // 크레딧 숫자만 업데이트 (HTML 구조는 이미 🪙 아이콘 포함)
  if (user.userId === 'guest' && !isGuestPreviewMode()) {
    const storedRemainingCredit = sessionStorage.getItem('guestRemainingCredit');
    if (storedRemainingCredit !== null && storedRemainingCredit !== '') {
      user.credit = Number(storedRemainingCredit);
      AppState.setSelectedUser(user);
    }
  }
  renderCreditUI();

  // 크레딧 표시부 렌더링
  const creditBadge = document.querySelector('.credit-badge');
  if (isGuest) {
    if (creditBadge) {
      // '보유 온기' 라벨로 변경
      creditBadge.classList.add('guest-mode');
      creditBadge.innerHTML = `보유 온기 <span class="coin-icon">❤️</span><span class="coin-number" id="user-credit">${user.credit ?? 0}</span>`;
      renderCreditUI();
    }
    // 게스트 모드에서는 '이름 다시 고르기' 대신 '처음 화면으로 가기'로 표시
    const btnBack = document.getElementById('btn-back');
    if (btnBack) {
      btnBack.textContent = '처음 화면으로 가기';
    }

    renderCreditUI();
  }
  renderGuestPreviewNotice();
}

// 2. 간식 목록 API 조회
async function loadSnacks() {
  const loadingOverlay = document.getElementById('loading-overlay');
  const errorOverlay = document.getElementById('error-overlay');
  const snackGrid = document.getElementById('snack-grid');

  loadingOverlay.style.display = 'flex';
  errorOverlay.style.display = 'none';
  snackGrid.innerHTML = '';

  try {
    const isGuest = isGuestMenuBrowseMode() || (user && user.userId === 'guest');
    const mode = isGuest ? 'guest' : 'user';
    const guestKey = localStorage.getItem('guestKey') || sessionStorage.getItem('guestKey') || '';
    const guestDeviceId = localStorage.getItem('guestDeviceId') || sessionStorage.getItem('guestDeviceId') || '';
    const userId = user ? user.userId : 'guest';
    const response = await fetchAPIReadWithRetry('getSnacks', {
      params: { mode, guestKey, guestDeviceId, userId },
      timeoutMs: 30000
    });
    if (response && response.success && Array.isArray(response.snacks)) {
      snacks = response.snacks;

      // 관리자가 G열(displayOrder)에 저장한 표시 순서대로 정렬
      // displayOrder=0 또는 미설정인 항목은 맨 뒤에 배치
      snacks.sort((a, b) => {
        const ao = Number(a.displayOrder) || 0;
        const bo = Number(b.displayOrder) || 0;
        if (ao === 0 && bo === 0) return 0;
        if (ao === 0) return 1;
        if (bo === 0) return -1;
        return ao - bo;
      });
      
      // 장바구니 초기화 (이전 장바구니가 남아있다면 복구)
      cart = isGuestMenuBrowseMode() ? [] : AppState.getCart();
      
      renderSnacks();
      updateCartSummary();
      loadingOverlay.style.display = 'none';

    } else {
      throw new Error('간식 응답 데이터가 이상합니다.');
    }
  } catch (error) {
    console.error('간식 로딩 실패:', error);
    loadingOverlay.style.display = 'none';
    errorOverlay.style.display = 'flex';
  }
}

// getSnackEmoji는 이제 js/app.js 내의 AppState.getSnackEmoji를 사용하여 전역 관리됩니다.

// 3. 간식 카드 리스트 렌더링
function renderSnacks() {
  const snackGrid = document.getElementById('snack-grid');
  snackGrid.innerHTML = '';

  snacks.forEach(snack => {
    // 현재 장바구니에 담긴 수량 확인
    const cartItem = cart.find(item => item.snackId === snack.snackId);
    const quantity = isGuestMenuBrowseMode() ? 0 : (cartItem ? cartItem.quantity : 0);

    const isSoldOut = snack.stock === 0;
    const maxLimit = Number(snack.maxPerPerson || 0);
    const todayOrdered = Number(snack.todayOrderedCount || 0);
    const hasPerPersonLimit = maxLimit > 0;
    const remainingQuota = hasPerPersonLimit ? Math.max(0, maxLimit - todayOrdered) : 999;
    const isLimitCompleted = hasPerPersonLimit && remainingQuota <= 0;

    const card = document.createElement('div');
    card.className = `snack-card ${isGuestMenuBrowseMode() ? 'browse-only' : ''} ${quantity > 0 ? 'has-items' : ''} ${isSoldOut ? 'sold-out' : ''} ${isLimitCompleted ? 'limit-completed' : ''}`;
    card.id = `snack-card-${snack.snackId}`;

    // 이미지 구성 (없으면 이모지)
    const imgUrl = AppState.convertDriveImageUrl(snack.imageUrl);
    const safeImgUrl = AppState.escapeAttr(imgUrl);
    const safeSnackName = AppState.escapeHtml(snack.name);
    const safeSnackEmoji = AppState.escapeHtml(AppState.getSnackEmoji(snack.name));
    // 게스트 모드와 이용자 모드 구분
    const pointNum = Number(snack.point) || 0;
    let coinPriceHTML = '';
    if (user && user.userId === 'guest') {
      coinPriceHTML = `<div class="snack-coin-price" style="font-size: 15px; font-weight: 700; color: var(--text-main); margin-bottom: 4px;">단가 <span style="color: var(--primary-color); font-weight: 800; font-size: 18px;">❤️ ${pointNum}개</span></div>`;
    } else {
      const maxCoins = 5;
      const coinCount = Math.min(pointNum, maxCoins);
      const extraText = pointNum > maxCoins ? ` <span style="font-size:16px; font-weight:800; color:var(--text-muted); margin-left: 4px;">+${pointNum - maxCoins}</span>` : '';
      const coinHTML = '❤️'.repeat(coinCount) + extraText;
      coinPriceHTML = `<div class="snack-coin-price"><span class="coin-emoji" style="display: flex; align-items: center;">${coinHTML}</span><span class="coin-number-sub">온기 ${pointNum}개</span></div>`;
    }
    let imgHTML = '';
    if (imgUrl && imgUrl.trim() !== '') {
      imgHTML = `<img src="${safeImgUrl}" alt="${safeSnackName}" class="snack-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" loading="lazy">`;
    }
    
    // 이미지 Fallback으로 항상 대형 이모지 컨테이너 대기
    const emojiHTML = `<div class="snack-img-placeholder" style="${imgUrl ? 'display:none;' : 'display:flex;'}">${safeSnackEmoji}</div>`;

    // 1인 수량 제한 배지 HTML
    let limitBadgeHTML = '';
    if (hasPerPersonLimit) {
      if (isLimitCompleted) {
        limitBadgeHTML = `<div style="position: absolute; top: 6px; right: 6px; background-color: #2F855A; color: white; padding: 4px 8px; border-radius: 12px; font-size: 13px; font-weight: 800; z-index: 3; box-shadow: 0 2px 4px rgba(0,0,0,0.15); white-space: nowrap;">추가 주문 불가</div>`;
      } else {
        limitBadgeHTML = `<div style="position: absolute; top: 6px; right: 6px; background-color: #DD6B20; color: white; padding: 4px 8px; border-radius: 12px; font-size: 13px; font-weight: 800; z-index: 3; box-shadow: 0 2px 4px rgba(0,0,0,0.15); white-space: nowrap;">🎁 1인 ${maxLimit}개 한정</div>`;
      }
    }

    // 남은 재고 텍스트 설정
    let stockText = isSoldOut
      ? '품절'
      : (isLimitCompleted ? '추가 주문 불가' : (isGuestMenuBrowseMode() ? '판매 중' : `남은 수량 ${snack.stock}개`));
    let stockColor = isSoldOut ? 'var(--danger-color)' : (isLimitCompleted ? '#2F855A' : 'var(--text-muted)');
    const counterHTML = isGuestMenuBrowseMode()
      ? ''
      : `
        <div class="counter-group">
          <button class="btn-counter btn-counter-minus" id="btn-minus-${snack.snackId}" aria-label="감소">-</button>
          <div class="counter-value" id="val-${snack.snackId}">${quantity}</div>
          <button class="btn-counter btn-counter-plus" id="btn-plus-${snack.snackId}" aria-label="증가" ${isSoldOut || isLimitCompleted ? 'disabled' : ''}>+</button>
        </div>
      `;

    card.innerHTML = `
      <div class="snack-img-container" style="position: relative;">
        ${limitBadgeHTML}
        ${imgHTML}
        ${emojiHTML}
      </div>
      <div class="snack-info">
        <div class="snack-name">${safeSnackName}</div>
        ${coinPriceHTML}
        <div class="snack-stock" id="stock-${snack.snackId}" style="font-size: 16px; font-weight: 700; color: ${stockColor}; margin-top: 2px;">
          ${AppState.escapeHtml(stockText)}
        </div>
        
        ${counterHTML}
      </div>
    `;

    snackGrid.appendChild(card);
    if (isGuestMenuBrowseMode()) return;

    // 이벤트 리스너 바인딩 (터치 지터 보정 적용)
    const minusBtn = card.querySelector(`#btn-minus-${snack.snackId}`);
    const plusBtn = card.querySelector(`#btn-plus-${snack.snackId}`);

    // 마이너스 버튼 설정 (버블링 전파 방지 포함)
    minusBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    AppState.bindCardTap(minusBtn, (e) => {
      e.stopPropagation();
      changeQuantity(snack, -1);
    });

    // 플러스 버튼 설정 (버블링 전파 방지 포함)
    plusBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    AppState.bindCardTap(plusBtn, (e) => {
      e.stopPropagation();
      changeQuantity(snack, 1);
    });

    // 카드 전체 터치 설정 (버튼 영역 제외 시 +1)
    AppState.bindCardTap(card, (e) => {
      if (e.target.closest('.btn-counter-minus') || e.target.closest('.btn-counter-plus')) {
        return;
      }
      if (isLimitCompleted) {
        alert('이 메뉴는 오늘 더 이상 주문할 수 없어요.');
        AppState.vibrate(50);
        return;
      }
      if (!isSoldOut) {
        changeQuantity(snack, 1);
      }
    });
  });
}

// 4. 수량 변경 로직
function changeQuantity(snack, change) {
  // 현재 장바구니 아이템 인덱스
  const cartIndex = cart.findIndex(item => item.snackId === snack.snackId);
  
  // 장바구니 내 현재 수량
  const currentQty = cartIndex > -1 ? cart[cartIndex].quantity : 0;
  const targetQty = currentQty + change;

  if (targetQty < 0) return; // 0 미만으로 감소 불가

  // 1인 수량 제한 검증
  const maxLimit = Number(snack.maxPerPerson || 0);
  if (maxLimit > 0) {
    const todayOrdered = Number(snack.todayOrderedCount || 0);
    const remainingQuota = Math.max(0, maxLimit - todayOrdered);
    if (change > 0 && targetQty > remainingQuota) {
      if (todayOrdered > 0) {
        alert(`추가 주문 불가: '${snack.name}'`);
      } else {
        alert(`주문 수량 초과: '${snack.name}' 1인 ${maxLimit}개`);
      }
      AppState.vibrate([100, 50, 100]);
      return;
    }
  }

  // 재고 한도 검증
  if (change > 0 && targetQty > snack.stock) {
    showStockWarning();
    AppState.vibrate([100, 50, 100]); // 경고성 더블 진동
    return;
  } else {
    hideStockWarning();
  }

  // 총 포인트 합산 계산 (이 연산이 추가되었을 때 한계치 체크)
  const currentTotalPoints = cart.reduce((sum, item) => sum + (item.point * item.quantity), 0);
  const diffPoints = snack.point * change;
  const nextTotalPoints = currentTotalPoints + diffPoints;

  // 크레딧 한도 검증 (실수 방지 목적)
  if (change > 0 && nextTotalPoints > user.credit) {
    showCreditWarning();
    AppState.vibrate([100, 50, 100]); // 경고성 더블 진동
    return;
  } else {
    hideCreditWarning();
  }

  // 장바구니 업데이트
  if (targetQty === 0) {
    if (cartIndex > -1) {
      cart.splice(cartIndex, 1);
    }
  } else {
    if (cartIndex > -1) {
      cart[cartIndex].quantity = targetQty;
      cart[cartIndex].stock = snack.stock; // 재고 수량 업데이트
    } else {
      cart.push({
        snackId: snack.snackId,
        name: snack.name,
        point: snack.point,
        imageUrl: snack.imageUrl, // 구글 드라이브 이미지 원본 주소 함께 보관
        quantity: targetQty,
        stock: snack.stock // 재고 수량 보관
      });
    }
  }

  // 음성 안내 재생 (TTS)
  if (change > 0) {
    AppState.speak(`${snack.name} ${targetQty}개 담았습니다.`);
  } else if (change < 0) {
    if (targetQty === 0) {
      AppState.speak(`${snack.name}을 모두 뺐습니다.`);
    } else {
      AppState.speak(`${snack.name} ${targetQty}개`);
    }
  }

  // 화면 즉시 갱신
  AppState.setCart(cart);
  
  // 개별 카드 업데이트
  const card = document.getElementById(`snack-card-${snack.snackId}`);
  const valEl = document.getElementById(`val-${snack.snackId}`);
  valEl.textContent = targetQty;
  
  if (targetQty > 0) {
    card.classList.add('has-items');
  } else {
    card.classList.remove('has-items');
  }

  updateCartSummary();
}

// 5. 하단 카트 요약 정보 갱신
function updateCartSummary() {
  if (isGuestMenuBrowseMode()) return;
  const cartCount = document.getElementById('cart-count');
  const cartTotal = document.getElementById('cart-total');
  const btnNext = document.getElementById('btn-next');

  const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalPoints = cart.reduce((sum, item) => sum + (item.point * item.quantity), 0);

  cartCount.textContent = `${totalQty}개`;
  // 합계는 숫자만 업데이트 (HTML 구조에 이미 🪙 아이콘 포함)
  cartTotal.textContent = totalPoints;

  // 하나라도 담겨있어야 다음 진행 가능
  btnNext.disabled = totalQty === 0;
}

// 6. 경고 메시지 토글
function showCreditWarning() {
  const warningEl = document.getElementById('credit-warning');
  warningEl.textContent = '보낼 온기가 부족해요.';
  warningEl.style.display = 'block';
  hideStockWarning(); // 재고 경고는 숨김
  
  // 3초 후 자동 사라짐
  clearTimeout(window.warningTimeout);
  window.warningTimeout = setTimeout(() => {
    hideCreditWarning();
  }, 3000);
}

function hideCreditWarning() {
  const warningEl = document.getElementById('credit-warning');
  if (warningEl) warningEl.style.display = 'none';
}

function showStockWarning() {
  const warningEl = document.getElementById('stock-warning');
  warningEl.style.display = 'block';
  hideCreditWarning(); // 크레딧 경고는 숨김
  
  // 3초 후 자동 사라짐
  clearTimeout(window.stockWarningTimeout);
  window.stockWarningTimeout = setTimeout(() => {
    hideStockWarning();
  }, 3000);
}

function hideStockWarning() {
  const warningEl = document.getElementById('stock-warning');
  if (warningEl) warningEl.style.display = 'none';
}

// 초기 바인딩
window.addEventListener('DOMContentLoaded', () => {
  if (isGuestMenuBrowseMode()) {
    prepareGuestMenuBrowseMode();
    loadSnacks();

    AppState.bindCardTap(document.getElementById('btn-back'), () => {
      window.location.href = 'guest.html';
    });
    document.getElementById('btn-retry').addEventListener('click', () => {
      loadSnacks();
    });
    return;
  }

  checkUserSession();
  refreshGuestCreditStatus();
  loadSnacks();

  // 유휴 시간 자동 로그아웃 초기화 (70초 유휴 + 10초 경고)
  AppState.initIdleTimeout(70000, 10000);

  // 뒤로가기
  AppState.bindCardTap(document.getElementById('btn-back'), () => {
    const shouldReturnToPreview = isGuestPreviewMode();
    AppState.resetAll();
    if (shouldReturnToPreview) {
      window.location.href = 'guest.html?preview=1';
    } else if (user && user.userId === 'guest') {
      window.location.href = 'guest.html';
    } else {
      window.location.href = 'index.html?type=kiosk';
    }
  });

  // 다음단계
  AppState.bindCardTap(document.getElementById('btn-next'), () => {
    if (cart.length > 0) {
      window.location.href = 'confirm.html';
    }
  });

  // 에러 시 재호출
  document.getElementById('btn-retry').addEventListener('click', () => {
    loadSnacks();
  });
});
