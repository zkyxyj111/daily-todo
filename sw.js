/* Service Worker：离线缓存；代码类资源(js/css/html)走“网络优先”，保证改代码后即时生效 */
const CACHE = 'todo-v5';
const ASSETS = ['./', './index.html', './style.css', './app.js', './manifest.json', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  if(e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if(url.origin !== location.origin) return; // Supabase 请求不走缓存
  const isCode = /\.(js|css|html?)$/.test(url.pathname) || url.pathname.endsWith('/');
  if(isCode){
    // 网络优先：联网取最新；失败（离线）才回退缓存
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(()=>{});
          return resp;
        })
        .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
    );
    return;
  }
  // 其它静态资源：缓存优先
  e.respondWith(
    caches.match(e.request)
      .then(r => r || fetch(e.request)
        .then(resp => { const copy = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(()=>{}); return resp; })
        .catch(() => caches.match('./index.html')))
  );
});
