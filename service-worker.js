const CACHE_NAME = 'kiosk-cache-v210';
const urlsToCache = [
  'index.html',
  'index.html?type=kiosk',
  'menu.html',
  'menu.html?browse=guest',
  'confirm.html',
  'complete.html',
  'admin.html',
  'kitchen.html',
  'reviews.html',
  'guest.html',
  'guest-apply.html',
  'guest-orders.html',
  'board.html',
  'print-bills.html',
  'css/style.css',
  'js/app.js',
  'js/config.js',
  'manifest-kiosk.json',
  'manifest-admin.json',
  'manifest-kitchen.json',
  'manifest-reviews.json',
  'manifest-board.json',
  'manifest-guest.json',
  'icons/kiosk-192.png',
  'icons/kiosk-512.png',
  'icons/kiosk-180.png',
  'icons/guest-192.png',
  'icons/guest-512.png',
  'icons/guest-180.png',
  'icons/admin-192.png',
  'icons/admin-512.png',
  'icons/admin-180.png',
  'icons/icon-board.png',
  'assets/store-logo.png',
  'assets/delivery-banner.png',
  'assets/store-banner.png',
  'assets/offline.png',
  'assets/closed-character.png',
  'assets/meaning-1.jpg',
  'assets/meaning-2.jpg',
  'assets/meaning-3.jpg',
  'sounds/new-order.mp3',
  'sounds/new-pickup-order.mp3',
  'sounds/new-delivery-order.mp3'
];

// 서비스 워커 설치 및 캐싱
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] 정적 파일 캐싱 진행');
        // 브라우저 HTTP 캐시를 우회하기 위해 타임스탬프를 쿼리에 추가해 새로 받아 캐시에 넣습니다.
        const cachePromises = urlsToCache.map((url) => {
          const separator = url.includes('?') ? '&' : '?';
          const cacheBustedUrl = `${url}${separator}_cb=${Date.now()}`;
          return fetch(cacheBustedUrl).then((response) => {
            if (!response.ok) {
              throw new TypeError(`Request failed for: ${url}`);
            }
            return cache.put(url, response); // 깨끗한 URL 키로 저장
          });
        });
        return Promise.all(cachePromises);
      })
      .then(() => self.skipWaiting())
  );
});

// 서비스 워커 활성화 및 구버전 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] 이전 캐시 삭제:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 요청 가로채기 및 캐싱 전략 적용
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // HTTP/HTTPS 프로토콜만 캐싱을 처리하도록 필터링 (chrome-extension 등 오류 방지)
  if (!requestUrl.protocol.startsWith('http')) {
    return;
  }

  // 구글 Apps Script API 요청은 캐시하지 않고, 서비스 워커가 개입하지 않고 브라우저가 직접 처리하도록 반환합니다.
  // (CORS 및 리다이렉트 이슈 방지)
  if (
    requestUrl.href.includes('script.google.com') ||
    requestUrl.href.includes('script.googleusercontent.com') ||
    requestUrl.searchParams.has('action')
  ) {
    return;
  }

  // 정적 리소스는 캐시 우선(Cache-First) 전략 적용 후 캐시가 없으면 네트워크에서 로드
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response; // 캐시된 데이터 반환
        }

        return fetch(event.request).then((fetchResponse) => {
          // 유효하지 않은 응답은 그냥 그대로 반환
          if (!fetchResponse || fetchResponse.status !== 200 || fetchResponse.type !== 'basic') {
            return fetchResponse;
          }

          // 새로 받은 정적 파일을 캐시에 추가
          const responseToCache = fetchResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return fetchResponse;
        });
      })
  );
});
