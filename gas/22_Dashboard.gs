/**
 * 관리자 화면 초기 데이터를 한 번의 Apps Script 실행으로 조회합니다.
 */
function measureDashboardStep(timings, name, callback) {
  const startedAt = Date.now();
  const result = callback();
  timings[name] = Date.now() - startedAt;
  return result;
}

function shouldIncludeDashboardTimings(perfDebug) {
  return String(perfDebug || '').trim() === '1';
}

function getAdminDashboard(perfDebug) {
  const startedAt = Date.now();
  const timings = {};
  const snacks = measureDashboardStep(timings, 'getSnacks', () => getSnacks('Y'));
  const users = measureDashboardStep(timings, 'getUsers', () => getUsers('Y'));

  const response = {
    success: snacks && snacks.success !== false,
    snacks,
    users,
  };
  if (shouldIncludeDashboardTimings(perfDebug)) {
    timings.total = Date.now() - startedAt;
    response._timings = timings;
  }
  return response;
}

/**
 * 주방 화면 초기 데이터를 한 번의 Apps Script 실행으로 조회합니다.
 */
function getKitchenDashboard(perfDebug) {
  const startedAt = Date.now();
  const timings = {};
  const orders = measureDashboardStep(timings, 'getOrdersToday', () => getOrdersToday());
  const users = measureDashboardStep(timings, 'getUsers', () => getUsers('Y'));
  const snacks = measureDashboardStep(timings, 'getSnacks', () => getSnacks());
  const guestSettings = measureDashboardStep(timings, 'getGuestSettings', () => getGuestSettings());

  const response = {
    success: orders && orders.success !== false,
    orders,
    users,
    snacks,
    guestSettings,
  };
  if (shouldIncludeDashboardTimings(perfDebug)) {
    timings.total = Date.now() - startedAt;
    response._timings = timings;
  }
  return response;
}
