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
  costSpent: 0,
  rewardPoints: 0,
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

// What `Post.toMap()` emits after Plan 2A: private storage paths, no price.
const validPost = (over = {}) => ({
  id: 'p_new', university_id: 'kyoto_u', authorId: 'u1', authorName: 'me',
  subjectId: 'c_1', subjectName: '線形代数', category: 'past_exam', year: 2024,
  title: 't', description: '', fileNames: ['a.pdf'],
  filePaths: ['resources/u1/1_a.pdf'], downloadCount: 0, reports: [],
  createdAt: '2026-09-01T00:00:00.000',
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
    await setDoc(doc(db, 'credit_balances/u1'), { balance: 3, university_id: 'kyoto_u' });
    await setDoc(doc(db, 'credits_ledger/signup_u1'), {
      uid: 'u1', delta: 3, reason: 'signup_bonus', balanceAfter: 3, university_id: 'kyoto_u',
    });
    await setDoc(doc(db, 'requests/req_self'), {
      authorId: 'u1', university_id: 'kyoto_u', title: 'r', isFulfilled: false, fulfilledPostId: null,
    });
    await setDoc(doc(db, 'invitation_codes/ABC234'), { uid: 'u1', university_id: 'kyoto_u' });
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
    await setDoc(doc(db, 'notifications/n_u1'), {
      uid: 'u1', type: 'post_hidden', postId: 'p', postTitle: 't', read: false, university_id: 'kyoto_u',
    });
    // A post hidden by moderation: its author (u2) cannot read it either.
    await setDoc(doc(db, 'hidden_posts/hid_1'), { authorId: 'u2', university_id: 'kyoto_u', title: 'hidden' });
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
  await assertSucceeds(setDoc(doc(asKu(), 'courses/c_custom_100'), validCourse('c_custom_100')));
});

test('course create is rejected with an empty name', async () => {
  await assertFails(setDoc(doc(asKu(), 'courses/c_custom_101'), validCourse('c_custom_101', { name: '' })));
});

test('course create is rejected for another university', async () => {
  await assertFails(setDoc(doc(asKu(), 'courses/c_custom_102'),
    validCourse('c_custom_102', { university_id: 'osaka_u' })));
});

test('unverified user cannot create a course', async () => {
  await assertFails(setDoc(doc(asKuUnverified(), 'courses/c_custom_103'),
    validCourse('c_custom_103')));
});

// --- courses: the create shape must satisfy the reader (C1) ------------------
//
// CourseRepository._fromDoc is now defensive, but the rules are the only thing
// that keeps a *new* doc from being written in a shape the catalog cannot use.

test('course create is rejected when `id` is missing (C1)', async () => {
  const data = validCourse('c_custom_104');
  delete data.id;
  await assertFails(setDoc(doc(asKu(), 'courses/c_custom_104'), data));
});

test('course create is rejected when `id` does not match the document id (C1)', async () => {
  await assertFails(setDoc(doc(asKu(), 'courses/c_custom_105'), validCourse('c_custom_106')));
});

test('course create is rejected for an out-of-range period (C1)', async () => {
  await assertFails(setDoc(doc(asKu(), 'courses/c_custom_107'), validCourse('c_custom_107', { period: 0 })));
  await assertFails(setDoc(doc(asKu(), 'courses/c_custom_108'), validCourse('c_custom_108', { period: 6 })));
});

test('course create is rejected when `period` is not an int (C1)', async () => {
  await assertFails(setDoc(doc(asKu(), 'courses/c_custom_109'), validCourse('c_custom_109', { period: '2' })));
  await assertFails(setDoc(doc(asKu(), 'courses/c_custom_110'), validCourse('c_custom_110', { period: 2.5 })));
});

test('course create is rejected for a weekend dayOfWeek (C1)', async () => {
  await assertFails(setDoc(doc(asKu(), 'courses/c_custom_111'), validCourse('c_custom_111', { dayOfWeek: 'Sat' })));
});

test('course create is rejected when `courseKey` is missing (C1)', async () => {
  const data = validCourse('c_custom_112');
  delete data.courseKey;
  await assertFails(setDoc(doc(asKu(), 'courses/c_custom_112'), data));
});

test('course create is rejected for a non-string `lecturer` (C1)', async () => {
  await assertFails(setDoc(doc(asKu(), 'courses/c_custom_113'), validCourse('c_custom_113', { lecturer: 123 })));
});

test('course create is rejected for a non-string `faculty` (C1)', async () => {
  await assertFails(setDoc(doc(asKu(), 'courses/c_custom_114'), validCourse('c_custom_114', { faculty: [] })));
});

// P2-13: client-created courses must be recognisable. The reviewCreated trigger
// pays the scarce-course bonus only for catalog courses, i.e. ids that do NOT
// start with `c_custom_`; the rule pins client-created ids to that namespace.
test('course create is rejected outside the c_custom_<millis> id namespace (P2-13)', async () => {
  await assertFails(setDoc(doc(asKu(), 'courses/c_a2936c7a40d9318f'), validCourse('c_a2936c7a40d9318f')));
  await assertFails(setDoc(doc(asKu(), 'courses/c_custom_x'), validCourse('c_custom_x')));
  await assertFails(setDoc(doc(asKu(), 'courses/c_custom_'), validCourse('c_custom_')));
  await assertSucceeds(setDoc(doc(asKu(), 'courses/c_custom_1760000000000'), validCourse('c_custom_1760000000000')));
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
  ['users', 'users/u2'],
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

test('a user can read only their own profile (2B)', async () => {
  await assertSucceeds(getDoc(doc(asKu(), 'users/u1')));
  await assertFails(getDoc(doc(asKu(), 'users/u2')));
  await assertFails(getDoc(doc(asAnon(), 'users/u1')));
  await assertFails(getDocs(query(collection(asKu(), 'users'), where('university_id', '==', 'kyoto_u'))));
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

test('verified KU user can create a post they author', async () => {
  await assertSucceeds(setDoc(doc(asKu(), 'posts/p1'), validPost({ id: 'p1' })));
});

test('a post must carry university_id kyoto_u on create', async () => {
  const { university_id, ...noUni } = validPost({ id: 'p_nu' });
  await assertFails(setDoc(doc(asKu(), 'posts/p_nu'), noUni));
  await assertFails(setDoc(doc(asKu(), 'posts/p_nu2'), validPost({ id: 'p_nu2', university_id: 'other_u' })));
});

test('unverified user cannot create a post', async () => {
  const db = env.authenticatedContext('u2', KU_UNVERIFIED).firestore();
  await assertFails(setDoc(doc(db, 'posts/p2'), validPost({ id: 'p2', authorId: 'u2', filePaths: ['resources/u2/1_a.pdf'] })));
});

test('non-KU email cannot create a post even if verified', async () => {
  const db = env.authenticatedContext('u3', OUTSIDER).firestore();
  await assertFails(setDoc(doc(db, 'posts/p3'), validPost({ id: 'p3', authorId: 'u3', filePaths: ['resources/u3/1_a.pdf'] })));
});

test('address with an extra @ before the KU domain cannot create a post (R5 anchoring)', async () => {
  const db = env.authenticatedContext('u4', SPOOFER).firestore();
  await assertFails(setDoc(doc(db, 'posts/p_spoof'), validPost({ id: 'p_spoof', authorId: 'u4', filePaths: ['resources/u4/1_a.pdf'] })));
});

test('address whose real domain only ends with the KU domain cannot create a post (R5 anchoring)', async () => {
  const db = env.authenticatedContext('u5', SPOOFER_SUFFIX).firestore();
  await assertFails(setDoc(doc(db, 'posts/p_spoof2'), validPost({ id: 'p_spoof2', authorId: 'u5', filePaths: ['resources/u5/1_a.pdf'] })));
});

test('an upper-cased KU address is still a KU address (M1)', async () => {
  const db = env.authenticatedContext('u6', KU_UPPERCASE).firestore();
  await assertSucceeds(setDoc(doc(db, 'posts/p_upper'), validPost({ id: 'p_upper', authorId: 'u6', filePaths: ['resources/u6/1_a.pdf'] })));
});

test('cannot create a post attributed to someone else', async () => {
  await assertFails(setDoc(doc(asKu(), 'posts/p4'), validPost({ id: 'p4', authorId: 'u2' })));
});

test('author can update and delete their own post', async () => {
  const db = asKu();
  await assertSucceeds(updateDoc(doc(db, 'posts/seed_u1'), { title: 'edited' }));
  await assertSucceeds(deleteDoc(doc(db, 'posts/seed_u1')));
});

// --- posts: moderation is Function-owned (Plan 2B) ---------------------------

test('no client may write reports any more — not a reporter, not the author (2B)', async () => {
  await assertFails(updateDoc(doc(asKu2(), 'posts/seed_u1'), { reports: ['u2'] }));
  await assertFails(updateDoc(doc(asKu2(), 'posts/flagged_u1'), { reports: ['ra', 'u2'] }));
  await assertFails(updateDoc(doc(asKu(), 'posts/flagged_u1'), { reports: [] }));
  await assertFails(updateDoc(doc(asKu(), 'posts/reported_u1'), { reports: [] }));
  await assertSucceeds(updateDoc(doc(asKu(), 'posts/flagged_u1'), { description: 'x' }));
});

test('a non-author can never edit or delete a post, whatever its stored reports say (2B)', async () => {
  await assertFails(updateDoc(doc(asKu2(), 'posts/seed_u1'), { title: 'vandalised' }));
  await assertFails(deleteDoc(doc(asKu2(), 'posts/seed_u1')));
  await assertFails(deleteDoc(doc(asKu2(), 'posts/reported_u1'))); // 3 legacy reports: no longer a licence
  const outsider = env.authenticatedContext('u3', OUTSIDER).firestore();
  await assertFails(deleteDoc(doc(outsider, 'posts/reported_u1')));
});

test('a post cannot be created under the id of a hidden post (2B, M-1)', async () => {
  await assertFails(setDoc(doc(asKu(), 'posts/hid_1'), validPost({ id: 'hid_1' })));
  await assertSucceeds(setDoc(doc(asKu(), 'posts/fresh_1'), validPost({ id: 'fresh_1' })));
});

test('an author cannot rewrite a post out of its stream or reassign it (M5)', async () => {
  const db = asKu();
  await assertFails(updateDoc(doc(db, 'posts/seed_u1'), { authorId: 'u2' }));
  await assertFails(updateDoc(doc(db, 'posts/seed_u1'), { university_id: 'osaka_u' }));
});

// --- posts: download counters are server-only (Plan 2A) ----------------------

test('nobody but a Function can change downloadCount — not a downloader, not the author', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'posts/dl_u1'), validPost({ id: 'dl_u1', downloadCount: 4 }));
  });
  await assertFails(updateDoc(doc(asKu2(), 'posts/dl_u1'), { downloadCount: 5 }));
  await assertFails(updateDoc(doc(asKu(), 'posts/dl_u1'), { downloadCount: 999 }));
});

test('an author cannot rewrite filePaths after creation (cannot swap in another file)', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'posts/fp_u1'), validPost({ id: 'fp_u1' }));
  });
  await assertFails(updateDoc(doc(asKu(), 'posts/fp_u1'), { filePaths: ['resources/u2/1_b.pdf'] }));
  await assertSucceeds(updateDoc(doc(asKu(), 'posts/fp_u1'), { title: 'edited' }));
});

test('post create requires filePaths under the caller’s own resources/ prefix', async () => {
  const db = asKu();
  await assertSucceeds(setDoc(doc(db, 'posts/ok_1'), validPost({ id: 'ok_1' })));
  await assertFails(setDoc(doc(db, 'posts/bad_1'), validPost({ id: 'bad_1', filePaths: ['resources/u2/1_b.pdf'] })));
  await assertFails(setDoc(doc(db, 'posts/bad_2'), validPost({ id: 'bad_2', filePaths: [] })));
  const noPaths = validPost({ id: 'bad_3' });
  delete noPaths.filePaths; // (`filePaths: undefined` would make the SDK throw before the rules run)
  await assertFails(setDoc(doc(db, 'posts/bad_3'), noPaths));
  await assertFails(setDoc(doc(db, 'posts/bad_4'), validPost({ id: 'bad_4', filePaths: Array(6).fill('resources/u1/x.pdf') })));
});

test('post create cannot pre-set downloadCount or reports', async () => {
  const db = asKu();
  await assertFails(setDoc(doc(db, 'posts/bad_5'), validPost({ id: 'bad_5', downloadCount: 50 })));
  await assertFails(setDoc(doc(db, 'posts/bad_6'), validPost({ id: 'bad_6', reports: ['x', 'y', 'z'] })));
});

// --- requests ----------------------------------------------------------------

test('requests: verified author only for create, author only for update/delete', async () => {
  const mine = asKu();
  await assertSucceeds(setDoc(doc(mine, 'requests/req_new'), {
    authorId: 'u1', university_id: 'kyoto_u', title: 'need notes',
  }));
  await assertFails(setDoc(doc(mine, 'requests/req_other'), {
    authorId: 'u2', university_id: 'kyoto_u',
  }));
  await assertSucceeds(updateDoc(doc(mine, 'requests/req_u1'), { title: 'edited' }));
  await assertFails(updateDoc(doc(asKu2(), 'requests/req_u1'), { title: 'vandalised' }));
  await assertFails(deleteDoc(doc(asKu2(), 'requests/req_u1')));
  await assertSucceeds(deleteDoc(doc(mine, 'requests/req_u1')));
});

// --- requests: fulfilment is Function-only (Plan 2A) -------------------------

test('a non-author can no longer touch a request at all (the trigger fulfils it)', async () => {
  await assertFails(updateDoc(doc(asKu2(), 'requests/req_u1'), { isFulfilled: true, fulfilledPostId: 'p_new' }));
  await assertFails(setDoc(doc(asKu2(), 'requests/req_full'), fullRequest({ costSpent: 0, rewardPoints: 0 })));
});

test('an author cannot self-fulfil their request (that would unlock any post for free)', async () => {
  const db = asKu();
  await assertFails(updateDoc(doc(db, 'requests/req_self'), { isFulfilled: true }));
  await assertFails(updateDoc(doc(db, 'requests/req_self'), { fulfilledPostId: 'some_post' }));
  await assertFails(setDoc(doc(db, 'requests/req_full'),
    fullRequest({ costSpent: 0, rewardPoints: 0, isFulfilled: true, fulfilledPostId: 'p_x' })));
  await assertSucceeds(updateDoc(doc(db, 'requests/req_self'), { title: 'edited' }));
});

test('a request is created unfulfilled with no cost or reward', async () => {
  const db = asKu();
  await assertSucceeds(setDoc(doc(db, 'requests/req_ok'), fullRequest({ id: 'req_ok', costSpent: 0, rewardPoints: 0 })));
  await assertFails(setDoc(doc(db, 'requests/req_pre'), fullRequest({ id: 'req_pre', costSpent: 0, rewardPoints: 0, isFulfilled: true })));
  await assertFails(setDoc(doc(db, 'requests/req_rw'), fullRequest({ id: 'req_rw', rewardPoints: 10 })));
  await assertFails(setDoc(doc(db, 'requests/req_co'), fullRequest({ id: 'req_co', costSpent: 1 })));
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

// --- talk_rooms: participants only (Plan 2B, M-15) --------------------------

test('talk_rooms: only the two participants can read a room (2B)', async () => {
  await assertSucceeds(getDoc(doc(asKu(), 'talk_rooms/room_1')));
  await assertSucceeds(getDoc(doc(asKu2(), 'talk_rooms/room_1')));
  const stranger = env.authenticatedContext('u7', { email: 'g@st.kyoto-u.ac.jp', email_verified: true }).firestore();
  await assertFails(getDoc(doc(stranger, 'talk_rooms/room_1')));
});

test('talk_rooms: the participant queries are allowed; the university-wide stream is not (2B)', async () => {
  await assertSucceeds(getDocs(query(collection(asKu(), 'talk_rooms'), where('lenderId', '==', 'u1'))));
  await assertSucceeds(getDocs(query(collection(asKu2(), 'talk_rooms'), where('borrowerId', '==', 'u2'))));
  await assertFails(getDocs(query(collection(asKu(), 'talk_rooms'), where('lenderId', '==', 'u2'))));
  await assertFails(getDocs(query(collection(asKu(), 'talk_rooms'), where('university_id', '==', 'kyoto_u'))));
});

// --- transactions ------------------------------------------------------------

test('transactions are readable only by their owner', async () => {
  await assertSucceeds(getDoc(doc(asKu(), 'transactions/tx_u1')));
  await assertFails(getDoc(doc(asKu2(), 'transactions/tx_u1')));
  await assertFails(getDoc(doc(asAnon(), 'transactions/tx_u1')));
});

test('transactions can no longer be created by any client (ledger is server-authored)', async () => {
  await assertFails(setDoc(doc(asKu(), 'transactions/tx_new'), {
    userId: 'u1', university_id: 'kyoto_u', amount: 1, type: 'upload_reward',
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

test('verified KU user creates their own review (doc id ends _<uid>)', async () => {
  await assertSucceeds(setDoc(doc(asKu(), 'reviews/other_u1'),
    reviewDoc({ id: 'other_u1', courseKey: 'other', authorId: 'u1' })));
});

test('cannot create a review whose doc id is not <courseKey>_<own uid>', async () => {
  const db = asKu();
  // Someone else's uid in the id.
  await assertFails(setDoc(doc(db, 'reviews/other_u2'),
    reviewDoc({ id: 'other_u2', courseKey: 'other', authorId: 'u1' })));
  // The id does not encode the courseKey it carries — that would let one author
  // hold several documents for the same course.
  await assertFails(setDoc(doc(db, 'reviews/somethingelse_u1'),
    reviewDoc({ id: 'somethingelse_u1', courseKey: 'other', authorId: 'u1' })));
});

test('cannot create a review with authorId != uid', async () => {
  await assertFails(setDoc(doc(asKu(), 'reviews/other_u1'),
    reviewDoc({ id: 'other_u1', courseKey: 'other', authorId: 'u2' })));
});

test('unverified KU user cannot create a review', async () => {
  await assertFails(setDoc(doc(asKuUnverified(), 'reviews/other_u2'),
    reviewDoc({ id: 'other_u2', courseKey: 'other', authorId: 'u2' })));
  await assertFails(setDoc(doc(asOutsider(), 'reviews/other_u3'),
    reviewDoc({ id: 'other_u3', courseKey: 'other', authorId: 'u3' })));
});

test('review create is rejected for an out-of-range rating', async () => {
  const db = asKu();
  await assertFails(setDoc(doc(db, 'reviews/r6_u1'),
    reviewDoc({ id: 'r6_u1', courseKey: 'r6', rating: 6 })));
  await assertFails(setDoc(doc(db, 'reviews/r0_u1'),
    reviewDoc({ id: 'r0_u1', courseKey: 'r0', rating: 0 })));
});

test('review create is rejected when `rating` is not an int', async () => {
  const db = asKu();
  await assertFails(setDoc(doc(db, 'reviews/rs_u1'),
    reviewDoc({ id: 'rs_u1', courseKey: 'rs', rating: 'x' })));
  await assertFails(setDoc(doc(db, 'reviews/rf_u1'),
    reviewDoc({ id: 'rf_u1', courseKey: 'rf', rating: 4.5 })));
});

test('review create is rejected for another university', async () => {
  await assertFails(setDoc(doc(asKu(), 'reviews/ou_u1'),
    reviewDoc({ id: 'ou_u1', courseKey: 'ou', university_id: 'osaka_u' })));
});

// I1: `helpfulBy` is a *benefit* to the review's author, so unlike `posts.reports`
// it must start empty. Without the create-time pin an author could ship a review
// with a pre-stuffed array, or delete-and-recreate to reset one they had already
// been voted on — the append-only update branch alone does not cover either.
test('review create must pin helpfulBy to the empty list', async () => {
  const db = asKu();
  await assertFails(setDoc(doc(db, 'reviews/hb1_u1'),
    reviewDoc({ id: 'hb1_u1', courseKey: 'hb1', helpfulBy: ['x'] })));
  await assertFails(setDoc(doc(db, 'reviews/hb2_u1'),
    reviewDoc({ id: 'hb2_u1', courseKey: 'hb2', helpfulBy: ['u1', 'a', 'b'] })));
  // A non-list is refused too (the reader would otherwise have to survive it).
  await assertFails(setDoc(doc(db, 'reviews/hb3_u1'),
    reviewDoc({ id: 'hb3_u1', courseKey: 'hb3', helpfulBy: 'nope' })));
  // The honest shape still goes through.
  await assertSucceeds(setDoc(doc(db, 'reviews/hb4_u1'),
    reviewDoc({ id: 'hb4_u1', courseKey: 'hb4', helpfulBy: [] })));
});

test('author edits their own review; a non-author cannot edit its body', async () => {
  await assertSucceeds(updateDoc(doc(asKu(), 'reviews/ck_u1'), { rating: 5, comment: 'edit' }));
  const other = asKu2();
  await assertFails(updateDoc(doc(other, 'reviews/ck_u1'), { comment: 'hax' }));
  await assertFails(updateDoc(doc(other, 'reviews/ck_u1'), { helpfulBy: ['u2'], comment: 'hax' }));
});

// I2: the author-edit branch re-runs the create-time `rating` check and pins
// `university_id`. Validating those only at create would let the author walk an
// honest 1..5 review up to `rating: 99` (or off to another university) one edit
// later — the same reason the `posts` author branch pins `university_id` (M5).
test('an author edit re-validates rating and cannot change university_id', async () => {
  const db = asKu();
  await assertFails(updateDoc(doc(db, 'reviews/ck_u1'), { rating: 99 }));
  await assertFails(updateDoc(doc(db, 'reviews/ck_u1'), { rating: 0 }));
  await assertFails(updateDoc(doc(db, 'reviews/ck_u1'), { rating: 'x' }));
  await assertFails(updateDoc(doc(db, 'reviews/ck_u1'), { rating: 4.5 }));
  await assertFails(updateDoc(doc(db, 'reviews/ck_u1'), { university_id: 'osaka_u' }));
  await assertSucceeds(updateDoc(doc(db, 'reviews/ck_u1'), { rating: 5 }));
});

test('an author cannot reassign their review or move its courseKey', async () => {
  const db = asKu();
  await assertFails(updateDoc(doc(db, 'reviews/ck_u1'), { authorId: 'u2' }));
  await assertFails(updateDoc(doc(db, 'reviews/ck_u1'), { courseKey: 'ck2' }));
});

// The author is not exempt from the append-only carve-out: writing `helpfulBy`
// leaves the author branch (which forbids the field outright) and has to satisfy
// the same one-own-uid append everyone else does. So an author cannot stuff the
// array — the most they can do is the single self-vote below, exactly as an
// author of a post can file the first `reports` entry against themselves.
test('an author cannot stuff helpfulBy on their own review', async () => {
  const db = asKu();
  await assertFails(updateDoc(doc(db, 'reviews/ck_u1'), { helpfulBy: ['a', 'b', 'c'] }));
  await assertFails(updateDoc(doc(db, 'reviews/ck_u1'), { helpfulBy: ['someone_else'] }));
  await assertFails(updateDoc(doc(db, 'reviews/ck_u1'), { helpfulBy: ['u1'], comment: 'x' }));
  // ...but an ordinary edit that leaves `helpfulBy` alone still works.
  await assertSucceeds(updateDoc(doc(db, 'reviews/ck_u1'), { comment: 'x' }));
});

test('a non-author appends exactly their own uid to helpfulBy, once', async () => {
  const db = asKu2();
  await assertSucceeds(updateDoc(doc(db, 'reviews/ck_u1'), { helpfulBy: ['u2'] }));
  // `ck2_u1` already carries u2's vote, so every further write BY u2 is refused
  // by the one-vote-per-account clause (`!old.hasAny([uid])`) — whether it grows
  // the array, leaves it alone, or shrinks it.
  await assertFails(updateDoc(doc(db, 'reviews/ck2_u1'), { helpfulBy: ['u2', 'u9'] }));
  await assertFails(updateDoc(doc(db, 'reviews/ck2_u1'), { helpfulBy: ['u2'] }));
  await assertFails(updateDoc(doc(db, 'reviews/ck2_u1'), { helpfulBy: [] }));
  // ...and u1, who has NOT voted, still cannot append someone else's uid: the
  // array grew by one but the new element is `u9`, not the caller.
  await assertFails(updateDoc(doc(asKu(), 'reviews/ck2_u1'), { helpfulBy: ['u2', 'u9'] }));
});

test('only a verified KU user may mark a review helpful', async () => {
  await assertFails(updateDoc(doc(asKuUnverified(), 'reviews/ck_u1'), { helpfulBy: ['u2'] }));
  await assertFails(updateDoc(doc(asOutsider(), 'reviews/ck_u1'), { helpfulBy: ['u3'] }));
});

// C1 — 17 courses in the deployed catalog have a '/' in their courseKey
// (`問題発見型/解決型学習(fbl/pbl)1|…`, `river/coastalengineering|…`). '/' is a path
// separator in a document id, so `reviews/<courseKey>_<uid>` was a 3-SEGMENT
// path that this match block never saw — it fell through to the catch-all deny
// and those courses were silently unreviewable. The id is pinned to `courseSlug`
// instead, which the client escapes.
test('C1: a review on a slash courseKey creates under its slugged doc id', async () => {
  const db = asKu();
  // 'x/y|z' -> 'x%2Fy|z'; the doc id is one segment, so the rule applies.
  await assertSucceeds(setDoc(doc(db, 'reviews/x%2Fy|z_u1'),
    reviewDoc({ id: 'x%2Fy|z_u1', courseKey: 'x/y|z', authorId: 'u1' })));
  // The real catalog shape, end to end.
  await assertSucceeds(setDoc(doc(db, 'reviews/river%2Fcoastalengineering|後藤仁志_u1'),
    reviewDoc({
      id: 'river%2Fcoastalengineering|後藤仁志_u1',
      courseKey: 'river/coastalengineering|後藤仁志',
      authorId: 'u1',
    })));
});

test('C1: a review whose doc id does not match its courseSlug is refused', async () => {
  const db = asKu();
  // The raw (unescaped) key as the slug — the pre-fix shape.
  await assertFails(setDoc(doc(db, 'reviews/x%2Fy|z_u1'),
    reviewDoc({ id: 'x%2Fy|z_u1', courseKey: 'x/y|z', courseSlug: 'x/y|z' })));
  // A slug that belongs to a different course: the id must encode the document
  // it claims to be about.
  await assertFails(setDoc(doc(db, 'reviews/x%2Fy|z_u1'),
    reviewDoc({ id: 'x%2Fy|z_u1', courseKey: 'x/y|z', courseSlug: 'someoneelse' })));
  // No slug at all (a client that skipped the escape).
  const noSlug = reviewDoc({ id: 'x%2Fy|z_u1', courseKey: 'x/y|z' });
  delete noSlug.courseSlug;
  await assertFails(setDoc(doc(db, 'reviews/x%2Fy|z_u1'), noSlug));
});

test('C1: an author cannot drift courseSlug away from the doc id', async () => {
  await assertFails(updateDoc(doc(asKu(), 'reviews/ck_u1'), { courseSlug: 'other' }));
});

// I3 — `helpfulBy` feeds the マイページ 貢献 badge, so a self-vote is a user
// inflating their own score. The author is excluded from the append-only branch
// outright (and the author branch already forbids touching `helpfulBy`), so
// there is no route left.
test('I3: the review author cannot append their own uid to helpfulBy', async () => {
  // u1 authored reviews/ck_u1; the honest single-uid append shape is still
  // refused because the caller IS the author.
  await assertFails(updateDoc(doc(asKu(), 'reviews/ck_u1'), { helpfulBy: ['u1'] }));
  // ...while the identical write from a non-author still succeeds.
  await assertSucceeds(updateDoc(doc(asKu2(), 'reviews/ck_u1'), { helpfulBy: ['u2'] }));
});

test('author deletes their own review; a non-author cannot', async () => {
  await assertFails(deleteDoc(doc(asKu2(), 'reviews/ck_u1')));
  await assertFails(deleteDoc(doc(asOutsider(), 'reviews/ck_u1')));
  await assertSucceeds(deleteDoc(doc(asKu(), 'reviews/ck_u1')));
});

// --- course_stats: Function-maintained aggregate (Plan 2B, M-11) ------------

test('course_stats: KU-domain reads; no client write of any kind (2B)', async () => {
  await assertSucceeds(getDoc(doc(asKu(), 'course_stats/ck')));
  await assertSucceeds(getDoc(doc(asKuUnverified(), 'course_stats/ck')));
  await assertFails(getDoc(doc(asOutsider(), 'course_stats/ck')));
  const ku = asKu();
  await assertFails(setDoc(doc(ku, 'course_stats/ck'), {
    courseKey: 'ck', university_id: 'kyoto_u', reviewCount: 2, ratingSum: 7,
  }, { merge: true }));
  await assertFails(setDoc(doc(ku, 'course_stats/fresh'), {
    courseKey: 'fresh', university_id: 'kyoto_u', pastExamPostCount: 1,
  }, { merge: true }));
  await assertFails(updateDoc(doc(ku, 'course_stats/ck'), { score: 100 }));
  await assertFails(deleteDoc(doc(ku, 'course_stats/ck')));
});

test('course_stats: the ranking pool query still runs (2B)', async () => {
  await assertSucceeds(getDocs(query(collection(asKu(), 'course_stats'), where('reviewCount', '>=', 1))));
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

for (const name of ['posts', 'requests', 'textbook_requests', 'courses']) {
  test(`${name}: the university-scoped stream query is allowed`, async () => {
    await assertSucceeds(getDocs(query(
      collection(asKu(), name),
      where('university_id', '==', 'kyoto_u'),
    )));
  });
}

test('users: no list query over other users’ profiles, e.g. the old invitation-code lookup (2B)', async () => {
  await assertFails(getDocs(query(collection(asKu(), 'users'), where('invitationCode', '==', 'KUXXXX'))));
});

// --- credits: Function-only writes, own-only reads (Plan 2A) -------------------

test('credit_balances: read own only; no client write of any kind', async () => {
  await assertSucceeds(getDoc(doc(asKu(), 'credit_balances/u1')));
  await assertFails(getDoc(doc(asKu2(), 'credit_balances/u1')));
  await assertFails(getDoc(doc(asAnon(), 'credit_balances/u1')));
  await assertFails(setDoc(doc(asKu(), 'credit_balances/u1'), { balance: 9999, university_id: 'kyoto_u' }));
  await assertFails(updateDoc(doc(asKu(), 'credit_balances/u1'), { balance: 9999 }));
  await assertFails(setDoc(doc(asKu(), 'credit_balances/brandnew'), { balance: 5 }));
  await assertFails(deleteDoc(doc(asKu(), 'credit_balances/u1')));
});

test('credits_ledger: read own rows only; no client write of any kind', async () => {
  await assertSucceeds(getDoc(doc(asKu(), 'credits_ledger/signup_u1')));
  await assertFails(getDoc(doc(asKu2(), 'credits_ledger/signup_u1')));
  await assertFails(setDoc(doc(asKu(), 'credits_ledger/forged'), { uid: 'u1', delta: 100, reason: 'x' }));
  await assertFails(updateDoc(doc(asKu(), 'credits_ledger/signup_u1'), { delta: 100 }));
  await assertFails(deleteDoc(doc(asKu(), 'credits_ledger/signup_u1')));
});

test('credits_ledger: the per-user stream query is allowed, another user’s is not', async () => {
  await assertSucceeds(getDocs(query(collection(asKu(), 'credits_ledger'), where('uid', '==', 'u1'))));
  await assertFails(getDocs(query(collection(asKu(), 'credits_ledger'), where('uid', '==', 'u2'))));
  await assertFails(getDocs(collection(asKu(), 'credits_ledger')));
});

test('invitation_codes: Admin-only — no client may read, list or write (P2-2)', async () => {
  const db = asKu();
  await assertFails(getDoc(doc(db, 'invitation_codes/ABC234')));
  await assertFails(getDocs(collection(db, 'invitation_codes')));
  await assertFails(getDocs(query(collection(db, 'invitation_codes'), where('uid', '==', 'u1'))));
  await assertFails(setDoc(doc(db, 'invitation_codes/ZZZ999'), { uid: 'u1' }));
  await assertFails(updateDoc(doc(db, 'invitation_codes/ABC234'), { uid: 'u1' }));
  await assertFails(deleteDoc(doc(db, 'invitation_codes/ABC234')));
});

test('welcome_claims: Admin-only — no client may get, list, create, update or delete (P2-15)', async () => {
  const db = asKu();
  await assertFails(getDoc(doc(db, 'welcome_claims/abc')));
  await assertFails(getDocs(collection(db, 'welcome_claims')));
  await assertFails(setDoc(doc(db, 'welcome_claims/new'), { uid: 'u1', university_id: 'kyoto_u' }));
  await assertFails(updateDoc(doc(db, 'welcome_claims/abc'), { uid: 'u1' }));
  await assertFails(deleteDoc(doc(db, 'welcome_claims/abc')));
});

test('users: pendingReferralCode is a short plain string on the caller’s own doc only', async () => {
  const db = asKu();
  await assertSucceeds(setDoc(doc(db, 'users/u1'), { displayName: 'me', university_id: 'kyoto_u', pendingReferralCode: 'ABC234' }));
  await assertSucceeds(updateDoc(doc(db, 'users/u1'), { pendingReferralCode: 'XYZ789' }));
  await assertFails(updateDoc(doc(db, 'users/u1'), { pendingReferralCode: 'X'.repeat(17) }));
  await assertFails(updateDoc(doc(db, 'users/u1'), { pendingReferralCode: 123 }));
  await assertFails(updateDoc(doc(db, 'users/u1'), { pendingReferralCode: ['ABC234'] }));
  await assertFails(updateDoc(doc(db, 'users/u2'), { pendingReferralCode: 'ABC234' }));
  await assertFails(setDoc(doc(db, 'users/u2'), { displayName: 'hax', pendingReferralCode: 'ABC234' }));
});

// --- notifications (Plan 2B, M-10) -------------------------------------------

test('notifications: own read and own query only; marking read is the only client write (2B)', async () => {
  const me = asKu();
  await assertSucceeds(getDoc(doc(me, 'notifications/n_u1')));
  await assertFails(getDoc(doc(asKu2(), 'notifications/n_u1')));
  await assertSucceeds(getDocs(query(collection(me, 'notifications'), where('uid', '==', 'u1'))));
  await assertFails(getDocs(query(collection(me, 'notifications'), where('uid', '==', 'u2'))));
  await assertSucceeds(updateDoc(doc(me, 'notifications/n_u1'), { read: true }));
  await assertFails(updateDoc(doc(me, 'notifications/n_u1'), { read: false })); // no un-reading
});

test('notifications: no forging, rewording, foreign mark-read or deleting (2B)', async () => {
  const me = asKu();
  await assertFails(setDoc(doc(me, 'notifications/forged'), { uid: 'u1', type: 'post_restored', read: false }));
  await assertFails(setDoc(doc(asKu2(), 'notifications/spam'), { uid: 'u1', type: 'post_hidden', read: false }));
  await assertFails(updateDoc(doc(me, 'notifications/n_u1'), { postTitle: 'changed' }));
  await assertFails(updateDoc(doc(me, 'notifications/n_u1'), { read: true, type: 'post_restored' }));
  await assertFails(updateDoc(doc(asKu2(), 'notifications/n_u1'), { read: true }));
  await assertFails(deleteDoc(doc(me, 'notifications/n_u1')));
});

// --- moderation collections: Admin-only (Plan 2B) ----------------------------

const ADMIN_ONLY = [
  'hidden_posts/hid_1', 'moderation_queue/p1', 'moderation_queue/p1/reports/u1',
  'moderation_actors/u1', 'moderation_meta/takedown_anon_2027-01-20', 'takedown_requests/t1', 'moderation_log/l1',
];
for (const path of ADMIN_ONLY) {
  test(`${path}: Admin-only — no client may get, create, update or delete (2B)`, async () => {
    for (const db of [asKu(), asKu2()]) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, path), { uid: 'u1', university_id: 'kyoto_u' }));
      await assertFails(deleteDoc(doc(db, path)));
    }
  });
}

test('moderation collections cannot be listed by any client (2B)', async () => {
  for (const name of ['hidden_posts', 'moderation_queue', 'moderation_actors', 'moderation_meta', 'takedown_requests', 'moderation_log']) {
    await assertFails(getDocs(collection(asKu(), name)));
  }
  await assertFails(getDocs(collection(asKu(), 'moderation_queue/p1/reports')));
});

// --- catch-all ---------------------------------------------------------------

test('unlisted collections are denied to everyone', async () => {
  const db = asKu();
  await assertFails(getDoc(doc(db, 'secret_admin_stuff/s_1')));
  await assertFails(setDoc(doc(db, 'secret_admin_stuff/s_2'), { university_id: 'kyoto_u' }));
  await assertFails(getDoc(doc(db, 'posts/seed_u1/comments/x')));
  await assertFails(setDoc(doc(db, 'posts/seed_u1/comments/x'), { body: 'nested' }));
});
