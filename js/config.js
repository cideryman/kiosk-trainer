// Google Apps Script API 설정
const API_URL = "https://script.google.com/macros/s/AKfycbxKY36tTxlOMw0WvKEBn2ljbYVgwsdkcyGFS6HPJ9_UPux8bq0xROvNK9E1NCBam0Qe/exec";

// 게스트 기본 설정 상수
const GUEST_DEFAULT_CREDIT = 10;
const GUEST_DELIVERY_FEE = 3;
const GUEST_ORDER_COMPLETION_GRACE_MINUTES = 5;
const ADMIN_MAX_USER_CREDIT = 15;
const ADMIN_MAX_SNACK_STOCK = 30;
const MOCK_GUEST_APPLICATION_DEFAULT_CAPACITY = 5;
const MOCK_GUEST_APPLICATION_MAX_CAPACITY = 100;

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
      { userId: "user004", nickname: "후니", credit: 15, useYn: "Y", imageUrl: "" },
      { userId: "user005", nickname: "수지", credit: 12, useYn: "Y", imageUrl: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80" },
      { userId: "user006", nickname: "영이", credit: 5, useYn: "Y", imageUrl: "" }
    ]
  },
  getSnacks: {
    success: true,
    snacks: [
      { snackId: 1, name: "초코칩 쿠키", point: 1, imageUrl: "", saleYn: "Y", stock: 5, target: "user" },
      { snackId: 2, name: "감자칩", point: 2, imageUrl: "", saleYn: "Y", stock: 3, target: "user" },
      { snackId: 3, name: "사이다", point: 1, imageUrl: "", saleYn: "Y", stock: 0, target: "guest" }, // 품절 테스트용
      { snackId: 4, name: "오렌지주스", point: 3, imageUrl: "", saleYn: "Y", stock: 10, target: "guest" },
      { snackId: 5, name: "초코우유", point: 2, imageUrl: "", saleYn: "Y", stock: 1, target: "user" }, // 1개 남은 것 테스트용
      { snackId: 6, name: "하리보 젤리", point: 1, imageUrl: "", saleYn: "Y", stock: 8, target: "guest" }
    ]
  },
  placeOrder: {
    success: true,
    message: "주문이 완료되었습니다!"
  },
  submitReviewReply: {
    success: true,
    message: "후기 답글이 성공적으로 등록되었습니다."
  },
  getOrdersToday: {
    success: true,
    orders: [
      { timestamp: new Date(Date.now() - 3600000 * 3).toISOString(), orderNo: "ORD-20260716-00001", nickname: "길동이", snackName: "초코우유", quantity: 1, point: 2, servedYn: "N", deliveryType: "delivery", deliveryPlace: "A동 101호", deliveryFee: 3 },
      { timestamp: new Date(Date.now() - 3600000 * 2).toISOString(), orderNo: "ORD-20260716-00002", nickname: "이니", snackName: "초코칩 쿠키", quantity: 2, point: 2, servedYn: "N", deliveryType: "pickup" },
      { timestamp: new Date(Date.now() - 3600000).toISOString(), orderNo: "ORD-20260716-00003", nickname: "준이", snackName: "사이다", quantity: 1, point: 1, servedYn: "Y", deliveryType: "pickup" },
      { timestamp: new Date().toISOString(), orderNo: "ORD-20260716-00004", nickname: "민이", snackName: "감자칩", quantity: 1, point: 2, servedYn: "N", deliveryType: "delivery", deliveryPlace: "B동 202호", deliveryFee: 3 }
    ]
  }
};

const MOCK_GUEST_APPLICATION_SETTINGS = {
  success: true,
  applicationOpen: true,
  target: '영주시장애인복지관 봉사자·후원자와 관리자가 이용 가능하다고 인정한 관계자',
  operatingDays: '매주 수요일',
  orderTime: '운영일 오전 10시부터 오전 11시 30분까지\n\n운영 일정에 따라 주문 시간이 달라질 수 있으며, 정확한 시간은 별도로 안내합니다.',
  deliveryTime: '오후 1시부터 주문 확인 순서에 따라 배달합니다.',
  serviceArea: '복지관과 사전에 협의된 장소',
  usageGuide: '이용 신청과 관리자 확인을 완료한 뒤, 안내받은 배달왔삼 주문 페이지에서 직접 주문합니다.',
  preferredDayOptions: ['수요일'],
  capacity: MOCK_GUEST_APPLICATION_DEFAULT_CAPACITY,
  closedMessage: '현재 이용 신청을 받고 있지 않습니다.'
};

let MOCK_GUEST_APPLICATIONS = [
  {
    createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    applicationId: 'APP-20260712-001',
    requestId: 'mock_guest_application_0001',
    name: '김봉사',
    relationType: 'VOLUNTEER',
    relationDetail: '',
    phone: '01012345678',
    deliveryPlace: '원당로 OO반점',
    deliveryDetail: '도착하면 담당자에게 알려주세요.',
    preferredDays: '수요일',
    message: '오후 운영일을 선호합니다.',
    consentAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    status: 'PENDING',
    contactedAt: '',
    reviewedAt: '',
    retentionUntil: '',
    anonymizedAt: '',
    adminMemo: '',
    updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
  }
];

function getMockGuestApplicationCounts(applications) {
  const counts = { ALL: applications.length, PENDING: 0, APPROVED: 0, REJECTED: 0, INACTIVE: 0, EXPIRED: 0 };
  applications.forEach(application => {
    if (Object.prototype.hasOwnProperty.call(counts, application.status)) counts[application.status]++;
  });
  return counts;
}

function getMockGuestApplicationCapacity(value) {
  const capacity = Number(String(value === undefined || value === null ? '' : value).trim());
  return Number.isInteger(capacity) && capacity >= 1 && capacity <= MOCK_GUEST_APPLICATION_MAX_CAPACITY
    ? capacity
    : MOCK_GUEST_APPLICATION_DEFAULT_CAPACITY;
}

function getMockGuestApplicationFullMessage(capacity) {
  return `1차 시범 이용 신청 ${capacity}명이 모두 접수되어 현재 모집을 마감했습니다. 추가 모집은 기관 담당자에게 문의해 주세요.`;
}

function getMockGuestApplicationCapacityState(
  applications = MOCK_GUEST_APPLICATIONS,
  capacityValue = MOCK_GUEST_APPLICATION_SETTINGS.capacity
) {
  const capacity = getMockGuestApplicationCapacity(capacityValue);
  const activeCount = applications.reduce((count, application) => {
    if (application.anonymizedAt) return count;
    return ['PENDING', 'APPROVED'].includes(String(application.status || '').toUpperCase())
      ? count + 1
      : count;
  }, 0);
  const remainingSlots = Math.max(0, capacity - activeCount);
  return {
    capacity,
    activeCount,
    remainingSlots,
    applicationFull: remainingSlots === 0
  };
}

function getMockGuestApplicationSettingsResponse() {
  const capacityState = getMockGuestApplicationCapacityState();
  const applicationOpenConfigured = MOCK_GUEST_APPLICATION_SETTINGS.applicationOpen === true;
  const applicationClosedReason = !applicationOpenConfigured
    ? 'MANUAL'
    : (capacityState.applicationFull ? 'FULL' : '');
  const configuredClosedMessage = MOCK_GUEST_APPLICATION_SETTINGS.closedMessage || '';
  return {
    ...JSON.parse(JSON.stringify(MOCK_GUEST_APPLICATION_SETTINGS)),
    applicationOpen: applicationOpenConfigured && !capacityState.applicationFull,
    applicationOpenConfigured,
    applicationClosedReason,
    ...capacityState,
    closedMessage: applicationClosedReason === 'FULL'
      ? getMockGuestApplicationFullMessage(capacityState.capacity)
      : configuredClosedMessage,
    configuredClosedMessage
  };
}

function getMockGuestApplicationList(status) {
  const all = MOCK_GUEST_APPLICATIONS.slice();
  const visible = !status || status === 'ALL' ? all : all.filter(application => application.status === status);
  return visible.map(application => ({
    applicationId: application.applicationId,
    createdAt: application.createdAt,
    name: application.name,
    relationType: application.relationType,
    phoneMasked: application.phone ? `${application.phone.slice(0, 3)}-****-${application.phone.slice(-4)}` : '-',
    deliverySummary: application.deliveryPlace,
    preferredDays: application.preferredDays,
    status: application.status,
    contactedAt: application.contactedAt,
    retentionUntil: application.retentionUntil,
    anonymizedAt: application.anonymizedAt,
    updatedAt: application.updatedAt
  }));
}

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
// API 호출 캐시 저장소 (정적/기초 데이터 로딩 부하 경감용)
const API_CACHE = {};

/**
 * Apps Script API 통신을 담당하는 헬퍼 함수
 * @param {string} action - API 요청 액션 (getUsers, getSnacks, placeOrder, getOrdersToday)
 * @param {Object} [options] - fetch 옵션 (method, body 등)
 * @returns {Promise<Object>} API 응답 데이터
 */
async function fetchAPI(action, options = {}) {
  const method = options.method || 'GET';

  // 1. 뮤테이션(쓰기 작업) 발생 시 모든 캐시 삭제하여 정합성 유지
  const isMutation = method === 'POST' || /^(update|delete|place|cancel|submit|toggle|archive)/.test(action);
  if (isMutation) {
    for (const key in API_CACHE) {
      delete API_CACHE[key];
    }
  }

  // 2. 캐시 조회 (GET 요청이면서 getUsers인 경우 2분 캐싱 적용)
  const isCacheable = method === 'GET' && (action === 'getUsers');
  const cacheKey = `${action}_${options.params ? JSON.stringify(options.params) : ''}`;
  if (isCacheable) {
    const cached = API_CACHE[cacheKey];
    if (cached && (Date.now() - cached.timestamp < 120000)) { // 2분 캐시
      safeLog(`[API Cache Hit] Using cached data for ${action}`);
      return cached.data;
    }
  }

  if (typeof USE_MOCK !== 'undefined' && USE_MOCK) {
    console.log(`[API Mock] USE_MOCK이 활성화되어 있어 Mock 데이터를 사용합니다. Action: ${action}`);
    return getMockFallback(action, options);
  }

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

  // 20초 타임아웃 제어 설정 (GAS 콜드 스타트 및 네트워크 지연 대비)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.warn(`[API Timeout] ${action} 요청이 20초 동안 응답이 없어 강제 중단합니다.`);
    controller.abort();
  }, 20000);
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
    safeLog("API Request", { url, method, action });
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

      // 캐시 저장
      if (isCacheable) {
        API_CACHE[cacheKey] = {
          data: data,
          timestamp: Date.now()
        };
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
      message: '데이터 연결에 실패했습니다.',
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
      const parseTargetList = (t) => {
        const str = String(t || 'user').toLowerCase();
        return str.split(',').map(s => s.trim()).filter(Boolean);
      };
      if (cleanedMode === 'user' || cleanedMode === 'kiosk') {
        res.snacks = res.snacks.filter(s => {
          const tList = parseTargetList(s.target);
          return tList.includes('user');
        });
      } else if (cleanedMode === 'guest') {
        const settings = getMockGuestSettings();
        const menuMode = String(settings.guestMenuMode || 'normal').toLowerCase();
        if (menuMode === 'event') {
          res.snacks = res.snacks.filter(s => {
            const tList = parseTargetList(s.target);
            return tList.includes('event') || tList.includes('campaign');
          });
        } else {
          res.snacks = res.snacks.filter(s => {
            const tList = parseTargetList(s.target);
            return tList.includes('guest');
          });
        }
      }
    }
  } else if (action === 'getGuestApplicationSettings') {
    res = getMockGuestApplicationSettingsResponse();
  } else if (action === 'submitGuestApplication') {
    const body = options.body || {};
    const requestId = String(body.requestId || '').trim();
    const existingRequest = MOCK_GUEST_APPLICATIONS.find(application => application.requestId === requestId);
    const settings = getMockGuestApplicationSettingsResponse();
    const normalizedPhone = String(body.phone || '').replace(/\D/g, '');
    const duplicatePhone = MOCK_GUEST_APPLICATIONS.find(application => (
      !application.anonymizedAt
      && String(application.phone || '').replace(/\D/g, '') === normalizedPhone
    ));

    if (existingRequest) {
      res = {
        success: true,
        idempotent: true,
        applicationId: existingRequest.applicationId,
        status: existingRequest.status,
        message: '이미 접수된 Mock 신청 결과를 확인했습니다.'
      };
    } else if (!settings.applicationOpenConfigured) {
      res = { success: false, code: 'APPLICATION_CLOSED', message: settings.closedMessage };
    } else if (duplicatePhone && normalizedPhone) {
      res = { success: false, code: 'DUPLICATE_PHONE', message: '이미 접수된 신청이 있습니다.' };
    } else if (settings.applicationFull) {
      res = {
        success: false,
        code: 'APPLICATION_FULL',
        message: getMockGuestApplicationFullMessage(settings.capacity),
        capacity: settings.capacity,
        activeCount: settings.activeCount,
        remainingSlots: 0
      };
    } else {
      const now = new Date().toISOString();
      const applicationId = 'APP-MOCK-' + String(Date.now()).slice(-6);
      MOCK_GUEST_APPLICATIONS.push({
        createdAt: now,
        applicationId,
        requestId,
        name: body.name || 'Mock 신청자',
        relationType: body.relationType || 'OTHER',
        relationDetail: body.relationDetail || '',
        phone: normalizedPhone,
        deliveryPlace: body.deliveryPlace || '',
        deliveryDetail: body.deliveryDetail || '',
        preferredDays: Array.isArray(body.preferredDays) ? body.preferredDays.join(', ') : String(body.preferredDays || ''),
        message: body.message || '',
        consentAt: now,
        status: 'PENDING',
        contactedAt: '',
        reviewedAt: '',
        retentionUntil: '',
        anonymizedAt: '',
        adminMemo: '',
        updatedAt: now
      });
      res = {
        success: true,
        applicationId,
        status: 'PENDING',
        capacity: settings.capacity,
        remainingSlots: Math.max(0, settings.remainingSlots - 1),
        message: 'Mock 이용 신청이 접수되었습니다.'
      };
    }
  } else if (action === 'getGuestApplicationsForAdmin') {
    const status = String(options.body?.status || 'ALL').toUpperCase();
    res = {
      success: true,
      counts: getMockGuestApplicationCounts(MOCK_GUEST_APPLICATIONS),
      settings: getMockGuestApplicationSettingsResponse(),
      applications: getMockGuestApplicationList(status)
    };
  } else if (action === 'getGuestApplicationDetail') {
    const application = MOCK_GUEST_APPLICATIONS.find(item => item.applicationId === options.body?.applicationId);
    res = application
      ? { success: true, application: JSON.parse(JSON.stringify(application)) }
      : { success: false, message: '신청 정보를 찾을 수 없습니다.' };
  } else if (action === 'updateGuestApplication') {
    const application = MOCK_GUEST_APPLICATIONS.find(item => item.applicationId === options.body?.applicationId);
    if (!application) {
      res = { success: false, message: '신청 정보를 찾을 수 없습니다.' };
    } else {
      const now = new Date().toISOString();
      const nextStatus = options.body?.status ? String(options.body.status).toUpperCase() : '';
      const previousStatus = String(application.status || '').toUpperCase();
      const previousUsesCapacity = ['PENDING', 'APPROVED'].includes(previousStatus);
      const nextUsesCapacity = ['PENDING', 'APPROVED'].includes(nextStatus);
      const capacityState = getMockGuestApplicationCapacityState();
      if (nextStatus && !previousUsesCapacity && nextUsesCapacity && capacityState.applicationFull) {
        res = {
          success: false,
          code: 'APPLICATION_FULL',
          message: `현재 1차 시범 신청 정원 ${capacityState.capacity}명이 모두 차 있어 승인할 수 없습니다. 먼저 다른 신청을 반려 또는 중지해 주세요.`
        };
      } else {
        if (nextStatus) {
          application.status = nextStatus;
          application.reviewedAt = now;
          application.retentionUntil = ['REJECTED', 'INACTIVE'].includes(application.status)
            ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            : '';
        }
        if (options.body?.contacted !== undefined) application.contactedAt = options.body.contacted ? now : '';
        if (options.body?.adminMemo !== undefined) application.adminMemo = options.body.adminMemo;
        application.updatedAt = now;
        res = { success: true, applicationId: application.applicationId, status: application.status, message: 'Mock 신청 정보가 저장되었습니다.' };
      }
    }
  } else if (action === 'updateGuestApplicationSettings') {
    const hasCapacityInput = options.body?.capacity !== undefined && options.body?.capacity !== null && String(options.body.capacity).trim() !== '';
    const capacityInput = hasCapacityInput ? Number(options.body.capacity) : null;
    if (hasCapacityInput && (!Number.isInteger(capacityInput) || capacityInput < 1 || capacityInput > MOCK_GUEST_APPLICATION_MAX_CAPACITY)) {
      res = { success: false, message: '모집 정원은 1명부터 100명 사이의 정수로 입력해 주세요.' };
    } else {
      MOCK_GUEST_APPLICATION_SETTINGS.applicationOpen = Boolean(options.body?.applicationOpen);
      MOCK_GUEST_APPLICATION_SETTINGS.target = options.body?.target || '';
      MOCK_GUEST_APPLICATION_SETTINGS.operatingDays = options.body?.operatingDays || '';
      MOCK_GUEST_APPLICATION_SETTINGS.orderTime = options.body?.orderTime || '';
      MOCK_GUEST_APPLICATION_SETTINGS.deliveryTime = options.body?.deliveryTime || '';
      MOCK_GUEST_APPLICATION_SETTINGS.serviceArea = options.body?.serviceArea || '';
      MOCK_GUEST_APPLICATION_SETTINGS.usageGuide = options.body?.usageGuide || '';
      MOCK_GUEST_APPLICATION_SETTINGS.preferredDayOptions = String(options.body?.preferredDayOptions || '').split(',').map(day => day.trim()).filter(Boolean);
      if (hasCapacityInput) MOCK_GUEST_APPLICATION_SETTINGS.capacity = capacityInput;
      MOCK_GUEST_APPLICATION_SETTINGS.closedMessage = options.body?.closedMessage || '';
      res = { success: true, message: 'Mock 신청 설정이 저장되었습니다.' };
    }
  } else if (action === 'auditExpiredGuestApplications') {
    res = { success: true, count: 0, applications: [], message: '익명화할 만료 신청 정보가 없습니다.' };
  } else if (action === 'anonymizeExpiredGuestApplications') {
    res = options.body?.confirmText === '신청정보정리'
      ? { success: true, count: 0, message: '0건의 만료 개인정보를 익명화했습니다.' }
      : { success: false, message: '확인 문구 신청정보정리를 정확히 입력해 주세요.' };
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
        kakaoGuestBonusCredit: settings.kakaoGuestBonusCredit ?? 2,
        guestDeliveryFee: settings.guestDeliveryFee,
        guestDefaultDeliveryPlace: settings.guestDefaultDeliveryPlace ?? '사무실 원탁',
        guestMenuMode: settings.guestMenuMode || 'normal',
        guestEventName: settings.guestEventName || '장애인식 개선 캠페인',
        guestOrderGraceMinutes: GUEST_ORDER_COMPLETION_GRACE_MINUTES,
        isGuestOpenNow,
        remainingSeconds,
        message
      };
  } else if (action === 'getKakaoLoginConfig') {
    res = {
      success: true,
      clientId: 'mock-kakao-client-id',
      message: 'Mock 카카오 설정입니다.'
    };
  } else if (action === 'exchangeKakaoAuthCode') {
    if (!options.body?.code) {
      res = { success: false, message: '카카오 인증 코드가 누락되었습니다.' };
    } else {
      res = {
        success: true,
        provider: 'kakao',
        guestKey: 'kakao_mock_guest',
        message: 'Mock 카카오 연결이 완료되었습니다.'
      };
    }
  } else if (action === 'getGuestCreditStatus') {
    res = resolveMockGuestCreditWallet(options.body || {}, { create: false });
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
    } else if (settingsAction === 'updateMenuMode') {
      settings.guestMenuMode = String(options.body?.guestMenuMode || 'normal').toLowerCase();
      if (options.body?.guestEventName !== undefined) {
        settings.guestEventName = String(options.body?.guestEventName).trim();
      }
      appendMockAdminLog('updateGuestSettings', 'settings', 'guestMenuMode', '게스트 메뉴 모드', '', settings.guestMenuMode === 'event' ? `행사 모드 (${settings.guestEventName})` : '배달왔삼 기본 모드', options.body?.adminMemo);
    } else if (settingsAction === 'updateValues') {
      settings.guestBaseCredit = Number(options.body?.guestBaseCredit);
      settings.guestDeliveryFee = Number(options.body?.guestDeliveryFee);
      settings.guestDefaultDeliveryPlace = String(options.body?.guestDefaultDeliveryPlace || '사무실 원탁').trim();
      if (options.body?.guestMenuMode !== undefined) {
        settings.guestMenuMode = String(options.body.guestMenuMode).toLowerCase();
      }
      if (options.body?.guestEventName !== undefined) {
        settings.guestEventName = String(options.body.guestEventName).trim();
      }
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
        orderToken: '',
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
      orders: matchedOrders.map(o => ({ ...o, orderToken: '', reviewed: o.reviewed || false }))
    };
  } else if (action === 'getGuestOrdersByGuestKey') {
    const authProvider = options.body?.authProvider;
    const guestKey = options.body?.guestKey;
    const includeArchived = options.body?.includeArchived === true;
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    const mockArchived = includeArchived ? JSON.parse(localStorage.getItem('mockArchivedOrders') || '[]') : [];
    const allMockOrders = [...localOrders, ...mockArchived, ...MOCK_DATA.getOrdersToday.orders];
    const todayStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const matchedOrders = allMockOrders.filter(o => {
      const isToday = o.timestamp && o.timestamp.slice(2, 10).replace(/-/g, '') === todayStr;
      if (!includeArchived && !isToday) return false;
      return o.userId === 'guest' && o.authProvider === authProvider && o.guestKey === guestKey;
    });

    res = {
      success: true,
      orders: matchedOrders.map(o => ({ ...o, reviewed: o.reviewed || false }))
    };
  } else if (action === 'getGuestProfileByGuestKey') {
    const authProvider = options.body?.authProvider;
    const guestKey = options.body?.guestKey;
    const profiles = JSON.parse(localStorage.getItem('mockGuestProfiles') || '{}');
    if (authProvider !== 'kakao' || !guestKey) {
      res = { success: false, message: '카카오 연결 정보가 누락되었습니다.' };
    } else {
      res = {
        success: true,
        profile: profiles[guestKey] || null
      };
    }
  } else if (action === 'deleteGuestProfileByGuestKey') {
    const authProvider = options.body?.authProvider;
    const guestKey = options.body?.guestKey;
    const profiles = JSON.parse(localStorage.getItem('mockGuestProfiles') || '{}');
    if (authProvider !== 'kakao' || !guestKey) {
      res = { success: false, message: '카카오 연결 정보가 누락되었습니다.' };
    } else {
      delete profiles[guestKey];
      localStorage.setItem('mockGuestProfiles', JSON.stringify(profiles));
      res = { success: true, message: '저장된 게스트 정보가 삭제되었습니다.' };
    }
  } else if (action === 'updateGuestProfileByGuestKey') {
    const authProvider = options.body?.authProvider;
    const guestKey = options.body?.guestKey;
    const displayName = options.body?.displayName;
    const deliveryPlace = options.body?.deliveryPlace;
    const profiles = JSON.parse(localStorage.getItem('mockGuestProfiles') || '{}');
    if (authProvider !== 'kakao' || !guestKey) {
      res = { success: false, message: '카카오 연결 정보가 누락되었습니다.' };
    } else if (!displayName) {
      res = { success: false, message: '주문표시명을 입력해 주세요.' };
    } else {
      profiles[guestKey] = {
        displayName: String(displayName).trim(),
        deliveryPlace: String(deliveryPlace || '').trim(),
        updatedAt: new Date().toISOString()
      };
      localStorage.setItem('mockGuestProfiles', JSON.stringify(profiles));
      res = {
        success: true,
        message: '프로필 정보가 수정되었습니다.',
        profile: profiles[guestKey]
      };
    }
  } else if (action === 'getOrdersToday') {
    // 로컬 스토리지에 저장된 테스트용 주문 내역이 있으면 그것을 병합
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    const mockOrders = [...localOrders, ...MOCK_DATA.getOrdersToday.orders];
    res = {
      success: true,
      orders: mockOrders.map(o => ({ ...o, orderToken: '', reviewed: o.reviewed || false })),
      orderSheetRowCount: mockOrders.length
    };
  } else if (action === 'placeOrder') {
    // 주문 완료 시 로컬 스토리지에 임시 주문 추가 (관리자 화면에서 확인 가능하게)
    const userId = options.body?.userId || 'unknown';
    const items = options.body?.items || [];
    const isGuest = (userId === 'guest');
    const idempotencyKey = String(options.body?.idempotencyKey || '').trim();
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    const idempotentRows = idempotencyKey
      ? localOrders.filter(o => o.idempotencyKey === idempotencyKey && String(o.userId) === String(userId))
      : [];
    if (idempotentRows.length > 0) {
      const firstRow = idempotentRows[0];
      const replayTotal = Number(firstRow.totalCredit || idempotentRows.reduce((sum, row) => sum + Number(row.point || 0), 0));
      const selectedUser = JSON.parse(localStorage.getItem('selectedUser') || 'null');
      return {
        ...JSON.parse(JSON.stringify(MOCK_DATA.placeOrder)),
        orderNo: firstRow.orderNo || '',
        orderToken: firstRow.orderToken || '',
        totalPoint: replayTotal,
        afterCredit: selectedUser ? Number(selectedUser.credit || 0) : undefined,
        idempotencyKey,
        idempotentReplay: true
      };
    }

    // 게스트 주문 시 운영 상태 검증
    if (isGuest) {
      const gSettings = getMockGuestSettings();
      if (gSettings.guestOpen !== 'Y') {
        return { success: false, message: '게스트 주문이 마감되었습니다.' };
      }
      if (gSettings.guestCloseAt) {
        const closeAt = new Date(gSettings.guestCloseAt);
        const now = new Date();
        if (now >= closeAt) {
          const startedAt = new Date(options.body?.orderStartedAt || '');
          const graceEndsAt = new Date(
            closeAt.getTime() + GUEST_ORDER_COMPLETION_GRACE_MINUTES * 60 * 1000
          );
          const canCompleteStartedOrder =
            !Number.isNaN(startedAt.getTime()) &&
            startedAt <= closeAt &&
            now <= graceEndsAt;
          if (!canCompleteStartedOrder) {
            return { success: false, message: '주문 운영 종료 후 완료 가능 시간이 지났습니다.' };
          }
        }
      }

      const hasKakaoKey = options.body?.authProvider === 'kakao' && options.body?.guestKey;
      if (!options.body?.guestDeviceId && !hasKakaoKey) {
        return { success: false, message: '게스트 주문 확인 정보가 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.' };
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
    const allMockOrders = [...localOrders, ...MOCK_DATA.getOrdersToday.orders];
    const todayMockOrders = allMockOrders.filter(o => {
      if (!o.timestamp) return false;
      const oDateStr = o.timestamp.slice(2, 10).replace(/-/g, '');
      return oDateStr === todayStr;
    });
    let maxSeq = 0;
    todayMockOrders.forEach(o => {
      const orderNoStr = String(o.orderNo || '');
      const parts = orderNoStr.split('-');
      if (parts.length >= 3) {
        const num = Number(parts[2]);
        if (!isNaN(num) && num > maxSeq) {
          maxSeq = num;
        }
      }
    });
    const seq = maxSeq + 1;
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
    let gSettings = null;
    if (isGuest && deliveryType === 'delivery') {
      gSettings = getMockGuestSettings();
      deliveryFee = gSettings.guestDeliveryFee;
    } else {
      deliveryFee = Number(options.body?.deliveryFee || 0);
    }

    const snackTotalCost = items.reduce((sum, item) => {
      const snack = snacks.find(s => s.snackId === item.snackId) || { point: 1 };
      return sum + (Number(snack.point || 0) * Number(item.quantity || 0));
    }, 0);
    const totalCost = snackTotalCost + deliveryFee;
    let guestCreditUpdate = null;
    if (isGuest) {
      const authProvider = options.body?.authProvider === 'kakao' ? 'kakao' : '';
      guestCreditUpdate = resolveMockGuestCreditWallet({
        guestDeviceId: options.body?.guestDeviceId || '',
        authProvider,
        guestKey: authProvider === 'kakao' ? options.body?.guestKey || '' : ''
      }, {
        settings: gSettings || getMockGuestSettings(),
        spendCredit: totalCost,
        create: true
      });
      if (!guestCreditUpdate.success) {
        return guestCreditUpdate;
      }
    }

    const newOrders = items.map(item => {
      const snack = snacks.find(s => s.snackId === item.snackId) || { name: `간식 ${item.snackId}`, point: 1 };
      return {
        timestamp: timestampStr,
        orderNo: generatedOrderNo,
        orderToken: orderToken,
        userId: userId,
        nickname: nickname,
        snackName: snack.name,
        quantity: item.quantity,
        point: snack.point * item.quantity,
        servedYn: 'N',
        deliveryType: deliveryType,
        deliveryFee: deliveryFee,
        totalCredit: totalCost,
        deliveryPlace: deliveryPlace,
        guestDeviceId: isGuest ? String(options.body?.guestDeviceId || '') : '',
        authProvider: isGuest && options.body?.authProvider === 'kakao' ? 'kakao' : '',
        guestKey: isGuest && options.body?.guestKey ? String(options.body.guestKey) : '',
        idempotencyKey: idempotencyKey,
        reviewed: false
      };
    });

    localStorage.setItem('mockOrders', JSON.stringify([...newOrders, ...localOrders]));
    const shouldRememberGuestProfile = options.body?.rememberGuestProfile === true || String(options.body?.rememberGuestProfile || '').trim().toUpperCase() === 'Y';
    if (isGuest && options.body?.authProvider === 'kakao' && options.body?.guestKey && shouldRememberGuestProfile) {
      const guestKey = String(options.body.guestKey);
      const profiles = JSON.parse(localStorage.getItem('mockGuestProfiles') || '{}');
      const currentProfile = profiles[guestKey] || {};
      profiles[guestKey] = {
        displayName: String(options.body?.guestName || currentProfile.displayName || '').trim(),
        deliveryPlace: deliveryPlace || currentProfile.deliveryPlace || '',
        updatedAt: new Date().toISOString()
      };
      localStorage.setItem('mockGuestProfiles', JSON.stringify(profiles));
    }

    // 주문에 따른 사용자 크레딧 차감 시뮬레이션
    const selectedUser = JSON.parse(localStorage.getItem('selectedUser'));
    if (selectedUser) {
      selectedUser.credit = isGuest && guestCreditUpdate
        ? guestCreditUpdate.remainingCredit
        : Math.max(0, selectedUser.credit - totalCost);
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
    res.totalPoint = totalCost;
    res.idempotencyKey = idempotencyKey;
    if (guestCreditUpdate) {
      res.beforeCredit = guestCreditUpdate.remainingCredit + totalCost;
      res.afterCredit = guestCreditUpdate.remainingCredit;
      res.bonusCredit = guestCreditUpdate.bonusCredit || 0;
    }
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
    if (!Number.isFinite(credit) || credit < 0 || credit > ADMIN_MAX_USER_CREDIT) {
      res = { success: false, message: `이용자 크레딧은 0~${ADMIN_MAX_USER_CREDIT} 범위로 입력해 주세요.` };
    } else {
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
    }
  } else if (action === 'addUser') {
    const nickname = options.body?.nickname || "새 이용자";
    const credit = Number(options.body?.credit || 0);
    const imageUrl = options.body?.imageUrl || "";
    const useYn = options.body?.useYn || "Y";
    if (!Number.isFinite(credit) || credit < 0 || credit > ADMIN_MAX_USER_CREDIT) {
      res = { success: false, message: `이용자 크레딧은 0~${ADMIN_MAX_USER_CREDIT} 범위로 입력해 주세요.` };
    } else {
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
    }
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
    if (!Number.isFinite(stock) || stock < 0 || stock > ADMIN_MAX_SNACK_STOCK) {
      res = { success: false, message: `간식 재고는 0~${ADMIN_MAX_SNACK_STOCK} 범위로 입력해 주세요.` };
    } else {
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
    }
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
    if (!Number.isFinite(stock) || stock < 0 || stock > ADMIN_MAX_SNACK_STOCK) {
      res = { success: false, message: `간식 재고는 0~${ADMIN_MAX_SNACK_STOCK} 범위로 입력해 주세요.` };
    } else {
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
    }
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
    if (!Number.isFinite(stock) || stock < 0 || stock > ADMIN_MAX_SNACK_STOCK) {
      res = { success: false, message: `간식 재고는 0~${ADMIN_MAX_SNACK_STOCK} 범위로 입력해 주세요.` };
    } else if (snack) {
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
    if (!Number.isFinite(credit) || credit < 0 || credit > ADMIN_MAX_USER_CREDIT) {
      res = { success: false, message: `이용자 크레딧은 0~${ADMIN_MAX_USER_CREDIT} 범위로 입력해 주세요.` };
    } else if (user) {
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
    let guestCreditRefund = null;

    // Helper function to process refund and stock restore
    const processItemRefund = (item) => {
      if (item.userId === 'guest' && !guestCreditRefund) {
        guestCreditRefund = {
          orderTime: item.timestamp,
          guestDeviceId: item.guestDeviceId || '',
          authProvider: item.authProvider || '',
          guestKey: item.guestKey || '',
          refundCredit: Number(item.totalCredit || item.point || 0)
        };
      }

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
      if (guestCreditRefund && guestCreditRefund.refundCredit > 0) {
        resolveMockGuestCreditWallet(guestCreditRefund, {
          periodKey: getMockGuestCreditPeriodKey(guestCreditRefund.orderTime || new Date()),
          refundCredit: guestCreditRefund.refundCredit,
          create: true
        });
      }
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
    const fileName = options.body?.fileName;
    const base64Data = options.body?.base64Data || '';

    if (!base64Data || !fileName || !type) {
      res = { success: false, message: '필수 매개변수(base64Data, fileName, type)가 누락되었습니다.' };
    } else if (base64Data.length > 4700000) {
      res = { success: false, message: '이미지 파일 크기가 너무 큽니다. 3.5MB 이하의 파일만 업로드 가능합니다.' };
    } else if (!/^data:(image\/(jpeg|png|webp|gif|jpg));base64,/i.test(base64Data)) {
      res = { success: false, message: '허용되지 않는 파일 형식입니다. 이미지 파일(jpg, jpeg, png, webp, gif)만 업로드할 수 있습니다.' };
    } else if (type === 'review') {
      const orderToken = String(options.body?.orderToken || '').trim();
      const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
      const allMockOrders = [...localOrders, ...MOCK_DATA.getOrdersToday.orders];
      const matchedOrders = allMockOrders.filter(o =>
        String(o.orderToken || '').trim() === orderToken && String(o.userId || '') === 'guest'
      );

      if (!orderToken) {
        res = { success: false, message: '주문 확인 정보(토큰)가 없어 이미지를 업로드할 수 없습니다.' };
      } else if (matchedOrders.length === 0) {
        res = { success: false, message: '유효하지 않은 주문 정보입니다.' };
      } else if (!matchedOrders.some(o => o.servedYn === 'Y' || o.status === '수령완료')) {
        res = { success: false, message: '수령완료된 주문만 후기 사진을 업로드할 수 있습니다.' };
      } else if (matchedOrders.some(o => o.reviewed === true || String(o.reviewed).toUpperCase() === 'TRUE' || String(o.reviewed).toUpperCase() === 'Y')) {
        res = { success: false, message: '이미 응원 메시지를 남긴 주문입니다.' };
      } else {
        res = {
          success: true,
          imageUrl: `https://drive.google.com/uc?export=view&id=mock_file_id_${type}_${Date.now()}`
        };
      }
    } else if (type === 'user' || type === 'snack') {
      res = {
        success: true,
        imageUrl: `https://drive.google.com/uc?export=view&id=mock_file_id_${type}_${Date.now()}`
      };
    } else {
      res = { success: false, message: '올바르지 않은 이미지 타입입니다.' };
    }
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
        imageUrl: r.imageUrl || '',
        replyText: r.replyText || '',
        replyCreatedAt: r.replyCreatedAt || ''
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
  } else if (action === 'submitReviewReply') {
    const orderId = options.body?.orderId;
    const replyText = options.body?.replyText || '';
    const mockReviews = JSON.parse(localStorage.getItem('mockReviews') || '[]');
    const matched = mockReviews.find(r => String(r.orderId) === String(orderId));
    if (matched) {
      matched.replyText = replyText;
      matched.replyCreatedAt = new Date().toISOString();
      localStorage.setItem('mockReviews', JSON.stringify(mockReviews));
      res = { success: true, message: '후기 답글이 성공적으로 등록되었습니다.' };
    } else {
      res = { success: false, message: '해당 주문의 후기를 찾을 수 없습니다.' };
    }
  } else if (action === 'getGuestOrderByToken') {
    const tokens = options.body?.tokens || [];
    const includeArchived = options.body?.includeArchived === true;
    const localOrders = JSON.parse(localStorage.getItem('mockOrders') || '[]');
    const mockArchived = includeArchived ? JSON.parse(localStorage.getItem('mockArchivedOrders') || '[]') : [];
    const allMockOrders = [...localOrders, ...mockArchived, ...MOCK_DATA.getOrdersToday.orders];
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
        authProvider: o.authProvider || '',
        guestKey: o.guestKey || '',
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
  } else if (action === 'verifyAdminAccess') {
    const adminToken = String(options.body?.adminToken || '').trim();
    res = adminToken
      ? { success: true, message: '관리자 권한이 확인되었습니다.' }
      : { success: false, message: '관리자 권한이 없습니다.' };
  } else if (action === 'diagnoseSystem') {
    const adminToken = options.body?.adminToken;
    if (!adminToken) {
      res = {
        success: true,
        mode: 'basic',
        message: '구글 앱스 스크립트(GAS) 서버와 통신은 정상이나, 상세 정보를 확인하려면 관리자 비밀번호를 입력해 주세요.'
      };
    } else {
      res = {
        success: true,
        mode: 'detailed',
        overallStatus: 'OK',
        sheets: {
          '간식목록': { exists: true, status: 'OK' },
          '이용자목록': { exists: true, status: 'OK' },
          '주문내역': { exists: true, status: 'OK' },
          '관리자로그': { exists: true, status: 'OK' },
          '운영설정': { exists: true, status: 'OK' },
          '후기내역': { exists: true, status: 'OK' },
          '주문보관': { exists: true, status: 'OK' },
          '게스트프로필': { exists: true, status: 'OK' },
          '게스트크레딧': { exists: true, status: 'OK' },
          '이용신청': { exists: true, status: 'OK' }
        },
        properties: {
          'ADMIN_TOKEN': { configured: true, required: true, description: '관리자 API 요청 토큰', status: 'OK' },
          'KAKAO_REST_API_KEY': { configured: true, required: true, description: '카카오 로그인 API 키', status: 'OK' },
          'KAKAO_GUEST_KEY_SALT': { configured: true, required: true, description: '게스트 식별키 암호화 솔트', status: 'OK' },
          'KAKAO_CLIENT_SECRET': { configured: false, required: false, description: '카카오 로그인 보안 비밀키 (선택)', status: 'INFO' }
        }
      };
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
    kakaoGuestBonusCredit: 2,
    guestDeliveryFee: GUEST_DELIVERY_FEE,
    guestDefaultDeliveryPlace: '사무실 원탁'
  };
}

function saveMockGuestSettings(settings) {
  localStorage.setItem('mockGuestSettings', JSON.stringify(settings));
}

function getMockGuestCreditPeriodKey(dateValue) {
  const date = dateValue ? new Date(dateValue) : new Date();
  const validDate = isNaN(date.getTime()) ? new Date() : date;
  const year = validDate.getFullYear();
  const month = String(validDate.getMonth() + 1).padStart(2, '0');
  const day = String(validDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function splitMockGuestCreditDeviceIds(value) {
  return String(value || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
}

function mergeMockGuestCreditDeviceIds(currentIds, nextId) {
  const merged = [];
  (currentIds || []).forEach(id => {
    const normalized = String(id || '').trim();
    if (normalized && !merged.includes(normalized)) {
      merged.push(normalized);
    }
  });

  const normalizedNextId = String(nextId || '').trim();
  if (normalizedNextId && !merged.includes(normalizedNextId)) {
    merged.push(normalizedNextId);
  }

  return merged.slice(-20);
}

function getMockKakaoGuestBonusCredit(settings) {
  return Number(settings && settings.kakaoGuestBonusCredit !== undefined ? settings.kakaoGuestBonusCredit : 2);
}

function resolveMockGuestCreditWallet(data = {}, options = {}) {
  const settings = options.settings || getMockGuestSettings();
  const periodKey = options.periodKey || getMockGuestCreditPeriodKey();
  const guestDeviceId = String(data.guestDeviceId || '').trim();
  const requestedGuestKey = String(data.guestKey || '').trim();
  const authProvider = String(data.authProvider || '').trim().toLowerCase();
  const guestKey = authProvider === 'kakao' && requestedGuestKey ? requestedGuestKey : '';
  const spendCredit = Number(options.spendCredit || 0);
  const refundCredit = Number(options.refundCredit || 0);
  const wallets = JSON.parse(localStorage.getItem('mockGuestCreditWallets') || '[]');

  const matched = wallets
    .map((wallet, index) => ({
      ...wallet,
      index,
      guestDeviceIds: splitMockGuestCreditDeviceIds(wallet.guestDeviceId)
    }))
    .filter(wallet => {
      if (String(wallet.periodKey || '') !== periodKey) return false;
      const matchByDevice = guestDeviceId && wallet.guestDeviceIds.includes(guestDeviceId);
      const matchByGuestKey = guestKey && String(wallet.guestKey || '') === guestKey;
      return matchByDevice || matchByGuestKey;
    });

  const baseCredit = Number(settings.guestBaseCredit || GUEST_DEFAULT_CREDIT);
  const hasKakaoLink = !!guestKey || matched.some(wallet => wallet.guestKey);
  const bonusCredit = hasKakaoLink ? getMockKakaoGuestBonusCredit(settings) : 0;
  const creditLimit = baseCredit + bonusCredit;
  let usedCredit = matched.reduce((sum, wallet) => sum + Number(wallet.usedCredit || 0), 0);

  if (spendCredit > 0) {
    if (creditLimit - usedCredit < spendCredit) {
      return {
        success: false,
        periodKey,
        baseCredit,
        bonusCredit,
        creditLimit,
        usedCredit,
        remainingCredit: Math.max(0, creditLimit - usedCredit),
        message: `크레딧이 부족합니다. 오늘 남은 크레딧: ${Math.max(0, creditLimit - usedCredit)}개`
      };
    }
    usedCredit += spendCredit;
  }

  if (refundCredit > 0) {
    usedCredit = Math.max(0, usedCredit - refundCredit);
  }

  const remainingCredit = Math.max(0, creditLimit - usedCredit);
  const shouldPersist = options.create || spendCredit > 0 || refundCredit > 0 || matched.length > 1;
  if (shouldPersist) {
    const primary = matched[0] || null;
    let mergedDeviceIds = [];
    matched.forEach(wallet => {
      wallet.guestDeviceIds.forEach(deviceId => {
        mergedDeviceIds = mergeMockGuestCreditDeviceIds(mergedDeviceIds, deviceId);
      });
    });

    const nextWallet = {
      periodKey,
      guestDeviceId: mergeMockGuestCreditDeviceIds(mergedDeviceIds, guestDeviceId).join(','),
      guestKey: guestKey || (primary ? primary.guestKey : ''),
      baseCredit,
      bonusCredit,
      creditLimit,
      usedCredit,
      remainingCredit,
      updatedAt: new Date().toISOString()
    };

    if (primary) {
      wallets[primary.index] = nextWallet;
      const removeIndexes = new Set(matched.slice(1).map(wallet => wallet.index));
      localStorage.setItem('mockGuestCreditWallets', JSON.stringify(wallets.filter((_, index) => !removeIndexes.has(index))));
    } else if (nextWallet.guestDeviceId || nextWallet.guestKey) {
      wallets.push(nextWallet);
      localStorage.setItem('mockGuestCreditWallets', JSON.stringify(wallets));
    }
  }

  return {
    success: true,
    periodKey,
    baseCredit,
    bonusCredit,
    creditLimit,
    usedCredit,
    remainingCredit
  };
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
