/**
 * 28. 시스템 운영 점검 (진단) API
 * 스프레드시트 탭, 필수 헤더 컬럼, 스크립트 속성 설정 상태를 종합적으로 검사합니다.
 * 토큰이 무효하거나 누락된 경우 기본 연결 성공(Ping-pong)만 반환하고 상세 진단은 생략합니다.
 */
function diagnoseSystem(data) {
  const diagnosisStartedAt = Date.now();
  // 1. 토큰 검증 시도
  const auth = verifyAdminToken(data);
  if (!auth.success) {
    return {
      success: true,
      mode: 'basic',
      message: '구글 앱스 스크립트(GAS) 서버와 통신은 정상이나, 상세 정보를 확인하려면 관리자 비밀번호를 입력해 주세요.'
    };
  }

  // 2. 상세 진단 시작
  const report = {
    success: true,
    mode: 'detailed',
    apiContractVersion: API_CONTRACT_VERSION,
    environment: 'unset',
    sheets: {},
    properties: {},
    security: {},
    triggers: {},
    emailQueue: {},
    cache: {},
    timingsMs: {},
    overallStatus: 'OK'
  };

  const spreadsheetStartedAt = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  report.timingsMs.spreadsheetConnection = Date.now() - spreadsheetStartedAt;
  if (!ss) {
    report.overallStatus = 'ERROR';
    report.message = '스프레드시트를 연결할 수 없습니다. 스프레드시트 바인딩 상태를 확인하세요.';
    report.timingsMs.total = Date.now() - diagnosisStartedAt;
    return report;
  }

  // 시트별 기대 헤더 정의
  const expectedHeaders = {
    [SHEET.USERS]: ['이용자ID', '별명', '크레딧', '사용여부', '사진url'],
    [SHEET.SNACKS]: ['간식ID', '이름', '포인트', '사진URL', '판매여부', '재고', '표시순서', '제공대상'],
    [SHEET.ORDERS]: [
      '주문시간', '주문번호', '이용자ID', '별명', '간식ID', '간식명',
      '수량', '차감포인트', '제공여부', 'cancelTimestamp', 'orderToken',
      'deliveryType', 'deliveryFee', 'totalCredit', 'reviewed', 'deliveryPlace',
      'cancelReason', 'cancelReasonDetail', 'guestDeviceId', 'authProvider', 'guestKey',
      'idempotencyKey', 'commitStatus'
    ],
    [SHEET.LOGS]: ['timestamp', 'action', 'targetType', 'targetId', 'targetName', 'beforeValue', 'afterValue', 'memo'],
    [SHEET.SETTINGS]: ['key', 'value'],
    [SHEET.REVIEWS]: ['createdAt', 'orderId', 'guestName', 'stamp', 'tags', 'comment', 'isPublic', 'imageUrl'],
    [SHEET.ARCHIVE]: [
      '주문시간', '주문번호', '이용자ID', '별명', '간식ID', '간식명',
      '수량', '차감포인트', '제공여부', 'cancelTimestamp', 'orderToken',
      'deliveryType', 'deliveryFee', 'totalCredit', 'reviewed'
    ],
    [SHEET.GUEST_PROFILES]: ['guestKey', 'displayName', 'deliveryPlace', 'updatedAt'],
    [SHEET.GUEST_CREDITS]: [
      'periodKey', 'guestDeviceId', 'guestKey', 'baseCredit', 'bonusCredit',
      'creditLimit', 'usedCredit', 'remainingCredit', 'updatedAt'
    ],
    [SHEET.GUEST_APPLICATIONS]: GUEST_APPLICATION_HEADERS.slice(),
    [SHEET.EMAIL_QUEUE]: ORDER_EMAIL_QUEUE_HEADERS.slice(),
  };

  const headerAliases = {
    [SHEET.USERS]: {
      '이용자ID': ['userId'],
      '별명': ['nickname'],
      '크레딧': ['credit'],
      '사용여부': ['useYn'],
      '사진url': ['imageUrl', '사진URL']
    },
    [SHEET.SNACKS]: {
      '간식ID': ['snackId'],
      '이름': ['name'],
      '포인트': ['point'],
      '사진URL': ['imageUrl', '사진url'],
      '판매여부': ['saleYn'],
      '재고': ['stock'],
      '표시순서': ['displayOrder'],
      '제공대상': ['target']
    },
    [SHEET.ORDERS]: {
      'deliveryPlace': ['deliveryAddress']
    }
  };

  const findHeaderIndex = (headers, sheetName, colName) => {
    const candidates = [colName].concat((headerAliases[sheetName] && headerAliases[sheetName][colName]) || []);
    for (let i = 0; i < candidates.length; i++) {
      const idx = headers.indexOf(candidates[i]);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const isAcceptedOrderTailLayout = (headers) => {
    const acceptedLayouts = [
      ['deliveryPlace', 'cancelReason', 'cancelReasonDetail', 'guestDeviceId', 'authProvider', 'guestKey'],
      ['deliveryAddress', 'cancelReason', 'cancelReasonDetail', 'guestDeviceId', 'authProvider', 'guestKey'],
      ['deliveryAddress', 'cancelReason', 'deliveryPlace', 'cancelReasonDetail', 'guestDeviceId', 'authProvider', 'guestKey']
    ];
    return acceptedLayouts.some(layout => layout.every((colName, offset) => headers[15 + offset] === colName));
  };

  // A. 시트 존재 유무 및 헤더 정합성 체크
  const sheetChecksStartedAt = Date.now();
  for (let key in SHEET) {
    const sheetName = SHEET[key];
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      report.sheets[sheetName] = { exists: false, error: '시트 탭이 누락되었습니다.' };
      report.overallStatus = 'WARN';
      continue;
    }

    const lastColumn = sheet.getLastColumn();
    let headers = [];
    if (lastColumn > 0) {
      headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(h => String(h).trim());
    }

    const expected = expectedHeaders[sheetName];
    if (expected) {
      const missing = [];
      const misaligned = [];

      expected.forEach((colName, index) => {
        const currentIdx = findHeaderIndex(headers, sheetName, colName);
        if (currentIdx === -1) {
          missing.push(colName);
        }
      });

      if (sheetName === SHEET.ORDERS && missing.length === 0 && !isAcceptedOrderTailLayout(headers)) {
        const currentTail = headers.slice(15, 22).map((header, idx) => `${String.fromCharCode(80 + idx)}열=${header || '(빈칸)'}`).join(', ');
        misaligned.push(`P열 이후 주문 확장 컬럼 구조 확인 필요 (${currentTail})`);
      }

      if (missing.length > 0 || misaligned.length > 0) {
        report.sheets[sheetName] = {
          exists: true,
          status: 'WARN',
          missingHeaders: missing,
          misalignedHeaders: misaligned,
          error: `${missing.length > 0 ? '누락된 컬럼: ' + missing.join(', ') : ''} ${misaligned.length > 0 ? '열 순서 불일치: ' + misaligned.join(', ') : ''}`.trim()
        };
        report.overallStatus = 'WARN';
      } else {
        report.sheets[sheetName] = { exists: true, status: 'OK' };
      }
    } else {
      report.sheets[sheetName] = { exists: true, status: 'OK' };
    }
  }
  report.timingsMs.sheetChecks = Date.now() - sheetChecksStartedAt;

  // B. 스크립트 속성 설정 체크
  const propertiesStartedAt = Date.now();
  const props = PropertiesService.getScriptProperties();
  const keysToCheck = [
    { key: 'APP_ENV', required: true, description: '배포 환경 구분(production 또는 staging)' },
    { key: 'ADMIN_TOKEN', required: true, description: '관리자 API 요청 토큰' },
    { key: 'KAKAO_REST_API_KEY', required: true, description: '카카오 로그인 API 키' },
    { key: 'KAKAO_GUEST_KEY_SALT', required: true, description: '게스트 식별키 암호화 솔트' },
    { key: 'KAKAO_CLIENT_SECRET', required: false, description: '카카오 로그인 보안 비밀키 (선택)' },
    { key: 'ADMIN_EMAIL', required: false, description: '새 주문 이메일 알림 수신 주소' }
  ];

  keysToCheck.forEach(item => {
    const val = props.getProperty(item.key);
    if (!val) {
      report.properties[item.key] = {
        configured: false,
        required: item.required,
        description: item.description,
        status: item.required ? 'ERROR' : 'INFO'
      };
      if (item.required) {
        report.overallStatus = 'WARN';
      }
    } else {
      report.properties[item.key] = {
        configured: true,
        required: item.required,
        description: item.description,
        status: 'OK'
      };
    }
  });

  report.environment = String(props.getProperty('APP_ENV') || 'unset').trim().toLowerCase();
  if (report.environment !== 'production' && report.environment !== 'staging') {
    report.properties.APP_ENV = Object.assign({}, report.properties.APP_ENV, {
      status: 'ERROR',
      configured: false,
      message: 'APP_ENV는 production 또는 staging이어야 합니다.'
    });
    report.overallStatus = 'WARN';
  }

  const emailNotificationEnabled = getGuestSettings().adminOrderEmailNotificationEnabled !== false;
  if (emailNotificationEnabled && !props.getProperty('ADMIN_EMAIL')) {
    report.properties.ADMIN_EMAIL = Object.assign({}, report.properties.ADMIN_EMAIL, {
      status: 'WARN',
      message: '이메일 알림이 ON이지만 ADMIN_EMAIL이 없어 실행자 계정 주소에 의존합니다.'
    });
    report.overallStatus = 'WARN';
  }

  const legacyAdminGetEnabled = String(
    props.getProperty('ALLOW_LEGACY_ADMIN_GET') || ''
  ).trim().toUpperCase() === 'Y';
  report.security.legacyAdminGet = {
    enabled: legacyAdminGetEnabled,
    status: legacyAdminGetEnabled ? 'WARN' : 'OK',
    message: legacyAdminGetEnabled
      ? 'Legacy administrator GET access is temporarily enabled.'
      : 'Administrator dashboard GET access is disabled.'
  };
  if (legacyAdminGetEnabled) {
    report.overallStatus = 'WARN';
  }
  report.timingsMs.properties = Date.now() - propertiesStartedAt;

  // C. 주간 이용신청 순환 트리거 체크
  const triggerStartedAt = Date.now();
  try {
    const weeklyTriggers = ScriptApp.getProjectTriggers().filter(trigger => (
      trigger.getHandlerFunction() === 'rotateGuestApplicationWeekly'
    ));
    report.triggers.weeklyRotation = {
      status: weeklyTriggers.length === 1 ? 'OK' : 'WARN',
      count: weeklyTriggers.length,
      handler: 'rotateGuestApplicationWeekly'
    };
    if (weeklyTriggers.length !== 1) report.overallStatus = 'WARN';
    const emailQueueTriggers = ScriptApp.getProjectTriggers().filter(trigger => (
      trigger.getHandlerFunction() === 'processOrderEmailQueue'
    ));
    report.triggers.orderEmailQueue = {
      status: emailQueueTriggers.length === 1 ? 'OK' : (emailNotificationEnabled ? 'WARN' : 'INFO'),
      count: emailQueueTriggers.length,
      handler: 'processOrderEmailQueue'
    };
    if (emailNotificationEnabled && emailQueueTriggers.length !== 1) report.overallStatus = 'WARN';
  } catch (triggerError) {
    report.triggers.weeklyRotation = {
      status: 'WARN',
      count: null,
      error: triggerError.message || String(triggerError)
    };
    report.overallStatus = 'WARN';
  }
  report.timingsMs.triggers = Date.now() - triggerStartedAt;

  const emailQueueStartedAt = Date.now();
  try {
    const queueSheet = ss.getSheetByName(SHEET.EMAIL_QUEUE);
    if (!queueSheet || queueSheet.getLastRow() <= 1) {
      report.emailQueue = {
        status: queueSheet ? 'OK' : (emailNotificationEnabled ? 'WARN' : 'INFO'),
        pending: 0,
        failed: 0,
        oldestPendingAt: ''
      };
      if (!queueSheet && emailNotificationEnabled) report.overallStatus = 'WARN';
    } else {
      const queueValues = queueSheet
        .getRange(2, 1, queueSheet.getLastRow() - 1, ORDER_EMAIL_QUEUE_HEADERS.length)
        .getValues();
      const pendingRows = queueValues.filter(row => {
        const status = String(row[5] || '').trim().toUpperCase();
        return status === 'PENDING' || status === 'PROCESSING';
      });
      const failedRows = queueValues.filter(row => String(row[5] || '').trim().toUpperCase() === 'FAILED');
      const oldestPendingMs = pendingRows.reduce((oldest, row) => {
        const createdMs = row[0] ? new Date(row[0]).getTime() : 0;
        return createdMs && (!oldest || createdMs < oldest) ? createdMs : oldest;
      }, 0);
      report.emailQueue = {
        status: failedRows.length > 0 ? 'WARN' : 'OK',
        pending: pendingRows.length,
        failed: failedRows.length,
        oldestPendingAt: oldestPendingMs ? new Date(oldestPendingMs).toISOString() : ''
      };
      if (failedRows.length > 0) report.overallStatus = 'WARN';
    }
  } catch (queueError) {
    report.emailQueue = { status: 'WARN', error: queueError.message || String(queueError) };
    report.overallStatus = 'WARN';
  }
  report.timingsMs.emailQueue = Date.now() - emailQueueStartedAt;

  // D. 서비스 캐시 왕복 체크. 진단 전용 키만 사용하고 즉시 제거합니다.
  const cacheStartedAt = Date.now();
  const cacheKey = 'system-diagnosis-' + Utilities.getUuid();
  try {
    const cache = CacheService.getScriptCache();
    const cacheValue = String(Date.now());
    cache.put(cacheKey, cacheValue, 30);
    const cachedValue = cache.get(cacheKey);
    cache.remove(cacheKey);
    report.cache.scriptCache = {
      status: cachedValue === cacheValue ? 'OK' : 'WARN',
      roundTrip: cachedValue === cacheValue
    };
    if (cachedValue !== cacheValue) report.overallStatus = 'WARN';
  } catch (cacheError) {
    report.cache.scriptCache = {
      status: 'WARN',
      roundTrip: false,
      error: cacheError.message || String(cacheError)
    };
    report.overallStatus = 'WARN';
  }
  report.timingsMs.cache = Date.now() - cacheStartedAt;
  report.timingsMs.total = Date.now() - diagnosisStartedAt;

  return report;
}

/**
 * staging 안정성 검사에서만 쓰는 고정 fixture를 준비합니다.
 * 운영 환경에서는 관리자 토큰이 맞아도 실행되지 않습니다.
 */
function prepareStabilityFixtures() {
  const environment = String(
    PropertiesService.getScriptProperties().getProperty('APP_ENV') || ''
  ).trim().toLowerCase();
  if (environment !== 'staging') {
    return {
      success: false,
      message: 'Stability fixtures can only be prepared in staging.'
    };
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return {
      success: false,
      message: 'Fixture preparation is already in progress. Please retry shortly.'
    };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const userSheet = ss.getSheetByName(SHEET.USERS);
    const snackSheet = ss.getSheetByName(SHEET.SNACKS);
    if (!userSheet || !snackSheet) {
      return { success: false, message: 'Required fixture sheets are missing.' };
    }

    const userIds = Array.from({ length: 10 }, (_, index) => (
      'STAB_USER_' + String(index + 1).padStart(2, '0')
    ));
    const users = userIds.map((userId, index) => ({
      userId: userId,
      nickname: 'STAB User ' + String(index + 1).padStart(2, '0')
    }));
    const userRows = userSheet.getDataRange().getValues();
    users.forEach(user => {
      const rowIndex = userRows.findIndex((row, index) => index > 0 && String(row[0]) === user.userId);
      const values = [user.userId, user.nickname, 15, 'Y', ''];
      if (rowIndex === -1) {
        userSheet.appendRow(values);
      } else {
        userSheet.getRange(rowIndex + 1, 1, 1, values.length).setValues([values]);
      }
    });

    const snackNames = ['STAB Idempotency', 'STAB Concurrency', 'STAB Oversubscription'];
    const snacks = snackNames.map((name, index) => ({ snackId: 9901 + index, name: name }));
    const snackRows = snackSheet.getDataRange().getValues();
    snacks.forEach((snack, index) => {
      const rowIndex = snackRows.findIndex((row, rowNumber) => (
        rowNumber > 0 && Number(row[0]) === snack.snackId
      ));
      const values = [snack.snackId, snack.name, 1, '', 'Y', 30, 9901 + index, 'user,guest', 0];
      if (rowIndex === -1) {
        snackSheet.appendRow(values);
      } else {
        snackSheet.getRange(rowIndex + 1, 1, 1, values.length).setValues([values]);
      }
    });

    clearUserReadCache();
    clearSnackReadCache();
    return { success: true, users: users, snacks: snacks };
  } finally {
    lock.releaseLock();
  }
}
