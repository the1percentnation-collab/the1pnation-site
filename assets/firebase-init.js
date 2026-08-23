/**
 * Firebase client bootstrap.
 *
 * The config below is the Firebase *web* config. It is public by
 * design and safe to commit: it identifies the project, it does not
 * authorise anything. All access control lives in firestore.rules and
 * in the admin claim checks inside the Cloud Functions.
 *
 * These are the same values the member portal already uses, taken
 * from its own public/js/firebase.js. Both the marketing site and the
 * portal run on Firebase project `the-1p-leadership`, which is what
 * makes an account created at class signup the portal's login too.
 *
 * If these ever go stale, deleting them is safe: Firebase Hosting
 * serves the project's live config at the reserved URL
 * /__/firebase/init.json on every domain it hosts, custom domains
 * included, and resolveConfig() falls back to that automatically.
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyCSZvsExv7O_yjE2UzJ4QQ7lsA4R9zG4_A',
  authDomain: 'the-1p-leadership.firebaseapp.com',
  projectId: 'the-1p-leadership',
  storageBucket: 'the-1p-leadership.firebasestorage.app',
  messagingSenderId: '14602661529',
  appId: '1:14602661529:web:8031e6f7755f757cb45208',
  measurementId: 'G-RBH536HRZE'
};

export const FUNCTIONS_REGION = 'us-central1';

const SDK = 'https://www.gstatic.com/firebasejs/11.2.0';

let cached = null;
let configCache = null;

/**
 * Works out which Firebase project this page belongs to.
 *
 * Prefers the committed config when someone has filled it in, then
 * falls back to the copy Firebase Hosting serves itself. Doing it in
 * that order means a deliberate override always wins, while the normal
 * case needs no configuration at all.
 */
export async function resolveConfig() {
  if (configCache) return configCache;

  if (firebaseConfig.apiKey && firebaseConfig.projectId) {
    configCache = firebaseConfig;
    return configCache;
  }

  try {
    const res = await fetch('/__/firebase/init.json', { cache: 'force-cache' });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg?.apiKey && cfg?.projectId) {
        configCache = cfg;
        return configCache;
      }
    }
  } catch {
    // Not served from Firebase Hosting, or offline. Fall through to
    // the error below so the page can show its own fallback rather
    // than failing silently.
  }

  throw new Error(
    'Firebase is not configured for this page. Register a web app in the Firebase console, ' +
    'or fill in firebaseConfig in assets/firebase-init.js.'
  );
}


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

  const app = getApps().length ? getApps()[0] : initializeApp(await resolveConfig());
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
