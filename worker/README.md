# cardlio pass signer

Cloudflare Worker that signs Apple Wallet passes for cardlio's My Card.
The Pass Type ID certificate lives in Worker secrets — never in this repo,
never in the app binary. Card data transits per-request and is not stored.

## Deploy

```sh
npm install
npx wrangler login                 # one-time, opens browser
npx wrangler secret put PASS_CERT_PEM  < pass-cert.pem
npx wrangler secret put PASS_KEY_PEM   < pass-key.pem
npx wrangler secret put WWDR_PEM       < AppleWWDRCAG4.pem
npx wrangler deploy
```

Converting the Keychain Access export (`Certificates.p12`) to the PEMs:

```sh
openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -legacy -out pass-cert.pem
openssl pkcs12 -in Certificates.p12 -nocerts -nodes -legacy -out pass-key.pem
curl -sO https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer
openssl x509 -inform der -in AppleWWDRCAG4.cer -out AppleWWDRCAG4.pem
```

## Caller authentication (added 2026-09-06)

`/sign` requires `Authorization: Bearer <SIGN_TOKEN>` once the secret is set:

    wrangler secret put SIGN_TOKEN

The app carries the same token (`WalletPassService.signToken`). Enforcement
is off while the secret is unset, so deploy the Worker first and set the
secret only after the app build that sends the token is the one users run —
otherwise "Add to Wallet" fails with 401 on older builds. A per-IP rate
limit (`[[ratelimits]]` in wrangler.toml, 30/min) applies in any case.

## Refund consumption reporting (added 2026-10-01, `src/refund.js`)

When a customer asks Apple to refund the unlock, Apple asks this Worker
whether the purchase was delivered and used, and the Worker answers from a
one-flag record the app left with the buyer's consent. Design, trust model
and what is stored are in the header of `src/refund.js`; the app side is
`RefundConsumption.swift`.

    POST /purchase   the app registers a purchase / marks it used / withdraws
    POST /asn        App Store Server Notifications V2 (set this URL in App Store Connect)

Both answer 503 until all of the following exist, so deploying the code
alone changes nothing:

```sh
npx wrangler kv namespace create PURCHASES     # paste the id into wrangler.toml, uncomment the block
npx wrangler secret put IAP_KEY_P8  < SubscriptionKey_XXXXXXXXXX.p8
npx wrangler secret put IAP_KEY_ID             # the key's 10-character id
npx wrangler secret put IAP_ISSUER_ID          # the issuer id on the same page
npx wrangler deploy
```

The key is an **In-App Purchase** key (App Store Connect → Users and Access →
Integrations → In-App Purchase), not the team API key used for uploads. In
App Store Connect, each app record → App Information → App Store Server
Notifications: Production and Sandbox URL `https://cardlio-pass.cardlio.workers.dev/asn`,
Version 2. "Request a Test Notification" (App Store Server API) should then
show `asn TEST: ignored` in `wrangler tail`.

Tests: `node --test test/refund.test.mjs` (no network, no secrets).
