/* ============================================================
   THE REWRITE METHOD — CLOUD FUNCTIONS
   ------------------------------------------------------------
   Drop into the member portal's functions project and re-export
   from its index. Written against firebase-functions v2 and the
   Admin SDK; adjust the import style if the portal is still on v1.

   Required secrets / config:
     STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
     STRIPE_PRICE_REWRITE_COURSE, STRIPE_PRICE_REWRITE_BUNDLE,
     LOOPS_API_KEY

   This file owns four responsibilities:
     1. Creating Checkout sessions (with book-buyer promo support).
     2. Turning a paid session into an enrollment. Entitlement is
        written here and nowhere else.
     3. Releasing video provider IDs one module at a time, after
        checking entitlement and the unlock date server side.
     4. Firing Loops events.
============================================================ */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const Stripe = require('stripe');

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const LOOPS_API_KEY = defineSecret('LOOPS_API_KEY');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const COURSE_ID = 'rewrite-method';
const DAY_MS = 24 * 60 * 60 * 1000;

const PRICE_IDS = {
  courseOnly: process.env.STRIPE_PRICE_REWRITE_COURSE,
  bundle: process.env.STRIPE_PRICE_REWRITE_BUNDLE
};

/* ─── 1. CHECKOUT ──────────────────────────────────────────── */
exports.createRewriteCheckoutSession = onCall(
  { secrets: [STRIPE_SECRET_KEY] },
  async request => {
    const stripe = new Stripe(STRIPE_SECRET_KEY.value());
    const { plan, promoCode, origin } = request.data || {};

    if (!PRICE_IDS[plan]) throw new HttpsError('invalid-argument', 'Unknown plan.');

    const isBundle = plan === 'bundle';
    const site = origin || 'https://the1percentnation.com';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
      // A bundle ships a signed book, so an address is required.
      shipping_address_collection: isBundle ? { allowed_countries: ['US', 'CA'] } : undefined,
      // Book buyers arrive with a code from the QR page. Stripe validates it.
      allow_promotion_codes: promoCode ? undefined : true,
      discounts: promoCode ? [{ promotion_code: await resolvePromotionCode(stripe, promoCode) }] : undefined,
      client_reference_id: request.auth ? request.auth.uid : undefined,
      customer_email: request.auth && request.auth.token ? request.auth.token.email : undefined,
      metadata: { courseId: COURSE_ID, plan, bundle: String(isBundle), uid: request.auth ? request.auth.uid : '' },
      success_url: `${site}/rewrite-method/course?purchase=success`,
      cancel_url: `${site}/rewrite-method?purchase=cancelled`
    });

    return { url: session.url, sessionId: session.id };
  }
);

/* A promotion code string from the QR page has to be resolved to its
   Stripe promotion code ID before it can be attached to a session.
   An unknown code falls back to the manual entry field rather than
   failing the purchase. */
async function resolvePromotionCode(stripe, code) {
  const found = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
  if (!found.data.length) throw new HttpsError('not-found', 'That code is not valid.');
  return found.data[0].id;
}

/* ─── 2. STRIPE WEBHOOK ────────────────────────────────────── */
exports.rewriteStripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, LOOPS_API_KEY] },
  async (req, res) => {
    const stripe = new Stripe(STRIPE_SECRET_KEY.value());
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        req.headers['stripe-signature'],
        STRIPE_WEBHOOK_SECRET.value()
      );
    } catch (err) {
      console.error('[rewrite] bad webhook signature', err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    try {
      if (event.type === 'checkout.session.completed') {
        await handleCheckoutCompleted(event.data.object);
      } else if (event.type === 'charge.refunded') {
        await handleRefund(event.data.object);
      }
      res.json({ received: true });
    } catch (err) {
      console.error('[rewrite] webhook handler failed', err);
      res.status(500).send('handler failed');
    }
  }
);

async function handleCheckoutCompleted(session) {
  if ((session.metadata || {}).courseId !== COURSE_ID) return;

  const uid = session.client_reference_id || (session.metadata || {}).uid || (await uidForEmail(session.customer_details && session.customer_details.email));
  if (!uid) {
    // No account yet. Park the purchase so the portal can claim it at signup.
    await db.collection('pendingEnrollments').add({
      courseId: COURSE_ID,
      email: (session.customer_details || {}).email || null,
      stripeCheckoutSessionId: session.id,
      stripeCustomerId: session.customer || null,
      bundle: (session.metadata || {}).bundle === 'true',
      shippingAddress: (session.shipping_details || null),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return;
  }

  const bundle = (session.metadata || {}).bundle === 'true';

  // enrolledAt is deliberately absent. The drip anchor is set on the
  // member's first open of the course, not at purchase, so gifts and
  // delayed starts do not burn drip days.
  await db.doc(`users/${uid}/enrollments/${COURSE_ID}`).set(
    {
      courseId: COURSE_ID,
      status: 'active',
      purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
      stripeCustomerId: session.customer || null,
      stripeCheckoutSessionId: session.id,
      bundle,
      shippingAddress: bundle ? (session.shipping_details || null) : null,
      checkins: {},
      reviewChoice: null,
      completedAt: null,
      isRewriter: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  await sendLoopsEvent((session.customer_details || {}).email, 'rewrite_purchased', { bundle });
}

async function handleRefund(charge) {
  const sessionId = (charge.metadata || {}).checkout_session_id;
  const email = charge.billing_details && charge.billing_details.email;
  const uid = (charge.metadata || {}).uid || (await uidForEmail(email));
  if (!uid) return;

  const ref = db.doc(`users/${uid}/enrollments/${COURSE_ID}`);
  const snap = await ref.get();
  if (!snap.exists) return;
  if (sessionId && snap.data().stripeCheckoutSessionId !== sessionId) return;

  await ref.update({
    status: 'revoked',
    revokedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

async function uidForEmail(email) {
  if (!email) return null;
  try {
    const user = await admin.auth().getUserByEmail(email);
    return user.uid;
  } catch (err) {
    return null;
  }
}

/* ─── 3. GATED VIDEO IDS ───────────────────────────────────────
   The actual security boundary. UI lock states are cosmetic; this
   is what stops an unentitled visitor, or an entitled member on
   Week 1, from reading a Week 5 provider ID.
─────────────────────────────────────────────────────────────── */
exports.getRewriteModuleVideos = onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const uid = request.auth.uid;
  const moduleSlug = (request.data || {}).moduleSlug;
  if (!moduleSlug) throw new HttpsError('invalid-argument', 'moduleSlug is required.');

  const enrollSnap = await db.doc(`users/${uid}/enrollments/${COURSE_ID}`).get();
  if (!enrollSnap.exists) throw new HttpsError('permission-denied', 'Not enrolled.');
  const enrollment = enrollSnap.data();
  if (enrollment.status === 'revoked') throw new HttpsError('permission-denied', 'Access ended.');

  const modSnap = await db.doc(`courses/${COURSE_ID}/modules/${moduleSlug}`).get();
  if (!modSnap.exists) throw new HttpsError('not-found', 'No such module.');
  const mod = modSnap.data();

  if (!isUnlockedServerSide(mod, enrollment)) {
    throw new HttpsError('permission-denied', 'This week has not unlocked yet.');
  }

  const privSnap = await db.doc(`coursesPrivate/${COURSE_ID}/modules/${moduleSlug}`).get();
  const videos = privSnap.exists ? privSnap.data().videos || [] : [];

  return {
    moduleSlug,
    videos: videos.map(v => ({
      id: v.id,
      title: v.title,
      provider: v.provider,
      providerId: v.providerId || null,          // null renders as "coming soon"
      plannedRuntime: v.plannedRuntime || null,
      order: v.order
    }))
  };
});

function isUnlockedServerSide(mod, enrollment) {
  if (mod.order === 99) {
    const done = Boolean(enrollment.checkins && enrollment.checkins['week-6']);
    return done && Boolean(enrollment.reviewChoice);
  }
  if (mod.order === 0) return true;
  const anchor = enrollment.enrolledAt;
  if (!anchor) return false;
  const anchorMs = anchor.toMillis ? anchor.toMillis() : new Date(anchor).getTime();
  return Date.now() >= anchorMs + mod.order * 7 * DAY_MS;
}

/* ─── 4. LOOPS EVENTS ──────────────────────────────────────────
   enrolledAt is synced as a contact property so Loops can run the
   weekly unlock drip and the mid-week nudge on its own schedule.
   No scheduler, no cron.
─────────────────────────────────────────────────────────────── */
exports.fireRewriteEmailEvent = onCall({ secrets: [LOOPS_API_KEY] }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const email = request.auth.token && request.auth.token.email;
  const { eventName, payload } = request.data || {};
  if (!eventName || !String(eventName).startsWith('rewrite_')) {
    throw new HttpsError('invalid-argument', 'Unknown event.');
  }

  let properties = payload || {};
  if (eventName === 'rewrite_enrolled') {
    const snap = await db.doc(`users/${request.auth.uid}/enrollments/${COURSE_ID}`).get();
    const enrolledAt = snap.exists ? snap.data().enrolledAt : null;
    properties = {
      ...properties,
      rewriteEnrolledAt: enrolledAt && enrolledAt.toDate ? enrolledAt.toDate().toISOString() : null
    };
  }

  await sendLoopsEvent(email, eventName, properties);
  return { ok: true };
});

async function sendLoopsEvent(email, eventName, properties) {
  if (!email) return;
  const key = LOOPS_API_KEY.value();
  if (!key) return;

  const res = await fetch('https://app.loops.so/api/v1/events/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, eventName, eventProperties: properties || {} })
  });
  if (!res.ok) console.warn('[rewrite] loops event failed', eventName, res.status);
}
