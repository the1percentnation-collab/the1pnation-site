/**
 * Grants the admin custom claim that gates the console and every
 * admin-only function.
 *
 *   cd functions && node scripts/grant-admin.js the1percentnation@gmail.com
 *
 * The user must already exist in Firebase Auth. They need to sign
 * out and back in for the new claim to appear in their token.
 */
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const email = process.argv[2];
const revoke = process.argv.includes('--revoke');

if (!email) {
  console.error('Usage: node scripts/grant-admin.js <email> [--revoke]');
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GCLOUD_PROJECT || 'the-1p-leadership'
  });
}

const auth = getAuth();
const user = await auth.getUserByEmail(email);
await auth.setCustomUserClaims(user.uid, revoke ? { admin: false } : { admin: true });
// Force existing sessions to pick up the change on next refresh.
await auth.revokeRefreshTokens(user.uid);

console.log(`${revoke ? 'Revoked' : 'Granted'} admin for ${email} (uid ${user.uid}).`);
console.log('Sign out and back in for the claim to take effect.');
process.exit(0);
