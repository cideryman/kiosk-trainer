const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = {
    console,
    Math,
    Date,
    String,
    Number,
    Boolean,
    Array,
    Object,
    JSON,
    RegExp,
    parseInt,
    isNaN,
    Utilities: {
      formatDate: (d, tz, format) => {
        const dt = new Date(d);
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const day = String(dt.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
    },
    Session: {
      getScriptTimeZone: () => 'Asia/Seoul'
    },
    SHEET: {
      SETTINGS: '운영설정',
      ORDERS: '주문내역',
      SNACKS: '간식목록',
      USERS: '이용자목록',
      GUEST_CREDITS: '게스트크레딧',
      ADMIN_LOGS: '관리자로그'
    }
  };
  vm.createContext(context);

  const files = [
    'gas/00_Config.gs',
    'gas/02_SheetSafety.gs',
    'gas/04_PublicSecurity.gs',
    'gas/30_GuestCredits.gs',
    'gas/31_OrderShared.gs',
    'gas/60_Settings.gs',
    'gas/61_GuestSchedule.gs'
  ];

  files.forEach(file => {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    vm.runInContext(code, context);
  });

  return context;
}

const ctx = loadContext();

// 1. 기본 설정 검증
const defaults = ctx.getDefaultGuestSettings();
assert.equal(defaults.kioskOrderPolicy, 'once_daily', '기본 정책은 once_daily여야 함');
assert.equal(defaults.kioskCooldownMinutes, 60, '기본 쿨다운은 60분이어야 함');

// 2. buildGuestSettingsResponse 검증
const response = ctx.buildGuestSettingsResponse(
  {
    kioskOrderPolicy: 'COOLDOWN',
    kioskCooldownMinutes: '45'
  },
  {
    isGuestOpenNow: false,
    remainingSeconds: 0
  }
);
assert.equal(response.kioskOrderPolicy, 'cooldown', '소문자로 정규화되어야 함');
assert.equal(response.kioskCooldownMinutes, 45, '숫자로 변환되어야 함');

// 3. gas/40_Orders.gs 소스 정적 검증
const orderSource = fs.readFileSync(path.join(root, 'gas/40_Orders.gs'), 'utf8');
assert(orderSource.includes('data.staffBypass !== true'), 'staffBypass 우회 조건이 있어야 함');
assert(orderSource.includes('guestSettings.kioskOrderPolicy'), 'kioskOrderPolicy 조회가 있어야 함');
assert(orderSource.includes('hasPreparingOrder'), '준비 중 주문 차단 로직이 있어야 함');
assert(orderSource.includes('kioskPolicy === \'once_daily\' && hasServedOrderToday'), '1일 1회 제공 완료 차단 로직이 있어야 함');
assert(orderSource.includes('kioskPolicy === \'cooldown\' && hasServedOrderToday'), '쿨다운 시간 차단 로직이 있어야 함');
assert(orderSource.includes('kioskOrderPolicy: guestSettings.kioskOrderPolicy || \'once_daily\''), 'getPublicOrderFeed에 kioskOrderPolicy가 포함되어야 함');
assert(orderSource.includes('userId: (order.authProvider === \'kakao\' || order.userId === \'guest\') ? \'\' : String(order.userId || \'\')'), 'getPublicOrderFeed에서 일반 이용자 userId가 포함되어야 함');

assert(orderSource.includes("status === 'N' || status === 'P' || status === 'R'"), 'N, P, R 주문 차단 조건이 있어야 함');

// 4. 프론트엔드 파일 검증
const kitchenHtml = fs.readFileSync(path.join(root, 'kitchen.html'), 'utf8');
assert(kitchenHtml.includes('id="input-kiosk-order-policy"'), 'kitchen.html에 input-kiosk-order-policy가 있어야 함');
assert(kitchenHtml.includes('id="input-kiosk-cooldown-minutes"'), 'kitchen.html에 input-kiosk-cooldown-minutes가 있어야 함');

const kitchenJs = fs.readFileSync(path.join(root, 'js/kitchen.js'), 'utf8');
assert(kitchenJs.includes('setKioskOrderPolicy'), 'kitchen.js에 setKioskOrderPolicy 함수가 있어야 함');
assert(kitchenJs.includes('kioskOrderPolicy'), 'kitchen.js 저장 페이로드에 kioskOrderPolicy가 있어야 함');

const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(indexHtml.includes('id="friendly-notice-overlay"'), 'index.html에 친절 안내 모달이 있어야 함');
assert(indexHtml.includes('id="staff-bypass-overlay"'), 'index.html에 직원 우회 모달이 있어야 함');
assert(indexHtml.includes('user-card-hold-progress'), 'index.html에 롱프레스 게이지가 있어야 함');
assert(indexHtml.includes('openStaffBypassModal'), 'index.html에 openStaffBypassModal이 있어야 함');
assert(indexHtml.includes('updateKioskUserStatusesFromFeed'), 'index.html에 updateKioskUserStatusesFromFeed가 있어야 함');
assert(indexHtml.includes("status === 'R'"), 'index.html에 R(준비완료) 분기가 있어야 함');

const confirmJs = fs.readFileSync(path.join(root, 'js/confirm.js'), 'utf8');
assert(confirmJs.includes('currentOrderStaffBypass'), 'confirm.js에서 currentOrderStaffBypass 확인 및 staffBypass 전송이 있어야 함');

const styleCss = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
assert(styleCss.includes('.user-card.is-preparing'), 'css/style.css에 is-preparing 스타일이 있어야 함');
assert(styleCss.includes('.user-card.is-ready'), 'css/style.css에 is-ready 스타일이 있어야 함');
assert(styleCss.includes('.user-card.is-served'), 'css/style.css에 is-served 스타일이 있어야 함');
assert(styleCss.includes('.user-card-hold-progress'), 'css/style.css에 롱프레스 게이지 스타일이 있어야 함');

console.log('All 18 Kiosk order restriction & UI integration tests PASSED!');
