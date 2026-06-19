// Google Apps Script API 설정
const API_URL = "https://script.google.com/macros/s/AKfycbxKY36tTxlOMw0WvKEBn2ljbYVgwsdkcyGFS6HPJ9_UPux8bq0xROvNK9E1NCBam0Qe/exec";

// 게스트 기본 설정 상수
const GUEST_DEFAULT_CREDIT = 10;
const GUEST_DELIVERY_FEE = 3;

// 로컬 테스트용 Mock 데이터 강제 사용 여부
// - 주의: 테스트 시에는 true, 실제 운영 배포 시에는 false로 설정해야 합니다.
// - false: 실제 API 호출 (실패 시 Mock으로 자동 폴백하지 않고 실제 에러 메시지 노출)
// - true: 항상 로컬 Mock 데이터를 사용하여 동작 테스트 및 검증 진행
const USE_MOCK = false;

const DEBUG = false;

function safeLog(...args) {
  if (!DEBUG) return;
  console.log(...args);
}

safeLog("API_URL:", API_URL);
safeLog("USE_MOCK:", USE_MOCK);

// 로컬 테스트 및 API 오류 대응을 위한 Mock 데이터
const MOCK_DATA = {
  getUsers: {
    success: true,
    users: [
      { userId: "user001", nickname: "이니", credit: 10, useYn: "Y", imageUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80" },
      { userId: "user002", nickname: "준이", credit: 15, useYn: "Y", imageUrl: "" },
      { userId: "user003", nickname: "민이", credit: 8, useYn: "Y", imageUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80" },
      { userId: "user004", nickname: "후니", credit: 20, useYn: "Y", imageUrl: "" },
      { userId: "user005", nickname: "수지", credit: 12, useYn: "Y", imageUrl: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80" },
      { userId: "user006", nickname: "영이", credit: 5, useYn: "Y", imageUrl: "" }
    ]
  },
  getSnacks: {
    success: true,
    snacks: [
      { snackId: 1, name: "초코칩 쿠키", point: 1, imageUrl: "", saleYn: "Y", stock: 5, target: "both" },
      { snackId: 2, name: "감자칩", point: 2, imageUrl: "", saleYn: "Y", stock: 3, target: "user" },
      { snackId: 3, name: "사이다", point: 1, imageUrl: "", saleYn: "Y", stock: 0, target: "both" }, // 품절 테스트용
      { snackId: 4, name: "오렌지주스", point: 3, imageUrl: "", saleYn: "Y", stock: 10, target: "guest" },
      { snackId: 5, name: "초코우유", point: 2, imageUrl: "", saleYn: "Y", stock: 1, target: "user" }, // 1개 남은 것 테스트용
      { snackId: 6, name: "하리보 젤리", point: 1, imageUrl: "", saleYn: "Y", stock: 8, target: "guest" }
    ]
  },
  placeOrder: {
    success: true,
    message: "주문이 완료되었습니다!"
  },
  getOrdersToday: {
    success: true,
    orders: [
      { timestamp: new Date(Date.now() - 3600000 * 2).toISOString(), orderNo: "ORD-1111111111111", nickname: "이니", snackName: "초코칩 쿠키", quantity: 2, point: 2, servedYn: "N" },
      { timestamp: new Date(Date.now() - 3600000).toISOString(), orderNo: "ORD-2222222222222", nickname: "준이", snackName: "사이다", quantity: 1, point: 1, servedYn: "Y" },
      { timestamp: new Date().toISOString(), orderNo: "ORD-3333333333333", nickname: "민이", snackName: "감자칩", quantity: 1, point: 2, servedYn: "N" }
    ]
  }
};

/**
 * 구글 드라이브 이미지 주소를 브라우저에서 직접 표시 가능한 썸네일 주소로 변환
 */
function convertDriveImageUrl(url) {
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
  // (ID는 보통 25자 이상의 고유 식별값임. 1, 2, user001 등 짧은 문자열과 혼동 방지)
  if (!text.startsWith("http") && /^[a-zA-Z0-9_-]{25,}$/.test(text)) {
    return `https://drive.google.com/thumbnail?id=${text}&sz=w500`;
  }

  return text;
}

/**
 * Apps Script API 통신을 담당하는 헬퍼 함수
 * @param {string} action - API 요청 액션 (getUsers, getSnacks, placeOrder, getOrdersToday)
 * @param {Object} [options] - fetch 옵션 (method, body 등)
 * @returns {Promise<Object>} API 응답 데이터
 */
async function fetchAPI(action, options = {}) {
  if (typeof USE_MOCK !== 'undefined' && USE_MOCK) {
    console.log(`[API Mock] USE_MOCK이 활성화되어 있어 Mock 데이터를 사용합니다. Action: ${action}`);
    return getMockFallback(action, options);
  }

  const method = options.method || 'GET';
  let url = `${API_URL}?action=${action}`;

  // GET 요청 파라미터 매핑
  if (method === 'GET' && options.params) {
    const queryParams = new URLSearchParams(options.params).toString();
    url += `&${queryParams}`;
  }

  const fetchOptions = {
    method: method,
    mode: 'cors',
    redirect: 'follow', // GAS Web App Redirect 필수 처리
  };

  // 10초 타임아웃 제어 설정 (네트워크 및 SW 프리징 대비)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.warn(`[API Timeout] ${action} 요청이 10초 동안 응답이 없어 강제 중단합니다.`);
    controller.abort();
  }, 10000);
  fetchOptions.signal = controller.signal;

  // POST 요청 설정
  if (method === 'POST') {
    // GAS가 JSON을 잘 파싱할 수 있게 text/plain으로 보내거나 standard json으로 보냄.
    // 여기서는 명세 상의 POST JSON을 따름
    fetchOptions.headers = {
      'Content-Type': 'text/plain;charset=utf-8' // CORS preflight 회피 및 GAS 파싱 호환성용
    };
    
    // API 명세 상 action이 body 안에 포함되어야 하므로 placeOrder 등의 액션을 body에 같이 전달
    const requestBody = {
      action: action,
      ...options.body
    };
    fetchOptions.body = JSON.stringify(requestBody);
    
    // POST는 쿼리 파라미터 없이 본래 URL로 전송
    url = API_URL;
  }

  try {
    safeLog("API Request", { url, options: fetchOptions });
    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    safeLog("API Response", data);

    // 구글 드라이브 이미지 URL 변환 처리
    if (data && data.success) {
      if (Array.isArray(data.users)) {
        data.users = data.users.map(u => ({
          ...u,
          imageUrl: convertDriveImageUrl(u.imageUrl)
        }));
      }
      if (Array.isArray(data.snacks)) {
        data.snacks = data.snacks.map(s => ({
          ...s,
          imageUrl: convertDriveImageUrl(s.imageUrl)
        }));
      }
    }

    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    console.error("API Error", error);
    console.warn(`[API Warning] 실제 API 호출 실패 혹은 CORS 발생. Mock 데이터를 사용합니다. Action: ${action}`, error);
    // 에러 발생 시 사용자 경험 중단을 막기 위해 Mock 데이터로 폴백 제공
    return {
      success: false,
      message: '구글시트 연결에 실패했습니다.',
      error: String(error)
    };
  }
}

function getMockSnacks() {
  let cached = localStorage.getItem('mockSnacks');
  if (!cached) {
    localStorage.setItem('mockSnacks', JSON.stringify(MOCK_DATA.getSnacks.snacks));
    return MOCK_DATA.getSnacks.snacks;
  }
  return JSON.parse(cached);
}

function saveMockSnacks(snacks) {
  localStorage.setItem('mockSnacks', JSON.stringify(snacks));
}

/**
 * API 호출 실패 시 로컬에서 응답할 Mock 데이터 처리기
 */
function getMockFallback(action, options) {
  let res;
  if (action === 'getUsers') {
    res = JSON.parse(JSON.stringify(MOCK_DATA.getUsers));
    const includeInactive = String(options.params?.includeInactive || '').trim().toUpperCase() === 'Y';
    if (!includeInactive) {
      res.users = res.users.filter(u => {
        const active = String(u.useYn ?? u.active ?? 'Y').trim().toUpperCase();
        return active === 'TRUE' || active === '사용' || active === 'Y' || active === 'O' || active === '예';
      });
    }
  } else if (action === 'getSnacks') {
    res = {
      success: true,
      snacks: getMockSnacks()
    };
    const includeHidden = String(options.params?.includeHidden || '').trim().toUpperCase() === 'Y';
    if (!includeHidden) {
      res.snacks = res.snacks.filter(s => {
        const active = String(s.saleYn ?? s.active ?? 'Y').trim().toUpperCase();
        return active === 'TRUE' || active === '판매' || active === 'Y' || active === 'O' || active === '예';
      });
    }
    const mode = options.params?.mode;
    if (mode) {
      const cleanedMode = String(mode).trim().toLowerCase();
      if (cleanedMode === 'user') {
        res.snacks = res.snacks.filter(s => {
          const t = s.target ? String(s.target).trim().toLowerCase() : 'user';
          return t === 'user' || t === 'both';
        });
      } else if (cleanedMode === 'guest') {
        res.snacks = res.snacks.filter(s => {
          const t = s.target ? String(s.target).trim().toLowerCase() : 'user';
          return t === 'guest' || t === 'both';
        });
      }
    }
  } else if (action === 'getGuestSettings') {
    const settings = getMockGuestSettings();
    const now = new Date();
    let isGuestOpenNow = false;
    let remainingSeconds = 0;
    let message = '';

    if (settings.guestOpen === 'Y') {
      if (settings.guestCloseAt) {
        const closeAt = new Date(settings.guestCloseAt);
        const diff = Math.floor((closeAt.getTime() - now.getTime()) / 1000);
        if (diff > 0) {
          isGuestOpenNow = true;
          remainingSeconds = diff;
          message = '게스트 주문이 운영 중입니다.';
        } else {
          isGuestOpenNow = false;
          message = '게스트 주문 운영 시간이 종료되었습니다.';
        }
      } else {
        isGuestOpenNow = true;
        message = '게스트 주문이 운영 중입니다 (종료시각 미설정).';
      }
    } else {
      isGuestOpenNow = false;
      message = '게스트 주문이 마감되었습니다.';
    }

      res = {
        success: true,
        guestOpen: settings.guestOpen,
        guestCloseAt: settings.guestCloseAt,
        guestBaseCredit: settings.guestBaseCredit,
        guestDeliveryFee: settings.guestDeliveryFee,
        guestDefaultDeliveryPlace: settings.guestDefaultDeliveryPlace ?? '사무실 원탁',
        isGuestOpenNow,
        remainingSeconds,
        message
      };
  } else if (action === 'updateGuestSettings') {
    const settingsAction = options.body?.settingsAction;
    const settings = getMockGuestSettings();
    const now = new Date();

    if (settingsAction === 'open20') {
      settings.guestOpen = 'Y';
      settings.guestCloseAt = new Date(now.getTime() + 20 * 60 * 1000).toISOString();
      appendMockAdminLog('updateGuestSettings', 'settings', 'guestOpen', '게스트 운영', 'N', 'Y (20분)', options.body?.adminMemo);
    } else if (settingsAction === 'open30') {
      settings.guestOpen = 'Y';
      settings.guestCloseAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
      appendMockAdminLog('updateGuestSettings', 'settings', 'guestOpen', '게스트 운영', 'N', 'Y (30분)', options.body?.adminMemo);
    } else if (settingsAction === 'open60') {
      settings.guestOpen = 'Y';
      settings.guestCloseAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
      appendMockAdminLog('updateGuestSettings', 'settings', 'guestOpen', '게스트 운영', 'N', 'Y (60분)', options.body?.adminMemo);
    } else if (settingsAction === 'openCustom') {
      const minutes = Number(options.body?.minutes || 10);
      settings.guestOpen = 'Y';
      settings.guestCloseAt = new Date(now.getTime() + minutes * 60 * 1000).toISOString();
      appendMockAdminLog('updateGuestSettings', 'settings', 'guestOpen', '게스트 운영', 'N', 'Y (' + minutes + '분)', options.body?.adminMemo);
    } else if (settingsAction === 'closeNow') {
      settings.guestOpen = 'N';
      appendMockAdminLog('updateGuestSettings', 'settings', 'guestOpen', '게스트 운영', 'Y', 'N (즉시 마감)', options.body?.adminMemo);
    } else if (settingsAction === 'updateValues') {
      settings.guestBaseCredit = Number(options.body?.guestBaseCredit);
      settings.guestDeliveryFee = Number(options.body?.guestDeliveryFee);
      settings.guestDefaultDeliveryPlace = String(options.body?.guestDefaultDeliveryPlace || '사무실 원탁').trim();
      appendMockAdminLog('updateGuestSettings', 'settings', 'guestValues', '게스트 설정 변경', '', `크레딧:${settings.guestBaseCredit}, 배달비:${settings.guestDeliveryFee}, 기본배달지:${settings.guestDefaultDeliveryPlace}`, options.body?.adminMemo);
    }

    saveMockGuestSettings(settings);
    res = { success: true, message: '게스트 운영 설정이 변경되었습니다.' };
  } else if (action === 'getOrderStatus') {
    const identifier = options.params?.orderNo || options.params?.orderToken;
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    const allMockOrders = [...localOrders, ...MOCK_DATA.getOrdersToday.orders];
    const matched = allMockOrders.find(o => o.orderNo === identifier || o.orderToken === identifier);
    if (matched) {
      res = {
        success: true,
        orderNo: matched.orderNo,
        orderToken: matched.orderToken || '',
        servedYn: matched.servedYn || 'N',
        cancelTimestamp: matched.cancelTimestamp || '',
        deliveryType: matched.deliveryType || 'pickup',
        deliveryFee: matched.deliveryFee || 0,
        deliveryPlace: matched.deliveryPlace || '',
        reviewed: matched.reviewed || false
      };
    } else {
      res = {
        success: false,
        message: '해당 주문을 찾을 수 없습니다.'
      };
    }
  } else if (action === 'getGuestOrdersToday') {
    const guestName = options.params?.guestName || '';
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    const allMockOrders = [...localOrders, ...MOCK_DATA.getOrdersToday.orders];
    
    const todayStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const matchedOrders = allMockOrders.filter(o => {
      const isToday = o.timestamp && o.timestamp.slice(2, 10).replace(/-/g, '') === todayStr;
      const nickname = o.nickname || '';
      return isToday && nickname.indexOf('(비회원)') !== -1 && nickname.indexOf(guestName) !== -1;
    });

    res = {
      success: true,
      orders: matchedOrders.map(o => ({ ...o, reviewed: o.reviewed || false }))
    };
  } else if (action === 'getOrdersToday') {
    // 로컬 스토리지에 저장된 테스트용 주문 내역이 있으면 그것을 병합
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    res = {
      success: true,
      orders: [...localOrders, ...MOCK_DATA.getOrdersToday.orders].map(o => ({ ...o, reviewed: o.reviewed || false }))
    };
  } else if (action === 'placeOrder') {
    // 주문 완료 시 로컬 스토리지에 임시 주문 추가 (관리자 화면에서 확인 가능하게)
    const userId = options.body?.userId || 'unknown';
    const items = options.body?.items || [];
    const isGuest = (userId === 'guest');

    // 게스트 주문 시 운영 상태 검증
    if (isGuest) {
      const gSettings = getMockGuestSettings();
      if (gSettings.guestOpen !== 'Y') {
        return { success: false, message: '게스트 주문이 마감되었습니다.' };
      }
      if (gSettings.guestCloseAt) {
        const closeAt = new Date(gSettings.guestCloseAt);
        if (new Date() >= closeAt) {
          return { success: false, message: '게스트 주문 운영 시간이 종료되었습니다.' };
        }
      }
    }
    
    // 사용자 이름 매핑
    let nickname = '게스트';
    if (isGuest) {
      nickname = (options.body?.guestName || '게스트') + ' (비회원)';
    } else {
      const users = MOCK_DATA.getUsers.users;
      const user = users.find(u => u.userId === userId) || { nickname: "알수없음" };
      nickname = user.nickname;
    }
    
    // 간식 이름 매핑
    const snacks = MOCK_DATA.getSnacks.snacks;
    
    const timestampStr = new Date().toISOString();
    const todayStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    const allMockOrders = [...localOrders, ...MOCK_DATA.getOrdersToday.orders];
    const todayMockOrders = allMockOrders.filter(o => {
      if (!o.timestamp) return false;
      const oDateStr = o.timestamp.slice(2, 10).replace(/-/g, '');
      return oDateStr === todayStr;
    });
    const uniqueMockOrderNos = Array.from(new Set(todayMockOrders.map(o => o.orderNo)));
    const seq = uniqueMockOrderNos.length + 1;
    const generatedOrderNo = `ORD-${todayStr}-${String(seq).padStart(3, '0')}`;
    let orderToken = '';
    if (isGuest) {
      const randVal = Math.floor(1000 + Math.random() * 9000);
      orderToken = `G-${generatedOrderNo}-${randVal}`;
    }

    const deliveryType = options.body?.deliveryType || 'pickup';
    const deliveryPlace = (deliveryType === 'delivery') ? String(options.body?.deliveryPlace || '').trim() : '';
    // 게스트 배달비는 서버 설정값 기준으로 재계산
    let deliveryFee = 0;
    if (isGuest && deliveryType === 'delivery') {
      const gSettings = getMockGuestSettings();
      deliveryFee = gSettings.guestDeliveryFee;
    } else {
      deliveryFee = Number(options.body?.deliveryFee || 0);
    }

    const newOrders = items.map(item => {
      const snack = snacks.find(s => s.snackId === item.snackId) || { name: `간식 ${item.snackId}`, point: 1 };
      return {
        timestamp: timestampStr,
        orderNo: generatedOrderNo,
        orderToken: orderToken,
        nickname: nickname,
        snackName: snack.name,
        quantity: item.quantity,
        point: snack.point * item.quantity,
        servedYn: 'N',
        deliveryType: deliveryType,
        deliveryFee: deliveryFee,
        deliveryPlace: deliveryPlace,
        reviewed: false
      };
    });

    localStorage.setItem('mockOrders', JSON.stringify([...newOrders, ...localOrders]));

    // 주문에 따른 사용자 크레딧 차감 시뮬레이션
    const selectedUser = JSON.parse(localStorage.getItem('selectedUser'));
    if (selectedUser) {
      const totalCost = newOrders.reduce((sum, o) => sum + o.point, 0) + deliveryFee;
      selectedUser.credit = Math.max(0, selectedUser.credit - totalCost);
      localStorage.setItem('selectedUser', JSON.stringify(selectedUser));

      if (!isGuest) {
        // 실제 유저인 경우 Mock DB(메모리) 상에서도 차감 반영
        const users = MOCK_DATA.getUsers.users;
        const u = users.find(u => u.userId === userId);
        if (u) {
          u.credit = Math.max(0, u.credit - totalCost);
        }
      }
    }

    res = JSON.parse(JSON.stringify(MOCK_DATA.placeOrder));
    res.orderNo = generatedOrderNo;
    res.orderToken = orderToken;
  } else if (action === 'updateOrderServed') {
    const orderId = options.body?.orderId;
    const servedYn = options.body?.servedYn || 'N';
    
    // 1) mockOrders에서 업데이트
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    let updated = false;
    const updatedLocalOrders = localOrders.map(o => {
      if (o.orderNo === orderId) {
        updated = true;
        appendMockAdminLog('updateOrderServed', 'order', orderId, o.nickname, o.servedYn || 'N', servedYn, options.body?.adminMemo);
        return { ...o, servedYn: servedYn };
      }
      return o;
    });
    if (updated) {
      localStorage.setItem('mockOrders', JSON.stringify(updatedLocalOrders));
    }
    
    // 2) MOCK_DATA.getOrdersToday.orders에서도 임시로 업데이트
    const mockOrder = MOCK_DATA.getOrdersToday.orders.find(o => o.orderNo === orderId);
    if (mockOrder) {
      appendMockAdminLog('updateOrderServed', 'order', orderId, mockOrder.nickname, mockOrder.servedYn || 'N', servedYn, options.body?.adminMemo);
      mockOrder.servedYn = servedYn;
      updated = true;
    }
    
    res = {
      success: true,
      message: `주문번호 ${orderId}의 제공 상태를 '${servedYn}'으로 업데이트했습니다.`
    };
  } else if (action === 'updateUserCredit') {
    const userId = options.body?.userId;
    const credit = Number(options.body?.credit || 0);
    const users = MOCK_DATA.getUsers.users;
    const user = users.find(u => String(u.userId) === String(userId));
    if (user) {
      appendMockAdminLog('updateUserCredit', 'user', userId, user.nickname, user.credit, credit, options.body?.adminMemo);
      user.credit = credit;
    }
    const selectedUser = JSON.parse(localStorage.getItem('selectedUser'));
    if (selectedUser && String(selectedUser.userId) === String(userId)) {
      selectedUser.credit = credit;
      localStorage.setItem('selectedUser', JSON.stringify(selectedUser));
    }
    res = {
      success: true,
      message: "크레딧을 업데이트했습니다."
    };
  } else if (action === 'addUser') {
    const nickname = options.body?.nickname || "새 이용자";
    const credit = Number(options.body?.credit || 0);
    const imageUrl = options.body?.imageUrl || "";
    const useYn = options.body?.useYn || "Y";
    const users = MOCK_DATA.getUsers.users;
    const maxId = users.reduce((max, u) => {
      const match = String(u.userId || '').match(/(\d+)$/);
      const idNumber = match ? Number(match[1]) : 0;
      return idNumber > max ? idNumber : max;
    }, 0);
    const newUserId = `user${String(maxId + 1).padStart(3, '0')}`;
    users.push({
      userId: newUserId,
      nickname,
      credit,
      useYn,
      imageUrl
    });
    appendMockAdminLog('addUser', 'user', newUserId, nickname, '', JSON.stringify({ credit, useYn }), options.body?.adminMemo);
    res = {
      success: true,
      message: "신규 이용자를 등록했습니다.",
      userId: newUserId
    };
  } else if (action === 'updateUserActive') {
    const userId = options.body?.userId;
    const useYn = String(options.body?.useYn || 'N').toUpperCase() === 'Y' ? 'Y' : 'N';
    const users = MOCK_DATA.getUsers.users;
    const user = users.find(u => String(u.userId) === String(userId));
    if (user) {
      appendMockAdminLog('updateUserActive', 'user', userId, user.nickname, user.useYn ?? user.active ?? 'Y', useYn, options.body?.adminMemo);
      user.useYn = useYn;
      user.active = useYn;
    }
    res = {
      success: true,
      message: "이용자 상태를 업데이트했습니다.",
      useYn
    };
  } else if (action === 'updateSnackStock') {
    const snackId = Number(options.body?.snackId);
    const stock = Number(options.body?.stock || 0);
    const snacks = getMockSnacks();
    const snack = snacks.find(s => s.snackId === snackId);
    if (snack) {
      appendMockAdminLog('updateSnackStock', 'snack', snackId, snack.name, snack.stock, stock, options.body?.adminMemo);
      snack.stock = stock;
      saveMockSnacks(snacks);
    }
    res = {
      success: true,
      message: "재고를 업데이트했습니다."
    };
  } else if (action === 'updateSnackSale') {
    const snackId = Number(options.body?.snackId);
    const saleYn = String(options.body?.saleYn || 'N').toUpperCase() === 'Y' ? 'Y' : 'N';
    const snacks = getMockSnacks();
    const snack = snacks.find(s => Number(s.snackId) === snackId);
    if (snack) {
      appendMockAdminLog('updateSnackSale', 'snack', snackId, snack.name, snack.saleYn ?? snack.active ?? 'Y', saleYn, options.body?.adminMemo);
      snack.saleYn = saleYn;
      snack.active = saleYn;
      saveMockSnacks(snacks);
    }
    res = {
      success: true,
      message: "간식 판매 상태를 업데이트했습니다.",
      saleYn
    };
  } else if (action === 'addSnack') {
    const name = options.body?.name || "새로운 간식";
    const point = Number(options.body?.point || 1);
    const imageUrl = options.body?.imageUrl || "";
    const stock = Number(options.body?.stock || 0);
    const saleYn = options.body?.saleYn || "Y";
    const target = options.body?.target || "user";
    const snacks = getMockSnacks();
    const maxId = snacks.reduce((max, s) => s.snackId > max ? s.snackId : max, 0);
    const newSnackId = maxId + 1;
    const newSnack = {
      snackId: newSnackId,
      name: name,
      point: point,
      imageUrl: imageUrl,
      saleYn: saleYn,
      stock: stock,
      target: target
    };
    snacks.push(newSnack);
    saveMockSnacks(snacks);
    appendMockAdminLog('addSnack', 'snack', newSnackId, name, '', JSON.stringify({ point, saleYn, stock, target }), options.body?.adminMemo);
    res = {
      success: true,
      message: "신규 간식을 등록했습니다.",
      snackId: newSnackId
    };
  } else if (action === 'updateSnack') {
    const snackId = Number(options.body?.snackId);
    const name = options.body?.name;
    const point = Number(options.body?.point);
    const imageUrl = options.body?.imageUrl;
    const stock = Number(options.body?.stock);
    const saleYn = options.body?.saleYn;
    const target = options.body?.target || 'user';
    const snacks = getMockSnacks();
    const snack = snacks.find(s => s.snackId === snackId);
    if (snack) {
      appendMockAdminLog('updateSnack', 'snack', snackId, name, 
        JSON.stringify({ name: snack.name, point: snack.point, imageUrl: snack.imageUrl, saleYn: snack.saleYn, stock: snack.stock, target: snack.target }),
        JSON.stringify({ name, point, imageUrl, saleYn, stock, target }), 
        options.body?.adminMemo
      );
      snack.name = name;
      snack.point = point;
      snack.imageUrl = imageUrl;
      snack.stock = stock;
      snack.saleYn = saleYn;
      snack.active = saleYn;
      snack.target = target;
      saveMockSnacks(snacks);
    }
    res = {
      success: true,
      message: "간식 정보를 수정했습니다."
    };
  } else if (action === 'updateUser') {
    const userId = options.body?.userId;
    const nickname = options.body?.nickname;
    const credit = Number(options.body?.credit || 0);
    const imageUrl = options.body?.imageUrl || '';
    const useYn = options.body?.useYn || 'Y';
    const users = MOCK_DATA.getUsers.users;
    const user = users.find(u => String(u.userId) === String(userId));
    if (user) {
      appendMockAdminLog('updateUser', 'user', userId, nickname,
        JSON.stringify({ nickname: user.nickname, credit: user.credit, imageUrl: user.imageUrl, useYn: user.useYn }),
        JSON.stringify({ nickname, credit, imageUrl, useYn }),
        options.body?.adminMemo
      );
      user.nickname = nickname;
      user.credit = credit;
      user.imageUrl = imageUrl;
      user.useYn = useYn;
      user.active = useYn;
    }
    res = {
      success: true,
      message: "이용자 정보를 수정했습니다."
    };
  } else if (action === 'cancelOrder' || action === 'userCancelOrder') {
    const orderId = options.body?.orderId;
    let updated = false;
    let refundLogs = [];

    // Helper function to process refund and stock restore
    const processItemRefund = (item) => {
      // 1. User refund
      const users = MOCK_DATA.getUsers.users;
      const user = users.find(u => u.nickname === item.nickname);
      if (user) {
        user.credit = (user.credit || 0) + (item.point || 0);
      }
      
      // Update selectedUser if currently active in session
      const selectedUser = JSON.parse(localStorage.getItem('selectedUser'));
      if (selectedUser && selectedUser.nickname === item.nickname) {
        selectedUser.credit = (selectedUser.credit || 0) + (item.point || 0);
        localStorage.setItem('selectedUser', JSON.stringify(selectedUser));
      }

      // 2. Snack stock restore
      const snacks = MOCK_DATA.getSnacks.snacks;
      const snack = snacks.find(s => s.name === item.snackName);
      if (snack) {
        snack.stock = (snack.stock || 0) + (item.quantity || 0);
      }

      refundLogs.push(`${item.snackName} ${item.quantity}개`);
    };

    // 1) Update local mockOrders in localStorage
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    const updatedLocalOrders = localOrders.map(o => {
      if ((o.orderNo === orderId || o.orderToken === orderId) && o.servedYn !== 'C') {
        updated = true;
        processItemRefund(o);
        appendMockAdminLog(action, 'order', orderId, o.nickname, o.servedYn || 'N', 'C', options.body?.adminMemo);
        return { ...o, servedYn: 'C', cancelTimestamp: new Date().toISOString() };
      }
      return o;
    });
    if (updated) {
      localStorage.setItem('mockOrders', JSON.stringify(updatedLocalOrders));
    }

    // 2) Update MOCK_DATA.getOrdersToday in memory
    MOCK_DATA.getOrdersToday.orders.forEach(o => {
      if ((o.orderNo === orderId || o.orderToken === orderId) && o.servedYn !== 'C') {
        updated = true;
        processItemRefund(o);
        appendMockAdminLog(action, 'order', orderId, o.nickname, o.servedYn || 'N', 'C', options.body?.adminMemo);
        o.servedYn = 'C';
        o.cancelTimestamp = new Date().toISOString();
      }
    });

    if (updated) {
      res = {
        success: true,
        message: `주문번호 ${orderId}의 주문이 취소되었습니다. 환불 내역: ${refundLogs.join(', ')}`
      };
    } else {
      res = {
        success: false,
        message: `주문번호 ${orderId}에 해당하는 대기 중이거나 완료된 주문 기록을 찾을 수 없습니다.`
      };
    }
  } else if (action === 'uploadImage') {
    const type = options.body?.type || 'unknown';
    const fileName = options.body?.fileName || 'image.jpg';
    res = {
      success: true,
      imageUrl: `https://drive.google.com/uc?export=view&id=mock_file_id_${type}_${Date.now()}`
    };
  } else if (action === 'submitReview') {
    const orderId = options.body?.orderId;
    const guestName = options.body?.guestName;
    const stamp = options.body?.stamp || '';
    const tags = options.body?.tags || '';
    const comment = options.body?.comment || '';
    const isPublic = options.body?.isPublic !== false && options.body?.isPublic !== 'false';
    const imageUrl = options.body?.imageUrl || '';

    if (!orderId || !guestName) {
      res = { success: false, message: '필수 매개변수가 누락되었습니다.' };
    } else {
      const mockReviews = JSON.parse(localStorage.getItem('mockReviews') || '[]');
      const alreadyExists = mockReviews.some(r => r.orderId === orderId);
      if (alreadyExists) {
        res = { success: false, message: '이미 후기가 작성된 주문번호입니다.' };
      } else {
        mockReviews.push({
          createdAt: new Date().toISOString(),
          orderId,
          guestName,
          stamp,
          tags,
          comment,
          isPublic,
          imageUrl
        });
        localStorage.setItem('mockReviews', JSON.stringify(mockReviews));

        // local orders reviewed 상태 업데이트
        const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
        const updatedLocalOrders = localOrders.map(o => {
          if (o.orderNo === orderId) {
            return { ...o, reviewed: true };
          }
          return o;
        });
        localStorage.setItem('mockOrders', JSON.stringify(updatedLocalOrders));

        // memory orders reviewed 상태 업데이트
        MOCK_DATA.getOrdersToday.orders.forEach(o => {
          if (o.orderNo === orderId) {
            o.reviewed = true;
          }
        });

        res = { success: true, message: '후기가 등록되었습니다.' };
      }
    }
  } else if (action === 'getRecentReviews') {
    const mockReviews = JSON.parse(localStorage.getItem('mockReviews') || '[]');
    const publicReviews = mockReviews
      .filter(r => r.isPublic === true || String(r.isPublic).toUpperCase() === 'TRUE' || r.isPublic === 'Y')
      .map(r => ({
        createdAt: r.createdAt,
        orderId: r.orderId,
        guestName: r.guestName,
        stamp: r.stamp,
        tags: r.tags,
        comment: r.comment,
        imageUrl: r.imageUrl || ''
      }))
      .reverse()
      .slice(0, 10);

    res = { success: true, reviews: publicReviews };
  } else if (action === 'getReviewsForAdmin') {
    const mockReviews = JSON.parse(localStorage.getItem('mockReviews') || '[]');
    const sortedReviews = [...mockReviews].reverse();
    res = { success: true, reviews: sortedReviews };
  } else if (action === 'toggleReviewVisibility') {
    const createdAt = options.body?.createdAt;
    const isPublic = options.body?.isPublic;
    const mockReviews = JSON.parse(localStorage.getItem('mockReviews') || '[]');
    const matched = mockReviews.find(r => String(r.createdAt) === String(createdAt));
    if (matched) {
      matched.isPublic = isPublic;
      localStorage.setItem('mockReviews', JSON.stringify(mockReviews));
      res = { success: true, message: '후기 공개 상태가 변경되었습니다.' };
    } else {
      res = { success: false, message: '해당 후기를 찾을 수 없습니다.' };
    }
  } else if (action === 'getGuestOrderByToken') {
    const tokens = options.body?.tokens || [];
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    const allMockOrders = [...localOrders, ...MOCK_DATA.getOrdersToday.orders];
    const matchedOrders = allMockOrders.filter(o => o.orderToken && tokens.includes(o.orderToken));
    res = {
      success: true,
      orders: matchedOrders.map(o => ({
        timestamp: o.timestamp,
        orderNo: o.orderNo,
        userId: 'guest',
        nickname: o.nickname,
        snackId: o.snackId || 1,
        snackName: o.snackName,
        quantity: o.quantity,
        point: o.point,
        servedYn: o.servedYn || 'N',
        cancelTimestamp: o.cancelTimestamp || '',
        orderToken: o.orderToken || '',
        deliveryType: o.deliveryType || 'pickup',
        deliveryFee: o.deliveryFee || 0,
        totalCredit: o.totalCredit || 0,
        reviewed: o.reviewed || false,
        deliveryPlace: o.deliveryPlace || '',
        cancelReason: o.cancelReason || '',
        cancelReasonDetail: o.cancelReasonDetail || ''
      }))
    };
  } else if (action === 'updateSnacksOrder') {
    const items = options.body?.items || [];
    const snacks = getMockSnacks();
    items.forEach(item => {
      const snack = snacks.find(s => String(s.snackId) === String(item.snackId));
      if (snack) {
        snack.displayOrder = Number(item.displayOrder);
      }
    });
    snacks.sort((a, b) => {
      const oA = typeof a.displayOrder !== 'undefined' ? a.displayOrder : 9999;
      const oB = typeof b.displayOrder !== 'undefined' ? b.displayOrder : 9999;
      return oA - oB;
    });
    saveMockSnacks(snacks);
    res = { success: true, message: '표시 순서를 저장했습니다.' };
  } else if (action === 'archiveOldOrders') {
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    const todayStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');

    const currentOrders = [];
    const archivedOrders = [];

    localOrders.forEach(o => {
      if (o.timestamp) {
        const orderDateStr = o.timestamp.slice(2, 10).replace(/-/g, '');
        if (orderDateStr === todayStr) {
          currentOrders.push(o);
        } else {
          archivedOrders.push(o);
        }
      } else {
        currentOrders.push(o);
      }
    });

    if (archivedOrders.length > 0) {
      const allArchived = JSON.parse(localStorage.getItem('mockArchivedOrders') || '[]');
      localStorage.setItem('mockArchivedOrders', JSON.stringify([...allArchived, ...archivedOrders]));
      localStorage.setItem('mockOrders', JSON.stringify(currentOrders));
    }

    res = { success: true, message: `${archivedOrders.length}건의 지난 주문을 성공적으로 보관 처리했습니다.` };
  } else if (action === 'autoFillEmptySnackIds') {
    const snacks = getMockSnacks();
    let hasInvalid = false;
    let hasDuplicate = false;
    const existingIds = [];
    const emptyCount = snacks.filter(s => !s.snackId).length;

    const idCounts = {};
    snacks.forEach(s => {
      if (!s.snackId && s.snackId !== 0) return;
      existingIds.push(s.snackId);
      if (isNaN(Number(s.snackId)) || String(s.snackId).trim() === '') hasInvalid = true;
      idCounts[s.snackId] = (idCounts[s.snackId] || 0) + 1;
      if (idCounts[s.snackId] > 1) hasDuplicate = true;
    });

    if (hasInvalid || hasDuplicate) {
      res = { success: false, message: '경고: 간식 목록에 숫자가 아닌 ID나 중복된 ID가 존재합니다. 시트를 직접 확인해주세요.', hasError: true };
    } else if (emptyCount === 0) {
      res = { success: true, filledCount: 0, message: '모든 간식ID가 정상입니다.' };
    } else {
      let maxId = 0;
      existingIds.forEach(id => {
        const num = Number(id);
        if (num > maxId) maxId = num;
      });
      let filled = 0;
      snacks.forEach(s => {
        if (!s.snackId && s.snackId !== 0) {
          maxId++;
          s.snackId = maxId;
          filled++;
        }
      });
      saveMockSnacks(snacks);
      res = { success: true, filledCount: filled, message: `${filled}개의 빈 간식ID를 자동으로 채웠습니다.` };
    }
  } else {
    res = { success: false, error: "액션을 찾을 수 없습니다." };
  }

  // 구글 드라이브 이미지 URL 변환 적용
  if (res && res.success) {
    if (Array.isArray(res.users)) {
      res.users = res.users.map(u => ({
        ...u,
        imageUrl: convertDriveImageUrl(u.imageUrl)
      }));
    }
    if (Array.isArray(res.snacks)) {
      res.snacks = res.snacks.map(s => ({
        ...s,
        imageUrl: convertDriveImageUrl(s.imageUrl)
      }));
    }
  }

  return res;
}

function getMockGuestSettings() {
  try {
    const cached = localStorage.getItem('mockGuestSettings');
    if (cached) return JSON.parse(cached);
  } catch (e) {}
  // 기본값 반환 (마감 상태)
  return {
    guestOpen: 'N',
    guestCloseAt: '',
    guestBaseCredit: GUEST_DEFAULT_CREDIT,
    guestDeliveryFee: GUEST_DELIVERY_FEE,
    guestDefaultDeliveryPlace: '사무실 원탁'
  };
}

function saveMockGuestSettings(settings) {
  localStorage.setItem('mockGuestSettings', JSON.stringify(settings));
}

function appendMockAdminLog(action, targetType, targetId, targetName, beforeValue, afterValue, memo) {
  try {
    const logs = JSON.parse(localStorage.getItem('mockAdminLogs') || '[]');
    logs.push({
      timestamp: new Date().toISOString(),
      action,
      targetType,
      targetId,
      targetName,
      beforeValue,
      afterValue,
      memo: memo || ''
    });
    localStorage.setItem('mockAdminLogs', JSON.stringify(logs));
  } catch (e) {
    console.warn('Mock 관리자 로그 저장 실패:', e);
  }
}
