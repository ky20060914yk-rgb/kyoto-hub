import { readFileSync } from 'node:fs';
import { test, before, beforeEach, after } from 'node:test';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import { setDoc, getDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';

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
// R5 guards against a suffix-only match: this address is NOT a KU address even
// though it ends in the KU domain string when the pattern is not start-anchored.
const SPOOFER = { sub: 'u4', email: 'evil@evil.com@st.kyoto-u.ac.jp.attacker.com', email_verified: true };
const SPOOFER_PREFIX = { sub: 'u5', email: 'evil@evil.com/a@st.kyoto-u.ac.jp', email_verified: true };

const asKu = () => env.authenticatedContext('u1', KU).firestore();
const asKu2 = () => env.authenticatedContext('u2', KU2).firestore();
const asAnon = () => env.unauthenticatedContext().firestore();

// Seed baseline documents with rules bypassed so read/update tests exercise the
// rule under test rather than a missing-document condition.
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'courses/c_1'), { name: '線形代数', university_id: 'kyoto_u' });
    await setDoc(doc(db, 'users/u1'), { displayName: 'me', university_id: 'kyoto_u' });
    await setDoc(doc(db, 'users/u2'), { displayName: 'other', university_id: 'kyoto_u' });
    await setDoc(doc(db, 'user_timetables/u1'), { user_id: 'u1', university_id: 'kyoto_u', timetable: {} });
    await setDoc(doc(db, 'user_timetables/u2'), { user_id: 'u2', university_id: 'kyoto_u', timetable: {} });
    await setDoc(doc(db, 'posts/seed_u1'), {
      authorId: 'u1', university_id: 'kyoto_u', title: 't', reports: [], downloadCount: 0,
    });
    await setDoc(doc(db, 'requests/req_u1'), { authorId: 'u1', university_id: 'kyoto_u', title: 'r' });
    await setDoc(doc(db, 'textbook_requests/tb_u1'), {
      requesterId: 'u1', university_id: 'kyoto_u', status: 'open',
    });
    await setDoc(doc(db, 'talk_rooms/room_1'), {
      lenderId: 'u1', borrowerId: 'u2', university_id: 'kyoto_u', messages: [],
    });
    await setDoc(doc(db, 'transactions/tx_u1'), {
      userId: 'u1', university_id: 'kyoto_u', amount: 5, type: 'upload_reward',
    });
    await setDoc(doc(db, 'inquiries/i_1'), { userId: 'u1', university_id: 'kyoto_u', body: 'hi' });
    await setDoc(doc(db, 'secret_admin_stuff/s_1'), { university_id: 'kyoto_u' });
  });
});

// --- courses -----------------------------------------------------------------

test('anonymous cannot read courses', async () => {
  await assertFails(getDoc(doc(asAnon(), 'courses/c_1')));
});

test('any signed-in user can read courses', async () => {
  await assertSucceeds(getDoc(doc(asKu(), 'courses/c_1')));
});

test('verified KU user can create a valid course', async () => {
  await assertSucceeds(setDoc(doc(asKu(), 'courses/c_new'), {
    name: '解析学', university_id: 'kyoto_u',
  }));
});

test('course create is rejected with an empty name', async () => {
  await assertFails(setDoc(doc(asKu(), 'courses/c_empty'), {
    name: '', university_id: 'kyoto_u',
  }));
});

test('course create is rejected for another university', async () => {
  await assertFails(setDoc(doc(asKu(), 'courses/c_other'), {
    name: 'x', university_id: 'osaka_u',
  }));
});

test('unverified user cannot create a course', async () => {
  const db = env.authenticatedContext('u2', KU_UNVERIFIED).firestore();
  await assertFails(setDoc(doc(db, 'courses/c_unverified'), { name: 'x', university_id: 'kyoto_u' }));
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

test('verified KU user can create a post they author', async () => {
  await assertSucceeds(setDoc(doc(asKu(), 'posts/p1'), {
    authorId: 'u1', university_id: 'kyoto_u', subjectId: 'c_1', title: 't', category: 'past_exam',
  }));
});

test('unverified user cannot create a post', async () => {
  const db = env.authenticatedContext('u2', KU_UNVERIFIED).firestore();
  await assertFails(setDoc(doc(db, 'posts/p2'), { authorId: 'u2', university_id: 'kyoto_u' }));
});

test('non-KU email cannot create a post even if verified', async () => {
  const db = env.authenticatedContext('u3', OUTSIDER).firestore();
  await assertFails(setDoc(doc(db, 'posts/p3'), { authorId: 'u3', university_id: 'kyoto_u' }));
});

test('suffix-spoofed KU address cannot create a post (R5 anchoring)', async () => {
  const db = env.authenticatedContext('u4', SPOOFER).firestore();
  await assertFails(setDoc(doc(db, 'posts/p_spoof'), { authorId: 'u4', university_id: 'kyoto_u' }));
});

test('address with an extra @ before the KU domain cannot create a post (R5 anchoring)', async () => {
  const db = env.authenticatedContext('u5', SPOOFER_PREFIX).firestore();
  await assertFails(setDoc(doc(db, 'posts/p_spoof2'), { authorId: 'u5', university_id: 'kyoto_u' }));
});

test('cannot create a post attributed to someone else', async () => {
  await assertFails(setDoc(doc(asKu(), 'posts/p4'), { authorId: 'u2', university_id: 'kyoto_u' }));
});

test('author can update and delete their own post', async () => {
  const db = asKu();
  await assertSucceeds(updateDoc(doc(db, 'posts/seed_u1'), { title: 'edited' }));
  await assertSucceeds(deleteDoc(doc(db, 'posts/seed_u1')));
});

test('non-author may only touch the reports field of a post', async () => {
  const db = asKu2();
  await assertSucceeds(updateDoc(doc(db, 'posts/seed_u1'), { reports: ['u2'] }));
  await assertFails(updateDoc(doc(db, 'posts/seed_u1'), { title: 'vandalised' }));
  await assertFails(updateDoc(doc(db, 'posts/seed_u1'), { reports: ['u2'], title: 'vandalised' }));
  await assertFails(deleteDoc(doc(db, 'posts/seed_u1')));
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
  await assertSucceeds(updateDoc(doc(asKu2(), 'talk_rooms/room_1'), { messages: [{ text: 'yo' }] }));
  const outsider = env.authenticatedContext('u3', OUTSIDER).firestore();
  await assertFails(updateDoc(doc(outsider, 'talk_rooms/room_1'), { messages: [{ text: 'spy' }] }));
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

// --- catch-all ---------------------------------------------------------------

test('unlisted collections are denied to everyone', async () => {
  const db = asKu();
  await assertFails(getDoc(doc(db, 'secret_admin_stuff/s_1')));
  await assertFails(setDoc(doc(db, 'secret_admin_stuff/s_2'), { university_id: 'kyoto_u' }));
  await assertFails(getDoc(doc(db, 'posts/seed_u1/comments/x')));
  await assertFails(setDoc(doc(db, 'posts/seed_u1/comments/x'), { body: 'nested' }));
});
