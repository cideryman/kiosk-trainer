const ORDER_RECOVERY_ALERTS_PROPERTY = 'ORDER_RECOVERY_ALERTS_V1';
const ORDER_RECOVERY_ALERTS_LIMIT = 50;

function loadOrderRecoveryAlerts_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(ORDER_RECOVERY_ALERTS_PROPERTY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    Logger.log('loadOrderRecoveryAlerts failed: ' + (error && error.stack ? error.stack : error));
    return [];
  }
}

function saveOrderRecoveryAlerts_(alerts) {
  const retained = (alerts || []).slice(-ORDER_RECOVERY_ALERTS_LIMIT);
  while (retained.length > 1 && JSON.stringify(retained).length > 8000) retained.shift();
  PropertiesService.getScriptProperties().setProperty(
    ORDER_RECOVERY_ALERTS_PROPERTY,
    JSON.stringify(retained)
  );
}

function normalizeRecoveryBackupNames_(names) {
  return Array.from(new Set((Array.isArray(names) ? names : [])
    .map(name => String(name || '').trim().slice(0, 120))
    .filter(Boolean)))
    .slice(0, 10);
}

function recordOrderRecoveryAlert_(details) {
  const recoveryRequired = details && details.recoveryRequired === true;
  const cleanupRequired = details && details.cleanupRequired === true;
  if (!recoveryRequired && !cleanupRequired) return null;
  try {
    const orderNo = String(details.orderNo || '').trim().slice(0, 80);
    const stage = String(details.stage || 'UNKNOWN').trim().toUpperCase().slice(0, 80);
    const backupSheetNames = normalizeRecoveryBackupNames_(details.backupSheetNames);
    const signature = [orderNo, stage, recoveryRequired ? 'R1' : 'R0', cleanupRequired ? 'C1' : 'C0', backupSheetNames.slice().sort().join('|')].join('::');
    const alerts = loadOrderRecoveryAlerts_();
    const now = new Date().toISOString();
    const existing = alerts.find(alert => alert.status === 'OPEN' && alert.signature === signature);
    if (existing) {
      existing.lastSeenAt = now;
      existing.occurrenceCount = Number(existing.occurrenceCount || 1) + 1;
      saveOrderRecoveryAlerts_(alerts);
      return existing;
    }
    const alert = {
      alertId: 'REC-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase(),
      signature,
      orderNo,
      stage,
      occurredAt: now,
      lastSeenAt: now,
      occurrenceCount: 1,
      recoveryRequired,
      cleanupRequired,
      backupSheetNames,
      manualActionRequired: true,
      status: 'OPEN'
    };
    alerts.push(alert);
    saveOrderRecoveryAlerts_(alerts);
    return alert;
  } catch (error) {
    Logger.log('recordOrderRecoveryAlert failed: ' + (error && error.stack ? error.stack : error));
    return null;
  }
}

function getOrderRecoveryAlertsSummary_() {
  const openAlerts = loadOrderRecoveryAlerts_().filter(alert => (
    alert && alert.status === 'OPEN' && /^REC-[A-Z0-9]{12}$/.test(String(alert.alertId || ''))
  )).map(alert => ({
    alertId: String(alert.alertId || ''),
    orderNo: String(alert.orderNo || ''),
    stage: String(alert.stage || ''),
    occurredAt: String(alert.occurredAt || ''),
    lastSeenAt: String(alert.lastSeenAt || alert.occurredAt || ''),
    occurrenceCount: Math.max(1, Number(alert.occurrenceCount || 1)),
    recoveryRequired: alert.recoveryRequired === true,
    cleanupRequired: alert.cleanupRequired === true,
    backupSheetNames: normalizeRecoveryBackupNames_(alert.backupSheetNames),
    manualActionRequired: true
  }));
  return { status: openAlerts.length > 0 ? 'WARN' : 'OK', openCount: openAlerts.length, alerts: openAlerts };
}

function acknowledgeOrderRecoveryAlert(data) {
  const alertId = String(data && data.alertId || '').trim();
  if (!/^REC-[A-Z0-9]{12}$/.test(alertId)) return { success: false, message: '복구 경고 식별자가 올바르지 않습니다.' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { success: false, message: '다른 주문 작업을 처리 중입니다. 잠시 후 다시 시도해 주세요.' };
  try {
    const alerts = loadOrderRecoveryAlerts_();
    const alert = alerts.find(item => item && item.alertId === alertId && item.status === 'OPEN');
    if (!alert) return { success: false, message: '열려 있는 복구 경고를 찾을 수 없습니다.' };
    alert.status = 'RESOLVED';
    alert.resolvedAt = new Date().toISOString();
    saveOrderRecoveryAlerts_(alerts);
    safeAppendAdminLog('acknowledgeOrderRecoveryAlert', 'recoveryAlert', alertId, '', 'OPEN', 'RESOLVED', '수동 조치 확인 완료');
    return { success: true, alertId, message: '복구 경고를 확인 완료로 처리했습니다.' };
  } finally {
    lock.releaseLock();
  }
}
