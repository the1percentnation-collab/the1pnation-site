/* ============================================================
   RULES TESTS — THE REWRITE METHOD
   ------------------------------------------------------------
   Proves the three claims that matter:
     1. An unentitled user cannot read any video provider ID.
     2. An entitled member cannot read a locked week's provider ID
        (the callable refuses; coursesPrivate is closed to all).
     3. A member cannot write their own entitlement, and cannot
        restore it after a refund.

   Run:
     firebase emulators:exec --only firestore "node --test backend/tests"
============================================================ */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'rewrite-rules-test',
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8080
    }
  });

  // Seed as admin, bypassing rules.
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'courses/rewrite-method'), { slug: 'rewrite-method', status: 'draft' });
    await setDoc(doc(db, 'courses/rewrite-method/modules/week-1'), { order: 1, slug: 'week-1', title: 'Find the Sentence' });
    await setDoc(doc(db, 'coursesPrivate/rewrite-method/modules/week-1'), {
      videos: [{ id: 'v1-1', providerId: 'SECRET_VIMEO_ID' }]
    });
    await setDoc(doc(db, 'users/buyer/enrollments/rewrite-method'), {
      courseId: 'rewrite-method', status: 'active', checkins: {}
    });
    await setDoc(doc(db, 'users/refunded/enrollments/rewrite-method'), {
      courseId: 'rewrite-method', status: 'revoked', checkins: {}
    });
  });
});

after(async () => { await env.cleanup(); });

test('course metadata is publicly readable', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, 'courses/rewrite-method/modules/week-1')));
});

test('an unentitled visitor cannot read any provider ID', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'coursesPrivate/rewrite-method/modules/week-1')));
});

test('an entitled member cannot read provider IDs directly either', async () => {
  const db = env.authenticatedContext('buyer').firestore();
  await assertFails(getDoc(doc(db, 'coursesPrivate/rewrite-method/modules/week-1')));
});

test('a member reads only their own enrollment', async () => {
  const own = env.authenticatedContext('buyer').firestore();
  await assertSucceeds(getDoc(doc(own, 'users/buyer/enrollments/rewrite-method')));

  const other = env.authenticatedContext('stranger').firestore();
  await assertFails(getDoc(doc(other, 'users/buyer/enrollments/rewrite-method')));
});

test('a member cannot create their own entitlement', async () => {
  const db = env.authenticatedContext('freeloader').firestore();
  await assertFails(setDoc(doc(db, 'users/freeloader/enrollments/rewrite-method'), {
    courseId: 'rewrite-method', status: 'active'
  }));
});

test('a member may set the drip anchor and submit check-ins', async () => {
  const db = env.authenticatedContext('buyer').firestore();
  await assertSucceeds(updateDoc(doc(db, 'users/buyer/enrollments/rewrite-method'), {
    enrolledAt: new Date(),
    'checkins.week-0': { submittedAt: new Date(), data: { commitmentLine: 'I am picking up the pen.' } }
  }));
});

test('a member cannot promote themselves to active after a refund', async () => {
  const db = env.authenticatedContext('refunded').firestore();
  await assertFails(updateDoc(doc(db, 'users/refunded/enrollments/rewrite-method'), { status: 'active' }));
});

test('a member cannot rewrite server-owned purchase fields', async () => {
  const db = env.authenticatedContext('buyer').firestore();
  await assertFails(updateDoc(doc(db, 'users/buyer/enrollments/rewrite-method'), { bundle: true }));
});
