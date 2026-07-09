/**
 * 7. 주문 접수 및 크레딧/재고 자동 계산 처리
 */
function placeOrder(data) {
  const userId = data.userId;
  const items = data.items;
  const rawIdempotencyKey = normalizeIdempotencyKey(data.idempotencyKey);

  if (!userId || !items || items.length === 0) {
    return {
      success: false,
      message: '주문 정보가 부족합니다.',
    };
  }
  if (rawIdempotencyKey && !isValidIdempotencyKey(rawIdempotencyKey)) {
    return {
      success: false,
      message: '주문 중복 방지 키가 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.',
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

    let nickname = '';
    let currentCredit = 0;
    let userRowIndex = -1;
    const isGuest = (String(userId) === 'guest');
    let guestFee = 0;

    ensureOrderHeaders();
    const headers = getSheetHeaderRow(orderSheet);
    const deviceIdIdx = headers.indexOf('guestDeviceId');
    const authProviderIdx = headers.indexOf('authProvider');
    const guestKeyIdx = headers.indexOf('guestKey');
    const idempotencyIdx = headers.indexOf(ORDER_IDEMPOTENCY_HEADER);
    const existingOrderResult = getExistingIdempotentOrderResult(orderSheet, userSheet, headers, rawIdempotencyKey, userId);
    if (existingOrderResult) {
      return existingOrderResult;
    }

    const snacks = snackSheet.getDataRange().getValues();
    const rawGuestKey = String(data.guestKey || '').trim();
    const authProvider = isGuest && rawGuestKey && String(data.authProvider || '').trim().toLowerCase() === 'kakao' ? 'kakao' : '';
    const guestKey = authProvider === 'kakao' ? rawGuestKey : '';
    let guestSettings = null;

    if (isGuest) {
      guestSettings = getGuestSettings();
      if (!canCompleteStartedGuestOrder(guestSettings, data.orderStartedAt)) {
        return {
          success: false,
          message: guestSettings.guestOpen === 'Y'
            ? '주문 운영 종료 후 완료 가능 시간이 지났습니다.'
            : (guestSettings.message || '게스트 주문이 마감되었습니다.'),
        };
      }

      if (!data.guestDeviceId && !guestKey) {
        return {
          success: false,
          message: '게스트 주문 확인 정보가 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.',
        };
      }

      if (!guestSettings.guestAllowMultipleOrders && (data.guestDeviceId || guestKey)) {
        const orderValues = orderSheet.getDataRange().getValues();
        const servedYnIdx = headers.indexOf('제공여부');
        let hasActiveOrder = false;
        const nowTime = new Date();
        for (let i = 1; i < orderValues.length; i++) {
          const row = orderValues[i];
          const sameDevice = deviceIdIdx !== -1 && data.guestDeviceId && String(row[deviceIdIdx]) === String(data.guestDeviceId);
          const sameGuestKey = guestKeyIdx !== -1 && guestKey && String(row[guestKeyIdx]) === guestKey;
          if (sameDevice || sameGuestKey) {
            const orderTime = row[0];
            const status = String(row[servedYnIdx !== -1 ? servedYnIdx : 8]).trim();
            if (isSameKoreaDate(orderTime, nowTime) && !isClosedOrderStatus(status)) {
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
      currentCredit = guestSettings.guestBaseCredit;
      guestFee = guestSettings.guestDeliveryFee;
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
    const shouldRememberGuestProfile = data.rememberGuestProfile === true || String(data.rememberGuestProfile || '').trim().toUpperCase() === 'Y';

    if (isGuest) {
      const creditStatus = resolveGuestCreditWallet({
        guestDeviceId: data.guestDeviceId || '',
        authProvider,
        guestKey,
      }, {
        settings: guestSettings,
        create: false,
      });
      currentCredit = creditStatus.remainingCredit;
    }

    if (currentCredit < totalCredit) {
      return {
        success: false,
        message: '크레딧이 부족합니다.',
        currentCredit,
        totalPoint: totalCredit,
      };
    }

    const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd');
    const lastOrderRow = orderSheet.getLastRow();
    const todayOrders = lastOrderRow > 1
      ? orderSheet.getRange(2, 1, lastOrderRow - 1, 2).getValues().filter(row => {
          if (!row[0]) return false;
          try {
            const orderDate = Utilities.formatDate(new Date(row[0]), Session.getScriptTimeZone(), 'yyMMdd');
            return orderDate === todayStr;
          } catch (e) {
            return false;
          }
        })
      : [];
    let maxSeq = 0;
    todayOrders.forEach(row => {
      const orderNoStr = String(row[1] || '');
      const parts = orderNoStr.split('-');
      if (parts.length >= 3) {
        const num = Number(parts[2]);
        if (!isNaN(num) && num > maxSeq) {
          maxSeq = num;
        }
      }
    });
    const seq = maxSeq + 1;
    const orderNo = 'ORD-' + todayStr + '-' + String(seq).padStart(3, '0');
    const now = new Date();

    let orderToken = '';
    if (isGuest) {
      const randVal = Math.floor(1000 + Math.random() * 9000);
      orderToken = 'G-' + orderNo + '-' + randVal;
    }

    const orderRows = orderItems.map(item => {
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

      const setOptionalCell = (idx, value) => {
        if (idx === -1) return;
        while (newRow.length <= idx) {
          newRow.push('');
        }
        newRow[idx] = value || '';
      };
      setOptionalCell(deviceIdIdx, data.guestDeviceId || '');
      setOptionalCell(authProviderIdx, authProvider);
      setOptionalCell(guestKeyIdx, guestKey);

      return newRow;
    });

    const maxOrderCols = Math.max(
      orderSheet.getLastColumn(),
      ...orderRows.map(row => row.length)
    );
    const safeOrderRows = orderRows.map(row => {
      const safeRow = row.slice();
      while (safeRow.length < maxOrderCols) {
        safeRow.push('');
      }
      return safeRow;
    });
    const orderStartRow = orderSheet.getLastRow() + 1;
    orderSheet
      .getRange(orderStartRow, 1, safeOrderRows.length, maxOrderCols)
      .setValues(safeOrderRows);
    orderSheet
      .getRange(orderStartRow, 1, safeOrderRows.length, 1)
      .setNumberFormat('yyyy. m. d AM/PM h:mm:ss');

    orderItems.forEach(item => {
      // 간식 재고 차감 반영
      snackSheet
        .getRange(item.snackRowIndex + 1, 6)
        .setValue(item.afterStock);
    });
    clearSnackReadCache();
    clearOrderReadCache();

    // 유저 크레딧 차감 반영
    let newCredit = currentCredit - totalCredit;
    if (!isGuest) {
      userSheet.getRange(userRowIndex + 1, 3).setValue(newCredit);
    } else {
      const walletUpdate = resolveGuestCreditWallet({
        guestDeviceId: data.guestDeviceId || '',
        authProvider,
        guestKey,
      }, {
        settings: guestSettings,
        spendCredit: totalCredit,
        create: true,
      });
      if (!walletUpdate.success) {
        throw new Error(walletUpdate.message || '게스트 크레딧을 업데이트하지 못했습니다.');
      }
      newCredit = walletUpdate.remainingCredit;
    }

    if (isGuest && authProvider === 'kakao' && guestKey && shouldRememberGuestProfile) {
      try {
        upsertGuestProfile(guestKey, data.guestName || '', deliveryPlace);
      } catch (profileError) {
        Logger.log('Guest profile save failed: ' + (profileError && profileError.stack ? profileError.stack : profileError));
      }
    }

    if (rawIdempotencyKey && idempotencyIdx !== -1) {
      try {
        orderSheet
          .getRange(orderStartRow, idempotencyIdx + 1, safeOrderRows.length, 1)
          .setValues(safeOrderRows.map(() => [rawIdempotencyKey]));
      } catch (idempotencyError) {
        Logger.log('idempotency key write failed after order success: ' + (idempotencyError && idempotencyError.stack ? idempotencyError.stack : idempotencyError));
      }
    }

    clearOrderReadCache();
    return {
      success: true,
      message: '주문이 완료되었습니다.',
      orderNo,
      orderToken,
      nickname,
      totalPoint: totalCredit,
      beforeCredit: currentCredit,
      afterCredit: newCredit,
      bonusCredit: isGuest && authProvider === 'kakao' ? getKakaoGuestBonusCredit(guestSettings) : 0,
      idempotencyKey: rawIdempotencyKey,
      items: orderItems,
    };
  } catch (error) {
    return {
      success: false,
      message: error.message || '주문 처리 중 오류가 발생했습니다.'
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 8. 오늘 접수된 주문 내역 조회
 */
const ORDER_READ_CACHE_KEY = 'orders.readValues.v1';
const ORDER_READ_CACHE_TTL_SECONDS = 2;

function getOrderValuesForRead(orderSheet) {
  try {
    const cached = CacheService.getScriptCache().get(ORDER_READ_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (error) {
    Logger.log('order read cache read failed: ' + (error && error.stack ? error.stack : error));
  }

  const values = orderSheet.getDataRange().getValues();
  try {
    CacheService
      .getScriptCache()
      .put(ORDER_READ_CACHE_KEY, JSON.stringify(values), ORDER_READ_CACHE_TTL_SECONDS);
  } catch (error) {
    Logger.log('order read cache write failed: ' + (error && error.stack ? error.stack : error));
  }
  return values;
}

function clearOrderReadCache() {
  try {
    CacheService.getScriptCache().remove(ORDER_READ_CACHE_KEY);
  } catch (error) {
    Logger.log('order read cache clear failed: ' + (error && error.stack ? error.stack : error));
  }
}

function getOrdersToday() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET.ORDERS);
  const values = getOrderValuesForRead(sheet);
  const headers = values[0] || [];
  const rows = values.slice(1);

  const reviewedIdx = headers.indexOf('reviewed');
  const rIdx = reviewedIdx !== -1 ? reviewedIdx : 14;
  const authProviderIdx = headers.indexOf('authProvider');
  const guestKeyIdx = headers.indexOf('guestKey');

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
      orderToken: '', // 보안을 위해 공개 API에서는 토큰 노출 제외
      deliveryType: row[11] || 'pickup',
      deliveryFee: Number(row[12] || 0),
      totalCredit: Number(row[13] || 0),
      reviewed: row[14] === true || String(row[14]).toUpperCase() === 'TRUE' || String(row[14]).toUpperCase() === 'Y',
      deliveryPlace: row[15] || '',
      authProvider: authProviderIdx !== -1 ? row[authProviderIdx] || '' : '',
      guestKey: guestKeyIdx !== -1 ? row[guestKeyIdx] || '' : '',
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

  const values = getOrderValuesForRead(sheet);
  const headers = values[0] || [];
  const rows = values.slice(1);

  const reviewedIdx = headers.indexOf('reviewed');
  const authProviderIdx = headers.indexOf('authProvider');
  const guestKeyIdx = headers.indexOf('guestKey');

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
    orderToken: '', // 보안을 위해 공개 API에서는 토큰 노출 제외
    servedYn: servedYn,
    cancelTimestamp: cancelTimestamp,
    deliveryType: firstRow[11] || 'pickup',
    deliveryFee: Number(firstRow[12] || 0),
    totalCredit: Number(firstRow[13] || 0),
    reviewed: isReviewed,
    deliveryPlace: firstRow[15] || '',
    authProvider: authProviderIdx !== -1 ? firstRow[authProviderIdx] || '' : '',
    guestKey: guestKeyIdx !== -1 ? firstRow[guestKeyIdx] || '' : '',
    cancelReason: firstRow[16] || '',
    cancelReasonDetail: firstRow[17] || ''
  };
}

/**
 * 8.6. 게스트 본인의 오늘 주문 목록만 조회 API (보안을 위해 전체가 아닌 검색어 매칭만 반환)
 */
function getGuestOrdersToday(guestName) {
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

  const values = getOrderValuesForRead(sheet);
  const headers = values[0] || [];
  const rows = values.slice(1);

  const reviewedIdx = headers.indexOf('reviewed');
  const rIdx = reviewedIdx !== -1 ? reviewedIdx : 14;
  const authProviderIdx = headers.indexOf('authProvider');
  const guestKeyIdx = headers.indexOf('guestKey');

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
      orderToken: '', // 보안을 위해 공개 API에서는 토큰 노출 제외
      deliveryType: row[11] || 'pickup',
      deliveryFee: Number(row[12] || 0),
      totalCredit: Number(row[13] || 0),
      reviewed: row[14] === true || String(row[14]).toUpperCase() === 'TRUE' || String(row[14]).toUpperCase() === 'Y',
      deliveryPlace: row[15] || '',
      authProvider: authProviderIdx !== -1 ? row[authProviderIdx] || '' : '',
      guestKey: guestKeyIdx !== -1 ? row[guestKeyIdx] || '' : '',
      cancelReason: row[16] || '',
      cancelReasonDetail: row[17] || ''
    }));

  return {
    success: true,
    orders,
  };
}

/**
 * 8.7. 게스트 본인의 주문 토큰 목록으로 조회 API
 */
function getGuestOrderByToken(data) {
  const tokens = data.tokens;
  if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
    return {
      success: false,
      message: '조회할 토큰이 없습니다.'
    };
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET.ORDERS);
  if (!sheet) {
    return {
      success: false,
      message: '주문내역 시트를 찾을 수 없습니다.'
    };
  }

  const values = getOrderValuesForRead(sheet);
  const headers = values[0] || [];
  const rows = values.slice(1);

  const reviewedIdx = headers.indexOf('reviewed');
  const tokenIdx = headers.indexOf('orderToken');
  const authProviderIdx = headers.indexOf('authProvider');
  const guestKeyIdx = headers.indexOf('guestKey');
  const rIdx = reviewedIdx !== -1 ? reviewedIdx : 14;
  const tIdx = tokenIdx !== -1 ? tokenIdx : 10;

  const orders = rows
    .filter(row => {
      const rowToken = String(row[tIdx] || '');
      return rowToken && tokens.includes(rowToken);
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
      reviewed: row[rIdx] === true || String(row[rIdx]).toUpperCase() === 'TRUE' || String(row[rIdx]).toUpperCase() === 'Y',
      deliveryPlace: row[15] || '',
      authProvider: authProviderIdx !== -1 ? row[authProviderIdx] || '' : '',
      guestKey: guestKeyIdx !== -1 ? row[guestKeyIdx] || '' : '',
      cancelReason: row[16] || '',
      cancelReasonDetail: row[17] || ''
    }));

  return {
    success: true,
    orders,
  };
}

/**
 * 8.8. 카카오 연결 게스트의 오늘 주문 조회 API
 * 원본 카카오 ID가 아닌 내부 guestKey 기준으로 오늘 주문만 반환합니다.
 */
function getGuestOrdersByGuestKey(data) {
  const authProvider = String(data.authProvider || '').trim().toLowerCase();
  const guestKey = String(data.guestKey || '').trim();
  if (authProvider !== 'kakao' || !guestKey) {
    return {
      success: false,
      message: '카카오 연결 정보가 누락되었습니다.'
    };
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET.ORDERS);
  if (!sheet) {
    return {
      success: false,
      message: '주문내역 시트를 찾을 수 없습니다.'
    };
  }

  const values = getOrderValuesForRead(sheet);
  const headers = values[0] || [];
  const rows = values.slice(1);

  const reviewedIdx = headers.indexOf('reviewed');
  const authProviderIdx = headers.indexOf('authProvider');
  const guestKeyIdx = headers.indexOf('guestKey');
  const rIdx = reviewedIdx !== -1 ? reviewedIdx : 14;

  if (authProviderIdx === -1 || guestKeyIdx === -1) {
    return {
      success: true,
      orders: []
    };
  }

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
      if (orderDate !== today) return false;
      if (String(row[2]) !== 'guest') return false;
      if (String(row[authProviderIdx] || '').trim().toLowerCase() !== authProvider) return false;
      return String(row[guestKeyIdx] || '').trim() === guestKey;
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
      reviewed: row[rIdx] === true || String(row[rIdx]).toUpperCase() === 'TRUE' || String(row[rIdx]).toUpperCase() === 'Y',
      deliveryPlace: row[15] || '',
      authProvider: row[authProviderIdx] || '',
      guestKey: row[guestKeyIdx] || '',
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

    if (!orderSheet) {
      return {
        success: false,
        message: '주문내역 시트를 찾을 수 없습니다.'
      };
    }

    const lastRow = orderSheet.getLastRow();
    if (lastRow <= 1) {
      return {
        success: false,
        message: `주문번호 ${orderId}에 해당하는 기록을 찾을 수 없습니다.`
      };
    }

    const values = orderSheet.getRange(2, 2, lastRow - 1, 8).getValues(); // B:I
    let updatedCount = 0;

    for (let i = 0; i < values.length; i++) {
      const rowOrderId = String(values[i][0]);
      if (rowOrderId === String(orderId)) {
        const beforeServedYn = values[i][7] || 'N';
        orderSheet.getRange(i + 2, 9).setValue(servedYn); // I열 (9번째) 제공여부 수정
        updatedCount++;
        if (updatedCount === 1) {
          safeAppendAdminLog('updateOrderServed', 'order', orderId, values[i][2], beforeServedYn, servedYn, data.adminMemo);
        }
      }
    }

    if (updatedCount > 0) {
      clearOrderReadCache();
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
  } finally {
    lock.releaseLock();
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
    const headers = orderValues[0] || [];
    const userValues = userSheet.getDataRange().getValues();
    const snackValues = snackSheet.getDataRange().getValues();

    // 시트의 최대 열 수가 부족할 경우 18개(A~R)로 보장
    if (orderSheet.getMaxColumns() < 18) {
      orderSheet.insertColumnsAfter(orderSheet.getMaxColumns(), 18 - orderSheet.getMaxColumns());
    }

    let updatedCount = 0;
    let refundLogs = [];
    let guestCreditRefund = null;

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

        if (userId === 'guest' && !guestCreditRefund) {
          guestCreditRefund = {
            orderTime: orderValues[i][0],
            guestDeviceId: headers.indexOf('guestDeviceId') !== -1 ? orderValues[i][headers.indexOf('guestDeviceId')] || '' : '',
            authProvider: headers.indexOf('authProvider') !== -1 ? orderValues[i][headers.indexOf('authProvider')] || '' : '',
            guestKey: headers.indexOf('guestKey') !== -1 ? orderValues[i][headers.indexOf('guestKey')] || '' : '',
            refundCredit: Number(orderValues[i][13] || point || 0),
          };
        }

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
          safeAppendAdminLog('cancelOrder', 'order', orderId, nickname, servedYn, 'C', data.adminMemo || '주문 취소 및 환불');
        }
      }
    }

    if (updatedCount > 0) {
      if (guestCreditRefund && guestCreditRefund.refundCredit > 0) {
        try {
          resolveGuestCreditWallet(guestCreditRefund, {
            periodKey: getGuestCreditPeriodKey(guestCreditRefund.orderTime || new Date()),
            refundCredit: guestCreditRefund.refundCredit,
            create: true,
          });
        } catch (walletError) {
          Logger.log('Guest credit refund failed: ' + (walletError && walletError.stack ? walletError.stack : walletError));
        }
      }
      clearSnackReadCache();
      clearOrderReadCache();
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
  const requestToken = data.orderToken;

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
    const headers = orderValues[0] || [];
    const userValues = userSheet.getDataRange().getValues();
    const snackValues = snackSheet.getDataRange().getValues();

    if (orderSheet.getMaxColumns() < 18) {
      orderSheet.insertColumnsAfter(orderSheet.getMaxColumns(), 18 - orderSheet.getMaxColumns());
    }

    let updatedCount = 0;
    let refundLogs = [];
    let isAlreadyStarted = false;
    let guestCreditRefund = null;

    for (let i = 1; i < orderValues.length; i++) {
      const rowOrderId = String(orderValues[i][1]); // B열: orderNo
      const rowOrderToken = String(orderValues[i][10] || ''); // K열: orderToken
      const servedYn = orderValues[i][8] || 'N';

      // orderId가 orderNo(회원) 또는 orderToken(게스트)와 일치하는 경우
      if (rowOrderId === String(orderId) || rowOrderToken === String(orderId)) {

        // 게스트 주문이고 시트에 토큰이 있는 경우, 요청 토큰 검증 필수
        if (rowOrderToken) {
          if (!requestToken || rowOrderToken !== String(requestToken)) {
            return { success: false, message: '주문 확인 정보(토큰)가 일치하지 않거나 누락되었습니다.' };
          }
        }

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

        if (userId === 'guest' && !guestCreditRefund) {
          guestCreditRefund = {
            orderTime: orderValues[i][0],
            guestDeviceId: headers.indexOf('guestDeviceId') !== -1 ? orderValues[i][headers.indexOf('guestDeviceId')] || '' : '',
            authProvider: headers.indexOf('authProvider') !== -1 ? orderValues[i][headers.indexOf('authProvider')] || '' : '',
            guestKey: headers.indexOf('guestKey') !== -1 ? orderValues[i][headers.indexOf('guestKey')] || '' : '',
            refundCredit: Number(orderValues[i][13] || point || 0),
          };
        }

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
      if (guestCreditRefund && guestCreditRefund.refundCredit > 0) {
        try {
          resolveGuestCreditWallet(guestCreditRefund, {
            periodKey: getGuestCreditPeriodKey(guestCreditRefund.orderTime || new Date()),
            refundCredit: guestCreditRefund.refundCredit,
            create: true,
          });
        } catch (walletError) {
          Logger.log('Guest credit refund failed: ' + (walletError && walletError.stack ? walletError.stack : walletError));
        }
      }
      clearSnackReadCache();
      clearOrderReadCache();
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

    safeAppendAdminLog('archiveOldOrders', 'orders', 'archive', '지난 주문 보관', '', `${rowsToArchive.length}건 보관 완료`, memo);

    clearOrderReadCache();
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
 * S: guestDeviceId
 * T: authProvider
 * U: guestKey
 * W: idempotencyKey
 */
function ensureOrderHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const orderSheet = ss.getSheetByName(SHEET.ORDERS);
  if (!orderSheet) return;

  const REQUIRED_COLS = ORDER_IDEMPOTENCY_COL;
  if (orderSheet.getMaxColumns() < REQUIRED_COLS) {
    orderSheet.insertColumnsAfter(orderSheet.getMaxColumns(), REQUIRED_COLS - orderSheet.getMaxColumns());
  }

  const currentHeaders = getSheetHeaderRow(orderSheet);
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

  if (headers.indexOf('authProvider') === -1) {
    headers.push('authProvider');
    modified = true;
  }

  if (headers.indexOf('guestKey') === -1) {
    headers.push('guestKey');
    modified = true;
  }

  if (modified) {
    if (orderSheet.getMaxColumns() < headers.length) {
      orderSheet.insertColumnsAfter(orderSheet.getMaxColumns(), headers.length - orderSheet.getMaxColumns());
    }
    orderSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    clearOrderReadCache();
  }

  const latestHeaders = getSheetHeaderRow(orderSheet);
  if (latestHeaders.indexOf(ORDER_IDEMPOTENCY_HEADER) === -1) {
    orderSheet.getRange(1, ORDER_IDEMPOTENCY_COL).setValue(ORDER_IDEMPOTENCY_HEADER);
    clearOrderReadCache();
  }
  return '헤더 보정이 완료되었습니다.';
}
