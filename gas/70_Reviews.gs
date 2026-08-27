const REVIEW_EDIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const REVIEW_HEADERS = [
  'createdAt', 'orderId', 'guestName', 'stamp', 'tags', 'comment',
  'isPublic', 'imageUrl', 'replyText', 'replyCreatedAt', 'updatedAt', 'editCount'
];

function ensureReviewHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET.REVIEWS);
  if (!sheet) sheet = ss.insertSheet(SHEET.REVIEWS);

  const existing = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(value => String(value || '').trim())
    : [];
  const headers = existing.filter(Boolean);
  let changed = headers.length === 0;
  REVIEW_HEADERS.forEach(header => {
    if (headers.indexOf(header) === -1) {
      headers.push(header);
      changed = true;
    }
  });
  if (changed) {
    if (sheet.getMaxColumns() < headers.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
    }
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return `후기내역 헤더 준비 완료 (${headers.length}열)`;
}

function getReviewHeaderMap_(headers) {
  const map = {};
  REVIEW_HEADERS.forEach(header => {
    map[header] = headers.indexOf(header);
  });
  return map;
}

function getRequiredReviewHeaderMap_(headers) {
  const map = getReviewHeaderMap_(headers || []);
  const missing = REVIEW_HEADERS.filter(header => map[header] === -1);
  if (missing.length > 0) {
    throw new Error('후기내역 필수 헤더가 없습니다: ' + missing.join(', '));
  }
  return map;
}

function isTruthyReviewValue_(value) {
  return value === true || ['TRUE', 'Y', 'O', 'YES', '예'].indexOf(String(value || '').trim().toUpperCase()) !== -1;
}

function verifyGuestReviewOrderOwnership_(data) {
  const ownership = verifyOrderOwnership_(data, {
    requireOrderId: true,
    requireGuest: true,
    includeArchived: true
  });
  if (!ownership.success) return ownership;
  ownership.orderId = ownership.orderNo;
  ownership.sourceSheet = ownership.sheet.getName();
  return ownership;
}

function getReviewEditState_(createdAt) {
  const createdTime = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  if (!isFinite(createdTime)) {
    return { editable: false, message: '후기 작성 시각을 확인할 수 없어 수정할 수 없습니다.' };
  }
  const expiresAt = new Date(createdTime + REVIEW_EDIT_WINDOW_MS);
  return {
    editable: Date.now() <= expiresAt.getTime(),
    expiresAt,
    message: Date.now() <= expiresAt.getTime() ? '' : '후기 작성 후 7일이 지나 수정할 수 없습니다.'
  };
}

function reviewRowToObject_(row, headers) {
  const idx = getReviewHeaderMap_(headers);
  const editState = getReviewEditState_(row[idx.createdAt]);
  return {
    createdAt: row[idx.createdAt] || '',
    orderId: row[idx.orderId] || '',
    guestName: row[idx.guestName] || '',
    stamp: row[idx.stamp] || '',
    tags: row[idx.tags] || '',
    comment: row[idx.comment] || '',
    isPublic: isTruthyReviewValue_(row[idx.isPublic]),
    imageUrl: row[idx.imageUrl] || '',
    replyText: idx.replyText !== -1 ? row[idx.replyText] || '' : '',
    replyCreatedAt: idx.replyCreatedAt !== -1 ? row[idx.replyCreatedAt] || '' : '',
    updatedAt: idx.updatedAt !== -1 ? row[idx.updatedAt] || '' : '',
    editCount: idx.editCount !== -1 ? Number(row[idx.editCount] || 0) : 0,
    editable: editState.editable,
    editExpiresAt: editState.expiresAt || ''
  };
}

function getGuestReview(data) {
  const ownership = verifyGuestReviewOrderOwnership_(data);
  if (!ownership.success) return ownership;

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.REVIEWS);
  if (!sheet || sheet.getLastRow() < 2) return { success: false, message: '작성된 후기를 찾을 수 없습니다.' };
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const orderIdIdx = headers.indexOf('orderId');
  if (orderIdIdx === -1) return { success: false, message: '후기 데이터 구조를 확인할 수 없습니다.' };
  const rows = values.slice(1).filter(row => String(row[orderIdIdx] || '').trim() === ownership.orderId);
  if (rows.length !== 1) {
    if (rows.length > 1) Logger.log(JSON.stringify({ event: 'duplicate_guest_review', orderId: ownership.orderId, count: rows.length }));
    return { success: false, message: rows.length ? '중복 후기 데이터가 있어 관리자 확인이 필요합니다.' : '작성된 후기를 찾을 수 없습니다.' };
  }
  return { success: true, review: reviewRowToObject_(rows[0], headers) };
}

function updateGuestReview(data) {
  const stamp = String(data && data.stamp || '').trim();
  const tags = String(data && data.tags || '').trim();
  const comment = String(data && data.comment || '').trim();
  const imageAction = String(data && data.imageAction || 'keep').trim().toLowerCase();
  const isPublic = data && data.isPublic !== false && data.isPublic !== 'false';
  if (comment.length > 100) return { success: false, message: '응원 메시지는 100자 이내로 입력해주세요.' };
  if (!stamp && !tags) return { success: false, message: '칭찬 스탬프나 태그를 1개 이상 선택해주세요.' };
  if (['keep', 'replace', 'remove'].indexOf(imageAction) === -1) return { success: false, message: '사진 변경 방식이 올바르지 않습니다.' };
  if (imageAction === 'replace' && !String(data.imageUrl || '').trim()) return { success: false, message: '교체할 사진 정보가 없습니다.' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, message: '다른 작업을 처리 중입니다. 잠시 후 다시 시도해 주세요.' };
  let staleImageUrl = '';
  try {
    const ownership = verifyGuestReviewOrderOwnership_(data);
    if (!ownership.success) return ownership;
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.REVIEWS);
    if (!sheet) throw new Error('후기내역 시트를 찾을 수 없습니다.');
    const values = sheet.getDataRange().getValues();
    const headers = values[0] || [];
    const idx = getRequiredReviewHeaderMap_(headers);
    const matches = [];
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][idx.orderId] || '').trim() === ownership.orderId) matches.push(i);
    }
    if (matches.length !== 1) {
      if (matches.length > 1) Logger.log(JSON.stringify({ event: 'duplicate_guest_review_update', orderId: ownership.orderId, count: matches.length }));
      return { success: false, message: matches.length ? '중복 후기 데이터가 있어 수정할 수 없습니다.' : '수정할 후기를 찾을 수 없습니다.' };
    }

    const rowIndex = matches[0];
    const editState = getReviewEditState_(values[rowIndex][idx.createdAt]);
    if (!editState.editable) return { success: false, message: editState.message };
    const row = values[rowIndex].slice();
    const oldImageUrl = String(row[idx.imageUrl] || '').trim();
    const wasPublic = isTruthyReviewValue_(row[idx.isPublic]);
    let nextImageUrl = oldImageUrl;
    if (imageAction === 'replace') nextImageUrl = String(data.imageUrl || '').trim();
    if (imageAction === 'remove') nextImageUrl = '';
    const needsPhotoConsent = isPublic && nextImageUrl && (imageAction === 'replace' || !wasPublic);
    const hasPhotoConsent = data.photoPublicConsent === true || data.photoPublicConsent === 'true';
    if (needsPhotoConsent && !hasPhotoConsent) {
      return { success: false, message: '사진 공개 확인에 동의해 주세요.' };
    }

    row[idx.stamp] = stamp;
    row[idx.tags] = tags;
    row[idx.comment] = comment;
    row[idx.isPublic] = isPublic;
    row[idx.imageUrl] = nextImageUrl;
    row[idx.updatedAt] = new Date();
    row[idx.editCount] = Number(row[idx.editCount] || 0) + 1;
    sheet.getRange(rowIndex + 1, 1, 1, headers.length).setValues([row.slice(0, headers.length)]);
    if (oldImageUrl && oldImageUrl !== nextImageUrl) staleImageUrl = oldImageUrl;
    clearOrderReadCache();
    clearReviewCache();
    const review = reviewRowToObject_(row, headers);
    return { success: true, message: '후기가 수정되었습니다.', review };
  } catch (error) {
    return getSafeApiErrorResponse('updateGuestReview', error);
  } finally {
    lock.releaseLock();
    if (staleImageUrl) trashReviewImageFile_(staleImageUrl);
  }
}

/**
 * 22. 후기 등록 API
 */
function submitReview(data) {
  const orderId = String(data && data.orderId || '').trim();
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
    const reviewedIdx = headers.indexOf('reviewed');
    if (reviewedIdx === -1) throw new Error('주문내역 reviewed 헤더가 없습니다.');
    const ownership = verifyOrderOwnership_(data, {
      spreadsheet: ss,
      orderSheet: orderSheet,
      orderValues: orderValues,
      requireOrderId: true,
      requireGuest: true,
      includeArchived: false
    });
    if (!ownership.success) return ownership;
    const targetIndices = ownership.matched.map(item => item.index);
    const servedYnIdx = ownership.indexes.servedYn;
    const allCompleted = ownership.matched.every(item => {
      const served = String(item.row[servedYnIdx] || '').trim().toUpperCase();
      return served === 'Y' || served === '수령완료';
    });
    if (!allCompleted) {
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

    // 2. 후기내역 시트 조회 (공개 요청에서는 구조를 변경하지 않음)
    const reviewSheet = ss.getSheetByName(SHEET.REVIEWS);
    if (!reviewSheet) throw new Error('후기내역 시트를 찾을 수 없습니다.');
    const reviewHeaders = reviewSheet.getRange(1, 1, 1, reviewSheet.getLastColumn()).getValues()[0];
    const reviewIdx = getRequiredReviewHeaderMap_(reviewHeaders);

    // 3. 후기 기록 추가
    const reviewRow = new Array(reviewHeaders.length).fill('');
    reviewRow[reviewIdx.createdAt] = new Date();
    reviewRow[reviewIdx.orderId] = orderId;
    reviewRow[reviewIdx.guestName] = guestName;
    reviewRow[reviewIdx.stamp] = stamp;
    reviewRow[reviewIdx.tags] = tags;
    reviewRow[reviewIdx.comment] = comment;
    reviewRow[reviewIdx.isPublic] = isPublic;
    reviewRow[reviewIdx.imageUrl] = data.imageUrl || '';
    reviewRow[reviewIdx.editCount] = 0;
    reviewSheet.appendRow(reviewRow);

    // 4. 주문내역 시트에서 reviewed 상태 업데이트
    targetIndices.forEach(idx => {
      orderSheet.getRange(idx + 1, reviewedIdx + 1).setValue(true);
    });

    clearOrderReadCache();
    clearReviewCache();
    return {
      success: true,
      message: '리뷰가 성공적으로 등록되었습니다.'
    };
  } catch (error) {
    return getSafeApiErrorResponse('submitReview', error);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 공개 후기에서 표시할 이름을 마스킹한다.
 * 관리자용 조회에는 적용하지 않고, 외부에 반환되는 응답에만 사용한다.
 */
function maskPublicReviewName(name) {
  const text = String(name == null ? '' : name).trim();
  if (!text || text === '익명의 온기') return '익명의 온기';
  const sensitiveTerms = [
    '장애인',
    '장애우',
    '발달장애',
    '지적장애',
    '정신장애',
    '신체장애',
    '시각장애',
    '청각장애'
  ];
  if (sensitiveTerms.some(term => text.indexOf(term) !== -1)) {
    const neutralNames = ['따뜻한 손님', '반가운 이웃', '다정한 손님', '고마운 이웃', '소중한 손님'];
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash * 31) + text.charCodeAt(i)) >>> 0;
    }
    return neutralNames[hash % neutralNames.length];
  }
  if (text.length <= 1) return text;
  if (text.length === 2) return text[0] + '*';
  if (text.length <= 4) {
    return text[0] + '*'.repeat(text.length - 2) + text[text.length - 1];
  }
  return text.slice(0, 3) + '***';
}

/**
 * 23. 최근 공개 후기 조회 API (칭찬 보드용)
 */
function getRecentReviews() {
  const cache = CacheService.getScriptCache();
  const cachedData = cache.get('recent_reviews_data');
  if (cachedData) {
    try {
      return JSON.parse(cachedData);
    } catch (e) {
      // 캐시가 손상된 경우 시트에서 다시 계산한다.
    }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reviewSheet = ss.getSheetByName(SHEET.REVIEWS);
  if (!reviewSheet) {
    return { success: true, reviews: [] };
  }

  const values = reviewSheet.getDataRange().getValues();
  const headers = values[0] || [];
  const idx = getReviewHeaderMap_(headers);
  const rows = values.slice(1);

  // isPublic이 참인 것만 필터링하여 최신순으로 정렬
  const reviews = rows
    .filter(row => {
      return isTruthyReviewValue_(row[idx.isPublic]);
    })
    .map(row => ({
      createdAt: row[idx.createdAt],
      orderId: row[idx.orderId],
      guestName: maskPublicReviewName(row[idx.guestName]),
      stamp: row[idx.stamp],
      tags: row[idx.tags],
      comment: row[idx.comment],
      imageUrl: row[idx.imageUrl] || '',
      replyText: idx.replyText !== -1 ? row[idx.replyText] || '' : '',
      replyCreatedAt: idx.replyCreatedAt !== -1 ? row[idx.replyCreatedAt] || '' : '',
      updatedAt: idx.updatedAt !== -1 ? row[idx.updatedAt] || '' : '',
      editCount: idx.editCount !== -1 ? Number(row[idx.editCount] || 0) : 0
    }))
    .reverse() // 최신 작성순
    .slice(0, 10); // 최대 10개만 반환

  const result = {
    success: true,
    reviews
  };

  try {
    cache.put('recent_reviews_data', JSON.stringify(result), 300);
  } catch (e) {
    // 캐시 저장 오류는 조회 결과에 영향을 주지 않는다.
  }

  return result;
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
  const headers = values[0] || [];
  const idx = getReviewHeaderMap_(headers);
  const rows = values.slice(1);

  const reviews = rows
    .map(row => ({
      createdAt: row[idx.createdAt],
      orderId: row[idx.orderId],
      guestName: row[idx.guestName],
      stamp: row[idx.stamp],
      tags: row[idx.tags],
      comment: row[idx.comment],
      isPublic: row[idx.isPublic],
      imageUrl: row[idx.imageUrl] || '',
      replyText: idx.replyText !== -1 ? row[idx.replyText] || '' : '',
      replyCreatedAt: idx.replyCreatedAt !== -1 ? row[idx.replyCreatedAt] || '' : '',
      updatedAt: idx.updatedAt !== -1 ? row[idx.updatedAt] || '' : '',
      editCount: idx.editCount !== -1 ? Number(row[idx.editCount] || 0) : 0
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
    clearReviewCache();

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
    clearReviewCache();

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

/**
 * 27. 공개 후기 통합 조회 API (온기 개화 마일스톤 및 5분 캐시 적용)
 */
function calculateWarmthTemperature(progress) {
  const points = [
    { count: 0, temperature: 36.5 },
    { count: 10, temperature: 50 },
    { count: 30, temperature: 75 },
    { count: 50, temperature: 100 }
  ];
  const count = Math.min(50, Math.max(0, Number(progress) || 0));

  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const current = points[i];
    if (count <= current.count) {
      const ratio = (count - previous.count) / (current.count - previous.count);
      // 첫 후기 구간은 초반 성취감이 느껴지도록 ease-out 가중치를 적용한다.
      // 10개 시점에는 반드시 50℃에 도달해 마일스톤 기준은 유지한다.
      const weightedRatio = previous.count === 0 && current.count === 10
        ? 1 - Math.pow(1 - ratio, 2)
        : ratio;
      return Math.round((previous.temperature + weightedRatio * (current.temperature - previous.temperature)) * 10) / 10;
    }
  }
  return 100;
}

function getPublicReviews() {
  try {
    const cache = CacheService.getScriptCache();
    const cachedData = cache.get("public_reviews_data");
    if (cachedData) {
      try {
        return JSON.parse(cachedData);
      } catch (e) {
        // 캐시 파싱 에러 시 재계산 진행
      }
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const reviewSheet = ss.getSheetByName(SHEET.REVIEWS);
    if (!reviewSheet) {
      return { success: true, reviews: [], totalCount: 0, cycle: 1, temperature: 36.5, stage: 0, progress: 0 };
    }

    const values = reviewSheet.getDataRange().getValues();
    if (values.length <= 1) {
      return { success: true, reviews: [], totalCount: 0, cycle: 1, temperature: 36.5, stage: 0, progress: 0 };
    }

    const headers = values[0] || [];
    const isPublicIdx = findHeaderIndex(headers, ['isPublic', '공개', '공개여부']);
    const commentIdx = findHeaderIndex(headers, ['comment', '내용', '후기내용', '응원메시지']);
    const userIdx = findHeaderIndex(headers, ['guestName', '닉네임', '작성자', '이름']);
    const dateIdx = findHeaderIndex(headers, ['createdAt', '작성일', '등록일', '일시']);
    const stampIdx = findHeaderIndex(headers, ['stamp', '스탬프', '칭찬스탬프']);
    const tagsIdx = findHeaderIndex(headers, ['tags', '태그']);
    const imageIdx = findHeaderIndex(headers, ['imageUrl', '사진url', '이미지url']);
    const replyTextIdx = findHeaderIndex(headers, ['replyText', '답글', '관리자답글']);
    const replyDateIdx = findHeaderIndex(headers, ['replyCreatedAt', '답글작성일']);
    const updatedAtIdx = findHeaderIndex(headers, ['updatedAt', '수정일', '수정시각']);
    const editCountIdx = findHeaderIndex(headers, ['editCount', '수정횟수']);

    const rows = values.slice(1);

    const reviews = rows
      .filter(row => {
        const val = isPublicIdx !== -1 ? row[isPublicIdx] : row[6];
        if (val === undefined || val === null || String(val).trim() === '') {
          return true; // 과거에 isPublic 값이 비어있던 기존 후기도 기본 공개 처리
        }
        const strVal = String(val).trim().toUpperCase();
        return strVal !== 'FALSE' && strVal !== 'N' && strVal !== 'NO' && strVal !== 'X' && strVal !== '아니오' && val !== false;
      })
      .map(row => {
        const cDate = dateIdx !== -1 ? row[dateIdx] : row[0];
        const rDate = replyDateIdx !== -1 ? row[replyDateIdx] : row[9];
        return {
          createdAt: formatReviewDateSafely(cDate),
          guestName: maskPublicReviewName(userIdx !== -1 ? row[userIdx] : row[2]),
          stamp: (stampIdx !== -1 ? row[stampIdx] : row[3]) || '',
          tags: (tagsIdx !== -1 ? row[tagsIdx] : row[4]) || '',
          comment: (commentIdx !== -1 ? row[commentIdx] : row[5]) || '',
          imageUrl: (imageIdx !== -1 ? row[imageIdx] : row[7]) || '',
          replyText: (replyTextIdx !== -1 ? row[replyTextIdx] : row[8]) || '',
          replyCreatedAt: formatReviewDateSafely(rDate),
          updatedAt: formatReviewDateSafely(updatedAtIdx !== -1 ? row[updatedAtIdx] : ''),
          editCount: editCountIdx !== -1 ? Number(row[editCountIdx] || 0) : 0
        };
      })
      .reverse(); // 최신순

    const totalCount = reviews.length;
    const maxReviews = 50;

    const cycle = Math.floor(totalCount / maxReviews) + 1;
    let progress = totalCount % maxReviews;

    // 50개, 100개 등 딱 떨어질 때 100℃/3단계를 유지하기 위한 예외 처리
    if (totalCount > 0 && progress === 0) {
      progress = maxReviews;
    }

    const temperature = calculateWarmthTemperature(progress);

    // 단계(stage: 0~3) 계산: 10개(50℃), 30개(75℃), 50개(100℃ - 온기 개화)
    let stage = 0;
    if (progress >= 50) stage = 3;
    else if (progress >= 30) stage = 2;
    else if (progress >= 10) stage = 1;

    const result = {
      success: true,
      reviews,
      totalCount,
      cycle,
      progress,
      temperature,
      stage
    };

    try {
      cache.put("public_reviews_data", JSON.stringify(result), 300);
    } catch (e) {
      // 캐시 저장 오류 시 무시
    }

    return result;
  } catch (error) {
    return Object.assign(getSafeApiErrorResponse('getPublicReviews', error), {
      reviews: [],
      totalCount: 0,
      cycle: 1,
      progress: 0,
      temperature: 36.5,
      stage: 0
    });
  }
}

/**
 * 안전한 날짜 포맷 헬퍼 (Utilities.formatDate 예외 방지)
 */
function formatReviewDateSafely(val) {
  if (!val) return '';
  if (val instanceof Date) {
    try {
      return Utilities.formatDate(val, "GMT+9", "yyyy-MM-dd HH:mm");
    } catch (e) {
      return String(val);
    }
  }
  const str = String(val).trim();
  if (!str) return '';
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, "GMT+9", "yyyy-MM-dd HH:mm");
    }
  } catch (e) {}
  return str;
}

/**
 * 대소문자 및 한글/영어 호환 헤더 찾기 헬퍼
 */
function findHeaderIndex(headers, targets) {
  if (!headers || !headers.length) return -1;
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i]).trim().toLowerCase();
    for (let j = 0; j < targets.length; j++) {
      if (h === String(targets[j]).trim().toLowerCase()) return i;
    }
  }
  return -1;
}

/**
 * 리뷰 관련 캐시 무효화 헬퍼
 */
function clearReviewCache() {
  try {
    const cache = CacheService.getScriptCache();
    cache.remove("public_reviews_data");
    cache.remove("recent_reviews_data");
  } catch (e) {}
}
