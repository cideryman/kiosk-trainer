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
 * 10. 이용자 크레딧 조정 API
 */
function updateUserCredit(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.USERS);
  var rows = sheet.getDataRange().getValues();
  var userId = data.userId;
  var newCredit = Number(data.credit);

  if (!isFinite(newCredit) || newCredit < 0 || newCredit > ADMIN_MAX_USER_CREDIT) {
    return { success: false, message: '이용자 크레딧은 0~' + ADMIN_MAX_USER_CREDIT + ' 범위로 입력해 주세요.' };
  }

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(userId)) {
      var beforeCredit = Number(rows[i][2] || 0);
      sheet.getRange(i + 1, 3).setValue(newCredit);
      safeAppendAdminLog('updateUserCredit', 'user', userId, rows[i][1], beforeCredit, newCredit, data.adminMemo);
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
  var initialCredit = Number(data.credit || 0);
  if (!isFinite(initialCredit) || initialCredit < 0 || initialCredit > ADMIN_MAX_USER_CREDIT) {
    return { success: false, message: '이용자 크레딧은 0~' + ADMIN_MAX_USER_CREDIT + ' 범위로 입력해 주세요.' };
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
    initialCredit,
    data.useYn || 'Y',
    data.imageUrl || ''
  ]);
  safeAppendAdminLog('addUser', 'user', newUserId, nickname, '', JSON.stringify({ credit: initialCredit, useYn: data.useYn || 'Y' }), data.adminMemo);

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
      safeAppendAdminLog('updateUserActive', 'user', userId, rows[i][1], beforeUseYn, useYn, data.adminMemo);
      return { success: true, message: '이용자 상태를 업데이트했습니다.', useYn: useYn };
    }
  }

  return { success: false, message: '이용자를 찾을 수 없습니다.' };
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
  if (!isFinite(credit) || credit < 0 || credit > ADMIN_MAX_USER_CREDIT) {
    return { success: false, message: '이용자 크레딧은 0~' + ADMIN_MAX_USER_CREDIT + ' 범위로 입력해 주세요.' };
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

      safeAppendAdminLog('updateUser', 'user', userId, nickname,
        JSON.stringify({ nickname: beforeNickname, credit: beforeCredit, useYn: beforeUseYn, imageUrl: beforeImageUrl }),
        JSON.stringify({ nickname: nickname, credit: credit, useYn: useYn, imageUrl: imageUrl }),
        data.adminMemo
      );
      return { success: true, message: '이용자 정보를 수정했습니다.' };
    }
  }
  return { success: false, message: '이용자를 찾을 수 없습니다.' };
}
