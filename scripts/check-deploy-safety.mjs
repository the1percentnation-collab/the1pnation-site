#!/usr/bin/env node
/**
 * Refuses to let a deploy run that could damage the member portal.
 *
 * The portal (repo the1percentnation-collab/the-1p-leadership) shares
 * this Firebase project. Two things in a project are single-source and
 * project-wide, and the portal owns both. A deploy from here once came
 * one confirmation away from deleting 53 of its Cloud Functions, and
 * would separately have replaced its 859-line Firestore ruleset with
 * this repo's 60-line one, locking every member out of their own data.
 *
 * Comments in a workflow file do not stop that happening again. This
 * does. It runs before any deploy step and exits non-zero on drift.
 */
import { readFileSync, existsSync } from 'node:fs';

const problems = [];
const ok = [];

/* ── 1. Firestore rules must not be deployable from here ────── */
const cfg = JSON.parse(readFileSync('firebase.json', 'utf8'));

if (cfg.firestore) {
  problems.push(
    'firebase.json declares a "firestore" config.\n' +
    '      There is ONE ruleset per Firebase project and the portal repo owns it.\n' +
    '      Deploying from here replaces all 859 of its lines and locks members out.\n' +
    '      Remove the "firestore" key. Rules for this site belong in\n' +
    '      firestore.rules.snippet, merged into the portal repo instead.'
  );
} else {
  ok.push('firebase.json declares no firestore config');
}

for (const f of ['firestore.rules', 'firestore.indexes.json']) {
  if (existsSync(f)) {
    problems.push(
      `${f} exists at the repo root.\n` +
      '      Its presence invites a deploy that would overwrite the portal\'s.\n' +
      '      Keep the merge snippet as firestore.rules.snippet only.'
    );
  }
}
if (!existsSync('firestore.rules') && !existsSync('firestore.indexes.json')) {
  ok.push('no deployable Firestore rules or indexes present');
}

/* ── 2. Functions must be scoped to their own codebase ──────── */
const codebase = cfg.functions?.[0]?.codebase;
if (codebase !== 'classes') {
  problems.push(
    `functions codebase is ${JSON.stringify(codebase)}, expected "classes".\n` +
    '      The portal deploys its 53 functions under codebase "default".\n' +
    '      Sharing that name makes a deploy from here treat every one of them\n' +
    '      as stale and try to delete it.'
  );
} else {
  ok.push('functions codebase is "classes", isolated from the portal');
}

/* ── 3. The workflows themselves must stay scoped ───────────── */
for (const wf of [
  '.github/workflows/firebase-hosting-merge.yml',
  '.github/workflows/firebase-hosting-pull-request.yml'
]) {
  if (!existsSync(wf)) continue;
  const text = readFileSync(wf, 'utf8');

  // Strip comments so guidance about --force does not trip the guard.
  const live = text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

  if (/--force\b/.test(live)) {
    problems.push(
      `${wf} passes --force to a deploy.\n` +
      '      --force accepts function deletions without asking. That is the single\n' +
      '      confirmation standing between a deploy here and the portal backend.'
    );
  }
  // `--only functions` unscoped, i.e. not followed by a colon.
  if (/--only\s+[^\s]*\bfunctions(?![:\w-])/.test(live)) {
    problems.push(
      `${wf} deploys "--only functions" without a codebase.\n` +
      '      Unscoped, that compares every function in the project against this\n' +
      '      source tree and proposes deleting the portal\'s.\n' +
      '      Use --only functions:classes.'
    );
  }
  if (/--only\s+[^\s]*\bfirestore\b/.test(live)) {
    problems.push(
      `${wf} deploys Firestore rules.\n` +
      '      The portal repo owns this project\'s ruleset. Remove the step.'
    );
  }
}
if (!problems.some((p) => p.includes('.github/workflows'))) {
  ok.push('workflows deploy only scoped targets, with no --force');
}

/* ── Report ─────────────────────────────────────────────────── */
if (problems.length) {
  console.error('\nDEPLOY BLOCKED. This configuration can damage the member portal.\n');
  problems.forEach((p, i) => console.error(`  ${i + 1}. ${p}\n`));
  console.error('  Background: SETUP.md, "One project, two repos".\n');
  process.exit(1);
}

console.log('Deploy safety checks passed:');
ok.forEach((o) => console.log(`  ok  ${o}`));
