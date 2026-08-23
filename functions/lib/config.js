import { defineSecret, defineString } from 'firebase-functions/params';

// Secrets live in Google Secret Manager, never in this repo.
// Set them once with:
//   firebase functions:secrets:set STRIPE_SECRET_KEY
//   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
//   firebase functions:secrets:set SENDGRID_API_KEY
export const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
export const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
export const SENDGRID_API_KEY = defineSecret('SENDGRID_API_KEY');

// Signs unsubscribe links. Kept separate from the SendGrid key on
// purpose: rotating an email provider key must not invalidate every
// unsubscribe link already sitting in people's inboxes.
//   firebase functions:secrets:set UNSUBSCRIBE_SECRET
export const UNSUBSCRIBE_SECRET = defineSecret('UNSUBSCRIBE_SECRET');

// Non-secret configuration. Override per environment in .env files
// or with `firebase functions:config`. Defaults match production.
export const SITE_URL = defineString('SITE_URL', { default: 'https://the1pnation.com' });
export const PORTAL_URL = defineString('PORTAL_URL', { default: 'https://the1p-leadership.web.app' });
export const FROM_EMAIL = defineString('FROM_EMAIL', { default: 'anthony@the1pnation.com' });
export const FROM_NAME = defineString('FROM_NAME', { default: 'Anthony, The One Percent' });
export const REPLY_TO = defineString('REPLY_TO', { default: 'the1percentnation@gmail.com' });

// CAN-SPAM requires a real physical postal address in every
// commercial email. Set this before the first send goes out.
export const MAILING_ADDRESS = defineString('MAILING_ADDRESS', {
  default: 'The One Percent Nation, [STREET ADDRESS], [CITY, STATE ZIP]'
});

// Default GoHighLevel form endpoint. This is the same widget id the
// webinar page already posts to, so signups land in the pipeline
// Anthony already works out of. Per-class overrides live in
// classes/{slug}/private/config.ghlFormId.
export const DEFAULT_GHL_FORM_ID = '2RRVTzt8PJABfOAPd84Z';

export const REGION = 'us-central1';

// Browser origins allowed to call the public HTTP functions.
export const ALLOWED_ORIGINS = [
  'https://the1pnation.com',
  'https://www.the1pnation.com',
  'https://the-1p-leadership.web.app',
  'https://the-1p-leadership.firebaseapp.com',
  'http://localhost:5000',
  'http://127.0.0.1:5000'
];
