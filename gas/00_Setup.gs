/**
 * 로컬/GitHub에는 비밀값을 저장하지 않습니다.
 *
 * 새 Apps Script 프로젝트를 만들었을 때만 GAS 편집기에서 이 파일에
 * setKakaoPropertiesOnce() 같은 일회성 설정 함수를 임시로 추가하고 실행합니다.
 * 같은 프로젝트 안에서 파일만 분리한 경우 기존 Script Properties는 유지됩니다.
 */

/**
 * P103 일회성 전환: 이용자목록 전체를 백업하고 활성 이용자의 크레딧 값을
 * 일반 키오스크의 개인별 1회 주문 한도 기본값(10)으로 맞춥니다.
 */
function migrateKioskUserCreditsToOrderLimits() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const userSheet = ss.getSheetByName(SHEET.USERS);
    if (!userSheet) {
      throw new Error('이용자목록 시트를 찾을 수 없습니다.');
    }

    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    const baseBackupName = '이용자목록_한도전환백업_' + timestamp;
    let backupName = baseBackupName;
    let suffix = 2;
    while (ss.getSheetByName(backupName)) {
      backupName = baseBackupName + '_' + suffix;
      suffix++;
    }

    const backupSheet = userSheet.copyTo(ss).setName(backupName);
    backupSheet.hideSheet();

    const values = userSheet.getDataRange().getValues();
    if (values.length <= 1) {
      return { success: true, backupSheetName: backupName, updatedCount: 0 };
    }

    let updatedCount = 0;
    const limitValues = values.slice(1).map(row => {
      const active = String(row[3] == null ? 'Y' : row[3]).trim().toUpperCase();
      const isActive = ['Y', 'TRUE', '사용', 'O', '예'].includes(active);
      if (isActive) {
        updatedCount++;
        return [DEFAULT_USER_ORDER_LIMIT];
      }
      return [row[2]];
    });

    userSheet.getRange(2, 3, limitValues.length, 1).setValues(limitValues);
    clearUserReadCache();
    safeAppendAdminLog(
      'migrateKioskUserCreditsToOrderLimits',
      'sheet',
      SHEET.USERS,
      '활성 이용자 ' + updatedCount + '명',
      '',
      JSON.stringify({ defaultOrderLimit: DEFAULT_USER_ORDER_LIMIT, backupSheetName: backupName }),
      'P103 1회 주문 한도 전환'
    );

    return {
      success: true,
      backupSheetName: backupName,
      updatedCount,
      defaultOrderLimit: DEFAULT_USER_ORDER_LIMIT,
    };
  } finally {
    lock.releaseLock();
  }
}
