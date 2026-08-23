import { HttpsError } from 'firebase-functions/v2/https';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Trim, collapse whitespace, and cap length on any free-text value. */
export function clean(value, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function isEmail(value) {
  const v = String(value || '').trim();
  return v.length <= 254 && EMAIL_RE.test(v);
}

/**
 * Phone numbers are stored as entered but normalised to digits for
 * the CRM. We deliberately do not reject unusual formats; a bad
 * phone number is not worth losing a lead over.
 */
export function cleanPhone(value) {
  const digits = String(value || '').replace(/[^\d+]/g, '');
  return digits.slice(0, 20);
}

/**
 * Bot filtering without a CAPTCHA, which would add friction to the
 * exact form we are trying to keep frictionless.
 *
 * Two signals, both cheap:
 *   1. A honeypot field positioned off-screen. Humans never see it.
 *   2. Time-to-submit. A human cannot read this form and fill it in
 *      under two seconds; scripted submissions routinely do.
 */
export function looksAutomated({ honeypot, renderedAt }) {
  if (clean(honeypot)) return 'honeypot';
  const elapsed = Date.now() - Number(renderedAt || 0);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 2000) return 'too-fast';
  return null;
}

/**
 * Validates submitted answers against the class's own formFields
 * schema. Because Anthony builds those fields in the admin console,
 * validation has to be driven by the schema rather than hardcoded,
 * or every new class would need a code change.
 */
export function validateAnswers(formFields = [], submitted = {}) {
  const answers = {};
  const errors = [];

  for (const field of formFields) {
    const raw = submitted[field.id];
    const label = field.label || field.id;

    if (field.type === 'checkbox') {
      const chosen = Array.isArray(raw) ? raw.map((v) => clean(v, 120)) : [];
      const valid = chosen.filter((v) => (field.options || []).includes(v));
      if (field.required && !valid.length) errors.push(`${label} is required.`);
      if (valid.length) answers[field.id] = valid;
      continue;
    }

    const value = clean(raw, field.type === 'textarea' ? 2000 : 300);
    if (!value) {
      if (field.required) errors.push(`${label} is required.`);
      continue;
    }

    // For choice fields, only accept values the schema actually
    // offers. Stops arbitrary strings landing in the CRM as tags.
    if ((field.type === 'radio' || field.type === 'select') && Array.isArray(field.options)) {
      if (!field.options.includes(value)) {
        errors.push(`${label} has an unexpected value.`);
        continue;
      }
    }
    answers[field.id] = value;
  }

  return { answers, errors };
}

/** Extracts UTM parameters and referrer, capped and sanitised. */
export function cleanAttribution(source = {}) {
  const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  const utm = {};
  for (const k of keys) {
    const v = clean(source[k], 120);
    if (v) utm[k] = v;
  }
  return { utm, referrer: clean(source.referrer, 300), landingPath: clean(source.landingPath, 200) };
}

export function assertAdmin(request) {
  if (!request.auth?.token?.admin) {
    throw new HttpsError('permission-denied', 'This action requires an administrator account.');
  }
  return request.auth.uid;
}

export function bad(message) {
  throw new HttpsError('invalid-argument', message);
}
