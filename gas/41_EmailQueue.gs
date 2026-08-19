const ORDER_EMAIL_QUEUE_HEADERS = [
  'createdAt', 'orderNo', 'recipient', 'subject', 'body', 'status',
  'attemptCount', 'nextAttemptAt', 'sentAt', 'lastError'
];
const ORDER_EMAIL_QUEUE_MAX_ATTEMPTS = 4;
const ORDER_EMAIL_QUEUE_BATCH_SIZE = 20;
const ORDER_EMAIL_QUEUE_STALE_MS = 10 * 60 * 1000;
const ORDER_EMAIL_QUEUE_RETRY_MINUTES = [1, 5, 15];

function ensureOrderEmailQueueSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET.EMAIL_QUEUE);
  if (!sheet) sheet = ss.insertSheet(SHEET.EMAIL_QUEUE);

  const currentHeaders = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    : [];
  const matches = ORDER_EMAIL_QUEUE_HEADERS.every((header, index) => (
    String(currentHeaders[index] || '').trim() === header
  ));
  if (!matches) {
    sheet.getRange(1, 1, 1, ORDER_EMAIL_QUEUE_HEADERS.length).setValues([ORDER_EMAIL_QUEUE_HEADERS]);
  }
  return sheet;
}

function getOrderNotificationRecipient() {
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

function enqueueOrderNotification(orderContext) {
  try {
    if (!orderContext || !orderContext.orderNo) return { queued: false };
    const sheet = ensureOrderEmailQueueSheet();
    const orderNo = String(orderContext.orderNo).trim();
    if (sheet.getLastRow() > 1) {
      const existing = sheet
        .getRange(2, 2, sheet.getLastRow() - 1, 1)
        .createTextFinder(orderNo)
        .matchEntireCell(true)
        .findNext();
      if (existing) return { queued: false, duplicate: true };
    }

    const message = buildOrderNotificationMessage(orderContext);
    const now = new Date();
    sheet.appendRow([
      now,
      orderNo,
      getOrderNotificationRecipient(),
      message.subject,
      message.body,
      'PENDING',
      0,
      now,
      '',
      ''
    ]);
    return { queued: true };
  } catch (error) {
    Logger.log('주문 이메일 큐 등록 실패(주문은 정상 처리됨): ' + (error && error.stack ? error.stack : error));
    return { queued: false, error: error.message || String(error) };
  }
}

function processOrderEmailQueue() {
  const now = new Date();
  const lock = LockService.getScriptLock();
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
          attemptCount: Number(row[6] || 0)
        });
      } else if (isStale) {
        row[5] = 'PENDING';
      }
    });
    sheet.getRange(2, 1, values.length, ORDER_EMAIL_QUEUE_HEADERS.length).setValues(values);
  } finally {
    lock.releaseLock();
  }

  const results = claimed.map(item => {
    try {
      const recipient = item.recipient || getOrderNotificationRecipient();
      if (!recipient) throw new Error('ADMIN_EMAIL 수신자 주소가 설정되지 않았습니다.');
      MailApp.sendEmail({ to: recipient, subject: item.subject, body: item.body });
      return { orderNo: item.orderNo, success: true, attemptCount: item.attemptCount + 1 };
    } catch (error) {
      return {
        orderNo: item.orderNo,
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
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, ORDER_EMAIL_QUEUE_HEADERS.length).getValues();
    const resultByOrderNo = {};
    results.forEach(result => { resultByOrderNo[result.orderNo] = result; });
    values.forEach(row => {
      const result = resultByOrderNo[String(row[1] || '')];
      if (!result || String(row[5] || '') !== 'PROCESSING') return;
      row[6] = result.attemptCount;
      if (result.success) {
        row[5] = 'SENT';
        row[7] = '';
        row[8] = new Date();
        row[9] = '';
      } else if (result.attemptCount >= ORDER_EMAIL_QUEUE_MAX_ATTEMPTS) {
        row[5] = 'FAILED';
        row[7] = '';
        row[9] = result.error;
      } else {
        const retryIndex = Math.max(0, result.attemptCount - 1);
        const delayMinutes = ORDER_EMAIL_QUEUE_RETRY_MINUTES[retryIndex] || 15;
        row[5] = 'PENDING';
        row[7] = new Date(Date.now() + delayMinutes * 60 * 1000);
        row[9] = result.error;
      }
    });
    sheet.getRange(2, 1, values.length, ORDER_EMAIL_QUEUE_HEADERS.length).setValues(values);
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
