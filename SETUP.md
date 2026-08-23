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
# functions
Missing permissions required for functions deploy. You must have permission
iam.serviceAccounts.ActAs on service account
the-1p-leadership@appspot.gserviceaccount.com

# firestore rules
Request to https://firebaserules.googleapis.com/v1/projects/the-1p-leadership:test
had HTTP Error: 403, The caller does not have permission
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

### 2. Fill in the web config
Firebase console → Project settings → General → Your apps → Web app → Config.
Copy the values into `assets/firebase-init.js`. These are public identifiers,
not credentials, and are safe to commit.

### 3. Set the secrets
```bash
cd functions
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
firebase functions:secrets:set SENDGRID_API_KEY
firebase functions:secrets:set UNSUBSCRIBE_SECRET   # any long random string
```
`UNSUBSCRIBE_SECRET` signs unsubscribe links. It is separate from the SendGrid
key so that rotating an email provider key does not break every unsubscribe link
already sitting in people's inboxes.

Non-secret values (site URL, from address, mailing address) live in
`functions/.env`. **Set `MAILING_ADDRESS` to a real postal address before the
first send.** CAN-SPAM requires it in every commercial email.

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
firebase deploy --only hosting,functions,firestore
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
assets/firebase-init.js  web config and lazy SDK loading
functions/               Cloud Functions, email templates, seed scripts
firestore.rules          signups are sealed from all client access
```
