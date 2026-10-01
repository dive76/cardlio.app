// node --test test/     (Node 20+: WebCrypto, fetch and Response are global)
import test from "node:test";
import assert from "node:assert/strict";
import { appleJWT, consumptionBody, decodeJWSPayload, handlePurchase, handleNotification } from "../src/refund.js";

const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jws = (payload) => "h." + enc(payload) + ".s";

async function makeEnv() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
  const store = new Map();
  return {
    pair,
    IAP_KEY_P8: "-----BEGIN PRIVATE KEY-----\n" + pkcs8.match(/.{1,64}/g).join("\n") + "\n-----END PRIVATE KEY-----\n",
    IAP_KEY_ID: "TESTKEY123", IAP_ISSUER_ID: "issuer-uuid",
    PURCHASES: {
      store,
      get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null),
      put: async (k, v, o) => { store.set(k, v); store.lastOptions = o; },
      delete: async (k) => { store.delete(k); },
    },
  };
}
const TX = { transactionId: "2000000111", originalTransactionId: "2000000111", bundleId: "gruenitz.CardOCR---iOS",
             productId: "app.cardlio.ios.unlock", inAppOwnershipType: "PURCHASED", purchaseDate: 1790000000123, originalPurchaseDate: 1790000000123 };

function stubApple(t, handler) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return handler(String(url), init); };
  t.after(() => { globalThis.fetch = real; });
  return calls;
}
const post = (path, body, ip = "17.1.2.3") => new Request("https://w.example" + path, { method: "POST", headers: { "cf-connecting-ip": ip }, body: JSON.stringify(body) });

test("the App Store token is ES256 over the documented claims and verifies", async () => {
  const env = await makeEnv();
  const token = await appleJWT(env, "gruenitz.CardOCR", 1790000000);
  const [h, p, s] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "ES256", kid: "TESTKEY123", typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(p, "base64url")), { iss: "issuer-uuid", iat: 1790000000, exp: 1790000300, aud: "appstoreconnect-v1", bid: "gruenitz.CardOCR" });
  assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, env.pair.publicKey, Buffer.from(s, "base64url"), Buffer.from(h + "." + p)), true);
});

test("the answer to Apple: silence without consent, decline when used, refund when unused", () => {
  assert.equal(consumptionBody(null), null);
  assert.equal(consumptionBody({ consented: false, consumed: true }), null);
  assert.deepEqual(consumptionBody({ consented: true, consumed: true }),
    { customerConsented: true, deliveryStatus: "DELIVERED", sampleContentProvided: true, consumptionPercentage: 100000, refundPreference: "DECLINE" });
  assert.deepEqual(consumptionBody({ consented: true, consumed: false }),
    { customerConsented: true, deliveryStatus: "DELIVERED", sampleContentProvided: true, consumptionPercentage: 0, refundPreference: "GRANT_FULL" });
});

test("/purchase stores a record only for a transaction Apple confirms and whose purchase time the caller knows", async (t) => {
  const env = await makeEnv();
  const calls = stubApple(t, async (url) => url.includes("/transactions/2000000111")
    ? Response.json({ signedTransactionInfo: jws(TX) }) : new Response("{}", { status: 404 }));
  const ask = { transactionId: "2000000111", purchaseDateMs: 1790000000123, bundleId: TX.bundleId, environment: "Production", consumed: false };

  assert.equal((await handlePurchase(post("/purchase", ask), env)).status, 204);
  assert.deepEqual((await env.PURCHASES.get("tx:2000000111")).consumed, false);
  assert.equal(env.PURCHASES.store.lastOptions.expirationTtl, 400 * 86400);
  assert.match(calls[0].init.headers.Authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);

  assert.equal((await handlePurchase(post("/purchase", { ...ask, consumed: true }), env)).status, 204);
  assert.equal((await env.PURCHASES.get("tx:2000000111")).consumed, true);
  assert.equal((await handlePurchase(post("/purchase", { ...ask, consumed: false }), env)).status, 204);
  assert.equal((await env.PURCHASES.get("tx:2000000111")).consumed, true, "used stays used");

  assert.equal((await handlePurchase(post("/purchase", { ...ask, purchaseDateMs: 1790000000124 }), env)).status, 404, "a guessed id without the purchase time");
  assert.equal((await handlePurchase(post("/purchase", { ...ask, transactionId: "999" }), env)).status, 404, "unknown to Apple");
  assert.equal((await handlePurchase(post("/purchase", { ...ask, bundleId: "com.other.app" }), env)).status, 400);

  assert.equal((await handlePurchase(post("/purchase", { ...ask, withdraw: true }), env)).status, 204);
  assert.equal(await env.PURCHASES.get("tx:2000000111"), null, "withdrawing consent deletes the record");
});

test("/asn answers a consumption request from the record, stays silent without one, and forgets a refunded purchase", async (t) => {
  const env = await makeEnv();
  const calls = stubApple(t, async () => new Response(null, { status: 202 }));
  const note = (type) => ({ signedPayload: jws({ notificationType: type, data: { bundleId: TX.bundleId, environment: "Sandbox", signedTransactionInfo: jws(TX) } }) });

  assert.equal((await handleNotification(post("/asn", note("CONSUMPTION_REQUEST")), env)).status, 200);
  assert.equal(calls.length, 0, "no consent on record: Apple is not answered");

  await env.PURCHASES.put("tx:2000000111", JSON.stringify({ consented: true, consumed: true }));
  assert.equal((await handleNotification(post("/asn", note("CONSUMPTION_REQUEST")), env)).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.storekit-sandbox.apple.com/inApps/v2/transactions/consumption/2000000111");
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(JSON.parse(calls[0].init.body).refundPreference, "DECLINE");
  assert.equal(JSON.parse(Buffer.from(calls[0].init.headers.Authorization.split(".")[1], "base64url")).bid, TX.bundleId);

  assert.equal((await handleNotification(post("/asn", note("CONSUMPTION_REQUEST"), "203.0.113.9"), env)).status, 403, "not from Apple's network");
  assert.equal((await handleNotification(post("/asn", note("REFUND_DECLINED")), env)).status, 200);
  assert.ok(await env.PURCHASES.get("tx:2000000111"));
  assert.equal((await handleNotification(post("/asn", note("REFUND")), env)).status, 200);
  assert.equal(await env.PURCHASES.get("tx:2000000111"), null);
  assert.equal(decodeJWSPayload("garbage"), null);
});

test("an Apple outage makes /asn fail so Apple retries inside the 12-hour window", async (t) => {
  const env = await makeEnv();
  stubApple(t, async () => new Response("{}", { status: 503 }));
  await env.PURCHASES.put("tx:2000000111", JSON.stringify({ consented: true, consumed: false }));
  const body = { signedPayload: jws({ notificationType: "CONSUMPTION_REQUEST", data: { bundleId: TX.bundleId, environment: "Production", signedTransactionInfo: jws(TX) } }) };
  assert.equal((await handleNotification(post("/asn", body), env)).status, 500);
});

test("nothing works, and nothing breaks, before the secrets and the KV namespace exist", async () => {
  assert.equal((await handlePurchase(post("/purchase", {}), {})).status, 503);
  assert.equal((await handleNotification(post("/asn", {}), {})).status, 503);
});
