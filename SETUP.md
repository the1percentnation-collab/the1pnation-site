# Class Signup System

The signup, enrollment, and email machinery behind **The Social Media
Matrix** and any future class.

## How the funnel works

Three stages, deliberately separated so the first one has almost no friction.

**1. Interest.** Someone lands on `/matrix`, gives a first name, an email, and
answers one required question. No account, no payment. The price is shown so
nobody is surprised later. They get a confirmation email.

**2. Announcement.** You decide when the room is ready. There is no automatic
seat threshold. In `/admin` you set the session dates, then press **Announce
Class**. Everyone on the interest list gets the schedule, the price, a checkout
link, an access code field, and a calendar invite. The public page switches over
to taking payment.

**3. Enrollment.** They pay by card, or enter an access code. Either way they
get a confirmation and then a separate email explaining that class delivery
happens in the member portal and how to set that account up. Account creation
sits at the back of the funnel on purpose.

## Access codes, and comping a seat

An access code at **100 percent** enrols the person directly and never touches
Stripe. The word "free" does not appear on the page, in the checkout, or in
their confirmation, so the seat keeps its stated value. A code below 100 percent
goes through Stripe with the discount applied.

Manage codes under **Send → Access Codes** in the admin console. Two are seeded:
`FOUNDING` at 100 percent and `INNERCIRCLE` at 50 percent.

## Scarcity is real

Every constraint the page displays is enforced server side, in
`functions/lib/pricing.js` and the `claimSeat` transaction:

- The seat cap cannot be exceeded, even by two people checking out at once
- The founding rate expires against the server clock, not the browser's
- The enrollment window closes on time
- Seat and interest counts are actual Firestore counts

The simulated counter on `webinar.html` was removed for the same reason. Move
that page onto this pipeline when you want a real number there.

---

## Going live

### 1. Upgrade Firebase to Blaze
Cloud Functions require the pay-as-you-go plan. At this volume it costs a few
cents to a couple of dollars a month, and the free tier still applies.

### 1b. Give the deploy service account the roles it needs
Two deploys to `main` have now failed on permissions, each with a different one.
Hosting deploys fine; the rest does not yet.

```
Missing permissions required for functions deploy. You must have permission
iam.serviceAccounts.ActAs on service account
the-1p-leadership@appspot.gserviceaccount.com
```

The service account behind `FIREBASE_SERVICE_ACCOUNT_THE_1P_LEADERSHIP` holds
enough to publish hosting and nothing more. Open
<https://console.cloud.google.com/iam-admin/iam?project=the-1p-leadership>, find
that service account, and grant it:

| Role | Needed for |
| --- | --- |
| **Firebase Admin** (`roles/firebase.admin`) | Firestore rules and indexes, and general deploys |
| **Service Account User** (`roles/iam.serviceAccountUser`) | Acting as the functions runtime service account |
| **Cloud Functions Admin** (`roles/cloudfunctions.admin`) | Creating and updating the functions themselves |

If you would rather keep it tight than convenient, `roles/firebaserules.admin`
covers the Firestore rules failure specifically, in place of Firebase Admin.

Hosting needs none of this and already deploys. The workflow runs each target as
its own step, so missing roles here cannot stop the site itself from shipping.

### 2. Web config
Already done. `assets/firebase-init.js` carries the same values the member portal
uses, read from its `public/js/firebase.js`. Both run on Firebase project
`the-1p-leadership`.

If they ever go stale, deleting them is safe: Firebase Hosting serves the live
config at `/__/firebase/init.json` on every domain it hosts, and the code falls
back to that automatically.

### 3. Set the secrets
```bash
cd functions
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
firebase functions:secrets:set SENDGRID_API_KEY
firebase functions:secrets:set UNSUBSCRIBE_SECRET   # any long random string
```

**All four must exist before the first functions deploy.** Firebase checks every
declared secret at deploy time and fails if one is missing, so a placeholder value
is better than a missing secret if you do not have the real key yet.

No CLI handy? Each one is a Secret Manager secret with the same name, so you can
create them at
<https://console.cloud.google.com/security/secret-manager?project=the-1p-leadership>
instead.
`UNSUBSCRIBE_SECRET` signs unsubscribe links. It is separate from the SendGrid
key so that rotating an email provider key does not break every unsubscribe link
already sitting in people's inboxes.

Non-secret values (site URL, from address, mailing address) live in
`functions/.env`. **Set `MAILING_ADDRESS` to a real postal address before the
first send.** CAN-SPAM requires it in every commercial email.

### 3b. Member portal accounts
Signing up for a class creates a member portal login in the background and emails
the person a link to set their password.

**Nothing to configure.** The portal is a separate repo
(`the1percentnation-collab/the-1p-leadership`, served from
`the1p-leadership.web.app`), but its `.firebaserc` and its
`public/js/firebase.js` both name project `the-1p-leadership`, the same project
this site runs in. One project means one Auth user pool, so the account a class
signup creates *is* the portal login.

There is no `PORTAL_SERVICE_ACCOUNT` secret to create. It would only matter if a
portal ever moved to a separate Firebase project, and Firebase fails a deploy when
a declared secret is missing from Secret Manager, so declaring one that is never
set would block every deploy.

**The profile shape is matched, not guessed.** The user document written at
`users/{uid}` mirrors `ensureUserDoc()` in the portal's `public/js/auth.js`:
`email`, `displayName`, `role`, `companyId`, `tier`, `createdAt`, `lastActiveAt`,
plus `firstName`, `lastName`, `phone`, and `classes` which the portal ignores but
you wanted captured.

`role`, `tier`, `companyId`, and `createdAt` are written **only when the profile
does not already exist**. Merging them every time would demote a member who has
since been made an admin or moved to a company tier back to a plain individual.
The owner bootstrap for `the1percentnation@gmail.com` is mirrored too, so signing
yourself up cannot overwrite your own owner role.

**How to confirm it worked.** Sign yourself up on `/matrix`, then open `/admin`.
The signup sheet has Portal and Portal Project columns: Portal should read
`created`, Portal Project should read `the-1p-leadership`. Then open the
set-password link from your welcome email and log into
`the1p-leadership.web.app` with it.

If any signup ever shows `failed` or `none`, use
**Send, Portal Accounts, Create Missing Accounts**. Safe to run repeatedly, and
it never touches an existing account.

### 3c. One project, two repos: what this repo must never deploy
The member portal repo (`the1percentnation-collab/the-1p-leadership`) shares this
Firebase project. Two things in a Firebase project are single-source and
project-wide, and the portal owns both.

**Firestore rules and indexes.** One ruleset per project. The portal's is 859
lines covering users, companies, posts, channels, contacts and campaigns.
Deploying this repo's 60-line file would replace all of it, and its closing
`allow read, write: if false` would lock every member out of their own data.
`firebase.json` here no longer declares a `firestore` config and the deploy step
is gone. The rules this site needs live in `firestore.rules.snippet` and have to
be merged into the portal repo instead.

**Cloud Functions names.** Functions are grouped by *codebase*. Both repos
originally used `default`, so a deploy from here compared the portal's 53
functions against this source, decided they were stale, and tried to delete all
of them. It failed only because the run is non-interactive.

This repo now deploys `--only functions:classes` against codebase `classes`,
declared in `firebase.json`. **Never widen that back to `--only functions`, and
never add `--force`.** If you ever see a deploy listing portal function names
under "found in your project but do not exist in your local source code", stop
and check the codebase setting rather than accepting the deletion.

**This is enforced, not just documented.** `scripts/check-deploy-safety.mjs`
runs before every deploy and on every pull request, and fails the build if:

- `firebase.json` declares a `firestore` config
- a deployable `firestore.rules` or `firestore.indexes.json` appears at the root
- the functions codebase is anything other than `classes`
- a workflow passes `--force`
- a workflow deploys `--only functions` unscoped, or `--only ...firestore`

Each check was verified by reintroducing the exact regression and confirming the
build stops. If it ever blocks you, read what it says before working around it:
every rule in it exists because of a specific way this repo nearly took the
portal down.

### 4. SendGrid
Create the API key, then **authenticate your sending domain**. Domain
authentication matters more than the key itself; unauthenticated mail lands in
spam.

### 5. Stripe
Add the webhook endpoint pointing at:
```
https://us-central1-the-1p-leadership.cloudfunctions.net/stripeWebhook
```
Subscribe it to `checkout.session.completed` and put its signing secret into
`STRIPE_WEBHOOK_SECRET`.

### 6. Deploy and seed
```bash
firebase deploy --only hosting,functions:classes
cd functions && npm run seed
```

### 7. Give yourself admin access
Create your account at `/admin`, then:
```bash
cd functions && node scripts/grant-admin.js the1percentnation@gmail.com
```
Sign out and back in. Without this claim every admin function rejects you, which
is intentional.

### 8. Set the real numbers
In `/admin` → Class Builder, set the price, the founding rate and its deadline,
and the seat cap. The seeded values ($297, founding $197, cap 30) are starting
points, not decisions.

---

## Running it locally

```bash
firebase emulators:start --only functions,firestore,hosting
cd functions && FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run seed
```
`assets/firebase-init.js` points at the functions emulator automatically on
localhost.

## Adding another class

`/admin` → Class Builder → **New Class**. Give it a slug, edit the copy, build
the form questions, set the price and cap. It is live at
`/class.html?c=your-slug` as soon as you save. No deploy, no code.

`matrix.html` is the hand-designed page for the flagship. `class.html` renders
everything else from its Firestore record.

## Before you promote the link

- [ ] Load `/matrix` and confirm the form renders instead of the
      "signups are briefly unavailable" fallback
- [ ] Sign yourself up, then check Portal and Portal Project in `/admin`
- [ ] Open the set-password link from your welcome email and log into the portal

## Before you take the first payment

- [ ] Fill in every bracketed value in `privacy.html` and `terms.html`, and have
      a lawyer review them. They are a working baseline, not legal advice.
- [ ] Set `MAILING_ADDRESS` in `functions/.env`
- [ ] Send yourself a test of every email
- [ ] Run one Stripe test-mode checkout end to end
- [ ] Redeem a 100 percent code and confirm nothing says "free"

## Layout

```
matrix.html              flagship class page
class.html               renders any other class from its record
admin.html               console: dashboard, signup sheet, builder, sends
enrolled.html            Stripe success page
unsubscribe.html         one-click unsubscribe
assets/1p.css            shared design system
assets/class-form.js     renders a form schema, handles submit and enrollment
assets/firebase-init.js  resolves project config, lazy SDK loading
functions/               Cloud Functions, email templates, seed scripts
firestore.rules.snippet  rules to MERGE into the portal repo, never deployed from here
```
