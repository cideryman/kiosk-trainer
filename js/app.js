// 공통 앱 상태 관리 및 유틸리티
const AppState = {
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
});

// Progressive Web App 서비스 워커 등록 및 실시간 업데이트 처리
if ('serviceWorker' in navigator) {
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


