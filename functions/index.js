import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2';
import { logger } from 'firebase-functions';
import Stripe from 'stripe';

import {
  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SENDGRID_API_KEY, UNSUBSCRIBE_SECRET,
  SITE_URL, PORTAL_URL, FROM_EMAIL, REGION, ALLOWED_ORIGINS
} from './lib/config.js';
import { db, auth, FieldValue, signupId, normaliseEmail, classRef, signupsRef, loadClass } from './lib/db.js';
import {
  clean, cleanPhone, isEmail, looksAutomated, validateAnswers,
  cleanAttribution, assertAdmin, bad
} from './lib/validate.js';
import { resolvePricing, resolveAvailability, checkoutBlockedReason, formatMoney } from './lib/pricing.js';
import { pushToGoHighLevel } from './lib/ghl.js';
import { buildIcs } from './lib/ics.js';
import { send, sendBatch, verifyUnsubscribeToken } from './lib/mail.js';
import * as tpl from './emails/templates.js';

setGlobalOptions({ region: REGION, maxInstances: 10 });

const callOpts = { cors: ALLOWED_ORIGINS };
const stripeClient = () => new Stripe(STRIPE_SECRET_KEY.value(), { apiVersion: '2024-12-18.acacia' });

/* ════════════════════════════════════════════════════════════
   PUBLIC: CLASS STATE
   The page reads marketing copy straight from Firestore, but
   price and availability come from here so what a visitor sees
   is what the server will actually honour.
   ════════════════════════════════════════════════════════════ */
export const getClassState = onCall(callOpts, async (request) => {
  const slug = clean(request.data?.slug, 80);
  if (!slug) bad('A class slug is required.');

  const snap = await classRef(slug).get();
  if (!snap.exists) throw new HttpsError('not-found', 'That class does not exist.');
  const cls = snap.data();

  const pricing = resolvePricing(cls);
  const availability = resolveAvailability(cls);

  return {
    slug,
    status: cls.status || 'interest',
    name: cls.name || '',
    pricing: {
      amount: pricing.amount,
      fullAmount: pricing.fullAmount,
      currency: pricing.currency,
      display: formatMoney(pricing.amount, pricing.currency),
      fullDisplay: formatMoney(pricing.fullAmount, pricing.currency),
      foundingActive: pricing.foundingActive,
      foundingEndsAt: pricing.foundingUntil
    },
    availability: {
      capacity: availability.capacity,
      seatsLeft: availability.seatsLeft,
      soldOut: availability.soldOut,
      enrollClosed: availability.enrollClosed,
      enrollCloseAt: availability.enrollCloseAt
    },
    // Aggregate only. Never the list itself.
    interestCount: Number(cls.interestCount) || 0,
    formFields: cls.formFields || [],
    schedule: cls.schedule || null
  };
});

/* ════════════════════════════════════════════════════════════
   PUBLIC: SUBMIT SIGNUP
   Stage one of the funnel. Bare minimum information, no account,
   no payment. Everything else in the system hangs off this record.
   ════════════════════════════════════════════════════════════ */
export const submitSignup = onCall(
  { ...callOpts, secrets: [SENDGRID_API_KEY, UNSUBSCRIBE_SECRET] },
  async (request) => {
    const data = request.data || {};
    const slug = clean(data.slug, 80);
    if (!slug) bad('A class slug is required.');

    // Bots first, before we touch the database.
    const botReason = looksAutomated({ honeypot: data.hp, renderedAt: data.renderedAt });
    if (botReason) {
      logger.info('Rejected automated submission', { slug, reason: botReason });
      // Report success so a scraper cannot use the response to
      // learn which signal tripped it.
      return { ok: true, stage: 'interest' };
    }

    const cls = await loadClass(slug);
    if (!cls) throw new HttpsError('not-found', 'That class does not exist.');

    const email = normaliseEmail(data.email);
    const firstName = clean(data.firstName, 80);
    if (!firstName) bad('Please tell us your first name.');
    if (!isEmail(email)) bad('Please enter a valid email address.');

    const { answers, errors } = validateAnswers(cls.formFields || [], data.answers || {});
    if (errors.length) bad(errors[0]);

    const availability = resolveAvailability(cls);
    const pricing = resolvePricing(cls);

    // A full cohort takes waitlist signups rather than hiding the
    // form. The demand signal is worth more than a clean page.
    const isWaitlist = availability.soldOut || cls.status === 'waitlist';
    const stage = isWaitlist ? 'waitlist' : 'interest';

    const id = signupId(email);
    const ref = signupsRef(slug).doc(id);
    const existing = await ref.get();
    const attribution = cleanAttribution(data.attribution || {});

    const phone = cleanPhone(data.phone);
    const record = {
      firstName,
      email,
      // Only write the phone when one was actually given. Someone
      // resubmitting the form without it should not have the number
      // we already hold wiped out.
      ...(phone ? { phone } : {}),
      answers,
      consent: {
        sms: Boolean(data.consent?.sms),
        marketing: Boolean(data.consent?.marketing),
        at: FieldValue.serverTimestamp()
      },
      source: clean(data.source, 60) || 'website',
      ...attribution,
      updatedAt: FieldValue.serverTimestamp()
    };

    if (existing.exists) {
      const currentStage = existing.data().stage;
      // Never downgrade someone who already paid back to interest.
      const alreadyEnrolled = ['paid', 'enrolled'].includes(currentStage);
      if (!alreadyEnrolled) record.stage = stage;
      await ref.set(record, { merge: true });

      // They are already in the class. Keep their updated details,
      // but do not send a "you're on the list" email for something
      // they have already paid for.
      if (alreadyEnrolled) return { ok: true, stage: currentStage, alreadyEnrolled: true };
    } else {
      await ref.set({
        ...record,
        stage,
        ghlSynced: false,
        portalInvited: false,
        portalAccountLinked: false,
        emailLog: [],
        unsubscribed: false,
        createdAt: FieldValue.serverTimestamp()
      });
      // Only a genuinely new person moves the public counter.
      await classRef(slug).update({ interestCount: FieldValue.increment(1) });
    }

    const signup = { ...record, phone: phone || existing.data()?.phone || '', stage, slug };

    // CRM mirror and confirmation email run in parallel, and
    // neither is allowed to fail the request. The signup is already
    // durable in Firestore; a CRM hiccup is a flag to retry, not a
    // reason to show this person an error.
    const [ghlResult, mailResult] = await Promise.allSettled([
      pushToGoHighLevel(signup, cls),
      (async () => {
        const { subject, html } = isWaitlist
          ? tpl.waitlistConfirmation(signup, cls)
          : tpl.interestConfirmation(signup, cls, pricing);
        return send({ to: email, subject, html, categories: ['class-interest', slug] });
      })()
    ]);

    const ghlOk = ghlResult.status === 'fulfilled' && ghlResult.value?.ok;
    const mailOk = mailResult.status === 'fulfilled' && mailResult.value?.ok;
    if (!ghlOk) logger.warn('GoHighLevel sync failed', { slug, id, result: ghlResult });
    if (!mailOk) logger.warn('Confirmation email failed', { slug, id, result: mailResult });

    await ref.set(
      {
        ghlSynced: ghlOk,
        emailLog: FieldValue.arrayUnion({
          type: isWaitlist ? 'waitlist' : 'interest-confirmation',
          ok: mailOk,
          at: new Date().toISOString()
        })
      },
      { merge: true }
    );

    return { ok: true, stage, waitlist: isWaitlist };
  }
);

/* ════════════════════════════════════════════════════════════
   PUBLIC: START CHECKOUT
   Stage two. Only reachable once Anthony has scheduled the class.
   ════════════════════════════════════════════════════════════ */
export const startCheckout = onCall(
  { ...callOpts, secrets: [STRIPE_SECRET_KEY] },
  async (request) => {
    const slug = clean(request.data?.slug, 80);
    const email = normaliseEmail(request.data?.email);
    if (!slug) bad('A class slug is required.');
    if (!isEmail(email)) bad('Please enter the email address you signed up with.');

    const cls = await loadClass(slug);
    if (!cls) throw new HttpsError('not-found', 'That class does not exist.');

    const blocked = checkoutBlockedReason(cls);
    if (blocked) throw new HttpsError('failed-precondition', blocked);

    const pricing = resolvePricing(cls);
    if (pricing.amount <= 0) {
      throw new HttpsError('failed-precondition', 'This class does not have a price set yet.');
    }

    const id = signupId(email);
    const ref = signupsRef(slug).doc(id);
    const snap = await ref.get();

    // Someone can arrive at checkout from the announcement email
    // without a prior record only in edge cases; create a minimal
    // one so the webhook has somewhere to write.
    if (!snap.exists) {
      await ref.set({
        firstName: clean(request.data?.firstName, 80) || '',
        email,
        stage: 'announced',
        answers: {},
        ghlSynced: false,
        portalInvited: false,
        portalAccountLinked: false,
        emailLog: [],
        unsubscribed: false,
        source: 'checkout',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    } else if (['paid', 'enrolled'].includes(snap.data().stage)) {
      throw new HttpsError('already-exists', 'You are already enrolled in this class. Check your email for your portal link.');
    }

    const stripe = stripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      client_reference_id: `${slug}:${id}`,
      // Anthony can hand out a percentage code and Stripe applies
      // it at checkout. Full comps never reach this path; they go
      // through redeemAccessCode instead.
      allow_promotion_codes: true,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: pricing.currency,
            unit_amount: pricing.amount,
            product_data: {
              name: cls.name,
              description: cls.tagline || 'A mastermind from The One Percent Nation'
            }
          }
        }
      ],
      metadata: { slug, signupId: id },
      success_url: `${SITE_URL.value()}/enrolled.html?c=${encodeURIComponent(slug)}&s={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL.value()}/class.html?c=${encodeURIComponent(slug)}`
    });

    await ref.set({ stripe: { sessionId: session.id }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { url: session.url };
  }
);

/* ════════════════════════════════════════════════════════════
   PUBLIC: REDEEM ACCESS CODE
   Anthony asked to be able to comp a seat without the word "free"
   appearing anywhere, so the offer keeps its stated value.
   A full-value code enrols the person directly and never touches
   Stripe, which also sidesteps the zero-total checkout problem.
   A partial code hands off to Stripe with the discount applied.
   ════════════════════════════════════════════════════════════ */
export const redeemAccessCode = onCall(
  { ...callOpts, secrets: [STRIPE_SECRET_KEY, SENDGRID_API_KEY, UNSUBSCRIBE_SECRET] },
  async (request) => {
    const slug = clean(request.data?.slug, 80);
    const email = normaliseEmail(request.data?.email);
    const code = clean(request.data?.code, 60).toUpperCase();
    const firstName = clean(request.data?.firstName, 80);

    if (!slug) bad('A class slug is required.');
    if (!isEmail(email)) bad('Please enter the email address you signed up with.');
    if (!code) bad('Please enter your access code.');

    const cls = await loadClass(slug);
    if (!cls) throw new HttpsError('not-found', 'That class does not exist.');

    const blocked = checkoutBlockedReason(cls);
    if (blocked) throw new HttpsError('failed-precondition', blocked);

    const codes = cls._private?.accessCodes || [];
    const match = codes.find((c) => String(c.code || '').toUpperCase() === code && c.active !== false);
    if (!match) throw new HttpsError('not-found', 'That access code is not recognised for this class.');

    if (match.maxRedemptions && Number(match.redemptions || 0) >= Number(match.maxRedemptions)) {
      throw new HttpsError('resource-exhausted', 'That access code has reached its limit.');
    }
    if (match.expiresAt && Date.now() > new Date(match.expiresAt).getTime()) {
      throw new HttpsError('failed-precondition', 'That access code is no longer valid.');
    }

    const pricing = resolvePricing(cls);
    const percentOff = Number(match.percentOff) || 0;

    const id = signupId(email);
    const ref = signupsRef(slug).doc(id);
    const snap = await ref.get();
    if (snap.exists && ['paid', 'enrolled'].includes(snap.data().stage)) {
      throw new HttpsError('already-exists', 'You are already enrolled in this class.');
    }

    /* Full-value code: enrol directly. */
    if (percentOff >= 100) {
      const seated = await claimSeat(slug, id, {
        firstName: firstName || snap.data()?.firstName || '',
        email,
        stage: 'enrolled',
        access: { code, percentOff: 100, redeemedAt: new Date().toISOString() },
        // Someone can be comped without ever filling in the interest
        // form. Give that record the same baseline shape as every
        // other one so exports and queries stay consistent.
        ...(snap.exists ? {} : {
          answers: {}, ghlSynced: false, portalInvited: false,
          portalAccountLinked: false, emailLog: [], unsubscribed: false,
          source: 'access-code', createdAt: FieldValue.serverTimestamp()
        })
      });
      if (!seated.ok) throw new HttpsError('failed-precondition', seated.reason);

      await privateIncrementRedemption(slug, code);

      const signup = { ...(snap.data() || {}), firstName: firstName || snap.data()?.firstName, email, slug };
      const confirm = tpl.enrollmentConfirmed(signup, cls);
      await send({ to: email, subject: confirm.subject, html: confirm.html, categories: ['class-enrolled', slug] });

      const portal = tpl.portalPrep(signup, cls, portalSignupUrl(email, slug));
      await send({ to: email, subject: portal.subject, html: portal.html, categories: ['class-portal', slug] });
      await ref.set({ portalInvited: true }, { merge: true });

      return { enrolled: true, url: null };
    }

    /* Partial code: Stripe checkout with the discount pre-applied. */
    const stripe = stripeClient();
    const discounted = Math.max(50, Math.round(pricing.amount * (1 - percentOff / 100)));
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      client_reference_id: `${slug}:${id}`,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: pricing.currency,
            unit_amount: discounted,
            product_data: { name: cls.name, description: cls.tagline || '' }
          }
        }
      ],
      metadata: { slug, signupId: id, accessCode: code, percentOff: String(percentOff) },
      success_url: `${SITE_URL.value()}/enrolled.html?c=${encodeURIComponent(slug)}&s={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL.value()}/class.html?c=${encodeURIComponent(slug)}`
    });

    await ref.set(
      { stripe: { sessionId: session.id }, access: { code, percentOff }, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    return { enrolled: false, url: session.url };
  }
);

/* ════════════════════════════════════════════════════════════
   STRIPE WEBHOOK
   ════════════════════════════════════════════════════════════ */
export const stripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SENDGRID_API_KEY, UNSUBSCRIBE_SECRET], cors: false },
  async (req, res) => {
    let event;
    try {
      event = stripeClient().webhooks.constructEvent(
        req.rawBody,
        req.headers['stripe-signature'],
        STRIPE_WEBHOOK_SECRET.value()
      );
    } catch (err) {
      logger.error('Stripe signature verification failed', { error: String(err?.message || err) });
      res.status(400).send('Invalid signature');
      return;
    }

    if (event.type !== 'checkout.session.completed') {
      res.json({ received: true });
      return;
    }

    const session = event.data.object;
    const slug = session.metadata?.slug;
    const id = session.metadata?.signupId;
    if (!slug || !id) {
      logger.warn('Checkout completed without class metadata', { sessionId: session.id });
      res.json({ received: true });
      return;
    }

    const ref = signupsRef(slug).doc(id);
    const snap = await ref.get();
    // Stripe retries webhooks; a seat must not be counted twice.
    if (snap.exists && ['paid', 'enrolled'].includes(snap.data().stage)) {
      res.json({ received: true, duplicate: true });
      return;
    }

    const seated = await claimSeat(slug, id, {
      email: normaliseEmail(session.customer_details?.email || session.customer_email),
      stage: 'paid',
      stripe: {
        sessionId: session.id,
        paymentIntentId: session.payment_intent || null,
        amountPaid: session.amount_total,
        currency: session.currency,
        promoCode: session.metadata?.accessCode || null
      }
    });
    if (!seated.ok) logger.error('Seat claim failed after payment', { slug, id, reason: seated.reason });

    const cls = await loadClass(slug);
    const signup = (await ref.get()).data() || {};
    const confirm = tpl.enrollmentConfirmed({ ...signup, slug }, cls);
    await send({ to: signup.email, subject: confirm.subject, html: confirm.html, categories: ['class-enrolled', slug] });

    const portal = tpl.portalPrep({ ...signup, slug }, cls, portalSignupUrl(signup.email, slug));
    await send({ to: signup.email, subject: portal.subject, html: portal.html, categories: ['class-portal', slug] });
    await ref.set({ portalInvited: true }, { merge: true });

    res.json({ received: true });
  }
);

/* ════════════════════════════════════════════════════════════
   ADMIN
   ════════════════════════════════════════════════════════════ */

/** The button Anthony presses when he decides the room is ready. */
export const announceClass = onCall(
  { ...callOpts, secrets: [SENDGRID_API_KEY, UNSUBSCRIBE_SECRET], timeoutSeconds: 540 },
  async (request) => {
    const uid = assertAdmin(request);
    const slug = clean(request.data?.slug, 80);
    const dryRun = Boolean(request.data?.dryRun);
    if (!slug) bad('A class slug is required.');

    const cls = await loadClass(slug);
    if (!cls) throw new HttpsError('not-found', 'That class does not exist.');
    if (!cls.schedule?.sessions?.length) {
      throw new HttpsError('failed-precondition', 'Add the session dates before announcing this class.');
    }

    const recipients = await db
      .collection('classes').doc(slug).collection('signups')
      .where('stage', 'in', ['interest', 'waitlist'])
      .get();

    const targets = recipients.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => s.email && !s.unsubscribed);

    if (dryRun) return { dryRun: true, recipientCount: targets.length };

    const pricing = resolvePricing(cls);
    const checkoutUrl = `${SITE_URL.value()}/class.html?c=${encodeURIComponent(slug)}#enroll`;

    const ics = buildIcs({
      sessions: cls.schedule.sessions,
      name: cls.name,
      description: cls.tagline || cls.name,
      url: checkoutUrl,
      organizerEmail: FROM_EMAIL.value(),
      uidBase: slug
    });
    const attachments = [
      {
        content: Buffer.from(ics).toString('base64'),
        filename: `${slug}.ics`,
        type: 'text/calendar',
        disposition: 'attachment'
      }
    ];

    const messages = targets.map((s) => {
      const { subject, html } = tpl.classAnnouncement({ ...s, slug }, cls, pricing, checkoutUrl);
      return { to: s.email, subject, html, attachments, categories: ['class-announcement', slug] };
    });

    const result = await sendBatch(messages);

    // Flip everyone who was on interest across to announced.
    const batchSize = 400;
    for (let i = 0; i < targets.length; i += batchSize) {
      const batch = db.batch();
      for (const s of targets.slice(i, i + batchSize)) {
        if (s.stage === 'interest') {
          batch.set(
            signupsRef(slug).doc(s.id),
            { stage: 'announced', updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
        }
      }
      await batch.commit();
    }

    await classRef(slug).update({ status: 'scheduled', announcedAt: FieldValue.serverTimestamp() });
    await db.collection('sendLog').add({
      type: 'announcement', slug, by: uid, at: FieldValue.serverTimestamp(), ...result,
      recipientCount: targets.length
    });

    return { recipientCount: targets.length, ...result };
  }
);

/** Portal instructions for anyone who paid but has not been invited. */
export const sendPortalPrep = onCall(
  { ...callOpts, secrets: [SENDGRID_API_KEY, UNSUBSCRIBE_SECRET], timeoutSeconds: 540 },
  async (request) => {
    const uid = assertAdmin(request);
    const slug = clean(request.data?.slug, 80);
    const resend = Boolean(request.data?.resend);
    if (!slug) bad('A class slug is required.');

    const cls = await loadClass(slug);
    if (!cls) throw new HttpsError('not-found', 'That class does not exist.');

    const snap = await signupsRef(slug).where('stage', 'in', ['paid', 'enrolled']).get();
    const targets = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => s.email && !s.unsubscribed && (resend || !s.portalInvited));

    if (request.data?.dryRun) return { dryRun: true, recipientCount: targets.length };

    const messages = targets.map((s) => {
      const { subject, html } = tpl.portalPrep({ ...s, slug }, cls, portalSignupUrl(s.email, slug));
      return { to: s.email, subject, html, categories: ['class-portal', slug] };
    });
    const result = await sendBatch(messages);

    const batch = db.batch();
    for (const s of targets) batch.set(signupsRef(slug).doc(s.id), { portalInvited: true }, { merge: true });
    await batch.commit();

    await db.collection('sendLog').add({
      type: 'portal-prep', slug, by: uid, at: FieldValue.serverTimestamp(), ...result,
      recipientCount: targets.length
    });
    return { recipientCount: targets.length, ...result };
  }
);

/**
 * The signup sheet, read through a function rather than the client
 * SDK so the rules can keep the collection sealed and every bulk
 * read passes through one auditable place.
 */
export const listSignups = onCall(callOpts, async (request) => {
  assertAdmin(request);
  const slug = clean(request.data?.slug, 80);
  if (!slug) bad('A class slug is required.');

  const snap = await signupsRef(slug).orderBy('createdAt', 'desc').limit(2000).get();
  const rows = snap.docs.map((d) => {
    const s = d.data();
    return {
      id: d.id,
      firstName: s.firstName || '',
      email: s.email || '',
      phone: s.phone || '',
      stage: s.stage || 'interest',
      answers: s.answers || {},
      consent: { sms: !!s.consent?.sms, marketing: !!s.consent?.marketing },
      utm: s.utm || {},
      source: s.source || '',
      ghlSynced: !!s.ghlSynced,
      portalInvited: !!s.portalInvited,
      unsubscribed: !!s.unsubscribed,
      amountPaid: s.stripe?.amountPaid || 0,
      accessCode: s.access?.code || s.stripe?.promoCode || '',
      createdAt: s.createdAt?.toMillis?.() || null
    };
  });

  // The breakdown that tells Anthony when to pull the trigger.
  const tally = (key) =>
    rows.reduce((acc, r) => {
      const v = r.answers?.[key];
      for (const item of Array.isArray(v) ? v : v ? [v] : []) acc[item] = (acc[item] || 0) + 1;
      return acc;
    }, {});

  return {
    rows,
    summary: {
      total: rows.length,
      byStage: rows.reduce((a, r) => ({ ...a, [r.stage]: (a[r.stage] || 0) + 1 }), {}),
      byPlatform: tally('platform'),
      byObstacle: tally('obstacle'),
      byTime: tally('timing'),
      byInterest: tally('interests')
    }
  };
});

export const exportSignups = onCall(callOpts, async (request) => {
  assertAdmin(request);
  const slug = clean(request.data?.slug, 80);
  if (!slug) bad('A class slug is required.');

  const [clsSnap, snap] = await Promise.all([
    classRef(slug).get(),
    signupsRef(slug).orderBy('createdAt', 'desc').get()
  ]);
  const fields = clsSnap.data()?.formFields || [];
  const headers = [
    'First Name', 'Email', 'Phone', 'Stage',
    ...fields.map((f) => f.label || f.id),
    'SMS Consent', 'Marketing Consent', 'Source', 'UTM Source', 'UTM Campaign',
    'Amount Paid', 'Access Code', 'Signed Up'
  ];

  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(esc).join(',')];

  for (const doc of snap.docs) {
    const s = doc.data();
    lines.push(
      [
        s.firstName, s.email, s.phone, s.stage,
        ...fields.map((f) => {
          const v = s.answers?.[f.id];
          return Array.isArray(v) ? v.join('; ') : v || '';
        }),
        s.consent?.sms ? 'yes' : 'no',
        s.consent?.marketing ? 'yes' : 'no',
        s.source || '',
        s.utm?.utm_source || '',
        s.utm?.utm_campaign || '',
        s.stripe?.amountPaid ? (s.stripe.amountPaid / 100).toFixed(2) : '',
        s.access?.code || s.stripe?.promoCode || '',
        s.createdAt?.toDate?.().toISOString() || ''
      ].map(esc).join(',')
    );
  }

  return { filename: `${slug}-signups.csv`, csv: lines.join('\n') };
});

/* ════════════════════════════════════════════════════════════
   SCHEDULED: SESSION REMINDERS
   Runs hourly and sends the 24-hour and 1-hour nudges. Show-rate
   is the whole game once someone has paid.
   ════════════════════════════════════════════════════════════ */
export const sendReminders = onSchedule(
  { schedule: 'every 60 minutes', secrets: [SENDGRID_API_KEY, UNSUBSCRIBE_SECRET], timeoutSeconds: 540 },
  async () => {
    const now = Date.now();
    const classes = await db.collection('classes').where('status', '==', 'scheduled').get();

    for (const doc of classes.docs) {
      const cls = { slug: doc.id, ...doc.data() };
      const sessions = cls.schedule?.sessions || [];

      for (let i = 0; i < sessions.length; i++) {
        const startsAt = new Date(sessions[i].startsAt).getTime();
        if (!Number.isFinite(startsAt)) continue;

        const hoursOut = (startsAt - now) / 3600000;
        // Each window is one hour wide, and the cron runs hourly,
        // so every session hits each window exactly once.
        const window = hoursOut > 23 && hoursOut <= 24 ? 24 : hoursOut > 0 && hoursOut <= 1 ? 1 : null;
        if (!window) continue;

        const sentKey = `reminder-${i}-${window}h`;
        if (cls.remindersSent?.includes(sentKey)) continue;

        const snap = await signupsRef(cls.slug).where('stage', 'in', ['paid', 'enrolled']).get();
        const targets = snap.docs.map((d) => d.data()).filter((s) => s.email && !s.unsubscribed);

        const messages = targets.map((s) => {
          const { subject, html } = tpl.sessionReminder({ ...s, slug: cls.slug }, cls, sessions[i], window);
          return { to: s.email, subject, html, categories: ['class-reminder', cls.slug] };
        });
        const result = await sendBatch(messages);

        await classRef(cls.slug).update({ remindersSent: FieldValue.arrayUnion(sentKey) });
        logger.info('Reminders sent', { slug: cls.slug, session: i, window, ...result });
      }
    }
  }
);

/* ════════════════════════════════════════════════════════════
   UNSUBSCRIBE
   ════════════════════════════════════════════════════════════ */
export const unsubscribe = onRequest(
  { secrets: [UNSUBSCRIBE_SECRET], cors: true },
  async (req, res) => {
    const email = normaliseEmail(req.query.e);
    const slug = clean(req.query.c, 80);
    const token = clean(req.query.t, 64);

    if (!email || !slug || !verifyUnsubscribeToken(email, slug, token)) {
      res.status(400).json({ ok: false, error: 'This unsubscribe link is not valid.' });
      return;
    }
    await signupsRef(slug)
      .doc(signupId(email))
      .set({ unsubscribed: true, unsubscribedAt: FieldValue.serverTimestamp() }, { merge: true });
    res.json({ ok: true });
  }
);

/* ════════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════════ */

/**
 * Claims one seat inside a transaction.
 *
 * The capacity cap is the load-bearing piece of the honest-scarcity
 * promise. Two people paying at the same moment must not both get
 * the last seat, so the read of seatsPaid and the write have to
 * happen atomically.
 */
async function claimSeat(slug, id, updates) {
  return db.runTransaction(async (tx) => {
    const cRef = classRef(slug);
    const sRef = signupsRef(slug).doc(id);
    const [cSnap, sSnap] = await Promise.all([tx.get(cRef), tx.get(sRef)]);
    if (!cSnap.exists) return { ok: false, reason: 'Class not found.' };

    const cls = cSnap.data();
    const capacity = Number(cls.capacity) || 0;
    const seatsPaid = Number(cls.seatsPaid) || 0;
    if (capacity > 0 && seatsPaid >= capacity) return { ok: false, reason: 'This cohort is full.' };

    const already = sSnap.exists && ['paid', 'enrolled'].includes(sSnap.data().stage);
    if (already) return { ok: true, duplicate: true };

    tx.set(sRef, { ...updates, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.update(cRef, { seatsPaid: FieldValue.increment(1) });
    return { ok: true };
  });
}

async function privateIncrementRedemption(slug, code) {
  const ref = db.collection('classes').doc(slug).collection('private').doc('config');
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const codes = (snap.data().accessCodes || []).map((c) =>
      String(c.code || '').toUpperCase() === code ? { ...c, redemptions: Number(c.redemptions || 0) + 1 } : c
    );
    tx.update(ref, { accessCodes: codes });
  });
}

const portalSignupUrl = (email, slug) =>
  `${PORTAL_URL.value()}/signup.html?ref=${encodeURIComponent(slug)}&email=${encodeURIComponent(email || '')}`;
