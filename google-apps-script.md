# 구글 앱스 스크립트 (Google Apps Script) 참고 가이드

이 문서는 간식 키오스크 프로젝트의 백엔드 데이터베이스 역할을 수행하는 구글 스프레드시트의 **Apps Script** 최종 코드입니다.

---

## 1. 적용 방법

1. 구글 스프레드시트를 엽니다.
2. 상단 메뉴에서 **[확장 프로그램] > [Apps Script]**를 클릭합니다.
3. 기존 편집기 창에 있는 코드 전체를 지우고 아래 **최종 코드** 내용으로 전체 덮어쓰기(붙여넣기) 합니다.
4. 상단의 **[저장 (디스크 아이콘)]**을 클릭합니다.
5. 좌측 메뉴의 **[프로젝트 설정]**을 열고 **스크립트 속성**에 아래 값을 추가합니다:
   - **속성**: `ADMIN_TOKEN`
   - **값**: 관리자만 아는 비밀번호/토큰 값 (예: 센터 내부 관리자 비밀번호)
6. 우측 상단의 **[배포] > [새 배포]**를 선택합니다.
7. 배포 유형이 **[웹앱]**인지 확인하고 아래 항목들을 설정합니다:
   - **설명**: `v3 - 이용자 관리 추가` (임의 기입)
   - **웹앱을 실행할 사용자**: `나 (본인 이메일)`
   - **액세스할 수 있는 사용자**: `모든 사용자 (Anyone)` (중요!)
8. **[배포]**를 클릭하고, 최초 1회 구글 계정 액세스 권한 승인 창이 뜨면 권한 승인을 완료합니다.
9. 발급되는 **웹앱 URL(API URL)** 주소를 복사하여 프론트엔드의 `js/config.js` 내 `API_URL` 값에 붙여넣습니다.

---

## 2. 최종 소스코드 (Code.gs)

```javascript
/**
 * 1. 이미지 주소 변환 및 가공 함수
 * 구글 드라이브 주소를 받아 썸네일/보기 주소 포맷으로 자동 정규화합니다.
 */
function makeImageUrl(value) {
  if (!value) return '';

  const text = String(value).trim();
  const match = text.match(/\/d\/([a-zA-Z0-9_-]+)/);

  if (match && match[1]) {
    return `https://drive.google.com/uc?export=view&id=${match[1]}`;
  }

  if (text.startsWith('https://drive.google.com/uc')) return text;
  if (text.startsWith('http')) return text;

  return `https://drive.google.com/uc?export=view&id=${text}`;
}

// 구글 스프레드시트 시트 탭 이름 상수 정의
const SHEET = {
  SNACKS: '간식목록',
  USERS: '이용자목록',
  ORDERS: '주문내역',
  LOGS: '관리자로그',
  SETTINGS: '운영설정',
  REVIEWS: '후기내역',
  ARCHIVE: '주문보관',
};

// Google Drive 폴더 ID 상수 정의
const USER_IMAGE_FOLDER_ID = '1uykUeSeuwxtJvVVK_J7t-3JHY7yq0q_o';
const SNACK_IMAGE_FOLDER_ID = '1kUibvC9O7PeOTZ5r7D4EJTVZ8KhCO6ur';

// 게스트 최대 가상 크레딧
const GUEST_MAX_CREDIT = 10;

// 관리자 화면에서만 사용하는 변경 API 목록입니다.
const ADMIN_ACTIONS = [
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
  'uploadImage',
  'updateGuestSettings',
  'archiveOldOrders',
  'getReviewsForAdmin',
  'autoFillEmptySnackIds'
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

/**
 * 2. GET 요청 라우터 (조회 API)
 */
function doGet(e) {
  Logger.log('doGet Request: ' + JSON.stringify(e.parameter));
  const action = e.parameter.action;

  if (action === 'getUsers') {
    return jsonResponse(getUsers(e.parameter.includeInactive));
  }

  if (action === 'getSnacks') {
    return jsonResponse(getSnacks(e.parameter.includeHidden, e.parameter.mode));
  }

  if (action === 'getOrdersToday') {
    return jsonResponse(getOrdersToday());
  }

  if (action === 'getOrderStatus') {
    const identifier = e.parameter.orderNo || e.parameter.orderToken;
    return jsonResponse(getOrderStatus(identifier));
  }

  if (action === 'getGuestOrdersToday') {
    return jsonResponse(getGuestOrdersToday(e.parameter.guestName));
  }

  if (action === 'getGuestSettings') {
    return jsonResponse(getGuestSettings());
  }

  if (action === 'getRecentReviews') {
    return jsonResponse(getRecentReviews());
  }

  return jsonResponse({
    success: false,
    message: '알 수 없는 요청입니다.',
  });
}

/**
 * 3. POST 요청 라우터 (데이터 변경/추가 API)
 */
function doPost(e) {
  var JSON_STRING = e.postData.contents;
  Logger.log('doPost Request: ' + JSON_STRING);
  var data = JSON.parse(JSON_STRING);
  var action = data.action;

  if (ADMIN_ACTIONS.indexOf(action) !== -1) {
    const auth = verifyAdminToken(data);
    if (!auth.success) {
      return jsonResponse(auth);
    }
  }
  
  if (action === 'placeOrder') {
    return jsonResponse(placeOrder(data));
  } else if (action === 'updateOrderServed') {
    return jsonResponse(updateOrderServed(data));
  } else if (action === 'updateUserCredit') {
    return jsonResponse(updateUserCredit(data));
  } else if (action === 'addUser') {
    return jsonResponse(addUser(data));
  } else if (action === 'updateUserActive') {
    return jsonResponse(updateUserActive(data));
  } else if (action === 'updateSnackStock') {
    return jsonResponse(updateSnackStock(data));
  } else if (action === 'updateSnackSale') {
    return jsonResponse(updateSnackSale(data));
  } else if (action === 'addSnack') {
    return jsonResponse(addSnack(data));
  } else if (action === 'updateUser') {
    return jsonResponse(updateUser(data));
  } else if (action === 'updateSnack') {
    return jsonResponse(updateSnack(data));
  } else if (action === 'cancelOrder') {
    return jsonResponse(cancelOrder(data));
  } else if (action === 'userCancelOrder') {
    return jsonResponse(userCancelOrder(data));
  } else if (action === 'updateSnacksOrder') {
    return jsonResponse(updateSnacksOrder(data));
  } else if (action === 'uploadImage') {
    return jsonResponse(uploadImage(data));
  } else if (action === 'updateGuestSettings') {
    return jsonResponse(updateGuestSettings(data));
  } else if (action === 'submitReview') {
    return jsonResponse(submitReview(data));
  } else if (action === 'archiveOldOrders') {
    return jsonResponse(archiveOldOrders(data));
  } else if (action === 'getReviewsForAdmin') {
    return jsonResponse(getReviewsForAdmin());
  } else if (action === 'ensureOrderHeaders') {
    return jsonResponse({ success: true, message: ensureOrderHeaders() });
  } else if (action === 'autoFillEmptySnackIds') {
    return jsonResponse(autoFillEmptySnackIds());
  }
  
  return jsonResponse({
    success: false, 
    message: '알 수 없는 액션입니다.'
  });
}

/**
 * 4. JSON 응답 변환 유틸리티
 */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function appendAdminLog(action, targetType, targetId, targetName, beforeValue, afterValue, memo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET.LOGS);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET.LOGS);
    sheet.appendRow(['timestamp', 'action', 'targetType', 'targetId', 'targetName', 'beforeValue', 'afterValue', 'memo']);
  }

  sheet.appendRow([
    new Date(),
    action,
    targetType,
    targetId,
    targetName || '',
    beforeValue,
    afterValue,
    memo || ''
  ]);
}

/**
 * 5. 이용자 목록 조회
 */
function getUsers(includeInactive) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.USERS);

  if (!sheet) {
    return {
      success: false,
      message: '이용자목록 시트를 찾을 수 없습니다.'
    };
  }

  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1);
  const shouldIncludeInactive = String(includeInactive || '').trim().toUpperCase() === 'Y';

  const users = rows
    .filter(row => row[0] || row[1])
    .filter(row => {
      if (shouldIncludeInactive) return true;
      const active = String(row[3] || '').trim().toUpperCase();
      return active === 'TRUE' || active === '사용' || active === 'Y' || active === 'O' || active === '예';
    })
    .map(row => ({
      userId: row[0],
      nickname: row[1],
      credit: Number(row[2] || 0),
      active: row[3],
      useYn: row[3],
      imageUrl: makeImageUrl(row[4]),
    }));

  return {
    success: true,
    users,
  };
}

/**
 * 6. 간식 목록 조회
 */
function getSnacks(includeHidden, mode) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET.SNACKS);
  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1);
  const shouldIncludeHidden = String(includeHidden || '').trim().toUpperCase() === 'Y';

  let snacks = rows
    .filter(row => row[0] || row[1])
    .filter(row => {
      if (shouldIncludeHidden) return true;
      const active = String(row[4]).trim().toUpperCase();
      return (
        active === 'TRUE' ||
        active === '판매' ||
        active === 'Y' ||
        active === 'O' ||
        active === '예'
      );
    })
    .map(row => {
      const stock = Number(row[5] || 0);
      const target = row[7] ? String(row[7]).trim().toLowerCase() : 'user';

      return {
        snackId: row[0],
        name: row[1],
        point: Number(row[2]),
        imageUrl: makeImageUrl(row[3]),
        active: row[4],
        saleYn: row[4],
        stock,
        soldOut: stock <= 0,
        displayOrder: Number(row[6] || 0),
        target: target,
      };
    });

  if (mode) {
    const cleanedMode = String(mode).trim().toLowerCase();
    if (cleanedMode === 'user') {
      snacks = snacks.filter(s => s.target === 'user' || s.target === 'both');
    } else if (cleanedMode === 'guest') {
      snacks = snacks.filter(s => s.target === 'guest' || s.target === 'both');
    }
  }

  return {
    success: true,
    snacks,
  };
}

function isActiveValue(value) {
  const v = String(value || '').trim().toUpperCase();
  return v === 'Y' || v === 'TRUE' || v === '활성' || v === '판매' || v === 'O' || v === '예';
}

function canOrderSnack(snackRow, mode) {
  if (!isActiveValue(snackRow[4])) {
    return false;
  }

  const target = String(snackRow[7] || 'user').trim().toLowerCase();

  if (mode === 'guest') {
    return target === 'all' || target === 'both' || target === 'guest';
  }

  if (mode === 'user' || mode === 'kiosk') {
    return target === 'all' || target === 'both' || target === 'user' || target === 'kiosk';
  }

  return false;
}

/**
 * 7. 주문 접수 및 크레딧/재고 자동 계산 처리
 */
function placeOrder(data) {
  const userId = data.userId;
  const items = data.items;

  if (!userId || !items || items.length === 0) {
    return {
      success: false,
      message: '주문 정보가 부족합니다.',
    };
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return {
      success: false,
      message: '다른 주문을 처리 중입니다. 잠시 후 다시 시도해 주세요.',
    };
  }

  try {
    const ss = SpreadsheetApp.getActive();
    const userSheet = ss.getSheetByName(SHEET.USERS);
    const snackSheet = ss.getSheetByName(SHEET.SNACKS);
    const orderSheet = ss.getSheetByName(SHEET.ORDERS);

    const snacks = snackSheet.getDataRange().getValues();

    let nickname = '';
    let currentCredit = 0;
    let userRowIndex = -1;
    const isGuest = (String(userId) === 'guest');
    let guestFee = 0;
    
    ensureOrderHeaders();
    const headers = orderSheet.getDataRange().getValues()[0] || [];
    const deviceIdIdx = headers.indexOf('guestDeviceId');

    if (isGuest) {
      const gSettings = getGuestSettings();
      if (!gSettings.isGuestOpenNow) {
        return {
          success: false,
          message: gSettings.message || '게스트 주문이 마감되었습니다.',
        };
      }
      
      if (!gSettings.guestAllowMultipleOrders && data.guestDeviceId) {
        const orderValues = orderSheet.getDataRange().getValues();
        const servedYnIdx = headers.indexOf('제공여부');
        let hasActiveOrder = false;
        for (let i = 1; i < orderValues.length; i++) {
          const row = orderValues[i];
          if (deviceIdIdx !== -1 && String(row[deviceIdIdx]) === String(data.guestDeviceId)) {
            const status = String(row[servedYnIdx !== -1 ? servedYnIdx : 8]).trim();
            if (!['제공완료', '배달완료', '취소', '관리자취소', 'Y', 'C'].includes(status)) {
              hasActiveOrder = true;
              break;
            }
          }
        }
        if (hasActiveOrder) {
          return {
            success: false,
            message: '현재 진행 중인 주문이 있습니다. 주문 완료 후 다시 주문해주세요.'
          };
        }
      }

      nickname = (data.guestName || '게스트') + ' (비회원)';
      currentCredit = gSettings.guestBaseCredit;
      guestFee = gSettings.guestDeliveryFee;
    } else {
      const users = userSheet.getDataRange().getValues();
      userRowIndex = users.findIndex((row, index) => {
        return index > 0 && String(row[0]) === String(userId);
      });

      if (userRowIndex === -1) {
        return {
          success: false,
          message: '이용자를 찾을 수 없습니다.',
        };
      }

      nickname = users[userRowIndex][1];
      currentCredit = Number(users[userRowIndex][2]);
    }

    let totalPoint = 0;
    const orderItems = [];

    items.forEach(item => {
      const snackRowIndex = snacks.findIndex((row, index) => {
        return index > 0 && String(row[0]) === String(item.snackId);
      });

      if (snackRowIndex === -1) {
        throw new Error('간식을 찾을 수 없습니다: ' + item.snackId);
      }

      const snack = snacks[snackRowIndex];

      const snackId = snack[0];
      const snackName = snack[1];
      const point = Number(snack[2]);
      const quantity = Number(item.quantity);
      const stock = Number(snack[5] || 0);

      const mode = isGuest ? 'guest' : 'user';
      if (!canOrderSnack(snack, mode)) {
        throw new Error(`'${snackName}' 은(는) 현재 주문할 수 없는 간식입니다.`);
      }

      if (quantity <= 0) {
        throw new Error('수량이 올바르지 않습니다.');
      }

      if (stock < quantity) {
        throw new Error(`${snackName} 재고가 부족합니다. 현재 재고: ${stock}개`);
      }

      const itemTotal = point * quantity;
      totalPoint += itemTotal;

      orderItems.push({
        snackRowIndex,
        snackId,
        snackName,
        quantity,
        point,
        totalPoint: itemTotal,
        beforeStock: stock,
        afterStock: stock - quantity,
      });
    });

    const deliveryType = String(data.deliveryType || 'pickup');
    const deliveryFee = isGuest && deliveryType === 'delivery' ? guestFee : Number(data.deliveryFee || 0);
    const totalCredit = totalPoint + deliveryFee;
    const deliveryPlace = isGuest && deliveryType === 'delivery' ? String(data.deliveryPlace || '').trim() : '';

    if (currentCredit < totalCredit) {
      return {
        success: false,
        message: '크레딧이 부족합니다.',
        currentCredit,
        totalPoint: totalCredit,
      };
    }

    const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd');
    const todayOrders = orderSheet.getDataRange().getValues().slice(1).filter(row => {
      if (!row[0]) return false;
      try {
        const orderDate = Utilities.formatDate(new Date(row[0]), Session.getScriptTimeZone(), 'yyMMdd');
        return orderDate === todayStr;
      } catch (e) {
        return false;
      }
    });
    const uniqueOrderNos = Array.from(new Set(todayOrders.map(row => String(row[1] || ''))));
    const seq = uniqueOrderNos.length + 1;
    const orderNo = 'ORD-' + todayStr + '-' + String(seq).padStart(3, '0');
    const now = new Date();

    let orderToken = '';
    if (isGuest) {
      const randVal = Math.floor(1000 + Math.random() * 9000);
      orderToken = 'G-' + orderNo + '-' + randVal;
    }

    orderItems.forEach(item => {
      // 주문내역 마지막 열에 제공 여부 기본값 'N' 명시적 입력
      const newRow = [
        now, // A: 주문시간
        orderNo, // B: 주문번호
        userId, // C: 이용자ID
        nickname, // D: 별명
        item.snackId, // E: 간식ID
        item.snackName, // F: 간식명
        item.quantity, // G: 수량
        item.totalPoint, // H: 차감포인트
        'N', // I: 제공여부
        '', // J: cancelTimestamp
        orderToken, // K: orderToken
        deliveryType, // L: deliveryType
        deliveryFee, // M: deliveryFee
        totalCredit, // N: totalCredit
        false, // O: reviewed
        deliveryPlace, // P: deliveryAddress
        '', // Q: cancelReason
        '' // R: cancelReasonDetail
      ];
      
      while (newRow.length <= deviceIdIdx) {
        newRow.push('');
      }
      if (deviceIdIdx !== -1) {
        newRow[deviceIdIdx] = data.guestDeviceId || '';
      }
      
      orderSheet.appendRow(newRow);

      // 간식 재고 차감 반영
      snackSheet
        .getRange(item.snackRowIndex + 1, 6)
        .setValue(item.afterStock);
    });

    // 유저 크레딧 차감 반영
    let newCredit = currentCredit - totalCredit;
    if (!isGuest) {
      userSheet.getRange(userRowIndex + 1, 3).setValue(newCredit);
    }

    return {
      success: true,
      message: '주문이 완료되었습니다.',
      orderNo,
      orderToken,
      nickname,
      totalPoint: totalCredit,
      beforeCredit: currentCredit,
      afterCredit: newCredit,
      items: orderItems,
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 8. 오늘 접수된 주문 내역 조회
 */
function getOrdersToday() {
  ensureOrderHeaders();
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET.ORDERS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const rows = values.slice(1);
  
  const reviewedIdx = headers.indexOf('reviewed');
  const rIdx = reviewedIdx !== -1 ? reviewedIdx : 14;

  const today = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );

  const orders = rows
    .filter(row => {
      const orderDate = Utilities.formatDate(
        new Date(row[0]),
        Session.getScriptTimeZone(),
        'yyyy-MM-dd'
      );
      return orderDate === today;
    })
    .map(row => ({
      timestamp: row[0],
      orderNo: row[1],
      userId: row[2],
      nickname: row[3],
      snackId: row[4],
      snackName: row[5],
      quantity: Number(row[6]),
      point: Number(row[7]),
      servedYn: row[8] || 'N',
      cancelTimestamp: row[9] || '',
      orderToken: row[10] || '',
      deliveryType: row[11] || 'pickup',
      deliveryFee: Number(row[12] || 0),
      totalCredit: Number(row[13] || 0),
      reviewed: row[14] === true || String(row[14]).toUpperCase() === 'TRUE' || String(row[14]).toUpperCase() === 'Y',
      deliveryPlace: row[15] || '',
      cancelReason: row[16] || '',
      cancelReasonDetail: row[17] || ''
    }));

  return {
    success: true,
    orders,
  };
}

/**
 * 8.5. 특정 주문의 진행 상태 단일 조회 API
 */
function getOrderStatus(id) {
  ensureOrderHeaders();
  if (!id) {
    return {
      success: false,
      message: '주문 식별자(orderNo 또는 orderToken)가 누락되었습니다.'
    };
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET.ORDERS);
  if (!sheet) {
    return {
      success: false,
      message: '주문내역 시트를 찾을 수 없습니다.'
    };
  }

  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const rows = values.slice(1);
  
  const reviewedIdx = headers.indexOf('reviewed');
  // orderNo(index 1) 또는 orderToken(index 10) 필터링
  const matchedRows = rows.filter(row => {
    return String(row[1]) === String(id) || (row[10] && String(row[10]) === String(id));
  });

  if (matchedRows.length === 0) {
    return {
      success: false,
      message: '해당 주문을 찾을 수 없습니다.'
    };
  }

  // 첫 번째 항목의 정보 및 상태 반환
  const firstRow = matchedRows[0];
  const servedYn = firstRow[8] || 'N';
  const cancelTimestamp = firstRow[9] || '';
  
  const reviewedValue = firstRow[14];
  const isReviewed = reviewedValue === true || String(reviewedValue).toUpperCase() === 'TRUE' || String(reviewedValue).toUpperCase() === 'Y';

  return {
    success: true,
    orderNo: firstRow[1],
    orderToken: firstRow[10] || '',
    servedYn: servedYn,
    cancelTimestamp: cancelTimestamp,
    deliveryType: firstRow[11] || 'pickup',
    deliveryFee: Number(firstRow[12] || 0),
    totalCredit: Number(firstRow[13] || 0),
    reviewed: isReviewed,
    deliveryPlace: firstRow[15] || '',
    cancelReason: firstRow[16] || '',
    cancelReasonDetail: firstRow[17] || ''
  };
}

/**
 * 8.6. 게스트 본인의 오늘 주문 목록만 조회 API (보안을 위해 전체가 아닌 검색어 매칭만 반환)
 */
function getGuestOrdersToday(guestName) {
  ensureOrderHeaders();
  if (!guestName) {
    return {
      success: false,
      message: '이름(guestName)이 누락되었습니다.'
    };
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET.ORDERS);
  if (!sheet) {
    return {
      success: false,
      message: '주문내역 시트를 찾을 수 없습니다.'
    };
  }

  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const rows = values.slice(1);
  
  const reviewedIdx = headers.indexOf('reviewed');
  const rIdx = reviewedIdx !== -1 ? reviewedIdx : 14;

  const today = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );

  const searchName = String(guestName).trim();

  // 오늘이면서 userId가 'guest'이고, 닉네임에 검색어가 포함된 주문 필터링
  const orders = rows
    .filter(row => {
      const orderDate = Utilities.formatDate(
        new Date(row[0]),
        Session.getScriptTimeZone(),
        'yyyy-MM-dd'
      );
      if (orderDate !== today) return false;

      const userId = String(row[2]);
      if (userId !== 'guest') return false;

      const nickname = String(row[3]);
      // nickname은 "이름 (비회원)" 형식임
      return nickname.indexOf(searchName) !== -1;
    })
    .map(row => ({
      timestamp: row[0],
      orderNo: row[1],
      userId: row[2],
      nickname: row[3],
      snackId: row[4],
      snackName: row[5],
      quantity: Number(row[6]),
      point: Number(row[7]),
      servedYn: row[8] || 'N',
      cancelTimestamp: row[9] || '',
      orderToken: row[10] || '',
      deliveryType: row[11] || 'pickup',
      deliveryFee: Number(row[12] || 0),
      totalCredit: Number(row[13] || 0),
      reviewed: row[14] === true || String(row[14]).toUpperCase() === 'TRUE' || String(row[14]).toUpperCase() === 'Y',
      deliveryPlace: row[15] || '',
      cancelReason: row[16] || '',
      cancelReasonDetail: row[17] || ''
    }));

  return {
    success: true,
    orders,
  };
}

/**
 * 9. 제공 상태 (servedYn) 변경 API (대기목록 <-> 완료목록 토글)
 */
function updateOrderServed(data) {
  const orderId = data.orderId;
  const servedYn = data.servedYn || 'Y';

  if (!orderId) {
    return {
      success: false,
      message: '주문번호(orderId)가 누락되었습니다.'
    };
  }

  const ss = SpreadsheetApp.getActive();
  const orderSheet = ss.getSheetByName(SHEET.ORDERS);

  if (!orderSheet) {
    return {
      success: false,
      message: '주문내역 시트를 찾을 수 없습니다.'
    };
  }

  const range = orderSheet.getDataRange();
  const values = range.getValues();
  let updatedCount = 0;

  for (let i = 1; i < values.length; i++) {
    const rowOrderId = String(values[i][1]);
    if (rowOrderId === String(orderId)) {
      const beforeServedYn = values[i][8] || 'N';
      orderSheet.getRange(i + 1, 9).setValue(servedYn); // I열 (9번째) 제공여부 수정
      updatedCount++;
      if (updatedCount === 1) {
        appendAdminLog('updateOrderServed', 'order', orderId, values[i][3], beforeServedYn, servedYn, data.adminMemo);
      }
    }
  }

  if (updatedCount > 0) {
    return {
      success: true,
      message: `주문번호 ${orderId}의 제공 상태를 '${servedYn}'으로 업데이트했습니다. (총 ${updatedCount}건)`
    };
  } else {
    return {
      success: false,
      message: `주문번호 ${orderId}에 해당하는 기록을 찾을 수 없습니다.`
    };
  }
}

/**
 * 9.5. 주문 취소 및 환불/재고 복구 API
 */
function cancelOrder(data) {
  ensureOrderHeaders();
  const orderId = data.orderId;

  if (!orderId) {
    return {
      success: false,
      message: '주문번호(orderId)가 누락되었습니다.'
    };
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return {
      success: false,
      message: '다른 작업을 처리 중입니다. 잠시 후 다시 시도해 주세요.',
    };
  }

  try {
    const ss = SpreadsheetApp.getActive();
    const orderSheet = ss.getSheetByName(SHEET.ORDERS);
    const userSheet = ss.getSheetByName(SHEET.USERS);
    const snackSheet = ss.getSheetByName(SHEET.SNACKS);

    if (!orderSheet || !userSheet || !snackSheet) {
      return {
        success: false,
        message: '필요한 시트(주문/이용자/간식)를 찾을 수 없습니다.'
      };
    }

    const orderRange = orderSheet.getDataRange();
    const orderValues = orderRange.getValues();
    const userValues = userSheet.getDataRange().getValues();
    const snackValues = snackSheet.getDataRange().getValues();
    const headers = orderValues[0] || [];

    // 시트의 최대 열 수가 부족할 경우 18개(A~R)로 보장
    if (orderSheet.getMaxColumns() < 18) {
      orderSheet.insertColumnsAfter(orderSheet.getMaxColumns(), 18 - orderSheet.getMaxColumns());
    }

    let updatedCount = 0;
    let refundLogs = [];

    // 1. 주문번호에 해당하는 모든 행을 찾아서 환불 및 재고 복구 진행
    for (let i = 1; i < orderValues.length; i++) {
      const rowOrderId = String(orderValues[i][1]);
      const servedYn = orderValues[i][8] || 'N';

      if (rowOrderId === String(orderId) && servedYn !== 'C') {
        const userId = String(orderValues[i][2]);
        const nickname = orderValues[i][3];
        const snackId = String(orderValues[i][4]);
        const snackName = orderValues[i][5];
        const quantity = Number(orderValues[i][6] || 0);
        const point = Number(orderValues[i][7] || 0);

        // 1-1. 유저 크레딧 환불
        const userRowIndex = userValues.findIndex((row, idx) => idx > 0 && String(row[0]) === userId);
        if (userRowIndex !== -1) {
          const currentCredit = Number(userValues[userRowIndex][2] || 0);
          const newCredit = currentCredit + point;
          userSheet.getRange(userRowIndex + 1, 3).setValue(newCredit);
          userValues[userRowIndex][2] = newCredit; // 누적 환불 처리를 위해 로컬 배열 값 갱신
        }

        // 1-2. 간식 재고 복구
        const snackRowIndex = snackValues.findIndex((row, idx) => idx > 0 && String(row[0]) === snackId);
        if (snackRowIndex !== -1) {
          const currentStock = Number(snackValues[snackRowIndex][5] || 0);
          const newStock = currentStock + quantity;
          snackSheet.getRange(snackRowIndex + 1, 6).setValue(newStock);
          snackValues[snackRowIndex][5] = newStock; // 로컬 배열 값 갱신
        }

        // 1-3. 주문 제공상태를 'C'로 변경, 10번째 열(Column J)에 취소 시간 기록, 동적 컬럼에 취소 사유 기록
        orderSheet.getRange(i + 1, 9).setValue('C');
        orderSheet.getRange(i + 1, 10).setValue(new Date());

        if (data.cancelReason) {
          orderSheet.getRange(i + 1, 17).setValue(data.cancelReason); // Q열 (17)
        }
        if (data.cancelReasonDetail) {
          orderSheet.getRange(i + 1, 18).setValue(data.cancelReasonDetail); // R열 (18)
        }

        updatedCount++;
        refundLogs.push(`${snackName} ${quantity}개 (${point} 크레딧)`);
        
        if (updatedCount === 1) {
          appendAdminLog('cancelOrder', 'order', orderId, nickname, servedYn, 'C', data.adminMemo || '주문 취소 및 환불');
        }
      }
    }

    if (updatedCount > 0) {
      return {
        success: true,
        message: `주문번호 ${orderId}의 주문이 취소되었습니다. 환불 내역: ${refundLogs.join(', ')} (총 ${updatedCount}건)`
      };
    } else {
      return {
        success: false,
        message: `주문번호 ${orderId}에 해당하는 대기 중이거나 완료된 주문 기록을 찾을 수 없습니다.`
      };
    }
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 9.6. 이용자 직접 주문 취소 API
 */
function userCancelOrder(data) {
  ensureOrderHeaders();
  const orderId = data.orderId;

  if (!orderId) {
    return { success: false, message: '주문 식별자가 누락되었습니다.' };
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, message: '다른 작업을 처리 중입니다. 잠시 후 다시 시도해 주세요.' };
  }

  try {
    const ss = SpreadsheetApp.getActive();
    const orderSheet = ss.getSheetByName(SHEET.ORDERS);
    const userSheet = ss.getSheetByName(SHEET.USERS);
    const snackSheet = ss.getSheetByName(SHEET.SNACKS);

    if (!orderSheet || !userSheet || !snackSheet) {
      return { success: false, message: '필요한 시트를 찾을 수 없습니다.' };
    }

    const orderRange = orderSheet.getDataRange();
    const orderValues = orderRange.getValues();
    const userValues = userSheet.getDataRange().getValues();
    const snackValues = snackSheet.getDataRange().getValues();

    if (orderSheet.getMaxColumns() < 18) {
      orderSheet.insertColumnsAfter(orderSheet.getMaxColumns(), 18 - orderSheet.getMaxColumns());
    }

    let updatedCount = 0;
    let refundLogs = [];
    let isAlreadyStarted = false;

    for (let i = 1; i < orderValues.length; i++) {
      const rowOrderId = String(orderValues[i][1]); // B열: orderNo
      const rowOrderToken = String(orderValues[i][10]); // K열: orderToken
      const servedYn = orderValues[i][8] || 'N';

      // orderId가 orderNo(회원) 또는 orderToken(게스트)와 일치하는 경우
      if (rowOrderId === String(orderId) || rowOrderToken === String(orderId)) {
        if (servedYn === 'C') continue; // 이미 취소된 항목 무시
        
        if (servedYn !== 'N') {
          isAlreadyStarted = true;
          continue;
        }

        const userId = String(orderValues[i][2]);
        const snackId = String(orderValues[i][4]);
        const snackName = orderValues[i][5];
        const quantity = Number(orderValues[i][6] || 0);
        const point = Number(orderValues[i][7] || 0);

        // 유저 크레딧 환불
        const userRowIndex = userValues.findIndex((row, idx) => idx > 0 && String(row[0]) === userId);
        if (userRowIndex !== -1) {
          const currentCredit = Number(userValues[userRowIndex][2] || 0);
          const newCredit = currentCredit + point;
          userSheet.getRange(userRowIndex + 1, 3).setValue(newCredit);
          userValues[userRowIndex][2] = newCredit;
        }

        // 간식 재고 복구
        const snackRowIndex = snackValues.findIndex((row, idx) => idx > 0 && String(row[0]) === snackId);
        if (snackRowIndex !== -1) {
          const currentStock = Number(snackValues[snackRowIndex][5] || 0);
          const newStock = currentStock + quantity;
          snackSheet.getRange(snackRowIndex + 1, 6).setValue(newStock);
          snackValues[snackRowIndex][5] = newStock;
        }

        // 주문 상태 'C' 및 취소 사유 기록
        orderSheet.getRange(i + 1, 9).setValue('C');
        orderSheet.getRange(i + 1, 10).setValue(new Date());
        orderSheet.getRange(i + 1, 17).setValue('이용자 직접 취소');
        orderSheet.getRange(i + 1, 18).setValue(''); // Detail은 빈 값

        updatedCount++;
        refundLogs.push(`${snackName} ${quantity}개 (${point} 크레딧)`);
      }
    }

    if (isAlreadyStarted && updatedCount === 0) {
      return {
        success: false,
        message: '이미 준비가 시작되어 취소할 수 없습니다. 관리자에게 문의해주세요.'
      };
    }

    if (updatedCount > 0) {
      return {
        success: true,
        message: `주문이 취소되었습니다. 환불 내역: ${refundLogs.join(', ')} (총 ${updatedCount}건)`
      };
    } else {
      return {
        success: false,
        message: '해당 주문 기록을 찾을 수 없습니다.'
      };
    }
  } catch (error) {
    return { success: false, message: error.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 10. 이용자 크레딧 조정 API
 */
function updateUserCredit(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.USERS);
  var rows = sheet.getDataRange().getValues();
  var userId = data.userId;
  var newCredit = Number(data.credit);
  
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(userId)) {
      var beforeCredit = Number(rows[i][2] || 0);
      sheet.getRange(i + 1, 3).setValue(newCredit);
      appendAdminLog('updateUserCredit', 'user', userId, rows[i][1], beforeCredit, newCredit, data.adminMemo);
      return { success: true, message: '크레딧을 업데이트했습니다.' };
    }
  }
  return { success: false, message: '이용자를 찾을 수 없습니다.' };
}

/**
 * 11. 신규 이용자 등록 API
 */
function addUser(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.USERS);
  var rows = sheet.getDataRange().getValues();
  var nickname = String(data.nickname || '').trim();

  if (!nickname) {
    return { success: false, message: '이용자 별명이 필요합니다.' };
  }

  var maxNumber = 0;
  for (var i = 1; i < rows.length; i++) {
    var rawId = String(rows[i][0] || '');
    var match = rawId.match(/(\d+)$/);
    if (match) {
      var idNumber = Number(match[1]);
      if (idNumber > maxNumber) maxNumber = idNumber;
    }
  }

  var newUserId = 'user' + String(maxNumber + 1).padStart(3, '0');
  sheet.appendRow([
    newUserId,
    nickname,
    Number(data.credit || 0),
    data.useYn || 'Y',
    data.imageUrl || ''
  ]);
  appendAdminLog('addUser', 'user', newUserId, nickname, '', JSON.stringify({ credit: Number(data.credit || 0), useYn: data.useYn || 'Y' }), data.adminMemo);

  return {
    success: true,
    message: '신규 이용자를 등록했습니다.',
    userId: newUserId
  };
}

/**
 * 12. 이용자 활성/비활성 API
 * 주문 기록 보존을 위해 행 삭제 대신 사용여부를 Y/N으로 변경합니다.
 */
function updateUserActive(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.USERS);
  var rows = sheet.getDataRange().getValues();
  var userId = data.userId;
  var useYn = String(data.useYn || 'N').toUpperCase() === 'Y' ? 'Y' : 'N';

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(userId)) {
      var beforeUseYn = rows[i][3] || '';
      sheet.getRange(i + 1, 4).setValue(useYn);
      appendAdminLog('updateUserActive', 'user', userId, rows[i][1], beforeUseYn, useYn, data.adminMemo);
      return { success: true, message: '이용자 상태를 업데이트했습니다.', useYn: useYn };
    }
  }

  return { success: false, message: '이용자를 찾을 수 없습니다.' };
}

/**
 * 13. 간식 재고 수량 조정 API
 */
function updateSnackStock(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.SNACKS);
  var rows = sheet.getDataRange().getValues();
  var snackId = Number(data.snackId);
  var newStock = Number(data.stock);
  
  for (var i = 1; i < rows.length; i++) {
    if (Number(rows[i][0]) === snackId) {
      var beforeStock = Number(rows[i][5] || 0);
      sheet.getRange(i + 1, 6).setValue(newStock);
      appendAdminLog('updateSnackStock', 'snack', snackId, rows[i][1], beforeStock, newStock, data.adminMemo);
      return { success: true, message: '재고를 업데이트했습니다.' };
    }
  }
  return { success: false, message: '간식을 찾을 수 없습니다.' };
}

/**
 * 14. 간식 판매/숨김 상태 변경 API
 */
function updateSnackSale(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.SNACKS);
  var rows = sheet.getDataRange().getValues();
  var snackId = Number(data.snackId);
  var saleYn = String(data.saleYn || 'N').toUpperCase() === 'Y' ? 'Y' : 'N';

  for (var i = 1; i < rows.length; i++) {
    if (Number(rows[i][0]) === snackId) {
      var beforeSaleYn = rows[i][4] || '';
      sheet.getRange(i + 1, 5).setValue(saleYn);
      appendAdminLog('updateSnackSale', 'snack', snackId, rows[i][1], beforeSaleYn, saleYn, data.adminMemo);
      return { success: true, message: '간식 판매 상태를 업데이트했습니다.', saleYn: saleYn };
    }
  }

  return { success: false, message: '간식을 찾을 수 없습니다.' };
}

/**
 * 15. 신규 간식 품목 등록 API
 */
function addSnack(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.SNACKS);
  var rows = sheet.getDataRange().getValues();

  var maxId = 0;
  for (var i = 1; i < rows.length; i++) {
    var id = Number(rows[i][0]);
    if (id > maxId) maxId = id;
  }
  var newSnackId = maxId + 1;
  var target = String(data.target || 'user').trim().toLowerCase();
  
  var newRow = [
    newSnackId,
    data.name,
    Number(data.point || 1),
    data.imageUrl || "",
    data.saleYn || "Y",
    Number(data.stock || 0),
    0, // displayOrder
    target
  ];
  
  sheet.appendRow(newRow);
  appendAdminLog('addSnack', 'snack', newSnackId, data.name, '', JSON.stringify({ point: Number(data.point || 1), saleYn: data.saleYn || 'Y', stock: Number(data.stock || 0), target: target }), data.adminMemo);
  return { success: true, message: '신규 간식을 등록했습니다.', snackId: newSnackId };
}

/**
 * 16. 이용자 정보 전체 수정 API
 */
function updateUser(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.USERS);
  var rows = sheet.getDataRange().getValues();
  var userId = data.userId;
  var nickname = String(data.nickname || '').trim();
  var credit = Number(data.credit);
  var imageUrl = String(data.imageUrl || '').trim();
  var useYn = String(data.useYn || 'Y').toUpperCase() === 'Y' ? 'Y' : 'N';

  if (!userId) {
    return { success: false, message: '이용자 ID가 필요합니다.' };
  }
  if (!nickname) {
    return { success: false, message: '이용자 별명이 필요합니다.' };
  }

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(userId)) {
      var beforeNickname = rows[i][1];
      var beforeCredit = rows[i][2];
      var beforeUseYn = rows[i][3];
      var beforeImageUrl = rows[i][4];

      sheet.getRange(i + 1, 2).setValue(nickname);
      sheet.getRange(i + 1, 3).setValue(credit);
      sheet.getRange(i + 1, 4).setValue(useYn);
      sheet.getRange(i + 1, 5).setValue(imageUrl);

      appendAdminLog('updateUser', 'user', userId, nickname, 
        JSON.stringify({ nickname: beforeNickname, credit: beforeCredit, useYn: beforeUseYn, imageUrl: beforeImageUrl }), 
        JSON.stringify({ nickname: nickname, credit: credit, useYn: useYn, imageUrl: imageUrl }), 
        data.adminMemo
      );
      return { success: true, message: '이용자 정보를 수정했습니다.' };
    }
  }
  return { success: false, message: '이용자를 찾을 수 없습니다.' };
}

/**
 * 17. 간식 정보 전체 수정 API
 */
function updateSnack(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.SNACKS);
  var rows = sheet.getDataRange().getValues();
  var snackId = Number(data.snackId);
  var name = String(data.name || '').trim();
  var point = Number(data.point);
  var imageUrl = String(data.imageUrl || '').trim();
  var stock = Number(data.stock);
  var saleYn = String(data.saleYn || 'Y').toUpperCase() === 'Y' ? 'Y' : 'N';
  var target = String(data.target || 'user').trim().toLowerCase();

  if (!snackId) {
    return { success: false, message: '간식 ID가 필요합니다.' };
  }
  if (!name) {
    return { success: false, message: '간식 이름이 필요합니다.' };
  }

  for (var i = 1; i < rows.length; i++) {
    if (Number(rows[i][0]) === snackId) {
      var beforeName = rows[i][1];
      var beforePoint = rows[i][2];
      var beforeImageUrl = rows[i][3];
      var beforeSaleYn = rows[i][4];
      var beforeStock = rows[i][5];
      var beforeTarget = rows[i][7] ? String(rows[i][7]).trim().toLowerCase() : 'user';

      sheet.getRange(i + 1, 2).setValue(name);
      sheet.getRange(i + 1, 3).setValue(point);
      sheet.getRange(i + 1, 4).setValue(imageUrl);
      sheet.getRange(i + 1, 5).setValue(saleYn);
      sheet.getRange(i + 1, 6).setValue(stock);
      sheet.getRange(i + 1, 8).setValue(target);

      appendAdminLog('updateSnack', 'snack', snackId, name, 
        JSON.stringify({ name: beforeName, point: beforePoint, imageUrl: beforeImageUrl, saleYn: beforeSaleYn, stock: beforeStock, target: beforeTarget }), 
        JSON.stringify({ name: name, point: point, imageUrl: imageUrl, saleYn: saleYn, stock: stock, target: target }), 
        data.adminMemo
      );
      return { success: true, message: '간식 정보를 수정했습니다.' };
    }
  }
  return { success: false, message: '간식을 찾을 수 없습니다.' };
}

/**
 * 18. 간식 표시 순서 일괄 업데이트 API
 * items: [{ snackId, displayOrder }] 배열을 받아 G열을 업데이트합니다.
 */
function updateSnacksOrder(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.SNACKS);
  var rows = sheet.getDataRange().getValues();
  var items = data.items; // [{ snackId, displayOrder }]

  if (!items || !Array.isArray(items) || items.length === 0) {
    return { success: false, message: '순서 데이터가 없습니다.' };
  }

  // snackId → displayOrder 맵 구성
  var orderMap = {};
  items.forEach(function(item) {
    orderMap[String(item.snackId)] = Number(item.displayOrder);
  });

  // 해당 행의 G열(7번째 열)을 업데이트
  for (var i = 1; i < rows.length; i++) {
    var snackId = String(rows[i][0]);
    if (orderMap.hasOwnProperty(snackId)) {
      sheet.getRange(i + 1, 7).setValue(orderMap[snackId]);
    }
  }

  return { success: true, message: '표시 순서를 저장했습니다.' };
}

/**
 * 19. Google Drive 이미지 업로드 API
 */
function uploadImage(data) {
  try {
    const base64Data = data.base64Data; // 'data:image/jpeg;base64,...'
    const fileName = data.fileName;
    const type = data.type; // 'user' 또는 'snack'

    if (!base64Data || !fileName || !type) {
      return {
        success: false,
        message: '필수 매개변수(base64Data, fileName, type)가 누락되었습니다.'
      };
    }

    // base64 헤더 제거 및 바이너리 디코딩
    const base64Parts = base64Data.split(',');
    const rawBase64 = base64Parts.length > 1 ? base64Parts[1] : base64Parts[0];
    const decodedBytes = Utilities.base64Decode(rawBase64);
    
    // 파일 생성용 blob 생성 (MimeType 파싱)
    const mimeMatch = base64Parts[0].match(/data:(.*?);/);
    const contentType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const blob = Utilities.newBlob(decodedBytes, contentType, fileName);

    // 대상 폴더 지정
    let folderId = '';
    if (type === 'user') {
      folderId = USER_IMAGE_FOLDER_ID;
    } else if (type === 'snack') {
      folderId = SNACK_IMAGE_FOLDER_ID;
    } else {
      return { success: false, message: '올바르지 않은 이미지 타입입니다.' };
    }

    const folder = DriveApp.getFolderById(folderId);
    if (!folder) {
      return { success: false, message: '대상 구글 드라이브 폴더를 찾을 수 없습니다.' };
    }

    // 파일 업로드
    const file = folder.createFile(blob);
    
    // 링크가 있는 누구나 볼 수 있도록 공개 보기 권한 설정
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const fileId = file.getId();
    const imageUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;

    return {
      success: true,
      imageUrl: imageUrl
    };
  } catch (error) {
    return {
      success: false,
      message: '이미지 업로드 중 오류 발생: ' + error.toString()
    };
  }
}

/**
 * 20. 게스트 운영 설정 조회
 */
function getGuestSettings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET.SETTINGS);
  
  if (!sheet) {
    sheet = ss.insertSheet(SHEET.SETTINGS);
    sheet.appendRow(['key', 'value']);
  }

  const values = sheet.getDataRange().getValues();
  const settings = {
    guestOpen: 'N',
    guestCloseAt: '',
    guestBaseCredit: 10,
    guestDeliveryFee: 3,
    guestDefaultDeliveryPlace: '사무실 원탁',
    todayDeliveryTeamEnabled: true,
    todayDeliveryTeamTitle: '📦 오늘의 배달팀',
    todayDeliveryTeamMembers: '김○○|배달 담당, 박○○|상품 준비 담당',
    todayDeliveryTeamMessage: '맛있게 준비해서 배달하겠습니다!',
    welcomeTitle: '배달왔삼에 오신 것을 환영합니다 😊',
    welcomeSubtitle: '오늘의 간식을 주문해보세요!',
    guestAllowMultipleOrders: 'FALSE'
  };

  const existingKeys = [];
  values.slice(1).forEach(row => {
    const key = String(row[0]).trim();
    if (key) {
      settings[key] = row[1];
      existingKeys.push(key);
    }
  });

  // 누락된 기본 설정값이 있다면 시트에 자동 추가
  const defaultSettings = {
    guestOpen: 'N',
    guestCloseAt: '',
    guestBaseCredit: 10,
    guestDeliveryFee: 3,
    guestDefaultDeliveryPlace: '사무실 원탁',
    todayDeliveryTeamEnabled: true,
    todayDeliveryTeamTitle: '📦 오늘의 배달팀',
    todayDeliveryTeamMembers: '김○○|배달 담당, 박○○|상품 준비 담당',
    todayDeliveryTeamMessage: '맛있게 준비해서 배달하겠습니다!',
    welcomeTitle: '배달왔삼에 오신 것을 환영합니다 😊',
    welcomeSubtitle: '오늘의 간식을 주문해보세요!',
    guestAllowMultipleOrders: 'FALSE'
  };

  for (const key in defaultSettings) {
    if (existingKeys.indexOf(key) === -1) {
      sheet.appendRow([key, defaultSettings[key]]);
    }
  }

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

  return {
    success: true,
    guestOpen: settings.guestOpen,
    guestCloseAt: settings.guestCloseAt,
    guestBaseCredit: Number(settings.guestBaseCredit || 10),
    guestDeliveryFee: Number(settings.guestDeliveryFee || 3),
    guestDefaultDeliveryPlace: settings.guestDefaultDeliveryPlace || '사무실 원탁',
    todayDeliveryTeamEnabled: settings.todayDeliveryTeamEnabled === true || String(settings.todayDeliveryTeamEnabled).toLowerCase() === 'true',
    todayDeliveryTeamTitle: settings.todayDeliveryTeamTitle || '📦 오늘의 배달팀',
    todayDeliveryTeamMembers: settings.todayDeliveryTeamMembers || '',
    todayDeliveryTeamMessage: settings.todayDeliveryTeamMessage || '',
    guestAllowMultipleOrders: String(settings.guestAllowMultipleOrders || 'FALSE').toUpperCase() === 'TRUE',
    isGuestOpenNow,
    remainingSeconds,
    message
  };
}

/**
 * 21. 게스트 운영 설정 변경
 */
function updateGuestSettings(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET.SETTINGS);
  
  if (!sheet) {
    sheet = ss.insertSheet(SHEET.SETTINGS);
    sheet.appendRow(['key', 'value']);
  }

  const action = data.settingsAction;
  const now = new Date();
  let guestOpen = 'N';
  let guestCloseAt = '';
  let logBefore = 'N';
  let logAfter = 'N';

  if (action === 'open20') {
    guestOpen = 'Y';
    guestCloseAt = new Date(now.getTime() + 20 * 60 * 1000).toISOString();
    logAfter = 'Y (20분)';
  } else if (action === 'open30') {
    guestOpen = 'Y';
    guestCloseAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
    logAfter = 'Y (30분)';
  } else if (action === 'closeNow') {
    guestOpen = 'N';
    logBefore = 'Y';
    logAfter = 'N (즉시 마감)';
  } else if (action === 'updateValues') {
    const guestBaseCredit = data.guestBaseCredit;
    const guestDeliveryFee = data.guestDeliveryFee;
    const guestDefaultDeliveryPlace = data.guestDefaultDeliveryPlace;
    const todayDeliveryTeamEnabled = data.todayDeliveryTeamEnabled !== undefined ? data.todayDeliveryTeamEnabled : true;
    const todayDeliveryTeamTitle = data.todayDeliveryTeamTitle || '📦 오늘의 배달팀';
    const todayDeliveryTeamMembers = data.todayDeliveryTeamMembers || '';
    const todayDeliveryTeamMessage = data.todayDeliveryTeamMessage || '';
    const guestAllowMultipleOrders = data.guestAllowMultipleOrders !== undefined ? (data.guestAllowMultipleOrders ? 'TRUE' : 'FALSE') : undefined;
    
    const values = sheet.getDataRange().getValues();
    let rowCredit = -1;
    let rowFee = -1;
    let rowDeliveryPlace = -1;
    let rowTeamEnabled = -1;
    let rowTeamTitle = -1;
    let rowTeamMembers = -1;
    let rowTeamMessage = -1;
    let rowAllowMultiple = -1;
    for (let i = 1; i < values.length; i++) {
      const key = String(values[i][0]).trim();
      if (key === 'guestBaseCredit') rowCredit = i + 1;
      if (key === 'guestDeliveryFee') rowFee = i + 1;
      if (key === 'guestDefaultDeliveryPlace') rowDeliveryPlace = i + 1;
      if (key === 'todayDeliveryTeamEnabled') rowTeamEnabled = i + 1;
      if (key === 'todayDeliveryTeamTitle') rowTeamTitle = i + 1;
      if (key === 'todayDeliveryTeamMembers') rowTeamMembers = i + 1;
      if (key === 'todayDeliveryTeamMessage') rowTeamMessage = i + 1;
      if (key === 'guestAllowMultipleOrders') rowAllowMultiple = i + 1;
    }
    
    if (rowCredit > 0) {
      sheet.getRange(rowCredit, 2).setValue(guestBaseCredit);
    } else {
      sheet.appendRow(['guestBaseCredit', guestBaseCredit]);
    }
    
    if (rowFee > 0) {
      sheet.getRange(rowFee, 2).setValue(guestDeliveryFee);
    } else {
      sheet.appendRow(['guestDeliveryFee', guestDeliveryFee]);
    }
    
    if (rowDeliveryPlace > 0) {
      sheet.getRange(rowDeliveryPlace, 2).setValue(guestDefaultDeliveryPlace);
    } else {
      sheet.appendRow(['guestDefaultDeliveryPlace', guestDefaultDeliveryPlace]);
    }
    
    if (rowTeamEnabled > 0) {
      sheet.getRange(rowTeamEnabled, 2).setValue(todayDeliveryTeamEnabled);
    } else {
      sheet.appendRow(['todayDeliveryTeamEnabled', todayDeliveryTeamEnabled]);
    }
    
    if (rowTeamTitle > 0) {
      sheet.getRange(rowTeamTitle, 2).setValue(todayDeliveryTeamTitle);
    } else {
      sheet.appendRow(['todayDeliveryTeamTitle', todayDeliveryTeamTitle]);
    }
    
    if (rowTeamMembers > 0) {
      sheet.getRange(rowTeamMembers, 2).setValue(todayDeliveryTeamMembers);
    } else {
      sheet.appendRow(['todayDeliveryTeamMembers', todayDeliveryTeamMembers]);
    }
    
    if (rowTeamMessage > 0) {
      sheet.getRange(rowTeamMessage, 2).setValue(todayDeliveryTeamMessage);
    } else {
      sheet.appendRow(['todayDeliveryTeamMessage', todayDeliveryTeamMessage]);
    }
    
    if (guestAllowMultipleOrders !== undefined) {
      if (rowAllowMultiple > 0) {
        sheet.getRange(rowAllowMultiple, 2).setValue(guestAllowMultipleOrders);
      } else {
        sheet.appendRow(['guestAllowMultipleOrders', guestAllowMultipleOrders]);
      }
    }
    
    appendAdminLog('updateGuestSettings', 'settings', 'guestValues', '게스트 설정 변경', '', `크레딧:${guestBaseCredit}, 배달비:${guestDeliveryFee}, 기본배달지:${guestDefaultDeliveryPlace}`, data.adminMemo);
    return { success: true, message: '게스트 설정이 저장되었습니다.' };
  } else {
    return { success: false, message: '알 수 없는 설정 변경 요청입니다.' };
  }

  const values = sheet.getDataRange().getValues();
  let rowOpen = -1;
  let rowCloseAt = -1;

  for (let i = 1; i < values.length; i++) {
    const key = String(values[i][0]).trim();
    if (key === 'guestOpen') rowOpen = i + 1;
    if (key === 'guestCloseAt') rowCloseAt = i + 1;
  }

  if (rowOpen > 0) {
    sheet.getRange(rowOpen, 2).setValue(guestOpen);
  } else {
    sheet.appendRow(['guestOpen', guestOpen]);
  }

  if (rowCloseAt > 0) {
    sheet.getRange(rowCloseAt, 2).setValue(guestCloseAt);
  } else {
    sheet.appendRow(['guestCloseAt', guestCloseAt]);
  }

  appendAdminLog('updateGuestSettings', 'settings', 'guestOpen', '게스트 운영', logBefore, logAfter, data.adminMemo);

  return { success: true, message: '게스트 운영 상태가 변경되었습니다.' };
}

/**
 * 22. 후기 등록 API
 */
function submitReview(data) {
  ensureOrderHeaders();
  const orderId = data.orderId;
  const guestName = data.guestName;
  const stamp = data.stamp || '';
  const tags = data.tags || '';
  let comment = data.comment || '';
  const isPublic = data.isPublic !== false && data.isPublic !== 'false';

  if (!orderId || !guestName) {
    return {
      success: false,
      message: '필수 매개변수(orderId, guestName)가 누락되었습니다.'
    };
  }

  comment = String(comment).trim();
  if (comment.length > 100) {
    return {
      success: false,
      message: '응원 메시지는 100자 이내로 입력해주세요.'
    };
  }

  if (!stamp && !tags) {
    return {
      success: false,
      message: '칭찬 스탬프나 태그를 1개 이상 선택해주세요.'
    };
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return {
      success: false,
      message: '다른 작업을 처리 중입니다. 잠시 후 다시 시도해 주세요.'
    };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. 주문내역 시트 확인 및 reviewed 컬럼 체크
    const orderSheet = ss.getSheetByName(SHEET.ORDERS);
    if (!orderSheet) {
      return { success: false, message: '주문내역 시트를 찾을 수 없습니다.' };
    }
    const orderValues = orderSheet.getDataRange().getValues();
    const headers = orderValues[0] || [];
    
    let reviewedIdx = headers.indexOf('reviewed');
    if (reviewedIdx === -1) {
      reviewedIdx = headers.length;
      orderSheet.getRange(1, reviewedIdx + 1).setValue('reviewed');
      headers.push('reviewed');
    }

    const orderNoIdx = headers.indexOf('주문번호');
    const servedYnIdx = headers.indexOf('제공여부');
    const statusIdx = headers.indexOf('상태');
    
    let targetIndices = [];
    
    for (let i = 1; i < orderValues.length; i++) {
      if (String(orderValues[i][orderNoIdx !== -1 ? orderNoIdx : 1]) === String(orderId)) {
        targetIndices.push(i);
      }
    }
    
    if (targetIndices.length === 0) {
      return { success: false, message: '주문 내역을 찾을 수 없습니다.' };
    }

    // 수령완료 여부 체크 (첫 번째 매칭된 행 기준)
    const targetRow = orderValues[targetIndices[0]];
    const servedYnValue = targetRow[servedYnIdx !== -1 ? servedYnIdx : 8];
    const statusValue = statusIdx !== -1 ? targetRow[statusIdx] : null;
    
    if (servedYnValue !== 'Y' && servedYnValue !== '수령완료' && statusValue !== '수령완료') {
      return { success: false, message: '수령완료된 주문만 응원 메시지를 남길 수 있습니다.' };
    }

    // 모든 행에 대해 체크
    let isAlreadyReviewed = false;
    for (const idx of targetIndices) {
      const row = orderValues[idx];
      const reviewedValue = row[reviewedIdx];
      if (reviewedValue === true || String(reviewedValue).toUpperCase() === 'TRUE' || String(reviewedValue).toUpperCase() === 'Y') {
        isAlreadyReviewed = true;
        break;
      }
    }

    if (isAlreadyReviewed) {
      return { success: false, message: '이미 응원 메시지를 남긴 주문입니다.' };
    }

    // 2. 후기내역 시트 가져오기/생성
    let reviewSheet = ss.getSheetByName(SHEET.REVIEWS);
    if (!reviewSheet) {
      reviewSheet = ss.insertSheet(SHEET.REVIEWS);
      reviewSheet.appendRow(['createdAt', 'orderId', 'guestName', 'stamp', 'tags', 'comment', 'isPublic']);
    } else {
      const reviewHeaders = reviewSheet.getDataRange().getValues()[0] || [];
      if (reviewHeaders.length === 0) {
        reviewSheet.appendRow(['createdAt', 'orderId', 'guestName', 'stamp', 'tags', 'comment', 'isPublic']);
      }
    }

    // 3. 후기 기록 추가
    reviewSheet.appendRow([
      new Date(),
      orderId,
      guestName,
      stamp,
      tags,
      comment,
      isPublic
    ]);

    // 4. 주문내역 시트에서 reviewed 상태 업데이트
    targetIndices.forEach(idx => {
      orderSheet.getRange(idx + 1, reviewedIdx + 1).setValue(true);
    });

    return {
      success: true,
      message: '리뷰가 성공적으로 등록되었습니다.'
    };
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 23. 최근 공개 후기 조회 API (칭찬 보드용)
 */
function getRecentReviews() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reviewSheet = ss.getSheetByName(SHEET.REVIEWS);
  if (!reviewSheet) {
    return { success: true, reviews: [] };
  }

  const values = reviewSheet.getDataRange().getValues();
  const rows = values.slice(1);

  // isPublic이 참인 것만 필터링하여 최신순으로 정렬
  const reviews = rows
    .filter(row => {
      const isPub = String(row[6]).trim().toUpperCase();
      return isPub === 'TRUE' || isPub === 'Y' || isPub === 'O' || isPub === '예' || row[6] === true;
    })
    .map(row => ({
      createdAt: row[0],
      orderId: row[1],
      guestName: row[2],
      stamp: row[3],
      tags: row[4],
      comment: row[5]
    }))
    .reverse() // 최신 작성순
    .slice(0, 10); // 최대 10개만 반환

  return {
    success: true,
    reviews
  };
}

/**
 * 24. 관리자용 전체 후기 조회 API
 */
function getReviewsForAdmin() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reviewSheet = ss.getSheetByName(SHEET.REVIEWS);
  if (!reviewSheet) {
    return { success: true, reviews: [] };
  }

  const values = reviewSheet.getDataRange().getValues();
  const rows = values.slice(1);

  const reviews = rows
    .map(row => ({
      createdAt: row[0],
      orderId: row[1],
      guestName: row[2],
      stamp: row[3],
      tags: row[4],
      comment: row[5],
      isPublic: row[6]
    }))
    .reverse(); // 최신순

  return {
    success: true,
    reviews
  };
}

/**
 * 25. 지난 주문 보관 (아카이빙) API
 */
function archiveOldOrders(data) {
  ensureOrderHeaders();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return {
      success: false,
      message: '다른 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.'
    };
  }

  try {
    const memo = data && data.adminMemo ? data.adminMemo : '';
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const orderSheet = ss.getSheetByName(SHEET.ORDERS);
    if (!orderSheet) {
      return { success: false, message: '주문내역 시트를 찾을 수 없습니다.' };
    }

    let archiveSheet = ss.getSheetByName(SHEET.ARCHIVE);
    if (!archiveSheet) {
      archiveSheet = ss.insertSheet(SHEET.ARCHIVE);
      archiveSheet.appendRow([
        '주문시간', '주문번호', '이용자ID', '별명', '간식ID', '간식명', '수량',
        '차감포인트', '제공여부', 'cancelTimestamp', 'orderToken', 'deliveryType', 'deliveryFee', 'totalCredit', 'reviewed', 'deliveryAddress', 'cancelReason', 'cancelReasonDetail'
      ]);
    }

    const orderValues = orderSheet.getDataRange().getValues();
    if (orderValues.length <= 1) {
      return {
        success: true,
        message: '보관할 지난 주문이 없습니다.'
      };
    }

    const header = orderValues[0];
    const rows = orderValues.slice(1);

    // 오늘 날짜의 자정 기준 시각 구하기
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rowsToArchive = [];
    const rowsToKeep = [header];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const timestamp = new Date(row[0]);
      if (!isNaN(timestamp.getTime()) && timestamp < today) {
        // 행의 열 개수를 18개로 맞춰 안전하게 아카이빙
        const safeRow = [...row];
        while (safeRow.length < 18) {
          safeRow.push('');
        }
        rowsToArchive.push(safeRow.slice(0, 18));
      } else {
        rowsToKeep.push(row);
      }
    }

    if (rowsToArchive.length === 0) {
      return {
        success: true,
        message: '보관할 지난 주문이 없습니다.'
      };
    }

    // 아카이브 시트에 일괄 추가 (setValues)
    const lastRow = archiveSheet.getLastRow();
    const colCount = 18; // 아카이브 시트의 컬럼 수
    archiveSheet.getRange(lastRow + 1, 1, rowsToArchive.length, colCount).setValues(rowsToArchive);

    // 주문내역 시트 일괄 덮어쓰기 (clearContent 후 setValues)
    orderSheet.clearContent();
    
    // rowsToKeep의 각 행 길이를 헤더 길이에 맞추어 안전한 setValues 실행
    const maxCols = header.length;
    const safeRowsToKeep = rowsToKeep.map(row => {
      const safeRow = [...row];
      while (safeRow.length < maxCols) {
        safeRow.push('');
      }
      return safeRow.slice(0, maxCols);
    });

    orderSheet.getRange(1, 1, safeRowsToKeep.length, maxCols).setValues(safeRowsToKeep);

    appendAdminLog('archiveOldOrders', 'orders', 'archive', '지난 주문 보관', '', `${rowsToArchive.length}건 보관 완료`, memo);

    return {
      success: true,
      message: `${rowsToArchive.length}건의 지난 주문을 성공적으로 보관 처리했습니다.`
    };
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 26. 헤더 및 데이터 보정/마이그레이션 도구
 * 기존 꼬여있는 컬럼과 데이터를 A~R 구조에 맞춰 재배열합니다.
 * A: timestamp
 * B: orderNo
 * C: userId
 * D: nickname
 * E: snackId
 * F: snackName
 * G: quantity
 * H: point
 * I: servedYn
 * J: cancelTimestamp
 * K: orderToken
 * L: deliveryType
 * M: deliveryFee
 * N: totalCredit
 * O: reviewed (TRUE/FALSE)
 * P: deliveryAddress (배송지 정보 등)
 * Q: cancelReason
 * R: cancelReasonDetail
 */
function ensureOrderHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const orderSheet = ss.getSheetByName(SHEET.ORDERS);
  if (!orderSheet) return;

  const REQUIRED_COLS = 18;
  if (orderSheet.getMaxColumns() < REQUIRED_COLS) {
    orderSheet.insertColumnsAfter(orderSheet.getMaxColumns(), REQUIRED_COLS - orderSheet.getMaxColumns());
  }

  const currentHeaders = orderSheet.getDataRange().getValues()[0] || [];
  let headers = currentHeaders.filter(h => h !== '');

  const defaultHeaders = [
    '주문시간', '주문번호', '이용자ID', '별명', '간식ID', '간식명', '수량',
    '차감포인트', '제공여부', 'cancelTimestamp', 'orderToken', 'deliveryType', 
    'deliveryFee', 'totalCredit', 'reviewed', 'deliveryAddress', 'cancelReason', 'cancelReasonDetail'
  ];

  let modified = false;
  defaultHeaders.forEach(dh => {
    if (headers.indexOf(dh) === -1) {
      headers.push(dh);
      modified = true;
    }
  });

  if (headers.indexOf('guestDeviceId') === -1) {
    headers.push('guestDeviceId');
    modified = true;
  }

  if (modified) {
    if (orderSheet.getMaxColumns() < headers.length) {
      orderSheet.insertColumnsAfter(orderSheet.getMaxColumns(), headers.length - orderSheet.getMaxColumns());
    }
    orderSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return '헤더 보정이 완료되었습니다.';
}

/**
 * 27. 빈 간식ID 자동 채우기 기능
 * 비어 있는 간식ID를 기존 가장 높은 숫자 ID부터 순차적으로 채웁니다.
 * 중복되거나 숫자가 아닌 ID가 발견될 경우 경고를 반환합니다.
 */
function autoFillEmptySnackIds() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, message: '다른 작업이 진행 중입니다.', hasError: true };
  }
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET.SNACKS);
    if (!sheet) {
      return { success: false, message: '간식목록 시트를 찾을 수 없습니다.', hasError: true };
    }

    const range = sheet.getDataRange();
    const values = range.getValues();
    if (values.length <= 1) {
      return { success: true, filledCount: 0, message: '간식 데이터가 없습니다.' };
    }

    const rows = values.slice(1);
    const existingIds = [];
    const emptyRowsIndexes = [];
    
    // 1. 유효성 검사 및 데이터 수집
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const snackId = row[0];
      const snackName = row[1];
      
      // 이름도 없고 ID도 없으면 빈 줄로 간주
      if (!snackId && !snackName) continue;
      
      if (!snackId) {
        emptyRowsIndexes.push(i + 1); // 데이터 행 인덱스 (sheet rows is i + 2)
      } else {
        existingIds.push(String(snackId).trim());
      }
    }

    // 빈 ID가 없다면 조기 종료
    if (emptyRowsIndexes.length === 0) {
      return { success: true, filledCount: 0, message: '모든 간식ID가 정상입니다.' };
    }

    // 2. 숫자가 아닌 ID나 중복 ID 검사 (오류 시 자동 수정 중단)
    const idCounts = {};
    let hasInvalid = false;
    let hasDuplicate = false;
    
    existingIds.forEach(id => {
      if (isNaN(Number(id)) || id === '') {
        hasInvalid = true;
      }
      idCounts[id] = (idCounts[id] || 0) + 1;
      if (idCounts[id] > 1) {
        hasDuplicate = true;
      }
    });

    if (hasInvalid || hasDuplicate) {
      return { 
        success: false, 
        message: '경고: 간식 목록에 숫자가 아닌 ID나 중복된 ID가 존재합니다. 시트를 직접 확인해주세요.',
        hasError: true 
      };
    }

    // 3. 가장 큰 ID 찾기 및 빈 ID 채우기
    let maxId = 0;
    existingIds.forEach(id => {
      const num = Number(id);
      if (num > maxId) maxId = num;
    });

    let currentId = maxId;
    let filledCount = 0;

    emptyRowsIndexes.forEach(rowIndex => {
      currentId++;
      // sheet index는 1-based, 헤더 고려하여 +1
      sheet.getRange(rowIndex + 1, 1).setValue(currentId);
      filledCount++;
    });

    return { 
      success: true, 
      filledCount: filledCount, 
      message: `${filledCount}개의 빈 간식ID를 자동으로 채웠습니다.` 
    };
  } finally {
    lock.releaseLock();
  }
}
```
