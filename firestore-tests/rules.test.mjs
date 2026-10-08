import { readFileSync } from 'node:fs';
import { test, before, beforeEach, after } from 'node:test';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  setDoc, getDoc, updateDoc, deleteDoc, doc,
  getDocs, query, where, collection,
} from 'firebase/firestore';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rules',
    firestore: {
      rules: readFileSync('../firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(() => env.cleanup());

const KU = { sub: 'u1', email: 'a@st.kyoto-u.ac.jp', email_verified: true };
const KU2 = { sub: 'u2', email: 'd@st.kyoto-u.ac.jp', email_verified: true };
const KU_UNVERIFIED = { sub: 'u2', email: 'b@st.kyoto-u.ac.jp', email_verified: false };
const OUTSIDER = { sub: 'u3', email: 'c@gmail.com', email_verified: true };
// R5 regression pair. Both end in / contain the KU domain string and would slip
// past a pattern that is not start-anchored or that allows '@' in the local
// part; the anchored `^[^@]+@st[.]kyoto-u[.]ac[.]jp$` rejects both.
//   SPOOFER        — ends in the KU domain exactly, but carries an extra '@',
//                    so the local part is not a single mailbox name.
//   SPOOFER_SUFFIX — the KU domain is only a substring; the real domain is
//                    attacker.com.
const SPOOFER = { sub: 'u4', email: 'evil@evil.com@st.kyoto-u.ac.jp', email_verified: true };
const SPOOFER_SUFFIX = { sub: 'u5', email: 'a@st.kyoto-u.ac.jp.attacker.com', email_verified: true };
// M1: mail domains are case-insensitive, so an upper-cased KU address is the
// same mailbox and must be accepted.
const KU_UPPERCASE = { sub: 'u6', email: 'E@ST.KYOTO-U.AC.JP', email_verified: true };

const asKu = () => env.authenticatedContext('u1', KU).firestore();
const asKu2 = () => env.authenticatedContext('u2', KU2).firestore();
const asAnon = () => env.unauthenticatedContext().firestore();
const asOutsider = () => env.authenticatedContext('u3', OUTSIDER).firestore();
const asKuUnverified = () => env.authenticatedContext('u2', KU_UNVERIFIED).firestore();

// The full course shape the reader (CourseRepository._fromDoc) needs (C1).
const validCourse = (id, over = {}) => ({
  id,
  courseKey: '解析学|山田太郎',
  name: '解析学',
  faculty: '全学共通',
  lecturer: '山田 太郎',
  dayOfWeek: 'Mon',
  period: 3,
  category: '全学共通科目',
  university_id: 'kyoto_u',
  ...over,
});

// The exact document `MaterialRequest.toMap()` produces — the client marks a
// request solved by re-`set()`ing this whole map, not by a two-key update (I4).
const fullRequest = (over = {}) => ({
  id: 'req_full',
  university_id: 'kyoto_u',
  subjectId: 'c_1',
  subjectName: '線形代数',
  authorId: 'u1',
  authorName: '匿名京大生',
  category: 'past_exam',
  year: 2024,
  title: '線形代数の過去問がほしい',
  description: '2023年度のものを探しています',
  costSpent: 1,
  rewardPoints: 10,
  isFulfilled: false,
  fulfilledPostId: null,
  createdAt: '2026-09-01T00:00:00.000',
  ...over,
});

// The exact document `TextbookRequest.toMap()` produces — the responder path in
// `app_store.respondToTextbookRequest()` is likewise a full set() (I4).
const fullTextbookRequest = (over = {}) => ({
  id: 'tb_full',
  university_id: 'kyoto_u',
  requesterId: 'u1',
  requesterName: '匿名京大生',
  subjectId: 'c_1',
  subjectName: '線形代数',
  bookTitle: '線形代数入門',
  status: 'open',
  responderId: null,
  responderName: null,
  talkRoomId: null,
  createdAt: '2026-09-01T00:00:00.000',
  ...over,
});

// A full, valid `Review.toMap()` document. The enum fields carry the real
// `.value` strings the Dart model emits (rakutan/attendance/grading/pastExam/
// bringIn), so a fixture can never pass a shape the client could not produce.
// C1: `courseSlug` is `courseKey` with '/' -> '%2F' and '%' -> '%25' (the client
// runs this in `Review.slug`; rules cannot compute it, so it is stored). The
// create rule pins the doc id to `courseSlug + '_' + uid`, so a fixture that
// overrides `courseKey` gets a matching slug by default.
const slug = (s) => String(s).replace(/%/g, '%25').replace(/\//g, '%2F');
const reviewDoc = (over = {}) => ({
  id: 'ck_u1',
  courseKey: 'ck',
  courseSlug: slug(over.courseKey ?? 'ck'),
  courseName: '線形代数',
  university_id: 'kyoto_u',
  authorId: 'u1',
  authorName: '匿名京大生',
  rating: 3,
  rakutan: 'raku',
  attendance: 'light',
  grading: 'exam_report',
  pastExam: 'similar',
  bringIn: 'yes',
  comment: '',
  termTaken: '2025前期',
  gradeTaken: 'A',
  helpfulBy: [],
  createdAt: '2026-09-01T00:00:00.000',
  updatedAt: '2026-09-01T00:00:00.000',
  ...over,
});

// Seed baseline documents with rules bypassed so read/update tests exercise the
// rule under test rather than a missing-document condition.
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'courses/c_1'), { name: '線形代数', university_id: 'kyoto_u' });
    await setDoc(doc(db, 'meta/catalog'), { version: 3 });
    await setDoc(doc(db, 'users/u1'), { displayName: 'me', university_id: 'kyoto_u' });
    await setDoc(doc(db, 'users/u2'), { displayName: 'other', university_id: 'kyoto_u' });
    await setDoc(doc(db, 'user_timetables/u1'), { user_id: 'u1', university_id: 'kyoto_u', timetable: {} });
    await setDoc(doc(db, 'user_timetables/u2'), { user_id: 'u2', university_id: 'kyoto_u', timetable: {} });
    await setDoc(doc(db, 'posts/seed_u1'), {
      authorId: 'u1', university_id: 'kyoto_u', title: 't', reports: [], downloadCount: 0,
    });
    // Three reports from three DISTINCT accounts already stored -> eligible for
    // auto-moderation deletion. Distinct uids matter: the append-only carve-out
    // means this state can only be reached by three separate reporters (I7).
    await setDoc(doc(db, 'posts/reported_u1'), {
      authorId: 'u1', university_id: 'kyoto_u', title: 't',
      reports: ['ra', 'rb', 'rc'], downloadCount: 0,
    });
    // One existing report from another account: the fixture for "u2 appends the
    // second report" (I7).
    await setDoc(doc(db, 'posts/flagged_u1'), {
      authorId: 'u1', university_id: 'kyoto_u', title: 't',
      reports: ['ra'], downloadCount: 0,
    });
    // Download-counter fixtures: one with no reward claimed yet, one that has
    // already claimed the 5-download reward.
    await setDoc(doc(db, 'posts/dl_u1'), {
      authorId: 'u1', university_id: 'kyoto_u', title: 't', reports: [],
      downloadCount: 4, is5DownloadsRewarded: false, is10DownloadsRewarded: false,
    });
    await setDoc(doc(db, 'posts/dl_rewarded_u1'), {
      authorId: 'u1', university_id: 'kyoto_u', title: 't', reports: [],
      downloadCount: 7, is5DownloadsRewarded: true, is10DownloadsRewarded: false,
    });
    await setDoc(doc(db, 'requests/req_u1'), {
      authorId: 'u1', university_id: 'kyoto_u', title: 'r',
      isFulfilled: false, fulfilledPostId: null,
    });
    await setDoc(doc(db, 'requests/req_full'), fullRequest());
    await setDoc(doc(db, 'textbook_requests/tb_u1'), {
      requesterId: 'u1', university_id: 'kyoto_u', status: 'open',
    });
    await setDoc(doc(db, 'textbook_requests/tb_full'), fullTextbookRequest());
    await setDoc(doc(db, 'talk_rooms/room_1'), {
      lenderId: 'u1', borrowerId: 'u2', university_id: 'kyoto_u', messages: [],
    });
    // Append-only fixture (M6): a room that already carries two messages.
    await setDoc(doc(db, 'talk_rooms/room_chat'), {
      lenderId: 'u1', borrowerId: 'u2', university_id: 'kyoto_u',
      warningNotice: '',
      messages: [{ id: 'm1', text: 'hello' }, { id: 'm2', text: 'reply' }],
    });
    await setDoc(doc(db, 'transactions/tx_u1'), {
      userId: 'u1', university_id: 'kyoto_u', amount: 5, type: 'upload_reward',
    });
    await setDoc(doc(db, 'inquiries/i_1'), { userId: 'u1', university_id: 'kyoto_u', body: 'hi' });
    // u1's review of course `ck`; the document id encodes both (`<courseKey>_<authorId>`).
    await setDoc(doc(db, 'reviews/ck_u1'), reviewDoc());
    // The "already helped by u2" fixture: the append-only carve-out means this
    // state can only be reached by u2 itself, and u2 may not append again.
    await setDoc(doc(db, 'reviews/ck2_u1'), reviewDoc({
      id: 'ck2_u1', courseKey: 'ck2', helpfulBy: ['u2'],
    }));
    // The real `CourseStats.toMap()` shape: `reviewCount` / `ratingSum` are the
    // two scalar counters the rule shape-guards, and every merge write has to
    // leave the *merged* document satisfying that guard.
    await setDoc(doc(db, 'course_stats/ck'), {
      courseKey: 'ck', university_id: 'kyoto_u', reviewCount: 1, ratingSum: 3,
    });
    await setDoc(doc(db, 'secret_admin_stuff/s_1'), { university_id: 'kyoto_u' });
  });
});

// --- courses -----------------------------------------------------------------

test('anonymous cannot read courses', async () => {
  await assertFails(getDoc(doc(asAnon(), 'courses/c_1')));
});

test('a KU user can read courses', async () => {
  await assertSucceeds(getDoc(doc(asKu(), 'courses/c_1')));
});

test('verified KU user can create a valid course', async () => {
  await assertSucceeds(setDoc(doc(asKu(), 'courses/c_new'), validCourse('c_new')));
});

test('course create is rejected with an empty name', async () => {
  await assertFails(setDoc(doc(asKu(), 'courses/c_empty'), validCourse('c_empty', { name: '' })));
});

test('course create is rejected for another university', async () => {
  await assertFails(setDoc(doc(asKu(), 'courses/c_other'),
    validCourse('c_other', { university_id: 'osaka_u' })));
});

test('unverified user cannot create a course', async () => {
  await assertFails(setDoc(doc(asKuUnverified(), 'courses/c_unverified'),
    validCourse('c_unverified')));
});

// --- courses: the create shape must satisfy the reader (C1) ------------------
//
// CourseRepository._fromDoc is now defensive, but the rules are the only thing
// that keeps a *new* doc from being written in a shape the catalog cannot use.

test('course create is rejected when `id` is missing (C1)', async () => {
  const data = validCourse('c_noid');
  delete data.id;
  await assertFails(setDoc(doc(asKu(), 'courses/c_noid'), data));
});

test('course create is rejected when `id` does not match the document id (C1)', async () => {
  await assertFails(setDoc(doc(asKu(), 'courses/c_mismatch'), validCourse('c_something_else')));
});

test('course create is rejected for an out-of-range period (C1)', async () => {
  await assertFails(setDoc(doc(asKu(), 'courses/c_p0'), validCourse('c_p0', { period: 0 })));
  await assertFails(setDoc(doc(asKu(), 'courses/c_p6'), validCourse('c_p6', { period: 6 })));
});

test('course create is rejected when `period` is not an int (C1)', async () => {
  await assertFails(setDoc(doc(asKu(), 'courses/c_pstr'), validCourse('c_pstr', { period: '2' })));
  await assertFails(setDoc(doc(asKu(), 'courses/c_pnum'), validCourse('c_pnum', { period: 2.5 })));
});

test('course create is rejected for a weekend dayOfWeek (C1)', async () => {
  await assertFails(setDoc(doc(asKu(), 'courses/c_sat'), validCourse('c_sat', { dayOfWeek: 'Sat' })));
});

test('course create is rejected when `courseKey` is missing (C1)', async () => {
  const data = validCourse('c_nokey');
  delete data.courseKey;
  await assertFails(setDoc(doc(asKu(), 'courses/c_nokey'), data));
});

test('course create is rejected for a non-string `lecturer` (C1)', async () => {
  await assertFails(setDoc(doc(asKu(), 'courses/c_lec'), validCourse('c_lec', { lecturer: 123 })));
});

test('course create is rejected for a non-string `faculty` (C1)', async () => {
  await assertFails(setDoc(doc(asKu(), 'courses/c_fac'), validCourse('c_fac', { faculty: [] })));
});

// --- reads require a KU-domain address (I3) ----------------------------------
//
// Anyone can mint a Firebase account through the Auth REST API; before this the
// only @st.kyoto-u.ac.jp check lived in the Flutter client, so such an account
// could read every collection.

const KU_READABLE = [
  ['courses', 'courses/c_1'],
  ['posts', 'posts/seed_u1'],
  ['requests', 'requests/req_u1'],
  ['textbook_requests', 'textbook_requests/tb_u1'],
  ['talk_rooms', 'talk_rooms/room_1'],
  ['users', 'users/u1'],
  ['meta', 'meta/catalog'],
];

for (const [label, path] of KU_READABLE) {
  test(`${label}: an outsider Firebase account cannot read (I3)`, async () => {
    await assertFails(getDoc(doc(asOutsider(), path)));
  });

  test(`${label}: an unverified KU address can still read (I3)`, async () => {
    await assertSucceeds(getDoc(doc(asKuUnverified(), path)));
  });
}

test('an outsider cannot run the university-scoped stream queries either (I3)', async () => {
  for (const name of ['posts', 'requests', 'textbook_requests', 'talk_rooms', 'courses']) {
    await assertFails(getDocs(query(
      collection(asOutsider(), name),
      where('university_id', '==', 'kyoto_u'),
    )));
  }
});

test('catalog metadata is read-only, even for a verified KU user', async () => {
  await assertSucceeds(getDoc(doc(asKu(), 'meta/catalog')));
  await assertFails(setDoc(doc(asKu(), 'meta/catalog'), { version: 99 }));
  await assertFails(updateDoc(doc(asKu(), 'meta/catalog'), { version: 99 }));
});

test('nobody can update or delete a course', async () => {
  const db = asKu();
  await assertFails(updateDoc(doc(db, 'courses/c_1'), { name: 'hijacked' }));
  await assertFails(deleteDoc(doc(db, 'courses/c_1')));
});

// --- users -------------------------------------------------------------------

test('user can write only their own profile', async () => {
  const mine = asKu();
  await assertSucceeds(setDoc(doc(mine, 'users/u1'), { displayName: 'me', university_id: 'kyoto_u' }));
  await assertFails(setDoc(doc(mine, 'users/u2'), { displayName: 'hax' }));
});

test('signed-in user can read another profile but anonymous cannot', async () => {
  await assertSucceeds(getDoc(doc(asKu(), 'users/u2')));
  await assertFails(getDoc(doc(asAnon(), 'users/u1')));
});

test('nobody can delete a profile, not even their own', async () => {
  await assertFails(deleteDoc(doc(asKu(), 'users/u1')));
});

// --- user_timetables ---------------------------------------------------------

test('timetable is readable and writable only by its owner', async () => {
  const mine = asKu();
  await assertSucceeds(getDoc(doc(mine, 'user_timetables/u1')));
  await assertSucceeds(setDoc(doc(mine, 'user_timetables/u1'), {
    user_id: 'u1', university_id: 'kyoto_u', timetable: { '1-1': 'c_1' },
  }));
  await assertFails(getDoc(doc(mine, 'user_timetables/u2')));
  await assertFails(setDoc(doc(mine, 'user_timetables/u2'), { timetable: {} }));
});

test('anonymous cannot touch timetables', async () => {
  const anon = asAnon();
  await assertFails(getDoc(doc(anon, 'user_timetables/u1')));
  await assertFails(setDoc(doc(anon, 'user_timetables/u1'), { timetable: {} }));
});

// --- posts -------------------------------------------------------------------

test('anonymous cannot read posts', async () => {
  await assertFails(getDoc(doc(asAnon(), 'posts/seed_u1')));
});

test('unverified user cannot create a post', async () => {
  const db = env.authenticatedContext('u2', KU_UNVERIFIED).firestore();
  await assertFails(setDoc(doc(db, 'posts/p2'), { authorId: 'u2', university_id: 'kyoto_u' }));
});

test('non-KU email cannot create a post even if verified', async () => {
  const db = env.authenticatedContext('u3', OUTSIDER).firestore();
  await assertFails(setDoc(doc(db, 'posts/p3'), { authorId: 'u3', university_id: 'kyoto_u' }));
});

test('address with an extra @ before the KU domain cannot create a post (R5 anchoring)', async () => {
  const db = env.authenticatedContext('u4', SPOOFER).firestore();
  await assertFails(setDoc(doc(db, 'posts/p_spoof'), { authorId: 'u4', university_id: 'kyoto_u' }));
});

test('address whose real domain only ends with the KU domain cannot create a post (R5 anchoring)', async () => {
  const db = env.authenticatedContext('u5', SPOOFER_SUFFIX).firestore();
  await assertFails(setDoc(doc(db, 'posts/p_spoof2'), { authorId: 'u5', university_id: 'kyoto_u' }));
});

test('cannot create a post attributed to someone else', async () => {
  await assertFails(setDoc(doc(asKu(), 'posts/p4'), { authorId: 'u2', university_id: 'kyoto_u' }));
});

// --- posts: the reports flag is append-only, one per account (I7) ------------
//
// The carve-out that lets a non-author write `reports` used to accept any value
// for the field, so a single verified account could write three reports in one
// update and then satisfy the >= 3 auto-delete rule by itself.

test('a non-author cannot write several reports at once (I7)', async () => {
  await assertFails(updateDoc(doc(asKu2(), 'posts/seed_u1'), { reports: ['a', 'b', 'c'] }));
  await assertFails(updateDoc(doc(asKu2(), 'posts/flagged_u1'), { reports: ['ra', 'u2', 'x'] }));
});

test('a non-author cannot append a report that is not their own uid (I7)', async () => {
  await assertFails(updateDoc(doc(asKu2(), 'posts/seed_u1'), { reports: ['someone_else'] }));
  await assertFails(updateDoc(doc(asKu2(), 'posts/flagged_u1'), { reports: ['ra', 'rb'] }));
});

test('a non-author cannot drop or replace existing reports (I7)', async () => {
  const db = asKu2();
  // Shrinking the array.
  await assertFails(updateDoc(doc(db, 'posts/flagged_u1'), { reports: [] }));
  // Same size, prior report swapped out for the caller's own uid.
  await assertFails(updateDoc(doc(db, 'posts/flagged_u1'), { reports: ['u2'] }));
});

test('an author cannot rewrite a post out of its stream or reassign it (M5)', async () => {
  const db = asKu();
  await assertFails(updateDoc(doc(db, 'posts/seed_u1'), { authorId: 'u2' }));
  await assertFails(updateDoc(doc(db, 'posts/seed_u1'), { university_id: 'osaka_u' }));
});

test('only a verified KU user may flag a post (I4)', async () => {
  const unverified = env.authenticatedContext('u2', KU_UNVERIFIED).firestore();
  await assertFails(updateDoc(doc(unverified, 'posts/seed_u1'), { reports: ['u2'] }));
  const outsider = env.authenticatedContext('u3', OUTSIDER).firestore();
  await assertFails(updateDoc(doc(outsider, 'posts/seed_u1'), { reports: ['u3'] }));
});

test('a non-author cannot delete a post below the report threshold (I2)', async () => {
  await assertFails(deleteDoc(doc(asKu2(), 'posts/seed_u1')));
  const outsider = env.authenticatedContext('u3', OUTSIDER).firestore();
  await assertFails(deleteDoc(doc(outsider, 'posts/reported_u1')));
});

test('a downloader cannot jump downloadCount (I5)', async () => {
  const db = asKu2();
  await assertFails(updateDoc(doc(db, 'posts/dl_u1'), { downloadCount: 14 }));
  await assertFails(updateDoc(doc(db, 'posts/dl_u1'), { downloadCount: 3 }));
});

test('a downloader cannot un-flip a reward flag (I5)', async () => {
  await assertFails(updateDoc(doc(asKu2(), 'posts/dl_rewarded_u1'), {
    downloadCount: 8, is5DownloadsRewarded: false,
  }));
});

test('the download-counter carve-out does not smuggle other fields (I5)', async () => {
  await assertFails(updateDoc(doc(asKu2(), 'posts/dl_u1'), {
    downloadCount: 5, title: 'vandalised',
  }));
});

// --- requests ----------------------------------------------------------------

// --- requests: the *real* fulfilment write is a full-document set (I4) -------
//
// `app_store.addPost()` marks a request solved through
// `_firestore.createMaterialRequest(requests[i].copyWith(...))`, which is a
// `set()` of the entire MaterialRequest.toMap(), not a two-key `update()`. The
// `hasOnly` carve-out is evaluated on `diff().affectedKeys()`, so a full write
// whose other fields are byte-identical is still allowed — these tests pin that
// down against the exact document shape the client sends.

test('a full-document fulfilment write that also edits the title is rejected (I4)', async () => {
  await assertFails(setDoc(doc(asKu2(), 'requests/req_full'),
    fullRequest({ isFulfilled: true, fulfilledPostId: 'post_123', title: 'vandalised' })));
});

test('an outsider cannot land the full-document fulfilment write (I4)', async () => {
  await assertFails(setDoc(doc(asOutsider(), 'requests/req_full'),
    fullRequest({ isFulfilled: true, fulfilledPostId: 'post_123' })));
});

test('unverified user cannot create a request', async () => {
  const db = env.authenticatedContext('u2', KU_UNVERIFIED).firestore();
  await assertFails(setDoc(doc(db, 'requests/req_unverified'), {
    authorId: 'u2', university_id: 'kyoto_u',
  }));
});

// --- textbook_requests -------------------------------------------------------

test('textbook request must be created by its own requester', async () => {
  const mine = asKu();
  await assertSucceeds(setDoc(doc(mine, 'textbook_requests/tb_new'), {
    requesterId: 'u1', university_id: 'kyoto_u', status: 'open',
  }));
  await assertFails(setDoc(doc(mine, 'textbook_requests/tb_bad'), {
    requesterId: 'u2', university_id: 'kyoto_u',
  }));
});

test('another verified KU user can flip a textbook request status, outsiders cannot', async () => {
  await assertSucceeds(updateDoc(doc(asKu2(), 'textbook_requests/tb_u1'), { status: 'matched' }));
  const outsider = env.authenticatedContext('u3', OUTSIDER).firestore();
  await assertFails(updateDoc(doc(outsider, 'textbook_requests/tb_u1'), { status: 'matched' }));
});

// `app_store.respondToTextbookRequest()` re-sets the whole TextbookRequest map
// with status/responderId/responderName/talkRoomId filled in (I4).
test('a responder may land the full-document textbook response write (I4)', async () => {
  await assertSucceeds(setDoc(doc(asKu2(), 'textbook_requests/tb_full'), fullTextbookRequest({
    status: 'matched', responderId: 'u2', responderName: '貸主', talkRoomId: 'room_9',
  })));
});

test('an outsider cannot land the full-document textbook response write (I4)', async () => {
  await assertFails(setDoc(doc(asOutsider(), 'textbook_requests/tb_full'), fullTextbookRequest({
    status: 'matched', responderId: 'u3', talkRoomId: 'room_9',
  })));
});

test('an unverified KU user cannot land the textbook response write (I4)', async () => {
  await assertFails(setDoc(doc(asKuUnverified(), 'textbook_requests/tb_full'),
    fullTextbookRequest({ status: 'matched', responderId: 'u2' })));
});

test('textbook requests cannot be deleted', async () => {
  await assertFails(deleteDoc(doc(asKu(), 'textbook_requests/tb_u1')));
});

// --- talk_rooms --------------------------------------------------------------

test('talk room can only be created by a participant', async () => {
  await assertSucceeds(setDoc(doc(asKu(), 'talk_rooms/room_new'), {
    lenderId: 'u1', borrowerId: 'u2', university_id: 'kyoto_u', messages: [],
  }));
  await assertFails(setDoc(doc(asKu(), 'talk_rooms/room_bad'), {
    lenderId: 'u2', borrowerId: 'u3', university_id: 'kyoto_u', messages: [],
  }));
});

test('only participants can post messages into a talk room', async () => {
  await assertSucceeds(updateDoc(doc(asKu(), 'talk_rooms/room_1'), { messages: [{ text: 'hi' }] }));
  // The log is append-only, so u2 must carry u1's message forward (M6).
  await assertSucceeds(updateDoc(doc(asKu2(), 'talk_rooms/room_1'), {
    messages: [{ text: 'hi' }, { text: 'yo' }],
  }));
  await assertFails(updateDoc(doc(asOutsider(), 'talk_rooms/room_1'), { messages: [{ text: 'spy' }] }));
});

// --- talk_rooms: the message log is append-only (M6) --------------------------
//
// Either participant could previously replace `messages` wholesale and delete
// the other party's side of the conversation.

test('a participant may append to the message log (M6)', async () => {
  await assertSucceeds(updateDoc(doc(asKu(), 'talk_rooms/room_chat'), {
    messages: [
      { id: 'm1', text: 'hello' }, { id: 'm2', text: 'reply' }, { id: 'm3', text: 'and more' },
    ],
  }));
});

test('a participant cannot clear or shorten the message log (M6)', async () => {
  const db = asKu2();
  await assertFails(updateDoc(doc(db, 'talk_rooms/room_chat'), { messages: [] }));
  await assertFails(updateDoc(doc(db, 'talk_rooms/room_chat'), {
    messages: [{ id: 'm1', text: 'hello' }],
  }));
});

test('a participant cannot rewrite an existing message (M6)', async () => {
  await assertFails(updateDoc(doc(asKu(), 'talk_rooms/room_chat'), {
    messages: [{ id: 'm1', text: 'tampered' }, { id: 'm2', text: 'reply' }],
  }));
});

test('an unrelated field may still be updated while the log is preserved (M6)', async () => {
  await assertSucceeds(updateDoc(doc(asKu(), 'talk_rooms/room_chat'), { warningNotice: 'x' }));
});

test('talk rooms cannot be deleted', async () => {
  await assertFails(deleteDoc(doc(asKu(), 'talk_rooms/room_1')));
});

// --- transactions ------------------------------------------------------------

test('transactions are readable only by their owner', async () => {
  await assertSucceeds(getDoc(doc(asKu(), 'transactions/tx_u1')));
  await assertFails(getDoc(doc(asKu2(), 'transactions/tx_u1')));
  await assertFails(getDoc(doc(asAnon(), 'transactions/tx_u1')));
});

test('verified KU user can create a transaction; unverified cannot', async () => {
  await assertSucceeds(setDoc(doc(asKu(), 'transactions/tx_new'), {
    userId: 'u1', university_id: 'kyoto_u', amount: 1, type: 'upload_reward',
  }));
  const db = env.authenticatedContext('u2', KU_UNVERIFIED).firestore();
  await assertFails(setDoc(doc(db, 'transactions/tx_unverified'), {
    userId: 'u2', university_id: 'kyoto_u', amount: 1,
  }));
});

test('transactions are append-only: no updates or deletes', async () => {
  const db = asKu();
  await assertFails(updateDoc(doc(db, 'transactions/tx_u1'), { amount: 9999 }));
  await assertFails(deleteDoc(doc(db, 'transactions/tx_u1')));
});

// --- inquiries ---------------------------------------------------------------

test('inquiries are write-only for signed-in users and readable by nobody', async () => {
  await assertSucceeds(setDoc(doc(asKu(), 'inquiries/i_new'), {
    userId: 'u1', university_id: 'kyoto_u', body: 'help',
  }));
  await assertFails(getDoc(doc(asKu(), 'inquiries/i_1')));
  await assertFails(setDoc(doc(asAnon(), 'inquiries/i_anon'), { body: 'spam' }));
  await assertFails(updateDoc(doc(asKu(), 'inquiries/i_1'), { body: 'edited' }));
  await assertFails(deleteDoc(doc(asKu(), 'inquiries/i_1')));
});

// --- reviews -----------------------------------------------------------------
//
// One review per (course, author): the document id is `<courseKey>_<authorId>`,
// so the id itself is the uniqueness constraint and the create rule pins it to
// the caller's uid. Reads are KU-domain; writes are the author's, verified.

test('reviews: an unverified KU address can still read a review (I3)', async () => {
  await assertSucceeds(getDoc(doc(asKuUnverified(), 'reviews/ck_u1')));
});

test('reviews: an outsider Firebase account cannot read (I3)', async () => {
  await assertFails(getDoc(doc(asOutsider(), 'reviews/ck_u1')));
  await assertFails(getDoc(doc(asAnon(), 'reviews/ck_u1')));
});

test('reviews: no client may create, edit or delete a review (server-only)', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'reviews/ck_u2'), reviewDoc({ id: 'ck_u2', authorId: 'u2' }));
  });
  await assertFails(setDoc(doc(asKu(), 'reviews/ck_u1'), reviewDoc({ id: 'ck_u1', authorId: 'u1' })));
  await assertFails(updateDoc(doc(asKu2(), 'reviews/ck_u2'), { rating: 1 }));
  await assertFails(updateDoc(doc(asKu(), 'reviews/ck_u2'), { helpfulBy: ['u1'] }));
  await assertFails(deleteDoc(doc(asKu2(), 'reviews/ck_u2')));
});

test('course_stats: KU-domain reads; nobody writes (server-only)', async () => {
  await assertSucceeds(getDoc(doc(asKu(), 'course_stats/ck')));
  await assertFails(getDoc(doc(asOutsider(), 'course_stats/ck')));
  await assertFails(setDoc(doc(asKu(), 'course_stats/ck'), { courseKey: 'ck', university_id: 'kyoto_u', reviewCount: 99, ratingSum: 495 }));
  await assertFails(setDoc(doc(asKu(), 'course_stats/ck'), { pastExamPostCount: 1 }, { merge: true }));
});

test('credits: owner reads own balance and ledger; nobody writes', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'credit_balances/u1'), { balance: 3 });
    await setDoc(doc(db, 'credits_ledger/signup_u1'), { uid: 'u1', delta: 3 });
    await setDoc(doc(db, 'credits_ledger/signup_u2'), { uid: 'u2', delta: 3 });
  });
  await assertSucceeds(getDoc(doc(asKu(), 'credit_balances/u1')));
  await assertFails(getDoc(doc(asKu2(), 'credit_balances/u1')));
  await assertSucceeds(getDocs(query(collection(asKu(), 'credits_ledger'), where('uid', '==', 'u1'))));
  await assertFails(getDocs(query(collection(asKu(), 'credits_ledger'), where('uid', '==', 'u2'))));
  await assertFails(setDoc(doc(asKu(), 'credit_balances/u1'), { balance: 999 }));
  await assertFails(setDoc(doc(asKu(), 'credits_ledger/x'), { uid: 'u1', delta: 999 }));
});

test('notifications: recipient reads and marks read; nothing else', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'notifications/n1'), { uid: 'u1', read: false, title: 'x' });
  });
  await assertSucceeds(getDocs(query(collection(asKu(), 'notifications'), where('uid', '==', 'u1'), where('read', '==', false))));
  await assertFails(getDoc(doc(asKu2(), 'notifications/n1')));
  await assertFails(updateDoc(doc(asKu(), 'notifications/n1'), { title: 'hacked' }));
  await assertFails(updateDoc(doc(asKu2(), 'notifications/n1'), { read: true }));
  await assertSucceeds(updateDoc(doc(asKu(), 'notifications/n1'), { read: true }));
  await assertFails(setDoc(doc(asKu(), 'notifications/n2'), { uid: 'u1', read: false }));
});

test('posts and requests: clients only read; every write goes through the server', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'posts/p1'), { authorId: 'u1', university_id: 'kyoto_u', reports: [], downloadCount: 0 });
    await setDoc(doc(ctx.firestore(), 'requests/r1'), { authorId: 'u1', university_id: 'kyoto_u', isFulfilled: false });
  });
  await assertSucceeds(getDoc(doc(asKu2(), 'posts/p1')));
  await assertSucceeds(getDoc(doc(asKu2(), 'requests/r1')));
  await assertFails(getDoc(doc(asOutsider(), 'posts/p1')));
  await assertFails(setDoc(doc(asKu(), 'posts/p2'), { authorId: 'u1', university_id: 'kyoto_u' }));
  await assertFails(updateDoc(doc(asKu(), 'posts/p1'), { title: 'edited' }));
  await assertFails(updateDoc(doc(asKu2(), 'posts/p1'), { downloadCount: 1 }));
  await assertFails(deleteDoc(doc(asKu(), 'posts/p1')));
  await assertFails(setDoc(doc(asKu(), 'requests/r2'), { authorId: 'u1', university_id: 'kyoto_u' }));
  await assertFails(updateDoc(doc(asKu2(), 'requests/r1'), { isFulfilled: true }));
});

test('an upper-cased KU address is still a KU address (M1)', async () => {
  const upper = env.authenticatedContext('u6', KU_UPPERCASE).firestore();
  await assertSucceeds(getDoc(doc(upper, 'courses/any')));
  await assertSucceeds(setDoc(doc(upper, 'user_timetables/u6'), { timetable: {} }));
});

test('chats: members read and post as themselves; outsiders and forged senders are refused', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'chats/l1_u2'), { members: ['u1', 'u2'], lastMessage: '', lastAt: '', status: 'open' });
  });
  const KU3 = env.authenticatedContext('u7', { sub: 'u7', email: 'z@st.kyoto-u.ac.jp', email_verified: true }).firestore();
  await assertSucceeds(getDoc(doc(asKu(), 'chats/l1_u2')));
  await assertFails(getDoc(doc(KU3, 'chats/l1_u2')));
  await assertSucceeds(setDoc(doc(asKu(), 'chats/l1_u2/messages/m1'), { senderId: 'u1', text: 'こんにちは', createdAt: 'x' }));
  await assertFails(setDoc(doc(asKu(), 'chats/l1_u2/messages/m2'), { senderId: 'u2', text: 'なりすまし', createdAt: 'x' }));
  await assertFails(setDoc(doc(KU3, 'chats/l1_u2/messages/m3'), { senderId: 'u7', text: '割り込み', createdAt: 'x' }));
  await assertFails(setDoc(doc(asKu(), 'chats/l1_u2/messages/m4'), { senderId: 'u1', text: '', createdAt: 'x' }));
  await assertSucceeds(getDocs(collection(asKu2(), 'chats/l1_u2/messages')));
  await assertSucceeds(updateDoc(doc(asKu(), 'chats/l1_u2'), { lastMessage: 'こんにちは', lastAt: 'y' }));
  await assertFails(updateDoc(doc(asKu(), 'chats/l1_u2'), { status: 'done' }));
  await assertFails(setDoc(doc(asKu(), 'chats/l9_u1'), { members: ['u1', 'u2'] }));
});

test('textbook listings, ratings and user_stats are server-only writes', async () => {
  await assertSucceeds(getDoc(doc(asKu(), 'textbook_listings/x')));
  await assertFails(setDoc(doc(asKu(), 'textbook_listings/x'), { sellerId: 'u1' }));
  await assertFails(setDoc(doc(asKu(), 'trade_ratings/x'), { from: 'u1', stars: 5 }));
  await assertFails(setDoc(doc(asKu(), 'user_stats/u1'), { tradeRatingSum: 99 }));
});

// --- queries -----------------------------------------------------------------
// Rules gate queries, they do not filter them: a listen is allowed only when the
// rule can be satisfied for every document the query could return. These mirror
// the exact `where` shapes the client streams use.

test('transactions: a user may listen only to their own ledger', async () => {
  const db = asKu();
  await assertSucceeds(getDocs(query(
    collection(db, 'transactions'),
    where('university_id', '==', 'kyoto_u'),
    where('userId', '==', 'u1'),
  )));
  await assertFails(getDocs(query(
    collection(db, 'transactions'),
    where('university_id', '==', 'kyoto_u'),
    where('userId', '==', 'u2'),
  )));
});

for (const name of ['posts', 'requests', 'textbook_requests', 'talk_rooms', 'courses']) {
  test(`${name}: the university-scoped stream query is allowed`, async () => {
    await assertSucceeds(getDocs(query(
      collection(asKu(), name),
      where('university_id', '==', 'kyoto_u'),
    )));
  });
}

test('users: the invitation-code lookup query is allowed', async () => {
  await assertSucceeds(getDocs(query(
    collection(asKu(), 'users'),
    where('invitationCode', '==', 'KUXXXX'),
  )));
});

// --- catch-all ---------------------------------------------------------------

test('unlisted collections are denied to everyone', async () => {
  const db = asKu();
  await assertFails(getDoc(doc(db, 'secret_admin_stuff/s_1')));
  await assertFails(setDoc(doc(db, 'secret_admin_stuff/s_2'), { university_id: 'kyoto_u' }));
  await assertFails(getDoc(doc(db, 'posts/seed_u1/comments/x')));
  await assertFails(setDoc(doc(db, 'posts/seed_u1/comments/x'), { body: 'nested' }));
});
