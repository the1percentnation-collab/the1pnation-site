/* ============================================================
   SEED — THE REWRITE METHOD
   ------------------------------------------------------------
   Writes the course document, all eight module documents, and the
   matching private video documents, so the full structure exists in
   the emulator and in staging before any video is uploaded.

   Public module docs carry titles, summaries, worksheet paths and
   check-in field definitions. Provider IDs live only in
   coursesPrivate/, which no client can read.

   Usage:
     FIRESTORE_EMULATOR_HOST=localhost:8080 node seed-rewrite-method.mjs
     GOOGLE_APPLICATION_CREDENTIALS=./sa.json node seed-rewrite-method.mjs --project the-1p-leadership

   Course ships with status "draft" so nothing is publicly listed
   until the content upload is finished.
============================================================ */

import { createRequire } from 'node:module';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const { REWRITE_COURSE, REWRITE_MODULES } = require('../../assets/rewrite-method.data.js');

const projectId =
  process.argv[process.argv.indexOf('--project') + 1] ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  'the-1p-leadership';

initializeApp(
  process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? { credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS), projectId }
    : { credential: applicationDefault(), projectId }
);

const db = getFirestore();
const courseId = REWRITE_COURSE.slug;

async function seed() {
  const now = FieldValue.serverTimestamp();

  await db.doc(`courses/${courseId}`).set(
    {
      slug: REWRITE_COURSE.slug,
      title: REWRITE_COURSE.title,
      subtitle: REWRITE_COURSE.subtitle,
      description: REWRITE_COURSE.description,
      priceIds: REWRITE_COURSE.priceIds,
      price: REWRITE_COURSE.price,
      status: REWRITE_COURSE.status,
      heroImage: 'courses/rewrite-method/hero.jpg',
      weekCount: REWRITE_COURSE.weekCount,
      bonusModuleId: REWRITE_COURSE.bonusModuleId,
      createdAt: now,
      updatedAt: now
    },
    { merge: true }
  );
  console.log(`seeded courses/${courseId}`);

  for (const mod of REWRITE_MODULES) {
    // Public module doc: everything except provider IDs.
    const publicVideos = mod.videos.map(v => ({
      id: v.id,
      title: v.title,
      provider: v.provider,
      plannedRuntime: v.plannedRuntime,
      durationSec: v.durationSec,
      order: v.order
    }));

    await db.doc(`courses/${courseId}/modules/${mod.slug}`).set(
      {
        order: mod.order,
        slug: mod.slug,
        title: mod.title,
        summary: mod.summary,
        unlockOffsetDays: mod.unlockOffsetDays,
        unlockRule: mod.unlockRule || null,
        videos: publicVideos,
        worksheet: mod.worksheet || null,
        checkin: mod.checkin || null,
        createdAt: now,
        updatedAt: now
      },
      { merge: true }
    );

    // Private counterpart: provider IDs, seeded null until upload.
    await db.doc(`coursesPrivate/${courseId}/modules/${mod.slug}`).set(
      {
        slug: mod.slug,
        order: mod.order,
        videos: mod.videos.map(v => ({
          id: v.id,
          title: v.title,
          provider: v.provider,
          providerId: v.providerId,
          plannedRuntime: v.plannedRuntime,
          order: v.order
        })),
        updatedAt: now
      },
      { merge: true }
    );

    console.log(`seeded module ${mod.slug} (${mod.videos.length} videos)`);
  }

  console.log('\nDone. Course status is "draft".');
  console.log('Add provider IDs by updating coursesPrivate/rewrite-method/modules/{slug}.');
  console.log('Publish by setting courses/rewrite-method.status = "published".');
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
