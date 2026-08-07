let pollInterval = null;
let isAudioEnabled = true;
let knownReadyOrders = []; // 호출 음성 중복 방지용 캐시

// 띵동 차임벨 효과음 합성 (Web Audio API)
function playChimeSound() {
  if (!isAudioEnabled) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // 첫 번째 고음 (솔 - G5 784.00 Hz)
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(784.00, audioCtx.currentTime);
    gain1.gain.setValueAtTime(0, audioCtx.currentTime);
    gain1.gain.linearRampToValueAtTime(0.12, audioCtx.currentTime + 0.05);
    gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    
    osc1.start(audioCtx.currentTime);
    osc1.stop(audioCtx.currentTime + 0.5);
    
    // 두 번째 중음 (미 - E5 659.25 Hz)
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.18);
    gain2.gain.setValueAtTime(0, audioCtx.currentTime + 0.18);
    gain2.gain.linearRampToValueAtTime(0.12, audioCtx.currentTime + 0.23);
    gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.75);
    
    osc2.start(audioCtx.currentTime + 0.18);
    osc2.stop(audioCtx.currentTime + 0.75);
  } catch (e) {
    console.warn('효과음 합성 실패:', e);
  }
}

// TTS 음성 호출
function speakCalling(orderNo, nickname, isDelivery) {
  if (!isAudioEnabled) return;
  
  const shortNo = getShortNo(orderNo);
  let text = '';
  if (isDelivery) {
    text = `주문번호 ${shortNo}번, ${nickname} 님, 간식이 배달 중입니다. 조금만 기다려주세요!`;
  } else {
    text = `주문번호 ${shortNo}번, ${nickname} 님, 간식이 준비되었습니다. 받아가세요!`;
  }
  
  try {
    window.speechSynthesis.cancel(); // 진행 중 대화 리셋
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.warn('TTS 재생 실패:', e);
  }
}

function getShortNo(orderNo) {
  if (!orderNo) return '-';
  const parts = String(orderNo).split('-');
  if (parts.length >= 3) {
    return parseInt(parts[2], 10);
  }
  return orderNo;
}

// 데이터 호출 및 렌더링
async function loadBoardData() {
  try {
    const res = await fetchAPIReadWithRetry('getPublicOrderFeed', { timeoutMs: 30000 });
    if (res && res.success && Array.isArray(res.orders)) {
      processOrders(res.orders);
    }
  } catch (e) {
    console.error('전광판 데이터 호출 실패:', e);
  } finally {
    // 이전 요청이 완료(성공 혹은 실패)된 시점부터 10초 후에 다음 조회 진행 (API 과부하 방지)
    if (pollInterval) {
      clearTimeout(pollInterval);
    }
    pollInterval = setTimeout(loadBoardData, 10000);
  }
}

function processOrders(rawOrders) {
  // 1. 주문 건별로 그룹핑 (동일 주문번호 묶음)
  const groups = {};
  rawOrders.forEach(o => {
    // 취소된 주문('C')은 전광판 노출 제외
    if (o.servedYn === 'C') return;
    
    if (!groups[o.orderNo]) {
      groups[o.orderNo] = {
        orderNo: o.orderNo,
        nickname: o.nickname,
        timestamp: o.timestamp,
        servedYn: o.servedYn || 'N',
        deliveryType: o.deliveryType || 'pickup',
        isKakao: o.isKakao === true,
        snacks: []
      };
    }
    groups[o.orderNo].snacks.push({
      name: o.snackName,
      quantity: Number(o.quantity || 1)
    });
  });

  // 2. 대기 그룹과 완료 그룹 분류
  // - 대기중: servedYn === 'N' (접수중) 또는 'P' (준비중)
  // - 준비완료: servedYn === 'R'
  // - 수령완료('Y')는 호출판 노출 제외
  const list = Object.values(groups);
  const preparingOrders = list.filter(o => o.servedYn === 'N' || o.servedYn === 'P');
  const readyOrders = list.filter(o => o.servedYn === 'R');

  // 주문 시간 순 정렬 (선입선출)
  preparingOrders.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  readyOrders.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // 3. 신규 준비완료 건 감지하여 차임 및 TTS 송출
  const currentReadyNos = readyOrders.map(o => o.orderNo);
  
  readyOrders.forEach(order => {
    if (!knownReadyOrders.includes(order.orderNo)) {
      // 즉시 호출 방송 실행
      setTimeout(() => {
        playChimeSound();
        speakCalling(order.orderNo, order.nickname, order.deliveryType === 'delivery');
      }, 100);
    }
  });
  
  // 최신 호출 목록으로 메모리 동기화
  knownReadyOrders = currentReadyNos;

  // 4. 화면 렌더링
  renderList('preparing-list', preparingOrders, 'preparing');
  renderList('ready-list', readyOrders, 'ready');
}

function renderList(containerId, list, type) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // 동적 크기 및 레이아웃 조절 클래스 적용
  container.className = 'board-list';
  container.style.removeProperty('--board-cols');
  container.style.removeProperty('--board-rows');
  const layout = getBoardLayout(list.length);
  if (layout.className) {
    container.classList.add('fit-grid', layout.className);
    container.style.setProperty('--board-cols', layout.cols);
    container.style.setProperty('--board-rows', layout.rows);
  }

  if (list.length === 0) {
    container.innerHTML = type === 'preparing' 
      ? '<div class="board-empty">대기 중인 주문이 없습니다. ⏳</div>'
      : '<div class="board-empty">호출된 주문이 없습니다. 🥞</div>';
    return;
  }

  container.innerHTML = '';
  list.forEach(order => {
    const shortNo = getShortNo(order.orderNo);
    // 번호가 너무 길어 원을 벗어나는 현상 방지 (뒤 4자리만 표시)
    const displayNo = String(shortNo).length > 4 ? '...' + String(shortNo).slice(-4) : shortNo;
    let displayName = order.nickname || '';
    const isKakao = order.isKakao === true;
    if (isKakao) {
      displayName = '💬 ' + displayName.replace(/ \((체험|비회원)\)/g, '').trim();
    }
    const safeNickname = AppState.escapeHtml(displayName);
    const safeSnacksText = AppState.escapeHtml(
      order.snacks.map(s => `${s.name} ${s.quantity}개`).join(', ')
    );

    const card = document.createElement('div');
    card.className = `board-card ${type === 'ready' ? 'ready-item' : ''}`;
    
    const isDelivery = order.deliveryType === 'delivery';
    let statusBadgeText = '접수완료';
    if (order.servedYn === 'P') {
      statusBadgeText = '준비중';
    } else if (order.servedYn === 'R') {
      statusBadgeText = isDelivery ? '배달중 🛵' : '가져가세요!';
    }

    card.innerHTML = `
      <div class="board-number-box">${displayNo}</div>
      <div class="board-info-box">
        <div class="board-username">${safeNickname} 님</div>
        <div class="board-snacks-list">${safeSnacksText}</div>
      </div>
      <div class="board-status-badge">${statusBadgeText}</div>
    `;
    
    container.appendChild(card);
  });
}

function getBoardLayout(count) {
  if (count <= 4) {
    return { className: '', cols: 1, rows: count || 1 };
  }
  if (count <= 8) {
    return { className: 'compact', cols: 2, rows: Math.ceil(count / 2) };
  }
  if (count <= 18) {
    return { className: 'dense', cols: 3, rows: Math.ceil(count / 3) };
  }
  return { className: 'ultra', cols: 4, rows: Math.ceil(count / 4) };
}

// 초기 이벤트 설정
window.addEventListener('DOMContentLoaded', () => {
  // 오디오 켜기/끄기
  const btnAudio = document.getElementById('btn-audio-toggle');
  btnAudio.addEventListener('click', () => {
    isAudioEnabled = !isAudioEnabled;
    btnAudio.classList.toggle('active', isAudioEnabled);
    btnAudio.textContent = isAudioEnabled ? '🔊 소리 알림 켬' : '🔇 소리 알림 끔';
    AppState.vibrate(40);
    if (isAudioEnabled) {
      playChimeSound();
    }
  });

  // 뒤로가기
  document.getElementById('btn-back').addEventListener('click', () => {
    window.location.href = 'index.html?type=kiosk';
  });

  // 최초 조회 진행 후 순차 대기 폴링 시작
  loadBoardData();
});
