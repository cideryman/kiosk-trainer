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
    if (e.target.closest('button') || e.target.closest('.clickable-card')) {
      AppState.vibrate(40);
    }
  });
});

// Progressive Web App 서비스 워커 등록
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js')
      .then((registration) => {
        console.log('서비스 워커 등록 성공! 범위:', registration.scope);
      })
      .catch((error) => {
        console.error('서비스 워커 등록 실패:', error);
      });
  });
}


