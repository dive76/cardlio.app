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
