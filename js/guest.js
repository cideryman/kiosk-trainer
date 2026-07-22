window.addEventListener('DOMContentLoaded', () => {
      const replyStampMapping = {
        '응원 고마워요': { img: 'assets/dalgomi_reply_heart.png', text: '감동이야!' },
        '맛있게 먹어줘서 기뻐요': { img: 'assets/dalgomi_reply_thumb.png', text: '최고예요!' },
        '안전하게 배달을 완료했어요': { img: 'assets/dalgomi_reply_delivery.png', text: '슝슝배달!' },
        '다음에 또 매점 이용해 주세요': { img: 'assets/dalgomi_reply_cheer.png', text: '힘내세요!' }
      };

      function getReplyStampInfo(replyText) {
        if (!replyText) return null;
        for (const key in replyStampMapping) {
          if (replyText.includes(key)) {
            return replyStampMapping[key];
          }
        }
        return null;
      }

      // 혹시 있을 상태 초기화
      AppState.resetAll();
      const isGuestPreviewMode = new URLSearchParams(window.location.search).get('preview') === '1';
      if (isGuestPreviewMode) {
        sessionStorage.setItem('guestPreviewMode', 'Y');
        sessionStorage.removeItem('guestRemainingCredit');
        sessionStorage.removeItem('guestCreditLimit');
        sessionStorage.removeItem('guestOrderStartedAt');
      } else {
        sessionStorage.removeItem('guestPreviewMode');
        sessionStorage.removeItem('guestOrderStartedAt');
      }

      const viewSelect = document.getElementById('view-select');
      const viewInput = document.getElementById('view-input');
      const input = document.getElementById('guest-name-input');

      const btnNewOrder = document.getElementById('btn-new-order');
      const btnCheckOrders = document.getElementById('btn-check-orders');
      const btnStart = document.getElementById('btn-start');
      const btnBack = document.getElementById('btn-back');
      const btnKakaoLogin = document.getElementById('btn-kakao-login');
      const btnKakaoLogout = document.getElementById('btn-kakao-logout');
      const btnGuestProfileDelete = document.getElementById('btn-guest-profile-delete');
      const btnGuestProfileEdit = document.getElementById('btn-guest-profile-edit');
      const guestProfileEditModal = document.getElementById('guest-profile-edit-modal');
      const btnGpeClose = document.getElementById('btn-gpe-close');
      const btnGpeCancel = document.getElementById('btn-gpe-cancel');
      const btnGpeSave = document.getElementById('btn-gpe-save');
      const gpeNameInput = document.getElementById('gpe-name-input');
      const gpeDeliveryInput = document.getElementById('gpe-delivery-input');
      const kakaoAuthStatus = document.getElementById('kakao-auth-status');
      const kakaoInputHint = document.getElementById('kakao-input-hint');
      const btnRandomName = document.getElementById('btn-random-name');
      const localGuestNamePolicy = document.getElementById('local-guest-name-policy');
      const localGuestNameValue = document.getElementById('local-guest-name-value');

      // 신규 상단 프로필 바 및 새로고침 변수
      const kakaoLoggedInHeader = document.getElementById('kakao-logged-in-header');
      const klhNickname = document.getElementById('klh-nickname');
      const klhCredit = document.getElementById('klh-credit');
      const gpeCreditInfo = document.getElementById('gpe-credit-info');
      const btnRefreshClosedStatus = document.getElementById('btn-refresh-closed-status');
      const btnClosedMenuPreview = document.getElementById('btn-closed-menu-preview');
      const closedNoticeHelp = document.getElementById('closed-notice-help');
      const refreshIcon = document.getElementById('refresh-icon');

      const closedNotice = document.getElementById('guest-closed-notice');
      const previewNotice = document.getElementById('guest-preview-notice');
      const closedNoticeText = document.getElementById('closed-notice-text');
      const remainingTimeBox = document.getElementById('guest-remaining-time');
      const remainingTimerSpan = document.getElementById('remaining-timer');
      const guideText = document.getElementById('guide-text-main');
      const guestCreditBadge = document.getElementById('guest-credit-badge');

      let currentStep = 'select'; // 'select' or 'input'
      let guestBaseCredit = GUEST_DEFAULT_CREDIT;
      let kakaoGuestBonusCredit = 2;
      let guestDeliveryFee = GUEST_DELIVERY_FEE;
      let remainingCountdown = null;
      let isGuestOpen = false;
      let welcomeTitle = '배달왔삼에 오신 것을 환영합니다 😊';
      let welcomeSubtitle = '오늘의 간식을 주문해보세요!';
      let rememberedGuestProfile = null;
      let guestProfilePromise = Promise.resolve(null);
      let guestCreditStatus = null;
      let guestCreditPromise = Promise.resolve(null);

      function getKakaoRedirectUri() {
        return window.location.origin + window.location.pathname;
      }

      function makeOAuthState() {
        if (window.crypto && window.crypto.getRandomValues) {
          const bytes = new Uint8Array(16);
          window.crypto.getRandomValues(bytes);
          return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        return String(Date.now()) + Math.random().toString(36).slice(2);
      }

      function cleanupKakaoCallbackUrl() {
        if (!window.history || !window.history.replaceState) return;
        const cleanUrl = window.location.origin + window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, cleanUrl);
      }

      function renderKakaoLoginButtonLabel() {
        if (!btnKakaoLogin) return;
        btnKakaoLogin.innerHTML = `
          <span>카카오톡 로그인</span>
          <span style="display: inline-flex; align-items: center; justify-content: center; min-height: 28px; padding: 3px 10px; border-radius: 999px; background-color: #2EC4B6; color: white; font-size: 13px; font-weight: 900; line-height: 1; white-space: nowrap;">로그인 시 온기❤️ +2</span>
        `;
      }

      function applyGuestPreviewModeUi() {
        if (!isGuestPreviewMode) return;

        if (remainingCountdown) {
          clearInterval(remainingCountdown);
          remainingCountdown = null;
        }
        if (previewNotice) previewNotice.style.display = 'block';
        if (closedNotice) closedNotice.style.display = 'none';
        if (remainingTimeBox) remainingTimeBox.style.display = 'none';
        if (guideText) {
          guideText.innerHTML = `배달왔삼 메뉴를 확인합니다 🛵<br><span>간식을 담아 확인 화면까지 볼 수 있어요.</span>`;
          guideText.style.display = 'block';
        }
        const teamSec = document.getElementById('today-delivery-team-section');
        if (teamSec) teamSec.style.display = 'none';
        const praiseSec = document.getElementById('praise-board-section');
        if (praiseSec) praiseSec.style.display = 'none';

        if (btnNewOrder) {
          btnNewOrder.disabled = false;
          btnNewOrder.style.opacity = '1';
          btnNewOrder.style.cursor = 'pointer';
          btnNewOrder.textContent = '🛵 메뉴 미리보기';
        }
        if (btnCheckOrders) btnCheckOrders.style.display = 'none';
        const btnWriteReview = document.getElementById('btn-write-review');
        if (btnWriteReview) btnWriteReview.style.display = 'none';

        const kakaoAuthPanel = document.getElementById('kakao-auth-panel');
        if (kakaoAuthPanel) kakaoAuthPanel.style.display = 'none';
        if (kakaoLoggedInHeader) kakaoLoggedInHeader.style.display = 'none';
        if (btnKakaoLogin) btnKakaoLogin.style.display = 'none';
        if (btnKakaoLogout) btnKakaoLogout.style.display = 'none';
        if (kakaoInputHint) kakaoInputHint.style.display = 'none';
      }

      function renderGuestAuth() {
        if (isGuestPreviewMode) {
          applyGuestPreviewModeUi();
          return;
        }

        const auth = AppState.getGuestAuth();
        const kakaoAuthPanel = document.getElementById('kakao-auth-panel');

        if (auth) {
          if (kakaoAuthPanel) {
            kakaoAuthPanel.style.display = 'none';
          }
          if (kakaoLoggedInHeader) {
            kakaoLoggedInHeader.style.display = 'flex';
          }
          if (btnKakaoLogin) {
            btnKakaoLogin.style.display = 'none';
          }
          if (btnKakaoLogout) {
            btnKakaoLogout.style.display = 'flex';
          }
          if (btnGuestProfileDelete) {
            btnGuestProfileDelete.style.display = 'inline-block';
          }

          if (rememberedGuestProfile) {
            if (klhNickname) {
              klhNickname.textContent = `👤 ${rememberedGuestProfile.displayName} 님`;
            }
          } else {
            if (klhNickname) {
              klhNickname.textContent = `👤 카카오 연결됨`;
            }
          }

          // 크레딧 표시 갱신
          let currentCredit = guestBaseCredit + kakaoGuestBonusCredit;
          if (guestCreditStatus && typeof guestCreditStatus.remainingCredit === 'number') {
            currentCredit = guestCreditStatus.remainingCredit;
          }
          if (klhCredit) {
            klhCredit.textContent = `❤️ 오늘 남은 온기: ${currentCredit}개`;
          }
          if (gpeCreditInfo) {
            gpeCreditInfo.textContent = `❤️ 보유 온기: ${currentCredit}개`;
          }

          if (kakaoInputHint) {
            kakaoInputHint.textContent = rememberedGuestProfile
              ? '카카오 연결됨: 저장된 주문표시명과 배송지를 불러왔어요.'
              : '카카오 연결됨: 주문표시명과 배송지를 다음 주문에도 기억할 수 있어요.';
            kakaoInputHint.style.display = 'block';
          }
        } else {
          if (kakaoAuthPanel) {
            kakaoAuthPanel.style.display = 'flex';
          }
          if (kakaoLoggedInHeader) {
            kakaoLoggedInHeader.style.display = 'none';
          }
          if (kakaoAuthStatus) {
            kakaoAuthStatus.style.display = 'block';
            kakaoAuthStatus.textContent = '카카오톡 로그인으로 다른 기기에서도 오늘 주문을 찾을 수 있어요.';
          }
          if (btnKakaoLogin) {
            renderKakaoLoginButtonLabel();
            btnKakaoLogin.style.display = 'flex';
          }
          if (btnKakaoLogout) {
            btnKakaoLogout.style.display = 'none';
          }
          if (btnGuestProfileDelete) {
            btnGuestProfileDelete.style.display = 'none';
          }
          if (kakaoInputHint) {
            kakaoInputHint.style.display = 'none';
          }
        }
        applyLocalGuestDisplayNamePolicy();
      }

      function applyLocalGuestDisplayNamePolicy() {
        if (!input) return;
        const isLocalGuest = !isGuestPreviewMode && !AppState.getGuestAuth();
        const savedName = isLocalGuest ? AppState.getLocalGuestDisplayName() : '';
        const isLocked = Boolean(savedName);

        if (isLocked) {
          input.value = savedName;
        }
        input.readOnly = isLocked;
        input.setAttribute('aria-readonly', String(isLocked));
        if (btnRandomName) btnRandomName.hidden = isLocked;
        if (localGuestNamePolicy) localGuestNamePolicy.hidden = !isLocked;
        if (localGuestNameValue) localGuestNameValue.textContent = savedName;
      }

      function applyRememberedGuestProfile(profile) {
        rememberedGuestProfile = profile || null;
        if (!rememberedGuestProfile) {
          renderGuestAuth();
          return;
        }

        if (rememberedGuestProfile.displayName && input && !input.value.trim()) {
          input.value = rememberedGuestProfile.displayName;
        }
        renderGuestAuth();
      }

      async function loadRememberedGuestProfile() {
        if (isGuestPreviewMode) {
          rememberedGuestProfile = null;
          return null;
        }

        const auth = AppState.getGuestAuth();
        if (!auth) {
          rememberedGuestProfile = null;
          return null;
        }

        try {
          const res = await fetchAPI('getGuestProfileByGuestKey', {
            method: 'POST',
            body: {
              authProvider: auth.provider,
              guestKey: auth.guestKey
            }
          });

          if (res && res.success) {
            applyRememberedGuestProfile(res.profile || null);
            return res.profile || null;
          }
        } catch (error) {
          console.warn('카카오 게스트 프로필 로드 실패:', error);
        }

        return null;
      }

      function renderGuestCreditBadge() {
        if (!guestCreditBadge) return;
        const auth = AppState.getGuestAuth();
        if (guestCreditStatus && typeof guestCreditStatus.remainingCredit === 'number') {
          const bonusText = auth && guestCreditStatus.bonusCredit
            ? ` (카카오톡 +${guestCreditStatus.bonusCredit})`
            : '';
          guestCreditBadge.textContent = `❤️ 오늘 남은 온기 ${guestCreditStatus.remainingCredit}개${bonusText}`;
          return;
        }

        if (auth) {
          guestCreditBadge.textContent = `❤️ 카카오톡 로그인 시 오늘 온기 ${guestBaseCredit + kakaoGuestBonusCredit}개`;
        } else {
          guestCreditBadge.textContent = `❤️ 신규 방문 온기 ${guestBaseCredit}개 선물`;
        }
      }

      async function loadGuestCreditStatus() {
        if (isGuestPreviewMode) {
          guestCreditStatus = null;
          renderGuestCreditBadge();
          return null;
        }

        try {
          const auth = AppState.getGuestAuth();
          const body = {
            guestDeviceId: AppState.getGuestDeviceId()
          };
          if (auth) {
            body.authProvider = auth.provider;
            body.guestKey = auth.guestKey;
          }

          const res = await fetchAPI('getGuestCreditStatus', {
            method: 'POST',
            body
          });
          if (res && res.success) {
            guestCreditStatus = res;
            sessionStorage.setItem('guestRemainingCredit', String(res.remainingCredit));
            sessionStorage.setItem('guestCreditLimit', String(res.creditLimit));
            sessionStorage.setItem('kakaoGuestBonusCredit', String(res.bonusCredit ?? kakaoGuestBonusCredit));
            renderGuestCreditBadge();
            renderGuestAuth(); // 상단 프로필 바의 크레딧 정보도 실시간 동기화
            return res;
          }
        } catch (error) {
          console.warn('게스트 크레딧 상태 로드 실패:', error);
        }
        renderGuestCreditBadge();
        return null;
      }

      async function startKakaoLogin() {
        if (window.location.protocol === 'file:') {
          alert('카카오 연결은 배포된 웹 주소에서 사용할 수 있습니다.');
          return;
        }

        if (btnKakaoLogin) {
          btnKakaoLogin.disabled = true;
          btnKakaoLogin.textContent = '카카오톡 로그인 준비 중...';
        }

        try {
          const redirectUri = getKakaoRedirectUri();
          const config = await fetchAPI('getKakaoLoginConfig', {
            params: { redirectUri }
          });

          if (!config || !config.success || !config.clientId) {
            throw new Error((config && config.message) || '카카오 설정이 아직 완료되지 않았습니다.');
          }

          const state = makeOAuthState();
          sessionStorage.setItem('kakaoOAuthState', state);
          sessionStorage.setItem('kakaoOAuthRedirectUri', redirectUri);

          const params = new URLSearchParams({
            response_type: 'code',
            client_id: config.clientId,
            redirect_uri: redirectUri,
            state
          });
          window.location.href = 'https://kauth.kakao.com/oauth/authorize?' + params.toString();
        } catch (error) {
          alert('카카오 연결을 시작할 수 없습니다.\n' + (error.message || '설정을 확인해 주세요.'));
          renderGuestAuth();
        } finally {
          if (btnKakaoLogin) {
            btnKakaoLogin.disabled = false;
          }
        }
      }

      async function handleKakaoCallback() {
        if (isGuestPreviewMode) return false;

        const params = new URLSearchParams(window.location.search);
        const error = params.get('error');
        const code = params.get('code');
        const returnedState = params.get('state');
        if (!error && !code) return false;

        if (error) {
          cleanupKakaoCallbackUrl();
          sessionStorage.removeItem('kakaoOAuthState');
          sessionStorage.removeItem('kakaoOAuthRedirectUri');
          if (error !== 'access_denied') {
            alert('카카오 연결이 완료되지 않았습니다.\n' + (params.get('error_description') || error));
          }
          return true;
        }

        const savedState = sessionStorage.getItem('kakaoOAuthState');
        const redirectUri = sessionStorage.getItem('kakaoOAuthRedirectUri') || getKakaoRedirectUri();
        if (!savedState || savedState !== returnedState) {
          cleanupKakaoCallbackUrl();
          sessionStorage.removeItem('kakaoOAuthState');
          sessionStorage.removeItem('kakaoOAuthRedirectUri');
          alert('카카오 연결 확인 정보가 일치하지 않습니다. 다시 시도해 주세요.');
          return true;
        }

        try {
          if (kakaoAuthStatus) {
            kakaoAuthStatus.textContent = '카카오 연결 확인 중입니다...';
          }
          const res = await fetchAPI('exchangeKakaoAuthCode', {
            method: 'POST',
            body: {
              code,
              state: returnedState,
              redirectUri
            }
          });

          if (!res || !res.success || !res.guestKey) {
            throw new Error((res && res.message) || '카카오 연결에 실패했습니다.');
          }

          AppState.setGuestAuth({
            provider: 'kakao',
            guestKey: res.guestKey,
            authenticatedAt: new Date().toISOString()
          });
          sessionStorage.removeItem('kakaoOAuthState');
          sessionStorage.removeItem('kakaoOAuthRedirectUri');
          cleanupKakaoCallbackUrl();
          renderGuestAuth();
          guestCreditStatus = null;
          guestCreditPromise = loadGuestCreditStatus();
          await guestCreditPromise;
          guestProfilePromise = loadRememberedGuestProfile();
          await guestProfilePromise;
          alert('카카오 연결이 완료되었습니다. 이제 오늘 주문을 더 쉽게 찾을 수 있어요.');
          return true;
        } catch (error) {
          sessionStorage.removeItem('kakaoOAuthState');
          sessionStorage.removeItem('kakaoOAuthRedirectUri');
          cleanupKakaoCallbackUrl();
          renderGuestAuth();
          alert('카카오 연결에 실패했습니다.\n' + (error.message || '다시 시도해 주세요.'));
          return true;
        }
      }

      function sanitizeEventTitleHtml(htmlStr) {
        if (!htmlStr) return '';
        
        let decoded = String(htmlStr);
        if (decoded.includes('&lt;') || decoded.includes('&gt;')) {
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(decoded, 'text/html');
            decoded = doc.body.textContent || decoded;
          } catch (e) {
            console.warn('DOMParser unescape failed:', e);
          }
        }

        const temp = document.createElement('div');
        temp.innerHTML = decoded;
        
        temp.querySelectorAll('script, style, iframe, object, embed, form').forEach(el => el.remove());
        
        const allNodes = temp.querySelectorAll('*');
        allNodes.forEach(node => {
          const tagName = node.tagName.toLowerCase();
          if (!['span', 'font', 'b', 'strong', 'i', 'em', 'div'].includes(tagName)) {
            const text = document.createTextNode(node.textContent);
            node.parentNode?.replaceChild(text, node);
            return;
          }
          const colorAttr = node.getAttribute('color');
          const styleColor = node.style.color;
          const color = styleColor || colorAttr;
          const fontWeight = node.style.fontWeight;
          node.removeAttribute('style');
          node.removeAttribute('class');
          node.removeAttribute('id');
          
          if (color) node.style.color = color;
          if (fontWeight) node.style.fontWeight = fontWeight;
        });
        
        return temp.innerHTML;
      }

      function updateGuestAppTitle(settingsRes) {
        const brandTitleEl = document.getElementById('guest-app-brand-title');
        const brandSubEl = document.getElementById('guest-app-brand-subtitle');
        const brandImgEl = document.getElementById('guest-app-brand-img');
        if (!brandTitleEl || !settingsRes) return;

        if (settingsRes.guestMenuMode === 'event') {
          const eventName = settingsRes.guestEventName || '장애인식 개선 캠페인';
          brandTitleEl.innerHTML = sanitizeEventTitleHtml(eventName);
          brandTitleEl.style.fontSize = '24px';
          brandTitleEl.style.fontWeight = '850';
          brandTitleEl.style.whiteSpace = 'nowrap';
          brandTitleEl.style.overflow = 'hidden';
          brandTitleEl.style.textOverflow = 'ellipsis';
          brandTitleEl.style.maxWidth = '100%';
          if (brandSubEl) brandSubEl.textContent = '특별 이벤트 & 캠페인 간식';
          if (brandImgEl && settingsRes.guestEventEmblemBase64) {
            brandImgEl.src = settingsRes.guestEventEmblemBase64;
          } else if (brandImgEl) {
            brandImgEl.src = 'icons/guest-192.png';
          }
        } else {
          brandTitleEl.innerHTML = `배달왔<span style="color: var(--primary-color);">삼</span>`;
          if (brandSubEl) brandSubEl.textContent = '삼각지 카페 배달 서비스';
          if (brandImgEl) brandImgEl.src = 'icons/guest-192.png';
        }
      }

      function applyGuestClosedUi(message, allowMenuPreview) {
        closedNotice.style.display = 'block';
        closedNoticeText.textContent = message || '게스트 주문이 마감되었습니다.';
        if (closedNoticeHelp) {
          closedNoticeHelp.textContent = allowMenuPreview
            ? '메뉴를 미리 보거나 기존 주문을 확인할 수 있습니다.'
            : '기존 주문만 확인할 수 있습니다.';
        }
        if (btnClosedMenuPreview) {
          btnClosedMenuPreview.style.display = allowMenuPreview ? 'block' : 'none';
        }
        btnNewOrder.style.display = 'none';
        guideText.style.display = 'none';
        const teamSec = document.getElementById('today-delivery-team-section');
        if (teamSec) teamSec.style.display = 'none';
      }


      // 운영 상태 확인
      async function loadSettings() {
        try {
          const settingsRes = await fetchAPI('getGuestSettings');
          if (settingsRes && settingsRes.success) {
            isGuestOpen = settingsRes.isGuestOpenNow;
            guestBaseCredit = settingsRes.guestBaseCredit ?? GUEST_DEFAULT_CREDIT;
            kakaoGuestBonusCredit = settingsRes.kakaoGuestBonusCredit ?? 2;
            guestDeliveryFee = settingsRes.guestDeliveryFee ?? GUEST_DELIVERY_FEE;
            welcomeTitle = settingsRes.welcomeTitle || welcomeTitle;
            welcomeSubtitle = settingsRes.welcomeSubtitle || welcomeSubtitle;

            if (typeof updateGuestAppTitle === 'function') updateGuestAppTitle(settingsRes);

            // 초기 문구 렌더링
            guideText.innerHTML = `${welcomeTitle}<br><span>${welcomeSubtitle}</span>`;

            renderTodayDeliveryTeam(settingsRes);

            // sessionStorage에 설정값 캐시 (다음 화면에서 사용)
            sessionStorage.setItem('guestBaseCredit', String(guestBaseCredit));
            sessionStorage.setItem('kakaoGuestBonusCredit', String(kakaoGuestBonusCredit));
            sessionStorage.setItem('guestDeliveryFee', String(guestDeliveryFee));
            sessionStorage.setItem('guestDefaultDeliveryPlace', settingsRes.guestDefaultDeliveryPlace ?? '사무실 원탁');

            // 크레딧 배지 적용
            renderGuestCreditBadge();

            if (isGuestPreviewMode) {
              isGuestOpen = true;
              applyGuestPreviewModeUi();
              return;
            }

            if (!isGuestOpen) {
              // 마감 상태
              applyGuestClosedUi(settingsRes.message, true);
            } else {
              // 운영 중 - 남은 시간 표시
              closedNotice.style.display = 'none';
              guideText.style.display = 'block';
              if (btnClosedMenuPreview) btnClosedMenuPreview.style.display = 'none';
              btnNewOrder.style.display = '';
              btnNewOrder.disabled = false;
              btnNewOrder.style.opacity = '1';
              btnNewOrder.style.cursor = 'pointer';
              if (settingsRes.remainingSeconds > 0) {
                remainingTimeBox.style.display = 'block';
                let remaining = settingsRes.remainingSeconds;
                updateTimerDisplay(remaining);
                if (remainingCountdown) clearInterval(remainingCountdown);
                remainingCountdown = setInterval(() => {
                  remaining--;
                  if (remaining <= 0) {
                    clearInterval(remainingCountdown);
                    // 시간 만료 - 마감 상태로 전환
                    isGuestOpen = false;
                    remainingTimeBox.style.display = 'none';
                    applyGuestClosedUi('게스트 주문 운영 시간이 종료되었습니다.', true);
                    return;
                  }
                  updateTimerDisplay(remaining);
                }, 1000);
              }
            }
          } else {
            console.warn('게스트 운영 설정 API 응답 실패:', settingsRes);
            if (isGuestPreviewMode) {
              isGuestOpen = true;
              applyGuestPreviewModeUi();
              return;
            }
            isGuestOpen = false;
            applyGuestClosedUi(
              (settingsRes && settingsRes.message) || '운영 상태를 확인할 수 없어 잠시 주문을 받을 수 없습니다.',
              false
            );
          }
        } catch (e) {
          console.warn('게스트 운영 설정 조회 실패:', e);
          if (isGuestPreviewMode) {
            isGuestOpen = true;
            applyGuestPreviewModeUi();
            return;
          }
          // API 실패 시 운영 보호를 위해 새 주문 차단 (내 주문 확인하기는 가능)
          isGuestOpen = false;
          applyGuestClosedUi('운영 상태를 확인할 수 없어 잠시 주문을 받을 수 없습니다.', false);
        }
      }

      function renderTodayDeliveryTeam(settingsRes) {
        const teamSection = document.getElementById('today-delivery-team-section');
        if (!teamSection) return;

        const isEnabled = settingsRes.todayDeliveryTeamEnabled;
        const membersStr = String(settingsRes.todayDeliveryTeamMembers || '').trim();

        if (!isEnabled || !membersStr) {
          teamSection.style.display = 'none';
          return;
        }

        const titleEl = document.getElementById('delivery-team-title');
        const membersContainer = document.getElementById('delivery-team-members');
        const messageEl = document.getElementById('delivery-team-message');

        if (titleEl) {
          titleEl.textContent = settingsRes.todayDeliveryTeamTitle || '📦 오늘의 배달팀';
        }

        if (membersContainer) {
          if (!renderDeliveryTeamMemberGrid(membersContainer, membersStr)) {
            teamSection.style.display = 'none';
            return;
          }
        }

        if (messageEl) {
          const msg = String(settingsRes.todayDeliveryTeamMessage || '').trim();
          if (msg) {
            messageEl.textContent = `"${msg}"`;
            messageEl.style.display = 'block';
          } else {
            messageEl.style.display = 'none';
          }
        }

        teamSection.style.display = 'flex';
      }

      function parseDeliveryTeamMemberGroups(membersStr) {
        const membersList = String(membersStr || '').split(',').map(m => m.trim()).filter(Boolean);
        let currentRole = '';
        const parsedMembers = [];

        for (let i = membersList.length - 1; i >= 0; i--) {
          const parts = membersList[i].split('|').map(p => p.trim());
          if (parts.length > 1 && parts[1]) {
            currentRole = parts.slice(1).join('|').trim();
          }
          if (parts[0]) {
            parsedMembers.unshift({
              name: parts[0],
              role: currentRole || '멤버'
            });
          }
        }

        const grouped = new Map();
        parsedMembers.forEach(member => {
          const role = member.role || '멤버';
          if (!grouped.has(role)) grouped.set(role, []);
          grouped.get(role).push(member.name);
        });

        const preferredRoles = ['멤버', '배달 담당', '상품 준비 담당'];
        const groups = [];
        preferredRoles.forEach(role => {
          if (grouped.has(role)) {
            groups.push({ role, names: grouped.get(role) });
            grouped.delete(role);
          }
        });
        grouped.forEach((names, role) => {
          groups.push({ role, names });
        });
        return groups;
      }

      function renderDeliveryTeamMemberGrid(container, membersStr) {
        if (!container) return false;
        container.innerHTML = '';
        const groups = parseDeliveryTeamMemberGroups(membersStr).filter(group => group.names.length > 0);
        if (groups.length === 0) return false;

        groups.forEach(group => {
          const card = document.createElement('div');
          card.className = 'delivery-team-role-card';

          const label = document.createElement('div');
          label.className = 'delivery-team-role-label';
          label.textContent = group.role || '멤버';
          card.appendChild(label);

          const names = document.createElement('div');
          names.className = 'delivery-team-role-names';
          names.textContent = group.names.join(', ');
          card.appendChild(names);

          container.appendChild(card);
        });
        return true;
      }

      function updateTimerDisplay(seconds) {
        const min = Math.floor(seconds / 60);
        const sec = seconds % 60;
        remainingTimerSpan.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
      }

      const NICKNAME_WORDS = {
        adjectives: ["행복한", "씩씩한", "반짝이는", "따뜻한", "용감한", "즐거운", "친절한", "신나는", "멋진", "귀여운", "사랑스러운", "슬기로운"],
        nouns: ["토끼", "해바라기", "연필", "커피잔", "구름", "별", "나무", "고양이", "강아지", "도토리", "바람", "하늘"],
        special: ["해냄이", "쭉쭉이", "여비"]
      };

      function generateRandomNickname() {
        const isSpecial = Math.random() < 0.08; // 약 8% 확률
        const adj = NICKNAME_WORDS.adjectives[Math.floor(Math.random() * NICKNAME_WORDS.adjectives.length)];
        if (isSpecial) {
          const char = NICKNAME_WORDS.special[Math.floor(Math.random() * NICKNAME_WORDS.special.length)];
          return `${adj} ${char}`;
        } else {
          const noun = NICKNAME_WORDS.nouns[Math.floor(Math.random() * NICKNAME_WORDS.nouns.length)];
          return `${adj} 삼각지 ${noun}`;
        }
      }

      function initOrderDisplayName() {
        input.value = rememberedGuestProfile && rememberedGuestProfile.displayName
          ? rememberedGuestProfile.displayName
          : '';
        applyLocalGuestDisplayNamePolicy();
      }

      function showStep(step) {
        currentStep = step;
        if (step === 'select') {
          viewSelect.style.display = 'flex';
          viewInput.style.display = 'none';
          btnStart.style.display = 'none';
          btnBack.style.display = 'none';
        } else {
          viewSelect.style.display = 'none';
          viewInput.style.display = 'flex';
          btnStart.style.display = 'flex';
          btnBack.style.display = 'flex';
          btnBack.style.flex = '1';
          initOrderDisplayName();
          input.focus();
        }
      }

      if (btnRandomName) {
        AppState.bindCardTap(btnRandomName, () => {
          input.value = generateRandomNickname();
          input.focus();
          AppState.vibrate(40);
        });
      }

      if (btnKakaoLogin) {
        AppState.bindCardTap(btnKakaoLogin, () => {
          startKakaoLogin();
        });
      }

      if (btnKakaoLogout) {
        AppState.bindCardTap(btnKakaoLogout, () => {
          AppState.clearGuestAuth();
          rememberedGuestProfile = null;
          guestProfilePromise = Promise.resolve(null);
          guestCreditStatus = null;
          renderGuestAuth();
          guestCreditPromise = loadGuestCreditStatus();
          AppState.vibrate(40);
        });
      }

      if (btnGuestProfileDelete) {
        AppState.bindCardTap(btnGuestProfileDelete, async () => {
          const auth = AppState.getGuestAuth();
          if (!auth || !rememberedGuestProfile) return;
          if (!confirm('저장된 주문표시명과 배송지를 삭제할까요?\n현재 주문은 계속할 수 있습니다.')) return;

          btnGuestProfileDelete.disabled = true;
          try {
            const res = await fetchAPI('deleteGuestProfileByGuestKey', {
              method: 'POST',
              body: {
                authProvider: auth.provider,
                guestKey: auth.guestKey
              }
            });
            if (!res || !res.success) {
              throw new Error((res && res.message) || '저장 정보 삭제에 실패했습니다.');
            }
            rememberedGuestProfile = null;
            guestProfilePromise = Promise.resolve(null);
            if (input) {
              input.value = '';
            }
            renderGuestAuth();
            if (guestProfileEditModal) {
              guestProfileEditModal.style.display = 'none';
            }
            alert('저장된 주문표시명과 배송지를 삭제했습니다.');
          } catch (error) {
            alert(error.message || '저장 정보 삭제에 실패했습니다.');
          } finally {
            btnGuestProfileDelete.disabled = false;
          }
        });
      }

      // 이벤트 바인딩
      AppState.bindCardTap(btnNewOrder, () => {
        if (!isGuestOpen && !isGuestPreviewMode) {
          AppState.vibrate([100, 100]);
          return;
        }

        if (isGuestPreviewMode) {
          input.value = '미리보기';
          startGuestMode();
          return;
        }

        if (rememberedGuestProfile && rememberedGuestProfile.displayName) {
          input.value = rememberedGuestProfile.displayName;
        } else {
          input.value = '';
        }
        startGuestMode();
      });

      // 프로필 수정 모달 관련 바인딩
      if (btnGuestProfileEdit) {
        AppState.bindCardTap(btnGuestProfileEdit, () => {
          const auth = AppState.getGuestAuth();
          if (!auth) return; // 카카오 로그인 상태가 아니면 무시

          if (guestProfileEditModal) {
            guestProfileEditModal.style.display = 'flex';
          }
          if (gpeNameInput) {
            gpeNameInput.value = rememberedGuestProfile ? (rememberedGuestProfile.displayName || '') : '';
          }
          if (gpeDeliveryInput) {
            gpeDeliveryInput.value = rememberedGuestProfile ? (rememberedGuestProfile.deliveryPlace || '') : '';
          }
          if (gpeCreditInfo) {
            let currentCredit = guestBaseCredit + kakaoGuestBonusCredit;
            if (guestCreditStatus && typeof guestCreditStatus.remainingCredit === 'number') {
              currentCredit = guestCreditStatus.remainingCredit;
            }
            gpeCreditInfo.textContent = `❤️ 보유 온기: ${currentCredit}개`;
          }
          // 저장된 프로필이 있는 경우에만 삭제(개인정보 파기) 버튼을 노출합니다.
          if (btnGuestProfileDelete) {
            btnGuestProfileDelete.style.display = rememberedGuestProfile ? 'inline-block' : 'none';
          }
          AppState.vibrate(40);
        });
      }

      if (btnGpeClose) {
        btnGpeClose.addEventListener('click', () => {
          if (guestProfileEditModal) guestProfileEditModal.style.display = 'none';
          AppState.vibrate(30);
        });
      }

      if (btnGpeCancel) {
        AppState.bindCardTap(btnGpeCancel, () => {
          if (guestProfileEditModal) guestProfileEditModal.style.display = 'none';
        });
      }

      if (btnGpeSave) {
        AppState.bindCardTap(btnGpeSave, async () => {
          const auth = AppState.getGuestAuth();
          if (!auth) return;

          const name = gpeNameInput.value.trim();
          const delivery = gpeDeliveryInput.value.trim();

          if (!name) {
            alert('주문 표시명을 입력해 주세요.');
            gpeNameInput.focus();
            AppState.vibrate([100, 100]);
            return;
          }

          btnGpeSave.disabled = true;
          try {
            const res = await fetchAPI('updateGuestProfileByGuestKey', {
              method: 'POST',
              body: {
                authProvider: auth.provider,
                guestKey: auth.guestKey,
                displayName: name,
                deliveryPlace: delivery
              }
            });
            if (!res || !res.success) {
              throw new Error(res.message || '정보 수정에 실패했습니다.');
            }

            rememberedGuestProfile = {
              displayName: name,
              deliveryPlace: delivery
            };
            if (input) {
              input.value = name;
            }
            renderGuestAuth();

            if (guestProfileEditModal) {
              guestProfileEditModal.style.display = 'none';
            }
            alert('저장 정보가 수정되었습니다.');
          } catch (error) {
            alert(error.message || '정보 수정 중 오류가 발생했습니다.');
          } finally {
            btnGpeSave.disabled = false;
          }
        });
      }

      AppState.bindCardTap(btnCheckOrders, () => {
        window.location.href = 'guest-orders.html';
      });

      // 후기 작성 버튼 활성화 로직
      function checkReviewEligibility() {
        try {
          const guestOrders = JSON.parse(localStorage.getItem('guestOrders') || '[]');
          const unreviewedOrders = guestOrders.filter(o =>
            (o.status === 'Y' || o.servedYn === 'Y') &&
            (o.reviewed !== true && o.reviewed !== 'true')
          );

          const btnWriteReview = document.getElementById('btn-write-review');
          if (btnWriteReview) {
            if (unreviewedOrders.length > 0) {
              btnWriteReview.style.display = 'block';
            } else {
              btnWriteReview.style.display = 'none';
            }
          }
        } catch(e) {}
      }
      checkReviewEligibility();

      // 백그라운드 주문 상태 동기화 (후기 버튼 자동 갱신용)
      async function syncGuestOrders() {
        try {
          const guestOrders = JSON.parse(localStorage.getItem('guestOrders') || '[]');
          if (guestOrders.length === 0) return;

          const response = await fetchAPI('getOrdersToday');
          if (response && response.success && Array.isArray(response.orders)) {
            let updated = false;
            guestOrders.forEach(localOrder => {
              const serverOrder = response.orders.find(o => o.orderNo === localOrder.orderNo);
              if (serverOrder) {
                if (localOrder.status !== serverOrder.servedYn || localOrder.reviewed !== serverOrder.reviewed) {
                  localOrder.status = serverOrder.servedYn;
                  localOrder.reviewed = serverOrder.reviewed;
                  updated = true;
                }
              }
            });
            if (updated) {
              localStorage.setItem('guestOrders', JSON.stringify(guestOrders));
              checkReviewEligibility(); // 후기 버튼 갱신
            }
          }
        } catch (e) {
          console.warn('동기화 실패:', e);
        }
      }
      // syncGuestOrders() invocation moved to the end of DOMContentLoaded to run in parallel

      const btnWriteReview = document.getElementById('btn-write-review');
      if (btnWriteReview) {
        AppState.bindCardTap(btnWriteReview, () => {
          AppState.vibrate(50);
          window.location.href = 'guest-orders.html?openReview=true';
        });
      }

      if (btnClosedMenuPreview) {
        AppState.bindCardTap(btnClosedMenuPreview, () => {
          window.location.href = 'menu.html?browse=guest';
        });
      }

      // 마감 카드 수동 새로고침 버튼 바인딩
      if (btnRefreshClosedStatus) {
        AppState.bindCardTap(btnRefreshClosedStatus, async () => {
          AppState.vibrate(40);
          if (refreshIcon) {
            refreshIcon.style.transform = 'rotate(360deg)';
          }
          btnRefreshClosedStatus.disabled = true;
          try {
            await Promise.all([
              loadSettings(),
              loadGuestCreditStatus()
            ]);
          } catch (err) {
            console.warn('수동 새로고침 중 오류:', err);
          } finally {
            btnRefreshClosedStatus.disabled = false;
            setTimeout(() => {
              if (refreshIcon) {
                refreshIcon.style.transform = 'rotate(0deg)';
              }
            }, 500);
          }
        });
      }

      // Page Visibility API 자동 동기화 바인딩 (debounce로 중복 호출 방지)
      let visibilityRefreshTimer = null;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          if (visibilityRefreshTimer) clearTimeout(visibilityRefreshTimer);
          visibilityRefreshTimer = setTimeout(async () => {
            visibilityRefreshTimer = null;
            console.log('앱 활성화 감지: 영업 상태 및 크레딧 갱신 중...');
            await loadSettings();
            loadGuestCreditStatus();
            loadRememberedGuestProfile();
            renderGuestAuth();
          }, 300);
        }
      });

      // 시작하기 함수
      async function startGuestMode() {
        if (!isGuestOpen && !isGuestPreviewMode) {
          alert('게스트 주문이 마감된 상태입니다.');
          return;
        }
        if (!isGuestPreviewMode && !sessionStorage.getItem('guestOrderStartedAt')) {
          sessionStorage.setItem('guestOrderStartedAt', new Date().toISOString());
        }
        const guestAuth = isGuestPreviewMode ? null : AppState.getGuestAuth();
        if (!isGuestPreviewMode) {
          try {
            await guestCreditPromise;
          } catch (error) {
            console.warn('게스트 크레딧 확인 실패:', error);
          }
        }

        const startingCredit = isGuestPreviewMode
          ? guestBaseCredit
          : (guestCreditStatus && typeof guestCreditStatus.remainingCredit === 'number'
            ? guestCreditStatus.remainingCredit
            : guestBaseCredit + (guestAuth ? kakaoGuestBonusCredit : 0));

        if (!isGuestPreviewMode && guestAuth && !rememberedGuestProfile) {
          try {
            await guestProfilePromise;
          } catch (error) {
            console.warn('저장된 게스트 정보 확인 실패:', error);
          }
          if (!input.value.trim() && rememberedGuestProfile && rememberedGuestProfile.displayName) {
            input.value = rememberedGuestProfile.displayName;
          }
        }

        if (!isGuestPreviewMode && !guestAuth && !input.value.trim()) {
          const localGuestDisplayName = AppState.getLocalGuestDisplayName();
          if (localGuestDisplayName) {
            input.value = localGuestDisplayName;
          }
        }

        applyLocalGuestDisplayNamePolicy();

        const guestName = input.value.trim();
        const needsGuestInfo = !guestName;

        const selectedUser = {
          userId: 'guest',
          nickname: guestName,
          needsGuestInfo,
          credit: startingCredit,
          guestCreditLimit: guestCreditStatus && typeof guestCreditStatus.creditLimit === 'number'
            ? guestCreditStatus.creditLimit
            : startingCredit,
          guestBonusCredit: guestCreditStatus && typeof guestCreditStatus.bonusCredit === 'number'
            ? guestCreditStatus.bonusCredit
            : (guestAuth ? kakaoGuestBonusCredit : 0)
        };
        if (isGuestPreviewMode) {
          selectedUser.previewMode = true;
        }
        if (guestAuth) {
          selectedUser.authProvider = guestAuth.provider;
          selectedUser.guestKey = guestAuth.guestKey;
          if (rememberedGuestProfile && rememberedGuestProfile.deliveryPlace) {
            selectedUser.rememberedDeliveryPlace = rememberedGuestProfile.deliveryPlace;
          }
          if (rememberedGuestProfile && rememberedGuestProfile.displayName) {
            selectedUser.guestProfileSaved = true;
          }
        }

        // 게스트 임시 사용자 저장
        AppState.setSelectedUser(selectedUser);

        AppState.vibrate(60);
        AppState.speak('맛있는 간식 주문을 시작합니다.');

        // 이동
        window.location.href = 'menu.html';
      }

      AppState.bindCardTap(btnStart, () => {
        startGuestMode();
      });

      // 엔터키 지원
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          startGuestMode();
        }
      });

      AppState.bindCardTap(btnBack, () => {
        if (currentStep === 'input') {
          showStep('select');
        } else if (isGuestPreviewMode) {
          window.location.href = 'guest.html?preview=1';
        } else {
          window.location.href = 'index.html';
        }
      });

      // 헤더 보드 버튼 이벤트 제거됨

      // 후기 더보기 버튼 관련 상태 및 변수
      let allReviews = [];
      let showingAllReviews = false;
      const INITIAL_REVIEW_COUNT = 3;
      const btnMoreReviews = document.getElementById('btn-more-reviews');

      if (btnMoreReviews) {
        btnMoreReviews.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          // 이벤트 전파가 방지되므로 햅틱 및 효과음을 수동으로 제공합니다.
          AppState.vibrate(40);
          AppState.playClickSound();

          showingAllReviews = !showingAllReviews;
          renderReviews();
        });
      }

      // 칭찬 보드 로드 함수
      let commReplyIndex = 0;
      let commReplyTimer = null;

      function updateMainCommFeed(repliedReviews) {
        const feedSection = document.getElementById('main-communication-feed-section');
        const feedContent = document.getElementById('main-comm-feed-content');
        const feedMeta = document.getElementById('comm-feed-meta');
        const feedText = document.getElementById('comm-feed-text');

        if (!feedSection) return;

        if (!repliedReviews || repliedReviews.length === 0) {
          feedSection.style.display = 'none';
          return;
        }

        feedSection.style.display = 'flex';

        function showNextReply() {
          const item = repliedReviews[commReplyIndex];
          if (!item) return;

          const rawDate = item.createdAt ? new Date(item.createdAt) : null;
          let dateStr = '오늘';
          if (rawDate && !isNaN(rawDate.getTime())) {
            dateStr = `${String(rawDate.getMonth() + 1).padStart(2, '0')}.${String(rawDate.getDate()).padStart(2, '0')}`;
          }

          if (feedContent) feedContent.style.opacity = '0.2';
          setTimeout(() => {
            if (feedMeta) feedMeta.textContent = `📅 ${dateStr} 소통 | 👤 ${maskGuestName(item.guestName || '게스트')} 님의 후기에 보낸 답글`;
            if (feedText) {
              const replyStamp = getReplyStampInfo(item.replyText);
              let replyStampHtml = '';
              if (replyStamp) {
                replyStampHtml = `<img src="${replyStamp.img}" style="width: 38px; height: 38px; object-fit: contain; vertical-align: middle; margin-right: 6px;" alt="${replyStamp.text}">`;
              }
              feedText.innerHTML = `<div style="display: flex; align-items: center; gap: 4px;">🐣 ${replyStampHtml} <span>"${item.replyText}"</span></div>`;
            }
            if (feedContent) feedContent.style.opacity = '1';
          }, 250);

          commReplyIndex = (commReplyIndex + 1) % repliedReviews.length;
        }

        showNextReply();
        if (commReplyTimer) clearInterval(commReplyTimer);
        if (repliedReviews.length > 1) {
          commReplyTimer = setInterval(showNextReply, 4500);
        }
      }

      async function loadRecentReviews() {
        const container = document.getElementById('praise-list-container');
        if (!container) return;

        try {
          const res = await fetchAPI('getRecentReviews');
          if (res && res.success && Array.isArray(res.reviews) && res.reviews.length > 0) {
            allReviews = res.reviews;
            renderReviews();

            const replied = res.reviews.filter(r => r.replyText && String(r.replyText).trim() !== '');
            updateMainCommFeed(replied);
          } else {
            container.innerHTML = `
              <div style="text-align: center; padding: 24px; border: 2px dashed var(--border-color); border-radius: var(--radius-sm); color: var(--text-muted); font-weight: 700; font-size: 15px;">
                첫 번째 따뜻한 응원의 한마디를 남겨보세요! 🥰
              </div>
            `;
            if (btnMoreReviews) btnMoreReviews.style.display = 'none';
          }
        } catch (e) {
          console.warn('칭찬 보드 로드 실패:', e);
          container.innerHTML = `
            <div style="text-align: center; padding: 24px; border: 2px dashed var(--border-color); border-radius: var(--radius-sm); color: var(--text-muted); font-weight: 700; font-size: 15px;">
              칭찬 보드를 불러오지 못했습니다. 😢
            </div>
          `;
          if (btnMoreReviews) btnMoreReviews.style.display = 'none';
        }
      }

      function renderReviews() {
        const container = document.getElementById('praise-list-container');
        if (!container) return;
        container.innerHTML = '';

        const reviewCountBadge = document.getElementById('review-count-badge');
        if (reviewCountBadge) {
          reviewCountBadge.textContent = `(${allReviews.length})`;
        }

        allReviews.forEach((review, idx) => {
          const card = document.createElement('div');
          card.style.backgroundColor = 'white';
          card.style.border = '2px solid var(--border-color)';
          card.style.borderRadius = 'var(--radius-sm)';
          card.style.padding = '12px 16px';
          card.style.display = (!showingAllReviews && idx >= INITIAL_REVIEW_COUNT) ? 'none' : 'flex';
          card.style.flexDirection = 'column';
          card.style.gap = '6px';
          card.style.boxShadow = '0 2px 4px rgba(0,0,0,0.02)';

          // 훈련생 이름은 실명 노출 없이 '오늘의 배달원' 등으로 통일 표시
          const recipientName = "오늘의 배달원";
          const maskedGuest = maskGuestName(review.guestName);

          const stampMapping = {
            'dalgomi_thumb': { img: 'assets/dalgomi_thumb.png', text: '최고예요!' },
            'dalgomi_delivery': { img: 'assets/dalgomi_delivery.png', text: '슝슝배달!' },
            'dalgomi_heart': { img: 'assets/dalgomi_heart.png', text: '감동이야!' },
            'dalgomi_cheer': { img: 'assets/dalgomi_cheer.png', text: '힘내세요!' },
            '👍 친절해요': { img: 'assets/dalgomi_thumb.png', text: '최고예요!' },
            '⚡ 빨라요': { img: 'assets/dalgomi_delivery.png', text: '슝슝배달!' },
            '🎁 감동이에요': { img: 'assets/dalgomi_heart.png', text: '감동이야!' },
            '☕ 응원해요': { img: 'assets/dalgomi_cheer.png', text: '힘내세요!' }
          };

          const stampInfo = review.stamp ? (stampMapping[review.stamp] || { text: review.stamp }) : null;
          let tagsHtml = '';
          if (review.tags) {
            const tagsList = String(review.tags).split(',').map(t => t.trim()).filter(Boolean);
            tagsHtml = tagsList.map(t => `<span style="background-color: #E0F2F1; border: 1.5px solid var(--secondary-color); padding: 2px 8px; border-radius: 999px; font-size: 13px; font-weight: 800; color: #00796B;">#${AppState.escapeHtml(t)}</span>`).join('');
          }

          let dalgomiStickerHtml = '';
          if (stampInfo) {
            if (stampInfo.img) {
              dalgomiStickerHtml = `
                <div style="flex-shrink: 0; display: flex; align-items: center; justify-content: center; margin-left: 8px;">
                  <img src="${stampInfo.img}" style="width: 85px; height: 85px; object-fit: contain;" alt="달곰이 이모티콘">
                </div>
              `;
            } else {
              tagsHtml += `<span style="background-color: #FFF9E6; border: 1.5px solid var(--primary-color); padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 800; color: #E65100; margin-left: 4px;">${AppState.escapeHtml(stampInfo.text)}</span>`;
            }
          }

          const photoHtml = review.imageUrl
            ? `<div style="margin-top: 6px; border-radius: var(--radius-sm); overflow: hidden; border: 1.5px solid var(--border-color); max-height: 200px; display: flex; align-items: center; justify-content: center; background-color: #F8F9FA;">
                 <img src="${AppState.escapeAttr(AppState.convertDriveImageUrl(review.imageUrl))}" style="width: 100%; max-height: 200px; object-fit: cover;" onerror="this.parentElement.style.display='none';" loading="lazy">
               </div>`
            : '';

          let replyHtml = '';
          if (review.replyText) {
            const replyStamp = getReplyStampInfo(review.replyText);
            let replyStampImg = '';
            if (replyStamp) {
              replyStampImg = `<img src="${replyStamp.img}" style="width: 32px; height: 32px; object-fit: contain; vertical-align: middle; margin-right: 6px;" alt="${replyStamp.text}">`;
            }
            replyHtml = `<div style="background-color: #F0FDF4; border: 1.5px solid #BBF7D0; padding: 10px 12px; border-radius: var(--radius-sm); margin-top: 8px; display: flex; flex-direction: column; gap: 3px; text-align: left;">
                 <div style="font-weight: 850; font-size: 13px; color: #16A34A; display: flex; align-items: center; gap: 4px;">
                   <span>💬 매점 담당자 답글</span>
                 </div>
                 <div style="font-size: 14px; font-weight: 700; color: #1B4332; line-height: 1.4; word-break: break-all; display: inline-flex; align-items: center; gap: 4px;">
                   ${replyStampImg}
                   <span>${AppState.escapeHtml(review.replyText)}</span>
                 </div>
               </div>`;
          }

          card.innerHTML = `
            <div style="display: flex; gap: 12px; align-items: center; justify-content: space-between; width: 100%;">
              <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; text-align: left;">
                <div style="font-weight: 850; font-size: 15px; color: var(--secondary-hover);">
                  👤 ${AppState.escapeHtml(recipientName)} 님에게
                </div>
                <div style="font-size: 15px; font-weight: 700; color: var(--text-main); line-height: 1.4; word-break: break-all; margin: 6px 0;">
                  "${AppState.escapeHtml(review.comment || '응원합니다!')}"
                </div>
                <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;">
                  ${tagsHtml}
                </div>
              </div>
              ${dalgomiStickerHtml}
            </div>
            ${photoHtml}
            ${replyHtml}
            <div style="text-align: right; font-size: 13px; font-weight: 700; color: var(--text-muted); margin-top: 8px; border-top: 1px dashed var(--border-color); padding-top: 6px;">
              <span>작성자: ${AppState.escapeHtml(maskedGuest)} 님</span>
            </div>
          `;

          card.classList.add('review-card-item');
          AppState.bindCardTap(card, () => {
            if (typeof openGuestReviewModal === 'function') {
              openGuestReviewModal(idx);
            }
          });

          container.appendChild(card);
        });

        // 후기 개수가 기본 노출 개수 이하이면 더보기 버튼을 숨깁니다.
        if (btnMoreReviews) {
          if (allReviews.length <= INITIAL_REVIEW_COUNT) {
            btnMoreReviews.style.display = 'none';
          } else {
            btnMoreReviews.style.display = 'block';
            btnMoreReviews.textContent = showingAllReviews ? '❤️ 후기 접기' : '❤️ 후기 더보기';
          }
        }
      }

      function maskGuestName(name) {
        if (!name) return '게스트';
        const clean = name.replace(/ \((체험|비회원)\)/g, '').trim();
        if (clean.length <= 1) return clean;
        if (clean.length === 2) return clean[0] + '*';
        return clean[0] + '*'.repeat(clean.length - 2) + clean[clean.length - 1];
      }

      // 후기 접기/펼치기 토글 (최근 후기 제목 클릭 시)
      const reviewToggle = document.getElementById('review-toggle');
      const praiseContent = document.getElementById('praise-content');
      const reviewToggleText = document.getElementById('review-toggle-text');
      if (reviewToggle && praiseContent && reviewToggleText) {
        reviewToggle.addEventListener('click', () => {
          const isCollapsed = praiseContent.style.display === 'none';
          if (isCollapsed) {
            praiseContent.style.display = 'flex';
            reviewToggleText.textContent = '▲ 접기';
          } else {
            praiseContent.style.display = 'none';
            reviewToggleText.textContent = '▼ 펼쳐보기';
          }
          AppState.vibrate(30);
        });
      }

      // --- 게스트 후기 상세 모달 로직 ---
      let currentReviewIndex = -1;

      window.openGuestReviewModal = function(index) {
        if (!allReviews || index < 0 || index >= allReviews.length) return;
        currentReviewIndex = index;
        const review = allReviews[index];

        const rawDate = review.createdAt ? new Date(review.createdAt) : null;
        let formattedDate = review.createdAt || '-';
        if (rawDate && !isNaN(rawDate.getTime())) {
          formattedDate = `${rawDate.toLocaleDateString()} ${String(rawDate.getHours()).padStart(2, '0')}:${String(rawDate.getMinutes()).padStart(2, '0')}`;
        }

        const maskedGuest = maskGuestName(review.guestName);
        document.getElementById('gm-guest-name').textContent = maskedGuest;
        document.getElementById('gm-created-at').textContent = formattedDate;

        const stickerContainer = document.getElementById('gm-stamp-sticker-container');
        if (review.stamp) {
          const stampInfo = stampMapping[review.stamp] || { text: review.stamp };
          if (stampInfo.img) {
            stickerContainer.innerHTML = `
              <img src="${stampInfo.img}" style="width: 140px; height: 140px; object-fit: contain;" alt="달곰이 이모티콘">
            `;
            stickerContainer.style.display = 'flex';
          } else {
            stickerContainer.style.display = 'none';
          }
        } else {
          stickerContainer.style.display = 'none';
        }

        const tagsEl = document.getElementById('gm-tags');
        if (review.tags) {
          const tagsList = String(review.tags).split(',').map(t => t.trim()).filter(Boolean);
          tagsEl.innerHTML = tagsList.map(t => `<span style="background-color: #E0F2F1; border: 1.5px solid var(--secondary-color); padding: 2px 8px; border-radius: 999px; font-size: 14px; font-weight: 800; color: #00796B;">#${AppState.escapeHtml(t)}</span>`).join(' ');
          tagsEl.style.display = 'flex';
        } else {
          tagsEl.style.display = 'none';
        }

        const commentEl = document.getElementById('gm-comment');
        if (review.comment) {
          commentEl.textContent = review.comment;
          commentEl.style.color = 'var(--text-main)';
        } else {
          commentEl.textContent = '등록된 응원 메시지가 없습니다.';
          commentEl.style.color = '#A0AEC0';
        }

        const photoContainer = document.getElementById('gm-photo-container');
        const photoEl = document.getElementById('gm-photo');
        if (review.imageUrl) {
          photoEl.src = AppState.convertDriveImageUrl(review.imageUrl);
          photoContainer.style.display = 'block';
        } else {
          photoContainer.style.display = 'none';
          photoEl.src = '';
        }

        const replyContainer = document.getElementById('gm-reply-container');
        const replyTextEl = document.getElementById('gm-reply-text');
        const replyDateEl = document.getElementById('gm-reply-created-at');

        if (replyContainer && replyTextEl) {
          if (review.replyText) {
            const replyStamp = getReplyStampInfo(review.replyText);
            let replyStampImgHtml = '';
            if (replyStamp) {
              replyStampImgHtml = `<img src="${replyStamp.img}" style="width: 32px; height: 32px; object-fit: contain; vertical-align: middle; margin-right: 6px;" alt="${replyStamp.text}">`;
            }
            replyTextEl.innerHTML = `<div style="display: inline-flex; align-items: center; gap: 4px;">${replyStampImgHtml} <span>"${review.replyText}"</span></div>`;

            const rDate = review.replyCreatedAt ? new Date(review.replyCreatedAt) : null;
            let formattedRDate = review.replyCreatedAt || '';
            if (rDate && !isNaN(rDate.getTime())) {
              formattedRDate = `${rDate.toLocaleDateString()} ${String(rDate.getHours()).padStart(2, '0')}:${String(rDate.getMinutes()).padStart(2, '0')}`;
            }
            if (replyDateEl) {
              replyDateEl.textContent = formattedRDate ? `답글 작성일: ${formattedRDate}` : '';
            }
            replyContainer.style.display = 'block';
          } else {
            replyContainer.style.display = 'none';
          }
        }

        document.getElementById('btn-gm-prev').disabled = (index === 0);
        document.getElementById('btn-gm-next').disabled = (index === allReviews.length - 1);

        document.getElementById('guest-review-modal').style.display = 'flex';
        AppState.vibrate(40);
      };

      window.closeGuestReviewModal = function() {
        document.getElementById('guest-review-modal').style.display = 'none';
        AppState.vibrate(30);
      };

      window.navigateGuestReview = function(offset) {
        openGuestReviewModal(currentReviewIndex + offset);
      };

      // 모달 이벤트 리스너
      const modalOverlay = document.getElementById('guest-review-modal');
      if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
          if (e.target.id === 'guest-review-modal') closeGuestReviewModal();
        });
      }

      const btnGmClose = document.getElementById('btn-gm-close');
      if (btnGmClose) btnGmClose.addEventListener('click', closeGuestReviewModal);

      const btnGmPrev = document.getElementById('btn-gm-prev');
      if (btnGmPrev) AppState.bindCardTap(btnGmPrev, () => navigateGuestReview(-1));

      const btnGmNext = document.getElementById('btn-gm-next');
      if (btnGmNext) AppState.bindCardTap(btnGmNext, () => navigateGuestReview(1));

      // 키보드 지원
      window.addEventListener('keydown', (e) => {
        const modal = document.getElementById('guest-review-modal');
        if (modal && modal.style.display === 'flex') {
          if (e.key === 'Escape') closeGuestReviewModal();
          if (e.key === 'ArrowLeft') navigateGuestReview(-1);
          if (e.key === 'ArrowRight') navigateGuestReview(1);
        }
      });

      showStep('select');
      renderGuestAuth();
      const kakaoCallbackPromise = handleKakaoCallback();
      guestProfilePromise = kakaoCallbackPromise.then((processedCallback) => {
        if (processedCallback) return rememberedGuestProfile;
        return loadRememberedGuestProfile();
      });
      // 비동기 작업들을 병렬 실행하여 로딩 속도 극대화 (Non-blocking / Parallel Loading)
      const settingsPromise = loadSettings();
      Promise.allSettled([settingsPromise, kakaoCallbackPromise]).then(() => {
        guestCreditPromise = loadGuestCreditStatus();
      });
      if (isGuestPreviewMode) {
        applyGuestPreviewModeUi();
      } else {
        loadRecentReviews();
        syncGuestOrders();
      }
    });
