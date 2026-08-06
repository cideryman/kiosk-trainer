(() => {
  const form = document.getElementById('guest-application-form');
  const submitButton = document.getElementById('application-submit');
  const formMessage = document.getElementById('application-form-message');
  const closedPanel = document.getElementById('application-closed');
  const successPanel = document.getElementById('application-success');
  const requestStorageKey = 'guestApplicationRequestId';
  const queryParams = new URLSearchParams(window.location.search);
  const useLocalMock = queryParams.get('mock') === '1';
  const useLocalMockFull = queryParams.get('mockFull') === '1';
  const useLocalMockWaitlist = queryParams.get('mockWaitlist') === '1';
  const localMockCapacityValue = Number(queryParams.get('mockCapacity'));
  const localMockCapacity = Number.isInteger(localMockCapacityValue) && localMockCapacityValue >= 1 && localMockCapacityValue <= 100
    ? localMockCapacityValue
    : 5;
  const localMockWaitlistParam = queryParams.get('mockWaitlistCount');
  const localMockWaitlistValue = localMockWaitlistParam === null ? NaN : Number(localMockWaitlistParam);
  const localMockWaitlistCount = Number.isInteger(localMockWaitlistValue) && localMockWaitlistValue >= 0
    ? localMockWaitlistValue
    : 3;
  let applicationSettings = null;

  function createRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    const random = Math.random().toString(36).slice(2);
    return `app_${Date.now()}_${random}`;
  }

  function getRequestId() {
    let requestId = sessionStorage.getItem(requestStorageKey);
    if (!requestId) {
      requestId = createRequestId();
      sessionStorage.setItem(requestStorageKey, requestId);
    }
    return requestId;
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value || '-';
  }

  function setFormMessage(message) {
    formMessage.textContent = message || '';
    formMessage.className = message ? 'form-message error' : 'form-message';
  }

  function renderDayOptions(days) {
    const container = document.getElementById('preferred-day-options');
    container.replaceChildren();
    (days || []).forEach((day, index) => {
      const label = document.createElement('label');
      label.className = 'day-option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'preferredDays';
      input.value = day;
      input.id = `preferred-day-${index}`;
      const text = document.createElement('span');
      text.textContent = day;
      label.append(input, text);
      container.append(label);
    });
  }

  function renderSettings(settings) {
    applicationSettings = settings;
    setText('info-target', settings.target);
    setText('info-days', settings.operatingDays);
    setText('info-order-time', settings.orderTime);
    setText('info-delivery-time', settings.deliveryTime);
    setText('info-area', settings.serviceArea);
    setText('info-usage', settings.usageGuide);
    setText('summary-target', settings.target);
    setText('summary-days', settings.operatingDays);
    setText('summary-area', settings.serviceArea);
    const capacity = Math.max(1, Number(settings.capacity) || 5);
    const remainingSlots = Math.max(0, Number(settings.remainingSlots) || 0);
    const waitlistCount = Math.max(0, Number(settings.waitlistCount) || 0);
    const waitlistActive = settings.waitlistActive === true;
    const waitlistFull = settings.waitlistFull === true;
    const isOpen = settings.applicationOpen === true;

    // 정원 정보 표시
    if (waitlistActive) {
      setText('info-capacity', `1차 ${capacity}명 · 접수 완료 · 대기 ${waitlistCount}명`);
    } else if (settings.applicationFull && !waitlistActive) {
      setText('info-capacity', `1차 ${capacity}명 모집 완료`);
    } else {
      setText('info-capacity', `1차 ${capacity}명 · 남은 ${remainingSlots}명`);
    }
    renderDayOptions(settings.preferredDayOptions);

    // 신청 상태 표시
    const state = document.getElementById('application-state');
    let stateText = '';
    let stateClass = '';
    if (waitlistFull) {
      stateText = '이용 신청 마감';
      stateClass = 'closed';
    } else if (waitlistActive) {
      stateText = `대기 접수 중 · ${waitlistCount}명`;
      stateClass = 'waitlist';
    } else if (isOpen) {
      stateText = `신청 가능 · ${remainingSlots}명 남음`;
      stateClass = 'open';
    } else {
      stateText = settings.applicationFull ? '1차 모집 마감' : '이용 신청 마감';
      stateClass = 'closed';
    }
    state.textContent = waitlistFull ? '이용 신청 마감 (대기 포화)' : stateText;
    state.className = `application-state ${stateClass}`;
    const summaryState = document.getElementById('summary-state');
    if (summaryState) {
      summaryState.textContent = stateText;
      summaryState.className = `application-summary-value status ${stateClass}`;
    }
    document.querySelectorAll('[data-open-application]').forEach(button => {
      if (waitlistFull) {
        button.textContent = '신청 마감 안내 보기';
      } else if (waitlistActive) {
        button.textContent = '배달왔삼 대기 신청하기';
      } else {
        button.textContent = isOpen ? '배달왔삼 이용 신청하기' : '신청 마감 안내 보기';
      }
    });
    const canApply = isOpen || waitlistActive;
    submitButton.disabled = !canApply;
    form.hidden = !canApply;
    closedPanel.style.display = canApply ? 'none' : 'block';
    closedPanel.textContent = settings.closedMessage || '현재 이용 신청을 받고 있지 않습니다.';
  }

  function getMockSettings() {
    const activeCount = useLocalMockFull ? localMockCapacity : Math.min(1, localMockCapacity);
    const remainingSlots = Math.max(0, localMockCapacity - activeCount);
    const waitlistActive = useLocalMockFull && !useLocalMockWaitlist;
    const waitlistCount = waitlistActive ? localMockWaitlistCount : 0;
    return {
      success: true,
      applicationOpen: !useLocalMockFull || waitlistActive,
      applicationOpenConfigured: true,
      applicationFull: useLocalMockFull,
      waitlistActive,
      waitlistFull: useLocalMockWaitlist,
      waitlistCount,
      waitlistLimit: 100,
      applicationClosedReason: useLocalMockWaitlist ? 'WAITLIST_FULL' : (useLocalMockFull ? 'FULL' : ''),
      capacity: localMockCapacity,
      activeCount,
      remainingSlots,
      cooldownWeeks: 2,
      target: '영주시장애인복지관 봉사자·후원자와 관리자가 이용 가능하다고 인정한 관계자',
      operatingDays: '매주 수요일',
      orderTime: '운영일 오전 10시부터 오전 11시 30분까지\n\n운영 일정에 따라 주문 시간이 달라질 수 있으며, 정확한 시간은 별도로 안내합니다.',
      deliveryTime: '오후 1시부터 주문 확인 순서에 따라 배달합니다.',
      serviceArea: '복지관과 사전에 협의된 장소',
      usageGuide: '이용 신청과 관리자 확인을 완료한 뒤, 안내받은 배달왔삼 주문 페이지에서 직접 주문합니다.',
      preferredDayOptions: ['수요일'],
      closedMessage: useLocalMockWaitlist
        ? '대기자가 100명을 초과하여 추가 접수를 받지 않습니다. 기관 담당자에게 문의해 주세요.'
        : (useLocalMockFull
          ? `${localMockCapacity}명의 정원이 꽉 찼지만 대기자로 접수 가능합니다.`
          : '현재 이용 신청을 받고 있지 않습니다.'),
      configuredClosedMessage: '현재 이용 신청을 받고 있지 않습니다.'
    };
  }

  async function loadSettings() {
    try {
      const settings = useLocalMock
        ? getMockSettings()
        : await fetchAPIReadWithRetry('getGuestApplicationSettings', { timeoutMs: 30000 });
      if (!settings?.success) throw new Error(settings?.message || '설정 조회 실패');
      renderSettings(settings);
    } catch (error) {
      renderSettings({
        applicationOpen: false,
        applicationOpenConfigured: false,
        applicationFull: false,
        waitlistActive: false,
        waitlistFull: false,
        waitlistCount: 0,
        waitlistLimit: 100,
        applicationClosedReason: 'ERROR',
        capacity: 5,
        activeCount: 0,
        remainingSlots: 0,
        cooldownWeeks: 2,
        target: '기관 담당자에게 문의해 주세요.',
        operatingDays: '-',
        orderTime: '-',
        deliveryTime: '-',
        serviceArea: '-',
        usageGuide: '-',
        preferredDayOptions: [],
        closedMessage: '이용 신청 안내를 불러오지 못했습니다. 잠시 후 다시 시도하거나 기관 담당자에게 문의해 주세요.',
        configuredClosedMessage: '이용 신청 안내 불가'
      });
    }
  }

  function openApplicationForm() {
    document.getElementById('application-form-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (applicationSettings?.applicationOpen || applicationSettings?.waitlistActive) {
      window.setTimeout(() => document.getElementById('applicant-name')?.focus({ preventScroll: true }), 550);
    }
  }

  document.querySelectorAll('[data-open-application]').forEach(button => {
    button.addEventListener('click', openApplicationForm);
  });

  document.getElementById('applicant-relation').addEventListener('change', event => {
    const detailField = document.getElementById('relation-detail-field');
    const detailInput = document.getElementById('applicant-relation-detail');
    const showDetail = event.target.value === 'OTHER';
    detailField.hidden = !showDetail;
    detailInput.required = showDetail;
    if (!showDetail) detailInput.value = '';
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    setFormMessage('');
    if (!applicationSettings?.applicationOpen && !applicationSettings?.waitlistActive) {
      setFormMessage('현재 이용 신청을 받고 있지 않습니다.');
      return;
    }
    const selectedDays = Array.from(form.querySelectorAll('input[name="preferredDays"]:checked')).map(input => input.value);
    if (!form.reportValidity()) return;
    if (selectedDays.length === 0) {
      setFormMessage('이용 희망 요일을 하나 이상 선택해 주세요.');
      document.getElementById('preferred-day-options').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = '신청 접수 중...';
    const body = {
      requestId: getRequestId(),
      name: document.getElementById('applicant-name').value.trim(),
      relationType: document.getElementById('applicant-relation').value,
      relationDetail: document.getElementById('applicant-relation-detail').value.trim(),
      phone: document.getElementById('applicant-phone').value.trim(),
      deliveryPlace: document.getElementById('applicant-place').value.trim(),
      deliveryDetail: document.getElementById('applicant-delivery-detail').value.trim(),
      preferredDays: selectedDays,
      message: document.getElementById('applicant-message').value.trim(),
      consent: document.getElementById('applicant-consent').checked,
      website: document.getElementById('applicant-website').value
    };

    try {
      const res = useLocalMock
        ? (applicationSettings?.waitlistActive
          ? { success: true, applicationId: 'APP-PREVIEW-001', status: 'WAITLIST', waitlistPosition: localMockWaitlistCount + 1, message: `대기 접수되었습니다. 대기 번호 ${localMockWaitlistCount + 1}번.` }
          : { success: true, applicationId: 'APP-PREVIEW-001', status: 'PENDING', message: '로컬 미리보기 신청입니다.' })
        : await fetchAPI('submitGuestApplication', { method: 'POST', body });

      if (!res?.success) {
        if (res?.code === 'APPLICATION_CLOSED' || res?.code === 'APPLICATION_FULL') {
          const applicationFull = res.code === 'APPLICATION_FULL';
          renderSettings({
            ...applicationSettings,
            applicationOpen: false,
            waitlistActive: false,
            applicationFull,
            applicationClosedReason: applicationFull ? 'FULL' : 'MANUAL',
            activeCount: applicationFull ? (Number(res.activeCount) || Number(res.capacity) || 5) : applicationSettings.activeCount,
            remainingSlots: applicationFull ? 0 : applicationSettings.remainingSlots,
            closedMessage: res.message || '현재 이용 신청을 받고 있지 않습니다.'
          });
        } else if (res?.code === 'WAITLIST_FULL') {
          renderSettings({
            ...applicationSettings,
            waitlistFull: true,
            waitlistActive: false,
            applicationOpen: false,
            applicationClosedReason: 'WAITLIST_FULL',
            closedMessage: res.message || '대기자가 가득 차 추가 접수를 받지 않습니다.'
          });
        }
        setFormMessage(res?.message || '신청을 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }

      sessionStorage.removeItem(requestStorageKey);
      form.style.display = 'none';
      successPanel.style.display = 'block';

      if (res.status === 'WAITLIST' && res.waitlistPosition) {
        setText('application-number', `신청번호 ${res.applicationId}\n대기 번호 ${res.waitlistPosition}`);
        const heading = successPanel.querySelector('h3');
        if (heading) heading.textContent = '대기 접수되었습니다';
        const paragraph = successPanel.querySelector('p');
        if (paragraph) paragraph.textContent = '관리자가 대기 순번에 따라 승인하면 연락드립니다.';
      } else {
        setText('application-number', `신청번호 ${res.applicationId}`);
      }
      successPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      setFormMessage('응답을 확인하지 못했습니다. 같은 화면에서 다시 누르면 동일 신청으로 안전하게 확인합니다.');
    } finally {
      const canApply = applicationSettings?.applicationOpen || applicationSettings?.waitlistActive;
      submitButton.disabled = !canApply;
      submitButton.textContent = '이용 신청 접수하기';
    }
  });

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

  loadSettings();
})();
