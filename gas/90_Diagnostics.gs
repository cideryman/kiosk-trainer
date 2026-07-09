/**
 * 28. 시스템 운영 점검 (진단) API
 * 스프레드시트 탭, 필수 헤더 컬럼, 스크립트 속성 설정 상태를 종합적으로 검사합니다.
 * 토큰이 무효하거나 누락된 경우 기본 연결 성공(Ping-pong)만 반환하고 상세 진단은 생략합니다.
 */
function diagnoseSystem(data) {
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
    sheets: {},
    properties: {},
    overallStatus: 'OK'
  };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    report.overallStatus = 'ERROR';
    report.message = '스프레드시트를 연결할 수 없습니다. 스프레드시트 바인딩 상태를 확인하세요.';
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
      'idempotencyKey'
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

  // B. 스크립트 속성 설정 체크
  const props = PropertiesService.getScriptProperties();
  const keysToCheck = [
    { key: 'ADMIN_TOKEN', required: true, description: '관리자 API 요청 토큰' },
    { key: 'KAKAO_REST_API_KEY', required: true, description: '카카오 로그인 API 키' },
    { key: 'KAKAO_GUEST_KEY_SALT', required: true, description: '게스트 식별키 암호화 솔트' },
    { key: 'KAKAO_CLIENT_SECRET', required: false, description: '카카오 로그인 보안 비밀키 (선택)' }
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

  return report;
}
