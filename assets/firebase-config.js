/* ============================================================
   FIREBASE WEB CONFIG
   ------------------------------------------------------------
   Fill these in from Firebase console → Project settings → Your apps.
   These values are public by design; the security boundary is
   Firestore/Storage rules plus the getModuleVideos callable, not
   secrecy of this file.

   Until apiKey is filled in, the course pages run in PREVIEW mode:
   structure and copy render, nothing gated is fetched, and the
   sign-in call to action points at the member portal.
============================================================ */

export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: ''
};

/* Where unauthenticated members are sent to sign in. */
export const PORTAL_LOGIN_URL = 'https://the1p-leadership.web.app/login.html?ref=rewrite-method';

/* Region the callable functions are deployed to. */
export const FUNCTIONS_REGION = 'us-central1';

export const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
