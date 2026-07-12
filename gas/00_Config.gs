// 구글 스프레드시트 시트 탭 이름 상수 정의
const SHEET = {
  SNACKS: '간식목록',
  USERS: '이용자목록',
  ORDERS: '주문내역',
  LOGS: '관리자로그',
  SETTINGS: '운영설정',
  REVIEWS: '후기내역',
  ARCHIVE: '주문보관',
  GUEST_PROFILES: '게스트프로필',
  GUEST_CREDITS: '게스트크레딧',
  GUEST_APPLICATIONS: '이용신청',
};

// Google Drive 폴더 ID 상수 정의
const USER_IMAGE_FOLDER_ID = '1uykUeSeuwxtJvVVK_J7t-3JHY7yq0q_o';
const SNACK_IMAGE_FOLDER_ID = '1kUibvC9O7PeOTZ5r7D4EJTVZ8KhCO6ur';
const REVIEW_IMAGE_FOLDER_ID = '1uykUeSeuwxtJvVVK_J7t-3JHY7yq0q_o'; // 기본적으로 이용자 폴더를 같이 쓰거나 새로 만들어서 기입

// 게스트 최대 가상 크레딧
const GUEST_MAX_CREDIT = 10;
const GUEST_ORDER_COMPLETION_GRACE_MINUTES = 5;

// 관리자 화면에서 조정할 수 있는 운영 수량 상한
const ADMIN_MAX_USER_CREDIT = 15;
const ADMIN_MAX_SNACK_STOCK = 30;

// 관리자 화면에서만 사용하는 변경 API 목록입니다.
const ADMIN_ACTIONS = [
  'verifyAdminAccess',
  'updateOrderServed',
  'updateUserCredit',
  'addUser',
  'updateUserActive',
  'updateSnackStock',
  'updateSnackSale',
  'addSnack',
  'updateUser',
  'updateSnack',
  'cancelOrder',
  'updateSnacksOrder',
  // 'uploadImage', // 게스트 후기 사진 업로드를 위해 허용 (함수 내에서 개별 보안 검증 수행)
  'updateGuestSettings',
  'auditArchiveOldOrders',
  'archiveOldOrders',
  'getReviewsForAdmin',
  'autoFillEmptySnackIds',
  'toggleReviewVisibility',
  'submitReviewReply',
  'getGuestApplicationsForAdmin',
  'getGuestApplicationDetail',
  'updateGuestApplication',
  'updateGuestApplicationSettings',
  'auditExpiredGuestApplications',
  'anonymizeExpiredGuestApplications'
];

/**
 * 관리자 변경 요청 보호용 토큰 검증 함수
 * Apps Script > 프로젝트 설정 > 스크립트 속성에 ADMIN_TOKEN 값을 저장해 둡니다.
 */
function verifyAdminToken(data) {
  const expectedToken = PropertiesService
    .getScriptProperties()
    .getProperty('ADMIN_TOKEN');

  if (!expectedToken) {
    return {
      success: false,
      message: 'ADMIN_TOKEN 스크립트 속성이 설정되지 않았습니다.',
    };
  }

  if (!data.adminToken || String(data.adminToken) !== String(expectedToken)) {
    return {
      success: false,
      message: '관리자 권한이 없습니다.',
    };
  }

  return {
    success: true,
  };
}

function verifyAdminAccess() {
  return {
    success: true,
    message: '관리자 권한이 확인되었습니다.',
  };
}
