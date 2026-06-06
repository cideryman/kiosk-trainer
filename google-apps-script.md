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
   - **설명**: `v2 - 크레딧 및 재고 관리 추가` (임의 기입)
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
};

// 관리자 화면에서만 사용하는 변경 API 목록입니다.
const ADMIN_ACTIONS = [
  'updateOrderServed',
  'updateUserCredit',
  'updateSnackStock',
  'addSnack',
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
  const action = e.parameter.action;

  if (action === 'getUsers') {
    return jsonResponse(getUsers());
  }

  if (action === 'getSnacks') {
    return jsonResponse(getSnacks());
  }

  if (action === 'getOrdersToday') {
    return jsonResponse(getOrdersToday());
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
  } else if (action === 'updateSnackStock') {
    return jsonResponse(updateSnackStock(data));
  } else if (action === 'addSnack') {
    return jsonResponse(addSnack(data));
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

/**
 * 5. 이용자 목록 조회
 */
function getUsers() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.USERS);

  if (!sheet) {
    return {
      success: false,
      message: '이용자목록 시트를 찾을 수 없습니다.'
    };
  }

  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1);

  const users = rows
    .filter(row => {
      const active = String(row[3] || '').trim().toUpperCase();
      return active === 'TRUE' || active === '사용' || active === 'Y' || active === 'O' || active === '예';
    })
    .map(row => ({
      userId: row[0],
      nickname: row[1],
      credit: Number(row[2] || 0),
      active: row[3],
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
function getSnacks() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET.SNACKS);
  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1);

  const snacks = rows
    .filter(row => {
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

      return {
        snackId: row[0],
        name: row[1],
        point: Number(row[2]),
        imageUrl: makeImageUrl(row[3]),
        active: row[4],
        stock,
        soldOut: stock <= 0,
      };
    });

  return {
    success: true,
    snacks,
  };
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

    const users = userSheet.getDataRange().getValues();
    const snacks = snackSheet.getDataRange().getValues();

    const userRowIndex = users.findIndex((row, index) => {
      return index > 0 && String(row[0]) === String(userId);
    });

    if (userRowIndex === -1) {
      return {
        success: false,
        message: '이용자를 찾을 수 없습니다.',
      };
    }

    const nickname = users[userRowIndex][1];
    const currentCredit = Number(users[userRowIndex][2]);

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

    if (currentCredit < totalPoint) {
      return {
        success: false,
        message: '크레딧이 부족합니다.',
        currentCredit,
        totalPoint,
      };
    }

    const orderNo = 'ORD-' + new Date().getTime();
    const now = new Date();

    orderItems.forEach(item => {
      // 주문내역 마지막 열에 제공 여부 기본값 'N' 명시적 입력
      orderSheet.appendRow([
        now,
        orderNo,
        userId,
        nickname,
        item.snackId,
        item.snackName,
        item.quantity,
        item.totalPoint,
        'N'
      ]);

      // 간식 재고 차감 반영
      snackSheet
        .getRange(item.snackRowIndex + 1, 6)
        .setValue(item.afterStock);
    });

    // 유저 크레딧 차감 반영
    const newCredit = currentCredit - totalPoint;
    userSheet.getRange(userRowIndex + 1, 3).setValue(newCredit);

    return {
      success: true,
      message: '주문이 완료되었습니다.',
      orderNo,
      nickname,
      totalPoint,
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
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET.ORDERS);
  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1);

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
      servedYn: row[8] || 'N' 
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
      orderSheet.getRange(i + 1, 9).setValue(servedYn); // I열 (9번째) 제공여부 수정
      updatedCount++;
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
 * 10. 이용자 크레딧 조정 API
 */
function updateUserCredit(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.USERS);
  var rows = sheet.getDataRange().getValues();
  var userId = data.userId;
  var newCredit = Number(data.credit);
  
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === userId) {
      sheet.getRange(i + 1, 3).setValue(newCredit);
      return { success: true, message: '크레딧을 업데이트했습니다.' };
    }
  }
  return { success: false, message: '이용자를 찾을 수 없습니다.' };
}

/**
 * 11. 간식 재고 수량 조정 API
 */
function updateSnackStock(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.SNACKS);
  var rows = sheet.getDataRange().getValues();
  var snackId = Number(data.snackId);
  var newStock = Number(data.stock);
  
  for (var i = 1; i < rows.length; i++) {
    if (Number(rows[i][0]) === snackId) {
      sheet.getRange(i + 1, 6).setValue(newStock);
      return { success: true, message: '재고를 업데이트했습니다.' };
    }
  }
  return { success: false, message: '간식을 찾을 수 없습니다.' };
}

/**
 * 12. 신규 간식 품목 등록 API
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
  
  var newRow = [
    newSnackId,
    data.name,
    Number(data.point || 1),
    data.imageUrl || "",
    data.saleYn || "Y",
    Number(data.stock || 0)
  ];
  
  sheet.appendRow(newRow);
  return { success: true, message: '신규 간식을 등록했습니다.', snackId: newSnackId };
}
```
