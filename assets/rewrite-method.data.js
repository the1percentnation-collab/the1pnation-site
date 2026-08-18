/* ============================================================
   THE REWRITE METHOD — COURSE DATA
   ------------------------------------------------------------
   Single source of truth for course structure, used by:
     - rewrite-method.html          (sales page)
     - rewrite-method/course.html   (gated course home)
     - rewrite-method/module.html   (module page)
     - backend/scripts/seed-rewrite-method.mjs (Firestore seed)

   Video provider IDs are intentionally null here. Real IDs are
   NEVER shipped in this file — they are served per-request by the
   getModuleVideos callable after a server-side entitlement + drip
   check (see backend/README.md).
============================================================ */

const REWRITE_COURSE = {
  slug: 'rewrite-method',
  title: 'The Rewrite Method',
  subtitle: 'Six weeks to take back the pen.',
  description:
    "You've been living a story someone else wrote. The Rewrite Method is the six-week program that walks you through finding the sentence you were handed, putting it on trial, and writing the new line, with the system that keeps it true. Companion to the book I CAN'T by Anthony Brown Sr.",
  status: 'draft',
  weekCount: 7,
  bonusModuleId: 'relapse-protocol',
  price: { courseOnly: 197, bundle: 209 },
  priceIds: {
    courseOnly: 'REPLACE_WITH_STRIPE_PRICE_ID_COURSE',
    bundle: 'REPLACE_WITH_STRIPE_PRICE_ID_BUNDLE'
  },
  completerName: 'Rewriters'
};

const REWRITE_MODULES = [
  {
    order: 0,
    slug: 'week-0',
    title: 'Pick Up the Pen',
    unlockOffsetDays: 0,
    summary: 'Reading is not rewriting. Open the Manuscript and commit to the six weeks before anything else happens.',
    videos: [
      { id: 'v0-1', title: "Why Reading Alone Doesn't Rewrite Anything", provider: 'vimeo', providerId: null, plannedRuntime: '5-7m', durationSec: null, order: 1 },
      { id: 'v0-2', title: 'Open Your Manuscript', provider: 'vimeo', providerId: null, plannedRuntime: '5-7m', durationSec: null, order: 2 }
    ],
    worksheet: { label: 'The Manuscript (full workbook)', storagePath: 'courses/rewrite-method/worksheets/the-manuscript.pdf' },
    checkin: {
      prompt: 'Before the work starts, put your commitment in writing.',
      fields: [
        { key: 'commitmentLine', label: 'Your commitment, in your own words', type: 'textarea', required: true, note: 'Private to you.' }
      ]
    }
  },
  {
    order: 1,
    slug: 'week-1',
    title: 'Find the Sentence',
    unlockOffsetDays: 7,
    summary: 'Drag the belief into the light, shrink it down, and lock the one sentence you have been living by.',
    videos: [
      { id: 'v1-1', title: 'Drag It Into the Light', provider: 'vimeo', providerId: null, plannedRuntime: '8-10m', durationSec: null, order: 1 },
      { id: 'v1-2', title: 'The Shrink List', provider: 'vimeo', providerId: null, plannedRuntime: '7-9m', durationSec: null, order: 2 },
      { id: 'v1-3', title: 'Lock Your Sentence', provider: 'vimeo', providerId: null, plannedRuntime: '5-6m', durationSec: null, order: 3 }
    ],
    worksheet: { label: 'Week 1 Worksheet — Find the Sentence', storagePath: 'courses/rewrite-method/worksheets/week-1.pdf' },
    checkin: {
      prompt: 'Name the sentence you were handed.',
      fields: [
        { key: 'theSentence', label: 'Your sentence, in one line', type: 'text', required: true, maxlength: 200, note: 'Private to you.' }
      ]
    }
  },
  {
    order: 2,
    slug: 'week-2',
    title: 'Trace the Handwriting',
    unlockOffsetDays: 14,
    summary: 'See where the sentence came from and log every time it fires before you get a chance to think.',
    videos: [
      { id: 'v2-1', title: 'Why It Fires Before You Think', provider: 'vimeo', providerId: null, plannedRuntime: '6-8m', durationSec: null, order: 1 },
      { id: 'v2-2', title: 'The Two-Column Log, Demonstrated', provider: 'vimeo', providerId: null, plannedRuntime: '7-9m', durationSec: null, order: 2 }
    ],
    worksheet: { label: 'Week 2 Worksheet — Seven-Day Log', storagePath: null },
    checkin: {
      prompt: 'Report the week honestly. The number is data, not a grade.',
      fields: [
        { key: 'oldRoadCount', label: 'How many times did the old line fire this week?', type: 'number', required: true, min: 0 },
        { key: 'noticed', label: 'What did you notice?', type: 'textarea', required: false }
      ]
    }
  },
  {
    order: 3,
    slug: 'week-3',
    title: 'Challenge the Draft',
    unlockOffsetDays: 21,
    summary: 'Put the sentence on trial, meet your two minds, and learn to use the three-second window.',
    videos: [
      { id: 'v3-1', title: 'Put the Sentence on Trial', provider: 'vimeo', providerId: null, plannedRuntime: '7-9m', durationSec: null, order: 1 },
      { id: 'v3-2', title: 'Your Two Minds', provider: 'vimeo', providerId: null, plannedRuntime: '6-8m', durationSec: null, order: 2 },
      { id: 'v3-3', title: 'The Three-Second Window', provider: 'vimeo', providerId: null, plannedRuntime: '5-7m', durationSec: null, order: 3 }
    ],
    worksheet: { label: 'Week 3 Worksheet — To Me or For Me', storagePath: null },
    checkin: {
      prompt: 'Write the expectation that replaces the old one.',
      fields: [
        { key: 'newExpectation', label: 'Your new expectation line: I am ______', type: 'text', required: true, maxlength: 200 }
      ]
    }
  },
  {
    order: 4,
    slug: 'week-4',
    title: 'Write the New Line: The System',
    unlockOffsetDays: 28,
    summary: 'Understanding is not change. Shrink the move, anchor it to an hour you already live, and mark it.',
    videos: [
      { id: 'v4-1', title: 'Understanding Is Not Change', provider: 'vimeo', providerId: null, plannedRuntime: '7-9m', durationSec: null, order: 1 },
      { id: 'v4-2', title: 'Shrink It, Anchor It, Mark It', provider: 'vimeo', providerId: null, plannedRuntime: '9-11m', durationSec: null, order: 2 },
      { id: 'v4-3', title: 'Convert the Hours You Already Live', provider: 'vimeo', providerId: null, plannedRuntime: '6-8m', durationSec: null, order: 3 }
    ],
    worksheet: { label: 'Week 4 Worksheet — The One Move', storagePath: null },
    checkin: {
      prompt: 'Show the mark. Proof beats intention.',
      fields: [
        { key: 'markPhoto', label: 'A photo of your mark: the calendar, the tracker, the wall', type: 'file', required: true, accept: 'image/*', note: 'Uploaded privately to your own storage folder.' }
      ]
    }
  },
  {
    order: 5,
    slug: 'week-5',
    title: 'Write the New Line: Protect the Manuscript',
    unlockOffsetDays: 35,
    summary: 'Evict and replace, cast the daily vote, and plan for the moment the old author reaches for the pen.',
    videos: [
      { id: 'v5-1', title: 'Evict and Replace', provider: 'vimeo', providerId: null, plannedRuntime: '7-9m', durationSec: null, order: 1 },
      { id: 'v5-2', title: 'The Daily Vote', provider: 'vimeo', providerId: null, plannedRuntime: '5-7m', durationSec: null, order: 2 },
      { id: 'v5-3', title: 'The Old Author Will Try to Take the Pen Back', provider: 'vimeo', providerId: null, plannedRuntime: '6-8m', durationSec: null, order: 3 }
    ],
    worksheet: { label: 'Week 5 Worksheet — New Line + Comeback Plan', storagePath: null },
    checkin: {
      prompt: 'Lock the new line and the vote that proves it.',
      fields: [
        { key: 'newLine', label: 'Your new line', type: 'text', required: true, maxlength: 200 },
        { key: 'dailyVote', label: 'The daily vote you cast for it', type: 'text', required: true, maxlength: 200 }
      ]
    }
  },
  {
    order: 6,
    slug: 'week-6',
    title: 'Keep Writing',
    unlockOffsetDays: 42,
    summary: 'The five and the rooms, the inputs you carry with you, and why there is no final draft.',
    videos: [
      { id: 'v6-1', title: 'The Five and the Rooms', provider: 'vimeo', providerId: null, plannedRuntime: '7-9m', durationSec: null, order: 1 },
      { id: 'v6-2', title: 'Inputs and the Portable Environment', provider: 'vimeo', providerId: null, plannedRuntime: '5-7m', durationSec: null, order: 2 },
      { id: 'v6-3', title: 'There Is No Final Draft', provider: 'vimeo', providerId: null, plannedRuntime: '6-8m', durationSec: null, order: 3 }
    ],
    worksheet: { label: 'Week 6 Worksheet — Environment Audit', storagePath: null },
    checkin: {
      prompt: 'Last check-in. Then one ask.',
      fields: [
        { key: 'growersLine', label: 'Your line as a grower', type: 'text', required: true, maxlength: 200 },
        { key: 'milestone', label: 'What changed in six weeks?', type: 'textarea', required: false }
      ]
    }
  },
  {
    order: 99,
    slug: 'relapse-protocol',
    title: 'Bonus: The Relapse Protocol',
    unlockOffsetDays: null,
    unlockRule: 'week6CheckinAndReviewChoice',
    summary: 'What to do the day the old sentence comes back, because it will.',
    videos: [
      { id: 'vR-1', title: 'When the Old Sentence Comes Back', provider: 'vimeo', providerId: null, plannedRuntime: '8-10m', durationSec: null, order: 1 }
    ],
    worksheet: null,
    checkin: null
  }
];

/* The six moves, for the sales page and course home path visual. */
const REWRITE_MOVES = [
  'Find the Sentence',
  'Trace the Handwriting',
  'Challenge the Draft',
  'Write the New Line',
  'Protect the Manuscript',
  'Keep Writing'
];

const REWRITE_COPY = {
  salesHero:
    "You've been living a story someone else wrote. The Rewrite Method is the six-week program that walks you through finding the sentence you were handed, putting it on trial, and writing the new line, with the system that keeps it true. Companion to the book I CAN'T by Anthony Brown Sr.",
  courseWelcome:
    'This is where the reading stops and the writing starts. One week at a time. Never miss twice.',
  lockedTooltip:
    'Unlocks {date}. The rewrite happens at the speed of reps, not the speed of reading.',
  completion:
    "You're a Rewriter now. The work doesn't end on the last page. It's just getting started.",
  reviewAsk:
    'If the book earned it, an honest Amazon review is the highest-leverage two minutes you can give another reader standing where you stood.'
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { REWRITE_COURSE, REWRITE_MODULES, REWRITE_MOVES, REWRITE_COPY };
}

if (typeof window !== 'undefined') {
  window.REWRITE_COURSE = REWRITE_COURSE;
  window.REWRITE_MODULES = REWRITE_MODULES;
  window.REWRITE_MOVES = REWRITE_MOVES;
  window.REWRITE_COPY = REWRITE_COPY;
}
