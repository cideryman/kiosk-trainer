/**
 * 22. 후기 등록 API
 */
function submitReview(data) {
  ensureOrderHeaders();
  const orderId = data.orderId;
  const requestToken = data.orderToken;
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
    const orderTokenIdx = headers.indexOf('orderToken');

    let targetIndices = [];

    for (let i = 1; i < orderValues.length; i++) {
      const rowOrderId = String(orderValues[i][orderNoIdx !== -1 ? orderNoIdx : 1]);
      const rowOrderToken = String(orderValues[i][orderTokenIdx !== -1 ? orderTokenIdx : 10] || '');

      if (rowOrderId === String(orderId)) {
        // 게스트 주문이고 시트에 토큰이 있는 경우, 요청 토큰 검증 필수
        if (rowOrderToken) {
          if (!requestToken || rowOrderToken !== String(requestToken)) {
            return { success: false, message: '주문 확인 정보(토큰)가 일치하지 않거나 누락되었습니다.' };
          }
        }
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
      reviewSheet.appendRow(['createdAt', 'orderId', 'guestName', 'stamp', 'tags', 'comment', 'isPublic', 'imageUrl']);
    } else {
      const reviewHeaders = reviewSheet.getDataRange().getValues()[0] || [];
      if (reviewHeaders.length === 0) {
        reviewSheet.appendRow(['createdAt', 'orderId', 'guestName', 'stamp', 'tags', 'comment', 'isPublic', 'imageUrl']);
      } else if (reviewHeaders.indexOf('imageUrl') === -1) {
        // H열에 imageUrl 헤더 추가
        reviewSheet.getRange(1, 8).setValue('imageUrl');
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
      isPublic,
      data.imageUrl || ''
    ]);

    // 4. 주문내역 시트에서 reviewed 상태 업데이트
    targetIndices.forEach(idx => {
      orderSheet.getRange(idx + 1, reviewedIdx + 1).setValue(true);
    });

    clearOrderReadCache();
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
      comment: row[5],
      imageUrl: row[7] || '',
      replyText: row[8] || '',
      replyCreatedAt: row[9] || ''
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
      isPublic: row[6],
      imageUrl: row[7] || '',
      replyText: row[8] || '',
      replyCreatedAt: row[9] || ''
    }))
    .reverse(); // 최신순

  return {
    success: true,
    reviews
  };
}

/**
 * 26. 후기 답글 등록 API (관리자 대리 입력)
 */
function submitReviewReply(data) {
  const orderId = data.orderId;
  const replyText = data.replyText || '';

  if (!orderId) {
    return {
      success: false,
      message: '필수 매개변수(orderId)가 누락되었습니다.'
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
    const reviewSheet = ss.getSheetByName(SHEET.REVIEWS);
    if (!reviewSheet) {
      return { success: false, message: '후기내역 시트를 찾을 수 없습니다.' };
    }

    const reviewValues = reviewSheet.getDataRange().getValues();
    const headers = reviewValues[0] || [];

    // 헤더 구조 검증 및 동적 추가 (9번째, 10번째 열)
    let replyTextIdx = headers.indexOf('replyText');
    let replyCreatedAtIdx = headers.indexOf('replyCreatedAt');

    if (replyTextIdx === -1) {
      replyTextIdx = 8;
      reviewSheet.getRange(1, 9).setValue('replyText');
      headers[8] = 'replyText';
    }
    if (replyCreatedAtIdx === -1) {
      replyCreatedAtIdx = 9;
      reviewSheet.getRange(1, 10).setValue('replyCreatedAt');
      headers[9] = 'replyCreatedAt';
    }

    const orderIdIdx = headers.indexOf('orderId');
    if (orderIdIdx === -1) {
      return { success: false, message: '후기 테이블의 orderId 컬럼을 찾을 수 없습니다.' };
    }

    let targetRowIdx = -1;
    for (let i = 1; i < reviewValues.length; i++) {
      if (String(reviewValues[i][orderIdIdx]) === String(orderId)) {
        targetRowIdx = i;
        break; // 첫 매칭 시 정지
      }
    }

    if (targetRowIdx === -1) {
      return { success: false, message: '해당 주문의 후기를 찾을 수 없습니다.' };
    }

    // 답글 내용과 날짜 업데이트 (1-based index)
    reviewSheet.getRange(targetRowIdx + 1, replyTextIdx + 1).setValue(replyText);
    reviewSheet.getRange(targetRowIdx + 1, replyCreatedAtIdx + 1).setValue(new Date());

    // 관리자 로그 추가
    safeAppendAdminLog('submitReviewReply', 'reviews', 'update', '후기 답글 작성', orderId, `답글: ${replyText}`, data.adminMemo);

    return {
      success: true,
      message: '후기 답글이 성공적으로 등록되었습니다.'
    };
  } catch (error) {
    return {
      success: false,
      message: '후기 답글 등록 중 오류: ' + error.message
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 날짜 객체 또는 날짜 문자열의 동등성을 안전하게 비교하는 헬퍼 함수
 */
function isSameDateTime(val1, val2) {
  if (!val1 || !val2) return false;
  const str1 = String(val1).trim();
  const str2 = String(val2).trim();
  if (str1 === str2) return true;

  function parseDateSafely(val) {
    if (val instanceof Date) return val;
    let s = String(val).trim();

    // 한국어 날짜 형식 파싱 예: "2026. 6. 19. 오전 9:48:00"
    const match = s.match(/(\d{4})[-\.\/\s]+(\d{1,2})[-\.\/\s]+(\d{1,2})[-\.\/\s]+(오전|오후|AM|PM)\s*(\d{1,2}):(\d{1,2}):(\d{1,2})/i);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      const isPM = (match[4] === '오후' || match[4].toUpperCase() === 'PM');
      let hour = parseInt(match[5], 10);
      const minute = parseInt(match[6], 10);
      const second = parseInt(match[7], 10);

      if (isPM && hour < 12) hour += 12;
      if (!isPM && hour === 12) hour = 0;

      return new Date(year, month, day, hour, minute, second);
    }

    const matchNoSec = s.match(/(\d{4})[-\.\/\s]+(\d{1,2})[-\.\/\s]+(\d{1,2})[-\.\/\s]+(오전|오후|AM|PM)\s*(\d{1,2}):(\d{1,2})/i);
    if (matchNoSec) {
      const year = parseInt(matchNoSec[1], 10);
      const month = parseInt(matchNoSec[2], 10) - 1;
      const day = parseInt(matchNoSec[3], 10);
      const isPM = (matchNoSec[4] === '오후' || matchNoSec[4].toUpperCase() === 'PM');
      let hour = parseInt(matchNoSec[5], 10);
      const minute = parseInt(matchNoSec[6], 10);

      if (isPM && hour < 12) hour += 12;
      if (!isPM && hour === 12) hour = 0;

      return new Date(year, month, day, hour, minute, 0);
    }

    return new Date(s);
  }

  const d1 = parseDateSafely(val1);
  const d2 = parseDateSafely(val2);
  const t1 = d1.getTime();
  const t2 = d2.getTime();

  if (!isNaN(t1) && !isNaN(t2)) {
    return Math.floor(t1 / 1000) === Math.floor(t2 / 1000);
  }
  return false;
}

/**
 * 24.5 후기 공개/비공개 토글 API
 */
function toggleReviewVisibility(data) {
  const adminResult = verifyAdminToken(data);
  if (!adminResult.success) {
    return adminResult;
  }

  const { createdAt, orderId, isPublic } = data;
  if (!createdAt) {
    return { success: false, message: '후기 식별 정보(createdAt)가 누락되었습니다.' };
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, message: '다른 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.' };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const reviewSheet = ss.getSheetByName(SHEET.REVIEWS);
    if (!reviewSheet) {
      return { success: false, message: '후기 시트를 찾을 수 없습니다.' };
    }

    const values = reviewSheet.getDataRange().getValues();
    const rows = values.slice(1);

    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const rowCreatedAt = rows[i][0];
      const rowOrderId = String(rows[i][1]).trim();

      // 1. 만약 orderId가 주어졌다면, orderId 매칭 우선 처리 (날짜 파싱 에러 방지)
      if (orderId && String(orderId).trim()) {
        if (rowOrderId === String(orderId).trim()) {
          rowIndex = i + 2;
          break;
        }
      } else {
        // 2. 백패드 호환성을 위해 createdAt 만으로 확인
        if (isSameDateTime(rowCreatedAt, createdAt)) {
          rowIndex = i + 2;
          break;
        }
      }
    }

    if (rowIndex === -1) {
      return { success: false, message: '해당 후기를 찾을 수 없습니다.' };
    }

    // 7번째 열이 isPublic
    reviewSheet.getRange(rowIndex, 7).setValue(isPublic ? 'Y' : 'N');

    return {
      success: true,
      message: '후기 공개 상태가 변경되었습니다.'
    };
  } catch (e) {
    return { success: false, message: '후기 상태 변경 중 오류: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}
