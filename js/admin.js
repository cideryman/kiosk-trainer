// --- 시스템 운영 점검 (진단) 모달 제어 함수 ---
function openDiagnoseModal() {
  if (!AdminAuth.isUnlocked()) {
    AdminAuth.focus('운영 점검 전에 관리자 잠금을 해제해 주세요.');
    return;
  }
  const modal = document.getElementById('modal-system-diagnose');
  if (modal) {
    modal.style.display = 'flex';
    isModalOpen = true;
    runSystemDiagnosis();
  }
}

function closeDiagnoseModal() {
  const modal = document.getElementById('modal-system-diagnose');
  if (modal) {
    modal.style.display = 'none';
    isModalOpen = false;
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
            <div style="padding: 10px; border: 2px solid #FEB2B2; background-color: #FFF5F5; border-radius: var(--radius-sm); font-size: 14px; font-weight: 700; color: #9B2C2C; display: flex; flex-direction: column; gap: 4px; word-break: break-all;">
              <div>🔴 [${name}] 시트 누락</div>
              <div style="font-size: 13px; font-weight: 600; color: #742A2A;">
                해결: 구글 스프레드시트에 반드시 '${name}' 이름으로 탭(시트)을 생성해 주세요.
              </div>
            </div>
          `;
        } else if (sheet.status === 'WARN') {
          itemsHtml += `
            <div style="padding: 10px; border: 2px solid #FEEBC8; background-color: #FFFDF5; border-radius: var(--radius-sm); font-size: 14px; font-weight: 700; color: #DD6B20; display: flex; flex-direction: column; gap: 4px; word-break: break-all;">
              <div>🟡 [${name}] 시트 구조 불일치</div>
              <div style="font-size: 13px; font-weight: 600; color: #7B341E;">
                원인: ${sheet.error}<br>
                해결: 해당 컬럼들의 이름을 확인하고 원래 위치에 맞게 스프레드시트를 보정하세요.
              </div>
            </div>
          `;
        } else {
          itemsHtml += `
            <div style="padding: 10px; border: 2.5px solid var(--border-color); background-color: white; border-radius: var(--radius-sm); font-size: 14px; font-weight: 700; color: var(--text-main); display: flex; justify-content: space-between; align-items: center; gap: 8px;">
              <span style="min-width: 0; word-break: break-all;">🟢 [${name}] 시트</span>
              <span style="font-size: 12px; color: #38A169; font-weight: 950; background-color: #E6FFFA; padding: 2px 8px; border-radius: 999px; border: 1.5px solid #81E6D9; flex-shrink: 0; white-space: nowrap;">정상</span>
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
            <div style="padding: 10px; border: 2px solid #FEB2B2; background-color: #FFF5F5; border-radius: var(--radius-sm); font-size: 14px; font-weight: 700; color: #9B2C2C; display: flex; flex-direction: column; gap: 4px; word-break: break-all;">
              <div>🔴 ${key} (${prop.description}) 누락</div>
              <div style="font-size: 13px; font-weight: 600; color: #742A2A;">
                해결: 구글 앱스 스크립트 에디터의 [프로젝트 설정 > 스크립트 속성]에 '${key}' 값을 정확히 추가해 주세요.
              </div>
            </div>
          `;
        } else if (prop.status === 'INFO') {
          itemsHtml += `
            <div style="padding: 10px; border: 2.5px solid var(--border-color); background-color: #F8FAFC; border-radius: var(--radius-sm); font-size: 14px; font-weight: 700; color: var(--text-muted); display: flex; justify-content: space-between; align-items: center; gap: 8px;">
              <span style="min-width: 0; word-break: break-all;">⚪ ${key} (${prop.description}) 미설정 (선택 사항)</span>
              <span style="font-size: 12px; color: var(--text-muted); font-weight: 950; background-color: #EDF2F7; padding: 2px 8px; border-radius: 999px; border: 1.5px solid var(--border-color); flex-shrink: 0; white-space: nowrap;">선택</span>
            </div>
          `;
        } else {
          itemsHtml += `
            <div style="padding: 10px; border: 2.5px solid var(--border-color); background-color: white; border-radius: var(--radius-sm); font-size: 14px; font-weight: 700; color: var(--text-main); display: flex; justify-content: space-between; align-items: center; gap: 8px;">
              <span style="min-width: 0; word-break: break-all;">🟢 ${key} (${prop.description})</span>
              <span style="font-size: 12px; color: #2B6CB0; font-weight: 950; background-color: #EBF8FF; padding: 2px 8px; border-radius: 999px; border: 1.5px solid #BEE3F8; flex-shrink: 0; white-space: nowrap;">설정됨</span>
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
  if (typeof updateAdminTokenStatus === 'function') {
    updateAdminTokenStatus();
  }
  runSystemDiagnosis();
}

let currentUsers = [];
let currentSnacks = [];
let currentApplications = [];
let currentApplicationFilter = 'ALL';
let currentApplicationDetail = null;
let guestApplicationsLoaded = false;
let guestApplicationSettingsDirty = false;
let isModalOpen = false;
let isSubmitting = false;
let activeGaugeEdit = null;
const ADMIN_UI_MAX_USER_CREDIT = 15;
const ADMIN_UI_MAX_SNACK_STOCK = 30;
const ADMIN_TOKEN_STORAGE_KEY = AdminAuth.storageKey;

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

function gaugeRangeId(type, id) {
  return `gauge-range-${type}-${encodeURIComponent(String(id ?? ''))}`;
}

function gaugeOutputId(type, id) {
  return `gauge-output-${type}-${encodeURIComponent(String(id ?? ''))}`;
}

function getGaugeEditorMax(type, value) {
  return type === 'user' ? ADMIN_UI_MAX_USER_CREDIT : ADMIN_UI_MAX_SNACK_STOCK;
}

function getGaugeVisual(type, value) {
  const numericValue = Math.max(0, Number(value) || 0);
  const percent = Math.min(numericValue / 10, 1) * 100;
  let color = '#D69E2E';
  if (type === 'user') {
    if (numericValue === 0) color = '#DC2626';
    else if (numericValue <= 3) color = '#F59E0B';
    else color = '#D69E2E';
  } else if (numericValue >= 10) {
    color = '#38A169';
  } else if (numericValue >= 4) {
    color = '#D69E2E';
  } else if (numericValue > 0) {
    color = '#E53E3E';
  }
  return { percent, color };
}

function gaugeValueLabel(type, value) {
  const numericValue = Math.max(0, Number(value) || 0);
  return type === 'user' ? `🪙 ${numericValue}` : `${numericValue}개`;
}

function renderGaugeControl(type, id, value, label) {
  const stringId = String(id ?? '');
  const numericValue = Math.max(0, Number(value) || 0);
  const isEditing = activeGaugeEdit && activeGaugeEdit.type === type && activeGaugeEdit.id === stringId;
  const displayValue = isEditing ? activeGaugeEdit.draftValue : numericValue;
  const visual = getGaugeVisual(type, displayValue);
  const rangeId = gaugeRangeId(type, stringId);
  const outputId = gaugeOutputId(type, stringId);
  const rowKey = attr(`${type}:${stringId}`);

  if (isEditing) {
    const max = getGaugeEditorMax(type, displayValue);
    const editorValue = Math.min(max, Math.max(0, Number(displayValue) || 0));
    return `
      <div class="admin-gauge-editor" data-gauge-edit-row="${rowKey}">
        <input type="range" id="${attr(rangeId)}" class="admin-gauge-range ${type}" min="0" max="${max}" step="1" value="${editorValue}" aria-label="${attr(label)} 조정" oninput="${callAttr(`previewGaugeValue(${jsString(type)}, ${jsString(stringId)}, this.value, this)`)}">
        <output id="${attr(outputId)}" class="admin-gauge-output" for="${attr(rangeId)}">${esc(gaugeValueLabel(type, editorValue))}</output>
      </div>
    `;
  }

  return `
    <div class="admin-gauge-control ${type}" aria-label="${attr(label)} ${attr(gaugeValueLabel(type, numericValue))}">
      <div class="admin-stock-gauge-wrapper admin-gauge-display" title="${attr(label)}: ${numericValue} (기준: 10)">
        ${numericValue > 0 ? `<div class="admin-stock-gauge-fill" style="width: ${visual.percent}%; background-color: ${visual.color};"></div>` : ''}
      </div>
      <strong class="admin-gauge-value ${numericValue === 0 ? 'is-zero' : ''}">${esc(gaugeValueLabel(type, numericValue))}</strong>
    </div>
  `;
}

function previewGaugeValue(type, id, value, input) {
  const numericValue = Math.max(0, Number(value) || 0);
  const output = document.getElementById(gaugeOutputId(type, id));
  if (activeGaugeEdit && activeGaugeEdit.type === type && activeGaugeEdit.id === String(id)) {
    activeGaugeEdit.draftValue = numericValue;
  }
  if (output) output.textContent = gaugeValueLabel(type, numericValue);
}

function getGaugeSource(type, id) {
  const collection = type === 'user' ? currentUsers : currentSnacks;
  return collection.find(item => String(type === 'user' ? item.userId : item.snackId) === String(id)) || null;
}

function getGaugeSourceValue(type, item) {
  return Number(item?.[type === 'user' ? 'credit' : 'stock'] || 0);
}

function renderActiveGaugeTable(type) {
  if (type === 'user') renderUsersManagement(currentUsers);
  else renderSnacksManagement(currentSnacks);
}

function beginGaugeEdit(type, id) {
  const stringId = String(id ?? '');
  const source = getGaugeSource(type, stringId);
  if (!source) return;
  if (activeGaugeEdit && (activeGaugeEdit.type !== type || activeGaugeEdit.id !== stringId)) {
    const currentInput = document.getElementById(gaugeRangeId(activeGaugeEdit.type, activeGaugeEdit.id));
    const currentValue = Number(currentInput?.value ?? activeGaugeEdit.originalValue);
    if (currentValue !== activeGaugeEdit.originalValue && !confirm('현재 변경 내용을 버릴까요?')) return;
  }
  const originalValue = getGaugeSourceValue(type, source);
  activeGaugeEdit = { type, id: stringId, originalValue, draftValue: originalValue };
  renderActiveGaugeTable(type);
  requestAnimationFrame(() => document.getElementById(gaugeRangeId(type, stringId))?.focus());
}

function cancelGaugeEdit(type, id) {
  if (!activeGaugeEdit || activeGaugeEdit.type !== type || activeGaugeEdit.id !== String(id)) return;
  activeGaugeEdit = null;
  renderActiveGaugeTable(type);
}

async function confirmGaugeEdit(type, id) {
  if (!activeGaugeEdit || activeGaugeEdit.type !== type || activeGaugeEdit.id !== String(id)) return;
  if (isSubmitting) return;
  isSubmitting = true;
  const input = document.getElementById(gaugeRangeId(type, id));
  const limit = type === 'user' ? ADMIN_UI_MAX_USER_CREDIT : ADMIN_UI_MAX_SNACK_STOCK;
  const value = Math.min(limit, Math.max(0, Number(input?.value || 0)));
  const editState = activeGaugeEdit;
  activeGaugeEdit = null;
  try {
    const success = type === 'user'
      ? await updateUserCreditAction(id, value)
      : await updateSnackStockAction(id, value);
    if (!success) {
      activeGaugeEdit = editState;
      renderActiveGaugeTable(type);
    }
  } finally {
    isSubmitting = false;
  }
}

function closeGaugeEditFromOutside(event) {
  if (!activeGaugeEdit || event.target.closest('[data-gauge-edit-row]') || event.target.closest('.admin-table')) return;
  const input = document.getElementById(gaugeRangeId(activeGaugeEdit.type, activeGaugeEdit.id));
  const currentValue = Number(input?.value ?? activeGaugeEdit.originalValue);
  if (currentValue !== activeGaugeEdit.originalValue && !confirm('변경 내용을 저장하지 않고 나갈까요?')) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const type = activeGaugeEdit.type;
  activeGaugeEdit = null;
  renderActiveGaugeTable(type);
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

const APPLICATION_STATUS_META = {
  PENDING: { label: '검토 중', className: 'pending' },
  WAITLIST: { label: '대기', className: 'waitlist' },
  APPROVED: { label: '승인', className: 'approved' },
  REJECTED: { label: '반려', className: 'rejected' },
  INACTIVE: { label: '중지', className: 'inactive' }
};

const APPLICATION_RELATION_LABEL = {
  VOLUNTEER: '봉사자',
  SPONSOR: '후원자',
  OTHER: '기타'
};

function formatApplicationDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function getApplicationStatusMeta(status) {
  return APPLICATION_STATUS_META[status] || { label: status || '미정', className: 'inactive' };
}

function setApplicationCount(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(Number(value) || 0);
}

function updateApplicationCounts(counts = {}) {
  setApplicationCount('application-count-all', counts.ALL);
  setApplicationCount('application-count-pending', counts.PENDING);
  setApplicationCount('application-count-waitlist', counts.WAITLIST);
  setApplicationCount('application-count-approved', counts.APPROVED);
  setApplicationCount('application-count-rejected', counts.REJECTED);
  setApplicationCount('application-count-inactive', counts.INACTIVE);
}

function renderGuestApplicationSettings(settings) {
  if (!settings) return;
  const capacitySummary = document.getElementById('application-capacity-summary');
  if (capacitySummary) {
    const capacity = Math.max(1, Number(settings.capacity) || 5);
    const activeCount = Math.max(0, Number(settings.activeCount) || 0);
    const remainingSlots = Math.max(0, Number(settings.remainingSlots) || 0);
    const waitlistCount = Math.max(0, Number(settings.waitlistCount) || 0);
    const waitlistFull = settings.waitlistFull === true;
    const parts = [];
    parts.push(`1차 ${capacity}명 · 접수 ${activeCount}명`);
    if (waitlistCount > 0) parts.push(`대기 ${waitlistCount}명`);
    if (!waitlistFull && !settings.applicationFull) parts.push(`남음 ${remainingSlots}명`);
    if (waitlistFull) parts.push('대기 포화');
    else if (settings.applicationFull) parts.push('정원 마감');
    capacitySummary.textContent = parts.join(' · ');
    capacitySummary.classList.toggle('full', settings.applicationFull === true || waitlistFull);
  }
  if (guestApplicationSettingsDirty) return;
  const setValue = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.value = value || '';
  };
  const openInput = document.getElementById('application-setting-open');
  const configuredOpen = settings.applicationOpenConfigured === undefined
    ? settings.applicationOpen === true
    : settings.applicationOpenConfigured === true;
  if (openInput) openInput.checked = configuredOpen;
  setValue('application-setting-capacity', settings.capacity || 5);
  setValue('application-setting-target', settings.target);
  setValue('application-setting-days', settings.operatingDays);
  setValue('application-setting-order-time', settings.orderTime);
  setValue('application-setting-delivery-time', settings.deliveryTime);
  setValue('application-setting-area', settings.serviceArea);
  setValue('application-setting-usage', settings.usageGuide);
  setValue('application-setting-day-options', (settings.preferredDayOptions || []).join(', '));
  setValue('application-setting-closed-message', settings.configuredClosedMessage || settings.closedMessage);
}

function renderGuestApplications(applications) {
  const container = document.getElementById('application-list');
  if (!container) return;
  if (!applications.length) {
    container.innerHTML = '<div class="application-empty">이 상태의 이용 신청이 없습니다.</div>';
    return;
  }

  container.innerHTML = applications.map(application => {
    const status = getApplicationStatusMeta(application.status);
    const relation = APPLICATION_RELATION_LABEL[application.relationType] || application.relationType || '-';
    const contacted = application.contactedAt ? '연락 완료' : '연락 전';
    var positionLabel = '';
    if (application.status === 'WAITLIST' && application.waitlistPosition) {
      positionLabel = '대기 순번: #' + application.waitlistPosition;
    }
    var cooldownLabel = '';
    if (application.cooldownUntil) {
      cooldownLabel = '⏳ 쿨다운: ' + formatApplicationDate(application.cooldownUntil);
    }
    var skipLabel = '';
    if (application.skipUntil) {
      skipLabel = '⏭ 건너뛰기: ' + formatApplicationDate(application.skipUntil);
    }
    return `
      <article class="application-card ${status.className}">
        <div class="application-card-main">
          <div class="application-card-title">
            <span>${esc(application.name || '이름 없음')}</span>
            <span class="application-status-badge ${status.className}">${esc(status.label)}</span>
            ${application.anonymizedAt ? '<span class="application-status-badge inactive">익명화</span>' : ''}
          </div>
          <div class="application-card-meta">
            <span>${esc(application.applicationId)}</span>
            <span>${esc(formatApplicationDate(application.createdAt))}</span>
            <span>${esc(relation)} · ${esc(application.phoneMasked || '-')}</span>
            <span>${esc(application.deliverySummary || '-')}</span>
            <span>희망: ${esc(application.preferredDays || '-')}</span>
            <span>${esc(contacted)}</span>
            ${positionLabel ? '<span style="color:#7C3AED; font-weight:900;">' + esc(positionLabel) + '</span>' : ''}
            ${cooldownLabel ? '<span style="color:#6B7280; font-weight:700;">' + esc(cooldownLabel) + '</span>' : ''}
            ${skipLabel ? '<span style="color:#EA6A17; font-weight:700;">' + esc(skipLabel) + '</span>' : ''}
          </div>
        </div>
        <button class="application-card-action" type="button" onclick="${callAttr(`openGuestApplicationDetail(${jsString(application.applicationId)})`)}">상세</button>
      </article>
    `;
  }).join('');
}

async function loadGuestApplications(status = currentApplicationFilter) {
  const container = document.getElementById('application-list');
  if (!AdminAuth.isUnlocked()) {
    AdminAuth.focus('신청 목록을 보려면 관리자 로그인이 필요합니다.');
    return;
  }
  currentApplicationFilter = status || 'ALL';
  document.querySelectorAll('[data-application-filter]').forEach(button => {
    button.classList.toggle('active', button.dataset.applicationFilter === currentApplicationFilter);
  });
  if (container) container.innerHTML = '<div class="application-loading">신청 목록을 불러오고 있습니다.</div>';

  try {
    const res = await fetchAPI('getGuestApplicationsForAdmin', {
      method: 'POST',
      body: {
        adminToken: getAdminToken(),
        status: currentApplicationFilter
      }
    });
    if (!res?.success) {
      clearAdminTokenIfDenied(res);
      if (container) container.innerHTML = `<div class="application-error">${esc(res?.message || '신청 목록을 불러오지 못했습니다.')}</div>`;
      return;
    }
    currentApplications = Array.isArray(res.applications) ? res.applications : [];
    updateApplicationCounts(res.counts);
    renderGuestApplicationSettings(res.settings);
    renderGuestApplications(currentApplications);
    guestApplicationsLoaded = true;
  } catch (error) {
    if (container) container.innerHTML = '<div class="application-error">신청 목록을 불러오는 중 오류가 발생했습니다.</div>';
  }
}

function applicationDetailItem(label, value, full = false) {
  return `
    <div class="application-detail-item ${full ? 'full' : ''}">
      <span class="application-detail-label">${esc(label)}</span>
      <div class="application-detail-value">${esc(value || '-')}</div>
    </div>
  `;
}

function renderGuestApplicationDetail(application) {
  const container = document.getElementById('application-detail-content');
  if (!container) return;
  const status = getApplicationStatusMeta(application.status);
  const relation = APPLICATION_RELATION_LABEL[application.relationType] || application.relationType || '-';
  var items = [
    applicationDetailItem('신청번호', application.applicationId),
    applicationDetailItem('상태', status.label),
    applicationDetailItem('신청 시각', formatApplicationDate(application.createdAt)),
    applicationDetailItem('개인정보 동의', formatApplicationDate(application.consentAt)),
    applicationDetailItem('이름', application.name),
    applicationDetailItem('복지관과의 관계', relation + (application.relationDetail ? ' · ' + application.relationDetail : '')),
    applicationDetailItem('연락처', application.phone),
    applicationDetailItem('희망 요일', application.preferredDays),
    applicationDetailItem('배달 장소', application.deliveryPlace, true),
    applicationDetailItem('상세 위치·전달 방법', application.deliveryDetail, true),
    applicationDetailItem('전달할 내용', application.message, true),
  ];
  if (application.waitlistPosition && application.status === 'WAITLIST') {
    items.push(applicationDetailItem('대기 순번', '#' + application.waitlistPosition));
  }
  if (application.cooldownUntil) {
    items.push(applicationDetailItem('쿨다운 만료', formatApplicationDate(application.cooldownUntil)));
  }
  if (application.skipUntil) {
    items.push(applicationDetailItem('건너뛰기 만료', formatApplicationDate(application.skipUntil)));
  }
  items.push(
    applicationDetailItem('연락 완료', formatApplicationDate(application.contactedAt)),
    applicationDetailItem('검토 시각', formatApplicationDate(application.reviewedAt)),
    applicationDetailItem('개인정보 만료 예정', formatApplicationDate(application.retentionUntil)),
    applicationDetailItem('익명화 시각', formatApplicationDate(application.anonymizedAt))
  );
  container.innerHTML = items.join('');
  const memo = document.getElementById('application-detail-memo');
  if (memo) {
    memo.value = application.adminMemo || '';
    memo.disabled = Boolean(application.anonymizedAt);
  }
  document.querySelectorAll('[data-application-action], #btn-application-contacted, #btn-application-skip, #btn-save-application-memo').forEach(button => {
    button.disabled = Boolean(application.anonymizedAt);
  });
  const contactedButton = document.getElementById('btn-application-contacted');
  if (contactedButton) contactedButton.textContent = application.contactedAt ? '연락 표시 취소' : '연락 완료';
  const skipButton = document.getElementById('btn-application-skip');
  if (skipButton) {
    skipButton.style.display = (application.status === 'APPROVED' || application.status === 'WAITLIST') ? '' : 'none';
  }
}

async function openGuestApplicationDetail(applicationId, options = {}) {
  const modal = document.getElementById('modal-guest-application');
  const content = document.getElementById('application-detail-content');
  if (!modal || !content) return;
  modal.style.display = 'flex';
  isModalOpen = true;
  if (!options.quiet) {
    content.innerHTML = '<div class="application-loading">상세 정보를 불러오고 있습니다.</div>';
  }
  try {
    const res = await fetchAPI('getGuestApplicationDetail', {
      method: 'POST',
      body: { adminToken: getAdminToken(), applicationId }
    });
    if (!res?.success) {
      clearAdminTokenIfDenied(res);
      content.innerHTML = `<div class="application-error">${esc(res?.message || '상세 정보를 불러오지 못했습니다.')}</div>`;
      return;
    }
    currentApplicationDetail = res.application;
    renderGuestApplicationDetail(currentApplicationDetail);
  } catch (error) {
    content.innerHTML = '<div class="application-error">상세 정보를 불러오는 중 오류가 발생했습니다.</div>';
  }
}

function closeGuestApplicationModal() {
  const modal = document.getElementById('modal-guest-application');
  if (modal) modal.style.display = 'none';
  currentApplicationDetail = null;
  isModalOpen = false;
}

async function updateCurrentGuestApplication(patch) {
  if (!currentApplicationDetail) return;
  if (isSubmitting) return;
  isSubmitting = true;
  const applicationId = currentApplicationDetail.applicationId;
  const memo = document.getElementById('application-detail-memo')?.value.trim() || '';
  const modalButtons = document.querySelectorAll('.application-modal-actions button');
  modalButtons.forEach(b => { b.disabled = true; });

  try {
    const res = await fetchAPI('updateGuestApplication', {
      method: 'POST',
      body: {
        adminToken: getAdminToken(),
        applicationId,
        adminMemo: memo,
        ...patch
      }
    });
    if (!res?.success) {
      clearAdminTokenIfDenied(res);
      alert(res?.message || '신청 정보 저장에 실패했습니다.');
      return;
    }
    closeGuestApplicationModal();
    await loadGuestApplications();
    } catch (error) {
      alert('신청 정보 저장 중 오류가 발생했습니다.');
  } finally {
    modalButtons.forEach(b => { b.disabled = false; });
    isSubmitting = false;
  }
}

async function saveGuestApplicationSettings() {
  if (isSubmitting) return;
  isSubmitting = true;
  const button = document.getElementById('btn-save-application-settings');
  if (button) button.disabled = true;
  try {
    const capacityInput = document.getElementById('application-setting-capacity');
    if (!capacityInput?.reportValidity()) return;
    const readValue = id => document.getElementById(id)?.value.trim() || '';
    const res = await fetchAPI('updateGuestApplicationSettings', {
      method: 'POST',
      body: {
        adminToken: getAdminToken(),
        applicationOpen: Boolean(document.getElementById('application-setting-open')?.checked),
        capacity: readValue('application-setting-capacity'),
        target: readValue('application-setting-target'),
        operatingDays: readValue('application-setting-days'),
        orderTime: readValue('application-setting-order-time'),
        deliveryTime: readValue('application-setting-delivery-time'),
        serviceArea: readValue('application-setting-area'),
        usageGuide: readValue('application-setting-usage'),
        preferredDayOptions: readValue('application-setting-day-options'),
        closedMessage: readValue('application-setting-closed-message')
      }
    });
    if (!res?.success) {
      clearAdminTokenIfDenied(res);
      alert(res?.message || '신청 설정 저장에 실패했습니다.');
      return;
    }
    guestApplicationSettingsDirty = false;
    alert(res.message || '신청 설정이 저장되었습니다.');
    await loadGuestApplications();
  } catch (error) {
    alert('신청 설정 저장 중 오류가 발생했습니다.');
  } finally {
    if (button) button.disabled = false;
    isSubmitting = false;
  }
}

async function auditGuestApplicationRetention() {
  const result = document.getElementById('application-retention-result');
  if (result) result.textContent = '만료 신청 정보를 점검하고 있습니다.';
  const res = await fetchAPI('auditExpiredGuestApplications', {
    method: 'POST',
    body: { adminToken: getAdminToken() }
  });
  if (!res?.success) {
    clearAdminTokenIfDenied(res);
    if (result) result.textContent = res?.message || '만료 점검에 실패했습니다.';
    return;
  }
  const ids = (res.applications || []).map(item => `${item.applicationId} (${formatApplicationDate(item.retentionUntil)})`);
  if (result) result.textContent = ids.length ? `${res.message} ${ids.join(', ')}` : res.message;
}

async function anonymizeGuestApplications() {
  if (isSubmitting) return;
  isSubmitting = true;
  try {
    const confirmInput = document.getElementById('application-anonymize-confirm');
    const confirmText = confirmInput?.value.trim() || '';
    if (confirmText !== '신청정보정리') {
      alert('확인 문구 신청정보정리를 정확히 입력해 주세요.');
      confirmInput?.focus();
      return;
    }
    if (!confirm('만료된 신청의 이름·연락처·장소·메모를 되돌릴 수 없게 익명화할까요?')) return;
    const res = await fetchAPI('anonymizeExpiredGuestApplications', {
      method: 'POST',
      body: { adminToken: getAdminToken(), confirmText }
    });
    if (!res?.success) {
      clearAdminTokenIfDenied(res);
      alert(res?.message || '익명화에 실패했습니다.');
      return;
    }
    if (confirmInput) confirmInput.value = '';
    alert(res.message);
    await auditGuestApplicationRetention();
    await loadGuestApplications();
  } finally {
    isSubmitting = false;
  }
}

// 탭 전환 기능
function switchTab(tabId) {
  const contents = document.querySelectorAll('.admin-tab-content');
  contents.forEach(c => c.classList.remove('active'));
  
  const buttons = document.querySelectorAll('.admin-tab-btn');
  buttons.forEach(b => b.classList.remove('active'));
  
  const targetTab = document.getElementById(tabId);
  if (targetTab) {
    targetTab.classList.add('active');
  }
  
  const targetBtn = document.getElementById(`btn-${tabId}`);
  if (targetBtn) {
    targetBtn.classList.add('active');
  }

  if (tabId === 'tab-applications' && !guestApplicationsLoaded) {
    loadGuestApplications();
  }
  
  AppState.vibrate(40);
  AppState.playClickSound();
}

// 관리자 기본 데이터 로드
async function loadAdminData() {
  const stockListEl = document.getElementById('snack-stock-list');
  if (stockListEl) {
    stockListEl.innerHTML = '<div style="padding: 10px; text-align: center; font-weight: 700;">불러오는 중...</div>';
  }

  try {
    const [snacksRes, usersRes] = await Promise.all([
      fetchAPI('getSnacks', { params: { includeHidden: 'Y' } }),
      fetchAPI('getUsers', { params: { includeInactive: 'Y' } })
    ]);
    
    // 1. 이용자 데이터 처리
    if (usersRes && usersRes.success && Array.isArray(usersRes.users)) {
      currentUsers = usersRes.users;
      showUserApiWarningIfNeeded(currentUsers);
      renderUsersManagement(currentUsers);
    }

    // 2. 간식 재고 데이터 처리
    if (snacksRes && snacksRes.success && Array.isArray(snacksRes.snacks)) {
      currentSnacks = snacksRes.snacks;
      
      // --- 간식 ID 자동 채우기 보완 검사 로직 ---
      const snackWarningEl = document.getElementById('snack-api-warning');
      if (snackWarningEl) snackWarningEl.style.display = 'none';

      let hasEmptyId = false;
      let hasInvalidOrDuplicate = false;
      const idSet = new Set();

      for (const s of currentSnacks) {
        if (!s.snackId && s.snackId !== 0) {
          hasEmptyId = true;
        } else {
          if (isNaN(Number(s.snackId)) || String(s.snackId).trim() === '') {
            hasInvalidOrDuplicate = true;
          }
          if (idSet.has(String(s.snackId))) {
            hasInvalidOrDuplicate = true;
          }
          idSet.add(String(s.snackId));
        }
      }

      if (hasInvalidOrDuplicate) {
        if (snackWarningEl) {
          snackWarningEl.style.display = 'block';
          snackWarningEl.style.color = '#9B2C2C';
          snackWarningEl.style.backgroundColor = '#FFF5F5';
          snackWarningEl.style.borderColor = '#FEB2B2';
          snackWarningEl.innerHTML = '⚠️ <b>경고:</b> 간식 목록에 <b>숫자가 아닌 ID</b>나 <b>중복된 ID</b>가 존재합니다. 시트를 직접 확인해주세요.';
        }
      } else if (hasEmptyId) {
        // 빈 ID가 존재하고, 유효성 오류가 없으면 자동 채우기 API 호출
        try {
          const adminToken = getAdminToken();
          const autoFillRes = await fetchAPI('autoFillEmptySnackIds', {
            method: 'POST',
            body: { adminToken, adminMemo: '빈 간식ID 자동 채우기' }
          });
          
          if (autoFillRes && autoFillRes.success && autoFillRes.filledCount > 0) {
            if (snackWarningEl) {
              snackWarningEl.style.display = 'block';
              snackWarningEl.style.color = '#22543D';
              snackWarningEl.style.backgroundColor = '#F0FFF4';
              snackWarningEl.style.borderColor = '#9AE6B4';
              snackWarningEl.innerHTML = `✅ <b>알림:</b> ${autoFillRes.filledCount}개의 빈 간식ID를 자동으로 채웠습니다.`;
            }
            // 간식 목록 다시 불러오기
            const reSnacksRes = await fetchAPI('getSnacks', { params: { includeHidden: 'Y' } });
            if (reSnacksRes && reSnacksRes.success && Array.isArray(reSnacksRes.snacks)) {
              currentSnacks = reSnacksRes.snacks;
            }
          } else if (autoFillRes && autoFillRes.hasError) {
            if (snackWarningEl) {
              snackWarningEl.style.display = 'block';
              snackWarningEl.style.color = '#9B2C2C';
              snackWarningEl.style.backgroundColor = '#FFF5F5';
              snackWarningEl.style.borderColor = '#FEB2B2';
              snackWarningEl.innerHTML = `⚠️ <b>경고:</b> ${autoFillRes.message}`;
            }
          }
        } catch (e) {
          console.error("간식 ID 자동 채우기 중 오류:", e);
        }
      }
      // ---------------------------------------------

      renderSnacksStock(currentSnacks);
      renderSnacksManagement(currentSnacks);
    } else {
      throw new Error('간식 API 응답 결과가 올바르지 않습니다.');
    }

    // 3. 게스트 운영 설정 갱신
    loadGuestOpsPanel();
  } catch (error) {
    console.error('관리자 데이터 조회 실패:', error);
    const errorTargets = [
      { el: document.getElementById('user-management-body'), cols: 6 },
      { el: document.getElementById('snack-management-body'), cols: 6 }
    ];
    errorTargets.forEach(t => {
      if (t.el) {
        t.el.innerHTML = `<tr><td colspan="${t.cols}" style="text-align: center; color: var(--danger-color); padding: 20px; font-weight: 700;">데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</td></tr>`;
      }
    });
    if (stockListEl) {
      stockListEl.innerHTML = `<div style="padding: 10px; text-align: center; color: var(--danger-color); font-weight: 700;">불러오기 실패</div>`;
    }
  }
}

function showUserApiWarningIfNeeded(users) {
  const warningEl = document.getElementById('user-api-warning');
  if (!warningEl) return;

  const hasUseYnField = users.some(user => Object.prototype.hasOwnProperty.call(user, 'useYn'));
  if (!hasUseYnField) {
    warningEl.textContent = 'Apps Script가 예전 버전입니다. 비활성 이용자를 보려면 google-apps-script.md의 최신 코드로 Apps Script를 다시 배포해 주세요.';
    warningEl.style.display = 'block';
  } else {
    warningEl.style.display = 'none';
  }
}

function renderReviews(reviews) {
  const tbody = document.getElementById('review-table-body');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (reviews.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">등록된 후기가 없습니다.</td></tr>';
    return;
  }
  
  reviews.forEach(review => {
    const tr = document.createElement('tr');
    
    const isPub = review.isPublic === true || String(review.isPublic).toUpperCase() === 'TRUE' || review.isPublic === 'Y';
    const pubLabel = isPub ? '공개' : '비공개';
    const pubClass = isPub ? 'active' : 'inactive';
    const rawDate = review.createdAt ? new Date(review.createdAt) : null;
    let formattedDate = review.createdAt || '-';
    if (rawDate && !isNaN(rawDate.getTime())) {
      formattedDate = `${rawDate.toLocaleDateString()} ${String(rawDate.getHours()).padStart(2, '0')}:${String(rawDate.getMinutes()).padStart(2, '0')}`;
    }
    
    const photoHtml = review.imageUrl
      ? `<a href="${AppState.escapeAttr(review.imageUrl)}" target="_blank" title="원본 이미지 보기" style="display: inline-block;">
           <img src="${AppState.escapeAttr(AppState.convertDriveImageUrl(review.imageUrl))}" style="width: 44px; height: 44px; object-fit: cover; border-radius: var(--radius-xs); border: 1.5px solid var(--border-color); display: block;" onerror="this.parentElement.style.display='none';">
         </a>`
      : '-';

    tr.innerHTML = `
      <td><strong>${esc(formattedDate)}</strong></td>
      <td><span style="font-family: monospace;">${esc(review.orderId)}</span></td>
      <td>${esc(review.guestName)}</td>
      <td><span style="background-color: #FFF3E0; border: 1.5px solid var(--primary-color); padding: 2px 8px; border-radius: 999px; font-size: 13px; font-weight: 800; color: #E65100;">${esc(review.stamp)}</span></td>
      <td>${esc(review.tags || '-')}</td>
      <td style="max-width: 250px; word-break: break-all;">${esc(review.comment || '-')}</td>
      <td style="text-align: center; vertical-align: middle;">${photoHtml}</td>
      <td style="text-align: center; vertical-align: middle;"><span class="status-badge ${pubClass}">${pubLabel}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// 현재 간식 재고 목록 렌더링
function renderSnacksStock(snacks) {
  const stockListEl = document.getElementById('snack-stock-list');
  if (!stockListEl) return;
  
  stockListEl.innerHTML = '';
  
  if (snacks.length === 0) {
    stockListEl.innerHTML = '<div class="empty-state">등록된 간식이 없습니다.</div>';
    return;
  }
  
  snacks.forEach(snack => {
    const item = document.createElement('div');
    item.className = 'stat-item';
    
    const isSoldOut = snack.stock === 0;
    const isActive = isSnackActive(snack);
    const stockText = `${isActive ? '' : '[숨김] '}${isSoldOut ? '품절' : `${snack.stock}개 남음`}`;
    const valColor = !isActive ? '#744210' : (isSoldOut ? 'var(--danger-color)' : 'var(--secondary-hover)');
    const fontWeight = isSoldOut ? '800' : '700';

    item.innerHTML = `
      <span class="stat-item-name">${esc(snack.name)}</span>
      <span class="stat-item-val" style="color: ${valColor}; font-weight: ${fontWeight};">${esc(stockText)}</span>
    `;
    stockListEl.appendChild(item);
  });
}

// --- 이용자 크레딧 관리 구현 ---
function renderUsersManagement(users) {
  const tbody = document.getElementById('user-management-body');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-state">이용자가 없습니다.</td></tr>';
    return;
  }
  
  const activeUsers = users.filter(user => isUserActive(user));
  const inactiveUsers = users.filter(user => !isUserActive(user));

  appendUserGroupRows(tbody, '활성 이용자', activeUsers);

  const showInactive = document.getElementById('toggle-inactive-users')?.checked ?? false;
  if (showInactive) {
    appendUserGroupRows(tbody, '비활성 이용자', inactiveUsers);
  }
}

function isUserActive(user) {
  const active = String(user.useYn ?? user.active ?? 'Y').trim().toUpperCase();
  return active === 'TRUE' || active === '사용' || active === 'Y' || active === 'O' || active === '예';
}

function appendUserGroupRows(tbody, title, users) {
  const groupRow = document.createElement('tr');
  groupRow.className = 'user-group-row';
  groupRow.innerHTML = `<td colspan="3">${esc(title)} <span style="color: var(--text-muted); font-size: 14px;">${users.length}명</span></td>`;
  tbody.appendChild(groupRow);

  if (users.length === 0) {
    const emptyRow = document.createElement('tr');
    emptyRow.innerHTML = `<td colspan="3" class="empty-state">${esc(title)}가 없습니다.</td>`;
    tbody.appendChild(emptyRow);
    return;
  }

  users.forEach(user => {
    const tr = document.createElement('tr');
    tr.setAttribute('data-user-row', String(user.userId ?? ''));
    const isActive = isUserActive(user);
    
    const colors = ['#FF9F1C', '#2EC4B6', '#118AB2', '#FF5A5F', '#8338EC', '#3A86C8'];
    const colorIndex = Math.abs(String(user.nickname || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % colors.length;
    const avatarBgColor = colors[colorIndex];
    
    const rawImgUrl = user.imageUrl || '';
    const imgUrl = rawImgUrl ? AppState.convertDriveImageUrl(rawImgUrl) : '';
    const userId = String(user.userId ?? '');
    const nickname = String(user.nickname ?? '');
    const credit = Number(user.credit || 0);
    const safeNickname = esc(nickname);
    const safeInitial = esc(nickname.charAt(0) || '?');
    const safeImgUrl = attr(imgUrl);
    const safeAvatarBgColor = attr(avatarBgColor);
    const userIdArg = jsString(userId);
    const avatarHtml = imgUrl 
      ? `<img src="${safeImgUrl}" class="admin-avatar" style="width: 36px; height: 36px;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="admin-avatar-initial" style="background-color: ${safeAvatarBgColor}; display: none; width: 36px; height: 36px; font-size: 16px;">${safeInitial}</div>`
      : `<div class="admin-avatar-initial" style="background-color: ${safeAvatarBgColor}; width: 36px; height: 36px; font-size: 16px;">${safeInitial}</div>`;

    tr.innerHTML = `
      <td onclick="${callAttr(`openEditUserModal(${userIdArg})`)}" class="admin-clickable-cell user-identity-cell">
        <div class="user-identity-content">
          ${avatarHtml}
          <strong>${safeNickname} 님</strong>
        </div>
      </td>
      <td class="user-credit-cell" aria-label="보유 크레딧 ${credit}개" style="font-weight: 800; font-size: 18px; color: var(--primary-color);">${renderGaugeControl('user', userId, credit, `${nickname} 보유 크레딧`)}</td>
      <td class="user-manage-cell" style="text-align: center;">
        ${activeGaugeEdit?.type === 'user' && activeGaugeEdit.id === userId
          ? `<div class="admin-flex-nowrap gauge-action-group"><button type="button" class="btn-small-action gauge-confirm-btn" onclick="${callAttr(`confirmGaugeEdit('user', ${userIdArg})`)}">확인</button><button type="button" class="gauge-cancel-btn" onclick="${callAttr(`cancelGaugeEdit('user', ${userIdArg})`)}">취소</button></div>`
          : `<button class="btn-small-action admin-row-action gauge-edit-trigger" style="background-color: var(--secondary-color);" title="${safeNickname} 크레딧 수정" onclick="${callAttr(`beginGaugeEdit('user', ${userIdArg})`)}">수정</button>`}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function setUserRowLoading(userId, isLoading) {
  const tr = document.querySelector(`tr[data-user-row="${userId}"]`);
  if (tr) {
    if (isLoading) tr.classList.add('row-loading');
    else tr.classList.remove('row-loading');
  }
}

function setSnackRowLoading(snackId, isLoading) {
  const tr = document.querySelector(`tr[data-snack-row="${snackId}"]`);
  if (tr) {
    if (isLoading) tr.classList.add('row-loading');
    else tr.classList.remove('row-loading');
  }
}

async function updateUserCreditAction(userId, credit) {
  credit = Math.min(ADMIN_UI_MAX_USER_CREDIT, Math.max(0, Number(credit) || 0));
  setUserRowLoading(userId, true);
  try {
    const res = await fetchAPI('updateUserCredit', {
      method: 'POST',
      body: withAdminToken({ userId, credit })
    });
    if (res && res.success) {
      AppState.vibrate(50);
      AppState.playClickSound();
      await loadAdminData();
      return true;
    } else {
      clearAdminTokenIfDenied(res);
      alert("크레딧 반영에 실패했습니다: " + (res?.message || "오류"));
      return false;
    }
  } catch (error) {
    console.error("크레딧 업데이트 에러:", error);
    alert("크레딧 반영 중 통신 에러가 발생했습니다.");
    return false;
  } finally {
    setUserRowLoading(userId, false);
  }
}

async function addNewUserAction() {
  const nicknameInput = document.getElementById('new-user-nickname');
  const creditInput = document.getElementById('new-user-credit');
  const imageInput = document.getElementById('new-user-image');

  const nickname = nicknameInput.value.trim();
  const credit = Math.min(ADMIN_UI_MAX_USER_CREDIT, Math.max(0, Number(creditInput.value || 0)));
  const imageUrl = imageInput.value.trim();

  if (!nickname) {
    alert("이용자 별명을 입력해 주세요.");
    nicknameInput.focus();
    return;
  }

  // 중복 방지를 위한 버튼 비활성화 처리
  const submitBtn = document.querySelector('#modal-add-user button[onclick="addNewUserAction()"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '등록 중...';
  }

  try {
    const res = await fetchAPI('addUser', {
      method: 'POST',
      body: withAdminToken({ nickname, credit, imageUrl, useYn: 'Y' })
    });

    if (res && res.success) {
      alert(`[${nickname}] 이용자를 등록했습니다.`);
      nicknameInput.value = '';
      creditInput.value = '10';
      imageInput.value = '';
      closeAddUserModal();
      AppState.vibrate(80);
      AppState.playClickSound();
      await loadAdminData();
    } else {
      clearAdminTokenIfDenied(res);
      alert("이용자 등록에 실패했습니다: " + (res?.message || "오류"));
    }
  } catch (error) {
    console.error("이용자 추가 에러:", error);
    alert("이용자 추가 중 통신 에러가 발생했습니다.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '등록하기';
    }
  }
}

// --- 간식 목록 및 재고 관리 구현 ---
// ── 간식 표시 순서 관리 (서버 G열 기반) ─────────────────────

/** displayOrder 필드 기준으로 snack 배열 정렬 */
function applySnackOrder(snacks) {
  return [...snacks].sort((a, b) => {
    const ao = Number(a.displayOrder) || 0;
    const bo = Number(b.displayOrder) || 0;
    if (ao === 0 && bo === 0) return 0; // 둘 다 0이면 원래 순서 유지
    if (ao === 0) return 1;  // 0(미설정)은 맨 뒤로
    if (bo === 0) return -1;
    return ao - bo;
  });
}

/** 현재 패널 순서를 서버에 저장 */
async function saveSnackOrderToServer(orderedIdList, target) {
  // orderedIdList: [snackId, snackId, ...] 배열 (1-based 순번을 displayOrder로 사용)
  const items = orderedIdList.map((snackId, idx) => ({
    snackId: snackId,
    displayOrder: idx + 1
  }));

  try {
    const res = await fetchAPI('updateSnacksOrder', {
      method: 'POST',
      body: withAdminToken({ items })
    });
    if (res && res.success) {
      // currentSnacks의 displayOrder를 메모리에도 반영
      items.forEach(({ snackId, displayOrder }) => {
        const s = currentSnacks.find(x => String(x.snackId) === String(snackId));
        if (s) s.displayOrder = displayOrder;
      });
      // 드래그&드롭 리스너 재등록을 위해 패널을 다시 렌더링
      renderSnackOrderPanel(currentSnacks, target);
      AppState.vibrate(30);
      return true;
    } else {
      clearAdminTokenIfDenied(res);
      alert('순서 저장 실패: ' + (res?.message || '오류'));
      return false;
    }
  } catch (err) {
    console.error('순서 저장 에러:', err);
    alert('순서 저장 중 통신 오류가 발생했습니다.');
    return false;
  }
}

async function resetSnackOrder(target) {
  if (!confirm(`[${target === 'guest' ? '게스트' : '일반'}] 표시 순서를 초기화(모두 0)할까요? 스프레드시트 등록 순서로 돌아갑니다.`)) return;
  // 해당 타깃의 판매중 간식만 displayOrder를 0으로 초기화
  const targetSnacks = currentSnacks.filter(s => isSnackActive(s) && (target === 'guest' ? s.target === 'guest' : s.target !== 'guest'));
  const items = targetSnacks.map(s => ({ snackId: s.snackId, displayOrder: 0 }));
  try {
    const res = await fetchAPI('updateSnacksOrder', {
      method: 'POST',
      body: withAdminToken({ items })
    });
    if (res && res.success) {
      targetSnacks.forEach(s => { s.displayOrder = 0; });
      renderSnackOrderPanel(currentSnacks, target);
      AppState.vibrate(40);
      AppState.playClickSound();
    } else {
      clearAdminTokenIfDenied(res);
      alert('초기화 실패: ' + (res?.message || '오류'));
    }
  } catch (err) {
    alert('초기화 중 통신 오류가 발생했습니다.');
  }
}

/** 순서 편집 패널 렌더링 — 판매중 간식만 표시 */
function renderSnackOrderPanel(snacks, target) {
  const listEl = document.getElementById(`${target}-snack-order-list`);
  if (!listEl) return;

  // ★ 해당 타깃의 판매중 간식만 필터링
  const targetSnacks = snacks.filter(s => isSnackActive(s) && (target === 'guest' ? s.target === 'guest' : s.target !== 'guest'));
  const sorted = applySnackOrder(targetSnacks);
  listEl.innerHTML = '';

  if (sorted.length === 0) {
    listEl.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--text-muted); font-weight: 700;">판매중인 간식이 없습니다.</div>';
    return;
  }

  sorted.forEach((snack, idx) => {
    const emoji = AppState.getSnackEmoji(snack.name);
    const item = document.createElement('div');
    item.className = 'snack-order-item';
    item.draggable = true;
    item.dataset.snackId = String(snack.snackId);
    item.innerHTML = `
      <span class="drag-handle" title="드래그로 이동">⠿</span>
      <span class="snack-order-rank">${idx + 1}</span>
      <span class="snack-order-emoji">${esc(emoji)}</span>
      <span class="snack-order-name">${esc(snack.name)}</span>
      <div class="snack-order-btns">
        <button class="snack-order-btn" type="button" title="위로 이동" aria-label="위로 이동" ${idx === 0 ? 'disabled' : ''} onclick="moveSnackOrder(this, -1, '${target}')">▲</button>
        <button class="snack-order-btn" type="button" title="아래로 이동" aria-label="아래로 이동" ${idx === sorted.length - 1 ? 'disabled' : ''} onclick="moveSnackOrder(this, 1, '${target}')">▼</button>
      </div>
    `;

    // 드래그&드롭
    item.addEventListener('dragstart', e => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(snack.snackId));
      setTimeout(() => item.classList.add('dragging'), 0);
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('dragover', e => { e.preventDefault(); item.classList.add('drag-over'); });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', async e => {
      e.preventDefault();
      item.classList.remove('drag-over');
      const fromId = e.dataTransfer.getData('text/plain');
      const toId = String(snack.snackId);
      if (fromId === toId) return;

      const items = [...listEl.querySelectorAll('.snack-order-item')];
      const ids = items.map(el => el.dataset.snackId);
      const fromIdx = ids.indexOf(String(fromId));
      const toIdx = ids.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return;

      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, String(fromId));
      renderSnackOrderPanelFromIds(ids, target);
      const saved = await saveSnackOrderToServer(ids, target);
      if (!saved) renderSnackOrderPanel(currentSnacks, target);
    });

    listEl.appendChild(item);
  });
}

/** id 배열 순서대로 패널을 즉시 재렌더 (서버 저장 전 미리보기) */
function renderSnackOrderPanelFromIds(ids, target) {
  const snackMap = {};
  currentSnacks.forEach(s => { snackMap[String(s.snackId)] = s; });
  const reordered = ids.map(id => snackMap[id]).filter(Boolean);
  const listEl = document.getElementById(`${target}-snack-order-list`);
  if (!listEl) return;
  listEl.innerHTML = '';
  reordered.forEach((snack, idx) => {
    const emoji = AppState.getSnackEmoji(snack.name);
    const item = document.createElement('div');
    item.className = 'snack-order-item';
    item.draggable = true;
    item.dataset.snackId = String(snack.snackId);
    item.innerHTML = `
      <span class="drag-handle">⠿</span>
      <span class="snack-order-rank">${idx + 1}</span>
      <span class="snack-order-emoji">${esc(emoji)}</span>
      <span class="snack-order-name">${esc(snack.name)}</span>
      <div class="snack-order-btns">
        <button class="snack-order-btn" type="button" title="위로 이동" aria-label="위로 이동" ${idx === 0 ? 'disabled' : ''} onclick="moveSnackOrder(this, -1, '${target}')">▲</button>
        <button class="snack-order-btn" type="button" title="아래로 이동" aria-label="아래로 이동" ${idx === reordered.length - 1 ? 'disabled' : ''} onclick="moveSnackOrder(this, 1, '${target}')">▼</button>
      </div>
    `;
    
    // 드래그&드롭 리스너는 여기서도 필요할 시 구성하나, moveSnackOrder 이후 renderSnackOrderPanel로 갱신되므로 기본 뼈대만 유지합니다.
    listEl.appendChild(item);
  });
}

async function moveSnackOrder(btn, dir, target) {
  const item = btn.closest('.snack-order-item');
  const listEl = item.parentElement;
  const items = [...listEl.querySelectorAll('.snack-order-item')];
  const ids = items.map(el => el.dataset.snackId);
  const idx = ids.indexOf(item.dataset.snackId);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= ids.length) return;
  [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];
  renderSnackOrderPanelFromIds(ids, target);
  const saved = await saveSnackOrderToServer(ids, target);
  if (!saved) renderSnackOrderPanel(currentSnacks, target);
  AppState.playClickSound();
}

function renderSnacksManagement(snacks) {
  // 순서 편집 패널 갱신
  renderSnackOrderPanel(snacks, 'user');
  renderSnackOrderPanel(snacks, 'guest');

  const tbody = document.getElementById('snack-management-body');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (snacks.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">등록된 간식이 없습니다.</td></tr>';
    return;
  }

  // 재고 관리 테이블도 displayOrder 기준으로 정렬
  const sorted = applySnackOrder(snacks);
  const targetFilterVal = document.getElementById('filter-target-snack')?.value || 'ALL';
  const matchesFilter = (s) => {
    if (targetFilterVal === 'ALL') return true;
    const tList = String(s.target || 'user').toLowerCase().split(',').map(x => x.trim());
    return tList.includes(targetFilterVal.toLowerCase());
  };
  const filteredSnacks = sorted.filter(matchesFilter);

  const isUserTarget = s => String(s.target || 'user').toLowerCase().split(',').map(x => x.trim()).includes('user');
  const isGuestOrEventTarget = s => {
    const tList = String(s.target || 'user').toLowerCase().split(',').map(x => x.trim());
    return tList.includes('guest') || tList.includes('event');
  };

  const activeUser = filteredSnacks.filter(s => isSnackActive(s) && isUserTarget(s));
  const activeGuest = filteredSnacks.filter(s => isSnackActive(s) && isGuestOrEventTarget(s));
  const hiddenUser = filteredSnacks.filter(s => !isSnackActive(s) && isUserTarget(s));
  const hiddenGuest = filteredSnacks.filter(s => !isSnackActive(s) && isGuestOrEventTarget(s));

  appendSnackGroupRows(tbody, '판매중 일반/키오스크 간식', activeUser);
  appendSnackGroupRows(tbody, '판매중 게스트/행사 간식', activeGuest);

  const showHidden = document.getElementById('toggle-hidden-snacks')?.checked ?? false;
  if (showHidden) {
    appendSnackGroupRows(tbody, '숨김 일반/키오스크 간식', hiddenUser);
    appendSnackGroupRows(tbody, '숨김 게스트/행사 간식', hiddenGuest);
  }
}

function isSnackActive(snack) {
  const active = String(snack.saleYn ?? snack.active ?? 'Y').trim().toUpperCase();
  return active === 'TRUE' || active === '판매' || active === 'Y' || active === 'O' || active === '예';
}

function appendSnackGroupRows(tbody, title, snacks) {
  const groupRow = document.createElement('tr');
  groupRow.className = 'user-group-row';
  groupRow.innerHTML = `<td colspan="4">${esc(title)} <span style="color: var(--text-muted); font-size: 14px;">${snacks.length}개</span></td>`;
  tbody.appendChild(groupRow);

  if (snacks.length === 0) {
    const emptyRow = document.createElement('tr');
    emptyRow.innerHTML = `<td colspan="4" class="empty-state">${esc(title)}이 없습니다.</td>`;
    tbody.appendChild(emptyRow);
    return;
  }

  snacks.forEach(snack => {
    const tr = document.createElement('tr');
    tr.setAttribute('data-snack-row', String(snack.snackId ?? ''));
    
    const isActive = isSnackActive(snack);
    const rawImgUrl = snack.imageUrl || '';
    const imgUrl = rawImgUrl ? AppState.convertDriveImageUrl(rawImgUrl) : '';
    const snackEmoji = AppState.getSnackEmoji(snack.name);
    const snackId = snack.snackId;
    const snackIdArg = jsString(snackId);
    const snackName = String(snack.name ?? '');
    const safeSnackName = esc(snackName);
    const safeImgUrl = attr(imgUrl);
    const safeSnackEmoji = esc(snackEmoji);
    const point = Number(snack.point || 0);
    const stock = Number(snack.stock || 0);

    const tList = String(snack.target || 'user').toLowerCase().split(',').map(x => x.trim());
    const targetBadges = [];
    if (tList.includes('user')) targetBadges.push('👤회원');
    if (tList.includes('guest')) targetBadges.push('🛵게스트');
    if (tList.includes('event')) targetBadges.push('🎉행사');
    const targetBadgeHtml = `<span style="font-size: 12px; font-weight: 700; color: var(--text-muted); margin-left: 6px;">(${targetBadges.join(', ')})</span>`;
    
    const imgHTML = imgUrl
      ? `<img src="${safeImgUrl}" class="admin-avatar" style="width: 36px; height: 36px; border-radius: 6px;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">`
      : ``;
    const emojiHTML = `<div class="admin-avatar-initial" style="background-color: #F1F5F9; border: 1.5px solid var(--border-color); color: var(--text-main); width: 36px; height: 36px; font-size: 18px; border-radius: 6px; display: flex; justify-content: center; align-items: center; ${imgUrl ? 'display:none;' : ''}">${safeSnackEmoji}</div>`;

    tr.innerHTML = `
      <td onclick="${callAttr(`openEditSnackModal(${snackIdArg})`)}" class="admin-clickable-cell snack-identity-cell">
        <div class="snack-identity-content">
          <div style="position: relative; width: 36px; height: 36px;">
            ${imgHTML}
            ${emojiHTML}
          </div>
          <div>
            <strong>${safeSnackName}</strong>
            ${targetBadgeHtml}
          </div>
        </div>
      </td>
      <td class="snack-stock-cell" style="text-align: center; vertical-align: middle;">
        <div class="admin-stock-gauge-container">
          ${renderGaugeControl('snack', snackId, stock, `${snackName} 재고`)}
        </div>
      </td>
      <td class="snack-price-cell" style="font-weight: 700; vertical-align: middle;">${point} 크레딧</td>
      <td class="snack-manage-cell" style="text-align: center; vertical-align: middle;">
        <div class="admin-flex-nowrap">
          ${activeGaugeEdit?.type === 'snack' && activeGaugeEdit.id === String(snackId)
            ? `<button type="button" class="btn-small-action gauge-confirm-btn" onclick="${callAttr(`confirmGaugeEdit('snack', ${snackIdArg})`)}">확인</button><button type="button" class="gauge-cancel-btn" onclick="${callAttr(`cancelGaugeEdit('snack', ${snackIdArg})`)}">취소</button>`
            : `<button class="btn-small-action admin-row-action gauge-edit-trigger" style="background-color: var(--secondary-color);" title="${safeSnackName} 재고 수정" onclick="${callAttr(`beginGaugeEdit('snack', ${snackIdArg})`)}">수정</button><button class="${isActive ? 'btn-danger-action' : 'btn-small-action'} admin-row-action" onclick="${callAttr(`updateSnackSaleAction(${snackIdArg}, ${isActive ? jsString('N') : jsString('Y')}, ${jsString(snackName)})`)}">${isActive ? '숨김' : '판매'}</button>`}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function updateSnackStockAction(snackId, stock) {
  stock = Math.min(ADMIN_UI_MAX_SNACK_STOCK, Math.max(0, Number(stock) || 0));
  setSnackRowLoading(snackId, true);
  try {
    const res = await fetchAPI('updateSnackStock', {
      method: 'POST',
      body: withAdminToken({ snackId, stock })
    });
    if (res && res.success) {
      AppState.vibrate(50);
      AppState.playClickSound();
      await loadAdminData();
      return true;
    } else {
      clearAdminTokenIfDenied(res);
      alert("재고 반영에 실패했습니다: " + (res?.message || "오류"));
      return false;
    }
  } catch (error) {
    console.error("재고 업데이트 에러:", error);
    alert("재고 반영 중 통신 에러가 발생했습니다.");
    return false;
  } finally {
    setSnackRowLoading(snackId, false);
  }
}

async function updateSnackSaleAction(snackId, saleYn, snackName) {
  const nextActive = String(saleYn).toUpperCase() === 'Y';
  const actionText = nextActive ? '판매중으로 변경' : '숨김 처리';
  const ok = confirm(`${snackName} 간식을 ${actionText}할까요?`);
  if (!ok) return;

  setSnackRowLoading(snackId, true);
  try {
    const res = await fetchAPI('updateSnackSale', {
      method: 'POST',
      body: withAdminToken({ snackId, saleYn })
    });
    if (res && res.success) {
      AppState.vibrate(50);
      AppState.playClickSound();
      await loadAdminData();
    } else {
      clearAdminTokenIfDenied(res);
      alert("간식 상태 변경에 실패했습니다: " + (res?.message || "오류"));
    }
  } catch (error) {
    console.error("간식 상태 변경 에러:", error);
    alert("간식 상태 변경 중 통신 에러가 발생했습니다.");
  } finally {
    setSnackRowLoading(snackId, false);
  }
}

// --- 신규 간식 추가 구현 ---
async function addNewSnackAction() {
  const nameInput = document.getElementById('new-snack-name');
  const pointInput = document.getElementById('new-snack-point');
  const imageInput = document.getElementById('new-snack-image');
  const stockInput = document.getElementById('new-snack-stock');
  
  const name = nameInput.value.trim();
  const point = Number(pointInput.value || 1);
  const imageUrl = imageInput.value.trim();
  const stock = Math.min(ADMIN_UI_MAX_SNACK_STOCK, Math.max(0, Number(stockInput.value || 0)));
  const selectedTargets = Array.from(document.querySelectorAll('.new-snack-target-cb:checked')).map(cb => cb.value);
  const target = selectedTargets.length > 0 ? selectedTargets.join(',') : 'user';
  
  if (!name) {
    alert("간식 이름을 입력해 주세요!");
    nameInput.focus();
    return;
  }

  // 중복 방지를 위한 버튼 비활성화 처리
  const submitBtn = document.querySelector('#modal-add-snack button[onclick="addNewSnackAction()"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '등록 중...';
  }
  
  try {
    const res = await fetchAPI('addSnack', {
      method: 'POST',
      body: withAdminToken({ name, point, imageUrl, stock, saleYn: 'Y', target })
    });
    
    if (res && res.success) {
      alert(`[${name}] 간식이 성공적으로 등록되었습니다.`);
      nameInput.value = '';
      pointInput.value = '1';
      imageInput.value = '';
      stockInput.value = '10';
      document.querySelectorAll('.new-snack-target-cb').forEach(cb => {
        cb.checked = (cb.value === 'user' || cb.value === 'guest');
      });
      closeAddSnackModal();
      AppState.vibrate(80);
      AppState.playClickSound();
      await loadAdminData();
    } else {
      clearAdminTokenIfDenied(res);
      alert("간식 등록에 실패했습니다: " + (res?.message || "오류"));
    }
  } catch (error) {
    console.error("간식 추가 에러:", error);
    alert("간식 추가 중 통신 에러가 발생했습니다.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '등록하기';
    }
  }
}

// --- 신규 이용자 등록 모달 제어 ---
function openAddUserModal() {
  document.getElementById('new-user-nickname').value = '';
  document.getElementById('new-user-credit').value = '10';
  document.getElementById('new-user-image').value = '';
  
  document.getElementById('modal-add-user').style.display = 'flex';
  AppState.vibrate(40);
  
  isModalOpen = true;
}

function closeAddUserModal() {
  document.getElementById('modal-add-user').style.display = 'none';
  AppState.vibrate(30);
  
  isModalOpen = false;
}

// --- 신규 간식 등록 모달 제어 ---
function openAddSnackModal() {
  document.getElementById('new-snack-name').value = '';
  document.getElementById('new-snack-point').value = '1';
  document.getElementById('new-snack-image').value = '';
  document.getElementById('new-snack-stock').value = '10';
  document.querySelectorAll('.new-snack-target-cb').forEach(cb => {
    cb.checked = (cb.value === 'user' || cb.value === 'guest');
  });
  
  document.getElementById('modal-add-snack').style.display = 'flex';
  AppState.vibrate(40);
  
  isModalOpen = true;
}

function closeAddSnackModal() {
  document.getElementById('modal-add-snack').style.display = 'none';
  AppState.vibrate(30);
  
  isModalOpen = false;
}

// --- 이용자 수정 모달 제어 및 API 호출 ---
function openEditUserModal(userId) {
  const user = currentUsers.find(u => String(u.userId) === String(userId));
  if (!user) return;

  document.getElementById('edit-user-id').value = user.userId;
  document.getElementById('edit-user-nickname').value = user.nickname || '';
  document.getElementById('edit-user-credit').value = user.credit || 0;
  document.getElementById('edit-user-image').value = user.imageUrl || '';
  
  const isActive = isUserActive(user);
  const activeRadio = document.querySelector(`input[name="edit-user-active"][value="${isActive ? 'Y' : 'N'}"]`);
  if (activeRadio) activeRadio.checked = true;

  document.getElementById('modal-edit-user').style.display = 'flex';
  AppState.vibrate(40);
  
  isModalOpen = true;
}

function closeEditUserModal() {
  document.getElementById('modal-edit-user').style.display = 'none';
  AppState.vibrate(30);
  
  isModalOpen = false;
}

async function updateUserAction() {
  const userId = document.getElementById('edit-user-id').value;
  const nickname = document.getElementById('edit-user-nickname').value.trim();
  const credit = Math.min(ADMIN_UI_MAX_USER_CREDIT, Math.max(0, Number(document.getElementById('edit-user-credit').value || 0)));
  const imageUrl = document.getElementById('edit-user-image').value.trim();
  const activeRadio = document.querySelector('input[name="edit-user-active"]:checked');
  const useYn = activeRadio ? activeRadio.value : 'Y';

  if (!nickname) {
    alert("이용자 별명을 입력해 주세요.");
    return;
  }

  try {
    const res = await fetchAPI('updateUser', {
      method: 'POST',
      body: withAdminToken({ userId, nickname, credit, imageUrl, useYn })
    });

    if (res && res.success) {
      alert("이용자 정보를 수정했습니다.");
      closeEditUserModal();
      await loadAdminData();
    } else {
      clearAdminTokenIfDenied(res);
      alert("수정에 실패했습니다: " + (res?.message || "오류"));
    }
  } catch (error) {
    console.error("이용자 수정 오류:", error);
    alert("통신 오류가 발생했습니다.");
  }
}

// --- 간식 수정 모달 제어 및 API 호출 ---
function openEditSnackModal(snackId) {
  const snack = currentSnacks.find(s => String(s.snackId) === String(snackId));
  if (!snack) return;

  document.getElementById('edit-snack-id').value = snack.snackId;
  document.getElementById('edit-snack-name').value = snack.name || '';
  document.getElementById('edit-snack-point').value = snack.point || 1;
  document.getElementById('edit-snack-image').value = snack.imageUrl || '';
  document.getElementById('edit-snack-stock').value = snack.stock || 0;
  
  const isActive = isSnackActive(snack);
  document.getElementById('edit-snack-sale').value = isActive ? 'Y' : 'N';
  
  const tList = String(snack.target || 'user').toLowerCase().split(',').map(x => x.trim());
  document.querySelectorAll('.edit-snack-target-cb').forEach(cb => {
    cb.checked = tList.includes(cb.value);
  });

  document.getElementById('modal-edit-snack').style.display = 'flex';
  AppState.vibrate(40);
  
  isModalOpen = true;
}

function closeEditSnackModal() {
  document.getElementById('modal-edit-snack').style.display = 'none';
  AppState.vibrate(30);
  
  isModalOpen = false;
}

async function updateSnackAction() {
  const snackId = document.getElementById('edit-snack-id').value;
  const name = document.getElementById('edit-snack-name').value.trim();
  const point = Number(document.getElementById('edit-snack-point').value || 1);
  const imageUrl = document.getElementById('edit-snack-image').value.trim();
  const stock = Math.min(ADMIN_UI_MAX_SNACK_STOCK, Math.max(0, Number(document.getElementById('edit-snack-stock').value || 0)));
  const saleYn = document.getElementById('edit-snack-sale').value;
  const selectedTargets = Array.from(document.querySelectorAll('.edit-snack-target-cb:checked')).map(cb => cb.value);
  const target = selectedTargets.length > 0 ? selectedTargets.join(',') : 'user';

  if (!name) {
    alert("간식 이름을 입력해 주세요.");
    return;
  }

  try {
    const res = await fetchAPI('updateSnack', {
      method: 'POST',
      body: withAdminToken({ snackId, name, point, imageUrl, stock, saleYn, target })
    });

    if (res && res.success) {
      alert("간식 정보를 수정했습니다.");
      closeEditSnackModal();
      await loadAdminData();
    } else {
      clearAdminTokenIfDenied(res);
      alert("수정에 실패했습니다: " + (res?.message || "오류"));
    }
  } catch (error) {
    console.error("간식 수정 오류:", error);
    alert("통신 오류가 발생했습니다.");
  }
}

const IMAGE_UPLOAD_MAX_DIMENSION = 800;
const IMAGE_UPLOAD_WEBP_QUALITY = 0.82;
const IMAGE_UPLOAD_CONVERTIBLE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const IMAGE_UPLOAD_CONVERTIBLE_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

function getFileExtension(file) {
  const nameParts = String(file?.name || '').split('.');
  return nameParts.length > 1 ? nameParts.pop().toLowerCase() : '';
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
    reader.readAsDataURL(blob);
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('이미지를 읽을 수 없습니다.'));
    };

    image.src = objectUrl;
  });
}

function canvasToWebpBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('WebP 변환을 지원하지 않는 브라우저입니다.'));
      }
    }, 'image/webp', quality);
  });
}

async function prepareImageForUpload(file) {
  const extension = getFileExtension(file);
  const mimeType = String(file?.type || '').toLowerCase();
  const canConvert = IMAGE_UPLOAD_CONVERTIBLE_MIME_TYPES.has(mimeType) || IMAGE_UPLOAD_CONVERTIBLE_EXTENSIONS.has(extension);

  if (!canConvert) {
    return {
      blob: file,
      extension: extension || 'jpg'
    };
  }

  const image = await loadImageFromFile(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;

  if (!sourceWidth || !sourceHeight) {
    throw new Error('이미지 크기를 확인할 수 없습니다.');
  }

  const scale = Math.min(1, IMAGE_UPLOAD_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('이미지 변환 준비에 실패했습니다.');
  }

  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
  const webpBlob = await canvasToWebpBlob(canvas, IMAGE_UPLOAD_WEBP_QUALITY);

  return {
    blob: webpBlob,
    extension: 'webp'
  };
}

// 사진 선택 시 Apps Script 업로드 헬퍼
async function handleImageUpload(fileInput, targetInputId, nameFieldId, type) {
  const file = fileInput.files[0];
  if (!file) return;

  const nameInput = document.getElementById(nameFieldId);
  const nameVal = nameInput ? nameInput.value.trim() : '';

  if (!nameVal) {
    alert(type === 'user' ? '이용자 별명을 먼저 입력해 주세요.' : '간식 이름을 먼저 입력해 주세요.');
    fileInput.value = '';
    return;
  }

  // 로딩 표시 및 비활성화
  const targetInput = document.getElementById(targetInputId);
  const originalPlaceholder = targetInput.placeholder;
  targetInput.disabled = true;
  targetInput.placeholder = '업로드 중... 잠시만 기다려 주세요.';
  const originalValue = targetInput.value;
  targetInput.value = '업로드 중...';

  // 버튼 찾아서 비활성화
  const btn = fileInput.nextElementSibling;
  let originalBtnText = '사진 선택';
  if (btn && btn.tagName === 'BUTTON') {
    originalBtnText = btn.textContent;
    btn.textContent = '이미지 준비 중...';
    btn.disabled = true;
  }

  try {
    const preparedImage = await prepareImageForUpload(file);
    const base64Data = await readBlobAsDataUrl(preparedImage.blob);

    if (btn && btn.tagName === 'BUTTON') {
      btn.textContent = '업로드 중...';
    }

    // 파일명 규칙: user_이름_타임스탬프.webp 또는 snack_상품명_타임스탬프.webp
    const timestamp = Math.floor(Date.now() / 1000);
    const fileName = `${type}_${nameVal}_${timestamp}.${preparedImage.extension}`;

    // Apps Script 업로드 API 호출
    const res = await fetchAPI('uploadImage', {
      method: 'POST',
      body: withAdminToken({
        base64Data: base64Data,
        fileName: fileName,
        type: type
      })
    });

    if (res && res.success && res.imageUrl) {
      targetInput.value = res.imageUrl;
      AppState.vibrate(50);
      alert('사진이 성공적으로 업로드되었습니다.');
    } else {
      clearAdminTokenIfDenied(res);
      targetInput.value = originalValue;
      alert('사진 업로드에 실패했습니다: ' + (res?.message || '알 수 없는 오류'));
    }
  } catch (error) {
    console.error('이미지 업로드 에러:', error);
    targetInput.value = originalValue;
    alert('이미지 업로드 중 오류가 발생했습니다.');
  } finally {
    targetInput.disabled = false;
    targetInput.placeholder = originalPlaceholder;
    fileInput.value = ''; // 선택 초기화
    if (btn && btn.tagName === 'BUTTON') {
      btn.textContent = originalBtnText;
      btn.disabled = false;
    }
  }
}

// 초기 이벤트 설정
// ── 게스트 운영 관리 ────────────────────────────────────────
let guestOpsCountdown = null;

async function loadGuestOpsPanel() {
  try {
    const res = await fetchAPI('getGuestSettings');
    if (res && res.success) {
      updateGuestOpsUI(res);
    }
  } catch (e) {
    console.warn('게스트 운영 설정 조회 실패:', e);
  }
}

function updateGuestOpsUI(data) {
  const badge = document.getElementById('guest-ops-status-badge');
  if (!badge) return;
  const closeTimeEl = document.getElementById('guest-ops-close-time');
  const remainingEl = document.getElementById('guest-ops-remaining');
  const creditEl = document.getElementById('input-guest-credit');
  const feeEl = document.getElementById('input-guest-fee');
  const deliveryPlaceEl = document.getElementById('input-guest-delivery-place');

  const teamEnabledEl = document.getElementById('input-team-enabled');
  const teamTitleEl = document.getElementById('input-team-title');
  const teamMembersEl = document.getElementById('input-team-members');
  const teamMessageEl = document.getElementById('input-team-message');

  if (creditEl) creditEl.value = data.guestBaseCredit ?? 10;
  if (feeEl) feeEl.value = data.guestDeliveryFee ?? 3;
  if (deliveryPlaceEl) deliveryPlaceEl.value = data.guestDefaultDeliveryPlace ?? '사무실 원탁';
  
  if (teamEnabledEl) teamEnabledEl.checked = data.todayDeliveryTeamEnabled !== false && String(data.todayDeliveryTeamEnabled).toLowerCase() !== 'false';
  if (teamTitleEl) teamTitleEl.value = data.todayDeliveryTeamTitle || '';
  if (teamMembersEl) teamMembersEl.value = data.todayDeliveryTeamMembers || '';
  if (teamMessageEl) teamMessageEl.value = data.todayDeliveryTeamMessage || '';

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
  const teamMembersInput = document.getElementById('input-team-members');
  const teamMessageInput = document.getElementById('input-team-message');

  if (!creditInput || !feeInput || !deliveryPlaceInput) return;

  const guestBaseCredit = Number(creditInput.value);
  const guestDeliveryFee = Number(feeInput.value);
  const guestDefaultDeliveryPlace = deliveryPlaceInput.value.trim();
  const todayDeliveryTeamEnabled = teamEnabledInput ? teamEnabledInput.checked : true;
  const todayDeliveryTeamTitle = teamTitleInput ? teamTitleInput.value.trim() : '';
  const todayDeliveryTeamMembers = teamMembersInput ? teamMembersInput.value.trim() : '';
  const todayDeliveryTeamMessage = teamMessageInput ? teamMessageInput.value.trim() : '';

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
  document.addEventListener('pointerdown', closeGaugeEditFromOutside, true);
  AdminAuth.init({
    onUnlock: () => loadAdminData(),
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
      if (document.getElementById('tab-applications')?.classList.contains('active')) {
        loadGuestApplications();
      }
      AppState.vibrate(50);
    });
  }

  document.querySelectorAll('[data-application-filter]').forEach(button => {
    button.addEventListener('click', () => loadGuestApplications(button.dataset.applicationFilter));
  });

  document.querySelectorAll('#application-settings-panel input, #application-settings-panel textarea').forEach(input => {
    input.addEventListener('input', () => { guestApplicationSettingsDirty = true; });
    input.addEventListener('change', () => { guestApplicationSettingsDirty = true; });
  });

  document.getElementById('btn-save-application-settings')?.addEventListener('click', saveGuestApplicationSettings);
  document.getElementById('btn-audit-applications')?.addEventListener('click', auditGuestApplicationRetention);
  document.getElementById('btn-anonymize-applications')?.addEventListener('click', anonymizeGuestApplications);
  document.getElementById('btn-save-application-memo')?.addEventListener('click', () => updateCurrentGuestApplication({}));
  document.getElementById('btn-application-contacted')?.addEventListener('click', () => {
    updateCurrentGuestApplication({ contacted: !Boolean(currentApplicationDetail?.contactedAt) });
  });
  document.getElementById('btn-application-skip')?.addEventListener('click', async () => {
    if (!currentApplicationDetail) return;
    const applicationId = currentApplicationDetail.applicationId;
    const modalButtons = document.querySelectorAll('.application-modal-actions button');
    modalButtons.forEach(b => { b.disabled = true; });
    try {
      const res = await fetchAPI('skipGuestApplicationWeek', {
        method: 'POST',
        body: {
          adminToken: getAdminToken(),
          applicationId
        }
      });
      if (!res?.success) {
        clearAdminTokenIfDenied(res);
        alert(res?.message || '건너뛰기 설정에 실패했습니다.');
        return;
      }
      alert(res.message || '건너뛰기가 설정되었습니다.');
      closeGuestApplicationModal();
      await loadGuestApplications();
    } catch (error) {
      alert('건너뛰기 중 오류가 발생했습니다.');
    } finally {
      modalButtons.forEach(b => { b.disabled = false; });
    }
  });
  document.querySelectorAll('[data-application-action]').forEach(button => {
    button.addEventListener('click', () => {
      const status = button.dataset.applicationAction;
      if ((status === 'REJECTED' || status === 'INACTIVE') && !confirm('이 상태로 변경하면 30일 뒤 개인정보 정리 대상이 됩니다. 계속할까요?')) return;
      updateCurrentGuestApplication({ status });
    });
  });

  document.getElementById('modal-guest-application')?.addEventListener('click', event => {
    if (event.target.id === 'modal-guest-application') closeGuestApplicationModal();
  });

  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('modal-guest-application')?.style.display === 'flex') {
      closeGuestApplicationModal();
    }
  });





  // 비활성 이용자 토글 바인딩
  const toggleInactiveUsers = document.getElementById('toggle-inactive-users');
  if (toggleInactiveUsers) {
    toggleInactiveUsers.addEventListener('change', () => {
      renderUsersManagement(currentUsers);
      AppState.vibrate(30);
    });
  }

  // 숨긴 간식 토글 바인딩
  const toggleHiddenSnacks = document.getElementById('toggle-hidden-snacks');
  if (toggleHiddenSnacks) {
    toggleHiddenSnacks.addEventListener('change', () => {
      renderSnacksManagement(currentSnacks);
      AppState.vibrate(30);
    });
  }

  // 간식 대상 필터 바인딩
  const filterTargetSnack = document.getElementById('filter-target-snack');
  if (filterTargetSnack) {
    filterTargetSnack.addEventListener('change', () => {
      renderSnacksManagement(currentSnacks);
      AppState.vibrate(30);
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
    btnEnableSound.addEventListener('click', () => {
      const utterance = new SpeechSynthesisUtterance('음성 알림이 활성화되었습니다.');
      speechSynthesis.speak(utterance);
      
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioCtx.resume();
      } catch(e) {}
    });
  }
});
