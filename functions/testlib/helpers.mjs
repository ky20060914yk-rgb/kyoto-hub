import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// emulators:exec sets FIRESTORE_EMULATOR_HOST; the admin SDK picks it up.
if (getApps().length === 0) initializeApp({ projectId: 'demo-fn' });
export const db = getFirestore();

let n = 0;
/** A unique id per call — tests never clean up, they just never collide. */
export const uid = (prefix = 'u') => `${prefix}${Date.now().toString(36)}${++n}`;

export const KU = (u) => ({ uid: u, token: { email: `${u}@st.kyoto-u.ac.jp`, email_verified: true } });

/** A well-formed post document (what the client creates). */
export async function seedPost(id, over = {}) {
  const authorId = over.authorId ?? 'author';
  await db.collection('posts').doc(id).set({
    authorId,
    university_id: 'kyoto_u',
    subjectId: 'c_1',
    subjectName: '線形代数',
    category: 'past_exam',
    year: 2024,
    title: 't',
    description: '',
    filePaths: [`resources/${authorId}/1_a.pdf`],
    fileNames: ['a.pdf'],
    downloadCount: 0,
    reports: [],
    created_at_ts: Timestamp.now(),
    ...over,
  });
}

/** Injectable Storage dependencies; records what was signed / removed. */
export function fakeDeps(existing = []) {
  const signed = [];
  const removed = [];
  return {
    signed,
    removed,
    sign: async (path, opts) => { signed.push({ path, opts }); return `https://signed.test/${path}`; },
    exists: async (path) => existing.includes(path),
    remove: async (path) => { removed.push(path); },
  };
}
