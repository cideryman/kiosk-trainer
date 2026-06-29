// 공통 앱 상태 관리 및 유틸리티
const AppState = {
  tapMoveTolerancePx: 40,
  tapMaxDurationMs: 700,

  // 이용자 관련 스토리지 헬퍼
  getSelectedUser() {
    try {
      return JSON.parse(localStorage.getItem('selectedUser')) || null;
    } catch (e) {
      return null;
    }
  },

  setSelectedUser(user) {
    localStorage.setItem('selectedUser', JSON.stringify(user));
  },

  clearSelectedUser() {
    localStorage.removeItem('selectedUser');
  },

  getGuestAuth() {
    try {
      const auth = JSON.parse(localStorage.getItem('guestAuth')) || null;
      if (!auth || auth.provider !== 'kakao' || !auth.guestKey) return null;
      return auth;
    } catch (e) {
      return null;
    }
  },

  setGuestAuth(auth) {
    if (!auth || auth.provider !== 'kakao' || !auth.guestKey) return;
    localStorage.setItem('guestAuth', JSON.stringify({
      provider: 'kakao',
      guestKey: auth.guestKey,
      authenticatedAt: auth.authenticatedAt || new Date().toISOString(),
    }));
  },

  clearGuestAuth() {
    localStorage.removeItem('guestAuth');
  },

  // 장바구니 관련 스토리지 헬퍼
  getCart() {
    try {
      return JSON.parse(localStorage.getItem('cart')) || [];
    } catch (e) {
      return [];
    }
  },

  setCart(cart) {
    localStorage.setItem('cart', JSON.stringify(cart));
  },

  clearCart() {
    localStorage.removeItem('cart');
  },

  // 주문 성공 후 스토리지 정리
  clearOrderState() {
    this.clearCart();
    // selectedUser는 주문 완료 화면에서 필요할 수 있으므로, 완전 초기화 시점에 삭제
  },

  getGuestDeviceId() {
    let deviceId = localStorage.getItem('guestDeviceId');
    if (!deviceId) {
      deviceId = 'GUEST-' + Math.floor(Math.random() * 1000000) + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();
      localStorage.setItem('guestDeviceId', deviceId);
    }
    return deviceId;
  },

  // 모든 세션 초기화
  resetAll() {
    this.clearSelectedUser();
    this.clearCart();
  },

  // 발달장애인을 위한 촉각 피드백 (진동)
  vibrate(ms = 50) {
    if ('vibrate' in navigator) {
      navigator.vibrate(ms);
    }
  },

  // 금액/포인트 표시 포맷터
  formatPoint(point) {
    return `${point} 크레딧`;
  },

  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  escapeAttr(value) {
    return this.escapeHtml(value);
  },

  // 구글 드라이브 이미지 주소를 브라우저에서 직접 표시 가능한 썸네일 주소로 변환
  convertDriveImageUrl(url) {
    if (!url) return '';
    const text = String(url).trim();

    // 구글 드라이브 주소인지 확인
    const isDrive = text.includes("drive.google.com") || text.includes("docs.google.com");
    
    if (isDrive) {
      // 1) /d/파일ID/ 형식 추출
      const dMatch = text.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (dMatch && dMatch[1]) {
        return `https://drive.google.com/thumbnail?id=${dMatch[1]}&sz=w500`;
      }
      // 2) id=파일ID 형식 추출
      const idMatch = text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (idMatch && idMatch[1]) {
        return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w500`;
      }
    }

    // 3) 만약 HTTP/HTTPS 주소가 아니면서 특정 알파벳/숫자/대시/언더바 조합인 경우 단순 파일 ID로 보고 구글 드라이브 주소로 치환
    if (!text.startsWith("http") && /^[a-zA-Z0-9_-]{25,}$/.test(text)) {
      return `https://drive.google.com/thumbnail?id=${text}&sz=w500`;
    }

    return text;
  },

  // 이름에 따른 기본 이모지 매핑 함수 (발달장애인을 위한 시각 보완)
  getSnackEmoji(name) {
    const lowerName = String(name || '').toLowerCase();
    if (lowerName.includes('쿠키') || lowerName.includes('초코') || lowerName.includes('칩')) return '🍪';
    if (lowerName.includes('감자') || lowerName.includes('칩') || lowerName.includes('과자') || lowerName.includes('포테이토')) return '🥔';
    if (lowerName.includes('사이다') || lowerName.includes('콜라') || lowerName.includes('탄산') || lowerName.includes('소다')) return '🥤';
    if (lowerName.includes('주스') || lowerName.includes('쥬스') || lowerName.includes('즙') || lowerName.includes('에이드')) return '🧃';
    if (lowerName.includes('우유') || lowerName.includes('라떼')) return '🥛';
    if (lowerName.includes('젤리') || lowerName.includes('하리보') || lowerName.includes('마이구미')) return '🍬';
    if (lowerName.includes('빵') || lowerName.includes('케이크') || lowerName.includes('도넛')) return '🍞';
    if (lowerName.includes('사탕') || lowerName.includes('롤리팝')) return '🍭';
    if (lowerName.includes('초콜릿') || lowerName.includes('가나')) return '🍫';
    return '🍿'; // 디폴트
  },

  // 효과음 재생 (Web Audio API 동적 합성)
  playClickSound() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      // 맑고 부드러운 '뾱' 소리 (주파수가 빠르게 상승 후 하강)
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(600, audioCtx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(1000, audioCtx.currentTime + 0.05);
      oscillator.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.12);

      gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);

      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.12);
    } catch (e) {
      console.warn("효과음 재생 실패:", e);
    }
  },

  // 경고음 재생 (Web Audio API 동적 합성)
  playWarningSound() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      
      // 첫 번째 음: 높은 도 (C5 - 523.25 Hz)
      const osc1 = audioCtx.createOscillator();
      const gain1 = audioCtx.createGain();
      osc1.connect(gain1);
      gain1.connect(audioCtx.destination);
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, audioCtx.currentTime);
      gain1.gain.setValueAtTime(0, audioCtx.currentTime);
      gain1.gain.linearRampToValueAtTime(0.12, audioCtx.currentTime + 0.05);
      gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
      osc1.start(audioCtx.currentTime);
      osc1.stop(audioCtx.currentTime + 0.4);
      
      // 두 번째 음: 솔 (G4 - 392.00 Hz) - 0.15초 뒤 재생
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(392.00, audioCtx.currentTime + 0.15);
      gain2.gain.setValueAtTime(0, audioCtx.currentTime + 0.15);
      gain2.gain.linearRampToValueAtTime(0.12, audioCtx.currentTime + 0.2);
      gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
      osc2.start(audioCtx.currentTime + 0.15);
      osc2.stop(audioCtx.currentTime + 0.6);
    } catch (e) {
      console.warn("경고음 재생 실패:", e);
    }
  },

  // TTS 상태 및 음성 합성 헬퍼
  isTtsEnabled() {
    return localStorage.getItem('ttsEnabled') === 'true';
  },

  setTtsEnabled(enabled) {
    localStorage.setItem('ttsEnabled', enabled ? 'true' : 'false');
  },

  speak(text) {
    if (!this.isTtsEnabled()) return;
    try {
      // 진행 중인 음성 취소
      window.speechSynthesis.cancel();
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ko-KR';
      utterance.rate = 1.1; // 살짝 빠른 한국어 템포가 더 자연스러움
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn("TTS 재생 실패:", e);
    }
  },

  bindCardTap(element, callback) {
    if (!element) return;
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let isPointerDown = false;

    element.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary) return;
      startX = e.clientX;
      startY = e.clientY;
      startTime = Date.now();
      isPointerDown = true;
    });

    element.addEventListener('pointerup', (e) => {
      if (!isPointerDown) return;
      isPointerDown = false;

      if (!e.isPrimary) return;

      const diffX = e.clientX - startX;
      const diffY = e.clientY - startY;
      const dist = Math.sqrt(diffX * diffX + diffY * diffY);
      const duration = Date.now() - startTime;

      // 손 떨림이 있는 이용자도 의도한 탭으로 인정되도록 약간 넉넉하게 판정합니다.
      if (dist < this.tapMoveTolerancePx && duration < this.tapMaxDurationMs) {
        callback(e);
      }
    });

    element.addEventListener('pointercancel', () => {
      isPointerDown = false;
    });
  },

  initIdleTimeout(timeoutMs = 70000, warningMs = 10000) {
    const self = this;
    let idleTimer = null;
    let countdownTimer = null;
    let countdownSec = 10;
    let isWarningActive = false;

    // 경고 오버레이 생성 (최초 1회 레이지 로딩)
    let overlay = document.getElementById('idle-timeout-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'idle-timeout-overlay';
      overlay.className = 'idle-timeout-overlay';
      overlay.innerHTML = `
        <div class="idle-timeout-box">
          <div class="idle-timeout-emoji">⏰</div>
          <div class="idle-timeout-title">주문을 계속하시겠습니까?</div>
          <div class="idle-timeout-desc">
            <span id="idle-countdown-sec" class="idle-timeout-countdown">10</span>초 후에<br>처음 화면으로 돌아갑니다.
          </div>
          <div class="idle-timeout-footer">
            화면을 터치하면 계속 주문할 수 있어요!
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      // 오버레이 터치 시 유휴 리셋 및 복귀
      overlay.addEventListener('click', (e) => {
        e.stopPropagation();
        resetIdleAndDismissWarning();
      });
    }

    function startIdleTimer() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(showWarning, timeoutMs);
    }

    function resetIdleAndDismissWarning() {
      if (isWarningActive) {
        isWarningActive = false;
        overlay.style.display = 'none';
        clearInterval(countdownTimer);

        // 촉각/청각 피드백
        self.playClickSound();
        self.vibrate(50);

        // 기존 안내 멈추고 주문 연장 안내 재생
        try {
          window.speechSynthesis.cancel();
        } catch (e) {}
        self.speak("주문을 계속합니다.");
      }
      startIdleTimer();
    }

    function showWarning() {
      isWarningActive = true;
      overlay.style.display = 'flex';
      countdownSec = warningMs / 1000;
      const countEl = document.getElementById('idle-countdown-sec');
      if (countEl) countEl.textContent = countdownSec;

      // 경고 진동 및 음향
      self.playWarningSound();
      self.vibrate([100, 50, 100]);

      // TTS 경고 방송
      self.speak("장시간 입력이 없어 10초 후에 처음 화면으로 돌아갑니다. 화면을 터치하면 계속 주문할 수 있습니다.");

      clearInterval(countdownTimer);
      countdownTimer = setInterval(() => {
        countdownSec--;
        if (countdownSec <= 0) {
          clearInterval(countdownTimer);
          handleTimeout();
        } else {
          if (countEl) countEl.textContent = countdownSec;
          
          // 마지막 3초인 경우 짧은 진동 및 비프음 틱 연출
          if (countdownSec <= 3) {
            self.vibrate(30);
            try {
              const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
              const osc = audioCtx.createOscillator();
              const gain = audioCtx.createGain();
              osc.connect(gain);
              gain.connect(audioCtx.destination);
              osc.frequency.setValueAtTime(800, audioCtx.currentTime);
              gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
              osc.start();
              osc.stop(audioCtx.currentTime + 0.08);
            } catch (e) {}
          }
        }
      }, 1000);
    }

    function handleTimeout() {
      overlay.style.display = 'none';
      const currentUser = self.getSelectedUser();
      const isGuest = currentUser && currentUser.userId === 'guest';

      self.resetAll();

      if (isGuest) {
        window.location.href = 'guest.html';
      } else {
        window.location.href = 'index.html?type=kiosk';
      }
    }

    // 터치, 마우스, 스크롤, 키 입력 등 사용자 활동 리스너 결합
    const resetEvents = ['pointerdown', 'keydown', 'scroll', 'click'];
    resetEvents.forEach(evt => {
      window.addEventListener(evt, () => {
        if (!isWarningActive) {
          startIdleTimer();
        }
      }, { passive: true });
    });

    // 최초 타이머 시작
    startIdleTimer();
  }
};

// 모바일 브라우저의 100vh 스크롤 이슈 방지용 --vh 커스텀 프로퍼티 정의
function updateViewportHeight() {
  let vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}

window.addEventListener('resize', updateViewportHeight);

window.addEventListener('DOMContentLoaded', () => {
  updateViewportHeight();

  document.body.addEventListener('click', (e) => {
    if (e.target.closest('button') || 
        e.target.closest('.clickable-card') || 
        e.target.closest('.user-card') || 
        e.target.closest('.snack-card') || 
        e.target.closest('.snack-img-container')) {
      AppState.vibrate(40);
      AppState.playClickSound();
    }
  });

  // 오프라인 상태 실시간 감지 초기화
  initOfflineDetector();
});

// 실시간 인터넷 연결 상태 감지 전면 팝업 연동
function initOfflineDetector() {
  const overlayId = 'global-offline-overlay';
  
  function showOfflineOverlay() {
    let overlay = document.getElementById(overlayId);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = overlayId;
      overlay.className = 'offline-full-overlay';
      overlay.innerHTML = `
        <div class="offline-full-box">
          <img class="offline-illustration" src="assets/offline.png" alt="인터넷 연결 끊김 안내">
          <div class="offline-title">인터넷 연결이 끊겼어요</div>
          <div class="offline-desc">인터넷이 다시 연결되기를 기다리고 있습니다.</div>
          <div class="offline-footer">
            <span class="offline-loading-spinner"></span>
            연결 확인 중...
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      
      AppState.playWarningSound();
      AppState.vibrate([100, 100, 100]);
      AppState.speak("인터넷 연결이 끊겼습니다. 다시 연결되기를 기다리고 있으니 잠시만 기다려 주세요.");
    }
  }
  
  function hideOfflineOverlay() {
    const overlay = document.getElementById(overlayId);
    if (overlay) {
      overlay.style.transition = 'opacity 0.25s ease-out';
      overlay.style.opacity = '0';
      setTimeout(() => {
        if (overlay.parentNode) {
          overlay.remove();
        }
      }, 250);
      
      AppState.playClickSound();
      AppState.vibrate(50);
      AppState.speak("인터넷이 다시 연결되었습니다. 주문을 계속해 주세요!");
    }
  }
  
  window.addEventListener('offline', showOfflineOverlay);
  window.addEventListener('online', hideOfflineOverlay);
  
  if (!navigator.onLine) {
    showOfflineOverlay();
  }
}

// Progressive Web App 서비스 워커 등록 및 실시간 업데이트 처리
if ('serviceWorker' in navigator) {
  if (localStorage.getItem('sw_version_fixed') !== 'v61') {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      if (registrations.length > 0) {
        console.log('[Service Worker] 이전 버그가 있는 서비스 워커 제거 중...');
        Promise.all(registrations.map(r => r.unregister())).then(() => {
          localStorage.setItem('sw_version_fixed', 'v61');
          console.log('[Service Worker] 제거 완료. 페이지를 새로고침합니다.');
          window.location.reload();
        });
      } else {
        localStorage.setItem('sw_version_fixed', 'v61');
      }
    });
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js')
        .then((registration) => {
          console.log('서비스 워커 등록 성공! 범위:', registration.scope);

          // 업데이트 감지 시 처리
          registration.addEventListener('updatefound', () => {
            const installingWorker = registration.installing;
            if (installingWorker) {
              installingWorker.addEventListener('statechange', () => {
                if (installingWorker.state === 'installed') {
                  if (navigator.serviceWorker.controller) {
                    console.log('[Service Worker] 새 버전의 캐시가 준비되었습니다. 곧 업데이트됩니다.');
                  }
                }
              });
            }
          });
        })
        .catch((error) => {
          console.error('서비스 워커 등록 실패:', error);
        });
    });

    // 새로운 서비스 워커가 활성화(activate)되어 제어권을 가져갔을 때(controllerchange) 페이지를 자동으로 새로고침하여 최신 코드를 적용합니다.
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        console.log('[Service Worker] 최신 캐시 적용을 위해 페이지를 자동으로 새로고침합니다.');
        window.location.reload();
      }
    });
  }
}


