/**
 * 관리자 화면 초기 데이터를 한 번의 Apps Script 실행으로 조회합니다.
 */
function getAdminDashboard() {
  const snacks = getSnacks('Y');
  const users = getUsers('Y');

  return {
    success: snacks && snacks.success !== false,
    snacks,
    users,
  };
}

/**
 * 주방 화면 초기 데이터를 한 번의 Apps Script 실행으로 조회합니다.
 */
function getKitchenDashboard() {
  const orders = getOrdersToday();
  const users = getUsers('Y');
  const snacks = getSnacks();
  const guestSettings = getGuestSettings();

  return {
    success: orders && orders.success !== false,
    orders,
    users,
    snacks,
    guestSettings,
  };
}
