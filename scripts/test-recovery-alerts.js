const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const values = {};
let uuid = 0;
const context = {
  console,
  Date,
  Logger: { log: () => {} },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  Utilities: { getUuid: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: key => values[key] || null,
    setProperty: (key, value) => { values[key] = String(value); }
  }) },
  safeAppendAdminLog: () => {}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'gas/03_RecoveryAlerts.gs'), 'utf8'), context);

const first = context.recordOrderRecoveryAlert_({
  orderNo: 'ORD-1', stage: 'CANCEL_ROLLBACK', recoveryRequired: true,
  cleanupRequired: true, backupSheetNames: ['주문내역_백업', '간식목록_백업']
});
assert(first.alertId.startsWith('REC-'));
assert.equal(context.getOrderRecoveryAlertsSummary_().openCount, 1);

context.recordOrderRecoveryAlert_({
  orderNo: 'ORD-1', stage: 'CANCEL_ROLLBACK', recoveryRequired: true,
  cleanupRequired: true, backupSheetNames: ['간식목록_백업', '주문내역_백업']
});
let summary = context.getOrderRecoveryAlertsSummary_();
assert.equal(summary.openCount, 1, '동일 경고 중복 방지');
assert.equal(summary.alerts[0].occurrenceCount, 2);
assert(!JSON.stringify(summary).includes('token'));
assert(!JSON.stringify(summary).includes('nickname'));

assert.equal(context.acknowledgeOrderRecoveryAlert({ alertId: first.alertId }).success, true);
assert.equal(context.getOrderRecoveryAlertsSummary_().openCount, 0, '확인 완료 경고 제외');
assert.equal(context.acknowledgeOrderRecoveryAlert({ alertId: first.alertId }).success, false, '중복 종료 차단');

const config = fs.readFileSync(path.join(root, 'gas/00_Config.gs'), 'utf8');
const router = fs.readFileSync(path.join(root, 'gas/01_Router.gs'), 'utf8');
const diagnostics = fs.readFileSync(path.join(root, 'gas/90_Diagnostics.gs'), 'utf8');
assert(config.includes("'acknowledgeOrderRecoveryAlert'"));
assert(router.includes("action === 'acknowledgeOrderRecoveryAlert'"));
assert(diagnostics.includes('getOrderRecoveryAlertsSummary_()'));

console.log('P109 recovery alert tests passed: persistence, dedupe, privacy, diagnosis, acknowledgement');
