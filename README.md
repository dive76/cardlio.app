# cardlio.app

The card page for [cardlio](https://cardlio.app) — the business-card app for iPhone & Mac.

A cardlio share link carries the entire (vCard) contact in the URL **fragment**:

```
https://cardlio.app/#1.<base64url(deflate-raw(vCard))>
```

`index.html` decodes it entirely client-side (fragments are never sent to any
server) and offers **Add to Contacts**. No backend, no storage, no analytics.
