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
 * The portal is a separate REPO (the1percentnation-collab/the-1p-leadership,
 * served from the1p-leadership.web.app) but its .firebaserc and its
 * public/js/firebase.js both name Firebase project `the-1p-leadership`,
 * the same project this site runs in.
 *
 * One project means one Auth user pool, so an account created here IS
 * the portal login. No extra credentials are needed.
 *
 * PORTAL_SERVICE_ACCOUNT exists only for the other case, a portal in a
 * genuinely separate Firebase project with its own user list. Leave it
 * unset. Every signup still records the project id its account landed
 * in, and the admin console shows it, so if the two are ever split
 * apart the mismatch shows up on the next signup.
 *
 * THE PROFILE SHAPE IS NOT A GUESS
 * The document written below mirrors ensureUserDoc() in the portal's
 * public/js/auth.js, which is what the portal itself writes when
 * somebody signs up there. Matching it is what makes an account
 * created here work on first login instead of dropping the person
 * into a half-built profile.
 */

const PORTAL_APP_NAME = 'portal';
let resolved = null;

export function portalApp() {
  if (resolved) return resolved;

  const raw = PORTAL_SERVICE_ACCOUNT.value();
  if (!raw) {
    // Expected path. The portal shares this project, so the default
    // app is the right one and its user pool is the portal's.
    resolved = {
      app: getApp(),
      projectId: process.env.GCLOUD_PROJECT || 'the-1p-leadership',
      dedicated: false
    };
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

// The portal bootstraps this address to the owner role in
// ensureUserDoc(). Mirrored here so signing up through a class form
// with it cannot overwrite the owner role with a plain one.
const OWNER_EMAIL = 'the1percentnation@gmail.com';

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

  /* Profile document, matching ensureUserDoc() in the portal's
     public/js/auth.js.

     Two halves, and the split matters. `role`, `tier`, `companyId`,
     and `createdAt` are written ONLY when the document does not exist
     yet. Merging them into an existing profile would quietly demote a
     member who has since been made an admin, or moved onto a company
     tier, back to a plain individual. A class signup must never be
     able to do that.

     Everything else is additive and safe to merge on every signup. */
  const cfg = { ...DEFAULT_PROFILE, ...(profileConfig || {}) };
  const map = { ...DEFAULT_PROFILE.fields, ...(profileConfig?.fields || {}) };
  const profileRef = db.collection(cfg.collection).doc(user.uid);
  const existingProfile = await profileRef.get();

  const profile = {
    [map.email]: email,
    [map.displayName]: displayName || null,
    // Not part of the portal's own schema, but Anthony asked for them
    // and extra fields do not disturb how the portal reads the doc.
    [map.firstName]: firstName || '',
    [map.lastName]: lastName || '',
    [map.phone]: phone || '',
    lastActiveAt: FieldValue.serverTimestamp()
  };

  if (!existingProfile.exists) {
    profile.role = email.toLowerCase() === OWNER_EMAIL ? 'owner' : 'user';
    profile.companyId = null;
    profile.tier = 'individual';
    profile.createdAt = FieldValue.serverTimestamp();
    profile.source = 'class-signup';
  }

  // Every class this person has joined, without disturbing earlier ones.
  if (classSlug) {
    profile.classes = FieldValue.arrayUnion({ slug: classSlug, name: className || classSlug });
  }

  await profileRef.set(profile, { merge: true });

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
