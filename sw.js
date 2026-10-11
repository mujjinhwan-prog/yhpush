// =====================================================================
//  VOY Push — Service Worker
//  푸시 수신 → 알림 표시 / 알림 클릭 → 링크로 이동
// =====================================================================
importScripts("config.js");
const CFG = self.PUSH_CONFIG || {};
const FN_URL = (CFG.SUPABASE_URL || "") + "/functions/v1/push";
const SW_VERSION = "1.1.0";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; }
  catch { d = { body: event.data ? event.data.text() : "" }; }

  const title = d.title || CFG.APP_NAME || "알림";
  const options = {
    body: d.body || "",
    icon: d.icon || CFG.DEFAULT_ICON || "icons/icon-192.png",
    badge: "icons/badge-72.png",          // 안드로이드 상단바 작은 아이콘
    data: { url: d.url || "", id: d.id || null },
    tag: d.tag || undefined,
    renotify: !!d.tag,
    timestamp: Date.now(),
  };
  if (d.image) options.image = d.image;   // 안드로이드: 큰 이미지

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { url, id } = event.notification.data || {};
  const target = url || new URL("./index.html", self.registration.scope).href;

  event.waitUntil((async () => {
    if (id) {
      fetch(FN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: CFG.SUPABASE_ANON_KEY, Authorization: "Bearer " + CFG.SUPABASE_ANON_KEY },
        body: JSON.stringify({ action: "click", id }),
      }).catch(() => {});
    }
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (w.url === target && "focus" in w) return w.focus();
    }
    return self.clients.openWindow(target);
  })());
});

// 브라우저가 구독을 갱신했을 때 서버에 새 구독 등록
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const key = CFG.VAPID_PUBLIC_KEY.replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(key + "===".slice((key.length + 3) % 4));
    const appKey = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    await fetch(FN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: CFG.SUPABASE_ANON_KEY, Authorization: "Bearer " + CFG.SUPABASE_ANON_KEY },
      body: JSON.stringify({
        action: "subscribe",
        subscription: sub.toJSON(),
        old_endpoint: event.oldSubscription ? event.oldSubscription.endpoint : "",
      }),
    });
  })());
});
