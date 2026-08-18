/* ============================================================
   THE REWRITE METHOD — PORTAL RUNTIME
   ------------------------------------------------------------
   Auth, entitlement, drip computation, check-in writes and the
   gated video fetch. Imported as an ES module by the course pages.

   Security note: everything in this file is convenience for the UI.
   The real boundary lives in Firestore/Storage rules and in the
   getModuleVideos callable, which re-checks entitlement and the
   unlock date server side before releasing any provider ID.
============================================================ */

import { firebaseConfig, isConfigured, PORTAL_LOGIN_URL, FUNCTIONS_REGION } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const COURSE_ID = 'rewrite-method';
const DAY_MS = 24 * 60 * 60 * 1000;

export { PORTAL_LOGIN_URL, isConfigured, COURSE_ID };

let ctx = null;

/* Lazy-load the SDK only when the page is actually configured. */
export async function initRewrite() {
  if (!isConfigured) return null;
  if (ctx) return ctx;

  const [{ initializeApp }, authMod, storeMod, storageMod, fnMod] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
    import(`${SDK}/firebase-storage.js`),
    import(`${SDK}/firebase-functions.js`)
  ]);

  const app = initializeApp(firebaseConfig);
  ctx = {
    app,
    auth: authMod.getAuth(app),
    db: storeMod.getFirestore(app),
    storage: storageMod.getStorage(app),
    functions: fnMod.getFunctions(app, FUNCTIONS_REGION),
    authMod, storeMod, storageMod, fnMod
  };
  return ctx;
}

export async function onUser(callback) {
  const c = await initRewrite();
  if (!c) { callback(null); return () => {}; }
  return c.authMod.onAuthStateChanged(c.auth, callback);
}

/* ─── ENROLLMENT ────────────────────────────────────────────
   The client never creates its own entitlement. The enrollment
   doc is written by the Stripe webhook (Admin SDK). The one field
   the client may set is enrolledAt, and only when it is unset.
─────────────────────────────────────────────────────────── */
export async function loadEnrollment(uid) {
  const c = await initRewrite();
  if (!c) return null;
  const { doc, getDoc, updateDoc, serverTimestamp } = c.storeMod;
  const ref = doc(c.db, 'users', uid, 'enrollments', COURSE_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  let data = snap.data();
  if (data.status === 'revoked') return { ...data, revoked: true };

  // Drip anchor: set on first open, not at purchase.
  if (!data.enrolledAt) {
    await updateDoc(ref, { enrolledAt: serverTimestamp() });
    const fresh = await getDoc(ref);
    data = fresh.data();
  }
  return data;
}

export function isEntitled(enrollment) {
  return Boolean(enrollment) && enrollment.status !== 'revoked';
}

/* ─── DRIP ──────────────────────────────────────────────────
   Module order N unlocks at enrolledAt + N * 7 days.
   The bonus module unlocks once the week-6 check-in exists and a
   review choice has been answered, either way.
─────────────────────────────────────────────────────────── */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') return new Date(value);
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  return null;
}

export function unlockState(module, enrollment, now = new Date()) {
  const anchor = toDate(enrollment && enrollment.enrolledAt);

  if (module.order === 99) {
    const done = Boolean(enrollment && enrollment.checkins && enrollment.checkins['week-6']);
    const answered = Boolean(enrollment && enrollment.reviewChoice);
    return {
      unlocked: done && answered,
      unlockDate: null,
      reason: done && answered
        ? null
        : 'Unlocks when you finish the Week 6 check-in and answer the review ask.'
    };
  }

  if (!anchor) return { unlocked: module.order === 0, unlockDate: null, reason: null };

  const unlockDate = new Date(anchor.getTime() + module.order * 7 * DAY_MS);
  return { unlocked: now.getTime() >= unlockDate.getTime(), unlockDate, reason: null };
}

export function formatUnlockDate(date) {
  if (!date) return '';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export function daysUntil(date, now = new Date()) {
  if (!date) return null;
  return Math.max(0, Math.ceil((date.getTime() - now.getTime()) / DAY_MS));
}

export function progressCount(enrollment) {
  const checkins = (enrollment && enrollment.checkins) || {};
  return Object.keys(checkins).length;
}

/* ─── GATED VIDEO IDS ───────────────────────────────────────
   Provider IDs are not readable from the module docs. This
   callable checks entitlement and the unlock date server side
   and returns IDs only for a module the caller has actually
   reached. A null ID means the video is not uploaded yet.
─────────────────────────────────────────────────────────── */
export async function getModuleVideos(moduleSlug) {
  const c = await initRewrite();
  if (!c) return { videos: [], preview: true };
  try {
    const call = c.fnMod.httpsCallable(c.functions, 'getRewriteModuleVideos');
    const res = await call({ courseId: COURSE_ID, moduleSlug });
    return res.data;
  } catch (err) {
    console.warn('[rewrite] video fetch refused:', err && err.code);
    return { videos: [], error: (err && err.code) || 'unavailable' };
  }
}

/* ─── WORKSHEETS ────────────────────────────────────────────
   Storage rules restrict worksheet reads to entitled users.
─────────────────────────────────────────────────────────── */
export async function worksheetUrl(storagePath) {
  const c = await initRewrite();
  if (!c || !storagePath) return null;
  try {
    return await c.storageMod.getDownloadURL(c.storageMod.ref(c.storage, storagePath));
  } catch (err) {
    console.warn('[rewrite] worksheet unavailable:', err && err.code);
    return null;
  }
}

/* ─── CHECK-INS ─────────────────────────────────────────────
   Answers contain personal disclosures. They are written only
   under the member's own enrollment document, never anywhere
   shared or public.
─────────────────────────────────────────────────────────── */
export async function uploadCheckinFile(uid, moduleSlug, fieldKey, file) {
  const c = await initRewrite();
  if (!c) throw new Error('not-configured');
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const path = `users/${uid}/checkins/${COURSE_ID}/${moduleSlug}/${fieldKey}-${safe}`;
  const ref = c.storageMod.ref(c.storage, path);
  await c.storageMod.uploadBytes(ref, file);
  return path;
}

export async function submitCheckin(uid, moduleSlug, data) {
  const c = await initRewrite();
  if (!c) throw new Error('not-configured');
  const { doc, updateDoc, serverTimestamp } = c.storeMod;
  const ref = doc(c.db, 'users', uid, 'enrollments', COURSE_ID);

  const patch = {
    [`checkins.${moduleSlug}.submittedAt`]: serverTimestamp(),
    [`checkins.${moduleSlug}.data`]: data,
    updatedAt: serverTimestamp()
  };
  if (moduleSlug === 'week-6') {
    patch.isRewriter = true;
    patch.completedAt = serverTimestamp();
  }
  await updateDoc(ref, patch);
  await fireEmailEvent(`rewrite_checkin_${moduleSlug.replace('-', '_')}`, { moduleSlug });
  if (moduleSlug === 'week-6') await fireEmailEvent('rewrite_completed', {});
}

export async function setReviewChoice(choice) {
  const c = await initRewrite();
  if (!c) throw new Error('not-configured');
  const uid = c.auth.currentUser && c.auth.currentUser.uid;
  if (!uid) throw new Error('unauthenticated');
  const { doc, updateDoc, serverTimestamp } = c.storeMod;
  await updateDoc(doc(c.db, 'users', uid, 'enrollments', COURSE_ID), {
    reviewChoice: choice,
    updatedAt: serverTimestamp()
  });
}

/* Loops events go through a callable so the API key stays server side. */
export async function fireEmailEvent(eventName, payload) {
  const c = await initRewrite();
  if (!c) return;
  try {
    const call = c.fnMod.httpsCallable(c.functions, 'fireRewriteEmailEvent');
    await call({ eventName, payload: payload || {} });
  } catch (err) {
    // Email delivery must never block the member's progress.
    console.warn('[rewrite] email event skipped:', eventName, err && err.code);
  }
}

/* ─── CHECKOUT ──────────────────────────────────────────────
   Sales page buttons. Promo codes are Stripe promotion codes,
   applied by passing ?code= through to the session.
─────────────────────────────────────────────────────────── */
export async function startCheckout(plan, promoCode) {
  const c = await initRewrite();
  if (!c) { window.location.href = PORTAL_LOGIN_URL; return; }
  const call = c.fnMod.httpsCallable(c.functions, 'createRewriteCheckoutSession');
  const res = await call({
    plan,
    promoCode: promoCode || null,
    origin: window.location.origin
  });
  if (res.data && res.data.url) window.location.href = res.data.url;
}
