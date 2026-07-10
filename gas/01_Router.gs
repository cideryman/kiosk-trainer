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

  if (action === 'getKakaoLoginConfig') {
    return jsonResponse(getKakaoLoginConfig(e.parameter.redirectUri));
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
  try {
    var JSON_STRING = e && e.postData ? e.postData.contents : '{}';
    var data = JSON.parse(JSON_STRING || '{}');
    var action = data.action;
    Logger.log('doPost Action: ' + String(action || '(unknown)'));

    if (ADMIN_ACTIONS.indexOf(action) !== -1) {
      const auth = verifyAdminToken(data);
      if (!auth.success) {
        return jsonResponse(auth);
      }
    }

    if (action === 'verifyAdminAccess') {
      return jsonResponse(verifyAdminAccess());
    } else if (action === 'placeOrder') {
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
    } else if (action === 'toggleReviewVisibility') {
      return jsonResponse(toggleReviewVisibility(data));
    } else if (action === 'ensureOrderHeaders') {
      return jsonResponse({ success: true, message: ensureOrderHeaders() });
    } else if (action === 'autoFillEmptySnackIds') {
      return jsonResponse(autoFillEmptySnackIds());
    } else if (action === 'getGuestOrderByToken') {
      return jsonResponse(getGuestOrderByToken(data));
    } else if (action === 'exchangeKakaoAuthCode') {
      return jsonResponse(exchangeKakaoAuthCode(data));
    } else if (action === 'getGuestOrdersByGuestKey') {
      return jsonResponse(getGuestOrdersByGuestKey(data));
    } else if (action === 'getGuestProfileByGuestKey') {
      return jsonResponse(getGuestProfileByGuestKey(data));
    } else if (action === 'deleteGuestProfileByGuestKey') {
      return jsonResponse(deleteGuestProfileByGuestKey(data));
    } else if (action === 'updateGuestProfileByGuestKey') {
      return jsonResponse(updateGuestProfileByGuestKey(data));
    } else if (action === 'getGuestCreditStatus') {
      return jsonResponse(getGuestCreditStatus(data));
    } else if (action === 'diagnoseSystem') {
      return jsonResponse(diagnoseSystem(data));
    } else if (action === 'submitReviewReply') {
      return jsonResponse(submitReviewReply(data));
    }

    return jsonResponse({
      success: false,
      message: '알 수 없는 액션입니다.'
    });
  } catch (error) {
    Logger.log('doPost Error: ' + (error && error.stack ? error.stack : error));
    return jsonResponse({
      success: false,
      message: error && error.message ? error.message : '요청 처리 중 오류가 발생했습니다.',
    });
  }
}

/**
 * 4. JSON 응답 변환 유틸리티
 */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function encodeFormPayload(data) {
  return Object.keys(data)
    .filter(key => data[key] !== undefined && data[key] !== null && data[key] !== '')
    .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(String(data[key])))
    .join('&');
}
