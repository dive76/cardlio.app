# cardlio.app website — working notes (updated 2026-07-10)

## What this is
Marketing site for **cardlio** (business-card scanner app for iPhone/Mac).
Static site, no build step, deployed via GitHub Pages on `main`
(CNAME → https://cardlio.app). The iOS/Mac app lives in a separate repo
(CardPDFScanner); the site's palette intentionally matches the app.

## Structure
- `index.html` — landing page AND the card-link viewer (one file; JS at the
  bottom switches to "card mode" when the URL hash starts with `#1.`)
- `site.css` — all site styles (brand system documented in header comment)
- `privacy.html`, `support.html` — share site.css (`.doc` styles)
- `assets/` — screenshots + `assets/fonts/space-grotesk-vf.woff2`
- `worker/` — Cloudflare worker

## Design system (do not change without asking)
- Palette: indigo `#4F46E5` → violet `#8B5CF6` on deep indigo-black
  (`--hero-bg #12101f`). Owner explicitly wants to KEEP this palette.
- Display type: Space Grotesk (self-hosted variable font, weight 300–700,
  `--font-display`); body stays system font.
- HARD RULE: no third-party requests of any kind (no Google Fonts, no CDNs,
  no analytics) — the privacy section promises "no analytics, not on this
  website" and the app's brand is privacy.
- Motion: everything gated on `prefers-reduced-motion`; entrance effects
  must never hide content when JS is off (see `noscript` block + `.reveal`).

## 2026-07 redesign (commit 0e4f13b)
1. Space Grotesk for wordmark/headings/kickers/numbers; hero capped at 70px
   (largest size where "Business cards," fits one line); `text-wrap: balance`
   on headings, `pretty` on leads.
2. Share-tile emoji replaced with inline stroke SVGs (link/QR/NFC/wallet);
   QR scanline + NFC ring hover animations still layer on top.
3. Capabilities marquee removed (HTML + CSS + clone JS).
4. The three old split sections (Capture/Understanding/Your network) are now
   ONE bento grid section (`#scan`, grid-template-areas in `.bento`):
   scan demo, tall phone cell, email-signature + PDF minis (pure CSS),
   stats screenshot (cropped via max-height 300px), addresses cell.
   Nav "Features" still points at `#scan`.
5. Hero has a live demo link (`.demo-link`): a REAL card link for
   "Elena Vargas" that opens the card viewer in a new tab.

## Card-link format (for regenerating demo payloads)
`/#1.` + base64url(deflate-raw(vCard)), no padding. Regenerate with
python3: `zlib.compressobj(9, zlib.DEFLATED, -15)` → compress vCard bytes →
`base64.urlsafe_b64encode(...).rstrip("=")`. Don't hand-edit the payload —
patch the href with a script and round-trip-decode to verify.

## Local dev
`python3 -m http.server 4173 --directory <repo>` — then http://localhost:4173/

## Agreed roadmap / known issues (not yet done)
- Scroll-driven "scan story" section (CSS `animation-timeline: view()`),
  the last item from the redesign plan.
- Mobile nav overflows at 375px (Privacy/Support clipped) — pre-existing.
- When the apps ship: swap "coming soon" badges for real App Store links
  and consider promoting the hero demo link to a secondary button.
- Idea (not committed to): email waitlist while badges are disabled.
