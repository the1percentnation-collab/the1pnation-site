/**
 * Firebase client bootstrap.
 *
 * The values below are the Firebase *web* config. They are public
 * by design and safe to commit: they identify the project, they do
 * not authorise anything. All access control lives in
 * firestore.rules and in the admin claim checks inside the Cloud
 * Functions.
 *
 * TO FILL IN: Firebase console -> Project settings -> General ->
 * Your apps -> Web app -> SDK setup and configuration -> Config.
 * If no web app is registered yet, click "Add app" and pick Web.
 */
export const firebaseConfig = {
  apiKey: 'REPLACE_WITH_WEB_API_KEY',
  authDomain: 'the-1p-leadership.firebaseapp.com',
  projectId: 'the-1p-leadership',
  storageBucket: 'the-1p-leadership.firebasestorage.app',
  messagingSenderId: 'REPLACE_WITH_SENDER_ID',
  appId: 'REPLACE_WITH_APP_ID'
};

export const FUNCTIONS_REGION = 'us-central1';

const SDK = 'https://www.gstatic.com/firebasejs/11.2.0';

let cached = null;

/**
 * Loads the Firebase modular SDK from the CDN on demand.
 *
 * Deliberately lazy. The class pages are marketing pages first, and
 * nobody should pay ~100kb of SDK download before the hero renders.
 * Nothing here runs until the form is actually interacted with or
 * the page asks for live class state.
 */
export async function firebase() {
  if (cached) return cached;

  const [{ initializeApp, getApps }, fns] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-functions.js`)
  ]);

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const functions = fns.getFunctions(app, FUNCTIONS_REGION);

  // Point at the emulator when running locally so the whole flow
  // can be tested without touching production data.
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    try { fns.connectFunctionsEmulator(functions, 'localhost', 5001); } catch { /* already connected */ }
  }

  cached = { app, functions, httpsCallable: fns.httpsCallable };
  return cached;
}

/** Calls a Cloud Function and unwraps the result. */
export async function callFn(name, payload = {}) {
  const { functions, httpsCallable } = await firebase();
  const res = await httpsCallable(functions, name)(payload);
  return res.data;
}

/**
 * Normalises the errors a callable can throw into something worth
 * showing a person. Firebase prefixes messages with the error code,
 * which is noise to everyone except a developer.
 */
export function readableError(err) {
  const message = String(err?.message || '').replace(/^[A-Z_]+:\s*/, '').trim();
  if (err?.code === 'functions/unavailable' || /network|fetch/i.test(message)) {
    return 'We could not reach the server. Check your connection and try again.';
  }
  if (err?.code === 'functions/internal' || !message) {
    return 'Something went wrong on our end. Try again in a moment, or email the1percentnation@gmail.com.';
  }
  return message;
}

/** Loads Firebase Auth on demand. Only the admin console needs it. */
export async function firebaseAuth() {
  const { app } = await firebase();
  const mod = await import(`${SDK}/firebase-auth.js`);
  return { auth: mod.getAuth(app), ...mod };
}
