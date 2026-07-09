// MetaGuard service worker — 앱 셸/에셋 오프라인 캐시.
// HTML(문서)은 network-first 로 항상 최신을 받고, 실패 시에만 캐시로 폴백한다.
// 지문(uuid) 붙은 정적 자산(woff2/jpg/js)만 cache-first. AI(/api/*)는 절대 캐시하지 않는다.
const VERSION = 'mg-v11';
const CORE = [
  './',
  './index.html',
  './assets/mg-data.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // API 및 비-GET은 항상 네트워크 (캐시 금지)
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return; // 기본 네트워크 처리
  }

  // HTML 문서(네비게이션): network-first → 항상 최신 화면, 오프라인이면 캐시 폴백
  const isDoc = req.mode === 'navigate' || req.destination === 'document' ||
    (req.headers.get('accept') || '').includes('text/html');
  if (isDoc) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
        }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // 그 외 정적 자산(지문 파일): cache-first, 성공 시 런타임 캐시에 저장
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok && (res.type === 'basic' || res.type === 'default')) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
    })
  );
});
