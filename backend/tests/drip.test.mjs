/* ============================================================
   DRIP TESTS — THE REWRITE METHOD
   ------------------------------------------------------------
   The unlock rule the course pages render from. Pure functions,
   no emulator needed:  node --test backend/tests/drip.test.mjs
============================================================ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { unlockState, progressCount, isEntitled, toDate } from '../../assets/rewrite-method.js';

const require = createRequire(import.meta.url);
const { REWRITE_MODULES } = require('../../assets/rewrite-method.data.js');

const DAY = 24 * 60 * 60 * 1000;
const mod = slug => REWRITE_MODULES.find(m => m.slug === slug);
const enrolledDaysAgo = (days, extra = {}) => ({
  status: 'active',
  enrolledAt: new Date(Date.now() - days * DAY),
  checkins: {},
  ...extra
});

test('week 0 opens immediately, weeks 1 to 6 do not', () => {
  const e = enrolledDaysAgo(0);
  assert.equal(unlockState(mod('week-0'), e).unlocked, true);
  for (const slug of ['week-1', 'week-2', 'week-3', 'week-4', 'week-5', 'week-6']) {
    assert.equal(unlockState(mod(slug), e).unlocked, false, `${slug} should still be locked`);
  }
});

test('each week opens exactly seven days after the one before it', () => {
  for (let n = 1; n <= 6; n++) {
    const slug = `week-${n}`;
    assert.equal(unlockState(mod(slug), enrolledDaysAgo(n * 7 - 1)).unlocked, false, `${slug} early`);
    assert.equal(unlockState(mod(slug), enrolledDaysAgo(n * 7)).unlocked, true, `${slug} on time`);
  }
});

test('a locked week still reports the date it opens', () => {
  const state = unlockState(mod('week-3'), enrolledDaysAgo(0));
  assert.equal(state.unlocked, false);
  assert.ok(state.unlockDate instanceof Date);
  assert.equal(Math.round((state.unlockDate - Date.now()) / DAY), 21);
});

test('before the anchor is set, only week 0 is open', () => {
  const e = { status: 'active', checkins: {} };
  assert.equal(unlockState(mod('week-0'), e).unlocked, true);
  assert.equal(unlockState(mod('week-1'), e).unlocked, false);
});

test('the bonus needs the week 6 check-in and an answer to the review ask', () => {
  const long = 90;
  const noCheckin = enrolledDaysAgo(long);
  assert.equal(unlockState(mod('relapse-protocol'), noCheckin).unlocked, false);

  const checkedIn = enrolledDaysAgo(long, { checkins: { 'week-6': { data: {} } } });
  assert.equal(unlockState(mod('relapse-protocol'), checkedIn).unlocked, false);

  // Opting out of the review still unlocks it. The ask is an ask, not a paywall.
  for (const choice of ['left_review', 'opted_out']) {
    const answered = enrolledDaysAgo(long, {
      checkins: { 'week-6': { data: {} } },
      reviewChoice: choice
    });
    assert.equal(unlockState(mod('relapse-protocol'), answered).unlocked, true, choice);
  }
});

test('time alone never unlocks the bonus', () => {
  assert.equal(unlockState(mod('relapse-protocol'), enrolledDaysAgo(365)).unlocked, false);
});

test('progress counts submitted check-ins', () => {
  assert.equal(progressCount(enrolledDaysAgo(0)), 0);
  assert.equal(progressCount(enrolledDaysAgo(0, { checkins: { 'week-0': {}, 'week-1': {} } })), 2);
});

test('a refunded enrollment is not entitled', () => {
  assert.equal(isEntitled({ status: 'active' }), true);
  assert.equal(isEntitled({ status: 'revoked' }), false);
  assert.equal(isEntitled(null), false);
});

test('firestore timestamps and plain dates both resolve', () => {
  const d = new Date('2026-03-01T00:00:00Z');
  assert.equal(toDate({ toDate: () => d }).getTime(), d.getTime());
  assert.equal(toDate({ seconds: d.getTime() / 1000 }).getTime(), d.getTime());
  assert.equal(toDate(null), null);
});
