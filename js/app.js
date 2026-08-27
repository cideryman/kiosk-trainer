// 공통 앱 상태 관리 및 유틸리티
// 화면 원문은 보존하고, TTS에서 장식 기호가 그대로 발화되지 않도록 정리합니다.
function cleanSpeechText(text) {
  return String(text || '')
    .replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDC00-\uDFFF]/g, '')
    .replace(/["“”‘’「」『』`]/g, '')
    .replace(/~+/g, ' ')
    .replace(/[!！?？]+/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/[^\p{L}\p{N}\s.,。]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,。]+$/g, '')
    .trim();
}

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
      if (!auth) return null;
      if (auth.provider !== 'kakao' || !auth.guestKey) {
        this.clearGuestAuth(true);
        return null;
      }
      const expiresAtMs = new Date(auth.expiresAt || '').getTime();
      if (!auth.kakaoAuthProof || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
        this.clearGuestAuth(true);
        return null;
      }
      return auth;
    } catch (e) {
      this.clearGuestAuth(true);
      return null;
    }
  },

  setGuestAuth(auth) {
    const expiresAtMs = new Date(auth && auth.expiresAt || '').getTime();
    if (!auth || auth.provider !== 'kakao' || !auth.guestKey || !auth.kakaoAuthProof
        || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return;
    localStorage.setItem('guestAuth', JSON.stringify({
      provider: 'kakao',
      guestKey: auth.guestKey,
      kakaoAuthProof: auth.kakaoAuthProof,
      authenticatedAt: auth.authenticatedAt || new Date().toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    }));
    sessionStorage.removeItem('kakaoReauthRequired');
  },

  getGuestAuthRequestPayload() {
    const auth = this.getGuestAuth();
    return auth ? {
      authProvider: 'kakao',
      guestKey: auth.guestKey,
      kakaoAuthProof: auth.kakaoAuthProof,
    } : {};
  },

  needsKakaoReauth() {
    return sessionStorage.getItem('kakaoReauthRequired') === '1';
  },

  clearGuestAuth(requireReauth = false) {
    const hadAuth = !!localStorage.getItem('guestAuth');
    localStorage.removeItem('guestAuth');
    if (requireReauth && hadAuth) sessionStorage.setItem('kakaoReauthRequired', '1');
    try {
      const selectedUser = JSON.parse(localStorage.getItem('selectedUser') || 'null');
      if (selectedUser && selectedUser.userId === 'guest' && selectedUser.authProvider === 'kakao') {
        delete selectedUser.authProvider;
        delete selectedUser.guestKey;
        delete selectedUser.guestProfileSaved;
        delete selectedUser.rememberedDeliveryPlace;
        localStorage.setItem('selectedUser', JSON.stringify(selectedUser));
      }
    } catch (e) {}
  },

  getLocalDateKey() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  },

  getLocalGuestDisplayNameRecord() {
    const raw = String(localStorage.getItem('localGuestDisplayName') || '').trim();
    if (!raw) return null;

    let record = null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        record = {
          dateKey: String(parsed.dateKey || '').trim(),
          displayName: String(parsed.displayName || '').trim()
        };
      }
    } catch (e) {
      // 이전 버전의 문자열 저장값은 오늘 확정된 표시명으로 한 번만 마이그레이션합니다.
      record = {
        dateKey: this.getLocalDateKey(),
        displayName: raw
      };
      localStorage.setItem('localGuestDisplayName', JSON.stringify(record));
    }

    if (!record || !record.displayName) {
      this.clearLocalGuestDisplayName();
      return null;
    }

    if (!record.dateKey || record.dateKey !== this.getLocalDateKey()) {
      this.clearLocalGuestDisplayName();
      return null;
    }

    return record;
  },

  getLocalGuestDisplayName() {
    const record = this.getLocalGuestDisplayNameRecord();
    return record ? record.displayName : '';
  },

  setLocalGuestDisplayName(name) {
    const displayName = String(name || '').trim();
    if (displayName) {
      localStorage.setItem('localGuestDisplayName', JSON.stringify({
        dateKey: this.getLocalDateKey(),
        displayName
      }));
    } else {
      localStorage.removeItem('localGuestDisplayName');
    }
  },

  clearLocalGuestDisplayName() {
    localStorage.removeItem('localGuestDisplayName');
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
    if (point === undefined || point === null) return '❤️ 0개';
    return `❤️ ${point}개`;
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
      
      const cleanedText = cleanSpeechText(text);
      if (!cleanedText) return;
      const utterance = new SpeechSynthesisUtterance(cleanedText);
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

function renderSystemDiagnosisExtras(report) {
  const escape = value => AppState.escapeHtml(String(value ?? ''));
  const contract = typeof getApiContractStatus === 'function'
    ? getApiContractStatus(report)
    : { expected: '', actual: '', compatible: true };
  const environment = escape(report?.environment || 'unset');
  const trigger = report?.triggers?.weeklyRotation || {};
  const cache = report?.cache?.scriptCache || {};
  const timings = report?.timingsMs || {};
  const timingText = Object.entries(timings)
    .map(([key, value]) => `${escape(key)} ${escape(value)}ms`)
    .join(' · ');
  const recovery = report?.recoveryAlerts || { status: 'OK', openCount: 0, alerts: [] };
  const kakaoProof = report?.security?.kakaoAuthProof || {};
  const recoveryItems = (recovery.alerts || []).map(alert => {
    const alertId = String(alert.alertId || '');
    const flags = [alert.recoveryRequired ? '원상복구 필요' : '', alert.cleanupRequired ? '백업 삭제 필요' : ''].filter(Boolean).join(' · ');
    const backups = (alert.backupSheetNames || []).join(', ') || '백업명 없음';
    return `<div style="padding:10px;border:2px solid #FEB2B2;background:#FFF5F5;border-radius:var(--radius-sm);font-size:13px;color:#742A2A;word-break:break-all;">
      <strong>🔴 ${escape(alert.orderNo || '주문번호 없음')} · ${escape(alert.stage || 'UNKNOWN')}</strong><br>
      ${escape(flags)} · ${escape(alert.lastSeenAt || alert.occurredAt || '')}<br>
      백업: ${escape(backups)}
      <button class="btn btn-gray" type="button" style="margin:8px 0 0;min-height:34px;width:auto;font-size:12px;" onclick="acknowledgeOrderRecoveryAlert('${escape(alertId)}')">수동 조치 확인 완료</button>
    </div>`;
  }).join('');

  const item = (ok, title, detail) => `
    <div style="padding: 10px; border: 2px solid ${ok ? '#9AE6B4' : '#FEEBC8'}; background-color: ${ok ? '#F0FFF4' : '#FFFDF5'}; border-radius: var(--radius-sm); font-size: 14px; font-weight: 700; color: ${ok ? '#22543D' : '#9C4221'}; display: flex; flex-direction: column; gap: 3px;">
      <strong>${ok ? '정상' : '확인 필요'} · ${escape(title)}</strong>
      <span style="font-size: 13px; font-weight: 600;">${escape(detail)}</span>
    </div>`;

  return `
    <h3 style="font-size: 16px; font-weight: 850; margin: 10px 0 6px 0; border-bottom: 2px dashed var(--border-color); padding-bottom: 4px;">배포 및 실행 환경</h3>
    ${item(contract.compatible, 'API 계약 버전', `화면 ${contract.expected || '-'} / GAS ${contract.actual || '미확인'}`)}
    ${item(environment === 'production' || environment === 'staging', '배포 환경', environment)}
    ${item(trigger.status === 'OK' && trigger.count === 1, '주간 신청 순환 트리거', `등록 ${trigger.count ?? '확인 실패'}개`)}
    ${item(cache.status === 'OK' && cache.roundTrip === true, '서비스 캐시', cache.roundTrip ? '읽기·쓰기 정상' : '왕복 확인 실패')}
    ${item(kakaoProof.status === 'OK', '카카오 서버 증명', kakaoProof.legacyWindowActive ? `기존 로그인 유예 중 · ${kakaoProof.legacyUntil || '종료 시각 확인 필요'}` : `서명키 설정 · ${kakaoProof.ttlHours || 12}시간 증명 · 기존 guestKey 차단`)}
    ${item(Number(timings.total) >= 0, '진단 소요시간', timingText || '측정값 없음')}
    <h3 style="font-size:16px;font-weight:850;margin:10px 0 6px;border-bottom:2px dashed var(--border-color);padding-bottom:4px;">자동복구 운영 경고</h3>
    ${item(recovery.status === 'OK', '열린 복구 경고', recovery.status === 'OK' ? '없음' : `${recovery.openCount || 0}건 · 백업 확인과 수동 조치가 필요합니다.`)}
    ${recoveryItems}
  `;
}

const AdminAuth = {
  storageKey: 'kioskAdminToken',
  root: null,
  options: {},

  init(options = {}) {
    this.root = document.querySelector('[data-admin-auth]');
    this.options = options;
    if (!this.root) return;

    const form = this.root.querySelector('[data-admin-auth-form]');
    const lockButton = this.root.querySelector('[data-admin-auth-lock]');

    if (form && !form.dataset.bound) {
      form.dataset.bound = 'true';
      form.addEventListener('submit', event => this.submit(event));
    }
    if (lockButton && !lockButton.dataset.bound) {
      lockButton.dataset.bound = 'true';
      lockButton.addEventListener('click', () => this.lock());
    }
    document.querySelectorAll('[data-admin-toolbar-lock]').forEach(button => {
      if (button.dataset.bound) return;
      button.dataset.bound = 'true';
      button.addEventListener('click', () => this.lock());
    });

    if (typeof USE_MOCK !== 'undefined' && USE_MOCK && !this.getToken()) {
      sessionStorage.setItem(this.storageKey, 'mock-admin-token');
    }
    this.render();
    if (this.isUnlocked() && typeof this.options.onUnlock === 'function') {
      this.options.onUnlock();
    }
  },

  getToken() {
    return String(sessionStorage.getItem(this.storageKey) || '').trim();
  },

  isUnlocked() {
    return Boolean(this.getToken());
  },

  requireToken() {
    const token = this.getToken();
    if (token) return token;
    this.focus('상단에서 관리자 잠금을 먼저 해제해 주세요.');
    throw new Error('관리자 잠금 해제가 필요합니다.');
  },

  async submit(event) {
    event.preventDefault();
    if (!this.root) return;

    const input = this.root.querySelector('[data-admin-auth-password]');
    const submitButton = this.root.querySelector('[data-admin-auth-submit]');
    const token = String(input?.value || '').trim();
    if (!token) {
      this.focus('관리자 키를 입력해 주세요.');
      return;
    }

    this.setError('');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = '확인 중...';
    }

    try {
      const requestAccess = timeoutMs => fetchAPI('verifyAdminAccess', {
        method: 'POST',
        body: { adminToken: token },
        timeoutMs
      });
      let res = await requestAccess(30000);

      // 인증 확인은 데이터를 변경하지 않으므로 일시적인 GAS 연결 실패에 한해 한 번만 재시도합니다.
      if (res?.networkError) {
        if (submitButton) submitButton.textContent = '다시 연결 중...';
        await new Promise(resolve => setTimeout(resolve, 700));
        res = await requestAccess(40000);
      }

      if (!res?.success) {
        sessionStorage.removeItem(this.storageKey);
        if (input) input.value = '';
        this.render();
        this.focus(res?.message || '관리자 키가 일치하지 않습니다.');
        return;
      }

      sessionStorage.setItem(this.storageKey, token);
      if (input) input.value = '';
      this.render();
      AppState.vibrate(40);
      if (typeof this.options.onUnlock === 'function') {
        this.options.onUnlock();
      }
    } catch (error) {
      sessionStorage.removeItem(this.storageKey);
      this.render();
      this.focus(error?.message || '관리자 권한을 확인하지 못했습니다.');
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = '잠금 해제';
      }
    }
  },

  lock(options = {}) {
    sessionStorage.removeItem(this.storageKey);
    if (this.root) {
      const input = this.root.querySelector('[data-admin-auth-password]');
      if (input) input.value = '';
    }
    this.render();
    this.setError(options.message || '');
    if (options.focus) this.focus(options.message || '관리자 키를 다시 입력해 주세요.');
    if (typeof this.options.onLock === 'function') {
      this.options.onLock(options);
    }
  },

  handleDenied(res) {
    const message = String(res?.message || '');
    if (!message.includes('관리자 권한') && !message.includes('권한')) return false;
    this.lock({
      message: '관리자 키가 만료되었거나 일치하지 않습니다.',
      focus: true,
      reload: false
    });
    return true;
  },

  focus(message = '') {
    if (!this.root) return;
    if (message) this.setError(message);
    const input = this.root.querySelector('[data-admin-auth-password]');
    if (input) input.focus();
    this.root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  setError(message) {
    if (!this.root) return;
    const error = this.root.querySelector('[data-admin-auth-error]');
    if (!error) return;
    error.textContent = message;
    error.hidden = !message;
  },

  render() {
    if (!this.root) return;
    const unlocked = this.isUnlocked();
    const form = this.root.querySelector('[data-admin-auth-form]');
    const lockButton = this.root.querySelector('[data-admin-auth-lock]');
    const status = this.root.querySelector('[data-admin-auth-status]');
    const icon = this.root.querySelector('[data-admin-auth-icon]');

    this.root.classList.toggle('is-unlocked', unlocked);
    this.root.classList.toggle('is-gate', !unlocked);
    document.body.classList.toggle('admin-auth-locked', !unlocked);
    document.body.classList.toggle('admin-auth-unlocked', unlocked);
    if (icon) {
      icon.textContent = unlocked ? '🔓' : '🔒';
      icon.setAttribute('aria-label', unlocked ? '관리자 잠금 해제됨' : '관리자 잠금 상태');
    }
    if (form) form.hidden = unlocked;
    if (lockButton) lockButton.hidden = !unlocked;
    document.querySelectorAll('[data-admin-toolbar-lock]').forEach(button => {
      button.hidden = !unlocked;
    });
    if (status) {
      status.textContent = unlocked
        ? '관리자 권한 사용 중'
        : '변경 전 잠금 해제 필요';
    }
    if (unlocked) this.setError('');
  }
};

// 모바일 브라우저의 100vh 스크롤 이슈 방지용 --vh 커스텀 프로퍼티 정의
function updateViewportHeight() {
  let vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}

function initAdminActionMenus() {
  const menus = Array.from(document.querySelectorAll('details.admin-action-menu'));
  if (menus.length === 0) return;

  const closeMenus = (exceptMenu = null) => {
    menus.forEach(menu => {
      if (menu !== exceptMenu) menu.open = false;
    });
  };

  menus.forEach(menu => {
    menu.addEventListener('toggle', () => {
      if (menu.open) closeMenus(menu);
    });
  });

  document.querySelectorAll('.admin-header-actions').forEach(actionGroup => {
    actionGroup.addEventListener('click', event => {
      if (event.target.closest('button, a')) {
        closeMenus();
      }
    });
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('.admin-action-menu')) {
      closeMenus();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenus();
  });
}

window.addEventListener('resize', updateViewportHeight);

window.addEventListener('DOMContentLoaded', () => {
  updateViewportHeight();
  initAdminActionMenus();
  if (typeof AdminAuth !== 'undefined') {
    AdminAuth.init();
  }

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

const SERVICE_WORKER_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
const SERVICE_WORKER_RECHECK_MIN_MS = 5 * 60 * 1000;
let activeServiceWorkerRegistration = null;
let serviceWorkerUpdatePromise = null;
let lastServiceWorkerUpdateCheckAt = 0;

function setAppUpdateUi(message = '', options = {}) {
  const busy = options.busy === true;
  document.querySelectorAll('[data-app-update-button]').forEach(button => {
    button.disabled = busy;
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
    const label = button.querySelector('[data-app-update-label]');
    if (label) label.textContent = busy ? '업데이트 확인 중' : '앱 업데이트 확인';
  });
  document.querySelectorAll('[data-app-update-status]').forEach(status => {
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle('is-error', options.error === true);
  });
}

function watchServiceWorkerUpdate(registration) {
  if (!registration || registration.__kioskUpdateWatcherBound) return;
  registration.__kioskUpdateWatcherBound = true;
  registration.addEventListener('updatefound', () => {
    const installingWorker = registration.installing;
    if (!installingWorker) return;
    setAppUpdateUi('새 버전을 적용하고 있습니다.', { busy: true });
    installingWorker.addEventListener('statechange', () => {
      if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
        setAppUpdateUi('업데이트 완료 후 다시 열립니다.', { busy: true });
      }
    });
  });
}

async function checkForAppUpdate(options = {}) {
  const manual = options.manual === true;
  const force = options.force === true;
  const now = Date.now();
  if (!manual && !force && now - lastServiceWorkerUpdateCheckAt < SERVICE_WORKER_RECHECK_MIN_MS) {
    return activeServiceWorkerRegistration;
  }
  if (serviceWorkerUpdatePromise) {
    if (!manual) return serviceWorkerUpdatePromise;
    setAppUpdateUi('최신 버전을 확인하고 있습니다.', { busy: true });
    const registration = await serviceWorkerUpdatePromise;
    if (!registration) {
      setAppUpdateUi('업데이트를 확인하지 못했습니다.', { error: true });
    } else if (!registration.installing && !registration.waiting) {
      setAppUpdateUi('현재 최신 버전입니다.');
    }
    return registration;
  }
  if (!navigator.onLine) {
    if (manual) setAppUpdateUi('인터넷 연결을 확인해 주세요.', { error: true });
    return null;
  }

  if (manual) setAppUpdateUi('최신 버전을 확인하고 있습니다.', { busy: true });
  lastServiceWorkerUpdateCheckAt = now;
  serviceWorkerUpdatePromise = (async () => {
    const registration = activeServiceWorkerRegistration
      || await navigator.serviceWorker.getRegistration();
    if (!registration) {
      if (manual) setAppUpdateUi('업데이트 기능을 준비하지 못했습니다.', { error: true });
      return null;
    }
    activeServiceWorkerRegistration = registration;
    watchServiceWorkerUpdate(registration);
    await registration.update();
    if (manual && !registration.installing && !registration.waiting) {
      setAppUpdateUi('현재 최신 버전입니다.');
    }
    return registration;
  })().catch(error => {
    console.error('[Service Worker] 업데이트 확인 실패:', error);
    if (manual) setAppUpdateUi('업데이트를 확인하지 못했습니다.', { error: true });
    return null;
  }).finally(() => {
    serviceWorkerUpdatePromise = null;
    document.querySelectorAll('[data-app-update-button]').forEach(button => {
      button.disabled = false;
      button.setAttribute('aria-busy', 'false');
      const label = button.querySelector('[data-app-update-label]');
      if (label) label.textContent = '앱 업데이트 확인';
    });
  });
  return serviceWorkerUpdatePromise;
}

function bindAppUpdateControls() {
  document.querySelectorAll('[data-app-update-button]').forEach(button => {
    if (button.dataset.bound) return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => checkForAppUpdate({ manual: true, force: true }));
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindAppUpdateControls, { once: true });
} else {
  bindAppUpdateControls();
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
      navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' })
        .then((registration) => {
          activeServiceWorkerRegistration = registration;
          watchServiceWorkerUpdate(registration);
          console.log('서비스 워커 등록 성공! 범위:', registration.scope);
          if (document.body.classList.contains('admin-shell-page')) {
            checkForAppUpdate({ force: true });
            window.setInterval(() => checkForAppUpdate(), SERVICE_WORKER_UPDATE_INTERVAL_MS);
          }
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
        setAppUpdateUi('업데이트가 완료되어 다시 여는 중입니다.', { busy: true });
        console.log('[Service Worker] 최신 캐시 적용을 위해 페이지를 자동으로 새로고침합니다.');
        window.location.reload();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (
        document.visibilityState === 'visible'
        && document.body.classList.contains('admin-shell-page')
      ) {
        checkForAppUpdate();
      }
    });
  }
} else {
  setAppUpdateUi('이 브라우저에서는 업데이트 확인을 지원하지 않습니다.', { error: true });
}


