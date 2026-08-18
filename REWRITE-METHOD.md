# The Rewrite Method — build notes

Six-week gated course, companion to the book *I CAN'T*. Built from
`CLAUDE_CODE_Rewrite_Method_Build_Spec`.

## What shipped in this repo

| Surface | File | Route |
| --- | --- | --- |
| Sales page | `rewrite-method.html` | `/rewrite-method` |
| Course home | `rewrite-method/course.html` | `/rewrite-method/course` |
| Module page | `rewrite-method/module.html` | `/rewrite-method/module?week=week-1` |
| Course data | `assets/rewrite-method.data.js` | shared by all three, and by the seed script |
| Runtime | `assets/rewrite-method.js` | auth, entitlement, drip, check-ins |
| Config | `assets/firebase-config.js` | **needs real values before anything gates** |
| Styles | `assets/rewrite-method.css` | shared across the three surfaces |
| Library card | `index.html` | fourth card in the Courses grid |

`firebase.json` gained `cleanUrls: true` so those routes resolve without
`.html`, and `backend/**` is ignored so hosting deploys never carry rules or
functions.

## The conflict worth knowing about

**The spec assumes one application. This repository is not that application.**

This repo is a static marketing site on Firebase Hosting: four HTML files, no
framework, no build step, no Firebase SDK, no Stripe, no Cloud Functions. The
member portal the spec describes lives separately at `the1p-leadership.web.app`
and is not in this repository. `index.html` sign-in is a stub that redirects
there.

So the work split:

- **Front end** was built here, matching this site's conventions rather than the
  spec's assumed component system: standalone HTML pages, the same design tokens
  and typography as `index.html` and `goal-planning.html`, vanilla ES modules,
  no framework.
- **Data model, rules, functions and seed** were written to the spec and placed
  in `backend/`, ready to drop into the portal project. They are deliberately
  **not wired into this repo's deploy**, because deploying rules from the
  marketing site would overwrite the portal's own rules. See `backend/README.md`.

Two smaller deviations, both flagged rather than silent:

1. The existing pages inline their CSS per file. Three surfaces sharing one
   course design system made a single `assets/rewrite-method.css` the better
   trade. The tokens still mirror `index.html` exactly.
2. No new top-level Firestore collection was created without a peer: the spec
   asked before adding one. `coursesPrivate/` is the exception and it is the
   one the spec itself proposed as pattern (a), chosen because there is no
   existing 1P-CLC implementation in this repo to reuse.

## How the gate actually works

`enrolledAt` is set on the member's **first open** of the course, not at
purchase, so gift purchases and delayed starts do not burn drip days. Module
`order: N` opens at `enrolledAt + N * 7 days`, computed client side on load. No
scheduler, no cron.

The client-side computation is cosmetic. The real boundary is
`getRewriteModuleVideos`, a callable that re-checks entitlement and the unlock
date server side before releasing any video provider ID. Provider IDs live in
`coursesPrivate/`, which **no client can read at all**, entitled or not. Locked
weeks still render with title, lock state and unlock date, because the visible
path forward is part of the product.

The bonus module opens once the Week 6 check-in exists **and** a review choice
is recorded. Either answer works. Opting out unlocks it. The review is an ask,
never a paywall.

Check-in answers contain personal disclosures. They live only under
`users/{uid}/enrollments/rewrite-method`, readable and writable by that member
alone. Week 4's mark photo uploads to `users/{uid}/checkins/`, owner-only.

## Verification

```bash
# Drip and unlock rules (no emulator needed)
node --test backend/tests/drip.test.mjs                 # 9 passing

# Security rules, against the real Firestore emulator
firebase emulators:exec --only firestore "node --test backend/tests/rewrite-rules.test.mjs"
```

Both suites pass. The rules suite proves the three claims that matter: an
unentitled visitor cannot read a provider ID, an entitled member cannot read one
directly either, and nobody can create or restore their own entitlement after a
refund.

The three pages were driven in a browser against a stubbed runtime: Week 0 open
with Weeks 1 to 6 locked and dated, check-in forms rendering from module data
(including the Week 4 file upload), the Week 6 flow through the review ask into
the Rewriter completion state, and prev/next navigation respecting locks.

## What is still open

Everything left needs credentials or content, not code:

1. Fill in `assets/firebase-config.js`. Until `apiKey` is set, the course pages
   run in preview mode and send members to the portal login.
2. Create the two Stripe prices and the $50 book-buyer promotion code, set the
   function secrets, and point a webhook at `rewriteStripeWebhook`.
3. Deploy `backend/functions/rewrite-method.js` and the two rules files into the
   portal project, then run the seed script per environment.
4. Upload videos and set provider IDs in `coursesPrivate/`. Configure the
   provider's own domain restriction (Vimeo embed-only, or Cloudflare signed
   URLs) and record which was chosen in `backend/README.md`. **Neither is
   configured yet, because no video is uploaded yet.**
5. Upload the two worksheet PDFs that exist today, Week 1 and The Manuscript.
   Null paths already render a "coming soon" state, so nothing breaks meanwhile.
6. Build the Loops-side drip off the `rewriteEnrolledAt` contact property.
7. Flip `courses/rewrite-method.status` to `published`.

The course ships `status: "draft"` and the sales page carries `noindex`, so
nothing is publicly listed until the content upload is finished. The library
card on the home page links to the sales page and is live; remove it from
`index.html` if the course should stay fully hidden until launch.
