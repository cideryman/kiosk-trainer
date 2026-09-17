/**
 * settings.js - 통합 운영 설정 전용 스크립트 (P120)
 * 키오스크 주문 제한, 배달왔삼 정기/추가/긴급 일정, 당일 정원 및 배달 지역, 기본 설정 통합 관리
 */
(() => {
  'use strict';

  let latestGuestOpsSettings = null;

  function getAdminToken() {
    if (typeof AdminAuth !== 'undefined' && typeof AdminAuth.getToken === 'function') {
      const token = AdminAuth.getToken();
      if (token) return token;
    }
    return String(sessionStorage.getItem('kioskAdminToken') || sessionStorage.getItem('adminToken') || '').trim();
  }

  function requireAdminToken() {
    const token = getAdminToken();
    if (!token) {
      if (typeof AdminAuth !== 'undefined' && typeof AdminAuth.focus === 'function') {
        AdminAuth.focus('상단에서 관리자 잠금을 먼저 해제해 주세요.');
      } else {
        alert('상단에서 관리자 잠금을 먼저 해제해 주세요.');
      }
      throw new Error('관리자 잠금 해제가 필요합니다.');
    }
    return token;
  }

  function clearAdminTokenIfDenied(res) {
    if (typeof AdminAuth !== 'undefined' && typeof AdminAuth.handleDenied === 'function') {
      AdminAuth.handleDenied(res);
    }
  }

  function getAdminMemo() {
    return '운영 설정 화면에서 저장';
  }

  function formatGuestScheduleDate(dateKey) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return '-';
    const date = new Date(`${dateKey}T00:00:00+09:00`);
    if (isNaN(date.getTime())) return dateKey;
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short'
    }).format(date);
  }

  function getGuestKstDateTimeParts(dateObj = new Date()) {
    const formatter = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(dateObj);
    const getVal = type => parts.find(p => p.type === type)?.value || '';
    return {
      date: `${getVal('year')}-${getVal('month')}-${getVal('day')}`,
      time: `${getVal('hour')}:${getVal('minute')}`
    };
  }

  function getDefaultGuestManualEndTime() {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const parts = getGuestKstDateTimeParts(future);
    if (parts.date !== getGuestKstDateTimeParts().date) return '23:59';
    const [hour, minute] = parts.time.split(':').map(Number);
    const roundedMinutes = Math.min(23 * 60 + 59, hour * 60 + Math.ceil(minute / 5) * 5);
    return `${String(Math.floor(roundedMinutes / 60)).padStart(2, '0')}:${String(roundedMinutes % 60).padStart(2, '0')}`;
  }

  function setButtonLoading(button, isLoading, loadingText = '⏳ 저장 중...') {
    if (!button) return;
    if (isLoading) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.classList.add('is-loading');
      button.setAttribute('aria-busy', 'true');
      button.textContent = loadingText;
    } else {
      button.disabled = false;
      button.classList.remove('is-loading');
      button.removeAttribute('aria-busy');
      if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
      }
    }
  }

  function setButtonSuccess(button, text = '✓ 저장 완료', durationMs = 1500) {
    if (!button) return;
    button.disabled = true;
    button.classList.add('is-success');
    button.textContent = text;
    setTimeout(() => {
      button.disabled = false;
      button.classList.remove('is-success');
      if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
      }
    }, durationMs);
  }
  window.setButtonSuccess = setButtonSuccess;

  // P129 보완: 백그라운드 동기화 실패 시 안내 배너
  function backgroundReload(reloadFn) {
    reloadFn().catch(err => {
      console.error('Background reload error:', err);
      showSyncFailBanner();
    });
  }

  function showSyncFailBanner() {
    if (document.getElementById('sync-fail-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'sync-fail-banner';
    banner.className = 'sync-fail-banner';
    banner.innerHTML = '⚠ 최신 상태를 확인하지 못했습니다. <button onclick="this.parentElement.remove(); loadAllSettings();">새로고침</button>';
    const main = document.querySelector('.settings-main, main, .content-wrapper');
    if (main) main.prepend(banner);
    else document.body.prepend(banner);
  }

  // --- 1. 키오스크 주문 정책 선택 ---
  function setKioskOrderPolicy(policy) {
    const normalized = ['once_daily', 'cooldown', 'unlimited'].includes(String(policy).toLowerCase())
      ? String(policy).toLowerCase()
      : 'once_daily';
    const inputEl = document.getElementById('input-kiosk-order-policy');
    const cooldownContainer = document.getElementById('kiosk-cooldown-container');

    if (inputEl) inputEl.value = normalized;
    if (cooldownContainer) {
      cooldownContainer.style.display = normalized === 'cooldown' ? 'flex' : 'none';
      if (normalized === 'cooldown') {
        const minutesInput = document.getElementById('input-kiosk-cooldown-minutes');
        if (minutesInput && document.activeElement !== minutesInput) {
          setTimeout(() => minutesInput.focus(), 60);
        }
      }
    }
    document.querySelectorAll('[data-kiosk-order-policy]').forEach(btn => {
      const isActive = btn.dataset.kioskOrderPolicy === normalized;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-checked', String(isActive));
      btn.setAttribute('aria-pressed', String(isActive));
    });
  }

  // --- 2. 랜덤 닉네임 세그먼트 ---
  function setGuestRandomDisplayName(allow) {
    const isAllow = allow !== false;
    const inputEl = document.getElementById('input-guest-random-display-name');
    if (inputEl) inputEl.value = String(isAllow);
    document.querySelectorAll('[data-guest-random-name]').forEach(btn => {
      const isActive = btn.dataset.guestRandomName === String(isAllow);
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
  }

  // --- 3. 추가 일정 목록 렌더링 ---
  function renderAdditionalSchedules(schedules) {
    const container = document.getElementById('guest-additional-schedule-list');
    if (!container) return;
    container.innerHTML = '';
    if (!Array.isArray(schedules) || schedules.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; padding: 6px 0;">등록된 특별 추가 일정이 없습니다.</div>';
      return;
    }

    schedules.forEach(schedule => {
      const item = document.createElement('div');
      item.className = 'guest-additional-schedule-item';
      item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; margin-top: 6px;';
      
      const info = document.createElement('div');
      info.innerHTML = `<strong>${formatGuestScheduleDate(schedule.date)}</strong> <span style="color: #0F766E; font-weight: 700;">${schedule.startTime} ~ ${schedule.endTime}</span>`;
      
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-danger-action';
      delBtn.style.padding = '4px 10px';
      delBtn.style.fontSize = '12px';
      delBtn.textContent = '일정 취소';
      delBtn.onclick = () => deleteGuestAdditionalScheduleAction(schedule, delBtn);

      item.appendChild(info);
      item.appendChild(delBtn);
      container.appendChild(item);
    });
  }

  // --- 4. 데이터 로드 ---
  async function loadAllSettings() {
    try {
      const res = typeof fetchAPIReadWithRetry === 'function'
        ? await fetchAPIReadWithRetry('getGuestSettings')
        : await fetchAPI('getGuestSettings');
      if (!res || !res.success) return;
      latestGuestOpsSettings = res;

      // 1. 키오스크 주문 정책
      setKioskOrderPolicy(res.kioskOrderPolicy || 'once_daily');
      const cooldownEl = document.getElementById('input-kiosk-cooldown-minutes');
      if (cooldownEl) cooldownEl.value = res.kioskCooldownMinutes || 60;

      // 2. 정기 일정
      const weeklyEnabledEl = document.getElementById('input-guest-weekly-schedule-enabled');
      const weeklyDayEl = document.getElementById('input-guest-weekly-schedule-day');
      const weeklyStartEl = document.getElementById('input-guest-weekly-schedule-start');
      const weeklyEndEl = document.getElementById('input-guest-weekly-schedule-end');
      if (weeklyEnabledEl) weeklyEnabledEl.checked = res.guestWeeklyScheduleEnabled === true;
      if (weeklyDayEl) weeklyDayEl.value = String(res.guestWeeklyScheduleDay || 3);
      if (weeklyStartEl) weeklyStartEl.value = res.guestWeeklyScheduleStartTime || '13:00';
      if (weeklyEndEl) weeklyEndEl.value = res.guestWeeklyScheduleEndTime || '15:00';

      const sourceEl = document.getElementById('guest-ops-source');
      const nextOpenEl = document.getElementById('guest-ops-next-open');
      const warningEl = document.getElementById('guest-weekly-schedule-warning');
      const skipBtn = document.getElementById('btn-toggle-guest-weekly-skip');

      if (sourceEl) {
        const labels = { weekly: '정기 자동 운영', additional: '추가 운영', manual: '긴급 운영', closed: '마감' };
        sourceEl.textContent = labels[res.guestOpenSource] || '마감';
      }
      if (nextOpenEl) {
        const next = res.nextGuestSchedule;
        nextOpenEl.textContent = next ? `${formatGuestScheduleDate(next.date)} ${next.startTime}~${next.endTime}` : '-';
      }
      if (warningEl) {
        if (res.guestWeeklyScheduleSkipped) {
          warningEl.textContent = `${formatGuestScheduleDate(res.guestWeeklyScheduleTargetDate)} 운영을 쉬도록 설정했습니다.`;
          warningEl.hidden = false;
        } else {
          warningEl.textContent = '';
          warningEl.hidden = true;
        }
      }
      if (skipBtn) {
        const isEnabled = res.guestWeeklyScheduleEnabled === true;
        const isSkipped = res.guestWeeklyScheduleSkipped === true;
        skipBtn.disabled = !isEnabled;
        skipBtn.dataset.scheduleAction = isSkipped ? 'resumeWeeklyScheduleOccurrence' : 'skipWeeklyScheduleOccurrence';
        skipBtn.textContent = isSkipped
          ? `${formatGuestScheduleDate(res.guestWeeklyScheduleTargetDate)} 운영 재개`
          : `${formatGuestScheduleDate(res.guestWeeklyScheduleTargetDate)} 이번 회차 운영 안 함`;
        skipBtn.classList.toggle('is-resume', isSkipped);
      }

      // 추가 일정 날짜 기본값
      const additionalDateEl = document.getElementById('input-guest-additional-date');
      const todayKey = getGuestKstDateTimeParts().date;
      if (additionalDateEl) {
        additionalDateEl.min = todayKey;
        if (!additionalDateEl.value) additionalDateEl.value = todayKey;
      }
      renderAdditionalSchedules(res.guestAdditionalSchedules);

      // 긴급 운영 종료 시각 기본값
      const manualEndEl = document.getElementById('input-guest-manual-end');
      if (manualEndEl && !manualEndEl.value) {
        manualEndEl.value = getDefaultGuestManualEndTime();
      }

      // 3. 당일 정원 및 배달 설정
      const maxOrderEl = document.getElementById('input-guest-max-order-count');
      const maxDeliveryEl = document.getElementById('input-guest-max-delivery-count');
      const deliveryAreaEl = document.getElementById('input-guest-delivery-area');
      if (maxOrderEl) maxOrderEl.value = res.guestMaxOrderCount ?? 5;
      if (maxDeliveryEl) maxDeliveryEl.value = res.guestMaxDeliveryCount ?? 2;
      if (deliveryAreaEl) deliveryAreaEl.value = res.guestDeliveryArea || '영주시 동 지역 (가흥동, 영주동, 휴천동 등)';

      // 4. 서비스 기본 및 담당자
      const creditEl = document.getElementById('input-guest-credit');
      const feeEl = document.getElementById('input-guest-fee');
      const deliveryPlaceEl = document.getElementById('input-guest-delivery-place');
      if (creditEl) creditEl.value = res.guestBaseCredit ?? 10;
      if (feeEl) feeEl.value = res.guestDeliveryFee ?? 3;
      if (deliveryPlaceEl) deliveryPlaceEl.value = res.guestDefaultDeliveryPlace ?? '사무실 원탁';
      setGuestRandomDisplayName(res.guestAllowRandomDisplayName !== false);

      const teamEnabledEl = document.getElementById('input-team-enabled');
      const teamTitleEl = document.getElementById('input-team-title');
      const teamMessageEl = document.getElementById('input-team-message');
      if (teamEnabledEl) teamEnabledEl.checked = res.todayDeliveryTeamEnabled !== false && String(res.todayDeliveryTeamEnabled).toLowerCase() !== 'false';
      if (teamTitleEl) teamTitleEl.value = res.todayDeliveryTeamTitle || '삼각지 배달팀';
      if (teamMessageEl) teamMessageEl.value = res.todayDeliveryTeamMessage || '달곰이들이 정성껏 준비하고 배달합니다';

      const members = String(res.todayDeliveryTeamMembers || '').split(',').map(m => m.trim());
      for (let i = 1; i <= 3; i++) {
        const input = document.getElementById(`input-team-member-${i}`);
        if (input) input.value = members[i - 1] || '';
      }

      // 5) 행사 모드 및 이메일 알림 바인딩
      const eventModeEl = document.getElementById('input-guest-menu-mode-event');
      const eventDetailsContainer = document.getElementById('event-mode-details-container');
      const eventNameEl = document.getElementById('input-guest-event-name');
      const eventEmblemBase64Input = document.getElementById('input-guest-event-emblem-base64');
      const emblemPreviewImg = document.getElementById('preview-guest-event-emblem');
      const emailNotiEl = document.getElementById('input-admin-order-email-notification');

      const isEvent = res.guestMenuMode === 'event';
      if (eventModeEl) eventModeEl.checked = isEvent;
      if (eventDetailsContainer) eventDetailsContainer.style.display = isEvent ? 'flex' : 'none';
      if (eventNameEl) eventNameEl.value = res.guestEventName || '장애인식 개선 캠페인';
      
      const emblemData = res.guestEventEmblemBase64 || '';
      if (eventEmblemBase64Input) eventEmblemBase64Input.value = emblemData;
      if (emblemPreviewImg) {
        emblemPreviewImg.src = emblemData || 'icons/배달왔삼.png';
      }

      if (emailNotiEl) {
        emailNotiEl.checked = res.adminOrderEmailNotificationEnabled !== false && String(res.adminOrderEmailNotificationEnabled).toLowerCase() !== 'false';
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  }

  // --- 5. 전체 설정 페이로드 빌더 (부분 저장 시 기존 설정 누락 방지) ---
  function buildFullUpdateValuesPayload(overrides = {}) {
    const s = latestGuestOpsSettings || {};

    const creditEl = document.getElementById('input-guest-credit');
    const feeEl = document.getElementById('input-guest-fee');
    const placeEl = document.getElementById('input-guest-delivery-place');
    const maxOrderEl = document.getElementById('input-guest-max-order-count');
    const maxDeliveryEl = document.getElementById('input-guest-max-delivery-count');
    const deliveryAreaEl = document.getElementById('input-guest-delivery-area');
    const randomEl = document.getElementById('input-guest-random-display-name');
    const policyInput = document.getElementById('input-kiosk-order-policy');
    const cooldownInput = document.getElementById('input-kiosk-cooldown-minutes');
    const teamEnabledEl = document.getElementById('input-team-enabled');
    const teamTitleEl = document.getElementById('input-team-title');
    const teamMessageEl = document.getElementById('input-team-message');
    const eventModeEl = document.getElementById('input-guest-menu-mode-event');
    const eventNameEl = document.getElementById('input-guest-event-name');
    const eventEmblemInput = document.getElementById('input-guest-event-emblem-base64');
    const emailNotiEl = document.getElementById('input-admin-order-email-notification');

    const members = [1, 2, 3]
      .map(i => document.getElementById(`input-team-member-${i}`)?.value?.trim())
      .filter(Boolean)
      .join(', ');

    const guestMenuMode = eventModeEl ? (eventModeEl.checked ? 'event' : 'normal') : (s.guestMenuMode || 'normal');
    const guestEventName = eventNameEl ? (eventNameEl.value.trim() || '장애인식 개선 캠페인') : (s.guestEventName || '장애인식 개선 캠페인');
    const guestEventEmblemBase64 = eventEmblemInput ? eventEmblemInput.value : (s.guestEventEmblemBase64 || '');
    const adminOrderEmailNotificationEnabled = emailNotiEl ? emailNotiEl.checked : (s.adminOrderEmailNotificationEnabled !== false);

    const payload = {
      settingsAction: 'updateValues',
      guestBaseCredit: creditEl ? (Number(creditEl.value) || 10) : (s.guestBaseCredit ?? 10),
      guestDeliveryFee: feeEl ? (Number(feeEl.value) || 3) : (s.guestDeliveryFee ?? 3),
      guestDefaultDeliveryPlace: placeEl ? (placeEl.value.trim() || '사무실 원탁') : (s.guestDefaultDeliveryPlace || '사무실 원탁'),
      guestMaxOrderCount: maxOrderEl ? Math.max(1, Number(maxOrderEl.value) || 5) : (s.guestMaxOrderCount ?? 5),
      guestMaxDeliveryCount: maxDeliveryEl ? Math.max(0, Number(maxDeliveryEl.value) || 0) : (s.guestMaxDeliveryCount ?? 2),
      guestDeliveryArea: deliveryAreaEl ? (deliveryAreaEl.value.trim() || '영주시 동 지역 (가흥동, 영주동, 휴천동 등)') : (s.guestDeliveryArea || '영주시 동 지역 (가흥동, 영주동, 휴천동 등)'),
      guestAllowRandomDisplayName: randomEl ? (randomEl.value === 'true') : (s.guestAllowRandomDisplayName !== false),
      adminOrderEmailNotificationEnabled,
      kioskOrderPolicy: policyInput ? policyInput.value : (s.kioskOrderPolicy || 'once_daily'),
      kioskCooldownMinutes: cooldownInput ? Math.max(1, Number(cooldownInput.value) || 60) : (s.kioskCooldownMinutes || 60),
      todayDeliveryTeamEnabled: teamEnabledEl ? teamEnabledEl.checked : (s.todayDeliveryTeamEnabled !== false),
      todayDeliveryTeamTitle: teamTitleEl ? teamTitleEl.value.trim() : (s.todayDeliveryTeamTitle || '📦 오늘의 배달팀'),
      todayDeliveryTeamMembers: members || (s.todayDeliveryTeamMembers || ''),
      todayDeliveryTeamMessage: teamMessageEl ? teamMessageEl.value.trim() : (s.todayDeliveryTeamMessage || ''),
      guestMenuMode,
      guestEventName,
      guestEventEmblemBase64,
      adminToken: getAdminToken(),
      adminMemo: getAdminMemo(),
      ...overrides
    };

    return payload;
  }

  // --- 6. 저장 액션들 ---

  // 1) 키오스크 주문 제한 저장
  window.saveKioskPolicyAction = async () => {
    const btn = document.getElementById('btn-save-kiosk-policy');
    const policyInput = document.getElementById('input-kiosk-order-policy');
    const cooldownInput = document.getElementById('input-kiosk-cooldown-minutes');
    const policy = policyInput ? policyInput.value : 'once_daily';
    const cooldown = cooldownInput ? Math.max(1, Number(cooldownInput.value) || 60) : 60;

    try {
      requireAdminToken();
    } catch (_) {
      return;
    }

    setButtonLoading(btn, true);
    let isSuccess = false;
    try {
      const payload = buildFullUpdateValuesPayload({
        kioskOrderPolicy: policy,
        kioskCooldownMinutes: cooldown
      });
      const res = await fetchAPI('updateGuestSettings', {
        method: 'POST',
        body: payload
      });
      if (res?.success) {
        isSuccess = true;
        if (!latestGuestOpsSettings) latestGuestOpsSettings = {};
        Object.assign(latestGuestOpsSettings, payload);
      } else {
        clearAdminTokenIfDenied(res);
        alert(res?.message || '저장에 실패했습니다.');
      }
    } catch (e) {
      alert('오류가 발생했습니다: ' + (e.message || '네트워크 오류'));
    } finally {
      setButtonLoading(btn, false);
      if (isSuccess) {
        setButtonSuccess(btn, '✓ 저장 완료');
      }
    }
  };

  // 2-1) 정기 일정 저장
  window.saveGuestWeeklyScheduleAction = async () => {
    const btn = document.getElementById('btn-save-guest-weekly-schedule');
    const enabledEl = document.getElementById('input-guest-weekly-schedule-enabled');
    const dayEl = document.getElementById('input-guest-weekly-schedule-day');
    const startEl = document.getElementById('input-guest-weekly-schedule-start');
    const endEl = document.getElementById('input-guest-weekly-schedule-end');

    const startTime = String(startEl?.value || '').trim();
    const endTime = String(endEl?.value || '').trim();
    if (!startTime || !endTime || startTime >= endTime) {
      alert('종료 시각을 시작 시각보다 늦게 설정해 주세요.');
      return;
    }

    try {
      requireAdminToken();
    } catch (_) {
      return;
    }

    setButtonLoading(btn, true);
    let isSuccess = false;
    try {
      const res = await fetchAPI('updateGuestSettings', {
        method: 'POST',
        body: {
          settingsAction: 'updateWeeklySchedule',
          guestWeeklyScheduleEnabled: enabledEl?.checked === true,
          guestWeeklyScheduleDay: Number(dayEl?.value || 3),
          guestWeeklyScheduleStartTime: startTime,
          guestWeeklyScheduleEndTime: endTime,
          adminToken: getAdminToken(),
          adminMemo: getAdminMemo()
        }
      });
      if (res?.success) {
        isSuccess = true;
        backgroundReload(loadAllSettings);
      } else {
        clearAdminTokenIfDenied(res);
        alert(res?.message || '저장에 실패했습니다.');
      }
    } catch (e) {
      alert('오류가 발생했습니다: ' + (e.message || '네트워크 오류'));
    } finally {
      setButtonLoading(btn, false);
      if (isSuccess) {
        setButtonSuccess(btn, '✓ 저장 완료');
      }
    }
  };

  // 2-2) 이번 회차 건너뛰기 / 재개
  window.toggleGuestWeeklyScheduleSkipAction = async () => {
    const btn = document.getElementById('btn-toggle-guest-weekly-skip');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.scheduleAction || 'skipWeeklyScheduleOccurrence';
    const isResume = action === 'resumeWeeklyScheduleOccurrence';
    const promptMsg = isResume ? '이번 회차 정기 운영을 다시 진행할까요?' : '이번 회차 정기 운영을 건너뛰고 쉴까요?';
    if (!confirm(promptMsg)) return;

    try {
      requireAdminToken();
    } catch (_) {
      return;
    }

    setButtonLoading(btn, true, isResume ? '⏳ 재개 중...' : '⏳ 중단 중...');
    let isSuccess = false;
    try {
      const res = await fetchAPI('updateGuestSettings', {
        method: 'POST',
        body: {
          settingsAction: action,
          adminToken: getAdminToken(),
          adminMemo: getAdminMemo()
        }
      });
      if (res?.success) {
        isSuccess = true;
        backgroundReload(loadAllSettings);
      } else {
        clearAdminTokenIfDenied(res);
        alert(res?.message || '실패했습니다.');
      }
    } catch (e) {
      alert('오류가 발생했습니다: ' + (e.message || '네트워크 오류'));
    } finally {
      setButtonLoading(btn, false);
      if (isSuccess) {
        setButtonSuccess(btn, isResume ? '✓ 재개 완료' : '✓ 중단 완료');
      }
    }
  };

  // 2-3) 추가 일정 등록
  window.addGuestAdditionalScheduleAction = async () => {
    const btn = document.getElementById('btn-add-guest-additional-schedule');
    const dateEl = document.getElementById('input-guest-additional-date');
    const startEl = document.getElementById('input-guest-additional-start');
    const endEl = document.getElementById('input-guest-additional-end');

    const date = String(dateEl?.value || '').trim();
    const startTime = String(startEl?.value || '').trim();
    const endTime = String(endEl?.value || '').trim();

    if (!date || !startTime || !endTime || startTime >= endTime) {
      alert('날짜를 선택하고 종료 시각을 시작 시각보다 늦게 입력해 주세요.');
      return;
    }

    try {
      requireAdminToken();
    } catch (_) {
      return;
    }

    setButtonLoading(btn, true, '⏳ 등록 중...');
    let isSuccess = false;
    try {
      const res = await fetchAPI('updateGuestSettings', {
        method: 'POST',
        body: {
          settingsAction: 'upsertAdditionalSchedule',
          date,
          startTime,
          endTime,
          adminToken: getAdminToken(),
          adminMemo: getAdminMemo()
        }
      });
      if (res?.success) {
        isSuccess = true;
        backgroundReload(loadAllSettings);
      } else {
        clearAdminTokenIfDenied(res);
        alert(res?.message || '등록 실패');
      }
    } catch (e) {
      alert('오류가 발생했습니다: ' + (e.message || '네트워크 오류'));
    } finally {
      setButtonLoading(btn, false);
      if (isSuccess) {
        setButtonSuccess(btn, '✓ 등록 완료');
      }
    }
  };

  // 2-4) 추가 일정 삭제
  async function deleteGuestAdditionalScheduleAction(schedule, button) {
    if (!schedule?.scheduleId) return;
    if (!confirm(`${formatGuestScheduleDate(schedule.date)} ${schedule.startTime}~${schedule.endTime} 일정을 취소할까요?`)) return;

    try {
      requireAdminToken();
    } catch (_) {
      return;
    }

    setButtonLoading(button, true, '⏳ 취소 중...');
    let isSuccess = false;
    try {
      const res = await fetchAPI('updateGuestSettings', {
        method: 'POST',
        body: {
          settingsAction: 'deleteAdditionalSchedule',
          scheduleId: schedule.scheduleId,
          adminToken: getAdminToken(),
          adminMemo: getAdminMemo()
        }
      });
      if (res?.success) {
        isSuccess = true;
        backgroundReload(loadAllSettings);
      } else {
        clearAdminTokenIfDenied(res);
        alert(res?.message || '취소 실패');
      }
    } catch (e) {
      alert('오류가 발생했습니다: ' + (e.message || '네트워크 오류'));
    } finally {
      setButtonLoading(button, false);
      if (isSuccess) {
        setButtonSuccess(button, '✓ 취소 완료');
      }
    }
  }

  // 2-5) 오늘 긴급 운영 (지금부터 운영)
  window.guestEmergencyOpenUntilAction = async () => {
    const btn = document.getElementById('btn-guest-open-until') || document.getElementById('btn-guest-emergency-open-until');
    const endEl = document.getElementById('input-guest-manual-end') || document.getElementById('input-guest-emergency-end');
    const endTime = String(endEl?.value || '').trim();

    if (!endTime) {
      alert('운영 종료 시각을 선택해 주세요.');
      return;
    }
    if (!confirm(`지금부터 오늘 ${endTime}까지 배달왔삼 주문을 받을까요?`)) return;

    try {
      requireAdminToken();
    } catch (_) {
      return;
    }

    setButtonLoading(btn, true, '⏳ 오픈 중...');
    let isSuccess = false;
    try {
      const res = await fetchAPI('updateGuestSettings', {
        method: 'POST',
        body: {
          settingsAction: 'openUntil',
          guestManualEndTime: endTime,
          adminToken: getAdminToken(),
          adminMemo: getAdminMemo()
        }
      });
      if (res?.success) {
        isSuccess = true;
        backgroundReload(loadAllSettings);
      } else {
        clearAdminTokenIfDenied(res);
        alert(res?.message || '오픈 실패');
      }
    } catch (e) {
      alert('오류가 발생했습니다: ' + (e.message || '네트워크 오류'));
    } finally {
      setButtonLoading(btn, false);
      if (isSuccess) {
        setButtonSuccess(btn, '✓ 오픈 완료');
      }
    }
  };

  // 2-6) 오늘 주문 즉시 마감
  window.guestEmergencyCloseAction = async () => {
    const btn = document.getElementById('btn-guest-close') || document.getElementById('btn-guest-emergency-close');
    if (!confirm('정기/추가 일정과 관계없이 지금 즉시 오늘 주문 접수를 마감할까요?')) return;

    try {
      requireAdminToken();
    } catch (_) {
      return;
    }

    setButtonLoading(btn, true, '⏳ 마감 중...');
    let isSuccess = false;
    try {
      const res = await fetchAPI('updateGuestSettings', {
        method: 'POST',
        body: {
          settingsAction: 'closeNow',
          adminToken: getAdminToken(),
          adminMemo: getAdminMemo()
        }
      });
      if (res?.success) {
        isSuccess = true;
        backgroundReload(loadAllSettings);
      } else {
        clearAdminTokenIfDenied(res);
        alert(res?.message || '마감 실패');
      }
    } catch (e) {
      alert('오류가 발생했습니다: ' + (e.message || '네트워크 오류'));
    } finally {
      setButtonLoading(btn, false);
      if (isSuccess) {
        setButtonSuccess(btn, '✓ 마감 완료');
      }
    }
  };

  // 3) 당일 정원 및 배달 설정 저장
  window.saveCapacityAction = async () => {
    const btn = document.getElementById('btn-save-capacity');
    const maxOrderEl = document.getElementById('input-guest-max-order-count');
    const maxDeliveryEl = document.getElementById('input-guest-max-delivery-count');
    const deliveryAreaEl = document.getElementById('input-guest-delivery-area');

    const guestMaxOrderCount = Math.max(1, Number(maxOrderEl?.value) || 5);
    const guestMaxDeliveryCount = Math.max(0, Number(maxDeliveryEl?.value) || 0);
    const guestDeliveryArea = String(deliveryAreaEl?.value || '').trim() || '영주시 동 지역 (가흥동, 영주동, 휴천동 등)';

    try {
      requireAdminToken();
    } catch (_) {
      return;
    }

    setButtonLoading(btn, true);
    let isSuccess = false;
    try {
      const payload = buildFullUpdateValuesPayload({
        guestMaxOrderCount,
        guestMaxDeliveryCount,
        guestDeliveryArea
      });
      const res = await fetchAPI('updateGuestSettings', {
        method: 'POST',
        body: payload
      });
      if (res?.success) {
        isSuccess = true;
        if (!latestGuestOpsSettings) latestGuestOpsSettings = {};
        Object.assign(latestGuestOpsSettings, payload);
      } else {
        clearAdminTokenIfDenied(res);
        alert(res?.message || '저장 실패');
      }
    } catch (e) {
      alert('오류가 발생했습니다: ' + (e.message || '네트워크 오류'));
    } finally {
      setButtonLoading(btn, false);
      if (isSuccess) {
        setButtonSuccess(btn, '✓ 저장 완료');
      }
    }
  };

  // 4) 서비스 기본 및 담당자 설정 저장
  window.saveBaseSettingsAction = async () => {
    const btn = document.getElementById('btn-save-base-settings');
    const creditEl = document.getElementById('input-guest-credit');
    const feeEl = document.getElementById('input-guest-fee');
    const placeEl = document.getElementById('input-guest-delivery-place');
    const randomEl = document.getElementById('input-guest-random-display-name');
    const teamEnabledEl = document.getElementById('input-team-enabled');
    const teamTitleEl = document.getElementById('input-team-title');
    const teamMessageEl = document.getElementById('input-team-message');

    const members = [1, 2, 3]
      .map(i => document.getElementById(`input-team-member-${i}`)?.value?.trim())
      .filter(Boolean)
      .join(', ');

    try {
      requireAdminToken();
    } catch (_) {
      return;
    }

    setButtonLoading(btn, true);
    let isSuccess = false;
    try {
      const payload = buildFullUpdateValuesPayload({
        guestBaseCredit: Number(creditEl?.value) || 10,
        guestDeliveryFee: Number(feeEl?.value) || 3,
        guestDefaultDeliveryPlace: String(placeEl?.value || '사무실 원탁').trim(),
        guestAllowRandomDisplayName: randomEl ? randomEl.value === 'true' : true,
        todayDeliveryTeamEnabled: teamEnabledEl ? teamEnabledEl.checked : true,
        todayDeliveryTeamTitle: String(teamTitleEl?.value || '').trim(),
        todayDeliveryTeamMembers: members,
        todayDeliveryTeamMessage: String(teamMessageEl?.value || '').trim()
      });
      const res = await fetchAPI('updateGuestSettings', {
        method: 'POST',
        body: payload
      });
      if (res?.success) {
        isSuccess = true;
        if (!latestGuestOpsSettings) latestGuestOpsSettings = {};
        Object.assign(latestGuestOpsSettings, payload);
      } else {
        clearAdminTokenIfDenied(res);
        alert(res?.message || '저장 실패');
      }
    } catch (e) {
      alert('오류가 발생했습니다: ' + (e.message || '네트워크 오류'));
    } finally {
      setButtonLoading(btn, false);
      if (isSuccess) {
        setButtonSuccess(btn, '✓ 저장 완료');
      }
    }
  };

  // 5) 특별 행사 및 알림 설정 저장
  window.saveEventSettingsAction = async () => {
    const btn = document.getElementById('btn-save-event-settings');
    const eventModeEl = document.getElementById('input-guest-menu-mode-event');
    const eventNameEl = document.getElementById('input-guest-event-name');
    const eventEmblemInput = document.getElementById('input-guest-event-emblem-base64');
    const emailNotiEl = document.getElementById('input-admin-order-email-notification');

    const guestMenuMode = eventModeEl?.checked ? 'event' : 'normal';
    const guestEventName = String(eventNameEl?.value || '').trim() || '장애인식 개선 캠페인';
    const guestEventEmblemBase64 = eventEmblemInput ? eventEmblemInput.value : '';
    const adminOrderEmailNotificationEnabled = emailNotiEl ? emailNotiEl.checked : true;

    try {
      requireAdminToken();
    } catch (_) {
      return;
    }

    setButtonLoading(btn, true);
    let isSuccess = false;
    try {
      const payload = buildFullUpdateValuesPayload({
        guestMenuMode,
        guestEventName,
        guestEventEmblemBase64,
        adminOrderEmailNotificationEnabled
      });

      const res = await fetchAPI('updateGuestSettings', {
        method: 'POST',
        body: payload
      });

      if (res?.success) {
        isSuccess = true;
        if (!latestGuestOpsSettings) latestGuestOpsSettings = {};
        Object.assign(latestGuestOpsSettings, payload);
      } else {
        clearAdminTokenIfDenied(res);
        alert(res?.message || '저장 실패');
      }
    } catch (e) {
      alert('오류가 발생했습니다: ' + (e.message || '네트워크 오류'));
    } finally {
      setButtonLoading(btn, false);
      if (isSuccess) {
        setButtonSuccess(btn, '✓ 저장 완료');
      }
    }
  };

  // 엠블럼 이미지 업로드 처리 (P43 경량 WebP 자동 압축 아키텍처)
  function handleEventEmblemUpload(e) {
    const file = e.target?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (evt) {
      const img = new Image();
      img.onload = function () {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxSize = 150;

        if (width > height) {
          if (width > maxSize) {
            height = Math.round(height * (maxSize / width));
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = Math.round(width * (maxSize / height));
            height = maxSize;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const webpBase64 = canvas.toDataURL('image/webp', 0.85);
        const input = document.getElementById('input-guest-event-emblem-base64');
        const preview = document.getElementById('preview-guest-event-emblem');
        if (input) input.value = webpBase64;
        if (preview) preview.src = webpBase64;
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  }

  // 엠블럼 이미지 기본 복원/삭제
  window.removeEventEmblem = function () {
    const input = document.getElementById('input-guest-event-emblem-base64');
    const fileInput = document.getElementById('file-guest-event-emblem');
    const preview = document.getElementById('preview-guest-event-emblem');
    if (input) input.value = '';
    if (fileInput) fileInput.value = '';
    if (preview) preview.src = 'icons/배달왔삼.png';
  };

  // --- 6. 초기화 ---
  document.addEventListener('DOMContentLoaded', () => {
    // 키오스크 정책 카드 바인딩
    document.querySelectorAll('[data-kiosk-order-policy]').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('#kiosk-cooldown-container') && card.dataset.kioskOrderPolicy === 'cooldown') {
          return;
        }
        setKioskOrderPolicy(card.dataset.kioskOrderPolicy);
      });

      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target.closest('#kiosk-cooldown-container')) return;
          e.preventDefault();
          setKioskOrderPolicy(card.dataset.kioskOrderPolicy);
        }
      });
    });

    // 랜덤 닉네임 버튼 바인딩
    document.querySelectorAll('[data-guest-random-name]').forEach(btn => {
      btn.addEventListener('click', () => setGuestRandomDisplayName(btn.dataset.guestRandomName === 'true'));
    });

    // 행사 모드 토글 스위치 아코디언 바인딩
    const eventModeToggle = document.getElementById('input-guest-menu-mode-event');
    if (eventModeToggle) {
      eventModeToggle.addEventListener('change', () => {
        const container = document.getElementById('event-mode-details-container');
        if (container) {
          container.style.display = eventModeToggle.checked ? 'flex' : 'none';
        }
      });
    }

    // 엠블럼 파일 업로드 바인딩
    const emblemFileInput = document.getElementById('file-guest-event-emblem');
    if (emblemFileInput) {
      emblemFileInput.addEventListener('change', handleEventEmblemUpload);
    }

    // AdminAuth 초기화
    if (typeof AdminAuth !== 'undefined') {
      AdminAuth.init({
        onUnlock: () => loadAllSettings()
      });
    }

    loadAllSettings();
  });

  window.loadAllSettings = loadAllSettings;
  window.saveKioskPolicyAction = saveKioskPolicyAction;
  window.saveGuestWeeklyScheduleAction = saveGuestWeeklyScheduleAction;
  window.toggleGuestWeeklyScheduleSkipAction = toggleGuestWeeklyScheduleSkipAction;
  window.addGuestAdditionalScheduleAction = addGuestAdditionalScheduleAction;
  window.deleteGuestAdditionalScheduleAction = deleteGuestAdditionalScheduleAction;
  window.guestEmergencyOpenUntilAction = guestEmergencyOpenUntilAction;
  window.guestOpenUntilAction = guestEmergencyOpenUntilAction;
  window.guestEmergencyCloseAction = guestEmergencyCloseAction;
  window.guestCloseNowAction = guestEmergencyCloseAction;
  window.saveCapacityAction = saveCapacityAction;
  window.saveCapacitySettingsAction = saveCapacityAction;
  window.saveBaseSettingsAction = saveBaseSettingsAction;
  window.saveEventSettingsAction = saveEventSettingsAction;
})();
