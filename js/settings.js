/**
 * settings.js - 통합 운영 설정 전용 스크립트 (P120)
 * 키오스크 주문 제한, 배달왔삼 정기/추가/긴급 일정, 당일 정원 및 배달 지역, 기본 설정 통합 관리
 */
(() => {
  'use strict';

  let latestGuestOpsSettings = null;

  function getAdminToken() {
    return window.AdminAuth ? window.AdminAuth.getToken() : (sessionStorage.getItem('adminToken') || '');
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

  function getGuestKstDateTimeParts() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    const getVal = type => parts.find(p => p.type === type)?.value || '';
    return {
      date: `${getVal('year')}-${getVal('month')}-${getVal('day')}`,
      time: `${getVal('hour')}:${getVal('minute')}`
    };
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

  // --- 1. 키오스크 정책 세그먼트 ---
  function setKioskOrderPolicy(policy) {
    const normalized = ['once_daily', 'cooldown', 'unlimited'].includes(String(policy).toLowerCase())
      ? String(policy).toLowerCase()
      : 'once_daily';
    const inputEl = document.getElementById('input-kiosk-order-policy');
    const cooldownContainer = document.getElementById('kiosk-cooldown-container');

    if (inputEl) inputEl.value = normalized;
    if (cooldownContainer) {
      cooldownContainer.style.display = normalized === 'cooldown' ? 'flex' : 'none';
    }
    document.querySelectorAll('[data-kiosk-order-policy]').forEach(btn => {
      const isActive = btn.dataset.kioskOrderPolicy === normalized;
      btn.classList.toggle('is-active', isActive);
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
      const res = await window.CONFIG.apiGetGuestSettings();
      if (!res) return;
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
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  }

  // --- 5. 저장 액션들 ---

  // 1) 키오스크 주문 제한 저장
  window.saveKioskPolicyAction = async () => {
    const btn = document.getElementById('btn-save-kiosk-policy');
    const policyInput = document.getElementById('input-kiosk-order-policy');
    const cooldownInput = document.getElementById('input-kiosk-cooldown-minutes');
    const policy = policyInput ? policyInput.value : 'once_daily';
    const cooldown = cooldownInput ? Math.max(1, Number(cooldownInput.value) || 60) : 60;

    setButtonLoading(btn, true);
    try {
      const res = await window.CONFIG.fetchAPI('updateGuestSettings', {
        method: 'POST',
        body: {
          settingsAction: 'updateValues',
          kioskOrderPolicy: policy,
          kioskCooldownMinutes: cooldown,
          adminToken: getAdminToken(),
          adminMemo: getAdminMemo()
        }
      });
      if (res?.success) {
        alert('매점 키오스크 주문 정책이 저장되었습니다.');
      } else {
        alert(res?.message || '저장에 실패했습니다.');
      }
    } catch (e) {
      alert('오류가 발생했습니다.');
    } finally {
      setButtonLoading(btn, false);
      await loadAllSettings();
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

    setButtonLoading(btn, true);
    try {
      const res = await window.CONFIG.fetchAPI('updateGuestSettings', {
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
        alert('정기 일정이 저장되었습니다.');
      } else {
        alert(res?.message || '저장에 실패했습니다.');
      }
    } catch (e) {
      alert('오류가 발생했습니다.');
    } finally {
      setButtonLoading(btn, false);
      await loadAllSettings();
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

    setButtonLoading(btn, true, isResume ? '⏳ 재개 중...' : '⏳ 중단 중...');
    try {
      const res = await window.CONFIG.fetchAPI('updateGuestSettings', {
        method: 'POST',
        body: {
          settingsAction: action,
          adminToken: getAdminToken(),
          adminMemo: getAdminMemo()
        }
      });
      if (res?.success) {
        alert(res.message || '반영되었습니다.');
      } else {
        alert(res?.message || '실패했습니다.');
      }
    } catch (e) {
      alert('오류가 발생했습니다.');
    } finally {
      setButtonLoading(btn, false);
      await loadAllSettings();
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

    setButtonLoading(btn, true, '⏳ 등록 중...');
    try {
      const res = await window.CONFIG.fetchAPI('updateGuestSettings', {
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
        alert('추가 운영 일정이 등록되었습니다.');
      } else {
        alert(res?.message || '등록 실패');
      }
    } catch (e) {
      alert('오류가 발생했습니다.');
    } finally {
      setButtonLoading(btn, false);
      await loadAllSettings();
    }
  };

  // 2-4) 추가 일정 삭제
  async function deleteGuestAdditionalScheduleAction(schedule, button) {
    if (!schedule?.scheduleId) return;
    if (!confirm(`${formatGuestScheduleDate(schedule.date)} ${schedule.startTime}~${schedule.endTime} 일정을 취소할까요?`)) return;

    setButtonLoading(button, true, '⏳ 취소 중...');
    try {
      const res = await window.CONFIG.fetchAPI('updateGuestSettings', {
        method: 'POST',
        body: {
          settingsAction: 'deleteAdditionalSchedule',
          scheduleId: schedule.scheduleId,
          adminToken: getAdminToken(),
          adminMemo: getAdminMemo()
        }
      });
      if (res?.success) {
        alert('추가 일정이 취소되었습니다.');
      } else {
        alert(res?.message || '취소 실패');
      }
    } catch (e) {
      alert('오류가 발생했습니다.');
    } finally {
      setButtonLoading(button, false);
      await loadAllSettings();
    }
  }

  // 2-5) 오늘 긴급 운영 (지금부터 운영)
  window.guestOpenUntilAction = async () => {
    const btn = document.getElementById('btn-guest-open-until');
    const manualEndEl = document.getElementById('input-guest-manual-end');
    const endTime = String(manualEndEl?.value || '').trim();
    if (!endTime) {
      alert('오늘 종료할 시각(HH:mm)을 입력해 주세요.');
      return;
    }
    const today = getGuestKstDateTimeParts().date;
    const effectiveCloseTime = `${today}T${endTime}:00+09:00`;

    if (!confirm(`오늘 ${endTime}까지 긴급 운영을 시작할까요?`)) return;

    setButtonLoading(btn, true, '⏳ 시작 중...');
    try {
      const res = await window.CONFIG.fetchAPI('updateGuestSettings', {
        method: 'POST',
        body: {
          settingsAction: 'emergencyOpen',
          effectiveCloseTime,
          adminToken: getAdminToken(),
          adminMemo: getAdminMemo()
        }
      });
      if (res?.success) {
        alert('긴급 운영이 시작되었습니다.');
      } else {
        alert(res?.message || '실패했습니다.');
      }
    } catch (e) {
      alert('오류가 발생했습니다.');
    } finally {
      setButtonLoading(btn, false);
      await loadAllSettings();
    }
  };

  // 2-6) 오늘 주문 지금 마감
  window.guestCloseNowAction = async () => {
    const btn = document.getElementById('btn-guest-close');
    if (!confirm('오늘 진행 중인 배달왔삼 주문을 지금 마감할까요?')) return;

    setButtonLoading(btn, true, '⏳ 마감 중...');
    try {
      const res = await window.CONFIG.fetchAPI('updateGuestSettings', {
        method: 'POST',
        body: {
          settingsAction: 'closeNow',
          adminToken: getAdminToken(),
          adminMemo: getAdminMemo()
        }
      });
      if (res?.success) {
        alert('주문이 마감되었습니다.');
      } else {
        alert(res?.message || '마감 실패');
      }
    } catch (e) {
      alert('오류가 발생했습니다.');
    } finally {
      setButtonLoading(btn, false);
      await loadAllSettings();
    }
  };

  // 3) 당일 정원 및 배달 설정 저장
  window.saveCapacitySettingsAction = async () => {
    const btn = document.getElementById('btn-save-capacity');
    const maxOrderEl = document.getElementById('input-guest-max-order-count');
    const maxDeliveryEl = document.getElementById('input-guest-max-delivery-count');
    const deliveryAreaEl = document.getElementById('input-guest-delivery-area');

    const guestMaxOrderCount = Math.max(1, Number(maxOrderEl?.value) || 5);
    const guestMaxDeliveryCount = Math.max(0, Number(maxDeliveryEl?.value) || 0);
    const guestDeliveryArea = String(deliveryAreaEl?.value || '').trim() || '영주시 동 지역 (가흥동, 영주동, 휴천동 등)';

    setButtonLoading(btn, true);
    try {
      const res = await window.CONFIG.fetchAPI('updateGuestSettings', {
        method: 'POST',
        body: {
          settingsAction: 'updateValues',
          guestMaxOrderCount,
          guestMaxDeliveryCount,
          guestDeliveryArea,
          adminToken: getAdminToken(),
          adminMemo: getAdminMemo()
        }
      });
      if (res?.success) {
        alert('정원 및 배달 지역 설정이 저장되었습니다.');
      } else {
        alert(res?.message || '저장 실패');
      }
    } catch (e) {
      alert('오류가 발생했습니다.');
    } finally {
      setButtonLoading(btn, false);
      await loadAllSettings();
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

    setButtonLoading(btn, true);
    try {
      const res = await window.CONFIG.fetchAPI('updateGuestSettings', {
        method: 'POST',
        body: {
          settingsAction: 'updateValues',
          guestBaseCredit: Number(creditEl?.value) || 10,
          guestDeliveryFee: Number(feeEl?.value) || 3,
          guestDefaultDeliveryPlace: String(placeEl?.value || '사무실 원탁').trim(),
          guestAllowRandomDisplayName: randomEl ? randomEl.value === 'true' : true,
          todayDeliveryTeamEnabled: teamEnabledEl ? teamEnabledEl.checked : true,
          todayDeliveryTeamTitle: String(teamTitleEl?.value || '').trim(),
          todayDeliveryTeamMembers: members,
          todayDeliveryTeamMessage: String(teamMessageEl?.value || '').trim(),
          adminToken: getAdminToken(),
          adminMemo: getAdminMemo()
        }
      });
      if (res?.success) {
        alert('기본 및 담당자 설정이 저장되었습니다.');
      } else {
        alert(res?.message || '저장 실패');
      }
    } catch (e) {
      alert('오류가 발생했습니다.');
    } finally {
      setButtonLoading(btn, false);
      await loadAllSettings();
    }
  };

  // --- 6. 초기화 ---
  document.addEventListener('DOMContentLoaded', () => {
    // 키오스크 정책 버튼 바인딩
    document.querySelectorAll('[data-kiosk-order-policy]').forEach(btn => {
      btn.addEventListener('click', () => setKioskOrderPolicy(btn.dataset.kioskOrderPolicy));
    });

    // 랜덤 닉네임 버튼 바인딩
    document.querySelectorAll('[data-guest-random-name]').forEach(btn => {
      btn.addEventListener('click', () => setGuestRandomDisplayName(btn.dataset.guestRandomName === 'true'));
    });

    // AdminAuth 초기화
    if (window.AdminAuth) {
      window.AdminAuth.init({
        onUnlock: () => loadAllSettings()
      });
    }

    loadAllSettings();
  });

  window.loadAllSettings = loadAllSettings;
})();
