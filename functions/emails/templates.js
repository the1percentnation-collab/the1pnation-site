import { wrap, button, h, p, escapeHtml } from '../lib/mail.js';
import { formatMoney } from '../lib/pricing.js';

/**
 * Every template below is written to the brand voice in
 * one-percent-context: grounded, direct, no hype, no fear urgency,
 * no em dashes. Anthony can override any of these per class from
 * the admin console; these are the defaults.
 */

const ctx = (signup, cls) => ({ email: signup.email, slug: cls.slug });
const firstName = (s) => escapeHtml(s.firstName || 'there');

/* ── 1. WELCOME, AND YOU ARE ON THE LIST ───────────────────
   Sent the moment someone signs up. It does two jobs at once:
   confirms the class, and introduces the portal account that was
   created for them in the background.

   This email is the disclosure. The form is short on purpose and
   does not walk them through account creation, so this is where
   they find out the login exists and how to take ownership of it.
   That is why the set-password link is the primary action rather
   than a footnote. */
export function welcomeAndInterest(signup, cls, pricing, setPasswordLink) {
  const subject = `You're in. Here's your access to ${cls.name}.`;
  const portalBlock = setPasswordLink
    ? p(`I've already set up your member portal account under <strong style="color:#fff;">${escapeHtml(signup.email)}</strong>, so there is nothing for you to fill in twice. Choose your password and it's yours.`) +
      button(setPasswordLink, 'Set My Password') +
      p(`<span style="color:#A0A0A0;font-size:13px;">That link is good for one hour. If it expires, use "forgot password" on the portal login page and it will send you a fresh one.</span>`)
    : p(`Your member portal account is set up under <strong style="color:#fff;">${escapeHtml(signup.email)}</strong>. Use "forgot password" on the portal login page to choose your password.`);

  const html = wrap({
    ...ctx(signup, cls),
    preheader: 'Your spot is saved and your portal access is ready. The dates come next.',
    body:
      h(`You're on the list, ${signup.firstName || 'friend'}.`) +
      p(`Thanks for raising your hand for <strong style="color:#fff;">${escapeHtml(cls.name)}</strong>. Your spot is saved.`) +
      p(`Here's what happens next. Once the room is the right size I'll send you the dates, the session times, and everything you need to take your seat. Nothing else is needed from you today.`) +
      portalBlock +
      p(`The portal is where the sessions, the workbooks, and the replays live, so getting in now means you're ready before we start rather than five minutes into the first session.`) +
      p(`One thing that would help. Reply to this email and tell me the single thing about social media that frustrates you most. I read every one, and the answers shape what I teach in the room.`) +
      p(`Talk soon,<br>Anthony`)
  });
  return { subject, html };
}

/* Kept for classes that do not create a portal account, and as the
   fallback when account creation failed and Anthony resends. */
/* ── 1. INTEREST CONFIRMATION ──────────────────────────────
   Sent the moment someone raises their hand. Its only jobs are to
   confirm we have them, set the expectation that the date comes
   later, and make it clear they do not need to do anything now. */
export function interestConfirmation(signup, cls, pricing) {
  const subject = `You're on the list for ${cls.name}`;
  const html = wrap({
    ...ctx(signup, cls),
    preheader: 'Your spot is reserved on the interest list. The schedule comes next.',
    body:
      h(`You're on the list, ${signup.firstName || 'friend'}.`) +
      p(`Thanks for raising your hand for <strong style="color:#fff;">${escapeHtml(cls.name)}</strong>. You are on the interest list, and that is all you need to do right now.`) +
      p(`Here is what happens next. Once the room is the right size, I will send you the schedule, the session times, and everything you need to enroll. No account to create today. No payment today.`) +
      p(`The seat is <strong style="color:#fff;">${escapeHtml(formatMoney(pricing.amount, pricing.currency))}</strong>${pricing.foundingActive ? ` at the founding rate, which is held for the people already on this list.` : `.`}`) +
      p(`One thing that would help. Reply to this email and tell me the single thing about social media that frustrates you most. I read every one, and the answers shape what I teach in the room.`) +
      p(`Talk soon,<br>Anthony`)
  });
  return { subject, html };
}

/* ── 2. THE ANNOUNCEMENT ───────────────────────────────────
   The email Anthony triggers by hand when he decides the room is
   ready. This is the one that carries the date, the price, the
   checkout link, and the access code field. */
export function classAnnouncement(signup, cls, pricing, checkoutUrl) {
  const subject = `${cls.name} is scheduled. Here are the dates.`;
  const sessionRows = (cls.schedule?.sessions || [])
    .map((s, i) => {
      const when = s.startsAt
        ? new Date(s.startsAt).toLocaleString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric',
            hour: 'numeric', minute: '2-digit', timeZone: cls.schedule?.timezone || 'America/New_York'
          })
        : 'Time to be confirmed';
      return `<tr>
<td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.08);vertical-align:top;width:32px;color:#E60306;font-weight:700;">${i + 1}</td>
<td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
  <div style="color:#fff;font-weight:600;">${escapeHtml(s.title || `Session ${i + 1}`)}</div>
  <div style="color:#A0A0A0;font-size:13px;">${escapeHtml(when)}${cls.schedule?.timezone ? ` ${escapeHtml(tzLabel(cls.schedule.timezone))}` : ''}</div>
</td></tr>`;
    })
    .join('');

  const html = wrap({
    ...ctx(signup, cls),
    preheader: 'The dates are set. Your seat is not held until you enroll.',
    body:
      h('The dates are set.') +
      p(`${firstName(signup)}, you asked to know when <strong style="color:#fff;">${escapeHtml(cls.name)}</strong> was happening. It is scheduled.`) +
      (sessionRows
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">${sessionRows}</table>`
        : '') +
      p(pricing.foundingActive
        ? `Your seat is <strong style="color:#fff;">${escapeHtml(formatMoney(pricing.amount, pricing.currency))}</strong> at the founding rate, down from ${escapeHtml(formatMoney(pricing.fullAmount, pricing.currency))}. That rate holds until ${escapeHtml(new Date(pricing.foundingUntil).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }))}.`
        : `Your seat is <strong style="color:#fff;">${escapeHtml(formatMoney(pricing.amount, pricing.currency))}</strong>.`) +
      (cls.capacity ? p(`The room is capped at ${cls.capacity}. That cap is real, and it is what makes the hot seats and profile teardowns possible.`) : '') +
      button(checkoutUrl, 'Claim My Seat') +
      p(`<span style="color:#A0A0A0;font-size:13px;">If you were given an access code, enter it on the enrollment page and it will be applied to your seat.</span>`) +
      p(`The calendar invitations are attached so you can drop the sessions straight into your calendar.`) +
      p(`See you in the room,<br>Anthony`)
  });
  return { subject, html };
}

/* ── 3. ENROLLED ───────────────────────────────────────────
   Sent after payment or after a full access code is redeemed. The
   same email serves both, and it never mentions what was paid, so
   a comped seat reads identically to a purchased one. */
export function enrollmentConfirmed(signup, cls) {
  const subject = `Your seat in ${cls.name} is confirmed`;
  const html = wrap({
    ...ctx(signup, cls),
    preheader: 'Your seat is confirmed. One short step before the first session.',
    body:
      h('Your seat is confirmed.') +
      p(`${firstName(signup)}, you are in. <strong style="color:#fff;">${escapeHtml(cls.name)}</strong> is yours.`) +
      p(`One short step before we start. The sessions, the workbooks, and the replays all live inside the member portal, so I need you to set up your portal account. It takes about a minute and you only do it once.`) +
      p(`I will send that link in a separate email so it does not get lost in this one.`) +
      p(`Before the first session, do one thing for me. Open the platform that frustrates you most and just look at your last ten posts. Do not fix anything. Do not delete anything. Just look. We start there.`) +
      p(`Anthony`)
  });
  return { subject, html };
}

/* ── 4. PORTAL PREP ────────────────────────────────────────
   Deliberately its own email, sent after enrollment rather than
   before. Account creation is the friction we moved to the back of
   the funnel on purpose. */
export function portalPrep(signup, cls, portalUrl) {
  const subject = `One step before ${cls.name} starts`;
  const html = wrap({
    ...ctx(signup, cls),
    preheader: 'Set up your portal account so you can get into the sessions.',
    body:
      h('Set up your portal access.') +
      p(`${firstName(signup)}, this is the only setup step for <strong style="color:#fff;">${escapeHtml(cls.name)}</strong>.`) +
      p(`Everything for the class lives in the member portal. The live session links, the workbook for each session, the replays, and the accountability group. To get in, you need a portal account under this email address.`) +
      button(portalUrl, 'Create My Portal Account') +
      p(`<span style="color:#A0A0A0;font-size:13px;">Use <strong style="color:#fff;">${escapeHtml(signup.email)}</strong> when you sign up. That is the address your seat is registered under, and using a different one will leave you locked out of the class materials.</span>`) +
      p(`Do this before the first session rather than five minutes into it. Password resets during a live call are the one thing I cannot coach you through.`) +
      p(`Anthony`)
  });
  return { subject, html };
}

/* ── 5. REMINDER ──────────────────────────────────────────── */
export function sessionReminder(signup, cls, session, hoursOut) {
  const when = hoursOut >= 24 ? 'tomorrow' : 'in one hour';
  const subject = `${cls.name} starts ${when}`;
  const html = wrap({
    ...ctx(signup, cls),
    preheader: `${escapeHtml(session.title || 'Your session')} starts ${when}.`,
    body:
      h(`We start ${when}.`) +
      p(`${firstName(signup)}, <strong style="color:#fff;">${escapeHtml(session.title || cls.name)}</strong> starts ${when}.`) +
      (cls.schedule?.joinUrl ? button(cls.schedule.joinUrl, 'Join The Session') : '') +
      p(`Come with the platform you are working on open in another tab. This is a working session, not a lecture.`) +
      p(`Anthony`)
  });
  return { subject, html };
}

/* ── 6. WAITLIST ───────────────────────────────────────────
   What someone gets when the cohort is genuinely full. Honest
   scarcity only works if the sold-out state behaves like one. */
export function waitlistConfirmation(signup, cls) {
  const subject = `${cls.name} filled. You're first in line for the next one.`;
  const html = wrap({
    ...ctx(signup, cls),
    preheader: 'This cohort is full. You are at the front of the queue for the next one.',
    body:
      h('This cohort filled.') +
      p(`${firstName(signup)}, <strong style="color:#fff;">${escapeHtml(cls.name)}</strong> is at capacity, and I hold that cap because the room stops working past it.`) +
      p(`You are on the waitlist. Two things happen from here. If a seat opens in this cohort, you get the first message. And when I schedule the next one, you hear about it before it goes public.`) +
      p(`Anthony`)
  });
  return { subject, html };
}

const tzLabel = (tz) => (tz || '').split('/').pop().replace(/_/g, ' ');
