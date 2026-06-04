// Google Apps Script API 설정
const API_URL = "https://script.google.com/macros/s/AKfycbxKY36tTxlOMw0WvKEBn2ljbYVgwsdkcyGFS6HPJ9_UPux8bq0xROvNK9E1NCBam0Qe/exec";

// 로컬 테스트 및 API 오류 대응을 위한 Mock 데이터
const MOCK_DATA = {
  getUsers: {
    success: true,
    users: [
      { userId: "user001", nickname: "이니", credit: 10 },
      { userId: "user002", nickname: "준이", credit: 15 },
      { userId: "user003", nickname: "민이", credit: 8 },
      { userId: "user004", nickname: "후니", credit: 20 },
      { userId: "user005", nickname: "수지", credit: 12 },
      { userId: "user006", nickname: "영이", credit: 5 }
    ]
  },
  getSnacks: {
    success: true,
    snacks: [
      { snackId: 1, name: "초코칩 쿠키", point: 1, imageUrl: "" },
      { snackId: 2, name: "감자칩", point: 2, imageUrl: "" },
      { snackId: 3, name: "사이다", point: 1, imageUrl: "" },
      { snackId: 4, name: "오렌지주스", point: 3, imageUrl: "" },
      { snackId: 5, name: "초코우유", point: 2, imageUrl: "" },
      { snackId: 6, name: "하리보 젤리", point: 1, imageUrl: "" }
    ]
  },
  placeOrder: {
    success: true,
    message: "주문이 완료되었습니다!"
  },
  getOrdersToday: {
    success: true,
    orders: [
      { timestamp: new Date(Date.now() - 3600000 * 2).toISOString(), nickname: "이니", snackName: "초코칩 쿠키", quantity: 2, point: 2 },
      { timestamp: new Date(Date.now() - 3600000).toISOString(), nickname: "준이", snackName: "사이다", quantity: 1, point: 1 },
      { timestamp: new Date().toISOString(), nickname: "민이", snackName: "감자칩", quantity: 1, point: 2 }
    ]
  }
};

/**
 * Apps Script API 통신을 담당하는 헬퍼 함수
 * @param {string} action - API 요청 액션 (getUsers, getSnacks, placeOrder, getOrdersToday)
 * @param {Object} [options] - fetch 옵션 (method, body 등)
 * @returns {Promise<Object>} API 응답 데이터
 */
async function fetchAPI(action, options = {}) {
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
  if (action === 'getUsers') return MOCK_DATA.getUsers;
  if (action === 'getSnacks') return MOCK_DATA.getSnacks;
  if (action === 'getOrdersToday') {
    // 로컬 스토리지에 저장된 테스트용 주문 내역이 있으면 그것을 병합
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    return {
      success: true,
      orders: [...localOrders, ...MOCK_DATA.getOrdersToday.orders]
    };
  }
  if (action === 'placeOrder') {
    // 주문 완료 시 로컬 스토리지에 임시 주문 추가 (관리자 화면에서 확인 가능하게)
    const userId = options.body?.userId || 'unknown';
    const items = options.body?.items || [];
    
    // 사용자 이름 매핑
    const users = MOCK_DATA.getUsers.users;
    const user = users.find(u => u.userId === userId) || { nickname: "알수없음" };
    
    // 간식 이름 매핑
    const snacks = MOCK_DATA.getSnacks.snacks;
    
    const newOrders = items.map(item => {
      const snack = snacks.find(s => s.snackId === item.snackId) || { name: `간식 ${item.snackId}`, point: 1 };
      return {
        timestamp: new Date().toISOString(),
        nickname: user.nickname,
        snackName: snack.name,
        quantity: item.quantity,
        point: snack.point * item.quantity
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

    return MOCK_DATA.placeOrder;
  }
  return { success: false, error: "액션을 찾을 수 없습니다." };
}
