(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  let refreshing = false;

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' })
      .then(function (registration) {
        document.documentElement.dataset.pwaRegistration = 'ready';
        return registration.update().catch(function () {
          return registration;
        });
      })
      .catch(function (error) {
        document.documentElement.dataset.pwaRegistration = 'error';
        console.error('[Service Worker] 가이드 화면 등록 실패:', error);
      });
  });

  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
})();
