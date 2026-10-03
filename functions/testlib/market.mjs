// Shared fixtures for the Plan 3 market tests (emulator).
import { db, uid } from './helpers.mjs';
import { emailKey } from '../lib/common.js';

export const mail = (u) => `${u}@st.kyoto-u.ac.jp`;
/** A verified market caller: identity is the mailbox (T-12). */
export const as = (u, email = mail(u)) => ({ uid: u, email });
export const keyOf = (u) => emailKey(mail(u));
export const get = (path) => db.doc(path).get();
export const NOW = new Date('2027-04-10T03:00:00Z');
export const DAY = 24 * 3600 * 1000;
export const later = (days, base = NOW) => new Date(base.getTime() + days * DAY);

/** A valid 譲る/売る/買いたい payload; `over` replaces fields. */
export const LISTING = (over = {}) => ({
  type: 'sell', title: '線形代数入門 第2版', description: '書き込みなし', condition: 'good', price: 1500,
  listPrice: 3000, place: 'clock_tower', photoPaths: [], ...over,
});

export async function seedUser(u, displayName = `京大生_${u.slice(-4)}`) {
  await db.doc(`users/${u}`).set({ uid: u, displayName, university_id: 'kyoto_u' });
  return u;
}

export async function seedCourse(id = uid('c'), name = '線形代数A') {
  await db.doc(`courses/${id}`).set({ id, name, courseKey: `${name}|教員`, university_id: 'kyoto_u' });
  return id;
}

export { db, uid };
