// =====================================================================
//  VOY Push — Supabase Edge Function  (함수 이름: push)
//  외부 라이브러리 없이 Web Push(RFC 8291 + VAPID)를 직접 처리합니다.
//
//  필요한 Secrets (Supabase 대시보드 > Edge Functions > Secrets):
//    VAPID_PUBLIC_KEY   : setup.html 에서 만든 공개키
//    VAPID_PRIVATE_KEY  : setup.html 에서 만든 개인키
//    VAPID_SUBJECT      : mailto:본인메일주소   (예: mailto:admin@ourclinic.kr)
//    ADMIN_KEY          : 관리자 페이지 비밀번호 (아무 긴 문자열)
//  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 자동으로 제공됩니다.
//
//  배포 시 "Verify JWT" 옵션은 끄세요 (구독 페이지가 로그인 없이 호출합니다).
// =====================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

// ==== WEBPUSH CORE START ====
const enc = new TextEncoder();

function b64uToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64u(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

async function importVapidKey(publicB64u: string, privateB64u: string): Promise<CryptoKey> {
  const pub = b64uToBytes(publicB64u);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID_PUBLIC_KEY 형식이 올바르지 않습니다");
  const jwk = {
    kty: "EC", crv: "P-256", ext: true,
    x: bytesToB64u(pub.slice(1, 33)),
    y: bytesToB64u(pub.slice(33, 65)),
    d: privateB64u,
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function vapidJWT(endpoint: string, key: CryptoKey, subject: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = bytesToB64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToB64u(enc.encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject,
  })));
  const unsigned = `${header}.${claims}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned)));
  return `${unsigned}.${bytesToB64u(sig)}`;
}

// RFC 8291 (aes128gcm) 페이로드 암호화
async function encryptPayload(p256dhB64u: string, authB64u: string, plaintext: Uint8Array): Promise<Uint8Array> {
  const uaPublic = b64uToBytes(p256dhB64u);
  const authSecret = b64uToBytes(authB64u);

  const asKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256));

  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hmac(prkKey, concat(keyInfo, new Uint8Array([1])));

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const padded = concat(plaintext, new Uint8Array([2])); // 마지막 레코드 구분자
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded));

  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = 65;
  header.set(asPublic, 21);
  return concat(header, ct);
}

type Sub = { endpoint: string; p256dh: string; auth: string };

async function sendWebPush(
  sub: Sub, payload: string,
  vapid: { key: CryptoKey; publicKey: string; subject: string },
  jwtCache: Map<string, string>,
  ttl = 86400,
): Promise<number> {
  const aud = new URL(sub.endpoint).origin;
  let jwt = jwtCache.get(aud);
  if (!jwt) { jwt = await vapidJWT(sub.endpoint, vapid.key, vapid.subject); jwtCache.set(aud, jwt); }
  const body = await encryptPayload(sub.p256dh, sub.auth, enc.encode(payload));
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": String(ttl),
      "Urgency": "high",
      "Authorization": `vapid t=${jwt}, k=${vapid.publicKey}`,
    },
    body,
  });
  await res.body?.cancel();
  return res.status;
}
// ==== WEBPUSH CORE END ====

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

let vapidCache: { key: CryptoKey; publicKey: string; subject: string } | null = null;
async function getVapid() {
  if (!vapidCache) {
    vapidCache = {
      key: await importVapidKey(env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY")),
      publicKey: env("VAPID_PUBLIC_KEY"),
      subject: env("VAPID_SUBJECT") || "mailto:admin@example.com",
    };
  }
  return vapidCache;
}

function isAdmin(req: Request): boolean {
  const given = req.headers.get("x-admin-key") ?? "";
  const real = env("ADMIN_KEY");
  if (!real || given.length !== real.length) return false;
  let diff = 0;
  for (let i = 0; i < real.length; i++) diff |= given.charCodeAt(i) ^ real.charCodeAt(i);
  return diff === 0;
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const safeUrl = (v: unknown) => {
  const s = clip(v, 1000);
  if (!s) return "";
  try { const u = new URL(s); return u.protocol === "https:" || u.protocol === "http:" ? u.href : ""; }
  catch { return ""; }
};

// 여러 구독자에게 발송 (동시 30건씩)
async function fanOut(subs: (Sub & { id: number })[], payload: string) {
  const vapid = await getVapid();
  const jwtCache = new Map<string, string>();
  let sent = 0, failed = 0;
  const dead: number[] = [];
  for (let i = 0; i < subs.length; i += 30) {
    const batch = subs.slice(i, i + 30);
    const results = await Promise.allSettled(batch.map((s) => sendWebPush(s, payload, vapid, jwtCache)));
    results.forEach((r, j) => {
      if (r.status === "fulfilled" && r.value >= 200 && r.value < 300) sent++;
      else {
        failed++;
        if (r.status === "fulfilled" && (r.value === 404 || r.value === 410)) dead.push(batch[j].id);
      }
    });
  }
  if (dead.length) await db.from("push_subscriptions").delete().in("id", dead);
  return { sent, failed, removed: dead.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { return json({ error: "잘못된 요청" }, 400); }
  const action = body.action;

  try {
    // ---------- 구독자용 (로그인 불필요) ----------
    if (action === "subscribe") {
      const s = body.subscription;
      const endpoint = safeUrl(s?.endpoint);
      const p256dh = clip(s?.keys?.p256dh, 200);
      const auth = clip(s?.keys?.auth, 100);
      if (!endpoint.startsWith("https://") || !p256dh || !auth) return json({ error: "구독 정보가 올바르지 않습니다" }, 400);
      const { error } = await db.from("push_subscriptions").upsert({
        endpoint, p256dh, auth,
        name: clip(body.name, 40) || null,
        grp: clip(body.grp, 40) || null,
        user_agent: clip(req.headers.get("user-agent"), 300),
        last_seen: new Date().toISOString(),
      }, { onConflict: "endpoint" });
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "unsubscribe") {
      const endpoint = safeUrl(body.endpoint);
      if (endpoint) await db.from("push_subscriptions").delete().eq("endpoint", endpoint);
      return json({ ok: true });
    }

    if (action === "test") {
      // 본인 기기로 테스트 알림 (등록된 구독만)
      const endpoint = safeUrl(body.endpoint);
      const { data } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("endpoint", endpoint).limit(1);
      if (!data?.length) return json({ error: "등록된 구독이 없습니다" }, 404);
      const payload = JSON.stringify({
        title: clip(body.title, 60) || "알림 테스트",
        body: "이 알림이 보이면 설정이 완료된 것입니다 ✅",
        url: safeUrl(body.url) || "",
        tag: "test",
      });
      const r = await fanOut(data, payload);
      return json({ ok: r.sent > 0, ...r });
    }

    if (action === "click") {
      const id = Number(body.id);
      if (Number.isInteger(id) && id > 0) await db.rpc("push_increment_click", { mid: id });
      return json({ ok: true });
    }

    // ---------- 관리자용 (x-admin-key 필요) ----------
    if (!isAdmin(req)) return json({ error: "관리자 키가 올바르지 않습니다" }, 401);

    if (action === "stats") {
      const { data: subs, error } = await db.from("push_subscriptions").select("grp");
      if (error) throw error;
      const groups: Record<string, number> = {};
      for (const s of subs ?? []) { const g = s.grp || "미지정"; groups[g] = (groups[g] || 0) + 1; }
      const { data: messages } = await db.from("push_messages")
        .select("*").order("created_at", { ascending: false }).limit(30);
      return json({ total: subs?.length ?? 0, groups, messages: messages ?? [] });
    }

    if (action === "subscribers") {
      const { data } = await db.from("push_subscriptions")
        .select("id, name, grp, user_agent, created_at, last_seen").order("created_at", { ascending: false }).limit(500);
      return json({ subscribers: data ?? [] });
    }

    if (action === "remove_subscriber") {
      const id = Number(body.id);
      if (Number.isInteger(id)) await db.from("push_subscriptions").delete().eq("id", id);
      return json({ ok: true });
    }

    if (action === "send") {
      const title = clip(body.title, 80);
      const text = clip(body.body, 300);
      if (!title) return json({ error: "제목을 입력하세요" }, 400);
      const url = safeUrl(body.url);
      const icon = clip(body.icon, 500);
      const image = safeUrl(body.image);
      const target = clip(body.target, 40) || "전체";

      const { data: msg, error: mErr } = await db.from("push_messages")
        .insert({ title, body: text, url, icon, image, target }).select("id").single();
      if (mErr) throw mErr;

      let q = db.from("push_subscriptions").select("id, endpoint, p256dh, auth");
      if (target !== "전체") q = q.eq("grp", target);
      const { data: subs, error: sErr } = await q;
      if (sErr) throw sErr;

      const payload = JSON.stringify({ id: msg.id, title, body: text, url, icon, image, tag: `m${msg.id}` });
      const r = await fanOut(subs ?? [], payload);
      await db.from("push_messages").update({ sent: r.sent, failed: r.failed, removed: r.removed }).eq("id", msg.id);
      return json({ ok: true, id: msg.id, total: subs?.length ?? 0, ...r });
    }

    return json({ error: "알 수 없는 action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
