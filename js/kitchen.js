let refreshTimer = null;
    let refreshSeconds = 30;
    const MAX_REFRESH_TIME = 30;
    let currentOrders = [];

    // --- 시스템 운영 점검 (진단) 모달 제어 함수 ---
    function openDiagnoseModal() {
      if (!AdminAuth.isUnlocked()) {
        AdminAuth.focus('운영 점검 전에 관리자 잠금을 해제해 주세요.');
        return;
      }
      const modal = document.getElementById('modal-system-diagnose');
      if (modal) {
        modal.style.display = 'flex';
        diagnoseRefreshPausedBeforeOpen = refreshPaused;
        refreshPaused = true;
        const btn = document.getElementById('btn-toggle-refresh');
        if (btn) btn.textContent = '▶ 자동 재개';
        resetRefreshTimer();
        runSystemDiagnosis();
      }
    }

    function closeDiagnoseModal() {
      const modal = document.getElementById('modal-system-diagnose');
      if (modal) {
        modal.style.display = 'none';
        refreshPaused = diagnoseRefreshPausedBeforeOpen;
        const btn = document.getElementById('btn-toggle-refresh');
        if (btn) btn.textContent = refreshPaused ? '▶ 자동 재개' : '⏸ 일시정지';
        resetRefreshTimer();
      }
    }

    async function runSystemDiagnosis() {
      const summaryCard = document.getElementById('diagnose-summary-card');
      const resultsList = document.getElementById('diagnose-results-list');
      if (!summaryCard || !resultsList) return;

      summaryCard.style.backgroundColor = '#F8FAFC';
      summaryCard.style.borderColor = 'var(--border-color)';
      summaryCard.style.color = 'var(--text-main)';
      summaryCard.innerHTML = '⚙️ 진단을 진행하고 있습니다...';
      resultsList.innerHTML = '';

      try {
        const adminToken = AdminAuth.requireToken();

        // 1. GAS 기본 통신 및 상세 진단 요청
        const res = await fetchAPI('diagnoseSystem', {
          method: 'POST',
          body: {
            adminToken: adminToken
          }
        });

        if (!res || !res.success) {
          summaryCard.style.backgroundColor = '#FFF5F5';
          summaryCard.style.borderColor = '#FEB2B2';
          summaryCard.style.color = '#C53030';
          summaryCard.innerHTML = '🔴 GAS 연결 실패';

          resultsList.innerHTML = `
            <div style="padding: 12px; border: 2px solid #FEB2B2; background-color: #FFF5F5; border-radius: var(--radius-sm); font-size: 15px; font-weight: 700; color: #9B2C2C;">
              <span style="font-size: 18px;">❌</span> <strong>GAS API 응답 실패</strong><br>
              <span style="font-size: 14px; font-weight: 600; color: #742A2A; display: block; margin-top: 4px;">
                원인: API 주소가 올바르지 않거나 구글 서버 상태가 원활하지 않습니다. <br>
                해결책: js/config.js 의 API_URL을 재확인하고, GAS 웹앱 배포 상태를 검사하세요.
              </span>
            </div>
          `;
          return;
        }

        // 2. 기본 진단 성공 (비밀번호 미입력 상태)
        if (res.mode === 'basic') {
          if (adminToken) {
            sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
            if (typeof updateAdminTokenStatus === 'function') {
              updateAdminTokenStatus();
            }
          }

          summaryCard.style.backgroundColor = '#FFFDF5';
          summaryCard.style.borderColor = '#FEEBC8';
          summaryCard.style.color = '#DD6B20';
          summaryCard.innerHTML = '🟡 기본 연결 성공 (상세 진단 필요)';
          const passwordGuide = adminToken
            ? '입력한 관리자 비밀번호가 일치하지 않습니다. 다시 입력해 주세요.'
            : '관리자 비밀번호를 입력해 주세요.';

          let html = `
            <div style="padding: 12px; border: 2px solid #FEEBC8; background-color: #FFFDF5; border-radius: var(--radius-sm); font-size: 15px; font-weight: 700; color: #DD6B20;">
              <span style="font-size: 18px;">🟢</span> <strong>GAS 연결 완료</strong><br>
              <span style="font-size: 14px; font-weight: 600; color: #7B341E; display: block; margin-top: 4px;">
                구글 앱스 스크립트 서버와 통신은 양호합니다. 상세 점검(시트 구조 및 설정 키 검증)을 하려면 관리자 세션에 로그인(비밀번호 입력)해야 합니다.
              </span>
            </div>
          `;

          html += `
            <div style="margin-top: 10px; padding: 12px; border: 2px solid var(--border-color); background-color: #F8FAFC; border-radius: var(--radius-sm); font-size: 15px; font-weight: 700;">
              <p style="margin-bottom: 8px;">🔑 ${passwordGuide}</p>
              <div style="display: flex; gap: 8px;">
                <input type="password" id="diagnose-input-pwd" placeholder="비밀번호 입력" style="flex: 1; padding: 8px; border: 2px solid var(--border-color); border-radius: var(--radius-sm); font-size: 16px;">
                <button class="btn btn-secondary" onclick="submitDiagnosePassword()" style="margin:0; min-height: 38px; width: auto; font-size: 14px;">확인</button>
              </div>
            </div>
          `;
          resultsList.innerHTML = html;
          return;
        }

        // 3. 상세 진단 성공 (detailed)
        if (res.mode === 'detailed') {
          // 전체적인 상태에 따른 카드 컬러링
          if (res.overallStatus === 'OK') {
            summaryCard.style.backgroundColor = '#F0FFF4';
            summaryCard.style.borderColor = '#9AE6B4';
            summaryCard.style.color = '#22543D';
            summaryCard.innerHTML = '🟢 시스템 상태 양호 (정상 운영 가능)';
          } else {
            summaryCard.style.backgroundColor = '#FFFDF5';
            summaryCard.style.borderColor = '#FEEBC8';
            summaryCard.style.color = '#DD6B20';
            summaryCard.innerHTML = '🟡 주의 및 확인이 필요합니다';
          }

          let itemsHtml = '';

          // A. 구글 시트 검사 결과 렌더링
          itemsHtml += `<h3 style="font-size: 16px; font-weight: 850; margin: 10px 0 6px 0; border-bottom: 2px dashed var(--border-color); padding-bottom: 4px;">📊 구글 스프레드시트 탭/헤더 점검</h3>`;

          for (let name in res.sheets) {
            const sheet = res.sheets[name];
            if (!sheet.exists) {
              itemsHtml += `
                <div style="padding: 10px; border: 2px solid #FEB2B2; background-color: #FFF5F5; border-radius: var(--radius-sm); font-size: 14px; font-weight: 700; color: #9B2C2C; display: flex; flex-direction: column; gap: 4px;">
                  <div>🔴 [${name}] 시트 누락</div>
                  <div style="font-size: 13px; font-weight: 600; color: #742A2A;">
                    해결: 구글 스프레드시트에 반드시 '${name}' 이름으로 탭(시트)을 생성해 주세요.
                  </div>
                </div>
              `;
            } else if (sheet.status === 'WARN') {
              itemsHtml += `
                <div style="padding: 10px; border: 2px solid #FEEBC8; background-color: #FFFDF5; border-radius: var(--radius-sm); font-size: 14px; font-weight: 700; color: #DD6B20; display: flex; flex-direction: column; gap: 4px;">
                  <div>🟡 [${name}] 시트 구조 불일치</div>
                  <div style="font-size: 13px; font-weight: 600; color: #7B341E;">
                    원인: ${sheet.error}<br>
                    해결: 해당 컬럼들의 이름을 확인하고 원래 위치에 맞게 스프레드시트를 보정하세요.
                  </div>
                </div>
              `;
            } else {
              itemsHtml += `
                <div style="padding: 10px; border: 2.5px solid var(--border-color); background-color: white; border-radius: var(--radius-sm); font-size: 14px; font-weight: 700; color: var(--text-main); display: flex; justify-content: space-between; align-items: center;">
                  <span>🟢 [${name}] 시트</span>
                  <span style="font-size: 12px; color: #38A169; font-weight: 950; background-color: #E6FFFA; padding: 2px 8px; border-radius: 999px; border: 1.5px solid #81E6D9;">정상</span>
                </div>
              `;
            }
          }

          // B. 구글 스크립트 속성 검사 결과 렌더링
          itemsHtml += `<h3 style="font-size: 16px; font-weight: 850; margin: 18px 0 6px 0; border-bottom: 2px dashed var(--border-color); padding-bottom: 4px;">🔑 구글 앱스 스크립트 설정(Script Properties)</h3>`;

          for (let key in res.properties) {
            const prop = res.properties[key];
            if (prop.status === 'ERROR') {
              itemsHtml += `
                <div style="padding: 10px; border: 2px solid #FEB2B2; background-color: #FFF5F5; border-radius: var(--radius-sm); font-size: 14px; font-weight: 700; color: #9B2C2C; display: flex; flex-direction: column; gap: 4px;">
                  <div>🔴 ${key} (${prop.description}) 누락</div>
                  <div style="font-size: 13px; font-weight: 600; color: #742A2A;">
                    해결: 구글 앱스 스크립트 에디터의 [프로젝트 설정 > 스크립트 속성]에 '${key}' 값을 정확히 추가해 주세요.
                  </div>
                </div>
              `;
            } else if (prop.status === 'INFO') {
              itemsHtml += `
                <div style="padding: 10px; border: 2.5px solid var(--border-color); background-color: #F8FAFC; border-radius: var(--radius-sm); font-size: 14px; font-weight: 700; color: var(--text-muted); display: flex; justify-content: space-between; align-items: center;">
                  <span>⚪ ${key} (${prop.description}) 미설정 (선택 사항)</span>
                  <span style="font-size: 12px; color: var(--text-muted); font-weight: 950; background-color: #EDF2F7; padding: 2px 8px; border-radius: 999px; border: 1.5px solid var(--border-color);">선택</span>
                </div>
              `;
            } else {
              itemsHtml += `
                <div style="padding: 10px; border: 2.5px solid var(--border-color); background-color: white; border-radius: var(--radius-sm); font-size: 14px; font-weight: 700; color: var(--text-main); display: flex; justify-content: space-between; align-items: center;">
                  <span>🟢 ${key} (${prop.description})</span>
                  <span style="font-size: 12px; color: #2B6CB0; font-weight: 950; background-color: #EBF8FF; padding: 2px 8px; border-radius: 999px; border: 1.5px solid #BEE3F8;">설정됨</span>
                </div>
              `;
            }
          }

          resultsList.innerHTML = itemsHtml;
        }

      } catch (error) {
        console.error(error);
        summaryCard.style.backgroundColor = '#FFF5F5';
        summaryCard.style.borderColor = '#FEB2B2';
        summaryCard.style.color = '#C53030';
        summaryCard.innerHTML = '🔴 진단 오류 발생';
        resultsList.innerHTML = `
          <div style="padding: 12px; border: 2px solid #FEB2B2; background-color: #FFF5F5; border-radius: var(--radius-sm); font-size: 15px; font-weight: 700; color: #9B2C2C;">
            <strong>클라이언트 진단 엔진 오류</strong><br>
            <span style="font-size: 13px; font-weight: 600; color: #742A2A; display: block; margin-top: 4px;">
              에러 정보: ${error.message || error}
            </span>
          </div>
        `;
      }
    }

    async function submitDiagnosePassword() {
      const input = document.getElementById('diagnose-input-pwd');
      if (!input) return;
      const pwd = input.value.trim();
      if (!pwd) {
        alert('비밀번호를 입력하세요.');
        return;
      }

      sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, pwd);
      updateAdminTokenStatus();
      runSystemDiagnosis();
    }
    let userImageMap = {};
    let previousPendingOrders = [];
    let hasLoadedOrdersOnce = false;
    let currentUsers = [];
    let refreshPaused = false;
    let diagnoseRefreshPausedBeforeOpen = false;
    let isModalOpen = false;
    const ADMIN_TOKEN_STORAGE_KEY = AdminAuth.storageKey;
    const pendingUpdates = new Map(); // 서버 통신 중인 주문 상태 추적

    function esc(value) {
      return AppState.escapeHtml(value);
    }

    function attr(value) {
      return AppState.escapeAttr(value);
    }

    function callAttr(code) {
      return attr(code);
    }

    function jsString(value) {
      return JSON.stringify(String(value ?? ''));
    }

    function getAdminMemo() {
      const memoInput = document.getElementById('admin-change-memo');
      return memoInput ? memoInput.value.trim() : '';
    }

    function updateAdminTokenStatus() {
      AdminAuth.render();
    }

    function getAdminToken() {
      return AdminAuth.requireToken();
    }

    function withAdminToken(body) {
      return {
        ...body,
        adminToken: getAdminToken(),
        adminMemo: getAdminMemo()
      };
    }

    function clearAdminTokenIfDenied(res) {
      AdminAuth.handleDenied(res);
    }

    const NEW_ORDER_SOUND_PATHS = {
      default: 'sounds/new-order.mp3',
      pickup: 'sounds/new-pickup-order.mp3',
      delivery: 'sounds/new-delivery-order.mp3'
    };

    function resolveNewOrderSoundPath(newOrders) {
      const orders = Array.isArray(newOrders) ? newOrders : [];
      const hasDeliveryOrder = orders.some(order =>
        String(order.userId || '') === 'guest' && String(order.deliveryType || 'pickup') === 'delivery'
      );
      if (hasDeliveryOrder) return NEW_ORDER_SOUND_PATHS.delivery;

      const hasGuestOrder = orders.some(order => String(order.userId || '') === 'guest');
      if (hasGuestOrder) return NEW_ORDER_SOUND_PATHS.pickup;

      return NEW_ORDER_SOUND_PATHS.default;
    }

    let isNewOrderSoundEnabled = false;
    let kitchenAudioContext = null;
    let pendingOrderSoundTimer = null;
    let activeOrderAudio = null;

    function getKitchenAudioContext() {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return null;
      if (!kitchenAudioContext || kitchenAudioContext.state === 'closed') {
        kitchenAudioContext = new AudioContextCtor();
      }
      return kitchenAudioContext;
    }

    function updateSoundToggleButton() {
      const button = document.getElementById('btnEnableSound');
      if (!button) return;
      button.setAttribute('aria-pressed', String(isNewOrderSoundEnabled));
      button.textContent = isNewOrderSoundEnabled ? '🔊 알림 끄기' : '🔇 알림 켜기';
      button.title = isNewOrderSoundEnabled ? '알림음 끄기' : '알림음 켜기';
      button.style.backgroundColor = isNewOrderSoundEnabled ? '#0F766E' : '#334155';
    }

    function stopPendingOrderSound() {
      if (pendingOrderSoundTimer) {
        clearTimeout(pendingOrderSoundTimer);
        pendingOrderSoundTimer = null;
      }
      if (activeOrderAudio) {
        activeOrderAudio.pause();
        activeOrderAudio.currentTime = 0;
        activeOrderAudio = null;
      }
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    }

    async function toggleNewOrderSound() {
      if (isNewOrderSoundEnabled) {
        isNewOrderSoundEnabled = false;
        stopPendingOrderSound();
        updateSoundToggleButton();
        return;
      }

      try {
        const audioContext = getKitchenAudioContext();
        if (audioContext && audioContext.state === 'suspended') {
          await audioContext.resume();
        }
        isNewOrderSoundEnabled = true;
        updateSoundToggleButton();
        const utterance = new SpeechSynthesisUtterance('음성 알림이 활성화되었습니다.');
        window.speechSynthesis?.speak(utterance);
      } catch (error) {
        console.warn('알림음 활성화 실패:', error);
        isNewOrderSoundEnabled = false;
        updateSoundToggleButton();
      }
    }

    // 신규 주문 발생 시 띵동 알림음 후 배달의민족 커스텀 알림음 재생
    function playNewOrderSound(soundPath) {
      if (!isNewOrderSoundEnabled) return;

      try {
        const customSoundPath = soundPath || NEW_ORDER_SOUND_PATHS.default;
        const audioCtx = getKitchenAudioContext();
        if (!audioCtx) return;

        // 첫 번째 음 (딩 - High A)
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
        gain1.gain.setValueAtTime(0, audioCtx.currentTime);
        gain1.gain.linearRampToValueAtTime(0.12, audioCtx.currentTime + 0.05);
        gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);

        osc1.start(audioCtx.currentTime);
        osc1.stop(audioCtx.currentTime + 0.6);

        // 두 번째 음 (동 - Low E)
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);

        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(659, audioCtx.currentTime + 0.22); // E5
        gain2.gain.setValueAtTime(0, audioCtx.currentTime + 0.22);
        gain2.gain.linearRampToValueAtTime(0.12, audioCtx.currentTime + 0.27);
        gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.9);

        osc2.start(audioCtx.currentTime + 0.22);
        osc2.stop(audioCtx.currentTime + 0.9);

        // 딩동 소리 재생이 끝날 즈음(약 1초 후)에 원장님 커스텀 목소리 재생
        if (pendingOrderSoundTimer) clearTimeout(pendingOrderSoundTimer);
        pendingOrderSoundTimer = setTimeout(() => {
          pendingOrderSoundTimer = null;
          if (!isNewOrderSoundEnabled) return;
          const audio = new Audio(customSoundPath);
          activeOrderAudio = audio;
          audio.addEventListener('ended', () => {
            if (activeOrderAudio === audio) activeOrderAudio = null;
          }, { once: true });
          audio.play().catch(e => {
            console.warn("오디오 자동 재생 차단:", e);
            if (activeOrderAudio === audio) activeOrderAudio = null;
          });
        }, 1000);

      } catch (e) {
        console.warn("알림음 재생 실패:", e);
      }
    }

    // ISO 시간 -> HH:MM:SS 한글 포맷 변환
    function formatTime(isoString) {
      if (!isoString) return "-";
      try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return isoString;
        
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
      } catch (e) {
        return isoString;
      }
    }

    function renderSnackStock(snacks) {
      const stockListEl = document.getElementById('snack-stock-list');
      if (!stockListEl) return;

      const groups = {
        user: [],
        guest: []
      };

      snacks.forEach(snack => {
        const target = snack.target === 'guest' ? 'guest' : 'user';
        groups[target].push(snack);
      });

      Object.values(groups).forEach(group => {
        group.sort((a, b) => {
          const orderDiff = Number(a.displayOrder || 0) - Number(b.displayOrder || 0);
          return orderDiff || String(a.name || '').localeCompare(String(b.name || ''), 'ko');
        });
      });

      const renderGroup = (target, title) => {
        const items = groups[target];
        const itemMarkup = items.length > 0
          ? items.map(snack => {
            const stock = Number(snack.stock || 0);
            const zeroClass = stock <= 0 ? ' is-zero' : '';
            
            // 게이지 백분율 계산: min(stock / 10, 1) * 100
            const percent = Math.min(Math.max(stock, 0) / 10, 1) * 100;
            
            // 상태별 색상
            let gaugeColor = '';
            if (stock >= 10) {
              gaugeColor = '#DEF7EC'; // 연한 초록색
            } else if (stock >= 4) {
              gaugeColor = '#FEF3C7'; // 연한 노란색
            } else if (stock >= 1) {
              gaugeColor = '#FEE2E2'; // 연한 빨간색
            }
            
            const gaugeMarkup = stock > 0
              ? `<div class="snack-stock-gauge" style="width: ${percent}%; background-color: ${gaugeColor};"></div>`
              : '';

            return `
              <div class="snack-stock-item${zeroClass}">
                ${gaugeMarkup}
                <span class="snack-stock-name" title="${attr(snack.name || '')}">${esc(snack.name || '-')}</span>
                <span class="snack-stock-value">${stock}개</span>
              </div>
            `;
          }).join('')
          : '<div class="snack-stock-empty">표시할 간식이 없습니다.</div>';

        return `
          <section class="snack-stock-group ${target}">
            <h3 class="snack-stock-group-title">${title}</h3>
            <div class="snack-stock-items">${itemMarkup}</div>
          </section>
        `;
      };

      stockListEl.innerHTML = `
        <div class="snack-stock-groups">
          ${renderGroup('user', '일반 키오스크')}
          ${renderGroup('guest', '배달왔삼')}
        </div>
      `;
    }

    async function loadSnackStock() {
      const stockListEl = document.getElementById('snack-stock-list');
      if (!stockListEl) return;

      stockListEl.innerHTML = '<div class="snack-stock-message">불러오는 중...</div>';

      try {
        const snacksRes = await fetchAPI('getSnacks');
        if (!snacksRes || !snacksRes.success || !Array.isArray(snacksRes.snacks)) {
          throw new Error('간식 재고 응답 결과가 올바르지 않습니다.');
        }
        renderSnackStock(snacksRes.snacks);
      } catch (error) {
        console.error('간식 재고 조회 실패:', error);
        stockListEl.innerHTML = '<div class="snack-stock-message is-error">재고를 불러오지 못했습니다.</div>';
      }
    }

    // 주문 데이터 및 집계 로드
    async function loadAdminData() {
      const pendingContainer = document.getElementById('pending-orders-group');
      if (pendingContainer) {
        pendingContainer.innerHTML = '<div style="padding: 20px; text-align: center; font-weight: 700;">대기 목록 불러오는 중...</div>';
      }

      const tbody = document.getElementById('order-table-body');
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 30px; font-weight: 700;">데이터를 불러오는 중...</td></tr>';

      loadSnackStock();

      try {
        const [ordersRes, usersRes] = await Promise.all([
          fetchAPI('getOrdersToday'),
          fetchAPI('getUsers', { params: { includeInactive: 'Y' } })
        ]);
        
        // 1. 유저 이미지 매핑 데이터 생성
        userImageMap = {};
        if (usersRes && usersRes.success && Array.isArray(usersRes.users)) {
          currentUsers = usersRes.users;
          usersRes.users.forEach(u => {
            userImageMap[u.nickname] = u.imageUrl || '';
          });
        }

        // 2. 주문 내역 데이터 처리
        if (ordersRes && ordersRes.success && Array.isArray(ordersRes.orders)) {
          currentOrders = ordersRes.orders;
          updateOrderArchiveHealth(ordersRes.orderSheetRowCount);
          renderData(currentOrders);
        } else {
          throw new Error('주문 API 응답 결과가 올바르지 않습니다.');
        }

        // 3. 간식 재고는 loadSnackStock()에서 독립적으로 처리합니다.

        // 4. 후기 데이터 처리 (kitchen.html에서는 제거됨)

        // 5. 게스트 운영 설정 갱신 (자동 새로고침 시 입력값 보호를 위해 true 전달)
        loadGuestOpsPanel(true);
      } catch (error) {
        console.error('관리자 데이터 조회 실패:', error);
        const errorTbody = document.getElementById('order-table-body');
        if (errorTbody) {
          errorTbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger-color); padding: 30px; font-weight: 700;">
            데이터를 불러오지 못했습니다.<br>(${error.message || '인터넷 연결 끊김'})
          </td></tr>`;
        }
        const pendingGroup = document.getElementById('pending-orders-group');
        if (pendingGroup) {
          pendingGroup.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--danger-color); font-weight: 700;">대기 목록 데이터를 불러오지 못했습니다.</div>`;
        }
      } finally {
        // 데이터 로드가 완료(성공 혹은 실패)된 후에 다음 새로고침 타이머 리셋 및 기동
        if (!refreshPaused) {
          resetRefreshTimer();
        }
      }
    }

    // 일괄 처리 UI 갱신
    function updateBulkActionBar(hasPending) {
      updateBulkSelectionUI();
    }

    // 선택 체크박스 상태에 따라 버튼/카운트 갱신 (컬럼별)
    function updateBulkSelectionUI() {
      // 1. 키오스크
      const kioskCbs = document.querySelectorAll('#pending-kiosk-group .pending-order-checkbox');
      const kioskChecked = document.querySelectorAll('#pending-kiosk-group .pending-order-checkbox:checked');
      const countKiosk = document.getElementById('bulk-count-kiosk');
      const btnSelKiosk = document.getElementById('btn-bulk-selected-kiosk');
      const btnAllKiosk = document.getElementById('btn-bulk-all-kiosk');
      if (countKiosk) countKiosk.textContent = `선택: ${kioskChecked.length}건`;
      if (btnSelKiosk) btnSelKiosk.disabled = kioskChecked.length === 0;
      if (btnAllKiosk) btnAllKiosk.disabled = kioskCbs.length === 0;

      // 2. 포장
      const pickupCbs = document.querySelectorAll('#pending-pickup-group .pending-order-checkbox');
      const pickupChecked = document.querySelectorAll('#pending-pickup-group .pending-order-checkbox:checked');
      const countPickup = document.getElementById('bulk-count-pickup');
      const btnSelPickup = document.getElementById('btn-bulk-selected-pickup');
      const btnAllPickup = document.getElementById('btn-bulk-all-pickup');
      if (countPickup) countPickup.textContent = `선택: ${pickupChecked.length}건`;
      if (btnSelPickup) btnSelPickup.disabled = pickupChecked.length === 0;
      if (btnAllPickup) btnAllPickup.disabled = pickupCbs.length === 0;

      // 3. 배달
      const deliveryCbs = document.querySelectorAll('#pending-delivery-group .pending-order-checkbox');
      const deliveryChecked = document.querySelectorAll('#pending-delivery-group .pending-order-checkbox:checked');
      const countDelivery = document.getElementById('bulk-count-delivery');
      const btnSelDelivery = document.getElementById('btn-bulk-selected-delivery');
      const btnAllDelivery = document.getElementById('btn-bulk-all-delivery');
      if (countDelivery) countDelivery.textContent = `선택: ${deliveryChecked.length}건`;
      if (btnSelDelivery) btnSelDelivery.disabled = deliveryChecked.length === 0;
      if (btnAllDelivery) btnAllDelivery.disabled = deliveryCbs.length === 0;
    }

    // 선택된 주문만 일괄 제공 완료 (컬럼별)
    async function completeSelectedOrders(columnId) {
      let queryStr = '.pending-order-checkbox:checked';
      if (columnId === 'kiosk') queryStr = '#pending-kiosk-group .pending-order-checkbox:checked';
      else if (columnId === 'pickup') queryStr = '#pending-pickup-group .pending-order-checkbox:checked';
      else if (columnId === 'delivery') queryStr = '#pending-delivery-group .pending-order-checkbox:checked';

      const checked = document.querySelectorAll(queryStr);
      if (checked.length === 0) return;

      const orderNos = Array.from(checked).map(cb => cb.getAttribute('data-order-no'));
      const ok = confirm(`선택한 ${orderNos.length}건의 주문을 모두 제공 완료 처리할까요?`);
      if (!ok) return;

      const btnSel = document.getElementById(`btn-bulk-selected-${columnId}`);
      const btnAll = document.getElementById(`btn-bulk-all-${columnId}`);
      if (btnSel) btnSel.disabled = true;
      if (btnAll) btnAll.disabled = true;

      let successCount = 0;
      let failCount = 0;

      for (const orderNo of orderNos) {
        try {
          const res = await fetchAPI('updateOrderServed', {
            method: 'POST',
            body: withAdminToken({ orderId: orderNo, servedYn: 'Y' })
          });
          if (res && res.success) {
            successCount++;
          } else {
            clearAdminTokenIfDenied(res);
            failCount++;
          }
        } catch (e) {
          failCount++;
        }
      }

      AppState.vibrate(80);
      AppState.playClickSound();
      if (failCount > 0) {
        alert(`완료: ${successCount}건 / 실패: ${failCount}건`);
      }
      await loadAdminData();
    }

    // 모든 대기 주문 일괄 제공 완료 (컬럼별)
    async function completeAllOrders(columnId) {
      let queryStr = '.pending-order-checkbox';
      if (columnId === 'kiosk') queryStr = '#pending-kiosk-group .pending-order-checkbox';
      else if (columnId === 'pickup') queryStr = '#pending-pickup-group .pending-order-checkbox';
      else if (columnId === 'delivery') queryStr = '#pending-delivery-group .pending-order-checkbox';

      const checkboxes = document.querySelectorAll(queryStr);
      if (checkboxes.length === 0) return;

      const ok = confirm(`대기 중인 ${checkboxes.length}건의 주문을 모두 제공 완료 처리할까요?`);
      if (!ok) return;

      // 전체 선택 후 일괄 처리
      checkboxes.forEach(cb => { cb.checked = true; cb.dispatchEvent(new Event('change')); });
      await completeSelectedOrders(columnId);
    }



    // 주문 취소 처리 모달 열기
    let currentCancelOrderNo = null;
    let currentCancelNickname = null;

    function cancelOrderAction(orderNo, nickname) {
      if (typeof USE_MOCK !== 'undefined' && USE_MOCK) {
        // Mock 환경에서는 바로 취소
        executeCancelOrder(orderNo, '기타', 'Mock Test');
        return;
      }
      currentCancelOrderNo = orderNo;
      currentCancelNickname = nickname;
      
      const modal = document.getElementById('modal-cancel-reason');
      document.getElementById('cancel-modal-desc').textContent = `[${nickname} 님]의 주문을 취소하시겠습니까? 사용된 포인트가 환불되고 간식 재고가 복구됩니다.`;
      document.getElementById('cancel-reason-select').value = '';
      document.getElementById('cancel-reason-detail').value = '';
      toggleCancelReasonDetail();
      
      modal.style.display = 'flex';
      isModalOpen = true;
    }

    function closeCancelReasonModal() {
      document.getElementById('modal-cancel-reason').style.display = 'none';
      isModalOpen = false;
    }

    // --- 오늘의 운영 결과 모달 집계 및 복사 기능 ---
    let lastSummaryText = ''; // 복사용 텍스트 임시 보관

    // 날짜 객체나 날짜 문자열을 안전하게 KST 기준 YYYY-MM-DD 형식으로 변환하는 함수
    function getKoreaDateString(dateVal) {
      if (!dateVal) return '';

      // 1. 이미 Date 객체인 경우 (또는 타임스탬프 숫자)
      const d = new Date(dateVal);
      if (d && !isNaN(d.getTime())) {
        // UTC 시간에 한국 시간(9시간)을 더해 KST 기준 날짜 문자열 추출
        const kstTime = new Date(d.getTime() + (9 * 60 * 60 * 1000));
        return `${kstTime.getUTCFullYear()}-${kstTime.getUTCMonth() + 1}-${kstTime.getUTCDate()}`;
      }

      // 2. 한글 날짜 형식 문자열 포맷팅 지원 ("2026. 6. 30. 오후 5:30:00" 등)
      const match = String(dateVal).trim().match(/(\d{4})[-\.\/\s]+(\d{1,2})[-\.\/\s]+(\d{1,2})/);
      if (match) {
        return `${parseInt(match[1], 10)}-${parseInt(match[2], 10)}-${parseInt(match[3], 10)}`;
      }

      return '';
    }

    async function openTodaySummaryModal() {
      const modal = document.getElementById('modal-today-summary');
      const contentEl = document.getElementById('today-summary-content');
      
      modal.style.display = 'flex';
      isModalOpen = true;
      contentEl.innerHTML = `
        <div style="text-align: center; padding: 30px; font-weight: bold; color: var(--text-muted);">
          <span class="offline-loading-spinner" style="display:inline-block; margin-right:8px; vertical-align:middle; width:20px; height:20px;"></span>
          오늘의 집계 데이터를 분석하고 있습니다...
        </div>
      `;

      try {
        // 1. 주문 데이터 기반 프론트엔드 집계
        const orderGroups = {};
        let totalItemsCount = 0;
        
        currentOrders.forEach((o, idx) => {
          const orderNo = o.orderNo || `${o.timestamp || idx}_${o.nickname || 'unknown'}`;
          if (!orderGroups[orderNo]) {
            orderGroups[orderNo] = {
              orderNo: orderNo,
              servedYn: o.servedYn || 'N',
              deliveryType: o.deliveryType || 'pickup',
              deliveryPlace: o.deliveryPlace || '',
              deliveryFee: Number(o.deliveryFee || 0),
              userId: o.userId || '',
              points: 0,
              itemsCount: 0
            };
          }
          orderGroups[orderNo].points += Number(o.point || 0);
          orderGroups[orderNo].itemsCount += Number(o.quantity || 1);
          totalItemsCount += Number(o.quantity || 1);
        });

        const orderList = Object.values(orderGroups);
        const totalOrders = orderList.length;
        const completedCount = orderList.filter(g => g.servedYn === 'Y').length;
        const canceledCount = orderList.filter(g => g.servedYn === 'C').length;
        const activeOrders = orderList.filter(g => g.servedYn !== 'C');
        const kioskCount = activeOrders.filter(g => g.userId !== 'guest').length;
        const guestPickupCount = activeOrders.filter(g => g.userId === 'guest' && g.deliveryType === 'pickup').length;
        const guestDeliveryCount = activeOrders.filter(g => g.userId === 'guest' && g.deliveryType === 'delivery').length;

        // 총 차감 크레딧 집계 (취소된 주문 제외)
        let totalPoints = 0;
        activeOrders.forEach(g => {
          totalPoints += g.points + g.deliveryFee;
        });

        // 2. 후기 데이터 조회 및 오늘 날짜 기준 집계
        let totalReviews = 0;
        let photoReviews = 0;
        let tagsText = '등록된 태그 없음';
        let tagsHtml = '<span style="font-size:13px; color:var(--text-muted);">오늘 작성된 후기 태그가 없습니다.</span>';

        const reviewsRes = await fetchAPI('getReviewsForAdmin', { method: 'POST', body: withAdminToken({}) });
        if (reviewsRes && reviewsRes.success && Array.isArray(reviewsRes.reviews)) {
          const todayStr = getKoreaDateString(new Date());
          const todayReviews = reviewsRes.reviews.filter(r => {
            const dateStr = getKoreaDateString(r.createdAt);
            return dateStr && dateStr === todayStr;
          });
          
          textMsg += `- 오늘 전달받은 누적 온기: ${totalPoints}개 ❤️\n`;
          textMsg += `- 총 주문 건수: ${totalOrders}건\n`;
          textMsg += `- 완료된 주문: ${completedCount}건\n`;
          if (canceledCount > 0) textMsg += `- 취소된 주문: ${canceledCount}건\n`;

          htmlMsg += `
            <div style="font-size: 16px; font-weight: 700; line-height: 1.6; color: var(--text-main);">
              <div>❤️ 오늘 전달받은 누적 온기: <span style="font-size: 18px; font-weight: 900; color: var(--primary-color);">${totalPoints}개 ❤️</span></div>`;
          
          totalReviews = todayReviews.length;
          photoReviews = todayReviews.filter(r => r.imageUrl && r.imageUrl.trim() !== '').length;

          // 태그 집계
          const tagCounts = {};
          todayReviews.forEach(r => {
            if (!r.tags) return;
            const parts = r.tags.split(/[,,|]/);
            parts.forEach(p => {
              const cleaned = p.trim();
              if (cleaned) {
                tagCounts[cleaned] = (tagCounts[cleaned] || 0) + 1;
              }
            });
          });

          const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
          if (sortedTags.length > 0) {
            tagsText = sortedTags.map(([tag, count]) => `${tag} ${count}개`).join(' / ');
            tagsHtml = sortedTags.map(([tag, count]) => `
              <span style="background-color: #E6FFFA; border: 1.5px solid #81E6D9; padding: 4px 10px; border-radius: 999px; font-size: 13px; font-weight: 800; color: #234E52;">
                ${esc(tag)} ${count}
              </span>
            `).join('');
          }
        }

        // 3. 복사용 텍스트 포맷 생성
        const todayFormatted = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
        lastSummaryText = `📢 [오늘의 운영 결과 요약]
- 날짜: ${todayFormatted}
- 총 주문: ${totalOrders}건 (키오스크: ${kioskCount}건 / 배달왔삼 포장: ${guestPickupCount}건 / 배달왔삼 배달: ${guestDeliveryCount}건)
- 주문 상태: 완료 ${completedCount}건 / 취소 ${canceledCount}건
- 총 차감 온기: ${totalPoints}개 ❤️
- 오늘 후기: ${totalReviews}건 (사진 후기: ${photoReviews}건)
- 후기 태그: ${tagsText}`;

        // 4. 모달 콘텐츠 적용
        contentEl.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 14px;">
            <div style="font-size: 14px; color: var(--text-muted); font-weight: 700; text-align: right; margin-bottom: -4px;">
              📅 ${esc(todayFormatted)} 기준
            </div>
            
            <div style="background-color: #F8FAFC; border: 2.5px solid var(--border-color); border-radius: var(--radius-sm); padding: 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px; font-size: 16px; font-weight: 850; color: var(--text-main);">
              <div style="grid-column: 1 / -1; font-size: 18px; border-bottom: 2px solid var(--border-color); padding-bottom: 8px; margin-bottom: 4px; color: var(--primary-color);">
                🛍️ 주문 집계
              </div>
              <div>📝 총 주문 건수: <span style="font-size: 18px; font-weight: 900; color: var(--text-main);">${totalOrders}건</span></div>
              <div>❤️ 오늘 전달받은 누적 온기: <span style="font-size: 18px; font-weight: 900; color: var(--primary-color);">${totalPoints}개 ❤️</span></div>
              <div>🥡 키오스크 주문: <span style="font-weight: 800;">${kioskCount}건</span></div>
              <div>📱 배달왔삼 포장: <span style="font-weight: 800;">${guestPickupCount}건</span></div>
              <div>🛵 배달왔삼 배달: <span style="font-weight: 800;">${guestDeliveryCount}건</span></div>
              <div>✅ 제공 완료: <span style="color: var(--secondary-hover);">${completedCount}건</span></div>
              <div>🚫 취소 주문: <span style="color: var(--danger-color);">${canceledCount}건</span></div>
            </div>

            <div style="background-color: #F0FFF4; border: 2.5px solid #9AE6B4; border-radius: var(--radius-sm); padding: 18px; font-size: 15px; font-weight: 800; color: #22543D;">
              <div style="font-size: 18px; font-weight: 900; margin-bottom: 8px; border-bottom: 1.5px dashed #9AE6B4; padding-bottom: 8px; color: #276749;">
                💬 후기 및 태그 요약
              </div>
              <div style="margin-bottom: 10px; font-size:16px;">
                총 후기: <strong style="font-size:18px;">${totalReviews}건</strong> (사진: <strong>${photoReviews}건</strong>)
              </div>
              <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px;">
                ${tagsHtml}
              </div>
            </div>
          </div>
        `;
      } catch (err) {
        console.error("운영 결과 모달 집계 오류:", err);
        contentEl.innerHTML = `
          <div style="text-align: center; padding: 20px; color: var(--danger-color); font-weight: bold;">
            데이터 집계 도중 오류가 발생했습니다.<br>
            <span style="font-size: 13px; font-weight: 500;">${esc(err.message)}</span>
          </div>
        `;
      }
    }

    function closeTodaySummaryModal() {
      document.getElementById('modal-today-summary').style.display = 'none';
      isModalOpen = false;
    }

    function copyTodaySummaryText() {
      if (!lastSummaryText) {
        alert("복사할 데이터가 준비되지 않았습니다.");
        return;
      }
      navigator.clipboard.writeText(lastSummaryText)
        .then(() => {
          AppState.vibrate(40);
          AppState.playClickSound();
          alert("오늘의 운영 결과 요약이 클립보드에 복사되었습니다!\n카카오톡 등에 편하게 붙여넣기(Ctrl+V) 하세요.");
        })
        .catch(err => {
          console.error("클립보드 복사 실패:", err);
          alert("클립보드 복사에 실패했습니다. 직접 복사해 주세요.");
        });
    }

    function toggleCancelReasonDetail() {
      const select = document.getElementById('cancel-reason-select');
      const container = document.getElementById('cancel-reason-detail-container');
      if (select.value === '기타') {
        container.style.display = 'flex';
      } else {
        container.style.display = 'none';
      }
    }

    async function submitCancelOrder() {
      const select = document.getElementById('cancel-reason-select');
      const detailInput = document.getElementById('cancel-reason-detail');
      const reason = select.value;
      const detail = detailInput.value.trim();

      if (!reason) {
        alert('취소 사유를 선택해 주세요.');
        select.focus();
        return;
      }

      if (reason === '기타' && !detail) {
        alert('취소 사유를 입력해 주세요.');
        detailInput.focus();
        return;
      }

      closeCancelReasonModal();
      await executeCancelOrder(currentCancelOrderNo, reason, detail);
    }

    async function executeCancelOrder(orderNo, reason, detail) {
      try {
        const payload = withAdminToken({ orderId: orderNo, cancelReason: reason, cancelReasonDetail: detail });
        console.log("Canceling order requested");
        const res = await fetchAPI('cancelOrder', {
          method: 'POST',
          body: payload
        });
        
        if (res && res.success) {
          AppState.vibrate(80);
          AppState.playClickSound();
          alert(`주문이 성공적으로 취소 및 환불되었습니다.`);
          await loadAdminData(); // 데이터 재로드 및 렌더링
        } else {
          clearAdminTokenIfDenied(res);
          alert("주문 취소에 실패했습니다: " + (res?.message || "서버에서 거부되었습니다.") + "\n응답값: " + JSON.stringify(res));
        }
      } catch (error) {
        console.error("주문 취소 중 오류:", error);
        alert("주문 취소 처리 중 오류가 발생했습니다.\n상세: " + error.message + "\n\n* Apps Script가 최신 버전으로 올바르게 배포되었고, config.js의 URL이 맞는지 확인해 주세요.");
      }
    }

    // 로딩 메시지 없이 조용히 최신 데이터 갱신
    async function silentRefreshAdminData() {
      try {
        const [ordersRes, usersRes] = await Promise.all([
          fetchAPI('getOrdersToday'),
          fetchAPI('getUsers', { params: { includeInactive: 'Y' } })
        ]);
        if (usersRes && usersRes.success && Array.isArray(usersRes.users)) {
          currentUsers = usersRes.users;
          usersRes.users.forEach(u => {
            userImageMap[u.nickname] = u.imageUrl || '';
          });
        }
        if (ordersRes && ordersRes.success && Array.isArray(ordersRes.orders)) {
          currentOrders = ordersRes.orders;
          updateOrderArchiveHealth(ordersRes.orderSheetRowCount);
          renderData(currentOrders);
        }
      } catch (e) {
        console.warn("백그라운드 새로고침 실패:", e);
      }
    }

    // 로컬 카드 상태 롤백 처리
    function rollbackLocalOrders(orderNo, originalStates) {
      currentOrders.forEach(o => {
        const itemNo = o.orderNo || `${o.timestamp}_${o.nickname}`;
        if (itemNo === orderNo) {
          const original = originalStates.find(orig => orig.id === (o.orderId || o.orderNo));
          if (original) {
            o.servedYn = original.servedYn;
          }
        }
      });
      renderData(currentOrders);
    }

    // 제공 완료 취소 (되돌리기) 처리 (DB 상태 업데이트)
    async function undoCompleteOrder(orderNo) {
      const originalStates = currentOrders
        .filter(o => (o.orderNo || `${o.timestamp}_${o.nickname}`) === orderNo)
        .map(o => ({ id: o.orderId || o.orderNo, servedYn: o.servedYn }));

      currentOrders.forEach(o => {
        const itemNo = o.orderNo || `${o.timestamp}_${o.nickname}`;
        if (itemNo === orderNo) {
          o.servedYn = 'R';
        }
      });

      pendingUpdates.set(orderNo, 'R');

      AppState.vibrate(50);
      AppState.playClickSound();
      renderData(currentOrders);

      try {
        const res = await fetchAPI('updateOrderServed', {
          method: 'POST',
          body: withAdminToken({ orderId: orderNo, servedYn: 'R' })
        });
        
        if (res && res.success) {
          pendingUpdates.delete(orderNo);
          silentRefreshAdminData();
        } else {
          pendingUpdates.delete(orderNo);
          rollbackLocalOrders(orderNo, originalStates);
          clearAdminTokenIfDenied(res);
          alert("되돌리기에 실패했습니다: " + (res?.message || "알 수 없는 오류"));
        }
      } catch (error) {
        pendingUpdates.delete(orderNo);
        rollbackLocalOrders(orderNo, originalStates);
        console.error("되돌리기 중 오류:", error);
        alert("되돌리기 중 오류가 발생했습니다. 이전 상태로 되돌립니다.");
      }
    }

    // 단계별 상태 업그레이드 처리
    async function updateStatusAction(orderNo, nextStatus) {
      const originalStates = currentOrders
        .filter(o => (o.orderNo || `${o.timestamp}_${o.nickname}`) === orderNo)
        .map(o => ({ id: o.orderId || o.orderNo, servedYn: o.servedYn }));

      currentOrders.forEach(o => {
        const itemNo = o.orderNo || `${o.timestamp}_${o.nickname}`;
        if (itemNo === orderNo) {
          o.servedYn = nextStatus;
        }
      });

      pendingUpdates.set(orderNo, nextStatus);

      AppState.vibrate(50);
      AppState.playClickSound();
      renderData(currentOrders);

      try {
        const res = await fetchAPI('updateOrderServed', {
          method: 'POST',
          body: withAdminToken({ orderId: orderNo, servedYn: nextStatus })
        });
        
        if (res && res.success) {
          pendingUpdates.delete(orderNo);
          silentRefreshAdminData();
        } else {
          pendingUpdates.delete(orderNo);
          rollbackLocalOrders(orderNo, originalStates);
          clearAdminTokenIfDenied(res);
          alert("상태 변경에 실패했습니다: " + (res?.message || "오류"));
        }
      } catch (error) {
        pendingUpdates.delete(orderNo);
        rollbackLocalOrders(orderNo, originalStates);
        console.error("상태 변경 중 오류:", error);
        alert("상태 변경 중 통신 오류가 발생했습니다. 이전 상태로 되돌립니다.");
      }
    }

    // 주문 운영 화면에서는 이용자/간식 관리 렌더러를 사용하지 않습니다.

    // 데이터 렌더링 및 집계 계산
    function renderData(rawOrders) {
      // 각 주문마다 고유 식별자가 없을 경우 생성 (timestamp와 nickname을 조합하여 같은 주문건으로 묶이게 함)
      const orders = rawOrders.map((o, idx) => {
        const orderNo = o.orderNo || `${o.timestamp || idx}_${o.nickname || 'unknown'}`;
        let servedYn = o.servedYn;
        if (pendingUpdates.has(orderNo)) {
          servedYn = pendingUpdates.get(orderNo);
        }
        return {
          ...o,
          orderNo,
          servedYn
        };
      });

      // 1. 제공 완료 여부에 따른 목록 분리 (DB에서 받아온 servedYn 값 사용)
      const activeOrders = orders.filter(o => o.servedYn !== 'C');
      const canceledOrders = orders.filter(o => o.servedYn === 'C');
      
      // 수령방식 필터링 적용
      const selectEl = document.getElementById('delivery-filter');
      const filterVal = selectEl ? selectEl.value : 'all';
      
      const filteredActive = activeOrders.filter(o => {
        if (filterVal === 'all') return true;
        const isGuest = o.userId === 'guest';
        const type = isGuest ? (o.deliveryType || 'pickup') : 'pickup';
        return type === filterVal;
      });

      const filteredCanceled = canceledOrders.filter(o => {
        if (filterVal === 'all') return true;
        const isGuest = o.userId === 'guest';
        const type = isGuest ? (o.deliveryType || 'pickup') : 'pickup';
        return type === filterVal;
      });

      const pendingOrders = filteredActive.filter(o => o.servedYn !== 'Y');
      const completedOrders = filteredActive.filter(o => o.servedYn === 'Y');

      // 필터와 상관없이 전체 대기(미제공) 주문을 기준으로 신규 주문 감지
      const allPendingOrders = activeOrders.filter(o => o.servedYn !== 'Y');

      // 신규 주문 알림 접수 감지 및 재생
      if (hasLoadedOrdersOnce) {
        const prevKeys = new Set(previousPendingOrders.map(o => o.orderNo));
        const newPendingOrders = allPendingOrders.filter(order =>
          !prevKeys.has(order.orderNo)
        );

        const hasNewPendingOrder = newPendingOrders.length > 0;

        if (hasNewPendingOrder) {
          console.log('신규 주문 감지');
          console.log(previousPendingOrders.length);
          console.log(allPendingOrders.length);
          playNewOrderSound(resolveNewOrderSoundPath(newPendingOrders));
        }
      }

      previousPendingOrders = [...allPendingOrders];
      hasLoadedOrdersOnce = true;

      // 2. 미제공 간식 총합 계산 및 렌더링
      const snackTotals = {};
      pendingOrders.forEach(order => {
        const name = order.snackName;
        const qty = Number(order.quantity || 1);
        snackTotals[name] = (snackTotals[name] || 0) + qty;
      });

      const board = document.getElementById('admin-summary-board');
      const entries = Object.entries(snackTotals);
      
      if (entries.length > 0) {
        board.style.display = 'block';
        board.innerHTML = `
          <div class="admin-section-title" style="margin-top: 0; color: var(--primary-hover); border-left-color: var(--primary-hover);">📋 지금 꺼내올 간식 (미제공 총수량)</div>
          <div class="totals-grid">
            ${entries.map(([name, qty]) => `<div class="total-item-badge"><strong>${esc(name)}</strong> <span class="highlight">${Number(qty)}개</span></div>`).join('')}
          </div>
        `;
      } else {
        board.style.display = 'none';
        board.innerHTML = '';
      }
      // 3. 대기 중인 주문 리스트 카드형 렌더링 (주문번호 기준 선입선출 큐 - 키오스크 / 배달왔삼 포장 / 배달왔삼 배달 3열 분리)
      const pendingContainer = document.getElementById('pending-orders-group');
      pendingContainer.className = 'orders-split-layout';
      pendingContainer.innerHTML = `
        <!-- 키오스크 주문 열 -->
        <div class="orders-column">
          <div class="admin-section-title" style="font-size: 18px; color: var(--primary-hover); border-left-color: var(--primary-color); margin-top: 0; padding-left: 10px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
            <span>🥡 키오스크 주문</span>
            <span id="kiosk-pending-count" class="status-badge" style="background-color: var(--primary-color); border-color: var(--primary-color); color: white; min-width: 30px; padding: 2px 6px;">0건</span>
          </div>
          <!-- 키오스크 전용 일괄 처리 바 -->
          <div class="column-bulk-bar" id="bulk-bar-kiosk" style="display: flex; gap: 8px; align-items: center; background: #F8F9FA; padding: 8px 12px; border-radius: var(--radius-sm); border: 2.5px solid var(--border-color); margin-bottom: 12px;">
            <span style="font-size: 13px; font-weight: 800; color: var(--text-muted); flex: 1;" id="bulk-count-kiosk">선택: 0건</span>
            <button class="btn-small-action" style="padding: 4px 8px; font-size: 13px; background-color: var(--secondary-color); color: white; border: none; min-height: auto;" id="btn-bulk-selected-kiosk" onclick="completeSelectedOrders('kiosk')" disabled>선택 제공</button>
            <button class="btn-small-action" style="padding: 4px 8px; font-size: 13px; background-color: #3A86C8; color: white; border: none; min-height: auto;" id="btn-bulk-all-kiosk" onclick="completeAllOrders('kiosk')">모두 제공</button>
          </div>
          <div id="pending-kiosk-group" style="display: flex; flex-direction: column; gap: 16px;"></div>
        </div>

        <!-- 배달왔삼 포장 열 -->
        <div class="orders-column">
          <div class="admin-section-title" style="font-size: 18px; color: var(--secondary-hover); border-left-color: var(--secondary-color); margin-top: 0; padding-left: 10px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
            <span>📱 배달왔삼 포장</span>
            <span id="pickup-pending-count" class="status-badge" style="background-color: var(--secondary-color); border-color: var(--secondary-color); color: white; min-width: 30px; padding: 2px 6px;">0건</span>
          </div>
          <!-- 배달왔삼 포장 전용 일괄 처리 바 -->
          <div class="column-bulk-bar" id="bulk-bar-pickup" style="display: flex; gap: 8px; align-items: center; background: #F8F9FA; padding: 8px 12px; border-radius: var(--radius-sm); border: 2.5px solid var(--border-color); margin-bottom: 12px;">
            <span style="font-size: 13px; font-weight: 800; color: var(--text-muted); flex: 1;" id="bulk-count-pickup">선택: 0건</span>
            <button class="btn-small-action" style="padding: 4px 8px; font-size: 13px; background-color: var(--secondary-color); color: white; border: none; min-height: auto;" id="btn-bulk-selected-pickup" onclick="completeSelectedOrders('pickup')" disabled>선택 제공</button>
            <button class="btn-small-action" style="padding: 4px 8px; font-size: 13px; background-color: #3A86C8; color: white; border: none; min-height: auto;" id="btn-bulk-all-pickup" onclick="completeAllOrders('pickup')">모두 제공</button>
          </div>
          <div id="pending-pickup-group" style="display: flex; flex-direction: column; gap: 16px;"></div>
        </div>

        <!-- 배달왔삼 배달 열 -->
        <div class="orders-column">
          <div class="admin-section-title" style="font-size: 18px; color: var(--danger-hover); border-left-color: var(--danger-color); margin-top: 0; padding-left: 10px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
            <span>🛵 배달왔삼 배달</span>
            <span id="delivery-pending-count" class="status-badge" style="background-color: var(--danger-color); border-color: var(--danger-color); color: white; min-width: 30px; padding: 2px 6px;">0건</span>
          </div>
          <!-- 배달왔삼 배달 전용 일괄 처리 바 -->
          <div class="column-bulk-bar" id="bulk-bar-delivery" style="display: flex; gap: 8px; align-items: center; background: #F8F9FA; padding: 8px 12px; border-radius: var(--radius-sm); border: 2.5px solid var(--border-color); margin-bottom: 12px;">
            <span style="font-size: 13px; font-weight: 800; color: var(--text-muted); flex: 1;" id="bulk-count-delivery">선택: 0건</span>
            <button class="btn-small-action" style="padding: 4px 8px; font-size: 13px; background-color: var(--secondary-color); color: white; border: none; min-height: auto;" id="btn-bulk-selected-delivery" onclick="completeSelectedOrders('delivery')" disabled>선택 제공</button>
            <button class="btn-small-action" style="padding: 4px 8px; font-size: 13px; background-color: #3A86C8; color: white; border: none; min-height: auto;" id="btn-bulk-all-delivery" onclick="completeAllOrders('delivery')">모두 제공</button>
          </div>
          <div id="pending-delivery-group" style="display: flex; flex-direction: column; gap: 16px;"></div>
        </div>
      `;

      const pendingKioskContainer = document.getElementById('pending-kiosk-group');
      const pendingPickupContainer = document.getElementById('pending-pickup-group');
      const pendingDeliveryContainer = document.getElementById('pending-delivery-group');
      
      const kioskBadge = document.getElementById('kiosk-pending-count');
      const pickupBadge = document.getElementById('pickup-pending-count');
      const deliveryBadge = document.getElementById('delivery-pending-count');

      if (pendingOrders.length === 0) {
        if (pendingKioskContainer) pendingKioskContainer.innerHTML = '<div class="empty-text" style="padding:15px; font-size:15px;">대기 중인 키오스크 주문이 없습니다. ⏳</div>';
        if (pendingPickupContainer) pendingPickupContainer.innerHTML = '<div class="empty-text" style="padding:15px; font-size:15px;">대기 중인 포장 주문이 없습니다. ⏳</div>';
        if (pendingDeliveryContainer) pendingDeliveryContainer.innerHTML = '<div class="empty-text" style="padding:15px; font-size:15px;">대기 중인 배달 주문이 없습니다. ⏳</div>';
        if (kioskBadge) kioskBadge.textContent = '0건';
        if (pickupBadge) pickupBadge.textContent = '0건';
        if (deliveryBadge) deliveryBadge.textContent = '0건';
      } else {
        const ordersByNo = {};
        pendingOrders.forEach(order => {
          if (!ordersByNo[order.orderNo]) {
            ordersByNo[order.orderNo] = {
              nickname: order.nickname,
              timestamp: order.timestamp,
              orderNo: order.orderNo,
              servedYn: order.servedYn || 'N',
              deliveryType: order.deliveryType || 'pickup',
              authProvider: order.authProvider || '',
              items: []
            };
          }
          ordersByNo[order.orderNo].items.push(order);
        });

        // 주문 시간 순 정렬 (선입선출)
        const sortedOrderGroups = Object.values(ordersByNo).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        // 게스트 주문 판단은 userId를 기준으로 합니다. 일반 키오스크 주문도 deliveryType은 pickup으로 저장될 수 있습니다.
        const isGuestOrder = (g) => {
          const item = g.items[0];
          if (!item) return false;
          return item.userId === 'guest';
        };

        const kioskGroups = sortedOrderGroups.filter(g => !isGuestOrder(g));
        const pickupGroups = sortedOrderGroups.filter(g => isGuestOrder(g) && g.deliveryType === 'pickup');
        const deliveryGroups = sortedOrderGroups.filter(g => isGuestOrder(g) && g.deliveryType === 'delivery');

        if (kioskBadge) kioskBadge.textContent = `${kioskGroups.length}건`;
        if (pickupBadge) pickupBadge.textContent = `${pickupGroups.length}건`;
        if (deliveryBadge) deliveryBadge.textContent = `${deliveryGroups.length}건`;

        if (kioskGroups.length === 0) {
          if (pendingKioskContainer) pendingKioskContainer.innerHTML = '<div class="empty-text" style="padding:15px; font-size:15px;">대기 중인 키오스크 주문이 없습니다. ⏳</div>';
        }
        if (pickupGroups.length === 0) {
          if (pendingPickupContainer) pendingPickupContainer.innerHTML = '<div class="empty-text" style="padding:15px; font-size:15px;">대기 중인 포장 주문이 없습니다. ⏳</div>';
        }
        if (deliveryGroups.length === 0) {
          if (pendingDeliveryContainer) pendingDeliveryContainer.innerHTML = '<div class="empty-text" style="padding:15px; font-size:15px;">대기 중인 배달 주문이 없습니다. ⏳</div>';
        }

        sortedOrderGroups.forEach(group => {
          const rawNickname = String(group.nickname || '');
          const isKakao = group.authProvider === 'kakao';
          let displayNickname = rawNickname;
          if (isKakao) {
            displayNickname = '💬 ' + displayNickname.replace(/ \((체험|비회원)\)/g, '').trim();
          }
          const rawImgUrl = userImageMap[rawNickname] || userImageMap[displayNickname] || '';
          const imgUrl = rawImgUrl ? AppState.convertDriveImageUrl(rawImgUrl) : '';
          const safeNickname = esc(displayNickname);
          const safeInitial = esc(displayNickname.charAt(0) || '?');
          const safeImgUrl = attr(imgUrl);
          
          const colors = ['#FF9F1C', '#2EC4B6', '#118AB2', '#FF5A5F', '#8338EC', '#3A86C8'];
          const colorIndex = Math.abs(displayNickname.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % colors.length;
          const avatarBgColor = colors[colorIndex];
          const orderNoArg = jsString(group.orderNo);

          const avatarHtml = imgUrl 
            ? `<img src="${safeImgUrl}" class="admin-avatar" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="admin-avatar-initial" style="background-color: ${attr(avatarBgColor)}; display: none;">${safeInitial}</div>`
            : `<div class="admin-avatar-initial" style="background-color: ${attr(avatarBgColor)};">${safeInitial}</div>`;

          const itemsListHtml = group.items.map(item => `
            <li>
              <span>${esc(item.snackName)}</span>
              <span><strong>${Number(item.quantity || 0)}개</strong></span>
            </li>
          `).join('');

          const parts = String(group.orderNo || '').split('-');
          let numberPrefix = '';
          if (parts.length >= 3) {
            numberPrefix = `<span style="color: var(--primary-color); font-weight: 900; margin-right: 6px;">[${esc(parts[2])}]</span>`;
          }

          const isKiosk = group.items[0] && group.items[0].userId !== 'guest';
          const isDelivery = !isKiosk && group.deliveryType === 'delivery';
          
          const status = group.servedYn || 'N';
          let statusLabel = '접수중';
          let statusColor = '#3A86C8'; // blue
          let actionBtnHtml = '';
          
          if (status === 'P') {
            statusLabel = '준비중';
            statusColor = 'var(--primary-color)'; // orange
            actionBtnHtml = `<button class="btn-complete-action" style="flex: 1; margin-top: 0; background-color: var(--primary-color); box-shadow: var(--shadow-btn);" onclick="${callAttr(`updateStatusAction(${orderNoArg}, 'R')`)}">${isDelivery ? '🛵 배달 출발' : '🔔 준비 완료'}</button>`;
          } else if (status === 'R') {
            statusLabel = isDelivery ? '배달중' : '준비완료';
            statusColor = 'var(--secondary-hover)'; // green
            actionBtnHtml = `<button class="btn-complete-action" style="flex: 1; margin-top: 0; background-color: var(--secondary-color); box-shadow: var(--shadow-btn-sec);" onclick="${callAttr(`updateStatusAction(${orderNoArg}, 'Y')`)}">${isDelivery ? '📦 배달 완료' : '📦 수령 완료'}</button>`;
          } else {
            // Default: 'N' (접수중)
            actionBtnHtml = `<button class="btn-complete-action" style="flex: 1; margin-top: 0; background-color: #3A86C8; box-shadow: 0 6px 12px rgba(58, 134, 200, 0.25);" onclick="${callAttr(`updateStatusAction(${orderNoArg}, 'P')`)}">☕ 준비 시작</button>`;
          }

          const deliveryBadgeHtml = isKiosk
            ? `<span class="status-badge" style="background-color: var(--primary-color); border-color: var(--primary-color); color: white; font-size: 13px; font-weight: 800;">매점</span>`
            : (isDelivery
                ? `<span class="status-badge" style="background-color: var(--danger-color); border-color: var(--danger-color); color: white; font-size: 13px; font-weight: 800;">배달</span>`
                : `<span class="status-badge" style="background-color: var(--secondary-color); border-color: var(--secondary-color); color: white; font-size: 13px; font-weight: 800;">포장</span>`);

          const deliveryPlaceText = isKiosk
            ? `<div style="font-size: 16px; font-weight: 800; color: var(--primary-hover); margin-top: 4px;">🥡 매점 수령</div>`
            : (isDelivery
                ? ((group.items[0] && group.items[0].deliveryPlace)
                    ? `<div style="font-size: 16px; font-weight: 800; color: #E53935; margin-top: 4px;">📍 배달지: ${esc(group.items[0].deliveryPlace)}</div>`
                    : `<div style="font-size: 16px; font-weight: 800; color: #E53935; margin-top: 4px;">📍 배송지 미입력</div>`)
                : ((group.items[0] && group.items[0].deliveryPlace)
                    ? `<div style="font-size: 16px; font-weight: 800; color: var(--secondary-hover); margin-top: 4px;">📍 수령장소: ${esc(group.items[0].deliveryPlace)}</div>`
                    : `<div style="font-size: 16px; font-weight: 800; color: var(--secondary-hover); margin-top: 4px;">🥡 포장 수령</div>`));

          const safeOrderNo = attr(group.orderNo);
          const checkboxId = `chk-order-${encodeURIComponent(group.orderNo)}`;

          const card = document.createElement('div');
          card.className = 'user-order-card';
          card.setAttribute('data-order-no', group.orderNo);
          card.innerHTML = `
            <div class="user-profile-header">
              ${avatarHtml}
              <span class="user-name">${numberPrefix}${safeNickname} 님</span>
              ${deliveryBadgeHtml}
              <span class="status-badge" style="background-color: ${statusColor}; border-color: ${statusColor}; color: white; font-size: 13px; font-weight: 800;">${statusLabel}</span>
              <span class="order-time-badge">${esc(formatTime(group.timestamp))}</span>
            </div>
            <ul class="user-order-items">
              ${itemsListHtml}
            </ul>
            ${deliveryPlaceText}
            <div class="card-checkbox-wrap">
              <input type="checkbox" class="card-checkbox pending-order-checkbox"
                id="${attr(checkboxId)}"
                data-order-no="${safeOrderNo}"
                onchange="updateBulkSelectionUI()">
              <label class="card-checkbox-label" for="${attr(checkboxId)}">이 주문 선택</label>
            </div>
            <div style="display: flex; gap: 8px; margin-top: 8px; width: 100%;">
              <button class="btn-cancel-action" style="flex: 1;" onclick="${callAttr(`cancelOrderAction(${orderNoArg}, ${jsString(rawNickname)})`)}">주문 취소</button>
              ${actionBtnHtml}
            </div>
          `;

          // 카드 선택 상태 시각화 (체크박스 변경 시)
          card.querySelector('.pending-order-checkbox').addEventListener('change', function() {
            card.classList.toggle('selected', this.checked);
          });

          if (isKiosk) {
            if (pendingKioskContainer) pendingKioskContainer.appendChild(card);
          } else if (isDelivery) {
            if (pendingDeliveryContainer) pendingDeliveryContainer.appendChild(card);
          } else {
            if (pendingPickupContainer) pendingPickupContainer.appendChild(card);
          }
        });
      }

      // 일괄 처리 바 표시 여부 갱신
      updateBulkActionBar(pendingOrders.length > 0);

      // 4. 완료 및 취소된 주문 내역 테이블 렌더링
      const tbody = document.getElementById('order-table-body');
      tbody.innerHTML = '';

      const combinedCompleted = [...completedOrders, ...filteredCanceled];

      if (combinedCompleted.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">오늘 완료/취소된 주문이 없습니다.</td></tr>';
      } else {
        // 최신 완료/취소 주문이 가장 위에 보이도록 정렬
        const sortedCompleted = combinedCompleted.sort((a, b) => {
          const aTime = a.cancelTimestamp ? new Date(a.cancelTimestamp) : new Date(a.timestamp);
          const bTime = b.cancelTimestamp ? new Date(b.cancelTimestamp) : new Date(b.timestamp);
          return bTime - aTime;
        });

        sortedCompleted.forEach(order => {
          const pointVal = order.point || 0;
          const qtyVal = order.quantity || 0;
          const isCanceled = order.servedYn === 'C';

          const isKakao = order.authProvider === 'kakao';
          let displayNickname = order.nickname || '';
          if (isKakao) {
            displayNickname = '💬 ' + displayNickname.replace(/ \((체험|비회원)\)/g, '').trim();
          }

          const isDelivery = order.deliveryType === 'delivery';
          const deliveryBadge = isDelivery
            ? `<span style="background-color: var(--danger-color); color: white; padding: 2px 6px; font-size: 11px; font-weight: 850; border-radius: 4px; margin-left: 6px;">배달</span>`
            : `<span style="background-color: var(--secondary-color); color: white; padding: 2px 6px; font-size: 11px; font-weight: 850; border-radius: 4px; margin-left: 6px;">포장</span>`;
          const deliveryPlaceText = (isDelivery && order.deliveryPlace)
            ? `<div style="font-size: 12px; font-weight: 700; color: #E53935; margin-top: 2px;">📍 ${esc(order.deliveryPlace)}</div>`
            : '';

          const parts = String(order.orderNo || '').split('-');
          let numberPrefix = '';
          if (parts.length >= 3) {
            numberPrefix = `<span style="color: var(--primary-color); font-weight: 800; font-family: monospace; margin-right: 4px;">[${esc(parts[2])}]</span>`;
          }

          const tr = document.createElement('tr');
          const orderNoArg = jsString(order.orderNo);
          
          let rowStyle = '';
          let statusHtml = '';
          if (isCanceled) {
            rowStyle = 'opacity: 0.8; background-color: #fdf2f2;';
            const reasonDetail = order.cancelReason === '기타' && order.cancelReasonDetail ? `<br><span style="font-weight: 500;">상세: ${esc(order.cancelReasonDetail)}</span>` : '';
            statusHtml = `<div style="color: var(--danger-color); font-weight: 800; font-size: 13px; margin-top: 4px;">[상태: 취소]<br>사유: ${esc(order.cancelReason || '사유 없음')}${reasonDetail}</div>`;
          }

          const actionHtml = !isCanceled
            ? `<button class="btn-undo-action" onclick="${callAttr(`undoCompleteOrder(${orderNoArg})`)}">되돌리기</button>`
            : `<span style="color: var(--danger-color); font-weight: 800;">취소됨</span>`;

          tr.style = rowStyle;
          tr.className = 'completed-order-row';
          tr.innerHTML = `
            <td class="completed-time-cell"><strong>${esc(formatTime(isCanceled ? order.cancelTimestamp : order.timestamp))}</strong></td>
            <td class="completed-user-cell">${numberPrefix}${esc(displayNickname)}${deliveryBadge}${deliveryPlaceText}</td>
            <td class="completed-snack-cell">${esc(order.snackName)}${statusHtml}</td>
            <td class="completed-quantity-cell" style="text-align: center; font-weight: 800;">${qtyVal}개</td>
            <td class="completed-points-cell" style="text-align: right; font-weight: 800; color: var(--primary-color);">${esc(AppState.formatPoint(pointVal))}</td>
            <td class="completed-action-cell" style="text-align: center;">${actionHtml}</td>
            <td class="completed-mobile-card">
              <div class="completed-card-header">
                <strong>${esc(formatTime(isCanceled ? order.cancelTimestamp : order.timestamp))}</strong>
                ${numberPrefix}
                <span class="completed-card-user">${esc(displayNickname)}</span>
                ${deliveryBadge}
                ${deliveryPlaceText}
              </div>
              <div class="completed-card-detail">
                <span class="completed-card-snack">${esc(order.snackName)}</span>
                <span class="completed-card-quantity">${qtyVal}개</span>
                ${isCanceled ? `<div class="completed-card-status">[상태: 취소] 사유: ${esc(order.cancelReason || '사유 없음')}${order.cancelReason === '기타' && order.cancelReasonDetail ? ` · 상세: ${esc(order.cancelReasonDetail)}` : ''}</div>` : ''}
              </div>
              <div class="completed-card-action">${actionHtml}</div>
            </td>
          `;
          tbody.appendChild(tr);
        });
      }

      // 5. 오늘 누적 집계 계산 (취소된 주문 제외 활성 주문 기준)
      let totalPoints = 0;
      const snackAggregates = {}; // { snackName: totalQuantity }
      const userAggregates = {}; // { nickname: orderCount }
      const countedDeliveryFee = {}; // { orderNo: true }
      const countedUserOrders = new Set(); // 이용자별 중복 주문번호 방지용 Set

      activeOrders.forEach(order => {
        const pointVal = order.point || 0;
        const qtyVal = order.quantity || 0;
        
        totalPoints += pointVal;

        // 배달비 합산 (주문 건당 1회 적용)
        if (order.deliveryFee && !countedDeliveryFee[order.orderNo]) {
          totalPoints += Number(order.deliveryFee);
          countedDeliveryFee[order.orderNo] = true;
        }

        if (order.snackName) {
          snackAggregates[order.snackName] = (snackAggregates[order.snackName] || 0) + qtyVal;
        }

        if (order.nickname) {
          const cleanNickname = order.nickname.replace(/ \((체험|비회원)\)/g, '').trim();
          const userOrderKey = `${order.orderNo}_${order.nickname}`;
          if (!countedUserOrders.has(userOrderKey)) {
            userAggregates[cleanNickname] = (userAggregates[cleanNickname] || 0) + 1;
            countedUserOrders.add(userOrderKey);
          }
        }
      });

      document.getElementById('stat-total-points').textContent = `❤️ ${totalPoints}`;

      // 오늘 총 주문 건수: 중복되지 않은 고유 orderNo의 총 개수 (취소된 주문 제외 활성 주문 기준)
      const uniqueOrderNos = new Set(activeOrders.map(o => o.orderNo));
      document.getElementById('stat-total-orders').textContent = `${uniqueOrderNos.size}건`;

      // 6. 간식 집계 렌더링
      const snackStatsEl = document.getElementById('snack-stats');
      snackStatsEl.innerHTML = '';
      const sortedSnacks = Object.entries(snackAggregates).sort((a, b) => b[1] - a[1]);
      sortedSnacks.forEach(([name, count]) => {
        const item = document.createElement('div');
        item.className = 'stat-item';
        item.innerHTML = `
          <span class="stat-item-name">${esc(name)}</span>
          <span class="stat-item-val">${count}개</span>
        `;
        snackStatsEl.appendChild(item);
      });

      // 7. 이용자 집계 렌더링
      const userStatsEl = document.getElementById('user-stats');
      userStatsEl.innerHTML = '';
      const sortedUsers = Object.entries(userAggregates).sort((a, b) => b[1] - a[1]);
      sortedUsers.forEach(([name, count]) => {
        const item = document.createElement('div');
        item.className = 'stat-item';
        item.innerHTML = `
          <span class="stat-item-name">${esc(name)} 님</span>
          <span class="stat-item-val" style="color: var(--secondary-hover);">${count}건</span>
        `;
        userStatsEl.appendChild(item);
      });
    }

    function filterDeliveryOrders() {
      if (currentOrders) {
        renderData(currentOrders);
      }
    }

    function updateOrderArchiveHealth(rowCount) {
      const healthEl = document.getElementById('order-archive-health');
      const textEl = document.getElementById('order-archive-health-text');
      if (!healthEl || !textEl) return;

      const count = Number(rowCount);
      healthEl.hidden = true;
      healthEl.className = 'order-archive-health';
      textEl.textContent = '';

      if (!Number.isFinite(count) || count < 100) return;

      const isCritical = count >= 300;
      healthEl.hidden = false;
      healthEl.classList.add(isCritical ? 'is-critical' : 'is-warning');
      textEl.textContent = isCritical
        ? `🔴 주문내역 ${count}행 - 주문보관이 필요합니다.`
        : `⚠️ 주문내역 ${count}행 - 주문보관을 권장합니다.`;
    }

    function csvCell(value) {
      const text = String(value ?? '');
      return `"${text.replace(/"/g, '""')}"`;
    }

    function downloadTodayOrdersCsv() {
      const orders = currentOrders || [];
      if (orders.length === 0) {
        alert('다운로드할 오늘 주문이 없습니다.');
        return;
      }

      const header = ['주문시간', '주문번호', '이용자ID', '이용자', '간식ID', '간식명', '수량', '차감포인트', '제공여부'];
      const rows = orders.map(order => [
        order.timestamp || '',
        order.orderNo || order.orderId || '',
        order.userId || '',
        order.nickname || '',
        order.snackId || '',
        order.snackName || '',
        order.quantity || 0,
        order.point || 0,
        order.servedYn || 'N'
      ]);

      const csv = [header, ...rows]
        .map(row => row.map(csvCell).join(','))
        .join('\r\n');

      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const today = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `orders-${today}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }

    // 타이머 처리 (30초 -> 0초)
    function startRefreshTimer() {
      const timerBar = document.getElementById('timer-bar');
      const refreshText = document.getElementById('refresh-text');
      if (refreshPaused || isModalOpen) {
        if (refreshText) {
          refreshText.textContent = isModalOpen ? '정보 수정 중 (새로고침 일시중지)' : '자동 새로고침 일시정지 중';
        }
        if (timerBar) timerBar.style.width = '0%';
        return;
      }
      
      refreshTimer = setInterval(() => {
        if (refreshPaused || isModalOpen) return;
        refreshSeconds--;
        
        // 텍스트 및 프로그레스바 갱신
        refreshText.textContent = `자동 새로고침 대기 중 (${refreshSeconds}초)`;
        const percentage = ((MAX_REFRESH_TIME - refreshSeconds) / MAX_REFRESH_TIME) * 100;
        timerBar.style.width = `${percentage}%`;

        if (refreshSeconds <= 0) {
          loadAdminData();
        }
      }, 1000);
    }

    function resetRefreshTimer() {
      clearInterval(refreshTimer);
      refreshSeconds = MAX_REFRESH_TIME;
      
      const timerBar = document.getElementById('timer-bar');
      const refreshText = document.getElementById('refresh-text');
      if (timerBar) timerBar.style.width = '0%';
      if (refreshText) {
        if (isModalOpen) {
          refreshText.textContent = '정보 수정 중 (새로고침 일시중지)';
        } else {
          refreshText.textContent = refreshPaused ? '자동 새로고침 일시정지 중' : `자동 새로고침 대기 중 (${MAX_REFRESH_TIME}초)`;
        }
      }
      
      if (!refreshPaused && !isModalOpen) {
        startRefreshTimer();
      }
    }

    function toggleRefreshPause() {
      refreshPaused = !refreshPaused;
      const btn = document.getElementById('btn-toggle-refresh');
      if (btn) {
        btn.textContent = refreshPaused ? '▶ 자동 재개' : '⏸ 일시정지';
      }
      resetRefreshTimer();
      AppState.vibrate(40);
    }

    function toggleGuestSettings() {
      const panel = document.getElementById('guest-ops-settings');
      const button = document.getElementById('btn-toggle-guest-settings');
      if (!panel || !button) return;

      const isExpanded = panel.hidden;
      panel.hidden = !isExpanded;
      button.setAttribute('aria-expanded', String(isExpanded));
      button.textContent = isExpanded ? '⚙ 운영 설정 접기' : '⚙ 운영 설정 펼치기';
    }

    function activateKitchenTab(tabId) {
      document.querySelectorAll('[data-kitchen-tab]').forEach((button) => {
        const isActive = button.dataset.kitchenTab === tabId;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', String(isActive));
      });

      document.querySelectorAll('.kitchen-tab-panel').forEach((panel) => {
        const isActive = panel.id === tabId;
        panel.hidden = !isActive;
        panel.classList.toggle('is-active', isActive);
      });
    }

    // 주문 운영 화면에서는 이용자/간식 추가 및 수정 모달을 사용하지 않습니다.

    // ── 게스트 운영 관리 ────────────────────────────────────────
    let guestOpsCountdown = null;

    async function loadGuestOpsPanel(isAutoRefresh = false) {
      try {
        const res = await fetchAPI('getGuestSettings');
        if (res && res.success) {
          updateGuestOpsUI(res, isAutoRefresh);
        }
      } catch (e) {
        console.warn('게스트 운영 설정 조회 실패:', e);
      }
    }

    function updateGuestOpsUI(data, isAutoRefresh = false) {
      const badge = document.getElementById('guest-ops-status-badge');
      const closeTimeEl = document.getElementById('guest-ops-close-time');
      const remainingEl = document.getElementById('guest-ops-remaining');
      const creditEl = document.getElementById('input-guest-credit');
      const feeEl = document.getElementById('input-guest-fee');
      const deliveryPlaceEl = document.getElementById('input-guest-delivery-place');

      const teamEnabledEl = document.getElementById('input-team-enabled');
      const teamTitleEl = document.getElementById('input-team-title');
      const teamMessageEl = document.getElementById('input-team-message');

      // 자동 새로고침(isAutoRefresh = true)인 경우 관리자가 폼에 타이핑 중인 값을 덮어쓰지 않도록 설정값 필드 업데이트를 생략합니다.
      if (!isAutoRefresh) {
        if (creditEl) creditEl.value = data.guestBaseCredit ?? 10;
        if (feeEl) feeEl.value = data.guestDeliveryFee ?? 3;
        if (deliveryPlaceEl) deliveryPlaceEl.value = data.guestDefaultDeliveryPlace ?? '사무실 원탁';
        
        if (teamEnabledEl) teamEnabledEl.checked = data.todayDeliveryTeamEnabled !== false && String(data.todayDeliveryTeamEnabled).toLowerCase() !== 'false';
        if (teamTitleEl) teamTitleEl.value = data.todayDeliveryTeamTitle || '';
        setTeamMemberInputs(data.todayDeliveryTeamMembers || '');
        if (teamMessageEl) teamMessageEl.value = data.todayDeliveryTeamMessage || '';

        const selectMenuMode = document.getElementById('select-guest-menu-mode');
        const inputEventName = document.getElementById('input-guest-event-name');
        const eventContainer = document.getElementById('event-name-container');
        const emblemContainer = document.getElementById('event-emblem-setting');
        const previewImg = document.getElementById('emblem-preview-img');

        if (selectMenuMode) selectMenuMode.value = data.guestMenuMode || 'normal';
        if (inputEventName) {
          inputEventName.innerHTML = data.guestEventName || '장애인식 개선 캠페인';
          if (typeof enforceEventNameLimit === 'function') enforceEventNameLimit();
        }

        if (data.guestEventEmblemBase64) {
          window.guestEventEmblemBase64 = data.guestEventEmblemBase64;
          if (previewImg) previewImg.src = data.guestEventEmblemBase64;
        } else {
          window.guestEventEmblemBase64 = '';
          if (previewImg) previewImg.src = 'icons/guest-192.png';
        }

        const isEventMode = data.guestMenuMode === 'event';
        if (eventContainer) eventContainer.style.display = isEventMode ? 'flex' : 'none';
        if (emblemContainer) emblemContainer.style.display = isEventMode ? 'flex' : 'none';
      }

      if (guestOpsCountdown) {
        clearInterval(guestOpsCountdown);
        guestOpsCountdown = null;
      }

      if (data.isGuestOpenNow) {
        badge.textContent = '🟢 운영중';
        badge.style.backgroundColor = '#F0FFF4';
        badge.style.borderColor = '#9AE6B4';
        badge.style.color = '#22543D';

        if (data.guestCloseAt) {
          try {
            const closeDate = new Date(data.guestCloseAt);
            const h = String(closeDate.getHours()).padStart(2, '0');
            const m = String(closeDate.getMinutes()).padStart(2, '0');
            closeTimeEl.textContent = `${h}:${m}`;
          } catch (e) {
            closeTimeEl.textContent = '-';
          }
        } else {
          closeTimeEl.textContent = '미설정';
        }

        if (data.remainingSeconds > 0) {
          let remaining = data.remainingSeconds;
          updateGuestOpsTimer(remaining);
          guestOpsCountdown = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
              clearInterval(guestOpsCountdown);
              guestOpsCountdown = null;
              // 자동 마감 전환
              badge.textContent = '🔴 마감';
              badge.style.backgroundColor = '#FFF5F5';
              badge.style.borderColor = '#FEB2B2';
              badge.style.color = '#9B2C2C';
              remainingEl.textContent = '종료됨';
              return;
            }
            updateGuestOpsTimer(remaining);
          }, 1000);
        } else {
          remainingEl.textContent = '-';
        }
      } else {
        badge.textContent = '🔴 마감';
        badge.style.backgroundColor = '#FFF5F5';
        badge.style.borderColor = '#FEB2B2';
        badge.style.color = '#9B2C2C';
        closeTimeEl.textContent = '-';
        remainingEl.textContent = '-';
      }
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

    function normalizeTeamNames(value) {
      return String(value || '')
        .split(',')
        .map(name => name.trim())
        .filter(Boolean);
    }

    function setTeamMemberInputs(membersStr) {
      const deliveryInput = document.getElementById('input-team-delivery-members');
      const prepInput = document.getElementById('input-team-prep-members');
      if (!deliveryInput && !prepInput) return;

      const deliveryNames = [];
      const prepNames = [];
      const fallbackNames = [];

      parseDeliveryTeamMemberGroups(membersStr).forEach(group => {
        const role = String(group.role || '').trim();
        if (role.includes('배달')) {
          deliveryNames.push(...group.names);
        } else if (role.includes('상품') || role.includes('준비') || role.includes('주문')) {
          prepNames.push(...group.names);
        } else {
          fallbackNames.push(...group.names);
        }
      });

      if (deliveryInput) deliveryInput.value = deliveryNames.concat(fallbackNames).join(', ');
      if (prepInput) prepInput.value = prepNames.join(', ');
    }

    function buildRoleSegment(names, role) {
      const normalized = normalizeTeamNames(names);
      if (normalized.length === 0) return '';
      return normalized
        .map((name, index) => index === normalized.length - 1 ? `${name}|${role}` : name)
        .join(', ');
    }

    function getComposedTeamMembers() {
      const deliveryInput = document.getElementById('input-team-delivery-members');
      const prepInput = document.getElementById('input-team-prep-members');
      const deliverySegment = buildRoleSegment(deliveryInput ? deliveryInput.value : '', '배달 담당');
      const prepSegment = buildRoleSegment(prepInput ? prepInput.value : '', '상품 준비 담당');
      return [deliverySegment, prepSegment].filter(Boolean).join(', ');
    }

    function updateGuestOpsTimer(seconds) {
      const min = Math.floor(seconds / 60);
      const sec = seconds % 60;
      document.getElementById('guest-ops-remaining').textContent =
        `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }

    async function handleGuestOpsAction(settingsAction, minutes) {
      try {
        const adminToken = getAdminToken();
        const body = {
          settingsAction,
          adminToken,
          adminMemo: getAdminMemo()
        };
        if (settingsAction === 'openCustom') {
          body.minutes = minutes;
        }
        const res = await fetchAPI('updateGuestSettings', {
          method: 'POST',
          body: body
        });
        if (res && res.success) {
          alert(res.message || '설정이 변경되었습니다.');
        } else {
          clearAdminTokenIfDenied(res);
          alert(res?.message || '설정 변경에 실패했습니다.');
        }
      } catch (e) {
        alert('설정 변경 중 오류가 발생했습니다.');
      }
      // 최신 상태 다시 로드
      await loadGuestOpsPanel();
    }

    async function saveGuestSettings() {
      const creditInput = document.getElementById('input-guest-credit');
      const feeInput = document.getElementById('input-guest-fee');
      const deliveryPlaceInput = document.getElementById('input-guest-delivery-place');
      const teamEnabledInput = document.getElementById('input-team-enabled');
      const teamTitleInput = document.getElementById('input-team-title');
      const teamMessageInput = document.getElementById('input-team-message');
      const selectMenuMode = document.getElementById('select-guest-menu-mode');
      const inputEventName = document.getElementById('input-guest-event-name');

      if (!creditInput || !feeInput || !deliveryPlaceInput) return;

      const guestBaseCredit = Number(creditInput.value);
      const guestDeliveryFee = Number(feeInput.value);
      const guestDefaultDeliveryPlace = deliveryPlaceInput.value.trim();
      const todayDeliveryTeamEnabled = teamEnabledInput ? teamEnabledInput.checked : true;
      const todayDeliveryTeamTitle = teamTitleInput ? teamTitleInput.value.trim() : '';
      const todayDeliveryTeamMembers = getComposedTeamMembers();
      const todayDeliveryTeamMessage = teamMessageInput ? teamMessageInput.value.trim() : '';
      const guestMenuMode = selectMenuMode ? selectMenuMode.value : 'normal';
      const guestEventName = inputEventName ? inputEventName.innerHTML.trim() : '장애인식 개선 캠페인';

      try {
        const adminToken = getAdminToken();
        const res = await fetchAPI('updateGuestSettings', {
          method: 'POST',
          body: {
            settingsAction: 'updateValues',
            guestBaseCredit,
            guestDeliveryFee,
            guestDefaultDeliveryPlace,
            todayDeliveryTeamEnabled,
            todayDeliveryTeamTitle,
            todayDeliveryTeamMembers,
            todayDeliveryTeamMessage,
            guestMenuMode,
            guestEventName,
            guestEventEmblemBase64: window.guestEventEmblemBase64 || '',
            adminToken,
            adminMemo: getAdminMemo()
          }
        });
        if (res && res.success) {
          alert('게스트 설정이 저장되었습니다.');
        } else {
          clearAdminTokenIfDenied(res);
          alert(res?.message || '설정 저장에 실패했습니다.');
        }
      } catch (e) {
        alert('설정 저장 중 오류가 발생했습니다.');
      }
      // 최신 상태 다시 로드
      await loadGuestOpsPanel();
    }

    window.addEventListener('DOMContentLoaded', () => {
      AdminAuth.init({
        onUnlock: () => {
          loadAdminData();
          loadGuestOpsPanel();
        },
        onLock: (options = {}) => {
          if (options.reload !== false) window.location.reload();
        }
      });
      updateAdminTokenStatus();

      // 수동 새로고침 버튼
      const btnManualRefresh = document.getElementById('btn-manual-refresh');
      if (btnManualRefresh) {
        btnManualRefresh.addEventListener('click', () => {
          loadAdminData();
          loadGuestOpsPanel();
          AppState.vibrate(50);
        });
      }

      const btnToggleRefresh = document.getElementById('btn-toggle-refresh');
      if (btnToggleRefresh) {
        btnToggleRefresh.addEventListener('click', () => {
          toggleRefreshPause();
        });
      }

      const btnToggleGuestSettings = document.getElementById('btn-toggle-guest-settings');
      if (btnToggleGuestSettings) {
        btnToggleGuestSettings.addEventListener('click', toggleGuestSettings);
      }

      const selectMenuMode = document.getElementById('select-guest-menu-mode');
      if (selectMenuMode) {
        selectMenuMode.addEventListener('change', () => {
          const eventContainer = document.getElementById('event-name-container');
          const emblemContainer = document.getElementById('event-emblem-setting');
          const isEvent = selectMenuMode.value === 'event';
          if (eventContainer) {
            eventContainer.style.display = isEvent ? 'flex' : 'none';
          }
          if (emblemContainer) {
            emblemContainer.style.display = isEvent ? 'flex' : 'none';
          }
        });
      }

      window.enforceEventNameLimit = function() {
        const el = document.getElementById('input-guest-event-name');
        const counter = document.getElementById('event-name-counter');
        if (!el) return;
        const text = el.textContent || '';
        if (counter) counter.textContent = `${text.length}/20자`;
        if (text.length > 20) {
          if (counter) {
            counter.style.color = '#DC2626';
            counter.textContent = `${text.length}/20자 (초과)`;
          }
        } else if (counter) {
          counter.style.color = 'var(--text-muted)';
        }
      };

      window.formatEventText = function(action, value) {
        const el = document.getElementById('input-guest-event-name');
        if (!el) return;
        el.focus();

        if (action === 'bold') {
          document.execCommand('bold', false, null);
        } else if (action === 'color') {
          document.execCommand('foreColor', false, value);
        } else if (action === 'reset') {
          document.execCommand('removeFormat', false, null);
          const plainText = el.textContent || '';
          el.innerHTML = plainText;
        }
        window.enforceEventNameLimit();
      };

      window.guestEventEmblemBase64 = '';

      window.handleEmblemUpload = function(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
          const img = new Image();
          img.onload = function() {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            const maxSize = 150;

            if (width > height) {
              if (width > maxSize) {
                height *= maxSize / width;
                width = maxSize;
              }
            } else {
              if (height > maxSize) {
                width *= maxSize / height;
                height = maxSize;
              }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const webpBase64 = canvas.toDataURL('image/webp', 0.8);
            window.guestEventEmblemBase64 = webpBase64;
            
            const previewImg = document.getElementById('emblem-preview-img');
            if (previewImg) {
              previewImg.src = webpBase64;
            }
          };
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);
      };

      window.resetGuestEmblem = function() {
        window.guestEventEmblemBase64 = '';
        const previewImg = document.getElementById('emblem-preview-img');
        if (previewImg) {
          previewImg.src = 'icons/guest-192.png';
        }
        document.getElementById('emblem-upload-input').value = '';
      };

      const btnDownloadCsv = document.getElementById('btn-download-csv');
      if (btnDownloadCsv) {
        btnDownloadCsv.addEventListener('click', () => {
          downloadTodayOrdersCsv();
        });
      }

      // 지난 주문 보관 전 읽기 전용 점검
      let archiveAuditPassed = false;
      const btnAuditArchive = document.getElementById('btn-audit-archive');
      if (btnAuditArchive) {
        btnAuditArchive.addEventListener('click', async () => {
          archiveAuditPassed = false;
          const btnArchiveBeforeAudit = document.getElementById('btn-archive-old-orders');
          if (btnArchiveBeforeAudit) {
            btnArchiveBeforeAudit.disabled = true;
            btnArchiveBeforeAudit.textContent = '지난 주문 보관 (점검 필요)';
          }
          try {
            const adminToken = getAdminToken();
            btnAuditArchive.disabled = true;
            btnAuditArchive.textContent = '점검 중... ⏳';
            const res = await fetchAPI('auditArchiveOldOrders', {
              method: 'POST',
              body: { adminToken }
            });
            if (!res || !res.success) {
              clearAdminTokenIfDenied(res);
              alert(res?.message || '보관 점검에 실패했습니다.');
              return;
            }
            const summary = res.summary || {};
            const missing = (summary.missingInArchive || []).join(', ') || '없음';
            const extra = (summary.extraInArchive || []).join(', ') || '없음';
            const samples = (summary.sampleDuplicateKeys || []).join(', ') || '없음';
            archiveAuditPassed = summary.headersEqual === true
              && Number(summary.duplicateArchiveKeys || 0) === 0
              && Number(summary.orderRowsWithoutKey || 0) === 0
              && Number(summary.archiveRowsWithoutKey || 0) === 0;
            alert([
              '보관 전 점검 완료 (시트 변경 없음)',
              `주문내역: ${summary.orderRows || 0}행 / ${summary.orderColumns || 0}열`,
              `주문보관: ${summary.archiveRows || 0}행 / ${summary.archiveColumns || 0}열`,
              `양쪽 중복 주문 키: ${summary.overlapKeys || 0}개`,
              `보관 시트 내부 중복 키: ${summary.duplicateArchiveKeys || 0}개`,
              `주문내역에만 있는 키: ${summary.orderOnlyKeys || 0}개`,
              `보관 시트에만 있는 키: ${summary.archiveOnlyKeys || 0}개`,
              `보관 시트에 없는 헤더: ${missing}`,
              `보관 시트에만 있는 헤더: ${extra}`,
              `중복 예시: ${samples}`,
              `보관 실행 가능: ${archiveAuditPassed ? '예' : '아니오'}`
            ].join('\n'));
            if (btnArchiveBeforeAudit && archiveAuditPassed) {
              btnArchiveBeforeAudit.disabled = false;
              btnArchiveBeforeAudit.textContent = '지난 주문 보관 📁';
            }
          } catch (e) {
            console.error(e);
            alert(e.message || '보관 점검 중 오류가 발생했습니다.');
          } finally {
            btnAuditArchive.disabled = false;
            btnAuditArchive.textContent = '🔎 보관 점검';
            if (btnArchiveBeforeAudit && !archiveAuditPassed) {
              btnArchiveBeforeAudit.disabled = true;
              btnArchiveBeforeAudit.textContent = '지난 주문 보관 (점검 필요)';
            }
          }
        });
      }

      // 지난 주문 보관 버튼 바인딩
      const btnArchive = document.getElementById('btn-archive-old-orders');
      if (btnArchive) {
        btnArchive.addEventListener('click', async () => {
          if (!confirm('오늘 이전의 지난 모든 주문을 보관함으로 이동하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) {
            return;
          }
          const rawConfirm = prompt('보관을 진행하려면 아래 확인 문구 중 하나를 입력하세요:\n• 주문보관확인\n• 지난주문보관');
          const archiveConfirm = String(rawConfirm || '').trim();
          const validPhrases = ['주문보관확인', '지난주문보관', '지난주문 보관', '보관확인'];
          if (!validPhrases.includes(archiveConfirm)) {
            alert('확인 문구가 일치하지 않아 보관을 취소했습니다.');
            return;
          }
          try {
            const adminToken = getAdminToken();
            const adminMemo = getAdminMemo();
            btnArchive.disabled = true;
            btnArchive.textContent = '보관 중... ⏳';
            
            const res = await fetchAPI('archiveOldOrders', {
              method: 'POST',
              body: {
                adminToken,
                adminMemo,
                archiveConfirm
              }
            });
            
            if (res && res.success) {
              alert(res.message || '지난 주문 보관이 완료되었습니다.');
              archiveAuditPassed = false;
              loadAdminData(); // 데이터 새로고침
            } else {
              clearAdminTokenIfDenied(res);
              alert(res?.message || '지난 주문 보관에 실패했습니다.');
              btnArchive.disabled = !archiveAuditPassed;
            }
          } catch (e) {
            console.error(e);
            alert(e.message || '지난 주문 보관 중 오류가 발생했습니다.');
          } finally {
            btnArchive.disabled = !archiveAuditPassed;
            btnArchive.textContent = archiveAuditPassed ? '지난 주문 보관 📁' : '지난 주문 보관 (점검 필요)';
          }
        });
      }



      // 게스트 운영 관리 버튼 바인딩
      const btnGuestOpen20 = document.getElementById('btn-guest-open20');
      if (btnGuestOpen20) {
        btnGuestOpen20.addEventListener('click', () => {
          handleGuestOpsAction('open20');
        });
      }
      
      const btnGuestOpen30 = document.getElementById('btn-guest-open30');
      if (btnGuestOpen30) {
        btnGuestOpen30.addEventListener('click', () => {
          handleGuestOpsAction('open30');
        });
      }

      const btnGuestOpen60 = document.getElementById('btn-guest-open60');
      if (btnGuestOpen60) {
        btnGuestOpen60.addEventListener('click', () => {
          handleGuestOpsAction('open60');
        });
      }

      const btnGuestOpenCustom = document.getElementById('btn-guest-open-custom');
      if (btnGuestOpenCustom) {
        btnGuestOpenCustom.addEventListener('click', () => {
          const inputEl = document.getElementById('input-custom-minutes');
          const minutes = inputEl ? Number(inputEl.value) : 10;
          if (isNaN(minutes) || minutes <= 0) {
            alert('올바른 시간을 분 단위로 입력해 주세요.');
            return;
          }
          handleGuestOpsAction('openCustom', minutes);
        });
      }
      
      const btnGuestClose = document.getElementById('btn-guest-close');
      if (btnGuestClose) {
        btnGuestClose.addEventListener('click', () => {
          if (confirm('게스트 주문을 즉시 마감하시겠습니까?')) {
            handleGuestOpsAction('closeNow');
          }
        });
      }

      const btnEnableSound = document.getElementById('btnEnableSound');
      if (btnEnableSound) {
        btnEnableSound.addEventListener('click', toggleNewOrderSound);
        updateSoundToggleButton();
      }

      document.querySelectorAll('[data-kitchen-tab]').forEach((button) => {
        button.addEventListener('click', () => {
          activateKitchenTab(button.dataset.kitchenTab);
        });
      });
    });
