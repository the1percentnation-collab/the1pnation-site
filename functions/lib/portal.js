import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { logger } from 'firebase-functions';
import { PORTAL_SERVICE_ACCOUNT, PORTAL_URL } from './config.js';

/**
 * Creates member portal accounts as a side effect of class signup.
 *
 * The visitor fills in a class signup form. They never choose a
 * password and never see an account creation step. This module makes
 * the login exist anyway, and the welcome email is what tells them
 * about it and hands them a link to set their own password.
 *
 * WHICH PROJECT
 * The site runs in Firebase project `the-1p-leadership`. The portal
 * lives at `the1p-leadership.web.app`, which is a different name and
 * therefore almost certainly a different project with its own user
 * pool. Creating a user in this project would not create a portal
 * login.
 *
 * So accounts are created through a named secondary Admin app built
 * from PORTAL_SERVICE_ACCOUNT. If that secret is not set we fall back
 * to the default app, which is the correct behaviour if the portal
 * turns out to be a second hosting site inside this same project.
 *
 * Because a wrong guess here is silent, every signup records the
 * project id the account was actually created in, and the admin
 * console shows it. A misconfiguration is then visible on the first
 * test signup instead of months later.
 */

const PORTAL_APP_NAME = 'portal';
let resolved = null;

export function portalApp() {
  if (resolved) return resolved;

  const raw = PORTAL_SERVICE_ACCOUNT.value();
  if (!raw) {
    // No portal credentials configured. Use the default app, and say
    // so loudly enough to find in the logs.
    logger.warn(
      'PORTAL_SERVICE_ACCOUNT is not set. Portal accounts will be created in this project. ' +
      'If the portal is a separate Firebase project, those accounts will not work.'
    );
    resolved = { app: getApp(), projectId: process.env.GCLOUD_PROJECT || 'default', dedicated: false };
    return resolved;
  }

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error('PORTAL_SERVICE_ACCOUNT is not valid JSON. Paste the whole service account key file.');
  }

  const existing = getApps().find((a) => a.name === PORTAL_APP_NAME);
  const app = existing || initializeApp({ credential: cert(credentials) }, PORTAL_APP_NAME);
  resolved = { app, projectId: credentials.project_id, dedicated: true };
  return resolved;
}

/**
 * Firebase rejects phone numbers that are not E.164, and a malformed
 * one must never cost a lead. Anything we cannot confidently convert
 * is simply left off the Auth record; the raw value still reaches the
 * profile document and the CRM.
 */
export function toE164(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : null;
  const bare = digits.replace(/\D/g, '');
  if (bare.length === 10) return `+1${bare}`;            // US or Canada, typed locally
  if (bare.length === 11 && bare.startsWith('1')) return `+${bare}`;
  return null;
}

const DEFAULT_PROFILE = {
  collection: 'users',
  fields: {
    firstName: 'firstName',
    lastName: 'lastName',
    email: 'email',
    phone: 'phone',
    displayName: 'displayName'
  }
};

/**
 * Creates (or finds) the portal account for one person.
 *
 * Never overwrites an existing user. Someone signing up for a second
 * class must not have their password reset or their profile clobbered,
 * so an existing account is returned untouched.
 *
 * @returns {{created:boolean, uid:string, setPasswordLink:string|null, projectId:string}}
 */
export async function createPortalAccount({
  firstName, lastName, email, phone, classSlug, className, profileConfig
}) {
  const { app, projectId } = portalApp();
  const auth = getAuth(app);
  const db = getFirestore(app);

  const displayName = [firstName, lastName].filter(Boolean).join(' ').trim() || firstName || '';
  const e164 = toE164(phone);

  let user = null;
  let created = false;

  try {
    user = await auth.getUserByEmail(email);
  } catch (err) {
    if (err?.code !== 'auth/user-not-found') throw err;
  }

  if (!user) {
    try {
      user = await auth.createUser({
        email,
        emailVerified: false,
        displayName: displayName || undefined,
        // A password they will never see or need. The welcome email
        // carries a link that lets them choose their own.
        password: randomBytes(32).toString('base64url'),
        ...(e164 ? { phoneNumber: e164 } : {})
      });
      created = true;
    } catch (err) {
      // Two accounts racing on the same address, or a phone number
      // already attached to someone else. Fall back to creating
      // without the phone, then to just finding the existing user.
      if (err?.code === 'auth/phone-number-already-exists' || err?.code === 'auth/invalid-phone-number') {
        user = await auth.createUser({
          email,
          emailVerified: false,
          displayName: displayName || undefined,
          password: randomBytes(32).toString('base64url')
        });
        created = true;
      } else if (err?.code === 'auth/email-already-exists') {
        user = await auth.getUserByEmail(email);
      } else {
        throw err;
      }
    }
  }

  /* Profile document.
     The portal's real schema is not visible from this repo, so the
     collection and field names are configurable per class in
     classes/{slug}/private/config under `portal`. If the portal
     expects different names this is an admin console edit rather
     than a code change. */
  const cfg = { ...DEFAULT_PROFILE, ...(profileConfig || {}) };
  const map = { ...DEFAULT_PROFILE.fields, ...(profileConfig?.fields || {}) };

  const profile = {
    [map.firstName]: firstName || '',
    [map.lastName]: lastName || '',
    [map.email]: email,
    [map.phone]: phone || '',
    [map.displayName]: displayName,
    source: 'class-signup',
    updatedAt: FieldValue.serverTimestamp()
  };
  if (created) profile.createdAt = FieldValue.serverTimestamp();

  // Track every class this person has joined without overwriting the
  // ones already there.
  if (classSlug) {
    profile.classes = FieldValue.arrayUnion({ slug: classSlug, name: className || classSlug });
  }

  await db.collection(cfg.collection).doc(user.uid).set(profile, { merge: true });

  /* Set-password link. Only for accounts we just created; someone who
     already had a portal login does not need one and should not be
     invited to reset a password they already know. */
  let setPasswordLink = null;
  if (created) {
    try {
      setPasswordLink = await auth.generatePasswordResetLink(email, {
        url: `${PORTAL_URL.value()}/login.html?welcome=1`,
        handleCodeInApp: false
      });
    } catch (err) {
      // The account exists and is the important part. Without this
      // link the welcome email points at the portal's own password
      // reset instead.
      logger.warn('Could not generate a set-password link', { error: String(err?.message || err) });
    }
  }

  return { created, uid: user.uid, setPasswordLink, projectId };
}
