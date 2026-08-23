import { DEFAULT_GHL_FORM_ID } from './config.js';

/**
 * Mirrors a signup into GoHighLevel.
 *
 * The webinar page posts to this same endpoint from the browser
 * with mode:'no-cors', which means it can never tell whether the
 * submission actually landed. Doing it server side gives us a real
 * status code, a retry, and a ghlSynced flag on the record, so a
 * CRM outage shows up as a fixable flag instead of a silently lost
 * lead.
 */
export async function pushToGoHighLevel(signup, cls) {
  const formId = cls?._private?.ghlFormId || DEFAULT_GHL_FORM_ID;
  const url = `https://api.leadconnectorhq.com/widget/form/${formId}`;

  const body = new URLSearchParams();
  body.set('full_name', signup.firstName || '');
  body.set('first_name', signup.firstName || '');
  body.set('email', signup.email || '');
  if (signup.phone) body.set('phone', signup.phone);

  body.set('class_slug', cls.slug || '');
  body.set('class_name', cls.name || '');
  body.set('signup_stage', signup.stage || 'interest');
  body.set('source', signup.source || 'website');

  // Answers become flat fields so they map onto GHL custom fields.
  for (const [key, value] of Object.entries(signup.answers || {})) {
    body.set(key, Array.isArray(value) ? value.join(', ') : String(value));
  }

  // The interest multi-select becomes tags. This is what makes the
  // list pay off later: every person is already segmented by which
  // offers they said they wanted before the next launch exists.
  const tags = buildTags(signup, cls);
  if (tags.length) body.set('tags', tags.join(','));

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) return { ok: true, status: res.status };
      // 4xx means the request itself is wrong; retrying will not help.
      if (res.status >= 400 && res.status < 500) {
        return { ok: false, status: res.status, error: 'rejected by GoHighLevel' };
      }
    } catch (err) {
      if (attempt === 2) return { ok: false, error: String(err?.message || err) };
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  return { ok: false, error: 'exhausted retries' };
}

export function buildTags(signup, cls) {
  const tags = new Set();
  if (cls?.slug) tags.add(`class:${cls.slug}`);
  tags.add(`stage:${signup.stage || 'interest'}`);

  const interests = signup.answers?.interests;
  if (Array.isArray(interests)) {
    for (const item of interests) {
      tags.add(`wants:${String(item).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`);
    }
  }
  const platform = signup.answers?.platform;
  if (platform) tags.add(`platform:${String(platform).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);

  return [...tags];
}
