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
