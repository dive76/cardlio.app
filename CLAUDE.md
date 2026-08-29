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

## ⚠️ Google Contacts is on the page but NOT yet downloadable (2026-08-29)

A `.soon` block sits at the END of the `#sync` section announcing Google
Contacts sync. The tag reads **"In the next update"** because that is the
literal truth: the feature is built, Google approved the OAuth verification
on 2026-08-29 and it is verified against the live People API, but it ships
in app **2.5.14**, which at the time of writing is on TestFlight and not
yet submitted. The live store version is 2.5.13.

**TO PROMOTE IT once 2.5.14 is RELEASED on both stores** (check with
`itunes.apple.com/lookup?id=6773151080` — do not go by memory):

  1. Delete the `<div class="soon-tag">In the next update</div>` line.
  2. Fold the two paragraphs into the section body, and extend the `#sync`
     `<h2>` — it still says "into Outlook &amp; Office 365" — to name
     Google Contacts as well.
  3. The two `.checks` columns say "Your account only — contacts go to your
     own Microsoft 365 mailbox" and "the same Sync to Office 365 action on
     both". Both need Google adding.

⚠️ **THE `.soon` CLASS NOW CARRIES TWO MEANINGS.** Its CSS comment says
"a feature that is real but not downloadable yet", which is this block. The
OTHER one on the page — Caller ID, in the "New in 2.5" section — is
SHIPPED, and its tag was repurposed to read "On iPhone" as a platform
label. Do not read that block as unreleased and do not delete it.

⚠️ `privacy.html` ALREADY COVERS GOOGLE FULLY and nothing is owed there —
the Google Contacts section, the Limited Use statement and the
`#security` disclosures all went live for the verification rounds. Do not
edit the Limited Use text; it is what Google accepted.

⚠️ The handbook PDF on this site is NOT to be refreshed yet. The app repo's
handbook has a Google Contacts chapter, and copying it here would document
a feature nobody can download.

### How this block was verified — reuse this, screenshots were useless

The Browser pane was HIDDEN, so every `screenshot` came back a blank white
frame while the page was in fact rendering perfectly. Do not debug the page
on the strength of that. What settled it was reading COMPUTED STYLES from
the SERVED page (`preview_start` → `cardlio-site`, never `file://`) and
comparing them field-by-field against the known-good sibling block:

    google == knownGoodCallerID  ->  identical: true
    (wrapMaxWidth 760px, box 712px, padding 26px 26px 24px, radius 22px,
     dashed border, p margin-TOP 12px, p 16.5px, h3 20px)

The `margin-TOP` reading is the one that matters: `.prose` spaces with
margin-top, so probing `marginBottom` reads 0px even when everything is
fine. And the block MUST live inside a `.prose` wrapper — the global
`* { margin: 0 }` reset would otherwise collapse it into one wall of text.

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
