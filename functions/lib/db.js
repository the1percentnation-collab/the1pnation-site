import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { createHash } from 'node:crypto';

if (!getApps().length) initializeApp();

export const db = getFirestore();
export const auth = getAuth();
export { FieldValue };

/**
 * Signup document ids are a hash of the normalised email.
 *
 * This makes submission idempotent: someone who double-taps the
 * button on a phone, or who comes back a week later and signs up
 * again, updates their existing record rather than creating a
 * duplicate that would then get emailed twice.
 */
export function signupId(email) {
  return createHash('sha256').update(normaliseEmail(email)).digest('hex').slice(0, 32);
}

export function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export const classRef = (slug) => db.collection('classes').doc(slug);
export const signupsRef = (slug) => classRef(slug).collection('signups');
export const privateRef = (slug) => classRef(slug).collection('private').doc('config');

/** Loads the public class doc and its private config together. */
export async function loadClass(slug) {
  const [pub, priv] = await Promise.all([classRef(slug).get(), privateRef(slug).get()]);
  if (!pub.exists) return null;
  return { slug, ...pub.data(), _private: priv.exists ? priv.data() : {} };
}
