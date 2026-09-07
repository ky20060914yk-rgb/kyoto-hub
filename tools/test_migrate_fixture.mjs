// Emulator fixture + assertions for migrate_ids.mjs (C2).
//
//   node test_migrate_fixture.mjs seed    # write legacy-shaped documents
//   node test_migrate_fixture.mjs check   # assert they now hold the new ids
//
// Relies on FIRESTORE_EMULATOR_HOST being set by `firebase emulators:exec`, so
// it can never touch a real project.

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('refusing to run outside the emulator');
  process.exit(1);
}

initializeApp({ projectId: 'demo-migrate' });
const db = getFirestore();
const mode = process.argv[2];

// The ids the migration must produce, pinned. They are the sha1 of the
// build_courses.py courseKey pipeline over the first three legacy subjects, and
// each one exists in tools/courses.json:
//   ku_official_1 = 西洋社会思想史I  / 松本 啓二朗 / Mon 2
//   ku_official_2 = 哲学II          / 貫井 隆     / Thu 4
//   ku_official_3 = 東洋社会思想史II / 福谷 彬     / Fri 5
const EXPECTED = {
  ku_official_1: 'c_6a15b706f19dcb8e',
  ku_official_2: 'c_4afb7a5ad7743999',
  ku_official_3: 'c_25d8d8de0256ad61',
};
// A hand-added course id has no mapping and must survive untouched, and a value
// that is already migrated must not be touched twice (idempotence).
const CUSTOM = 'ku_custom_1700000000000';
const ALREADY = 'c_deadbeefdeadbeef';

if (mode === 'seed') {
  await db.doc('user_timetables/u1').set({
    user_id: 'u1',
    university_id: 'kyoto_u',
    timetable: {
      Mon_2: 'ku_official_1',
      Thu_4: 'ku_official_2',
      Tue_1: CUSTOM,
      Wed_3: ALREADY,
    },
  });
  await db.doc('posts/p1').set({
    authorId: 'u1', university_id: 'kyoto_u', subjectId: 'ku_official_1', title: 't',
  });
  await db.doc('requests/r1').set({
    authorId: 'u1', university_id: 'kyoto_u', subjectId: 'ku_official_2', title: 'r',
  });
  await db.doc('textbook_requests/t1').set({
    requesterId: 'u1', university_id: 'kyoto_u', subjectId: 'ku_official_3', status: 'open',
  });
  console.log('fixture seeded');
  process.exit(0);
}

if (mode !== 'check') { console.error(`unknown mode ${mode}`); process.exit(1); }

const failures = [];
const eq = (label, actual, expected) => {
  if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
  else console.log(`  ok  ${label} = ${actual}`);
};

const tt = (await db.doc('user_timetables/u1').get()).data().timetable;
eq('user_timetables/u1.timetable.Mon_2', tt.Mon_2, EXPECTED.ku_official_1);
eq('user_timetables/u1.timetable.Thu_4', tt.Thu_4, EXPECTED.ku_official_2);
eq('user_timetables/u1.timetable.Tue_1 (ku_custom_ left alone)', tt.Tue_1, CUSTOM);
eq('user_timetables/u1.timetable.Wed_3 (already migrated)', tt.Wed_3, ALREADY);

eq('posts/p1.subjectId', (await db.doc('posts/p1').get()).data().subjectId, EXPECTED.ku_official_1);
eq('requests/r1.subjectId', (await db.doc('requests/r1').get()).data().subjectId, EXPECTED.ku_official_2);
eq('textbook_requests/t1.subjectId',
  (await db.doc('textbook_requests/t1').get()).data().subjectId, EXPECTED.ku_official_3);

if (failures.length > 0) {
  console.error('FAILED:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('migration assertions passed');
process.exit(0);
