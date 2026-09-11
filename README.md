# cardlio.app

The card page for [cardlio](https://cardlio.app) — the business-card app for iPhone & Mac.

A cardlio share link carries the entire (vCard) contact in the URL **fragment**:

```
https://cardlio.app/#1.<base64url(deflate-raw(vCard))>
```

`index.html` decodes it entirely client-side (fragments are never sent to any
server) and offers **Add to Contacts**. No backend, no storage, no analytics.

## Reading a cardlio link without a browser

Scanners, CRMs and other card apps can decode the link offline — no request
to cardlio.app is needed, and none would help, because the server never sees
the fragment:

1. take the fragment after `#`; it must start with `1.` (the format version);
2. base64url-decode the rest (RFC 4648 §5, unpadded);
3. inflate it as a raw DEFLATE stream (RFC 1951 — `deflate-raw`, no zlib header);
4. the result is a UTF-8 vCard 3.0 (`BEGIN:VCARD` … `END:VCARD`).

cardlio itself does exactly this when it scans another cardlio user's QR code
or taps their NFC tag (`ContactLinkFetcher.localVCard`, app side). A link that
does not start with `1.` is not a card and must not be treated as one.
