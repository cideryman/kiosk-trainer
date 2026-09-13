(() => {
  const statusBadge = document.getElementById('live-status-badge');
  const statusText = document.getElementById('live-status-text');
  const scheduleText = document.getElementById('live-schedule-text');
  const orderLabelEl = document.getElementById('live-order-label');
  const deliveryLabelEl = document.getElementById('live-delivery-label');
  const orderCapacityEl = document.getElementById('live-order-capacity');
  const deliveryCapacityEl = document.getElementById('live-delivery-capacity');
  const deliveryAreaEl = document.getElementById('live-delivery-area');
  const orderCtaBtn = document.getElementById('btn-live-order-cta');
  const statusNoteEl = document.getElementById('live-status-note');

  let pollTimer = null;

  function formatTime(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(d);
    } catch (_) {
      return '';
    }
  }

  function updateLiveStatusBoard(data) {
    if (!data) return;

    const isOpen = data.isGuestOpenNow === true;
    const isOrderCapped = data.isOrderCapped === true;
    const isDeliveryCapped = data.isDeliveryCapped === true;

    const maxOrders = data.guestMaxOrderCount ?? 5;
    const remainingOrders = data.remainingOrderCount ?? maxOrders;
    const maxDeliveries = data.guestMaxDeliveryCount ?? 2;
    const remainingDeliveries = data.remainingDeliveryCount ?? maxDeliveries;
    const deliveryArea = data.guestDeliveryArea || '영주시 동 지역 (가흥동, 영주동, 휴천동 등)';

    // 1. 배달 가능 지역
    if (deliveryAreaEl) deliveryAreaEl.textContent = deliveryArea;

    // 2. 주문 정원 및 배달 가능 건수 동적 렌더링
    if (isOpen && !isOrderCapped) {
      // [운영 중 & 주문 가능]
      if (orderLabelEl) orderLabelEl.textContent = '오늘 주문 가능';
      if (orderCapacityEl) {
        orderCapacityEl.className = 'live-status-value accent';
        orderCapacityEl.innerHTML = `<span id="live-order-remaining">${remainingOrders}</span>건 남음 <small>(총 <span id="live-order-max">${maxOrders}</span>건)</small>`;
      }
      if (deliveryLabelEl) deliveryLabelEl.textContent = '오늘 배달 가능';
      if (deliveryCapacityEl) {
        if (isDeliveryCapped || remainingDeliveries <= 0) {
          deliveryCapacityEl.className = 'live-status-value warning';
          deliveryCapacityEl.innerHTML = `<span id="live-delivery-remaining">마감 (포장만 가능)</span> <small>(최대 <span id="live-delivery-max">${maxDeliveries}</span>건)</small>`;
        } else {
          deliveryCapacityEl.className = 'live-status-value';
          deliveryCapacityEl.innerHTML = `<span id="live-delivery-remaining">${remainingDeliveries}</span>건 남음 <small>(최대 <span id="live-delivery-max">${maxDeliveries}</span>건)</small>`;
        }
      }
    } else if (isOpen && isOrderCapped) {
      // [운영 시간 중이나 오늘 준비된 정원 소진]
      if (orderLabelEl) orderLabelEl.textContent = '오늘 주문 현황';
      if (orderCapacityEl) {
        orderCapacityEl.className = 'live-status-value danger';
        orderCapacityEl.innerHTML = `<span id="live-order-remaining">마감</span> <small>(정원 <span id="live-order-max">${maxOrders}</span>건 소진)</small>`;
      }
      if (deliveryLabelEl) deliveryLabelEl.textContent = '오늘 배달 현황';
      if (deliveryCapacityEl) {
        deliveryCapacityEl.className = 'live-status-value danger';
        deliveryCapacityEl.innerHTML = `<span id="live-delivery-remaining">마감</span> <small>(최대 <span id="live-delivery-max">${maxDeliveries}</span>건)</small>`;
      }
    } else {
      // [운영 시간 외 / 준비 중 / 휴무] - 지금 주문 가능한 것으로 오해하지 않도록 회차 기준 안내
      if (orderLabelEl) orderLabelEl.textContent = '회차당 주문 정원';
      if (orderCapacityEl) {
        orderCapacityEl.className = 'live-status-value';
        orderCapacityEl.innerHTML = `총 <span id="live-order-max">${maxOrders}</span>건 <small>(운영 시 오픈)</small>`;
      }
      if (deliveryLabelEl) deliveryLabelEl.textContent = '회차당 배달 가능 건수';
      if (deliveryCapacityEl) {
        deliveryCapacityEl.className = 'live-status-value';
        deliveryCapacityEl.innerHTML = `최대 <span id="live-delivery-max">${maxDeliveries}</span>건 <small>(운영 시 오픈)</small>`;
      }
    }

    // 3. 상태 뱃지 및 운영 안내
    if (statusBadge && statusText) {
      statusBadge.classList.remove('open', 'closed', 'ready');

      if (isOpen && !isOrderCapped) {
        statusBadge.classList.add('open');
        statusText.textContent = '🟢 오늘 주문 접수 중';
        if (orderCtaBtn) {
          orderCtaBtn.classList.remove('disabled');
          orderCtaBtn.innerHTML = '<span>🛵 지금 주문하기</span>';
          orderCtaBtn.setAttribute('href', 'guest.html');
        }
        if (statusNoteEl) {
          statusNoteEl.textContent = isDeliveryCapped
            ? '오늘 배달이 마감되어 [매장 픽업]으로 주문하실 수 있습니다.'
            : '오늘 운영 시간 내에 누구나 선착순으로 주문할 수 있습니다.';
        }
      } else if (isOpen && isOrderCapped) {
        statusBadge.classList.add('closed');
        statusText.textContent = '🔴 오늘 주문 정원 마감';
        if (orderCtaBtn) {
          orderCtaBtn.classList.add('disabled');
          orderCtaBtn.innerHTML = '<span>🛑 오늘 주문 정원 마감</span>';
          orderCtaBtn.removeAttribute('href');
        }
        if (statusNoteEl) {
          statusNoteEl.textContent = '오늘 준비된 주문 정원이 모두 소진되었습니다. 다음 운영을 기대해 주세요!';
        }
      } else {
        statusBadge.classList.add('ready');
        statusText.textContent = '🟡 주문 준비 중';
        if (orderCtaBtn) {
          orderCtaBtn.classList.add('disabled');
          orderCtaBtn.innerHTML = '<span>⏰ 운영 시간 외 (준비 중)</span>';
          orderCtaBtn.removeAttribute('href');
        }
        if (statusNoteEl) {
          statusNoteEl.textContent = '운영 시간(정기/추가 일정)이 되면 주문 버튼이 활성화됩니다.';
        }
      }
    }

    // 4. 스케줄 안내 문구
    if (scheduleText) {
      if (isOpen) {
        const closeTimeFormatted = formatTime(data.effectiveGuestCloseAt);
        scheduleText.textContent = closeTimeFormatted
          ? `오늘 ${closeTimeFormatted}까지 접수`
          : '현재 운영 중';
      } else if (data.nextGuestSchedule) {
        const next = data.nextGuestSchedule;
        scheduleText.textContent = `다음 운영: ${next.date} ${next.startTime}~${next.endTime}`;
      } else if (data.guestWeeklyScheduleEnabled) {
        const dayName = data.guestWeeklyScheduleDayName || '수요일';
        const start = data.guestWeeklyScheduleStartTime || '12:00';
        const end = data.guestWeeklyScheduleEndTime || '14:00';
        scheduleText.textContent = `정기 운영: 매주 ${dayName} ${start}~${end}`;
      } else if (data.message) {
        scheduleText.textContent = data.message;
      } else {
        scheduleText.textContent = '정기 운영 일정 준비 중';
      }
    }
  }

  async function loadStatus() {
    try {
      const res = await fetchAPI('getGuestSettings');
      if (res && res.success) {
        updateLiveStatusBoard(res);
      }
    } catch (e) {
      console.warn('운영 상태 불러오기 실패:', e);
      if (statusText) statusText.textContent = '상태 확인 지연 중';
    }
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion || !('IntersectionObserver' in window)) {
    document.querySelectorAll('.reveal').forEach(element => element.classList.add('is-visible'));
  } else {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.02 });
    document.querySelectorAll('.reveal').forEach(element => observer.observe(element));
  }

  window.addEventListener('DOMContentLoaded', () => {
    loadStatus();
    // 30초마다 자동 갱신
    pollTimer = setInterval(loadStatus, 30000);
  });

  window.addEventListener('beforeunload', () => {
    if (pollTimer) clearInterval(pollTimer);
  });
})();
