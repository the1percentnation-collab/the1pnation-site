# The Rewrite Method — backend pieces

These files are **not deployed by this repository**. `firebase.json` here
configures Hosting only, and `backend/**` is in its ignore list on purpose:
deploying rules from the marketing site would overwrite the member portal's
own rules.

They live here so the portal project can drop them in as-is.

| File | Goes where |
| --- | --- |
| `firestore.rules` | Merge into the portal project's Firestore rules |
| `storage.rules` | Merge into the portal project's Storage rules |
| `functions/rewrite-method.js` | Portal `functions/` project, re-exported from its index |
| `scripts/seed-rewrite-method.mjs` | Run once per environment (emulator, staging, prod) |
| `tests/rewrite-rules.test.mjs` | Rules tests, run against the Firestore emulator |

## Order of operations

1. **Seed the structure.**
   ```bash
   FIRESTORE_EMULATOR_HOST=localhost:8080 node backend/scripts/seed-rewrite-method.mjs
   ```
   Writes `courses/rewrite-method`, eight module documents, and the matching
   `coursesPrivate/rewrite-method/modules/*` documents with `providerId: null`.
   The course is seeded `status: "draft"`, so nothing is publicly listed.

2. **Deploy the rules**, then prove them:
   ```bash
   firebase emulators:exec --only firestore "node --test backend/tests"
   ```
   The suite covers the three claims that matter: an unentitled user cannot
   read a provider ID, an entitled member cannot read one directly either,
   and nobody can write or restore their own entitlement.

3. **Stripe.** Create two prices ($197 course, $209 bundle) and a $50-off
   promotion code for book buyers. Set the secrets:
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `LOOPS_API_KEY`, and the env
   vars `STRIPE_PRICE_REWRITE_COURSE` / `STRIPE_PRICE_REWRITE_BUNDLE`.
   Point a webhook endpoint at `rewriteStripeWebhook` for
   `checkout.session.completed` and `charge.refunded`.

4. **Deploy the functions.** Four are exported:
   `createRewriteCheckoutSession`, `rewriteStripeWebhook`,
   `getRewriteModuleVideos`, `fireRewriteEmailEvent`.

5. **Fill in `assets/firebase-config.js`** in the site repo. Until `apiKey` is
   set, the course pages run in preview mode and send members to the portal
   login instead of fetching anything gated.

6. **Upload content as data, not deploys.**
   - Video IDs: update `coursesPrivate/rewrite-method/modules/{slug}.videos[].providerId`.
   - Worksheets: upload to `courses/rewrite-method/worksheets/` and set
     `worksheet.storagePath` on the public module doc.
   - A null ID or path renders a "coming soon" state, so the structure ships first.

7. **Publish** by setting `courses/rewrite-method.status = "published"`.

## Video provider hardening

The callable is the boundary, but set the provider's own restriction too:

- **Vimeo:** privacy set to "embed only", allowed domain limited to the portal
  and site domains.
- **Cloudflare Stream:** signed URLs, and return the signed URL as `embedUrl`
  from `getRewriteModuleVideos` instead of a raw ID.

Neither is configured yet, because no videos are uploaded yet. Whichever is
chosen, record it here.

## Loops events

| Event | Fired by |
| --- | --- |
| `rewrite_purchased` | `rewriteStripeWebhook`, carries the `bundle` flag |
| `rewrite_enrolled` | first course open, carries `rewriteEnrolledAt` |
| `rewrite_checkin_week_N` | each check-in submission |
| `rewrite_completed` | Week 6 check-in, also sets `isRewriter` |
| `rewrite_week_unlocked` | **Loops-side**, scheduled off the `rewriteEnrolledAt` contact property |
| `rewrite_midweek_nudge` | **Loops-side**, Day 3 of Week 2 |
| `rewrite_review_prompt` | **Loops-side**, paired with `rewrite_completed` |

The weekly drip and the nudge deliberately have no infrastructure here. Loops
schedules them from `rewriteEnrolledAt`, which is the same anchor the site uses
to compute unlocks, so the emails and the UI cannot drift apart.
