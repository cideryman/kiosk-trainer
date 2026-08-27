/**
 * 7. 주문 접수 및 크레딧/재고 자동 계산 처리
 */
function createOrderSecurityToken_() {
  return 'O-' + Utilities.getUuid().replace(/-/g, '');
}

function createOrderPerformanceState_(data) {
  if (String(data && data.perfDebug || '').trim() !== '1') return null;
  return {
    startedAt: Date.now(),
    timings: {
      lockWait: 0,
      ordersRead: 0,
      snacksRead: 0,
      userOrGuestRead: 0,
      validation: 0,
      orderWrite: 0,
      stockWrite: 0,
      walletWrite: 0,
      commitWrite: 0,
      profileWrite: 0,
      emailQueue: 0
    }
  };
}

function measureOrderPerformanceStep_(state, name, callback) {
  if (!state) return callback();
  const startedAt = Date.now();
  try {
    return callback();
  } finally {
    state.timings[name] = Number(state.timings[name] || 0) + (Date.now() - startedAt);
  }
}

function recordOrderPerformanceDuration_(state, name, startedAt) {
  if (!state) return;
  state.timings[name] = Number(state.timings[name] || 0) + (Date.now() - startedAt);
}

function finishOrderPerformanceResponse_(response, state) {
  if (!state) return response;
  state.timings.total = Date.now() - state.startedAt;
  response._timings = state.timings;
  return response;
}

function placeOrder(data) {
  data = data || {};
  const performanceState = createOrderPerformanceState_(data);
  const respond = response => finishOrderPerformanceResponse_(response, performanceState);
  const initialValidationStartedAt = Date.now();
  const userId = data.userId;
  const items = data.items;
  const rawIdempotencyKey = normalizeIdempotencyKey(data.idempotencyKey);

  if (!userId || !Array.isArray(items) || items.length === 0) {
    return respond({
      success: false,
      message: '주문 정보가 부족합니다.',
    });
  }
  if (!isValidIdempotencyKey(rawIdempotencyKey)) {
    return respond({
      success: false,
      message: '주문 중복 방지 키가 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.',
    });
  }

  // 클라이언트가 같은 간식을 여러 항목으로 나누어 보내도 서버에서 하나로 합산한다.
  // 이 합산 결과를 기준으로 재고·1인 제한·차감 포인트를 검증해야 우회가 없다.
  const normalizedItems = [];
  const itemIndexBySnackId = {};
  for (let i = 0; i < items.length; i++) {
    const item = items[i] || {};
    const snackIdKey = String(item.snackId == null ? '' : item.snackId).trim();
    const quantity = Number(item.quantity);
    if (!snackIdKey || !Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
      return respond({
        success: false,
        message: '주문 간식 수량이 올바르지 않습니다.',
      });
    }

    if (Object.prototype.hasOwnProperty.call(itemIndexBySnackId, snackIdKey)) {
      normalizedItems[itemIndexBySnackId[snackIdKey]].quantity += quantity;
    } else {
      itemIndexBySnackId[snackIdKey] = normalizedItems.length;
      normalizedItems.push({ snackId: item.snackId, quantity });
    }
  }

  recordOrderPerformanceDuration_(performanceState, 'validation', initialValidationStartedAt);

  const lock = LockService.getScriptLock();
  const lockStartedAt = Date.now();
  if (!lock.tryLock(10000)) {
    recordOrderPerformanceDuration_(performanceState, 'lockWait', lockStartedAt);
    return respond({
      success: false,
      message: '다른 주문을 처리 중입니다. 잠시 후 다시 시도해 주세요.',
    });
  }
  recordOrderPerformanceDuration_(performanceState, 'lockWait', lockStartedAt);

  let transaction = null;
  let committedResponse = null;
  let notificationContext = null;
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

    if (!userSheet || !snackSheet || !orderSheet) {
      throw new Error('주문 처리에 필요한 시트를 찾을 수 없습니다.');
    }
    const orderValues = measureOrderPerformanceStep_(performanceState, 'ordersRead', () => (
      orderSheet.getDataRange().getValues()
    ));
    const headers = orderValues[0] || [];
    const orderRowsSnapshot = orderValues.slice(1);
    const deviceIdIdx = headers.indexOf('guestDeviceId');
    const authProviderIdx = headers.indexOf('authProvider');
    const guestKeyIdx = headers.indexOf('guestKey');
    const idempotencyIdx = headers.indexOf(ORDER_IDEMPOTENCY_HEADER);
    const commitStatusIdx = headers.indexOf(ORDER_COMMIT_STATUS_HEADER);
    if (idempotencyIdx === -1 || commitStatusIdx === -1) {
      throw new Error('주문 시트 초기화가 필요합니다. ensureOrderHeaders를 실행해 주세요.');
    }
    const existingOrderResult = getExistingIdempotentOrderResult(
      orderSheet,
      userSheet,
      headers,
      rawIdempotencyKey,
      userId,
      orderRowsSnapshot
    );
    if (existingOrderResult) {
      return respond(existingOrderResult);
    }

    const snacks = measureOrderPerformanceStep_(performanceState, 'snacksRead', () => (
      snackSheet.getDataRange().getValues()
    ));
    const rawGuestKey = String(data.guestKey || '').trim();
    const authProvider = isGuest && rawGuestKey && String(data.authProvider || '').trim().toLowerCase() === 'kakao' ? 'kakao' : '';
    const guestKey = authProvider === 'kakao' ? rawGuestKey : '';
    let guestSettings = null;

    if (isGuest) {
      guestSettings = measureOrderPerformanceStep_(performanceState, 'userOrGuestRead', () => getGuestSettings());
      if (!canCompleteStartedGuestOrder(guestSettings, data.orderStartedAt)) {
        return respond({
          success: false,
          message: guestSettings.guestCompletionGraceCloseAt
            ? '주문 운영 종료 후 완료 가능 시간이 지났습니다.'
            : (guestSettings.message || '게스트 주문이 마감되었습니다.'),
        });
      }

      if (!data.guestDeviceId && !guestKey) {
        return respond({
          success: false,
          message: '게스트 주문 확인 정보가 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.',
        });
      }

      if (!guestSettings.guestAllowMultipleOrders && (data.guestDeviceId || guestKey)) {
        const servedYnIdx = headers.indexOf('제공여부');
        let hasActiveOrder = false;
        const nowTime = new Date();
        for (let i = 0; i < orderRowsSnapshot.length; i++) {
          const row = orderRowsSnapshot[i];
          if (!isCommittedOrderRow(row, headers)) continue;
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
          return respond({
            success: false,
            message: '현재 진행 중인 주문이 있습니다. 주문 완료 후 다시 주문해주세요.'
          });
        }
      }

      nickname = (data.guestName || '게스트') + ' (비회원)';
      currentCredit = guestSettings.guestBaseCredit;
      guestFee = guestSettings.guestDeliveryFee;
    } else {
      const users = measureOrderPerformanceStep_(performanceState, 'userOrGuestRead', () => (
        getUserValuesForRead(userSheet)
      ));
      userRowIndex = users.findIndex((row, index) => {
        return index > 0 && String(row[0]) === String(userId);
      });

      if (userRowIndex === -1) {
        return respond({
          success: false,
          message: '이용자를 찾을 수 없습니다.',
        });
      }

      nickname = users[userRowIndex][1];
      currentCredit = Number(users[userRowIndex][2]);
    }

    const orderValidationStartedAt = Date.now();
    let totalPoint = 0;
    const orderItems = [];
    const todayCountsMap = getUserTodaySnackCountsMap(
      guestKey,
      data.guestDeviceId,
      userId,
      orderRowsSnapshot,
      headers
    );

    normalizedItems.forEach(item => {
      const snackRowIndex = snacks.findIndex((row, index) => {
        return index > 0 && String(row[0]) === String(item.snackId);
      });

      if (snackRowIndex === -1) {
        throw createPublicApiError('선택한 간식을 찾을 수 없습니다.', 'NOT_FOUND');
      }

      const snack = snacks[snackRowIndex];

      const snackId = snack[0];
      const snackName = snack[1];
      const point = Number(snack[2]);
      const quantity = Number(item.quantity);
      const stock = Number(snack[5] || 0);

      const mode = isGuest ? 'guest' : 'user';
      if (!canOrderSnack(snack, mode)) {
        throw createPublicApiError(`'${snackName}' 은(는) 현재 주문할 수 없는 간식입니다.`, 'CONFLICT');
      }

      if (stock < quantity) {
        throw createPublicApiError(`${snackName} 재고가 부족합니다. 현재 재고: ${stock}개`, 'CONFLICT');
      }

      const maxPerPerson = Number(snack[8] || 0);
      if (maxPerPerson > 0) {
        const alreadyOrderedCount = Number(todayCountsMap[snackId] || 0);
        if (alreadyOrderedCount + quantity > maxPerPerson) {
          if (alreadyOrderedCount > 0) {
            throw createPublicApiError(`추가 주문 불가: '${snackName}'`, 'CONFLICT');
          } else {
            throw createPublicApiError(`주문 수량 초과: '${snackName}' 1인 ${maxPerPerson}개`, 'CONFLICT');
          }
        }
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
    recordOrderPerformanceDuration_(performanceState, 'validation', orderValidationStartedAt);

    if (isGuest) {
      const creditStatus = measureOrderPerformanceStep_(performanceState, 'userOrGuestRead', () => (
        resolveGuestCreditWallet({
          guestDeviceId: data.guestDeviceId || '',
          authProvider,
          guestKey,
        }, {
          settings: guestSettings,
          create: false,
        })
      ));
      currentCredit = creditStatus.remainingCredit;
    }

    const creditState = getOrderCreditState(isGuest, currentCredit, totalCredit);
    if (!creditState.canOrder) {
      return respond({
        success: false,
        message: isGuest ? '온기가 부족합니다.' : '1회 주문 한도를 넘었습니다.',
        currentCredit,
        totalPoint: totalCredit,
      });
    }

    const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd');
    const todayOrders = orderRowsSnapshot.length > 0
      ? orderRowsSnapshot.filter(row => {
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

    const orderToken = createOrderSecurityToken_();

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
      setOptionalCell(idempotencyIdx, rawIdempotencyKey);
      setOptionalCell(commitStatusIdx, 'PENDING');

      return newRow;
    });

    const maxOrderCols = Math.max(
      orderSheet.getLastColumn(),
      commitStatusIdx + 1,
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
    measureOrderPerformanceStep_(performanceState, 'orderWrite', () => {
      orderSheet
        .getRange(orderStartRow, 1, safeOrderRows.length, maxOrderCols)
        .setValues(safeOrderRows);
    });
    const stockValuesBefore = snacks.slice(1).map(row => [row[5]]);
    transaction = {
      orderSheet,
      orderStartRow,
      orderRowCount: safeOrderRows.length,
      commitStatusIdx,
      snackSheet,
      stockValuesBefore,
      stockApplied: false,
      creditApplied: false,
      committed: false,
      isGuest,
      userSheet,
      userRowIndex,
      currentCredit,
      totalCredit,
      guestSettings,
      guestDeviceId: data.guestDeviceId || '',
      authProvider,
      guestKey,
      orderNo,
      idempotencyKey: rawIdempotencyKey
    };
    throwStagingOrderFailure(data, 'order');
    measureOrderPerformanceStep_(performanceState, 'orderWrite', () => {
      orderSheet
        .getRange(orderStartRow, 1, safeOrderRows.length, 1)
        .setNumberFormat('yyyy. m. d AM/PM h:mm:ss');
    });

    orderItems.forEach(item => { snacks[item.snackRowIndex][5] = item.afterStock; });
    measureOrderPerformanceStep_(performanceState, 'stockWrite', () => {
      snackSheet
        .getRange(2, 6, snacks.length - 1, 1)
        .setValues(snacks.slice(1).map(row => [row[5]]));
    });
    transaction.stockApplied = true;
    throwStagingOrderFailure(data, 'stock');
    clearSnackReadCache();
    clearOrderReadCache();

    // 일반 키오스크는 이용자별 값을 1회 주문 한도로 사용하므로 영구 차감하지 않는다.
    let newCredit = creditState.afterCredit;
    if (isGuest) {
      const walletUpdate = measureOrderPerformanceStep_(performanceState, 'walletWrite', () => (
        resolveGuestCreditWallet({
          guestDeviceId: data.guestDeviceId || '',
          authProvider,
          guestKey,
        }, {
          settings: guestSettings,
          spendCredit: totalCredit,
          create: true,
        })
      ));
      if (!walletUpdate.success) {
        throw new Error(walletUpdate.message || '게스트 온기를 업데이트하지 못했습니다.');
      }
      newCredit = walletUpdate.remainingCredit;
      transaction.creditApplied = true;
    }
    throwStagingOrderFailure(data, 'credit');

    if (isGuest && authProvider === 'kakao' && guestKey && shouldRememberGuestProfile) {
      try {
        measureOrderPerformanceStep_(performanceState, 'profileWrite', () => (
          upsertGuestProfile(guestKey, data.guestName || '', deliveryPlace)
        ));
      } catch (profileError) {
        Logger.log('Guest profile save failed: ' + (profileError && profileError.stack ? profileError.stack : profileError));
      }
    }

    measureOrderPerformanceStep_(performanceState, 'commitWrite', () => {
      orderSheet
        .getRange(orderStartRow, commitStatusIdx + 1, safeOrderRows.length, 1)
        .setValues(safeOrderRows.map(() => ['COMMITTED']));
    });
    transaction.committed = true;

    clearOrderReadCache();

    if (shouldEnqueueOrderNotification(isGuest, guestSettings)) {
      notificationContext = {
        orderNo: orderNo,
        nickname: nickname,
        deliveryType: deliveryType,
        deliveryPlace: deliveryPlace,
        items: orderItems,
        totalPoint: totalCredit,
        timestamp: now.getTime(),
      };
    }

    committedResponse = {
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
    if (transaction && !transaction.committed) {
      try {
        if (transaction.creditApplied && transaction.isGuest) {
          resolveGuestCreditWallet({
            guestDeviceId: transaction.guestDeviceId,
            authProvider: transaction.authProvider,
            guestKey: transaction.guestKey
          }, {
            settings: transaction.guestSettings,
            refundCredit: transaction.totalCredit,
            create: true
          });
        }
      } catch (creditRollbackError) {
        Logger.log('주문 온기 롤백 실패: ' + (creditRollbackError && creditRollbackError.stack ? creditRollbackError.stack : creditRollbackError));
      }
      try {
        if (transaction.stockApplied && transaction.stockValuesBefore.length > 0) {
          transaction.snackSheet
            .getRange(2, 6, transaction.stockValuesBefore.length, 1)
            .setValues(transaction.stockValuesBefore);
        }
      } catch (stockRollbackError) {
        Logger.log('주문 재고 롤백 실패: ' + (stockRollbackError && stockRollbackError.stack ? stockRollbackError.stack : stockRollbackError));
      }
      try {
        transaction.orderSheet
          .getRange(transaction.orderStartRow, transaction.commitStatusIdx + 1, transaction.orderRowCount, 1)
          .setValues(Array.from({ length: transaction.orderRowCount }, () => ['FAILED']));
      } catch (statusRollbackError) {
        Logger.log('주문 실패 상태 기록 실패: ' + (statusRollbackError && statusRollbackError.stack ? statusRollbackError.stack : statusRollbackError));
      }
      clearSnackReadCache();
      clearUserReadCache();
      clearOrderReadCache();
    }
    Logger.log('placeOrder failed: ' + JSON.stringify({
      orderNo: transaction ? transaction.orderNo : '',
      stage: transaction
        ? (transaction.creditApplied ? 'credit' : (transaction.stockApplied ? 'stock' : 'order'))
        : 'validation'
    }));
    return respond(getSafeApiErrorResponse('placeOrder', error));
  } finally {
    lock.releaseLock();
  }

  if (notificationContext) {
    measureOrderPerformanceStep_(performanceState, 'emailQueue', () => (
      enqueueOrderNotification(notificationContext, { uniqueCommittedOrder: true })
    ));
  }
  return respond(committedResponse);
}

function throwStagingOrderFailure(data, stage) {
  const requestedStage = String(data && data.testFailureStage || '').trim().toLowerCase();
  if (!requestedStage || requestedStage !== stage) return;
  const environment = String(
    PropertiesService.getScriptProperties().getProperty('APP_ENV') || ''
  ).trim().toLowerCase();
  if (environment === 'staging') {
    throw new Error('STAGING_ORDER_FAILURE_' + stage.toUpperCase());
  }
}

function isOrderEmailNotificationEnabled(knownGuestSettings) {
  if (knownGuestSettings) {
    return knownGuestSettings.adminOrderEmailNotificationEnabled !== false;
  }

  try {
    const settings = getGuestSettings();
    return settings.adminOrderEmailNotificationEnabled !== false;
  } catch (error) {
    Logger.log('주문 알림 설정 조회 실패, 기본값 ON 적용: ' + (error && error.stack ? error.stack : error));
    return true;
  }
}

function shouldEnqueueOrderNotification(isGuest, knownGuestSettings) {
  if (isGuest !== true) return false;
  return isOrderEmailNotificationEnabled(knownGuestSettings);
}

/**
 * 8. 오늘 접수된 주문 내역 조회
 */
const ORDER_READ_CACHE_KEY = 'orders.readValues.v1';
const ORDER_READ_CACHE_TTL_SECONDS = 60;

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
  const rows = values.slice(1).filter(row => (
    row.some(value => value !== '') && isCommittedOrderRow(row, headers)
  ));

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
    orderSheetRowCount: rows.length,
  };
}

/**
 * 호출판과 키오스크에서 사용하는 공개 주문 현황입니다.
 * 내부 식별자, 온기, 배달지, 게스트 인증 정보는 반환하지 않습니다.
 */
function getPublicOrderFeed() {
  const result = getOrdersToday();
  if (!result || result.success === false) return result;

  return {
    success: true,
    orders: (result.orders || []).map(order => ({
      timestamp: order.timestamp,
      orderNo: order.orderNo,
      nickname: order.nickname,
      snackName: order.snackName,
      quantity: order.quantity,
      servedYn: order.servedYn,
      deliveryType: order.deliveryType,
      isKakao: order.authProvider === 'kakao',
      cancelTimestamp: order.cancelTimestamp,
      cancelReason: order.cancelReason
    }))
  };
}

/**
 * 8.5. 특정 주문의 진행 상태 단일 조회 API
 */
function getOrderStatus(data) {
  const orderToken = String(data && data.orderToken || '').trim();
  const ownership = verifyOrderOwnership_({ orderToken: orderToken }, {
    requireOrderId: false,
    includeArchived: false
  });
  if (!ownership.success) return ownership;

  const headers = ownership.headers;
  const firstRow = ownership.matched[0].row;
  const servedYnIdx = headers.indexOf('제공여부');
  const cancelTimestampIdx = headers.indexOf('cancelTimestamp');
  const reviewedIdx = headers.indexOf('reviewed');
  const deliveryTypeIdx = headers.indexOf('deliveryType');
  const cancelReasonIdx = headers.indexOf('cancelReason');
  const reviewedValue = reviewedIdx !== -1 ? firstRow[reviewedIdx] : '';
  const isReviewed = reviewedValue === true || String(reviewedValue).toUpperCase() === 'TRUE' || String(reviewedValue).toUpperCase() === 'Y';

  return {
    success: true,
    orderNo: ownership.orderNo,
    servedYn: firstRow[servedYnIdx] || 'N',
    cancelTimestamp: cancelTimestampIdx !== -1 ? firstRow[cancelTimestampIdx] || '' : '',
    deliveryType: deliveryTypeIdx !== -1 ? firstRow[deliveryTypeIdx] || 'pickup' : 'pickup',
    reviewed: isReviewed,
    cancelReason: cancelReasonIdx !== -1 ? firstRow[cancelReasonIdx] || '' : ''
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
      if (!isCommittedOrderRow(row, headers)) return false;
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
  const rawTokens = data ? data.tokens : null;
  const includeArchived = data && (data.includeArchived === true || String(data.includeArchived).toLowerCase() === 'true');

  const tokens = Array.isArray(rawTokens)
    ? Array.from(new Set(rawTokens.map(token => String(token || '').trim()).filter(Boolean)))
    : [];
  if (tokens.length === 0) {
    return {
      success: false,
      message: '조회할 토큰이 없습니다.'
    };
  }

  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET.ORDERS);
  if (!sheet) {
    return {
      success: false,
      message: '주문내역 시트를 찾을 수 없습니다.'
    };
  }

  const values = getOrderValuesForRead(sheet);
  const headers = values[0] || [];
  const reviewedIdx = headers.indexOf('reviewed');
  const tokenIdx = headers.indexOf('orderToken');
  const authProviderIdx = headers.indexOf('authProvider');
  const guestKeyIdx = headers.indexOf('guestKey');
  const rIdx = reviewedIdx !== -1 ? reviewedIdx : 14;
  const tIdx = tokenIdx !== -1 ? tokenIdx : 10;

  const mapRow = (row, hRow) => {
    const revIdx = hRow ? hRow.indexOf('reviewed') : rIdx;
    const tokIdx = hRow ? hRow.indexOf('orderToken') : tIdx;
    const authIdx = hRow ? hRow.indexOf('authProvider') : authProviderIdx;
    const gKeyIdx = hRow ? hRow.indexOf('guestKey') : guestKeyIdx;
    const useRIdx = revIdx !== -1 ? revIdx : 14;
    const useTIdx = tokIdx !== -1 ? tokIdx : 10;

    return {
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
      orderToken: row[useTIdx] != null ? row[useTIdx] : (row[10] || ''),
      deliveryType: row[11] || 'pickup',
      deliveryFee: Number(row[12] || 0),
      totalCredit: Number(row[13] || 0),
      reviewed: row[useRIdx] === true || String(row[useRIdx]).toUpperCase() === 'TRUE' || String(row[useRIdx]).toUpperCase() === 'Y',
      deliveryPlace: row[15] || '',
      authProvider: authIdx !== -1 ? row[authIdx] || '' : '',
      guestKey: gKeyIdx !== -1 ? row[gKeyIdx] || '' : '',
      cancelReason: row[16] || '',
      cancelReasonDetail: row[17] || ''
    };
  };

  let orders = [];
  tokens.forEach(token => {
    const ownership = verifyOrderOwnership_({ orderToken: token }, {
      spreadsheet: ss,
      orderSheet: sheet,
      orderValues: values,
      requireOrderId: false,
      requireGuest: true,
      includeArchived: includeArchived
    });
    if (!ownership.success) return;
    ownership.matched.forEach(item => orders.push(mapRow(item.row, ownership.headers)));
  });

  return {
    success: true,
    orders,
  };
}

/**
 * 8.8. 카카오 연결 게스트의 오늘 (및 필요시 보관) 주문 조회 API
 * 원본 카카오 ID가 아닌 내부 guestKey 기준으로 주문을 반환합니다.
 */
function getGuestOrdersByGuestKey(data) {
  const authProvider = String(data ? data.authProvider : '').trim().toLowerCase();
  const guestKey = String(data ? data.guestKey : '').trim();
  const includeArchived = data && (data.includeArchived === true || String(data.includeArchived).toLowerCase() === 'true');

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

  const mapRow = (row, hRow) => {
    const revIdx = hRow ? hRow.indexOf('reviewed') : rIdx;
    const authIdx = hRow ? hRow.indexOf('authProvider') : authProviderIdx;
    const gKeyIdx = hRow ? hRow.indexOf('guestKey') : guestKeyIdx;
    const tokIdx = hRow ? hRow.indexOf('orderToken') : 10;
    const useRIdx = revIdx !== -1 ? revIdx : 14;
    const useTIdx = tokIdx !== -1 ? tokIdx : 10;

    return {
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
      orderToken: row[useTIdx] || '',
      deliveryType: row[11] || 'pickup',
      deliveryFee: Number(row[12] || 0),
      totalCredit: Number(row[13] || 0),
      reviewed: row[useRIdx] === true || String(row[useRIdx]).toUpperCase() === 'TRUE' || String(row[useRIdx]).toUpperCase() === 'Y',
      deliveryPlace: row[15] || '',
      authProvider: authIdx !== -1 ? row[authIdx] || '' : '',
      guestKey: gKeyIdx !== -1 ? row[gKeyIdx] || '' : '',
      cancelReason: row[16] || '',
      cancelReasonDetail: row[17] || ''
    };
  };

  let orders = rows
    .filter(row => {
      if (!isCommittedOrderRow(row, headers)) return false;
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
    .map(row => mapRow(row, headers));

  if (includeArchived) {
    const archiveSheet = SpreadsheetApp.getActive().getSheetByName(SHEET.ARCHIVE);
    if (archiveSheet && archiveSheet.getLastRow() > 1) {
      const archiveValues = archiveSheet.getDataRange().getValues();
      const archiveHeaders = archiveValues[0] || [];
      const archiveRows = archiveValues.slice(1);
      const aAuthIdx = archiveHeaders.indexOf('authProvider');
      const aGuestKeyIdx = archiveHeaders.indexOf('guestKey');

      if (aAuthIdx !== -1 && aGuestKeyIdx !== -1) {
        const archivedOrders = archiveRows
          .filter(row => {
            if (!isCommittedOrderRow(row, archiveHeaders)) return false;
            if (String(row[2]) !== 'guest') return false;
            if (String(row[aAuthIdx] || '').trim().toLowerCase() !== authProvider) return false;
            return String(row[aGuestKeyIdx] || '').trim() === guestKey;
          })
          .map(row => mapRow(row, archiveHeaders));

        orders = orders.concat(archivedOrders);
      }
    }
  }

  return {
    success: true,
    orders,
  };
}

/**
 * 9. 제공 상태 (servedYn) 변경 API (대기목록 <-> 완료목록 토글)
 */
function getOrderMutationResult_(overrides) {
  return Object.assign({
    success: false,
    verified: false,
    alreadyCancelled: false,
    refundApplied: false,
    restoredItemCount: 0,
    rolledBack: false,
    recoveryRequired: false,
    cleanupRequired: false,
    backupSheetNames: [],
  }, overrides || {});
}

function cleanupOrderMutationBackups_(spreadsheet, backups) {
  const failedNames = [];
  (backups || []).forEach(entry => {
    if (!deleteSheetQuietly_(spreadsheet, entry.backup)) failedNames.push(entry.name);
  });
  return failedNames;
}

function rollbackOrderMutation_(spreadsheet, backups) {
  const errors = [];
  (backups || []).slice().reverse().forEach(entry => {
    try {
      restoreSheetFromBackup_(entry.target, entry.backup);
    } catch (error) {
      errors.push(entry.name + ': ' + error.message);
    }
  });
  if (errors.length > 0) {
    return {
      rolledBack: false,
      recoveryRequired: true,
      cleanupRequired: true,
      backupSheetNames: (backups || []).map(entry => entry.name),
      errors,
    };
  }
  const failedCleanup = cleanupOrderMutationBackups_(spreadsheet, backups);
  return {
    rolledBack: true,
    recoveryRequired: false,
    cleanupRequired: failedCleanup.length > 0,
    backupSheetNames: failedCleanup,
    errors: [],
  };
}

function throwStagingOrderMutationFailure_(data, stage) {
  if (typeof APP_ENV !== 'undefined' && String(APP_ENV).toLowerCase() === 'staging'
      && data && String(data.__testFailStage || '') === String(stage)) {
    throw new Error('테스트용 주문 변경 실패: ' + stage);
  }
}

function getRequiredOrderIndexes_(headers) {
  const names = [
    '주문시간', '주문번호', '이용자ID', '별명', '간식ID', '간식명', '수량',
    '차감포인트', '제공여부', 'cancelTimestamp', 'orderToken', 'totalCredit',
    'cancelReason', 'cancelReasonDetail'
  ];
  const missing = names.filter(name => headers.indexOf(name) === -1);
  if (missing.length > 0) {
    throw new Error('주문내역 필수 헤더가 없습니다: ' + missing.join(', '));
  }
  const result = {};
  names.forEach(name => { result[name] = headers.indexOf(name); });
  result.guestDeviceId = headers.indexOf('guestDeviceId');
  result.authProvider = headers.indexOf('authProvider');
  result.guestKey = headers.indexOf('guestKey');
  return result;
}

function validateSameOrderField_(rows, index, label, normalize) {
  const convert = normalize || (value => String(value == null ? '' : value).trim());
  const first = convert(rows[0].row[index]);
  for (let i = 1; i < rows.length; i++) {
    if (convert(rows[i].row[index]) !== first) {
      throw new Error('동일 주문의 ' + label + ' 값이 서로 달라 작업을 중단했습니다.');
    }
  }
  return first;
}

function updateOrderServed(data) {
  const orderId = String(data && data.orderId || '').trim();
  const servedYn = String(data && data.servedYn || 'Y').trim().toUpperCase();
  if (!orderId) return getOrderMutationResult_({ message: '주문번호(orderId)가 누락되었습니다.' });
  if (['N', 'P', 'R', 'Y'].indexOf(servedYn) === -1) {
    return getOrderMutationResult_({ message: '제공 상태 값이 올바르지 않습니다.' });
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return getOrderMutationResult_({ message: '다른 작업을 처리 중입니다. 잠시 후 다시 시도해 주세요.' });
  }

  let ss = null;
  let backups = [];
  let mutationStarted = false;
  try {
    ss = SpreadsheetApp.getActive();
    const orderSheet = ss.getSheetByName(SHEET.ORDERS);
    if (!orderSheet) throw new Error('주문내역 시트를 찾을 수 없습니다.');
    const before = orderSheet.getDataRange().getValues();
    if (before.length <= 1) throw new Error('해당 주문 기록을 찾을 수 없습니다.');
    const headers = before[0] || [];
    const idx = getRequiredOrderIndexes_(headers);
    const matched = [];
    for (let i = 1; i < before.length; i++) {
      if (String(before[i][idx['주문번호']] || '').trim() === orderId) matched.push({ index: i, row: before[i] });
    }
    if (matched.length === 0) throw new Error('해당 주문 기록을 찾을 수 없습니다.');
    validateSameOrderField_(matched, idx['이용자ID'], '이용자');
    validateSameOrderField_(matched, idx.orderToken, '토큰');
    const totalCredit = validateSameOrderField_(matched, idx.totalCredit, '총 온기', value => {
      if (value === '' || value == null) return NaN;
      return Number(value);
    });
    if (!Number.isFinite(totalCredit) || totalCredit < 0) throw new Error('주문의 총 온기 값이 올바르지 않습니다.');
    if (matched.some(item => isCancelledOrderStatus(item.row[idx['제공여부']]))) {
      throw new Error('취소된 품목이 포함된 주문은 제공 상태를 변경할 수 없습니다.');
    }
    const beforeStatuses = matched.map(item => String(item.row[idx['제공여부']] || 'N').trim().toUpperCase());
    if (beforeStatuses.every(status => status === servedYn)) {
      return getOrderMutationResult_({
        success: true,
        verified: true,
        message: `주문번호 ${orderId}의 모든 품목이 이미 '${servedYn}' 상태입니다.`,
      });
    }

    const backup = createUniqueSheetBackup_(ss, orderSheet, SHEET.ORDERS + '_상태임시백업');
    backups.push({ target: orderSheet, backup: backup.sheet, name: backup.name });
    const after = cloneSheetRows_(before);
    matched.forEach(item => { after[item.index][idx['제공여부']] = servedYn; });
    mutationStarted = true;
    writeChangedSheetRows_(orderSheet, before.slice(1), after.slice(1), 2, headers.length);
    throwStagingOrderMutationFailure_(data, 'served-write');
    if (!verifyExactSheetValues_(orderSheet, after)) throw new Error('제공 상태 저장 결과 검증에 실패했습니다.');
    throwStagingOrderMutationFailure_(data, 'served-verification');
    const failedCleanup = cleanupOrderMutationBackups_(ss, backups);
    if (failedCleanup.length > 0) recordOrderRecoveryAlert_({
      orderNo: orderId, stage: 'SERVED_BACKUP_CLEANUP', cleanupRequired: true, backupSheetNames: failedCleanup,
    });
    clearOrderReadCache();
    safeAppendAdminLog('updateOrderServed', 'order', orderId, matched[0].row[idx['별명']], beforeStatuses.join(','), servedYn, data.adminMemo);
    return getOrderMutationResult_({
      success: true,
      verified: true,
      cleanupRequired: failedCleanup.length > 0,
      backupSheetNames: failedCleanup,
      message: failedCleanup.length > 0
        ? `제공 상태는 저장·검증됐지만 임시 백업 삭제에 실패했습니다: ${failedCleanup.join(', ')}`
        : `주문번호 ${orderId}의 모든 품목을 '${servedYn}' 상태로 업데이트했습니다. (총 ${matched.length}건)`,
    });
  } catch (error) {
    if (!ss || backups.length === 0) return getOrderMutationResult_({ message: error.message });
    if (!mutationStarted) {
      const failedCleanup = cleanupOrderMutationBackups_(ss, backups);
      if (failedCleanup.length > 0) recordOrderRecoveryAlert_({
        orderNo: orderId, stage: 'SERVED_BACKUP_CLEANUP', cleanupRequired: true, backupSheetNames: failedCleanup,
      });
      return getOrderMutationResult_({
        message: error.message,
        cleanupRequired: failedCleanup.length > 0,
        backupSheetNames: failedCleanup,
      });
    }
    const rollback = rollbackOrderMutation_(ss, backups);
    recordOrderRecoveryAlert_({
      orderNo: orderId, stage: 'SERVED_ROLLBACK', recoveryRequired: rollback.recoveryRequired,
      cleanupRequired: rollback.cleanupRequired, backupSheetNames: rollback.backupSheetNames,
    });
    clearOrderReadCache();
    return getOrderMutationResult_(Object.assign({}, rollback, {
      message: rollback.recoveryRequired
        ? `제공 상태 변경 실패(${error.message}) 후 자동 복원도 완료되지 않았습니다. 백업 시트로 수동 복원이 필요합니다: ${rollback.backupSheetNames.join(', ')}`
        : (rollback.cleanupRequired
          ? `제공 상태 변경 실패(${error.message})는 원상복구됐지만 임시 백업 삭제가 필요합니다: ${rollback.backupSheetNames.join(', ')}`
          : `제공 상태 변경에 실패해 모든 품목을 원래 상태로 복구했습니다: ${error.message}`),
    }));
  } finally {
    lock.releaseLock();
  }
}

function cancelOrder(data) {
  return cancelOrderTransaction_(data || {}, false);
}

function userCancelOrder(data) {
  return cancelOrderTransaction_(data || {}, true);
}

function cancelOrderTransaction_(data, isUserCancellation) {
  const orderId = String(data.orderId || '').trim();
  const requestToken = String(data.orderToken || '').trim();
  if (!orderId) return getOrderMutationResult_({ message: '주문 식별자가 누락되었습니다.' });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return getOrderMutationResult_({ message: '다른 작업을 처리 중입니다. 잠시 후 다시 시도해 주세요.' });
  }

  let ss = null;
  let backups = [];
  let mutationStarted = false;
  try {
    ss = SpreadsheetApp.getActive();
    const orderSheet = ss.getSheetByName(SHEET.ORDERS);
    const snackSheet = ss.getSheetByName(SHEET.SNACKS);
    if (!orderSheet || !snackSheet) throw new Error('필요한 시트(주문/간식)를 찾을 수 없습니다.');

    const orderBefore = orderSheet.getDataRange().getValues();
    const snackBefore = snackSheet.getDataRange().getValues();
    if (orderBefore.length <= 1) throw new Error('해당 주문 기록을 찾을 수 없습니다.');
    if (snackBefore.length <= 1) throw new Error('간식목록 데이터가 없습니다.');
    const headers = orderBefore[0] || [];
    const idx = getRequiredOrderIndexes_(headers);

    let canonicalOrderNo = '';
    let matched = [];
    if (isUserCancellation) {
      const ownership = verifyOrderOwnership_({ orderId: orderId, orderToken: requestToken }, {
        spreadsheet: ss,
        orderSheet: orderSheet,
        orderValues: orderBefore,
        requireOrderId: true,
        includeArchived: false
      });
      if (!ownership.success) throw createPublicApiError(ownership.message, ownership.errorCode);
      canonicalOrderNo = ownership.orderNo;
      matched = ownership.matched;
    } else {
      canonicalOrderNo = orderId;
      for (let i = 1; i < orderBefore.length; i++) {
        if (String(orderBefore[i][idx['주문번호']] || '').trim() === canonicalOrderNo) {
          matched.push({ index: i, row: orderBefore[i] });
        }
      }
    }
    if (matched.length === 0) throw new Error('해당 주문 기록을 찾을 수 없습니다.');
    if (!canonicalOrderNo || matched.length === 0) throw new Error('주문번호 구조가 올바르지 않습니다.');

    const userId = validateSameOrderField_(matched, idx['이용자ID'], '이용자');
    const storedToken = validateSameOrderField_(matched, idx.orderToken, '토큰');
    const totalCredit = validateSameOrderField_(matched, idx.totalCredit, '총 온기', value => {
      if (value === '' || value == null) return NaN;
      return Number(value);
    });
    if (!Number.isFinite(totalCredit) || totalCredit < 0) throw new Error('주문의 총 온기 값이 올바르지 않습니다.');
    if (isUserCancellation && (!storedToken || storedToken !== requestToken)) {
      throw createPublicApiError('주문 확인 정보(토큰)가 일치하지 않습니다.', 'UNAUTHORIZED_ORDER');
    }

    const statuses = matched.map(item => String(item.row[idx['제공여부']] || 'N').trim().toUpperCase());
    const cancelledCount = statuses.filter(isCancelledOrderStatus).length;
    if (cancelledCount === matched.length) {
      return getOrderMutationResult_({
        success: true,
        verified: true,
        alreadyCancelled: true,
        message: '이미 취소된 주문입니다. 재고와 온기는 다시 변경하지 않았습니다.',
      });
    }
    if (cancelledCount > 0) throw new Error('동일 주문 안에 취소 상태가 섞여 있어 작업을 중단했습니다.');
    if (isUserCancellation && statuses.some(status => status !== 'N')) {
      throw createPublicApiError('일부 품목의 준비가 이미 시작되어 주문 전체를 취소할 수 없습니다. 관리자에게 문의해주세요.', 'CONFLICT');
    }

    const snackRowIndexes = {};
    for (let i = 1; i < snackBefore.length; i++) {
      const snackId = String(snackBefore[i][0] == null ? '' : snackBefore[i][0]).trim();
      if (!snackId) continue;
      if (Object.prototype.hasOwnProperty.call(snackRowIndexes, snackId)) {
        throw new Error('간식목록에 중복 간식ID가 있어 취소를 중단했습니다: ' + snackId);
      }
      snackRowIndexes[snackId] = i;
    }
    const restoreBySnackId = {};
    let restoredItemCount = 0;
    matched.forEach(item => {
      const snackId = String(item.row[idx['간식ID']] == null ? '' : item.row[idx['간식ID']]).trim();
      const quantity = Number(item.row[idx['수량']]);
      if (!snackId || !Number.isInteger(quantity) || quantity <= 0) {
        throw new Error('주문 간식ID 또는 수량 구조가 올바르지 않습니다.');
      }
      if (!Object.prototype.hasOwnProperty.call(snackRowIndexes, snackId)) {
        throw new Error('간식목록에서 주문 간식을 찾을 수 없습니다: ' + snackId);
      }
      const stock = Number(snackBefore[snackRowIndexes[snackId]][5]);
      if (!Number.isFinite(stock) || stock < 0) throw new Error('간식 재고 값이 올바르지 않습니다: ' + snackId);
      restoreBySnackId[snackId] = (restoreBySnackId[snackId] || 0) + quantity;
      restoredItemCount += quantity;
    });

    const isGuest = userId === 'guest';
    let creditSheet = null;
    if (isGuest) creditSheet = ensureGuestCreditSheet();
    const orderBackup = createUniqueSheetBackup_(ss, orderSheet, SHEET.ORDERS + '_취소임시백업');
    backups.push({ target: orderSheet, backup: orderBackup.sheet, name: orderBackup.name });
    const snackBackup = createUniqueSheetBackup_(ss, snackSheet, SHEET.SNACKS + '_취소임시백업');
    backups.push({ target: snackSheet, backup: snackBackup.sheet, name: snackBackup.name });
    if (creditSheet) {
      const creditBackup = createUniqueSheetBackup_(ss, creditSheet, SHEET.GUEST_CREDITS + '_취소임시백업');
      backups.push({ target: creditSheet, backup: creditBackup.sheet, name: creditBackup.name });
    }

    const firstRow = matched[0].row;
    const creditData = {
      orderTime: firstRow[idx['주문시간']],
      guestDeviceId: idx.guestDeviceId !== -1 ? firstRow[idx.guestDeviceId] || '' : '',
      authProvider: idx.authProvider !== -1 ? firstRow[idx.authProvider] || '' : '',
      guestKey: idx.guestKey !== -1 ? firstRow[idx.guestKey] || '' : '',
    };
    const periodKey = isGuest ? getGuestCreditPeriodKey(creditData.orderTime || new Date()) : '';
    if (isGuest) mutationStarted = true;
    const creditBefore = isGuest
      ? resolveGuestCreditWallet(creditData, { periodKey, create: false })
      : null;
    if (isGuest && (!creditBefore || !creditBefore.success)) {
      throw new Error((creditBefore && creditBefore.message) || '게스트 온기 상태를 확인하지 못했습니다.');
    }
    if (isGuest && totalCredit > 0 && Number(creditBefore.usedCredit || 0) < totalCredit) {
      throw new Error('게스트 지갑의 사용 온기가 주문 환불액보다 적어 취소를 중단했습니다.');
    }

    const snackAfter = cloneSheetRows_(snackBefore);
    Object.keys(restoreBySnackId).forEach(snackId => {
      const rowIndex = snackRowIndexes[snackId];
      snackAfter[rowIndex][5] = Number(snackAfter[rowIndex][5]) + restoreBySnackId[snackId];
    });
    mutationStarted = true;
    writeChangedSheetRows_(snackSheet, snackBefore.slice(1), snackAfter.slice(1), 2, snackBefore[0].length);
    throwStagingOrderMutationFailure_(data, 'cancel-stock');

    let refundApplied = false;
    if (isGuest && totalCredit > 0) {
      const refundResult = resolveGuestCreditWallet(creditData, {
        periodKey,
        refundCredit: totalCredit,
        create: true,
      });
      if (!refundResult || !refundResult.success) {
        throw new Error((refundResult && refundResult.message) || '게스트 온기 환불에 실패했습니다.');
      }
      refundApplied = true;
    }
    throwStagingOrderMutationFailure_(data, 'cancel-refund');

    const orderAfter = cloneSheetRows_(orderBefore);
    const cancelTime = new Date();
    matched.forEach(item => {
      orderAfter[item.index][idx['제공여부']] = 'C';
      orderAfter[item.index][idx.cancelTimestamp] = cancelTime;
      orderAfter[item.index][idx.cancelReason] = isUserCancellation ? '이용자 직접 취소' : String(data.cancelReason || '관리자 취소');
      orderAfter[item.index][idx.cancelReasonDetail] = isUserCancellation ? '' : String(data.cancelReasonDetail || '');
    });
    writeChangedSheetRows_(orderSheet, orderBefore.slice(1), orderAfter.slice(1), 2, headers.length);
    throwStagingOrderMutationFailure_(data, 'cancel-order');

    if (!verifyExactSheetValues_(snackSheet, snackAfter)) throw new Error('재고 복구 결과 검증에 실패했습니다.');
    if (!verifyExactSheetValues_(orderSheet, orderAfter)) throw new Error('주문 취소 결과 검증에 실패했습니다.');
    if (isGuest) {
      const creditAfter = resolveGuestCreditWallet(creditData, { periodKey, create: false });
      const expectedUsed = Math.max(0, Number(creditBefore.usedCredit || 0) - totalCredit);
      if (!creditAfter || !creditAfter.success || Number(creditAfter.usedCredit) !== expectedUsed) {
        throw new Error('온기 환불 결과 검증에 실패했습니다.');
      }
    }
    throwStagingOrderMutationFailure_(data, 'cancel-verification');

    const failedCleanup = cleanupOrderMutationBackups_(ss, backups);
    if (failedCleanup.length > 0) recordOrderRecoveryAlert_({
      orderNo: canonicalOrderNo, stage: 'CANCEL_BACKUP_CLEANUP', cleanupRequired: true, backupSheetNames: failedCleanup,
    });
    clearSnackReadCache();
    clearOrderReadCache();
    clearUserReadCache();
    safeAppendAdminLog(
      isUserCancellation ? 'userCancelOrder' : 'cancelOrder',
      'order', canonicalOrderNo, firstRow[idx['별명']], statuses.join(','), 'C',
      isUserCancellation ? '이용자 직접 취소' : (data.adminMemo || '관리자 주문 취소')
    );
    return getOrderMutationResult_({
      success: true,
      verified: true,
      refundApplied,
      restoredItemCount,
      cleanupRequired: failedCleanup.length > 0,
      backupSheetNames: failedCleanup,
      message: failedCleanup.length > 0
        ? `주문 취소는 저장·검증됐지만 임시 백업 삭제가 필요합니다: ${failedCleanup.join(', ')}`
        : (refundApplied
          ? `주문이 취소되었습니다. 온기 ${totalCredit}개 환불과 재고 ${restoredItemCount}개 복구를 확인했습니다.`
          : `주문이 취소되었습니다. 재고 ${restoredItemCount}개 복구를 확인했습니다.`),
    });
  } catch (error) {
    const safeError = getSafeApiErrorResponse(isUserCancellation ? 'userCancelOrder' : 'cancelOrder', error);
    if (!ss || backups.length === 0) return getOrderMutationResult_(safeError);
    if (!mutationStarted) {
      const failedCleanup = cleanupOrderMutationBackups_(ss, backups);
      if (failedCleanup.length > 0) recordOrderRecoveryAlert_({
        orderNo: orderId, stage: 'CANCEL_BACKUP_CLEANUP', cleanupRequired: true, backupSheetNames: failedCleanup,
      });
      return getOrderMutationResult_({
        message: safeError.message,
        errorCode: safeError.errorCode,
        errorId: safeError.errorId,
        cleanupRequired: failedCleanup.length > 0,
        backupSheetNames: failedCleanup,
      });
    }
    const rollback = rollbackOrderMutation_(ss, backups);
    recordOrderRecoveryAlert_({
      orderNo: orderId, stage: 'CANCEL_ROLLBACK', recoveryRequired: rollback.recoveryRequired,
      cleanupRequired: rollback.cleanupRequired, backupSheetNames: rollback.backupSheetNames,
    });
    clearSnackReadCache();
    clearOrderReadCache();
    clearUserReadCache();
    return getOrderMutationResult_(Object.assign({}, rollback, {
      message: rollback.recoveryRequired
        ? `주문 취소 실패(${safeError.message}) 후 자동 복원도 완료되지 않았습니다. 다음 백업 시트로 수동 복원이 필요합니다: ${rollback.backupSheetNames.join(', ')}`
        : (rollback.cleanupRequired
          ? `주문 취소 실패(${safeError.message})는 원상복구됐지만 임시 백업 삭제가 필요합니다: ${rollback.backupSheetNames.join(', ')}`
          : `주문 취소 처리에 실패해 주문·재고·온기를 모두 원래 상태로 복구했습니다: ${safeError.message}`),
      errorCode: safeError.errorCode,
      errorId: safeError.errorId,
    }));
  } finally {
    lock.releaseLock();
  }
}

/**
 * 보관 전 읽기 전용 점검.
 * 시트를 변경하지 않고 헤더 차이와 주문번호+간식ID 중복만 확인한다.
 */
function getArchiveOrderKey_(row, header) {
  const orderNoIndex = header.indexOf('주문번호');
  const snackIdIndex = header.indexOf('간식ID');
  if (orderNoIndex < 0 || snackIdIndex < 0) return '';
  const orderNo = String(row[orderNoIndex] == null ? '' : row[orderNoIndex]).trim();
  const snackId = String(row[snackIdIndex] == null ? '' : row[snackIdIndex]).trim();
  return orderNo && snackId ? `${orderNo}|${snackId}` : '';
}

function analyzeArchiveOldOrders_(orderSheet, archiveSheet) {
  const orderValues = orderSheet.getDataRange().getValues();
  const archiveValues = archiveSheet ? archiveSheet.getDataRange().getValues() : [];
  const orderHeader = (orderValues[0] || []).map(value => String(value == null ? '' : value).trim());
  const archiveHeader = archiveValues.length
    ? (archiveValues[0] || []).map(value => String(value == null ? '' : value).trim())
    : [];
  const orderRows = orderValues.slice(1).filter(row => row.some(value => value !== ''));
  const archiveRows = archiveValues.slice(1).filter(row => row.some(value => value !== ''));
  const requiredHeaders = ['주문시간', '주문번호', '간식ID'];
  const missingRequiredHeaders = requiredHeaders.filter(header => orderHeader.indexOf(header) === -1);
  const requiredHeadersPresent = missingRequiredHeaders.length === 0;
  const hasArchiveHeader = archiveHeader.some(Boolean);
  const archiveTargetHeader = hasArchiveHeader ? archiveHeader : orderHeader;
  const headersCompatible = archiveTargetHeader.length <= orderHeader.length
    && archiveTargetHeader.every((header, index) => header === orderHeader[index]);
  const orderKeyCounts = new Map();
  const archiveKeyCounts = new Map();
  let orderRowsWithoutKey = 0;
  let archiveRowsWithoutKey = 0;

  orderRows.forEach(row => {
    const key = getArchiveOrderKey_(row, orderHeader);
    if (key) orderKeyCounts.set(key, (orderKeyCounts.get(key) || 0) + 1);
    else orderRowsWithoutKey += 1;
  });
  archiveRows.forEach(row => {
    const key = getArchiveOrderKey_(row, archiveHeader);
    if (key) archiveKeyCounts.set(key, (archiveKeyCounts.get(key) || 0) + 1);
    else archiveRowsWithoutKey += 1;
  });

  let duplicateOrderKeys = 0;
  let duplicateArchiveKeys = 0;
  let overlapKeys = 0;
  let archiveOnlyKeys = 0;
  let orderOnlyKeys = 0;
  const sampleDuplicateOrderKeys = [];
  const sampleDuplicateKeys = [];

  orderKeyCounts.forEach((count, key) => {
    if (archiveKeyCounts.has(key)) overlapKeys += 1;
    else orderOnlyKeys += 1;
    if (count > 1) {
      duplicateOrderKeys += 1;
      if (sampleDuplicateOrderKeys.length < 10) sampleDuplicateOrderKeys.push(`${key} (${count}건)`);
    }
  });
  archiveKeyCounts.forEach((count, key) => {
    if (!orderKeyCounts.has(key)) archiveOnlyKeys += 1;
    if (count > 1) {
      duplicateArchiveKeys += 1;
      if (sampleDuplicateKeys.length < 10) sampleDuplicateKeys.push(`${key} (${count}건)`);
    }
  });

  const missingInArchive = hasArchiveHeader
    ? orderHeader.filter(header => header && archiveHeader.indexOf(header) === -1)
    : [];
  const extraInArchive = hasArchiveHeader
    ? archiveHeader.filter(header => header && orderHeader.indexOf(header) === -1)
    : [];
  const safeToRun = requiredHeadersPresent
    && headersCompatible
    && duplicateOrderKeys === 0
    && duplicateArchiveKeys === 0
    && orderRowsWithoutKey === 0
    && archiveRowsWithoutKey === 0;

  return {
    orderValues,
    archiveValues,
    orderHeader,
    archiveHeader,
    archiveTargetHeader,
    summary: {
      safeToRun,
      requiredHeadersPresent,
      missingRequiredHeaders,
      orderRows: orderRows.length,
      archiveRows: archiveRows.length,
      orderColumns: orderHeader.length,
      archiveColumns: archiveHeader.length,
      headersEqual: hasArchiveHeader && JSON.stringify(orderHeader) === JSON.stringify(archiveHeader),
      headersCompatible,
      missingInArchive,
      extraInArchive,
      overlapKeys,
      duplicateOrderKeys,
      duplicateArchiveKeys,
      archiveOnlyKeys,
      orderOnlyKeys,
      orderRowsWithoutKey,
      archiveRowsWithoutKey,
      sampleDuplicateOrderKeys,
      sampleDuplicateKeys
    }
  };
}

function auditArchiveOldOrders() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const orderSheet = ss.getSheetByName(SHEET.ORDERS);
    if (!orderSheet) return { success: false, message: '주문내역 시트를 찾을 수 없습니다.' };
    const analysis = analyzeArchiveOldOrders_(orderSheet, ss.getSheetByName(SHEET.ARCHIVE));
    return {
      success: true,
      dryRun: true,
      message: analysis.summary.safeToRun
        ? '보관 전 점검이 완료되었습니다. 시트는 변경되지 않았습니다.'
        : '보관 전 점검에서 안전 문제를 발견했습니다. 시트는 변경되지 않았습니다.',
      summary: analysis.summary
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

/**
 * 25. 지난 주문 보관 (아카이빙) API
 */
function archiveOldOrders(data) {
  const confirmStr = String((data && data.archiveConfirm) || '').trim();
  const validPhrases = ['주문보관확인', '지난주문보관', '지난주문 보관', '보관확인'];
  if (!data || validPhrases.indexOf(confirmStr) === -1) {
    return {
      success: false,
      message: '보관 데이터 점검 후 명시적인 확인이 있어야 실행할 수 있습니다.'
    };
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return {
      success: false,
      message: '다른 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.'
    };
  }

  let ss = null;
  let orderSheet = null;
  let archiveSheet = null;
  let orderBackup = null;
  let archiveBackup = null;
  let archiveCreated = false;
  let mutationStarted = false;
  try {
    const memo = data && data.adminMemo ? data.adminMemo : '';
    ss = SpreadsheetApp.getActiveSpreadsheet();
    orderSheet = ss.getSheetByName(SHEET.ORDERS);
    if (!orderSheet) {
      return { success: false, message: '주문내역 시트를 찾을 수 없습니다.' };
    }
    archiveSheet = ss.getSheetByName(SHEET.ARCHIVE);
    const analysis = analyzeArchiveOldOrders_(orderSheet, archiveSheet);
    if (!analysis.summary.safeToRun) {
      return {
        success: false,
        verified: false,
        rolledBack: false,
        recoveryRequired: false,
        cleanupRequired: false,
        summary: analysis.summary,
        message: '주문 데이터 안전 점검을 통과하지 못해 보관을 시작하지 않았습니다.'
      };
    }

    const orderValues = analysis.orderValues;
    const header = analysis.orderHeader;
    const rows = orderValues.slice(1);
    const timestampIndex = header.indexOf('주문시간');

    const mapRowByHeader = (row, sourceHeader, targetHeader = header) => {
      const sourceIndexes = {};
      sourceHeader.forEach((name, index) => {
        const normalizedName = String(name == null ? '' : name).trim();
        if (normalizedName && sourceIndexes[normalizedName] === undefined) {
          sourceIndexes[normalizedName] = index;
        }
      });
      return targetHeader.map(name => {
        const sourceIndex = sourceIndexes[name];
        return sourceIndex === undefined ? '' : row[sourceIndex];
      });
    };

    const archiveValues = analysis.archiveValues;
    const archiveHeader = analysis.archiveHeader;
    const archiveRows = archiveValues.length > 1
      ? archiveValues.slice(1).filter(row => row.some(value => value !== ''))
      : [];
    const archiveTargetHeader = analysis.archiveTargetHeader;

    // 오늘 날짜의 자정 기준 시각 구하기
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const archiveByKey = new Map();
    archiveRows.forEach(row => {
      const key = getArchiveOrderKey_(row, archiveHeader);
      archiveByKey.set(key, mapRowByHeader(row, archiveHeader, archiveTargetHeader));
    });
    const oldRowNumbers = [];
    const keptRows = [];
    let movedOrderRows = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const timestampValue = timestampIndex >= 0 ? row[timestampIndex] : '';
      const timestamp = timestampValue instanceof Date ? new Date(timestampValue) : new Date(timestampValue);
      if (!isNaN(timestamp.getTime()) && timestamp < today) {
        const key = getArchiveOrderKey_(row, header);
        archiveByKey.set(key, mapRowByHeader(row, header, archiveTargetHeader));
        oldRowNumbers.push(i + 2);
        movedOrderRows += 1;
      } else {
        keptRows.push(row.slice(0, header.length));
      }
    }

    const rowsToArchive = [...archiveByKey.values()];
    if (movedOrderRows === 0) {
      return {
        success: true,
        movedCount: 0,
        archiveCount: archiveRows.length,
        verified: true,
        rolledBack: false,
        recoveryRequired: false,
        cleanupRequired: false,
        orderBackupSheetName: '',
        archiveBackupSheetName: '',
        archiveCreated: false,
        message: '보관할 지난 주문이 없습니다.'
      };
    }

    const archiveKeys = new Set();
    rowsToArchive.forEach(row => {
      const key = getArchiveOrderKey_(row, archiveTargetHeader);
      archiveKeys.add(key);
    });
    if (archiveKeys.size !== rowsToArchive.length) {
      return {
        success: false,
        message: '최종 보관 목록에서 중복 주문 키가 발견되어 작업을 중단했습니다.'
      };
    }

    orderBackup = createUniqueSheetBackup_(ss, orderSheet, SHEET.ORDERS + '_자동백업');
    if (archiveSheet) {
      archiveBackup = createUniqueSheetBackup_(ss, archiveSheet, SHEET.ARCHIVE + '_자동백업');
    }
    if (!archiveSheet) {
      archiveSheet = ss.insertSheet(SHEET.ARCHIVE);
      archiveCreated = true;
    }
    mutationStarted = true;
    ensureSheetGridSize_(archiveSheet, rowsToArchive.length + 1, archiveTargetHeader.length);
    if (archiveSheet.getMaxColumns() < archiveTargetHeader.length) {
      archiveSheet.insertColumnsAfter(
        archiveSheet.getMaxColumns(),
        archiveTargetHeader.length - archiveSheet.getMaxColumns()
      );
    }

    const expectedArchiveValues = [archiveTargetHeader].concat(rowsToArchive);
    archiveSheet.clearContents();
    archiveSheet.getRange(1, 1, expectedArchiveValues.length, archiveTargetHeader.length)
      .setValues(expectedArchiveValues);
    SpreadsheetApp.flush();
    if (!verifyExactSheetValues_(archiveSheet, expectedArchiveValues)) {
      throw new Error('주문보관 저장 후 데이터 검증에 실패했습니다.');
    }

    const deleteGroups = [];
    oldRowNumbers.forEach(rowNumber => {
      const last = deleteGroups.length ? deleteGroups[deleteGroups.length - 1] : null;
      if (last && rowNumber === last.end + 1) last.end = rowNumber;
      else deleteGroups.push({ start: rowNumber, end: rowNumber });
    });
    deleteGroups.reverse().forEach(group => {
      orderSheet.deleteRows(group.start, group.end - group.start + 1);
    });
    SpreadsheetApp.flush();

    const expectedOrderValues = [header].concat(keptRows);
    if (!verifyExactSheetValues_(orderSheet, expectedOrderValues)) {
      throw new Error('주문내역 정리 후 데이터 검증에 실패했습니다.');
    }

    safeAppendAdminLog('archiveOldOrders', 'orders', 'archive', '지난 주문 보관', '', `${movedOrderRows}건 보관 완료`, memo);

    clearOrderReadCache();
    return {
      success: true,
      movedCount: movedOrderRows,
      archiveCount: rowsToArchive.length,
      verified: true,
      rolledBack: false,
      recoveryRequired: false,
      cleanupRequired: false,
      orderBackupSheetName: orderBackup.name,
      archiveBackupSheetName: archiveBackup ? archiveBackup.name : '',
      archiveCreated,
      message: `${movedOrderRows}건의 지난 주문을 보관하고 검증했습니다. (주문내역 백업: ${orderBackup.name}${archiveBackup ? `, 주문보관 백업: ${archiveBackup.name}` : ''})`
    };
  } catch (error) {
    let rolledBack = false;
    let recoveryRequired = false;
    if (mutationStarted) {
      let orderRestored = !orderBackup;
      let archiveRestored = !archiveBackup && !archiveCreated;
      if (orderBackup && orderSheet) {
        try {
          restoreSheetFromBackup_(orderSheet, orderBackup.sheet);
          orderRestored = true;
        } catch (restoreOrderError) {
          orderRestored = false;
        }
      }
      if (archiveCreated) {
        archiveRestored = deleteSheetQuietly_(ss, archiveSheet);
      } else if (archiveBackup && archiveSheet) {
        try {
          restoreSheetFromBackup_(archiveSheet, archiveBackup.sheet);
          archiveRestored = true;
        } catch (restoreArchiveError) {
          archiveRestored = false;
        }
      }
      rolledBack = orderRestored && archiveRestored;
      recoveryRequired = !rolledBack;
    }
    safeAppendAdminLog(
      'archiveOldOrders', 'orders', 'archive', '지난 주문 보관 실패', '',
      rolledBack ? '자동 복구 완료' : (recoveryRequired ? '수동 복구 필요' : '변경 전 중단'),
      ''
    );
    return {
      success: false,
      verified: false,
      rolledBack,
      recoveryRequired,
      cleanupRequired: false,
      orderBackupSheetName: orderBackup ? orderBackup.name : '',
      archiveBackupSheetName: archiveBackup ? archiveBackup.name : '',
      archiveCreated,
      message: recoveryRequired
        ? `주문 보관 중 오류가 발생했고 자동 복구에 실패했습니다. ${orderBackup ? orderBackup.name : ''}${archiveBackup ? `, ${archiveBackup.name}` : ''}${archiveCreated ? ', 새 주문보관 시트' : ''}를 보존하고 관리자에게 알려 주세요.`
        : (rolledBack ? '주문 보관 중 오류가 발생해 양쪽 시트를 자동 복구했습니다.' : '주문 보관을 시작하지 못했습니다: ' + error.message)
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

  const REQUIRED_COLS = ORDER_COMMIT_STATUS_COL;
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
  if (latestHeaders.indexOf(ORDER_COMMIT_STATUS_HEADER) === -1) {
    orderSheet.getRange(1, ORDER_COMMIT_STATUS_COL).setValue(ORDER_COMMIT_STATUS_HEADER);
    clearOrderReadCache();
  }
  return '헤더 보정이 완료되었습니다.';
}

