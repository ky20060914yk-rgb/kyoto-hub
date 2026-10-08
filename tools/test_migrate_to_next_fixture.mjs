// Fixture + assertions for migrate_to_next.mjs (run via test_migrate_to_next.sh, or with
// FIRESTORE_EMULATOR_HOST / FIREBASE_STORAGE_EMULATOR_HOST pointing at running emulators).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const projectId = 'demo-migrate';
const bucketName = 'kyodai-sns.firebasestorage.app';
initializeApp({ projectId, storageBucket: bucketName });
const db = getFirestore();
const bucket = getStorage().bucket();

const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const url = (path) => `http://${host}/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=x`;

await db.collection('courses').doc('c_1').set({ courseKey: 'kaiseki|yamada', name: '解析学' });
await bucket.file('posts/legacy/exam.pdf').save(Buffer.from('%PDF legacy'), { contentType: 'application/pdf' });
await db.collection('posts').doc('p_old').set({
  subjectId: 'c_1', category: 'past_exam', year: 2023, title: '2023期末', fileUrls: [url('posts/legacy/exam.pdf')], fileNames: ['exam.pdf'], reports: [],
});
await db.collection('posts').doc('p_reported').set({ subjectId: 'c_1', category: 'test_prep', fileUrls: [], reports: ['a', 'b', 'c'] });
await db.collection('posts').doc('p_orphan').set({ subjectId: 'gone', category: 'past_exam', fileUrls: [] });
await db.collection('requests').doc('r_old').set({ subjectId: 'c_1', title: '2022' });

const run = (...extra) => JSON.parse(execFileSync('node', ['migrate_to_next.mjs', '--project', projectId, ...extra], { env: process.env }).toString());

const dry = run();
assert.equal(dry.mode, 'dry-run');
assert.equal((await db.collection('posts').doc('p_old').get()).data().courseKey, undefined, 'dry run must not write');

const res = run('--apply');
assert.deepEqual(res.unresolved, ['posts/p_orphan']);
const p = (await db.collection('posts').doc('p_old').get()).data();
assert.equal(p.courseKey, 'kaiseki|yamada');
assert.deepEqual(p.filePaths, ['resources/p_old/0_exam.pdf']);
assert.equal(p.hidden, false);
assert.equal((await bucket.file('resources/p_old/0_exam.pdf').download())[0].toString(), '%PDF legacy');
assert.equal((await db.collection('posts').doc('p_reported').get()).data().hidden, true);
assert.equal((await db.collection('requests').doc('r_old').get()).data().courseKey, 'kaiseki|yamada');
const stats = (await db.collection('course_stats').doc('kaiseki|yamada').get()).data();
assert.equal(stats.pastExamPostCount, 1);
assert.equal(stats.resourcePostCount, 0, 'hidden posts are not counted');

const again = run('--apply');
assert.equal(again.postsSkipped, 1, 'second run skips migrated posts');
console.log('migrate_to_next: all assertions passed');
