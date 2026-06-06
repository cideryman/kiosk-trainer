// Google Apps Script API 설정
const API_URL = "https://script.google.com/macros/s/AKfycbxKY36tTxlOMw0WvKEBn2ljbYVgwsdkcyGFS6HPJ9_UPux8bq0xROvNK9E1NCBam0Qe/exec";

// 로컬 테스트용 Mock 데이터 강제 사용 여부
// - false: 실제 API 호출 (실패 시 Mock으로 자동 폴백하지 않고 실제 에러 메시지 노출)
// - true: 항상 로컬 Mock 데이터를 사용하여 동작 테스트 및 검증 진행
const USE_MOCK = false;

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
      { snackId: 1, name: "초코칩 쿠키", point: 1, imageUrl: "", saleYn: "Y", stock: 5 },
      { snackId: 2, name: "감자칩", point: 2, imageUrl: "", saleYn: "Y", stock: 3 },
      { snackId: 3, name: "사이다", point: 1, imageUrl: "", saleYn: "Y", stock: 0 }, // 품절 테스트용
      { snackId: 4, name: "오렌지주스", point: 3, imageUrl: "", saleYn: "Y", stock: 10 },
      { snackId: 5, name: "초코우유", point: 2, imageUrl: "", saleYn: "Y", stock: 1 }, // 1개 남은 것 테스트용
      { snackId: 6, name: "하리보 젤리", point: 1, imageUrl: "", saleYn: "Y", stock: 8 }
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
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();

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
    console.warn(`[API Warning] 실제 API 호출 실패 혹은 CORS 발생. Mock 데이터를 사용합니다. Action: ${action}`, error);
    // 에러 발생 시 사용자 경험 중단을 막기 위해 Mock 데이터로 폴백 제공
    return {
  success: false,
  message: '구글시트 연결에 실패했습니다.',
  error: String(error)
    };
  }
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
    res = JSON.parse(JSON.stringify(MOCK_DATA.getSnacks));
    const includeHidden = String(options.params?.includeHidden || '').trim().toUpperCase() === 'Y';
    if (!includeHidden) {
      res.snacks = res.snacks.filter(s => {
        const active = String(s.saleYn ?? s.active ?? 'Y').trim().toUpperCase();
        return active === 'TRUE' || active === '판매' || active === 'Y' || active === 'O' || active === '예';
      });
    }
  } else if (action === 'getOrdersToday') {
    // 로컬 스토리지에 저장된 테스트용 주문 내역이 있으면 그것을 병합
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    res = {
      success: true,
      orders: [...localOrders, ...MOCK_DATA.getOrdersToday.orders]
    };
  } else if (action === 'placeOrder') {
    // 주문 완료 시 로컬 스토리지에 임시 주문 추가 (관리자 화면에서 확인 가능하게)
    const userId = options.body?.userId || 'unknown';
    const items = options.body?.items || [];
    
    // 사용자 이름 매핑
    const users = MOCK_DATA.getUsers.users;
    const user = users.find(u => u.userId === userId) || { nickname: "알수없음" };
    
    // 간식 이름 매핑
    const snacks = MOCK_DATA.getSnacks.snacks;
    
    const timestampStr = new Date().toISOString();
    const generatedOrderNo = `ORD-${Date.now()}`;
    const newOrders = items.map(item => {
      const snack = snacks.find(s => s.snackId === item.snackId) || { name: `간식 ${item.snackId}`, point: 1 };
      return {
        timestamp: timestampStr,
        orderNo: generatedOrderNo,
        nickname: user.nickname,
        snackName: snack.name,
        quantity: item.quantity,
        point: snack.point * item.quantity,
        servedYn: 'N'
      };
    });

    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    localStorage.setItem('mockOrders', JSON.stringify([...newOrders, ...localOrders]));

    // 주문에 따른 사용자 크레딧 차감 시뮬레이션
    const selectedUser = JSON.parse(localStorage.getItem('selectedUser'));
    if (selectedUser) {
      const totalCost = newOrders.reduce((sum, o) => sum + o.point, 0);
      selectedUser.credit = Math.max(0, selectedUser.credit - totalCost);
      localStorage.setItem('selectedUser', JSON.stringify(selectedUser));
    }

    res = JSON.parse(JSON.stringify(MOCK_DATA.placeOrder));
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
    const snacks = MOCK_DATA.getSnacks.snacks;
    const snack = snacks.find(s => s.snackId === snackId);
    if (snack) {
      appendMockAdminLog('updateSnackStock', 'snack', snackId, snack.name, snack.stock, stock, options.body?.adminMemo);
      snack.stock = stock;
    }
    res = {
      success: true,
      message: "재고를 업데이트했습니다."
    };
  } else if (action === 'updateSnackSale') {
    const snackId = Number(options.body?.snackId);
    const saleYn = String(options.body?.saleYn || 'N').toUpperCase() === 'Y' ? 'Y' : 'N';
    const snacks = MOCK_DATA.getSnacks.snacks;
    const snack = snacks.find(s => Number(s.snackId) === snackId);
    if (snack) {
      appendMockAdminLog('updateSnackSale', 'snack', snackId, snack.name, snack.saleYn ?? snack.active ?? 'Y', saleYn, options.body?.adminMemo);
      snack.saleYn = saleYn;
      snack.active = saleYn;
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
    const snacks = MOCK_DATA.getSnacks.snacks;
    const maxId = snacks.reduce((max, s) => s.snackId > max ? s.snackId : max, 0);
    const newSnackId = maxId + 1;
    const newSnack = {
      snackId: newSnackId,
      name: name,
      point: point,
      imageUrl: imageUrl,
      saleYn: saleYn,
      stock: stock
    };
    snacks.push(newSnack);
    appendMockAdminLog('addSnack', 'snack', newSnackId, name, '', JSON.stringify({ point, saleYn, stock }), options.body?.adminMemo);
    res = {
      success: true,
      message: "신규 간식을 등록했습니다.",
      snackId: newSnackId
    };
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
