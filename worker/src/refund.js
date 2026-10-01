/**
 * Refund consumption reporting (2026-10-01).
 *
 * When a customer asks Apple to refund the cardlio unlock, Apple sends this
 * Worker a CONSUMPTION_REQUEST (App Store Server Notifications V2) and gives
 * it 12 hours to say whether the purchase was delivered and used (App Store
 * Server API, Send Consumption Information V2 — non-consumables included).
 * Apple decides; this answer is one of its inputs.
 *
 *   POST /purchase  from the app: { transactionId, purchaseDateMs, bundleId,
 *                   environment, consumed } or { …, withdraw: true }
 *   POST /asn       from Apple:   { signedPayload }
 *
 * WHAT IS STORED (KV `PURCHASES`, key `tx:<transactionId>`, expires after
 * 400 days): that the buyer consented, whether the unlock was used, and two
 * dates. No card, no count, no name, no device. The app sends it only with
 * the buyer's consent and deletes it when consent is withdrawn; a refund
 * deletes it too.
 *
 * TRUST. `/purchase` is believed only if Apple confirms the transaction
 * exists for our app and product AND the caller knows its purchase time to
 * the millisecond — something only the buyer's device holds (transaction
 * ids alone are guessable). `/asn` takes nothing on faith either: whatever
 * the notification says, the only thing done is a call to Apple about that
 * transaction, and Apple refuses consumption data it did not ask for.
 *
 * Secrets:  IAP_KEY_P8 (In-App Purchase key, PEM), IAP_KEY_ID, IAP_ISSUER_ID
 * Binding:  PURCHASES (KV namespace)
 */

const HOSTS = {
  Production: "https://api.storekit.apple.com",
  Sandbox: "https://api.storekit-sandbox.apple.com",
};

/** bundle id → the unlock product sold in that app. */
export const PRODUCTS = {
  "gruenitz.CardOCR---iOS": "app.cardlio.ios.unlock",
  "gruenitz.CardOCR": "app.cardlio.mac.unlock",
};

const RECORD_TTL = 400 * 24 * 60 * 60;   // seconds

// ---------------------------------------------------------------- helpers

function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlJSON(obj) { return b64url(new TextEncoder().encode(JSON.stringify(obj))); }

/** The payload of a JWS, NOT verified — see TRUST above. */
export function decodeJWSPayload(jws) {
  const part = String(jws || "").split(".")[1];
  if (!part) return null;
  try {
    const bin = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch { return null; }
}

function configured(env) {
  return !!(env.PURCHASES && env.IAP_KEY_P8 && env.IAP_KEY_ID && env.IAP_ISSUER_ID);
}

/** ES256 token for the App Store Server API (aud appstoreconnect-v1, bid = bundle id). */
export async function appleJWT(env, bundleId, now = Math.floor(Date.now() / 1000)) {
  const der = Uint8Array.from(atob(env.IAP_KEY_P8.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64urlJSON({ alg: "ES256", kid: env.IAP_KEY_ID, typ: "JWT" });
  const body = b64urlJSON({ iss: env.IAP_ISSUER_ID, iat: now, exp: now + 300, aud: "appstoreconnect-v1", bid: bundleId });
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(head + "." + body));
  return head + "." + body + "." + b64url(sig);
}

async function apple(env, bundleId, environment, method, path, body) {
  return fetch((HOSTS[environment] || HOSTS.Production) + path, {
    method,
    headers: Object.assign({ Authorization: "Bearer " + (await appleJWT(env, bundleId)) }, body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Apple's record of a transaction, trying the hinted environment first. */
async function lookUp(env, bundleId, transactionId, hint) {
  const order = hint === "Sandbox" ? ["Sandbox", "Production"] : ["Production", "Sandbox"];
  for (const environment of order) {
    const res = await apple(env, bundleId, environment, "GET", "/inApps/v1/transactions/" + transactionId);
    if (res.status === 200) {
      const info = decodeJWSPayload((await res.json()).signedTransactionInfo);
      if (info) return { info, environment };
    } else if (res.status !== 404 && res.status !== 400) {
      throw new Error("apple " + res.status);
    }
  }
  return null;
}

/**
 * What to tell Apple, or null for "do not answer" (no consent on record —
 * Apple's rule). The owner's rule: past the free limit the value has been
 * taken, so prefer a decline; an unlock that was never used should be
 * refunded. The ten free cards are the sample before purchase.
 */
export function consumptionBody(record) {
  if (!record || record.consented !== true) return null;
  const used = record.consumed === true;
  return {
    customerConsented: true,
    deliveryStatus: "DELIVERED",
    sampleContentProvided: true,
    consumptionPercentage: used ? 100000 : 0,
    refundPreference: used ? "DECLINE" : "GRANT_FULL",
  };
}

const text = (body, status) => new Response(body, { status });

// ------------------------------------------------------------ POST /purchase

export async function handlePurchase(request, env) {
  if (!configured(env)) return text("not configured", 503);
  if (env.SIGN_LIMIT) {
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const { success } = await env.SIGN_LIMIT.limit({ key: "purchase:" + ip });
    if (!success) return text("rate limited", 429);
  }
  let b;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return text("payload too large", 413);
    b = JSON.parse(raw);
  } catch { return text("bad json", 400); }
  const id = String(b.transactionId || "");
  if (!/^\d{1,20}$/.test(id) || !Number.isInteger(b.purchaseDateMs) || !PRODUCTS[b.bundleId]) return text("bad request", 400);

  let found;
  try { found = await lookUp(env, b.bundleId, id, b.environment); }
  catch { return text("store unavailable", 502); }
  const tx = found && found.info;
  // One answer for every mismatch: a prober learns nothing about which part was wrong.
  if (!tx || tx.bundleId !== b.bundleId || tx.productId !== PRODUCTS[b.bundleId] ||
      String(tx.originalTransactionId) !== id || tx.inAppOwnershipType !== "PURCHASED" ||
      (tx.originalPurchaseDate !== b.purchaseDateMs && tx.purchaseDate !== b.purchaseDateMs)) {
    return text("not found", 404);
  }
  const key = "tx:" + id;
  if (tx.revocationDate || b.withdraw === true) {
    await env.PURCHASES.delete(key);
    return new Response(null, { status: 204 });
  }
  const now = new Date().toISOString();
  const old = await env.PURCHASES.get(key, "json");
  const consumed = (old && old.consumed === true) || b.consumed === true;
  const record = {
    consented: true,
    consumed,
    registeredAt: (old && old.registeredAt) || now,
    consumedAt: consumed ? ((old && old.consumedAt) || now) : null,
  };
  await env.PURCHASES.put(key, JSON.stringify(record), { expirationTtl: RECORD_TTL });
  return new Response(null, { status: 204 });
}

// ----------------------------------------------------------------- POST /asn

export async function handleNotification(request, env) {
  if (!configured(env)) return text("not configured", 503);
  // Apple sends notifications from 17.0.0.0/8 (documented); anything else is noise.
  const ip = request.headers.get("cf-connecting-ip") || "";
  if (!ip.startsWith("17.") && !env.ASN_ALLOW_ANY_IP) return text("forbidden", 403);
  let payload;
  try { payload = decodeJWSPayload((await request.json()).signedPayload); } catch { payload = null; }
  if (!payload || !payload.notificationType) return text("bad request", 400);
  const type = payload.notificationType;
  const data = payload.data || {};
  const tx = decodeJWSPayload(data.signedTransactionInfo) || {};
  const bundleId = data.bundleId;
  if (!PRODUCTS[bundleId] || !/^\d{1,20}$/.test(String(tx.transactionId || ""))) {
    console.log("asn " + type + ": nothing to do");
    return text("ok", 200);
  }
  const key = "tx:" + String(tx.originalTransactionId || tx.transactionId);

  if (type === "REFUND" || type === "REVOKE") {
    await env.PURCHASES.delete(key);          // the purchase is gone; so is our note about it
    console.log("asn " + type + ": record removed");
    return text("ok", 200);
  }
  if (type !== "CONSUMPTION_REQUEST") {
    console.log("asn " + type + ": ignored");
    return text("ok", 200);
  }

  const body = consumptionBody(await env.PURCHASES.get(key, "json"));
  if (!body) {
    console.log("asn CONSUMPTION_REQUEST: no consent on record — not answered");
    return text("ok", 200);
  }
  const environment = data.environment === "Sandbox" ? "Sandbox" : "Production";
  let res;
  try { res = await apple(env, bundleId, environment, "PUT", "/inApps/v2/transactions/consumption/" + tx.transactionId, body); }
  catch { return text("store unavailable", 500); }        // Apple retries the notification
  console.log("asn CONSUMPTION_REQUEST: answered " + body.refundPreference + ", apple " + res.status);
  if (res.status === 202) return text("ok", 200);
  // 401 / 429 / 5xx may heal before Apple's next attempt (an hour later,
  // inside the 12-hour window); a 400 / 404 will not.
  return text(res.status >= 500 || res.status === 429 || res.status === 401 ? "retry" : "ok",
              res.status >= 500 || res.status === 429 || res.status === 401 ? 500 : 200);
}
