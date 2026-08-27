const ORDER_EMAIL_QUEUE_HEADERS = [
  'createdAt', 'orderNo', 'recipient', 'subject', 'body', 'status',
  'attemptCount', 'nextAttemptAt', 'sentAt', 'lastError', 'notificationType', 'referenceId'
];
const ORDER_EMAIL_QUEUE_MAX_ATTEMPTS = 4;
const ORDER_EMAIL_QUEUE_BATCH_SIZE = 20;
const ORDER_EMAIL_QUEUE_STALE_MS = 10 * 60 * 1000;
const ORDER_EMAIL_QUEUE_RETRY_MINUTES = [1, 5, 15];
const ORDER_EMAIL_QUEUE_SCHEMA_CACHE_KEY = 'emailQueue.schema.v2';
const ORDER_EMAIL_QUEUE_SCHEMA_CACHE_SECONDS = 10 * 60;
const ORDER_EMAIL_RECIPIENT_CACHE_KEY = 'emailQueue.recipient.v1';
const ORDER_EMAIL_RECIPIENT_CACHE_SECONDS = 10 * 60;

function getOrderEmailQueueLock(callerHoldsScriptLock) {
  const documentLock = LockService.getDocumentLock();
  if (documentLock) return documentLock;
  return callerHoldsScriptLock ? null : LockService.getScriptLock();
}

function readOrderEmailQueueSchemaCache_() {
  try {
    return CacheService.getScriptCache().get(ORDER_EMAIL_QUEUE_SCHEMA_CACHE_KEY) || '';
  } catch (error) {
    Logger.log('이메일 큐 스키마 캐시 조회 실패: ' + (error && error.stack ? error.stack : error));
    return '';
  }
}

function writeOrderEmailQueueSchemaCache_() {
  try {
    CacheService.getScriptCache().put(
      ORDER_EMAIL_QUEUE_SCHEMA_CACHE_KEY,
      ORDER_EMAIL_QUEUE_HEADERS.join('|'),
      ORDER_EMAIL_QUEUE_SCHEMA_CACHE_SECONDS
    );
  } catch (error) {
    Logger.log('이메일 큐 스키마 캐시 저장 실패: ' + (error && error.stack ? error.stack : error));
  }
}

function ensureOrderEmailQueueSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET.EMAIL_QUEUE);
  if (!sheet) sheet = ss.insertSheet(SHEET.EMAIL_QUEUE);

  const expectedSchema = ORDER_EMAIL_QUEUE_HEADERS.join('|');
  if (sheet.getLastColumn() >= ORDER_EMAIL_QUEUE_HEADERS.length
      && readOrderEmailQueueSchemaCache_() === expectedSchema) {
    return sheet;
  }

  const currentHeaders = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    : [];
  const matches = ORDER_EMAIL_QUEUE_HEADERS.every((header, index) => (
    String(currentHeaders[index] || '').trim() === header
  ));
  if (!matches) {
    sheet.getRange(1, 1, 1, ORDER_EMAIL_QUEUE_HEADERS.length).setValues([ORDER_EMAIL_QUEUE_HEADERS]);
  }
  writeOrderEmailQueueSchemaCache_();
  return sheet;
}

function getOrderNotificationRecipient() {
  try {
    const cached = String(CacheService.getScriptCache().get(ORDER_EMAIL_RECIPIENT_CACHE_KEY) || '').trim();
    if (cached) return cached;
  } catch (error) {
    Logger.log('ADMIN_EMAIL 캐시 조회 실패: ' + (error && error.stack ? error.stack : error));
  }

  let recipient = '';
  try {
    recipient = String(PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL') || '').trim();
  } catch (error) {
    Logger.log('ADMIN_EMAIL script property read error: ' + (error && error.stack ? error.stack : error));
  }
  if (!recipient) {
    try {
      recipient = String(Session.getEffectiveUser().getEmail() || '').trim();
    } catch (error) {
      Logger.log('Effective user email read error: ' + (error && error.stack ? error.stack : error));
    }
  }
  if (recipient) {
    try {
      CacheService.getScriptCache().put(
        ORDER_EMAIL_RECIPIENT_CACHE_KEY,
        recipient,
        ORDER_EMAIL_RECIPIENT_CACHE_SECONDS
      );
    } catch (error) {
      Logger.log('ADMIN_EMAIL 캐시 저장 실패: ' + (error && error.stack ? error.stack : error));
    }
  }
  return recipient;
}

function buildOrderNotificationMessage(orderContext) {
  const typeLabel = orderContext.deliveryType === 'delivery' ? '배달' : '포장';
  const items = Array.isArray(orderContext.items) ? orderContext.items : [];
  const totalQty = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const summary = items.length <= 2
    ? items.map(item => `${item.snackName} ${item.quantity}`).join(' · ')
    : `${items.length}종 · 총 ${totalQty}개`;
  const subject = `[배달왔삼 새 주문] ${typeLabel} | ${orderContext.nickname || '주문자'} | ${summary}`;
  const timeStr = Utilities.formatDate(
    new Date(orderContext.timestamp || new Date()),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd HH:mm:ss'
  );
  const bodyLines = [
    `주문번호: ${orderContext.orderNo || ''}`,
    `주문시간: ${timeStr}`,
    `주문자: ${orderContext.nickname || ''}`,
    `주문방식: ${typeLabel}`
  ];
  if (orderContext.deliveryType === 'delivery' && orderContext.deliveryPlace) {
    bodyLines.push(`배달지: ${orderContext.deliveryPlace}`);
  }
  bodyLines.push('', '--- 주문 메뉴 ---');
  items.forEach(item => {
    const qty = Number(item.quantity || 0);
    const point = item.totalPoint != null ? item.totalPoint : Number(item.point || 0) * qty;
    bodyLines.push(`- ${item.snackName}: ${qty}개 (${point}온기)`);
  });
  bodyLines.push(
    '-----------------',
    `총 주문 수량: ${totalQty}개`,
    `총 사용 온기: ${orderContext.totalPoint || 0}온기`
  );
  return { subject, body: bodyLines.join('\n') };
}

function enqueueOrderNotification(orderContext, options) {
  const lock = getOrderEmailQueueLock();
  try {
    if (!orderContext || !orderContext.orderNo) return { queued: false };
    if (lock && !lock.tryLock(5000)) return { queued: false, error: '이메일 큐 잠금을 획득하지 못했습니다.' };
    const sheet = ensureOrderEmailQueueSheet();
    const orderNo = String(orderContext.orderNo).trim();
    const uniqueCommittedOrder = options && options.uniqueCommittedOrder === true;
    if (!uniqueCommittedOrder && hasQueuedNotification(sheet, 'ORDER', orderNo)) {
      return { queued: false, duplicate: true };
    }

    const message = buildOrderNotificationMessage(orderContext);
    const now = new Date();
    const row = [
      now,
      orderNo,
      getOrderNotificationRecipient(),
      message.subject,
      message.body,
      'PENDING',
      0,
      now,
      '',
      '',
      'ORDER',
      orderNo
    ];
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    return { queued: true };
  } catch (error) {
    Logger.log('주문 이메일 큐 등록 실패(주문은 정상 처리됨): ' + (error && error.stack ? error.stack : error));
    return { queued: false, error: error.message || String(error) };
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function hasQueuedNotification(sheet, notificationType, referenceId) {
  if (!sheet || sheet.getLastRow() <= 1) return false;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, ORDER_EMAIL_QUEUE_HEADERS.length).getValues();
  return values.some(row => {
    const type = String(row[10] || '').trim() || 'ORDER';
    const reference = String(row[11] || '').trim() || String(row[1] || '').trim();
    return type === notificationType && reference === referenceId;
  });
}

function buildGuestApplicationNotificationMessage(application) {
  const subject = '[배달왔삼 이용 신청] ' + String(application.applicationId || '신청 확인');
  const createdAt = application.createdAt
    ? Utilities.formatDate(new Date(application.createdAt), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
    : '';
  return {
    subject,
    body: [
      '신청번호: ' + (application.applicationId || ''),
      '신청 시각: ' + createdAt,
      '관계 유형: ' + (application.relationType || ''),
      '희망 요일: ' + (application.preferredDays || ''),
      '',
      '관리자 화면에서 상세 신청 내용을 확인해 주세요.'
    ].join('\n')
  };
}

function enqueueGuestApplicationNotification(application, options) {
  const callerHoldsScriptLock = options && options.callerHoldsScriptLock === true;
  const lock = getOrderEmailQueueLock(callerHoldsScriptLock);
  try {
    if (!application || !application.applicationId) return { queued: false };
    const settings = readGuestApplicationSettings();
    if (String(settings.guestApplicationEmailNotificationEnabled || 'N').toUpperCase() !== 'Y') {
      return { queued: false, disabled: true };
    }
    if (lock && !lock.tryLock(5000)) return { queued: false, error: '이메일 큐 잠금을 획득하지 못했습니다.' };
    const sheet = ensureOrderEmailQueueSheet();
    const referenceId = String(application.applicationId).trim();
    if (hasQueuedNotification(sheet, 'GUEST_APPLICATION', referenceId)) return { queued: false, duplicate: true };
    const message = buildGuestApplicationNotificationMessage(application);
    const now = new Date();
    const row = [now, referenceId, getOrderNotificationRecipient(), message.subject, message.body, 'PENDING', 0, now, '', '', 'GUEST_APPLICATION', referenceId];
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    return { queued: true };
  } catch (error) {
    Logger.log('이용 신청 이메일 큐 등록 실패(신청은 정상 처리됨): ' + (error && error.stack ? error.stack : error));
    return { queued: false, error: error.message || String(error) };
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function processOrderEmailQueue() {
  const now = new Date();
  const lock = getOrderEmailQueueLock();
  if (!lock.tryLock(1000)) return { success: true, skipped: true, reason: 'busy' };

  let claimed = [];
  try {
    const sheet = ensureOrderEmailQueueSheet();
    if (sheet.getLastRow() <= 1) return { success: true, processed: 0 };
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, ORDER_EMAIL_QUEUE_HEADERS.length).getValues();
    values.forEach((row, index) => {
      const status = String(row[5] || '').trim().toUpperCase();
      const markerTime = row[7] ? new Date(row[7]).getTime() : 0;
      const isStale = status === 'PROCESSING'
        && markerTime
        && now.getTime() - markerTime >= ORDER_EMAIL_QUEUE_STALE_MS;
      const isDue = status === 'PENDING' && (!markerTime || markerTime <= now.getTime());
      if ((isDue || isStale) && claimed.length < ORDER_EMAIL_QUEUE_BATCH_SIZE) {
        row[5] = 'PROCESSING';
        row[7] = now;
        claimed.push({
          orderNo: String(row[1] || ''),
          recipient: String(row[2] || ''),
          subject: String(row[3] || ''),
          body: String(row[4] || ''),
          attemptCount: Number(row[6] || 0),
          notificationType: String(row[10] || '').trim() || 'ORDER',
          referenceId: String(row[11] || '').trim() || String(row[1] || '').trim()
        });
      } else if (isStale) {
        row[5] = 'PENDING';
      }
    });
    sheet.getRange(2, 6, values.length, 3).setValues(values.map(row => row.slice(5, 8)));
  } finally {
    lock.releaseLock();
  }

  const results = claimed.map(item => {
    try {
      const recipient = item.recipient || getOrderNotificationRecipient();
      if (!recipient) throw new Error('ADMIN_EMAIL 수신자 주소가 설정되지 않았습니다.');
      MailApp.sendEmail({ to: recipient, subject: item.subject, body: item.body });
      return { orderNo: item.orderNo, notificationType: item.notificationType, referenceId: item.referenceId, success: true, attemptCount: item.attemptCount + 1 };
    } catch (error) {
      return {
        orderNo: item.orderNo,
        notificationType: item.notificationType,
        referenceId: item.referenceId,
        success: false,
        attemptCount: item.attemptCount + 1,
        error: error.message || String(error)
      };
    }
  });

  if (results.length === 0) return { success: true, processed: 0 };
  if (!lock.tryLock(10000)) throw new Error('이메일 큐 결과 저장 락을 획득하지 못했습니다.');
  try {
    const sheet = ensureOrderEmailQueueSheet();
    const values = sheet.getRange(2, 2, sheet.getLastRow() - 1, ORDER_EMAIL_QUEUE_HEADERS.length - 1).getValues();
    const resultByKey = {};
    results.forEach(result => { resultByKey[result.notificationType + ':' + result.referenceId] = result; });
    values.forEach(row => {
      const notificationType = String(row[9] || '').trim() || 'ORDER';
      const referenceId = String(row[10] || '').trim() || String(row[0] || '').trim();
      const result = resultByKey[notificationType + ':' + referenceId];
      if (!result || String(row[4] || '') !== 'PROCESSING') return;
      row[5] = result.attemptCount;
      if (result.success) {
        row[4] = 'SENT';
        row[6] = '';
        row[7] = new Date();
        row[8] = '';
      } else if (result.attemptCount >= ORDER_EMAIL_QUEUE_MAX_ATTEMPTS) {
        row[4] = 'FAILED';
        row[6] = '';
        row[8] = result.error;
      } else {
        const retryIndex = Math.max(0, result.attemptCount - 1);
        const delayMinutes = ORDER_EMAIL_QUEUE_RETRY_MINUTES[retryIndex] || 15;
        row[4] = 'PENDING';
        row[6] = new Date(Date.now() + delayMinutes * 60 * 1000);
        row[8] = result.error;
      }
    });
    sheet.getRange(2, 6, values.length, 5).setValues(values.map(row => row.slice(4, 9)));
  } finally {
    lock.releaseLock();
  }
  return {
    success: true,
    processed: results.length,
    sent: results.filter(result => result.success).length
  };
}

function createOrderEmailQueueTrigger() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'processOrderEmailQueue') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('processOrderEmailQueue').timeBased().everyMinutes(1).create();
  return '주문 이메일 큐 트리거가 생성되었습니다. 1분마다 실행됩니다.';
}
