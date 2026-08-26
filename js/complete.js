let countdownInterval = null;
let secondsLeft = 5;
let pollInterval = null;
let lastStatus = null;
let summaryData = null;
let isRedirecting = false;
let isGuestMode = false;

// 띵동 차임벨 효과음 합성 (Web Audio API)
function playChimeSound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // 첫 번째 고음 (솔 - G5 784.00 Hz)
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(784.00, audioCtx.currentTime);
    gain1.gain.setValueAtTime(0, audioCtx.currentTime);
    gain1.gain.linearRampToValueAtTime(0.12, audioCtx.currentTime + 0.05);
    gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    
    osc1.start(audioCtx.currentTime);
    osc1.stop(audioCtx.currentTime + 0.5);
    
    // 두 번째 중음 (미 - E5 659.25 Hz)
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.18);
    gain2.gain.setValueAtTime(0, audioCtx.currentTime + 0.18);
    gain2.gain.linearRampToValueAtTime(0.12, audioCtx.currentTime + 0.23);
    gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.75);
    
    osc2.start(audioCtx.currentTime + 0.18);
    osc2.stop(audioCtx.currentTime + 0.75);
  } catch (e) {
    console.warn('효과음 합성 실패:', e);
  }
}

// 데이터 바인딩 및 분기 처리
function initView() {
  summaryData = JSON.parse(localStorage.getItem('lastOrderSummary'));
  
  if (!summaryData) {
    // 폴백: lastOrderSummary가 비어있어도 selectedUser가 게스트인지 검사
    const selectedUser = AppState.getSelectedUser();
    const fallbackIsGuest = selectedUser && selectedUser.userId === 'guest';
    
    isRedirecting = true;
    localStorage.removeItem('lastOrderSummary');
    AppState.resetAll();
    
    if (fallbackIsGuest) {
      window.location.href = 'guest.html';
    } else {
      window.location.href = 'index.html?type=kiosk';
    }
    return;
  }

  isGuestMode = (summaryData.userId === 'guest');

  if (isGuestMode) {
    refreshCompleteGuestSettings();
    setupGuestMode();
  } else {
    setupNormalMode();
  }
}

async function refreshCompleteGuestSettings() {
  try {
    const settingsRes = await fetchAPIReadWithRetry('getGuestSettings', { timeoutMs: 30000 });
    if (!settingsRes || !settingsRes.success) return;

    if (settingsRes.guestDefaultDeliveryPlace !== undefined) {
      sessionStorage.setItem('guestDefaultDeliveryPlace', String(settingsRes.guestDefaultDeliveryPlace ?? '사무실 원탁'));
    }
    sessionStorage.setItem('guestAllowRandomDisplayName', String(settingsRes.guestAllowRandomDisplayName === true));
  } catch (error) {
    console.warn('완료 화면 게스트 설정 재조회 실패:', error);
  }
}

// 일반 키오스크 모드 UI 구성
function setupNormalMode() {
  document.body.dataset.orderFlow = 'kiosk';
  document.getElementById('page-main-title').textContent = '🎉 주문이 잘 접수되었어요!';
  document.getElementById('normal-complete-view').style.display = 'flex';
  document.getElementById('guest-tracking-view').style.display = 'none';

  // 화면 출력
  document.getElementById('complete-title').innerHTML = `<span>${AppState.escapeHtml(summaryData.nickname)}</span> 님<br>주문이 잘 접수되었어요!`;
  document.getElementById('summary-name').textContent = `${summaryData.nickname} 님`;
  document.getElementById('summary-used').textContent = AppState.formatPoint(summaryData.usedPoints);
  document.getElementById('summary-remain').textContent = AppState.formatPoint(summaryData.remainPoints);

  // 주문번호 표시 여부 확인
  const orderNoEnabled = localStorage.getItem('orderNoEnabled') === 'true';
  let ttsText = `${summaryData.nickname} 님, 주문이 완료되었습니다.`;
  
  if (orderNoEnabled && summaryData.orderNo) {
    const shortNo = getShortNo(summaryData.orderNo);
    if (shortNo !== '-') {
      document.getElementById('order-number-box').style.display = 'flex';
      document.getElementById('order-number-box').style.flexDirection = 'column';
      document.getElementById('order-number-val').textContent = `${shortNo}번`;
      ttsText = `주문 완료! ${summaryData.nickname} 님, 주문번호는 ${shortNo}번입니다. 번호를 잘 기억해 주세요.`;
    }
  }
  
  AppState.speak(ttsText);
  AppState.vibrate([100, 50, 100, 50, 200]);
  
  // 8초 카운트다운 시작
  startRedirectTimer(8);
}

// 게스트 모드 실시간 주문 추적 UI 구성
function setupGuestMode() {
  document.body.dataset.orderFlow = 'guest';
  // 제목 변경
  document.getElementById('page-main-title').textContent = '☕ 실시간 간식 조리 현황';
  
  // 타이머 안내 문구 숨기기 (취소/수령 완료 시 다시 노출)
  document.getElementById('countdown-text').style.display = 'none';
  
  document.getElementById('normal-complete-view').style.display = 'none';
  document.getElementById('guest-tracking-view').style.display = 'flex';

  // 주문번호 바인딩
  const shortNo = getShortNo(summaryData.orderNo);
  document.getElementById('tracker-order-no-val').textContent = `${shortNo}번`;
  
  // 닉네임 안내문구 바인딩
  document.getElementById('tracker-nickname-msg').innerHTML = `😊 <span>${AppState.escapeHtml(summaryData.nickname)}</span> 님, 맛있게 조리 중인 간식을 실시간으로 확인해 보세요!`;

  // 주문 간식 내역 바인딩
  if (summaryData.items && Array.isArray(summaryData.items)) {
    const itemsStr = summaryData.items.map(item => `${AppState.escapeHtml(item.name)} ${item.quantity}개`).join(', ');
    document.getElementById('tracker-items-list-val').textContent = itemsStr;
  } else {
    document.getElementById('tracker-items-list-val').textContent = '간식 목록을 불러올 수 없습니다.';
  }

  // 웰컴 TTS 안내
  const isDelivery = summaryData.deliveryType === 'delivery';
  
  if (isDelivery) {
    document.getElementById('step-3-title').textContent = '배달 중';
    document.getElementById('step-3-desc').textContent = '간식이 배달 중입니다. 잠시만 기다려주세요!';
    document.querySelector('#step-3 .step-icon-circle span').textContent = '🛵';
    
    document.getElementById('step-4-title').textContent = '배달 완료';
    document.getElementById('step-4-desc').textContent = '배달이 완료되었습니다! 맛있게 드세요.';
  } else {
    document.getElementById('step-3-title').textContent = '준비 완료 (받아가세요!)';
    document.getElementById('step-3-desc').textContent = '간식이 준비되었습니다. 받아가세요!';
    document.querySelector('#step-3 .step-icon-circle span').textContent = '🎁';
    
    document.getElementById('step-4-title').textContent = '수령 완료';
    document.getElementById('step-4-desc').textContent = '맛있게 드세요! 감사합니다.';
  }

  // 배달지 박스 노출 처리
  const deliveryPlaceBox = document.getElementById('tracker-delivery-place-box');
  const deliveryPlaceVal = document.getElementById('tracker-delivery-place-val');
  if (isDelivery && summaryData.deliveryPlace) {
    if (deliveryPlaceBox && deliveryPlaceVal) {
      deliveryPlaceBox.style.display = 'flex';
      deliveryPlaceVal.textContent = summaryData.deliveryPlace;
    }
  } else {
    if (deliveryPlaceBox) {
      deliveryPlaceBox.style.display = 'none';
    }
  }

  AppState.speak(`주문 완료! ${summaryData.nickname} 님, 주문번호는 ${shortNo}번입니다. 실시간으로 주문 진행 상황을 보여드릴게요.`);
  AppState.vibrate([100, 50, 150]);

  // 실시간 폴링 시작 (순차 대기 폴링)
  pollOrderStatus();
}

// 주문번호에서 뒷자리 세 자리(단축번호) 추출 함수
function getShortNo(orderNo) {
  if (!orderNo) return '-';
  const parts = orderNo.split('-');
  if (parts.length >= 3) {
    const shortNo = parseInt(parts[2], 10);
    if (!isNaN(shortNo)) {
      return shortNo;
    }
  }
  return orderNo;
}

// 실시간 상태 폴링 함수
async function pollOrderStatus() {
  if (!summaryData) return;
  const orderIdentifier = summaryData.orderToken || summaryData.orderNo;
  if (!orderIdentifier) return;
  
  let isFinalStatus = false;
  try {
    const params = {};
    if (summaryData.orderToken) {
      params.orderToken = summaryData.orderToken;
    } else {
      params.orderNo = summaryData.orderNo;
    }

    const response = await fetchAPIReadWithRetry('getOrderStatus', {
      params,
      timeoutMs: 30000
    });
    if (response && response.success) {
      const currentStatus = response.servedYn || 'N';
      updateTrackingUI(currentStatus, summaryData.nickname, response.reviewed, response.cancelReason, response.cancelReasonDetail);
      if (currentStatus === 'Y' || currentStatus === 'C') {
        isFinalStatus = true;
      }
    }
  } catch (error) {
    console.warn('[Polling Error] 실시간 주문 폴링 실패:', error);
  } finally {
    // 최종 수령완료(Y) 또는 취소(C) 상태인 경우 더이상 루프를 예약하지 않음
    if (!isFinalStatus) {
      if (pollInterval) {
        clearTimeout(pollInterval);
      }
      pollInterval = setTimeout(pollOrderStatus, 5000); // 5초 대기 후 다음 폴링 진행
    }
  }
}

// 주문 상태에 따라 스텝퍼 UI 업데이트 및 알림
function updateTrackingUI(status, nickname, reviewed = false, cancelReason = '', cancelReasonDetail = '') {
  if (status === lastStatus && summaryData && summaryData.lastReviewedState === reviewed) return; // 변경될 때만 알림 발생
  
  const prevStatus = lastStatus;
  lastStatus = status;
  if (summaryData) summaryData.lastReviewedState = reviewed;
 
  // localStorage에 있는 guestOrders의 상태 업데이트
  if (summaryData && summaryData.userId === 'guest' && summaryData.orderNo) {
    try {
      const guestOrders = JSON.parse(localStorage.getItem('guestOrders') || '[]');
      let updated = false;
      guestOrders.forEach(o => {
        if (o.orderNo === summaryData.orderNo) {
          if (o.status !== status) {
            o.status = status;
            updated = true;
          }
        }
      });
      if (updated) {
        localStorage.setItem('guestOrders', JSON.stringify(guestOrders));
      }
    } catch (e) {
      console.warn('guestOrders 상태 동기화 실패:', e);
    }
  }

  const steps = [
    document.getElementById('step-1'),
    document.getElementById('step-2'),
    document.getElementById('step-3'),
    document.getElementById('step-4')
  ];
 
  // 기본값 리셋
  steps.forEach(el => { el.className = 'step-item pending'; });
 
  let activeIndex = 0;
  let ttsText = '';
  let playSoundFn = null;
 
  const isDelivery = summaryData && summaryData.deliveryType === 'delivery';

  if (status === 'P') { // 준비중
    activeIndex = 1;
    ttsText = `${nickname} 님, 주문하신 간식 조리가 시작되었습니다.`;
    playSoundFn = () => AppState.playClickSound();
  } else if (status === 'R') { // 준비완료
    activeIndex = 2;
    ttsText = isDelivery 
      ? `${nickname} 님, 간식이 배달 중입니다. 잠시만 기다려주세요!`
      : `${nickname} 님, 간식이 완성되었습니다! 카운터에서 가져가세요!`;
    playSoundFn = () => playChimeSound();
  } else if (status === 'Y') { // 수령완료
    activeIndex = 3;
    ttsText = isDelivery
      ? `간식 배달이 완료되었습니다. 맛있게 드세요!`
      : `간식 수령이 완료되었습니다. 맛있게 드세요!`;
    playSoundFn = () => AppState.playClickSound();
  } else if (status === 'C') { // 취소됨
    activeIndex = -1;
    ttsText = `주문이 취소되었습니다. 불편을 드려 죄송합니다.`;
    playSoundFn = () => AppState.playWarningSound();
  } else { // 'N' 접수중
    activeIndex = 0;
    ttsText = `주문이 성공적으로 접수되었습니다. 매장 확인 중입니다.`;
    if (prevStatus !== null) {
      playSoundFn = () => AppState.playClickSound();
    }
  }
 
  // UI 클래스 적용
  if (activeIndex >= 0) {
    for (let i = 0; i <= 3; i++) {
      if (i < activeIndex) {
        steps[i].className = 'step-item completed';
      } else if (i === activeIndex) {
        steps[i].className = 'step-item active';
      } else {
        steps[i].className = 'step-item pending';
      }
    }
  } else if (status === 'C') {
    // 취소 상태 표기
    steps.forEach(el => { el.className = 'step-item pending'; });
    const step1 = document.getElementById('step-1');
    step1.className = 'step-item active';
    step1.querySelector('.step-icon-circle span').textContent = '❌';
    step1.querySelector('.step-title').textContent = '주문 취소됨';
    step1.querySelector('.step-title').style.color = 'var(--danger-color)';
    
    let reasonStr = cancelReason ? `취소 사유: ${cancelReason}` : '관리자에 의해 주문이 취소되었습니다.';
    if (cancelReason === '기타' && cancelReasonDetail) {
      reasonStr += ` (${cancelReasonDetail})`;
    }
    
    step1.querySelector('.step-desc').textContent = reasonStr;
    step1.querySelector('.step-desc').style.color = 'var(--danger-color)';
  }
 
  // 실시간 상태 변화 피드백 (최초 렌더링 이후에만 작동)
  if (prevStatus !== null) {
    if (playSoundFn) playSoundFn();
    AppState.speak(ttsText);
    AppState.vibrate(status === 'R' ? [120, 80, 120] : 60);
  }

  // N 상태가 아니면 취소 버튼 숨기기
  const guestCancelBtn = document.getElementById('guest-cancel-btn-container');
  if (guestCancelBtn) {
    if (status === 'N') {
      guestCancelBtn.style.display = 'block';
    } else {
      guestCancelBtn.style.display = 'none';
    }
  }
 
  // 최종 단계(수령완료/취소됨)인 경우 10초 후에 자동 메인화면 리다이렉트
  if (status === 'Y' || status === 'C') {
    if (pollInterval) {
      clearTimeout(pollInterval);
    }
    if (status === 'Y') {
      const btnTrigger = document.getElementById('btn-write-review-trigger');
      const reviewedMsg = document.getElementById('reviewed-msg');
      if (reviewed === true) {
        if (btnTrigger) btnTrigger.style.display = 'none';
        if (reviewedMsg) reviewedMsg.style.display = 'block';
      } else {
        if (btnTrigger) btnTrigger.style.display = 'block';
        if (reviewedMsg) reviewedMsg.style.display = 'none';
      }
    }
    startRedirectTimer(10);
  }
}
 
// 메인으로 복귀 처리
function goHome() {
  if (isRedirecting) return;
  isRedirecting = true;

  // 모든 인터벌 정리
  clearInterval(countdownInterval);
  if (pollInterval) {
    clearTimeout(pollInterval);
  }
  
  const targetUrl = isGuestMode ? 'guest.html' : 'index.html?type=kiosk';
  
  // 세션 정리 (마지막 주문 정보 및 유저 초기화)
  localStorage.removeItem('lastOrderSummary');
  AppState.resetAll();
  
  // 메인으로 이동
  window.location.href = targetUrl;
}

// 리다이렉트 타이머 구동
function startRedirectTimer(seconds) {
  clearInterval(countdownInterval); // 이전 타이머 해제
  secondsLeft = seconds;
  
  const countdownTextEl = document.getElementById('countdown-text');
  const timerSecEl = document.getElementById('timer-sec');

  if (countdownTextEl) {
    countdownTextEl.style.display = 'block';
  }
  if (timerSecEl) {
    timerSecEl.textContent = secondsLeft;
  }
  
  // 취소 버튼 스타일 및 타이머 표시 초기 설정
  const btnNormalCancel = document.getElementById('btn-normal-cancel-order');
  if (btnNormalCancel) {
    btnNormalCancel.classList.add('wobble-cancel-btn');
    btnNormalCancel.style.minHeight = '64px';
    btnNormalCancel.style.fontSize = '20px';
    btnNormalCancel.style.fontWeight = '800';
    btnNormalCancel.textContent = `앗! 잘못 주문했나요? 취소하기 ⏳ ${secondsLeft}초`;
  }
  
  countdownInterval = setInterval(() => {
    secondsLeft--;
    if (timerSecEl) {
      timerSecEl.textContent = secondsLeft;
    }
    
    if (btnNormalCancel) {
      btnNormalCancel.textContent = `앗! 잘못 주문했나요? 취소하기 ⏳ ${secondsLeft}초`;
    }

    if (secondsLeft <= 0) {
      goHome();
    }
  }, 1000);
}

// 후기 사진 첨부 관련 상태 및 헬퍼 함수
let selectedReviewPhotoFile = null;

window.handleReviewPhotoSelected = function(fileInput) {
  const file = fileInput.files[0];
  if (!file) return;

  selectedReviewPhotoFile = file;

  const preview = document.getElementById('review-photo-preview');
  const status = document.getElementById('review-photo-status');
  const removeBtn = document.getElementById('btn-remove-review-photo');

  if (status) status.textContent = file.name;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    if (preview) {
      preview.src = e.target.result;
      preview.style.display = 'block';
    }
    if (removeBtn) {
      removeBtn.style.display = 'flex';
    }
  };
  reader.readAsDataURL(file);
  AppState.vibrate(30);
};

window.removeReviewPhoto = function() {
  selectedReviewPhotoFile = null;
  const input = document.getElementById('review-photo-input');
  const preview = document.getElementById('review-photo-preview');
  const status = document.getElementById('review-photo-status');
  const removeBtn = document.getElementById('btn-remove-review-photo');

  if (input) input.value = '';
  if (preview) {
    preview.src = '';
    preview.style.display = 'none';
  }
  if (status) status.textContent = '선택된 사진 없음';
  if (removeBtn) removeBtn.style.display = 'none';
  AppState.vibrate(20);
};

function compressImage(file, maxWidth, maxHeight, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

// 바인딩
window.addEventListener('DOMContentLoaded', () => {
  initView();

  // 홈으로 버튼 클릭 시 즉시 복귀
  document.getElementById('btn-home').addEventListener('click', () => {
    goHome();
  });

  // 후기 작성 모달 관련 바인딩
  const reviewModal = document.getElementById('modal-write-review');
  const btnWriteReviewTrigger = document.getElementById('btn-write-review-trigger');
  const btnCloseReviewModal = document.getElementById('btn-close-review-modal');
  const btnCancelReview = document.getElementById('btn-cancel-review');
  const btnSubmitReview = document.getElementById('btn-submit-review');
  const stampButtons = document.querySelectorAll('#stamp-select-group .stamp-btn');
  const tagCapsules = document.querySelectorAll('#tags-select-group .tag-capsule');

  if (btnWriteReviewTrigger) {
    btnWriteReviewTrigger.addEventListener('click', () => {
      // 타이머 일시 정지 및 모달 열기
      clearInterval(countdownInterval);
      const countdownTextEl = document.getElementById('countdown-text');
      if (countdownTextEl) countdownTextEl.style.display = 'none';
      
      if (reviewModal) reviewModal.style.display = 'flex';
      document.documentElement.classList.add('modal-open');
      document.body.classList.add('modal-open');
      AppState.vibrate(50);
      AppState.playClickSound();
    });
  }

  function closeReviewModal() {
    if (reviewModal) reviewModal.style.display = 'none';
    document.documentElement.classList.remove('modal-open');
    document.body.classList.remove('modal-open');
    removeReviewPhoto();
    // 5초 타이머 재개
    startRedirectTimer(5);
  }

  if (btnCloseReviewModal) {
    btnCloseReviewModal.addEventListener('click', () => {
      closeReviewModal();
      AppState.vibrate(30);
    });
  }

  if (btnCancelReview) {
    btnCancelReview.addEventListener('click', () => {
      closeReviewModal();
      AppState.vibrate(30);
    });
  }

  // 스탬프 선택 바인딩
  stampButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      stampButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.vibrate(30);
      AppState.playClickSound();
    });
  });

  // 태그 선택 바인딩
  tagCapsules.forEach(cap => {
    cap.addEventListener('click', () => {
      cap.classList.toggle('active');
      AppState.vibrate(30);
      AppState.playClickSound();
    });
  });

  // 후기 제출 바인딩
  if (btnSubmitReview) {
    btnSubmitReview.addEventListener('click', async () => {
      if (!summaryData) return;

      const activeStamp = document.querySelector('#stamp-select-group .stamp-btn.active');
      const stamp = activeStamp ? activeStamp.getAttribute('data-stamp') : '';
      
      const activeCapsules = document.querySelectorAll('#tags-select-group .tag-capsule.active');
      const tags = Array.from(activeCapsules).map(c => c.getAttribute('data-tag')).join(', ');
      
      const comment = document.getElementById('review-comment').value.trim();
      const isPublic = document.getElementById('review-is-public').checked;

      btnSubmitReview.disabled = true;
      btnSubmitReview.textContent = '제출 중...';

      try {
        let imageUrl = '';
        if (selectedReviewPhotoFile) {
          btnSubmitReview.textContent = '사진 업로드 중...';
          
          // 1. 이미지 압축 (최대 600px, 0.7 퀄리티)
          const base64Data = await compressImage(selectedReviewPhotoFile, 600, 600, 0.7);
          
          const timestamp = Math.floor(Date.now() / 1000);
          const extension = selectedReviewPhotoFile.name.split('.').pop() || 'jpg';
          const fileName = `review_${summaryData.orderNo}_${timestamp}.${extension}`;
          
          // 2. 이미지 업로드 API 호출
          const uploadRes = await fetchAPI('uploadImage', {
            method: 'POST',
            body: {
              base64Data: base64Data,
              fileName: fileName,
              orderToken: summaryData.orderToken,
              type: 'review'
            }
          });
          
          if (uploadRes && uploadRes.success && uploadRes.imageUrl) {
            imageUrl = uploadRes.imageUrl;
          } else {
            const errMsg = (uploadRes && uploadRes.message) ? uploadRes.message : '네트워크 오류 또는 서버 응답 실패';
            if (!confirm(`⚠️ 후기 사진 업로드에 실패했습니다.\n\n[오류 내용]\n${errMsg}\n\n사진 없이 후기 텍스트만 등록하시겠습니까?`)) {
              btnSubmitReview.disabled = false;
              btnSubmitReview.textContent = '보내기';
              return;
            }
          }
        }

        btnSubmitReview.textContent = '후기 제출 중...';
        const res = await fetchAPI('submitReview', {
          method: 'POST',
          body: {
            orderId: summaryData.orderNo,
            orderToken: summaryData.orderToken,
            guestName: summaryData.nickname,
            stamp: stamp,
            tags: tags,
            comment: comment,
            isPublic: isPublic,
            imageUrl: imageUrl
          }
        });

        if (res && res.success) {
          AppState.vibrate(80);
          alert('소중한 응원을 남겨주셔서 감사합니다! ❤️');
          closeReviewModal();
          const btnTrigger = document.getElementById('btn-write-review-trigger');
          const reviewedMsg = document.getElementById('reviewed-msg');
          if (btnTrigger) btnTrigger.style.display = 'none';
          if (reviewedMsg) reviewedMsg.style.display = 'block';
          if (summaryData) summaryData.lastReviewedState = true;
          startRedirectTimer(10);
        } else {
          alert('후기 제출에 실패했습니다: ' + (res.message || '오류'));
          btnSubmitReview.disabled = false;
          btnSubmitReview.textContent = '보내기';
        }
      } catch (e) {
        console.error('후기 제출 오류:', e);
        alert('통신 오류가 발생했습니다.');
        btnSubmitReview.disabled = false;
        btnSubmitReview.textContent = '보내기';
      }
    });
  }

  // 주문 취소 처리 로직
  async function handleUserCancel() {
    const cancelMessage = isGuestMode
      ? '정말로 주문을 취소하시겠습니까?\n주문을 취소하면 사용한 온기는 돌려드리고, 간식 재고는 복구됩니다.'
      : '정말로 주문을 취소하시겠습니까?\n주문을 취소하면 간식 재고가 복구됩니다.';
    if (!confirm(cancelMessage)) return;
    
    const orderIdentifier = isGuestMode ? summaryData.orderToken : summaryData.orderNo;
    
    try {
      // 버튼 비활성화 (여러번 클릭 방지)
      const btn1 = document.getElementById('btn-normal-cancel-order');
      const btn2 = document.getElementById('btn-guest-cancel-order');
      if (btn1) { btn1.disabled = true; btn1.textContent = '취소 중...'; }
      if (btn2) { btn2.disabled = true; btn2.textContent = '취소 중...'; }

      const res = await fetchAPI('userCancelOrder', {
        method: 'POST',
        body: { orderId: summaryData.orderNo || orderIdentifier, orderToken: summaryData.orderToken }
      });

      if (res && res.success) {
        AppState.vibrate([100, 50, 100]);
        alert(res.message || '주문이 정상적으로 취소되었습니다.');
        
        // 로컬 스토리지 guestOrders 업데이트 (게스트 모드일 경우)
        if (isGuestMode) {
          try {
            const guestOrders = JSON.parse(localStorage.getItem('guestOrders') || '[]');
            const updated = guestOrders.map(o => {
              if (o.orderToken === summaryData.orderToken) {
                return { ...o, status: 'C' };
              }
              return o;
            });
            localStorage.setItem('guestOrders', JSON.stringify(updated));
          } catch(e) {}
        }

        // 취소 후 메인으로
        goHome();
      } else {
        alert('취소 실패: ' + (res?.message || '알 수 없는 오류'));
        // 복구
        if (btn1) { btn1.disabled = false; btn1.textContent = '주문 취소하기 (접수 단계만 가능)'; }
        if (btn2) { btn2.disabled = false; btn2.textContent = '주문 취소하기 (접수 단계만 가능)'; }
      }
    } catch (e) {
      console.error('취소 오류:', e);
      alert('통신 오류가 발생했습니다.');
      // 복구
      const btn1 = document.getElementById('btn-normal-cancel-order');
      const btn2 = document.getElementById('btn-guest-cancel-order');
      if (btn1) { btn1.disabled = false; btn1.textContent = '주문 취소하기 (접수 단계만 가능)'; }
      if (btn2) { btn2.disabled = false; btn2.textContent = '주문 취소하기 (접수 단계만 가능)'; }
    }
  }

  const btnNormalCancel = document.getElementById('btn-normal-cancel-order');
  if (btnNormalCancel) {
    btnNormalCancel.addEventListener('click', handleUserCancel);
  }

  const btnGuestCancel = document.getElementById('btn-guest-cancel-order');
  if (btnGuestCancel) {
    btnGuestCancel.addEventListener('click', handleUserCancel);
  }
});
