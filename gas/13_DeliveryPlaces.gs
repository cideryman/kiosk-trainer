const DELIVERY_ALIAS_HEADERS = ['alias', 'canonicalPlace', 'enabled', 'updatedAt'];
const DELIVERY_ALIAS_CACHE_KEY = 'deliveryPlaceAliases.v1';
const DELIVERY_ALIAS_CACHE_TTL_SECONDS = 300;

function ensureDeliveryPlaceAliasSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET.DELIVERY_ALIASES);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET.DELIVERY_ALIASES);
    sheet.getRange(1, 1, 1, DELIVERY_ALIAS_HEADERS.length).setValues([DELIVERY_ALIAS_HEADERS]);
  }
  return sheet;
}

function normalizeDeliveryPlaceText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getDeliveryPlaceAliasCache() {
  try {
    const cached = CacheService.getScriptCache().get(DELIVERY_ALIAS_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    Logger.log('delivery alias cache read failed: ' + (error && error.stack ? error.stack : error));
    return null;
  }
}

function clearDeliveryPlaceAliasCache() {
  try {
    CacheService.getScriptCache().remove(DELIVERY_ALIAS_CACHE_KEY);
  } catch (error) {
    Logger.log('delivery alias cache clear failed: ' + (error && error.stack ? error.stack : error));
  }
}

function readDeliveryPlaceAliases() {
  const sheet = ensureDeliveryPlaceAliasSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0].map(value => String(value || '').trim());
  const indexOf = (name, fallback) => {
    const index = headers.indexOf(name);
    return index >= 0 ? index : fallback;
  };
  const aliasIndex = indexOf('alias', 0);
  const canonicalIndex = indexOf('canonicalPlace', 1);
  const enabledIndex = indexOf('enabled', 2);
  const updatedIndex = indexOf('updatedAt', 3);

  return values.slice(1).map(row => ({
    alias: normalizeDeliveryPlaceText(row[aliasIndex]),
    canonicalPlace: normalizeDeliveryPlaceText(row[canonicalIndex]),
    enabled: String(row[enabledIndex] == null ? 'TRUE' : row[enabledIndex]).toUpperCase() !== 'FALSE',
    updatedAt: row[updatedIndex] || ''
  })).filter(item => item.alias && item.canonicalPlace);
}

function getDeliveryPlaceAliases() {
  const cached = getDeliveryPlaceAliasCache();
  if (cached) return { success: true, aliases: cached };

  const aliases = readDeliveryPlaceAliases();
  try {
    CacheService.getScriptCache().put(
      DELIVERY_ALIAS_CACHE_KEY,
      JSON.stringify(aliases),
      DELIVERY_ALIAS_CACHE_TTL_SECONDS
    );
  } catch (error) {
    Logger.log('delivery alias cache write failed: ' + (error && error.stack ? error.stack : error));
  }
  return { success: true, aliases };
}

function updateDeliveryPlaceAliases(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const input = Array.isArray(data && data.aliases) ? data.aliases : [];
    const seenAliases = {};
    const normalized = input.map(item => ({
      alias: normalizeDeliveryPlaceText(item && item.alias),
      canonicalPlace: normalizeDeliveryPlaceText(item && item.canonicalPlace),
      enabled: item && item.enabled !== false,
    })).filter(item => item.alias || item.canonicalPlace);

    for (const item of normalized) {
      if (!item.alias || !item.canonicalPlace) {
        return { success: false, message: '배송지 별칭과 대표 배송지명을 모두 입력해 주세요.' };
      }
      if (item.alias.length > 80 || item.canonicalPlace.length > 80) {
        return { success: false, message: '배송지명은 80자 이내로 입력해 주세요.' };
      }
      const aliasKey = item.alias;
      if (seenAliases[aliasKey] && seenAliases[aliasKey] !== item.canonicalPlace) {
        return { success: false, message: `별칭 '${item.alias}'이 서로 다른 배송지에 연결되어 있습니다.` };
      }
      seenAliases[aliasKey] = item.canonicalPlace;
    }

    const sheet = ensureDeliveryPlaceAliasSheet();
    const now = new Date();
    const rows = normalized.map(item => [item.alias, item.canonicalPlace, item.enabled ? 'TRUE' : 'FALSE', now]);
    const oldRows = Math.max(sheet.getLastRow() - 1, 0);
    if (oldRows > 0) sheet.getRange(2, 1, oldRows, DELIVERY_ALIAS_HEADERS.length).clearContent();
    if (rows.length > 0) sheet.getRange(2, 1, rows.length, DELIVERY_ALIAS_HEADERS.length).setValues(rows);

    clearDeliveryPlaceAliasCache();
    safeAppendAdminLog('updateDeliveryPlaceAliases', 'settings', SHEET.DELIVERY_ALIASES, '배송지 별칭', '', `${rows.length}건`, data.adminMemo);
    return { success: true, aliases: normalized, message: '배송지 별칭을 저장했습니다.' };
  } finally {
    lock.releaseLock();
  }
}
