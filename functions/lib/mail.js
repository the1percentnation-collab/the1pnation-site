import sgMail from '@sendgrid/mail';
import { createHmac } from 'node:crypto';
import {
  SENDGRID_API_KEY, UNSUBSCRIBE_SECRET, FROM_EMAIL, FROM_NAME,
  REPLY_TO, MAILING_ADDRESS, SITE_URL
} from './config.js';

let configured = false;
function client() {
  if (!configured) {
    const key = SENDGRID_API_KEY.value();
    if (!key) throw new Error('SENDGRID_API_KEY is not set. Run: firebase functions:secrets:set SENDGRID_API_KEY');
    sgMail.setApiKey(key);
    configured = true;
  }
  return sgMail;
}

/**
 * Unsubscribe links are signed rather than guessable, so nobody can
 * unsubscribe someone else by editing a URL.
 */
function signingKey() {
  // Falls back only in the emulator, where secrets are unset.
  return UNSUBSCRIBE_SECRET.value() || 'local-emulator-only';
}

export function unsubscribeUrl(email, slug) {
  const token = createHmac('sha256', signingKey())
    .update(`${email}:${slug}`)
    .digest('hex')
    .slice(0, 32);
  const q = new URLSearchParams({ e: email, c: slug, t: token });
  return `${SITE_URL.value()}/unsubscribe.html?${q}`;
}

export function verifyUnsubscribeToken(email, slug, token) {
  const expected = createHmac('sha256', signingKey())
    .update(`${email}:${slug}`)
    .digest('hex')
    .slice(0, 32);
  return expected === token;
}

/**
 * Shared HTML shell. Dark, matches the site, and carries the two
 * things CAN-SPAM actually requires: a working unsubscribe and a
 * real physical mailing address.
 */
export function wrap({ preheader, body, email, slug }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>The One Percent Nation</title></head>
<body style="margin:0;padding:0;background:#080808;color:#ffffff;font-family:'Outfit',Helvetica,Arial,sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader || '')}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#151515;border:1px solid rgba(255,255,255,0.08);border-radius:14px;overflow:hidden;">
  <tr><td style="height:3px;background:linear-gradient(90deg,transparent,#E60306,transparent);"></td></tr>
  <tr><td style="padding:32px 32px 8px;">
    <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#A0A0A0;font-family:'Space Mono',monospace;">The One Percent</div>
    <div style="font-size:20px;letter-spacing:0.06em;color:#ffffff;font-weight:700;">NATION</div>
  </td></tr>
  <tr><td style="padding:16px 32px 32px;font-size:15px;line-height:1.7;color:#D8D8D8;">${body}</td></tr>
  <tr><td style="padding:20px 32px 28px;border-top:1px solid rgba(255,255,255,0.08);font-size:11px;line-height:1.6;color:#606060;">
    ${escapeHtml(MAILING_ADDRESS.value())}<br>
    <a href="${unsubscribeUrl(email, slug)}" style="color:#A0A0A0;">Unsubscribe</a> from these updates at any time.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

export function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr>
<td style="background:#E60306;border-radius:6px;">
<a href="${href}" style="display:inline-block;padding:15px 32px;color:#ffffff;font-size:15px;font-weight:700;letter-spacing:0.03em;text-decoration:none;">${escapeHtml(label)}</a>
</td></tr></table>`;
}

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const h = (text) =>
  `<div style="font-size:26px;line-height:1.25;font-weight:700;color:#ffffff;margin:0 0 16px;">${escapeHtml(text)}</div>`;

export const p = (html) => `<p style="margin:0 0 16px;">${html}</p>`;

/**
 * Sends one message. Returns a result rather than throwing so a
 * single bad address in a batch of 200 cannot abort the send.
 */
export async function send({ to, subject, html, text, attachments, categories }) {
  try {
    const [res] = await client().send({
      to,
      from: { email: FROM_EMAIL.value(), name: FROM_NAME.value() },
      replyTo: REPLY_TO.value(),
      subject,
      text: text || stripHtml(html),
      html,
      attachments,
      categories,
      trackingSettings: { clickTracking: { enable: true }, openTracking: { enable: true } }
    });
    return { ok: true, messageId: res?.headers?.['x-message-id'] || null };
  } catch (err) {
    const detail = err?.response?.body?.errors?.[0]?.message || err?.message || String(err);
    return { ok: false, error: detail };
  }
}

/** SendGrid accepts up to 1000 personalisations per call; we batch well under it. */
export async function sendBatch(messages, { concurrency = 10 } = {}) {
  const results = [];
  for (let i = 0; i < messages.length; i += concurrency) {
    const slice = messages.slice(i, i + concurrency);
    results.push(...(await Promise.all(slice.map(send))));
  }
  return {
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    errors: results.filter((r) => !r.ok).map((r) => r.error).slice(0, 10)
  };
}

const stripHtml = (html) =>
  String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
