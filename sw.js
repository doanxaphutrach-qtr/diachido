/**
 * Service Worker — Địa Chỉ Đỏ xã Phú Trạch
 * ────────────────────────────────────────────
 * Chiến lược cache:
 *   - Static assets (_next/static/): Cache-First (immutable, hashed filenames)
 *   - Fonts (Google Fonts):          Cache-First (hiếm khi thay đổi)
 *   - Images (png, jpg, svg, webp):  Stale-While-Revalidate
 *   - API / GViz:                    Network-Only (dữ liệu real-time)
 *   - Navigation (HTML pages):       Network-First (luôn lấy mới nhất, fallback offline)
 */

const CACHE_VERSION = 'diachido-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Assets to pre-cache on install (shell)
const PRECACHE_URLS = [
  '/',
];

// ── Install ────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate — xóa cache cũ ────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch — routing strategies ─────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension, blob, etc.
  if (!url.protocol.startsWith('http')) return;

  // ── 1. API / GViz / Google Script → Network-Only ──
  if (
    url.hostname.includes('docs.google.com') ||
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('accounts.google.com') ||
    url.pathname.includes('/gviz/')
  ) {
    return; // Let browser handle normally
  }

  // ── 2. Static assets (JS/CSS with hash) → Cache-First ──
  if (
    url.pathname.includes('/_next/static/') ||
    url.hostname.includes('cdn.jsdelivr.net')
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // ── 3. Google Fonts → Cache-First ──
  if (
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // ── 4. Images → Stale-While-Revalidate ──
  if (request.destination === 'image' || /\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // ── 5. Navigation (HTML pages) → Network-First ──
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

  // ── 6. Everything else → Network-First ──
  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

// ── Cache Strategies ───────────────────────────────────────

// Cache-First: Ưu tiên cache, chỉ fetch nếu cache miss
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

// Network-First: Ưu tiên mạng, fallback cache nếu offline
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

// Stale-While-Revalidate: Trả cache ngay, fetch update ngầm
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || (await fetchPromise) || new Response('Offline', { status: 503 });
}
