/**
 * Seeds "The Social Media Matrix" class record.
 *
 * Run once against the project:
 *   cd functions && npm run seed
 * Or against the emulator:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 npm run seed
 *
 * Safe to re-run. It merges, so edits Anthony has made in the
 * admin console are not clobbered, and live counters are preserved.
 */
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (!getApps().length) {
  // The credential key has to be absent against the emulator, not
  // present and undefined: firebase-admin validates the property if
  // it exists at all and rejects an undefined value.
  const options = { projectId: process.env.GCLOUD_PROJECT || 'the-1p-leadership' };
  if (!process.env.FIRESTORE_EMULATOR_HOST) options.credential = applicationDefault();
  initializeApp(options);
}
const db = getFirestore();
const SLUG = 'social-media-matrix';

/* ── The form. Three required fields and nothing more.
   Everything optional is marked optional so the form never feels
   like an interrogation. The two fields that earn their keep are
   `interests`, which pre-segments this list for every future
   launch, and `timing`, which lets Anthony schedule to real
   demand instead of guessing. ─────────────────────────────── */
const formFields = [
  // Deliberately empty.
  //
  // The signup form now asks for first name, last name, email, and
  // phone and nothing else, because those four are what the member
  // portal account needs and the shortest possible form converts best.
  // Those four are rendered by the page itself, not by this schema.
  //
  // Anything added here appears as an extra question on the form with
  // no deploy required. Two are worth considering once signups are
  // flowing, and both are a single tap:
  //
  //   timing    -> which session time the room can actually make, which
  //                is what tells Anthony when to schedule the class
  //   interests -> what else they would buy, written to GoHighLevel as
  //                tags, which is what makes this list pay off on every
  //                future launch
  //
  // Kept here as commented reference rather than deleted, so re-adding
  // one is a copy and paste into the admin console.
  //
  // { id: 'timing', type: 'radio', required: false,
  //   label: 'What time works best for you?',
  //   options: ['Weekday evenings', 'Weekday mornings', 'Weekend mornings', 'I am flexible'] },
  //
  // { id: 'interests', type: 'checkbox', required: false,
  //   label: 'What else would you want from The One Percent?',
  //   help: 'Pick anything that interests you. This is how I know what to build next.',
  //   options: ['Courses', 'Books', 'Masterminds', 'Webinars', 'One on one coaching',
  //             'Team and corporate training'] }
];

const publicDoc = {
  name: 'The Social Media Matrix',
  tagline: 'A four session mastermind for people who were handed the platforms and never handed the rules.',
  status: 'interest',

  painPoint:
    'You are not bad at social media. You were handed five platforms, no instructions, and told to be consistent.',

  outcomes: [
    'One platform chosen on purpose, and the reason you chose it',
    'Your positioning in one sentence that other people can repeat',
    'The four content types, and which one you have been overusing',
    'A weekly publishing rhythm built around your real calendar, not an ideal one',
    'Thirty days of content mapped before the final session ends',
    'A profile that turns a visitor into a follower and a follower into a conversation',
    'The three metrics that matter, and permission to ignore every other one',
    'A path from audience to offer that does not require becoming a salesperson'
  ],

  sessions: [
    {
      number: 1, title: 'The Audit',
      description:
        'Where you actually stand. How each platform decides what to show and to whom. Choosing the one platform that fits your work and your life, and letting the rest go without guilt.'
    },
    {
      number: 2, title: 'The Message',
      description:
        'Positioning, voice, and the one sentence everything else hangs on. If people cannot repeat what you do, they cannot refer you.'
    },
    {
      number: 3, title: 'The Engine',
      description:
        'The four content types, how to batch them, the weekly rhythm that survives a busy month, and exactly what to do on the days you have nothing to say.'
    },
    {
      number: 4, title: 'The Ask',
      description:
        'Turning attention into conversations and conversations into clients. How to make an offer without becoming the person nobody wants in their inbox.'
    }
  ],

  faq: [
    {
      q: 'I am starting from zero. Is this too advanced?',
      a: 'No. Starting from zero is the easiest place to build from, because there is nothing to undo. The first session sets everyone to the same baseline.'
    },
    {
      q: 'What if I cannot make a session live?',
      a: 'Every session is recorded and posted in the portal within twenty four hours. The hot seats and accountability group run between sessions, so you can still take part.'
    },
    {
      q: 'How is this different from a course?',
      a: 'A course is content you consume alone. This is a room. Live profile teardowns, hot seats, and a small peer group that keeps running between sessions. The cap on the room is what makes that possible.'
    },
    {
      q: 'Do I need to create an account to join the interest list?',
      a: 'No. The interest list takes your name, your email, and one question. Portal access is only set up once you enrol, and I will walk you through it then.'
    },
    {
      q: 'What is the refund policy?',
      a: 'If you attend the first session and it is not what you expected, tell me before the second session and I will refund you in full. After the second session the material is delivered and refunds are not available.'
    }
  ],

  // Anthony sets the real numbers in the admin console. These are
  // recommended starting points, not final.
  // One price, $297. foundingAmount is 0, so resolvePricing() treats
  // no discount as active and the page shows a single figure.
  //
  // To run a founding rate later, set foundingAmount to the lower
  // price in cents and foundingUntil to an ISO date. The server prices
  // against its own clock, so the deadline is real and a stale tab
  // cannot buy at the old rate after it passes.
  price: { amount: 29700, foundingAmount: 0, foundingUntil: null, currency: 'usd' },
  capacity: 30,
  seatsPaid: 0,
  interestCount: 0,
  enrollCloseAt: null,
  schedule: { sessions: [], timezone: 'America/New_York', joinUrl: '' },
  formFields,
  updatedAt: FieldValue.serverTimestamp()
};

const privateDoc = {
  ghlFormId: '2RRVTzt8PJABfOAPd84Z',

  // Where and how the member portal profile document is written.
  // The portal's real schema is not visible from this repo, so if it
  // expects different collection or field names, change them here
  // rather than in code.
  portal: {
    collection: 'users',
    fields: {
      firstName: 'firstName',
      lastName: 'lastName',
      email: 'email',
      phone: 'phone',
      displayName: 'displayName'
    }
  },

  // Access codes are the mechanism behind comping a seat without
  // ever using the word "free". A code at 100 percent enrols the
  // person directly and never touches Stripe.
  accessCodes: [
    { code: 'FOUNDING', percentOff: 100, maxRedemptions: 5, redemptions: 0, active: true, note: 'Full comp, invite only' },
    { code: 'INNERCIRCLE', percentOff: 50, maxRedemptions: 10, redemptions: 0, active: true, note: 'Half seat' }
  ],
  updatedAt: FieldValue.serverTimestamp()
};

const ref = db.collection('classes').doc(SLUG);
const existing = await ref.get();

/* Re-running this would overwrite copy, price, and capacity with the
   values in this file, throwing away anything edited in the admin
   console. So an existing class is left alone unless overwriting is
   asked for explicitly. */
if (existing.exists && process.env.FORCE !== '1') {
  const d = existing.data();
  console.log(`classes/${SLUG} already exists. Leaving it untouched.`);
  console.log(`  name          : ${d.name}`);
  console.log(`  status        : ${d.status}`);
  console.log(`  interestCount : ${d.interestCount ?? 0}`);
  console.log(`  seatsPaid     : ${d.seatsPaid ?? 0}`);
  console.log('\nTo overwrite the copy and pricing with this file, re-run with FORCE=1.');
  process.exit(0);
}

await ref.set(
  existing.exists
    ? { ...publicDoc, seatsPaid: existing.data().seatsPaid ?? 0, interestCount: existing.data().interestCount ?? 0 }
    : { ...publicDoc, createdAt: FieldValue.serverTimestamp() },
  { merge: true }
);
await ref.collection('private').doc('config').set(privateDoc, { merge: true });

const after = (await ref.get()).data();
console.log(`Seeded classes/${SLUG} ${existing.exists ? '(overwritten)' : '(created)'}`);
console.log(`  name     : ${after.name}`);
console.log(`  status    : ${after.status}`);
console.log(`  price     : ${after.price?.amount} founding ${after.price?.foundingAmount}`);
console.log(`  capacity  : ${after.capacity}`);
console.log('\nSet the real price, capacity, and session dates in /admin before announcing.');
process.exit(0);
