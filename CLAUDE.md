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

## The "N ways to export & sync" counter has a BASIS — keep it (2026-08-29)

The stat cell went **5 → 6** when Google Contacts shipped, and the number
is not decorative. It counts what the page's OWN sync section enumerates,
so a visitor can add it up and get the same answer:

    4 file formats   vCard · CSV · Outlook CSV · Salesforce CSV
  + 2 sync targets   Office 365 · Google Contacts
  = 6

⚠️ **UPDATE IT WHENEVER A DESTINATION OR FORMAT SHIPS**, and update the
`.checks` list in `#sync` in the same commit — the counter is only
checkable because that list is what it counts. Both the `data-count`
attribute AND the fallback text inside the span must change; the number
animates from `data-count`, but with JS off the span's text is what shows.

⚠️ **THE COUNT IS DELIBERATELY CONSERVATIVE.** Save-to-Apple-Contacts and
the CRM webhook are also ways to get cards out, which would justify 8.
They are excluded because they are not in the sync section's list, and a
number a visitor cannot reconstruct from the page is worse than a smaller
one they can. If they are ever added to that list, the counter goes up in
the same commit.

## ✅ CALLER ID IS A REAL SECTION NOW — device-verified (2026-08-29)

The owner confirmed Caller ID working on an actual incoming call. That
had been the project's OLDEST open item, unverified since 9 August, and
the site had been hedging about it ever since.

It was a `.soon` box at the BOTTOM of the "New in 2.5" section. It is now
its own `.section alt` between "Ask your network" and "New in 2.5", built
on the same shape as the Ask section — kicker, h2, lead, prose — and
verified to match it exactly (760px wrap, h2 44px Space Grotesk, lead
margin-TOP 14px, p 12px/16.5px).

The copy was rewritten rather than moved. The old box explained the
mechanism; the section now leads with the thing that actually
differentiates it: **every other caller-ID app sends your calls to a
server to be looked up, and cardlio does not.** That argument was sitting
unmade on the page while the feature was tagged as unproven.

⚠️ **"iPhone only" IS STILL STATED, and must stay.** macOS has no Call
Directory API. Claiming it on the Mac listing was called out in the app
repo as the mistake to avoid, and the same applies here.

⚠️ **NO NAV ENTRY WAS ADDED**, deliberately — the mobile nav already
overflows at 375px (Privacy/Support clipped, pre-existing), so a fifth
link would make a known problem worse to no benefit.

⚠️ **`.soon` IN `site.css` IS NOW UNUSED AND IS KEPT ON PURPOSE.** Both
of its users were promoted the day they shipped. It is the house pattern
for "real but not downloadable yet"; the CSS carries a note saying so.
Do not delete it as dead code.

## ✅ Google Contacts is LIVE and the page says so (2026-08-29)

2.5.14 reached **Ready for Distribution on both platforms**, so the
`.soon` block that announced Google Contacts as *"In the next update"*
was PROMOTED the same day. What changed in `#sync`:

  * the `<h2>` and lead now name **both** services rather than Office 365
    alone;
  * both `.checks` columns lost their Office-365-only wording ("your own
    Microsoft 365 mailbox" → "your own Google or Microsoft 365 account",
    "the same Sync to Office 365 action" → "the same one-click sync
    action");
  * the dashed `.soon` box became ordinary prose, and its first paragraph
    was DELETED rather than kept — it described connecting and syncing,
    which the heading and the checks now cover, so keeping it was
    duplication. What survives is the part nothing else says: what
    cardlio does **not** take from a Google account.

⚠️ **ONE `.soon` BOX REMAINS AND IT IS NOT STALE.** Caller ID's, in the
"New in 2.5" section, whose tag reads "On iPhone" — a PLATFORM label on a
shipped feature, not a coming-soon marker. Do not delete it. Grepping the
site for "coming soon / next update" now returns nothing, which is the
check worth re-running before believing any such claim is left.

HANDBOOK REFRESHED at the same time, and only because the release
unblocked it: the site had the 22-page copy from 22 August; it now
carries the 23-page one with the Google Contacts chapter. Verified by
PDFKit extraction **after** copying rather than before — 23 pages, 5
"Google Contacts" mentions against the old file's 1.

`privacy.html` needed nothing; it has covered Google fully since the
verification rounds.

## Agreed roadmap / known issues (not yet done)
- Scroll-driven "scan story" section (CSS `animation-timeline: view()`),
  the last item from the redesign plan.
- Mobile nav overflows at 375px (Privacy/Support clipped) — pre-existing.
- Mac badge DONE (2026-07-25): official Apple SVG (self-hosted at
  `assets/mac-app-store-badge.svg`, `.store-badge` in site.css) links to
  https://apps.apple.com/app/id6786612800 in hero + platforms section.
  When iOS ships: same treatment for the iOS "coming soon" pill; consider
  promoting the hero demo link to a secondary button.
- Idea (not committed to): email waitlist while badges are disabled.
