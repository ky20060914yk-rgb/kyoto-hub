# Phase 2A — Server-authoritative Credits & Private Resources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the client-authored point economy with a server-authoritative credit ledger (Cloud Functions), move past-exam/resource files to a private bucket served only through 10-minute signed URLs, and simplify the request board — so balances cannot be forged and files cannot be fetched by URL.

**Architecture:** A new `functions/` TypeScript codebase (Firebase Functions v2, Node 22, region `asia-east1` = the Firestore database region) owns every credit write. Pure handler functions take `(db, deps, …)` so they are unit-tested against the Firestore emulator; thin `onCall` / Firestore-trigger wrappers in `index.ts` bind them to Firebase. Balances live in `credit_balances/{uid}`, history in `credits_ledger/{ledgerId}` (deterministic ids ⇒ idempotent). Both are `write: false` to clients. Post docs are still client-created, but a trigger validates the files and grants the upload credit; downloads go through the `downloadResource` callable which charges, records, and returns a signed URL. The Flutter client stops writing points entirely and listens to `credit_balances` / `credits_ledger`.

**Tech Stack:** TypeScript 5 / Node 22 / `firebase-functions` ^7 (v2 API) / `firebase-admin` ^14 / Node's built-in `node:test` against the Firestore + Storage emulators; Flutter 3.41.9 / Dart ^3.11.5 / `cloud_functions` ^6.5; `@firebase/rules-unit-testing` for rules.

**Spec:** `docs/specs/2026-09-07-kyodai-info-redesign-design.md` §4.3 (credits, private storage, request board), §4.5.3–4.5.4 (rules, Functions), §6 Phase 2. This is **Plan 2A of 2** — Plan 2B (takedown flow, report→hide queue, notifications, `course_stats` as a Function aggregate, tightened reads) is written after 2A ships, exactly as Plan B waited on Plan A.

## Global Constraints

- Flutter `3.41.9`, Dart `^3.11.5`. The ONLY new Dart dependency this plan may add is `cloud_functions`. Functions: Node `22`, TypeScript, `firebase-functions/v2/*` only (no v1), region **`asia-east1`** on every function.
- Credit amounts (spec §4.3, verbatim): signup **+3**; download **−1** flat (any category); upload approved **+3** (daily cap, duplicates earn nothing); first review **+2** once; own posts and posts that fulfilled your request are **free**. Credits are **never purchasable**.
- **Abolished** (must not survive in code, rules, or copy): 80% uploader royalty, 5-DL / 10-DL milestones, delete/report claw-back penalties, the 2020 cut-off, the uploader-set 0–20pt price, the request-reward slider, the referral/invitation bonus, the 20pt textbook settlement.
- The client NEVER writes a balance or a ledger row. `credit_balances` and `credits_ledger`: `allow write: if false`. Reading is own-doc only.
- Text course reviews remain free to post and read (Phase 1 behaviour unchanged).
- Every Firestore document written by a Function carries `university_id: 'kyoto_u'`.
- `firestore.rules` stays start-anchored on the KU email pattern; the catch-all `match /{document=**} { allow read, write: if false; }` stays LAST.
- Commit scope: `functions/` (never `node_modules/` or `lib/`), `lib/`, `test/`, `tools/`, `firestore*`, `firestore-tests/`, `storage.rules`, `firebase.json`, `pubspec.*`, `docs/`. **Never** `.superpowers/`, never a service-account key.
- PowerShell 5.1 is the user's shell (no `&&`); the repo scripts run under Git Bash. Emulators need JDK 21: every `tools/test_*.sh` exports `JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"`.
- Production side effects: Claude may run `firebase deploy` (user has granted it). Anything needing the service-account key (`tools/migrate_storage.mjs`) is run by the USER.

## Rulings (the plan decides; each can be reversed cheaply — revisit at the end)

| # | Ruling | Why | Cost if wrong |
|---|---|---|---|
| P2-1 | Balances live in `credit_balances/{uid}`, not `users.credits` | `users/{uid}` is owner-writable; locking one field of it needs diff-rules gymnastics. A separate Function-only doc is simpler and provably un-forgeable | One-line move later |
| P2-2 | Referral/invitation bonus is **dropped** (UI included) | Spec's credit table has none; the old flow wrote another user's balance from the client — the exact hole being closed | Re-add as a Function later |
| P2-3 | Daily grant cap = **3 grants per JST day** (upload and request-fulfilment grants share it) | Spec says "daily cap" without a number; the old rule was 3 uploads/day | Constant in `common.ts` |
| P2-4 | A download is **unlocked once**: re-downloading the same post is free (ledger id `dl_<uid>_<postId>` is the marker) | Signed URLs expire in 10 min; charging per click would punish retries | Remove the marker check |
| P2-5 | Legacy `users.points` and `transactions` are **abandoned**; every user gets the normal +3 welcome (existing verified users claim it on next login) | ~22 test users; converting would re-introduce client-trusted data | Friends lose old points |
| P2-6 | "Upload approval" is **automatic** (trigger validates files exist + belong to the author) — no manual queue | Spec has no moderator workflow for 2A; reports/takedown are the safety net (Plan 2B) | Add a queue in 2B |
| P2-7 | **No custom claim `ku_verified`** yet; rules and Functions read `token.email` / `email_verified` directly | Works today; the claim needs a token-refresh handshake for no new protection | Add claim in 2B |
| P2-8 | Functions region = `asia-east1` | `firebase firestore:databases:get` shows the DB is `asia-east1`; Firestore triggers must be co-located | Redeploy in another region |
| P2-9 | Post docs are still **client-created** (rule-constrained); credits are granted by the `onPostCreated` trigger, which deletes the doc if its files are invalid | Smallest client change; the trigger is the authority for credits | Move create into a callable |
| P2-10 | Fulfilling a request grants the **+3 request bonus in addition to** the normal upload grant; both count toward the daily cap | Spec: upload +3 and "提供者に +3" | Merge into one grant |
| P2-11 | Report auto-delete at 3 reports stays **client-driven for now** (claw-back removed); Storage cleanup is handled by `onPostDeleted` | Spec wants hide+queue — that is Plan 2B's takedown work | n/a (2B) |

## File Structure

**Created**
- `functions/package.json`, `functions/tsconfig.json`, `functions/.gitignore` — Functions codebase scaffold
- `functions/src/common.ts` — constants (`REGION`, `CREDITS`, TTL), `requireKuVerified`, `jstDay`
- `functions/src/credits.ts` — `Balance`, `CreditEvent`, `readBalance`, `writeCredit` (the single place credit invariants live)
- `functions/src/welcome.ts` — `claimWelcome`
- `functions/src/download.ts` — `processDownload`
- `functions/src/postCreated.ts` — `handlePostCreated`
- `functions/src/reviewCreated.ts` — `handleReviewCreated`
- `functions/src/postDeleted.ts` — `handlePostDeleted`
- `functions/src/index.ts` — `onCall` / trigger wrappers + real Storage deps
- `functions/testlib/helpers.mjs`, `functions/test/*.test.mjs` — emulator-backed tests
- `storage.rules`, `firestore-tests/storage.test.mjs`
- `tools/test_functions.sh`, `tools/test_storage_rules.sh`, `tools/migrate_storage.mjs`, `tools/test_migrate_storage.sh`, `tools/test_migrate_storage_fixture.mjs`
- `lib/models/credit_ledger_entry.dart`, `lib/services/credit_service.dart`
- `test/models/credit_ledger_entry_test.dart`, `test/services/credit_service_test.dart`

**Modified**
- `firebase.json` (functions, storage, emulators), `firestore.rules`, `firestore.indexes.json`, `firestore-tests/rules.test.mjs`, `pubspec.yaml`
- `lib/models/{post,user_profile,request}.dart`, `lib/services/{app_store,firestore_service}.dart`, `lib/main.dart`, `lib/utils/download_helper*.dart`
- `lib/views/course/course_resource_tab.dart`, `lib/views/home/home_screen.dart`, `lib/views/mypage/my_page_screen.dart`, `lib/views/auth/signup_screen.dart`, `lib/views/onboarding/onboarding_screen.dart`, `lib/views/timetable/timetable_registration_screen.dart`, `lib/views/textbook/*` (only if they reference points)

---

### Task 1: Functions scaffold + shared helpers + test harness

**Files:**
- Create: `functions/package.json`, `functions/tsconfig.json`, `functions/.gitignore`, `functions/src/common.ts`, `functions/testlib/helpers.mjs`, `functions/test/common.test.mjs`, `tools/test_functions.sh`
- Modify: `firebase.json`, `.gitignore` (add `functions/node_modules/`, `functions/lib/`)

**Interfaces:**
- Produces (`common.ts`): `REGION: 'asia-east1'`, `UNIVERSITY_ID: 'kyoto_u'`, `CREDITS` (`welcome:3, upload:3, firstReview:2, requestFulfilled:3, downloadCost:1, dailyGrantCap:3`), `SIGNED_URL_TTL_MS: number`, `interface AuthLike { uid: string; token: { email?: string; email_verified?: boolean } }`, `requireKuVerified(auth: AuthLike | undefined | null): string` (returns uid, throws `HttpsError`), `jstDay(now?: Date): string` (`YYYY-MM-DD` in JST).
- Produces (`testlib/helpers.mjs`): `db` (admin Firestore on the emulator), `uid(prefix?)` (unique id), `KU(uid)` (an `AuthLike`), `seedPost(id, over?)`, `fakeDeps(existingPaths?)` → `{ signed: [], sign, exists, remove, removed: [] }`.

- [ ] **Step 1: Create `functions/package.json`**

```json
{
  "name": "functions",
  "private": true,
  "main": "lib/index.js",
  "engines": { "node": "22" },
  "scripts": {
    "build": "tsc",
    "test": "npm run build && firebase emulators:exec --only firestore --project demo-fn \"node --test test/\""
  },
  "dependencies": {
    "firebase-admin": "^14.5.0",
    "firebase-functions": "^7.4.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.9.0"
  }
}
```

If `npm install` reports a version that does not exist, use the nearest published major (`npm view firebase-functions version`) and note it in the commit message — do not change the API style (v2).

- [ ] **Step 2: Create `functions/tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "es2022",
    "outDir": "lib",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

Relative imports in `src/` therefore end in `.js` (`import { x } from './common.js'`).

- [ ] **Step 3: Create `functions/.gitignore`**

```
node_modules/
lib/
*.log
```

And append `functions/node_modules/` and `functions/lib/` to the repo-root `.gitignore`.

- [ ] **Step 4: Extend `firebase.json`**

Add a top-level `"functions"` entry and the storage emulator port (the `"storage"` rules entry is added in Task 6, once `storage.rules` exists). Resulting additions (keep every existing key):

```json
  "functions": [
    {
      "source": "functions",
      "codebase": "default",
      "ignore": ["node_modules", ".git", "firebase-debug.log", "*.local", "test", "testlib"],
      "predeploy": ["npm --prefix \"$RESOURCE_DIR\" run build"]
    }
  ],
```

and inside `"emulators"`: `"storage": { "port": 9199 }`. (Do not run `firebase deploy` from this task on — tests only use emulators.)

- [ ] **Step 5: Install and write the failing test `functions/test/common.test.mjs`**

Run `cd functions && npm install`.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireKuVerified, jstDay, CREDITS } from '../lib/common.js';

test('requireKuVerified returns the uid for a verified KU address', () => {
  assert.equal(
    requireKuVerified({ uid: 'u1', token: { email: 'a@st.kyoto-u.ac.jp', email_verified: true } }),
    'u1',
  );
});

test('requireKuVerified is case-insensitive on the mailbox', () => {
  assert.equal(
    requireKuVerified({ uid: 'u1', token: { email: 'A@ST.KYOTO-U.AC.JP', email_verified: true } }),
    'u1',
  );
});

test('requireKuVerified rejects: no auth, unverified, outsider, spoofed domains', () => {
  const bad = [
    undefined,
    null,
    { uid: 'u', token: { email: 'a@st.kyoto-u.ac.jp', email_verified: false } },
    { uid: 'u', token: { email: 'a@gmail.com', email_verified: true } },
    { uid: 'u', token: { email: 'evil@evil.com@st.kyoto-u.ac.jp', email_verified: true } },
    { uid: 'u', token: { email: 'a@st.kyoto-u.ac.jp.attacker.com', email_verified: true } },
    { uid: 'u', token: {} },
  ];
  for (const a of bad) {
    assert.throws(() => requireKuVerified(a), (e) => ['unauthenticated', 'permission-denied'].includes(e.code));
  }
});

test('jstDay rolls over at 15:00 UTC', () => {
  assert.equal(jstDay(new Date('2026-10-03T14:59:59Z')), '2026-10-03');
  assert.equal(jstDay(new Date('2026-10-03T15:00:00Z')), '2026-10-04');
});

test('credit constants match spec §4.3', () => {
  assert.deepEqual({ ...CREDITS }, {
    welcome: 3, upload: 3, firstReview: 2, requestFulfilled: 3, downloadCost: 1, dailyGrantCap: 3,
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd functions && npm run build`
Expected: FAIL — `src/common.ts` does not exist (tsc finds no inputs / test import fails).

- [ ] **Step 7: Create `functions/src/common.ts`**

```ts
import { HttpsError } from 'firebase-functions/v2/https';

export const REGION = 'asia-east1'; // = Firestore database region (P2-8)
export const UNIVERSITY_ID = 'kyoto_u';

/** Credit amounts — spec §4.3. */
export const CREDITS = {
  welcome: 3,
  upload: 3,
  firstReview: 2,
  requestFulfilled: 3,
  downloadCost: 1,
  dailyGrantCap: 3, // grants per JST day (P2-3)
} as const;

export const SIGNED_URL_TTL_MS = 10 * 60 * 1000;

// Same shape as firestore.rules `kuVerified()` (start-anchored, single '@').
const KU_EMAIL = /^[^@]+@st\.kyoto-u\.ac\.jp$/;

export interface AuthLike {
  uid: string;
  token: { email?: string; email_verified?: boolean };
}

/** Returns the caller's uid or throws an HttpsError. */
export function requireKuVerified(auth: AuthLike | undefined | null): string {
  if (!auth) throw new HttpsError('unauthenticated', 'login required');
  const email = (auth.token.email ?? '').toLowerCase();
  if (!KU_EMAIL.test(email) || auth.token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'verified Kyoto University account required');
  }
  return auth.uid;
}

/** `YYYY-MM-DD` in Asia/Tokyo (UTC+9, no DST). */
export function jstDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
```

- [ ] **Step 8: Create `functions/testlib/helpers.mjs`**

```js
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
```

- [ ] **Step 9: Create `tools/test_functions.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
# Cloud Functions unit tests (Plan 2A). The Firestore emulator needs JDK 21+.
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
cd "$(dirname "$0")/../functions"
npm run build
firebase emulators:exec --only firestore --project demo-fn "node --test test/"
```

- [ ] **Step 10: Run to verify it passes**

Run: `bash tools/test_functions.sh`
Expected: PASS — 5 tests in `common.test.mjs`.

- [ ] **Step 11: Commit**

```bash
git add functions/package.json functions/package-lock.json functions/tsconfig.json functions/.gitignore functions/src/common.ts functions/testlib functions/test/common.test.mjs tools/test_functions.sh firebase.json .gitignore
git commit -m "feat(functions): scaffold Functions codebase, shared auth/credit constants, emulator test harness"
```

---

### Task 2: Credit ledger core + welcome grant

**Files:**
- Create: `functions/src/credits.ts`, `functions/src/welcome.ts`, `functions/test/credits.test.mjs`

**Interfaces:**
- Consumes: `UNIVERSITY_ID`, `CREDITS` from `common.ts`.
- Produces (`credits.ts`):
  - `interface Balance { balance: number; welcomeGranted?: boolean; firstReviewGranted?: boolean; uploadGrantDay?: string; uploadGrantsToday?: number }`
  - `interface CreditEvent { uid: string; delta: number; reason: string; ledgerId: string; refId?: string }`
  - `balanceRef(db, uid)`, `ledgerRef(db, ledgerId)` → DocumentReference
  - `readBalance(tx, db, uid): Promise<Balance>` (a missing doc reads as `{ balance: 0 }`)
  - `writeCredit(tx, db, ev, cur, patch?): Balance` — **the only function that writes a balance/ledger row.** Throws `HttpsError('failed-precondition', 'insufficient-credits')` if the result would be negative. Callers must have done ALL reads first.
- Produces (`welcome.ts`): `claimWelcome(db, uid): Promise<{ granted: boolean; balance: number }>`.

- [ ] **Step 1: Write the failing tests `functions/test/credits.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, uid } from '../testlib/helpers.mjs';
import { claimWelcome } from '../lib/welcome.js';
import { readBalance, writeCredit } from '../lib/credits.js';

test('claimWelcome grants +3 once and records a ledger row', async () => {
  const u = uid();
  assert.deepEqual(await claimWelcome(db, u), { granted: true, balance: 3 });
  assert.deepEqual(await claimWelcome(db, u), { granted: false, balance: 3 });

  const led = await db.collection('credits_ledger').doc(`signup_${u}`).get();
  assert.equal(led.get('delta'), 3);
  assert.equal(led.get('balanceAfter'), 3);
  assert.equal(led.get('uid'), u);
  assert.equal(led.get('reason'), 'signup_bonus');
  assert.equal(led.get('university_id'), 'kyoto_u');
  assert.equal((await db.collection('credits_ledger').where('uid', '==', u).get()).size, 1);
});

test('concurrent claims grant exactly once', async () => {
  const u = uid();
  const rs = await Promise.all([claimWelcome(db, u), claimWelcome(db, u), claimWelcome(db, u)]);
  assert.equal(rs.filter((r) => r.granted).length, 1);
  assert.equal((await db.collection('credit_balances').doc(u).get()).get('balance'), 3);
});

test('balance doc carries university_id and the welcome flag', async () => {
  const u = uid();
  await claimWelcome(db, u);
  const b = await db.collection('credit_balances').doc(u).get();
  assert.equal(b.get('university_id'), 'kyoto_u');
  assert.equal(b.get('welcomeGranted'), true);
});

test('writeCredit refuses to take the balance below zero and writes nothing', async () => {
  const u = uid();
  await assert.rejects(
    db.runTransaction(async (tx) => {
      const cur = await readBalance(tx, db, u);
      writeCredit(tx, db, { uid: u, delta: -1, reason: 'download', ledgerId: `x_${u}` }, cur);
    }),
    (e) => e.code === 'failed-precondition' && /insufficient-credits/.test(e.message),
  );
  assert.equal((await db.collection('credit_balances').doc(u).get()).exists, false);
  assert.equal((await db.collection('credits_ledger').doc(`x_${u}`).get()).exists, false);
});

test('readBalance treats a missing doc as zero', async () => {
  const u = uid();
  const cur = await db.runTransaction((tx) => readBalance(tx, db, u));
  assert.deepEqual(cur, { balance: 0 });
});

test('writeCredit merges a patch into the balance doc without losing other fields', async () => {
  const u = uid();
  await claimWelcome(db, u); // welcomeGranted: true, balance 3
  await db.runTransaction(async (tx) => {
    const cur = await readBalance(tx, db, u);
    writeCredit(tx, db, { uid: u, delta: 2, reason: 'first_review', ledgerId: `fr_${u}` }, cur,
      { firstReviewGranted: true });
  });
  const b = await db.collection('credit_balances').doc(u).get();
  assert.equal(b.get('balance'), 5);
  assert.equal(b.get('welcomeGranted'), true);
  assert.equal(b.get('firstReviewGranted'), true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash tools/test_functions.sh`
Expected: FAIL — `src/credits.ts` / `src/welcome.ts` missing (tsc error).

- [ ] **Step 3: Create `functions/src/credits.ts`**

```ts
import { FieldValue, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { UNIVERSITY_ID } from './common.js';

export interface Balance {
  balance: number;
  welcomeGranted?: boolean;
  firstReviewGranted?: boolean;
  uploadGrantDay?: string; // JST day of the last capped grant
  uploadGrantsToday?: number; // grants already issued on that day
}

export interface CreditEvent {
  uid: string;
  delta: number;
  reason: string; // signup_bonus | download | download_free | upload | first_review | request_fulfilled
  ledgerId: string; // deterministic => the caller can make the grant idempotent
  refId?: string; // postId / requestId the event is about
}

export const balanceRef = (db: Firestore, uid: string): DocumentReference =>
  db.collection('credit_balances').doc(uid);

export const ledgerRef = (db: Firestore, ledgerId: string): DocumentReference =>
  db.collection('credits_ledger').doc(ledgerId);

export async function readBalance(tx: Transaction, db: Firestore, uid: string): Promise<Balance> {
  const snap = await tx.get(balanceRef(db, uid));
  const d = (snap.exists ? snap.data() : {}) as Partial<Balance>;
  return { ...d, balance: Number.isInteger(d.balance) ? (d.balance as number) : 0 };
}

/**
 * The ONLY writer of `credit_balances` / `credits_ledger`. Updates the balance
 * and appends one ledger row in the caller's transaction. Every read the
 * transaction needs must already have happened (Firestore forbids read-after-
 * write). Throws if the new balance would be negative.
 */
export function writeCredit(
  tx: Transaction,
  db: Firestore,
  ev: CreditEvent,
  cur: Balance,
  patch: Partial<Balance> = {},
): Balance {
  const next: Balance = { ...cur, ...patch, balance: cur.balance + ev.delta };
  if (next.balance < 0) throw new HttpsError('failed-precondition', 'insufficient-credits');
  tx.set(balanceRef(db, ev.uid), { ...next, university_id: UNIVERSITY_ID });
  tx.create(ledgerRef(db, ev.ledgerId), {
    uid: ev.uid,
    delta: ev.delta,
    reason: ev.reason,
    refId: ev.refId ?? null,
    balanceAfter: next.balance,
    createdAt: FieldValue.serverTimestamp(),
    university_id: UNIVERSITY_ID,
  });
  return next;
}
```

- [ ] **Step 4: Create `functions/src/welcome.ts`**

```ts
import type { Firestore } from 'firebase-admin/firestore';
import { CREDITS } from './common.js';
import { readBalance, writeCredit } from './credits.js';

/** One-time welcome grant. Idempotent: the flag lives on the balance doc. */
export async function claimWelcome(
  db: Firestore,
  uid: string,
): Promise<{ granted: boolean; balance: number }> {
  return db.runTransaction(async (tx) => {
    const cur = await readBalance(tx, db, uid);
    if (cur.welcomeGranted) return { granted: false, balance: cur.balance };
    const next = writeCredit(
      tx,
      db,
      { uid, delta: CREDITS.welcome, reason: 'signup_bonus', ledgerId: `signup_${uid}` },
      cur,
      { welcomeGranted: true },
    );
    return { granted: true, balance: next.balance };
  });
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `bash tools/test_functions.sh`
Expected: PASS — 5 (common) + 6 (credits) tests.

- [ ] **Step 6: Commit**

```bash
git add functions/src/credits.ts functions/src/welcome.ts functions/test/credits.test.mjs
git commit -m "feat(functions): credit ledger core (writeCredit) and idempotent welcome grant"
```

---

### Task 3: `downloadResource` — charge, record, sign

**Files:**
- Create: `functions/src/download.ts`, `functions/test/download.test.mjs`

**Interfaces:**
- Consumes: `CREDITS`, `SIGNED_URL_TTL_MS` (common); `readBalance`, `writeCredit`, `ledgerRef` (credits); test helpers `db`, `uid`, `seedPost`, `fakeDeps`.
- Produces: `interface DownloadDeps { sign(path: string, opts: { filename: string; expiresMs: number }): Promise<string> }`, `interface DownloadResult { url: string; charged: boolean; balance: number }`, `processDownload(db, deps, uid, input: { postId: string; fileIndex?: number }): Promise<DownloadResult>`.

Behaviour: post must exist (`not-found`); `fileIndex` (default 0) must index `post.filePaths` (`invalid-argument`). **Free** if `post.authorId === uid` OR the caller authored a request whose `fulfilledPostId` is this post. If the ledger row `dl_<uid>_<postId>` already exists the post is already unlocked (P2-4): no charge, no new row, no count bump. Otherwise one transaction: ledger row (`-1` reason `download`, or `0` reason `download_free`), balance −1, and `downloadCount +1` when the caller is not the author. The signed URL is created AFTER the transaction commits.

- [ ] **Step 1: Write the failing tests `functions/test/download.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, uid, seedPost, fakeDeps } from '../testlib/helpers.mjs';
import { claimWelcome } from '../lib/welcome.js';
import { processDownload } from '../lib/download.js';

const withCredits = async () => { const u = uid(); await claimWelcome(db, u); return u; }; // balance 3
const bal = async (u) => (await db.collection('credit_balances').doc(u).get()).get('balance');

test('a paid download charges 1 credit, records the ledger, bumps the count, signs 10 min', async () => {
  const u = await withCredits(); const pid = uid('p');
  await seedPost(pid);
  const deps = fakeDeps();
  const r = await processDownload(db, deps, u, { postId: pid });
  assert.deepEqual(r, { url: 'https://signed.test/resources/author/1_a.pdf', charged: true, balance: 2 });
  assert.equal(await bal(u), 2);
  const led = await db.collection('credits_ledger').doc(`dl_${u}_${pid}`).get();
  assert.equal(led.get('delta'), -1);
  assert.equal(led.get('reason'), 'download');
  assert.equal(led.get('refId'), pid);
  assert.equal((await db.collection('posts').doc(pid).get()).get('downloadCount'), 1);
  assert.deepEqual(deps.signed, [{ path: 'resources/author/1_a.pdf', opts: { filename: 'a.pdf', expiresMs: 600000 } }]);
});

test('re-downloading the same post is free and does not recount (P2-4)', async () => {
  const u = await withCredits(); const pid = uid('p');
  await seedPost(pid);
  await processDownload(db, fakeDeps(), u, { postId: pid });
  const again = await processDownload(db, fakeDeps(), u, { postId: pid });
  assert.equal(again.charged, false);
  assert.equal(again.balance, 2);
  assert.equal(await bal(u), 2);
  assert.equal((await db.collection('posts').doc(pid).get()).get('downloadCount'), 1);
  assert.equal((await db.collection('credits_ledger').where('uid', '==', u).get()).size, 2); // welcome + 1 download
});

test('insufficient credits: failed-precondition, nothing signed, nothing written', async () => {
  const u = uid(); const pid = uid('p'); // never claimed welcome -> balance 0
  await seedPost(pid);
  const deps = fakeDeps();
  await assert.rejects(processDownload(db, deps, u, { postId: pid }),
    (e) => e.code === 'failed-precondition' && /insufficient-credits/.test(e.message));
  assert.equal(deps.signed.length, 0);
  assert.equal((await db.collection('posts').doc(pid).get()).get('downloadCount'), 0);
});

test('the author downloads their own post free, without bumping the count', async () => {
  const author = uid(); const pid = uid('p');
  await seedPost(pid, { authorId: author, filePaths: [`resources/${author}/1_a.pdf`] });
  const r = await processDownload(db, fakeDeps(), author, { postId: pid });
  assert.equal(r.charged, false);
  assert.equal(r.balance, 0);
  const led = await db.collection('credits_ledger').doc(`dl_${author}_${pid}`).get();
  assert.equal(led.get('delta'), 0);
  assert.equal(led.get('reason'), 'download_free');
  assert.equal((await db.collection('posts').doc(pid).get()).get('downloadCount'), 0);
});

test('the requester whose request this post fulfilled downloads free', async () => {
  const requester = uid(); const pid = uid('p'); const rid = uid('r');
  await seedPost(pid);
  await db.collection('requests').doc(rid).set({
    authorId: requester, university_id: 'kyoto_u', isFulfilled: true, fulfilledPostId: pid,
  });
  const r = await processDownload(db, fakeDeps(), requester, { postId: pid });
  assert.equal(r.charged, false);
  assert.equal(r.balance, 0);
});

test('someone else’s fulfilled request does not make the post free for the caller', async () => {
  const u = await withCredits(); const pid = uid('p');
  await seedPost(pid);
  await db.collection('requests').doc(uid('r')).set({
    authorId: 'someone_else', university_id: 'kyoto_u', isFulfilled: true, fulfilledPostId: pid,
  });
  assert.equal((await processDownload(db, fakeDeps(), u, { postId: pid })).charged, true);
});

test('unknown post -> not-found; bad file index -> invalid-argument', async () => {
  const u = await withCredits(); const pid = uid('p');
  await assert.rejects(processDownload(db, fakeDeps(), u, { postId: 'nope' }), (e) => e.code === 'not-found');
  await seedPost(pid);
  for (const fileIndex of [-1, 1, 1.5]) {
    await assert.rejects(processDownload(db, fakeDeps(), u, { postId: pid, fileIndex }),
      (e) => e.code === 'invalid-argument');
  }
  assert.equal(await bal(u), 3); // nothing was charged
});

test('a post with no filePaths (legacy, un-migrated) is invalid-argument, not a charge', async () => {
  const u = await withCredits(); const pid = uid('p');
  await seedPost(pid, { filePaths: [] });
  await assert.rejects(processDownload(db, fakeDeps(), u, { postId: pid }), (e) => e.code === 'invalid-argument');
  assert.equal(await bal(u), 3);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash tools/test_functions.sh`
Expected: FAIL — `src/download.ts` missing.

- [ ] **Step 3: Create `functions/src/download.ts`**

```ts
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { CREDITS, SIGNED_URL_TTL_MS } from './common.js';
import { ledgerRef, readBalance, writeCredit } from './credits.js';

export interface DownloadDeps {
  sign(path: string, opts: { filename: string; expiresMs: number }): Promise<string>;
}
export interface DownloadResult { url: string; charged: boolean; balance: number }

export async function processDownload(
  db: Firestore,
  deps: DownloadDeps,
  uid: string,
  input: { postId: string; fileIndex?: number },
): Promise<DownloadResult> {
  const postRef = db.collection('posts').doc(input.postId);
  const post = (await postRef.get()).data();
  if (!post) throw new HttpsError('not-found', 'post not found');

  const paths: string[] = Array.isArray(post.filePaths) ? post.filePaths : [];
  const idx = input.fileIndex ?? 0;
  if (!Number.isInteger(idx) || idx < 0 || idx >= paths.length) {
    throw new HttpsError('invalid-argument', 'bad file index');
  }

  const isAuthor = post.authorId === uid;
  let free = isAuthor;
  if (!free) {
    const fulfilled = await db.collection('requests')
      .where('fulfilledPostId', '==', input.postId)
      .where('authorId', '==', uid)
      .limit(1)
      .get();
    free = !fulfilled.empty;
  }

  const ledgerId = `dl_${uid}_${input.postId}`;
  const outcome = await db.runTransaction(async (tx) => {
    const led = await tx.get(ledgerRef(db, ledgerId));
    const cur = await readBalance(tx, db, uid);
    if (led.exists) return { charged: false, balance: cur.balance }; // already unlocked (P2-4)
    const delta = free ? 0 : -CREDITS.downloadCost;
    const next = writeCredit(
      tx, db,
      { uid, delta, reason: free ? 'download_free' : 'download', ledgerId, refId: input.postId },
      cur,
    );
    if (!isAuthor) tx.update(postRef, { downloadCount: FieldValue.increment(1) });
    return { charged: !free, balance: next.balance };
  });

  const names: string[] = Array.isArray(post.fileNames) ? post.fileNames : [];
  const filename = names[idx] ?? paths[idx].split('/').pop() ?? 'download';
  const url = await deps.sign(paths[idx], { filename, expiresMs: SIGNED_URL_TTL_MS });
  return { url, ...outcome };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash tools/test_functions.sh`
Expected: PASS — all prior tests + 8 new.

- [ ] **Step 5: Commit**

```bash
git add functions/src/download.ts functions/test/download.test.mjs
git commit -m "feat(functions): downloadResource — charge once, ledger, 10-minute signed URL"
```

---

### Task 4: Triggers (post created / review created / post deleted) + `index.ts`

**Files:**
- Create: `functions/src/postCreated.ts`, `functions/src/reviewCreated.ts`, `functions/src/postDeleted.ts`, `functions/src/index.ts`, `functions/test/postCreated.test.mjs`, `functions/test/reviewCreated.test.mjs`, `functions/test/postDeleted.test.mjs`

**Interfaces:**
- Consumes: `CREDITS`, `jstDay`, `REGION`, `requireKuVerified` (common); `readBalance`, `writeCredit`, `ledgerRef` (credits); `claimWelcome`; `processDownload`.
- Produces:
  - `interface PostDeps { exists(path: string): Promise<boolean> }`
  - `interface PostCreatedResult { valid: boolean; duplicate: boolean; granted: number; capped: boolean; fulfilled: boolean }`
  - `handlePostCreated(db, deps: PostDeps, postId: string, now?: Date): Promise<PostCreatedResult>`
  - `handleReviewCreated(db, authorId: string): Promise<boolean>` (true = bonus granted)
  - `interface DeleteDeps { remove(path: string): Promise<void> }`, `handlePostDeleted(deps, post: Record<string, unknown>): Promise<string[]>` (returns removed paths)
  - Exported Firebase functions: `claimWelcomeCredits`, `downloadResource` (callables), `onPostCreated`, `onReviewCreated`, `onPostDeleted` (triggers).

**Security invariant (must be tested):** `handlePostDeleted` deletes ONLY paths under `resources/<post.authorId>/`. `handlePostCreated` deletes an invalid post — which fires `onPostDeleted` — so without this filter a post whose `filePaths` point at another user's file could get that file deleted.

- [ ] **Step 1: Write the failing tests `functions/test/postCreated.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { db, uid, seedPost, fakeDeps } from '../testlib/helpers.mjs';
import { handlePostCreated } from '../lib/postCreated.js';

const bal = async (u) => (await db.collection('credit_balances').doc(u).get()).get('balance') ?? 0;
const mk = async (over = {}) => {
  const a = uid('a'); const id = uid('p');
  const path = `resources/${a}/1_a.pdf`;
  await seedPost(id, { authorId: a, filePaths: [path], subjectId: uid('c'), ...over });
  return { a, id, path };
};

test('a valid past-exam upload earns +3 and a ledger row', async () => {
  const { a, id, path } = await mk();
  const r = await handlePostCreated(db, fakeDeps([path]), id);
  assert.deepEqual(r, { valid: true, duplicate: false, granted: 3, capped: false, fulfilled: false });
  assert.equal(await bal(a), 3);
  const led = await db.collection('credits_ledger').doc(`upload_${id}`).get();
  assert.equal(led.get('delta'), 3);
  assert.equal(led.get('reason'), 'upload');
});

test('replaying the trigger for the same post grants only once', async () => {
  const { a, id, path } = await mk();
  await handlePostCreated(db, fakeDeps([path]), id);
  const again = await handlePostCreated(db, fakeDeps([path]), id);
  assert.equal(again.granted, 0);
  assert.equal(await bal(a), 3);
});

test('a missing file invalidates the post: the doc is deleted, no credit', async () => {
  const { a, id } = await mk();
  const r = await handlePostCreated(db, fakeDeps([]), id);
  assert.equal(r.valid, false);
  assert.equal((await db.collection('posts').doc(id).get()).exists, false);
  assert.equal(await bal(a), 0);
});

test('a path under another user’s prefix invalidates the post', async () => {
  const { a, id } = await mk({ filePaths: ['resources/victim/1_secret.pdf'] });
  const r = await handlePostCreated(db, fakeDeps(['resources/victim/1_secret.pdf']), id);
  assert.equal(r.valid, false);
  assert.equal((await db.collection('posts').doc(id).get()).exists, false);
  assert.equal(await bal(a), 0);
});

test('empty or oversized filePaths are invalid', async () => {
  for (const filePaths of [[], Array.from({ length: 6 }, (_, i) => `x${i}`), 'not-a-list']) {
    const { id } = await mk({ filePaths });
    assert.equal((await handlePostCreated(db, fakeDeps(), id)).valid, false);
  }
});

test('a duplicate past exam (same course+year, earlier post exists) earns nothing but is kept', async () => {
  const subjectId = uid('c');
  const first = await mk({ subjectId, created_at_ts: Timestamp.fromMillis(1_000) });
  const second = await mk({ subjectId, created_at_ts: Timestamp.fromMillis(2_000) });
  const r = await handlePostCreated(db, fakeDeps([second.path]), second.id);
  assert.equal(r.duplicate, true);
  assert.equal(r.granted, 0);
  assert.equal((await db.collection('posts').doc(second.id).get()).exists, true);
  assert.equal(await bal(second.a), 0);
  // the original is not a duplicate of the later one
  assert.equal((await handlePostCreated(db, fakeDeps([first.path]), first.id)).duplicate, false);
});

test('non-past-exam categories are never deduplicated', async () => {
  const subjectId = uid('c');
  await mk({ subjectId, category: 'test_prep', year: null, created_at_ts: Timestamp.fromMillis(1_000) });
  const second = await mk({ subjectId, category: 'test_prep', year: null, created_at_ts: Timestamp.fromMillis(2_000) });
  const r = await handlePostCreated(db, fakeDeps([second.path]), second.id);
  assert.equal(r.duplicate, false);
  assert.equal(r.granted, 3);
});

test('daily cap: the 4th grant on a JST day is capped, the next day grants again (P2-3)', async () => {
  const a = uid('a');
  const day1 = new Date('2026-10-03T03:00:00Z'); // 12:00 JST Oct 3
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const id = uid('p'); ids.push(id);
    const path = `resources/${a}/${i}_a.pdf`;
    await seedPost(id, { authorId: a, filePaths: [path], subjectId: uid('c') });
    const r = await handlePostCreated(db, fakeDeps([path]), id, day1);
    assert.equal(r.granted, i < 3 ? 3 : 0);
    assert.equal(r.capped, i >= 3);
  }
  assert.equal(await bal(a), 9);
  const id5 = uid('p'); const p5 = `resources/${a}/5_a.pdf`;
  await seedPost(id5, { authorId: a, filePaths: [p5], subjectId: uid('c') });
  const r5 = await handlePostCreated(db, fakeDeps([p5]), id5, new Date('2026-10-03T16:00:00Z')); // 01:00 JST Oct 4
  assert.equal(r5.granted, 3);
  assert.equal(await bal(a), 12);
});

test('fulfilling someone else’s request marks it solved and pays +3 on top of the upload (P2-10)', async () => {
  const requester = uid('q'); const rid = uid('r');
  await db.collection('requests').doc(rid).set({
    authorId: requester, university_id: 'kyoto_u', isFulfilled: false, fulfilledPostId: null,
  });
  const { a, id, path } = await mk({ requestId: rid });
  const r = await handlePostCreated(db, fakeDeps([path]), id);
  assert.equal(r.fulfilled, true);
  assert.equal(r.granted, 6);
  assert.equal(await bal(a), 6);
  const req = await db.collection('requests').doc(rid).get();
  assert.equal(req.get('isFulfilled'), true);
  assert.equal(req.get('fulfilledPostId'), id);
  assert.equal((await db.collection('credits_ledger').doc(`fulfill_${rid}`).get()).get('reason'), 'request_fulfilled');
});

test('you cannot fulfil your own request, nor one that is already solved', async () => {
  const a = uid('a');
  const own = uid('r'); const done = uid('r');
  await db.collection('requests').doc(own).set({ authorId: a, university_id: 'kyoto_u', isFulfilled: false });
  await db.collection('requests').doc(done).set({ authorId: 'other', university_id: 'kyoto_u', isFulfilled: true, fulfilledPostId: 'earlier' });
  for (const requestId of [own, done]) {
    const id = uid('p'); const path = `resources/${a}/${requestId}.pdf`;
    await seedPost(id, { authorId: a, filePaths: [path], subjectId: uid('c'), requestId });
    const r = await handlePostCreated(db, fakeDeps([path]), id);
    assert.equal(r.fulfilled, false);
  }
  assert.equal((await db.collection('requests').doc(own).get()).get('isFulfilled'), false);
  assert.equal((await db.collection('requests').doc(done).get()).get('fulfilledPostId'), 'earlier');
});
```

- [ ] **Step 2: Write `functions/test/reviewCreated.test.mjs` and `functions/test/postDeleted.test.mjs`**

```js
// reviewCreated.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, uid } from '../testlib/helpers.mjs';
import { handleReviewCreated } from '../lib/reviewCreated.js';

const bal = async (u) => (await db.collection('credit_balances').doc(u).get()).get('balance') ?? 0;

test('the first review earns +2, later reviews earn nothing', async () => {
  const u = uid();
  assert.equal(await handleReviewCreated(db, u), true);
  assert.equal(await bal(u), 2);
  assert.equal(await handleReviewCreated(db, u), false);
  assert.equal(await bal(u), 2);
  const led = await db.collection('credits_ledger').doc(`firstreview_${u}`).get();
  assert.equal(led.get('delta'), 2);
  assert.equal(led.get('reason'), 'first_review');
});

test('an empty author id grants nothing', async () => {
  assert.equal(await handleReviewCreated(db, ''), false);
});
```

```js
// postDeleted.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDeps } from '../testlib/helpers.mjs';
import { handlePostDeleted } from '../lib/postDeleted.js';

test('removes the author’s own files', async () => {
  const deps = fakeDeps();
  const removed = await handlePostDeleted(deps, { authorId: 'u1', filePaths: ['resources/u1/a.pdf', 'resources/u1/b.png'] });
  assert.deepEqual(removed, ['resources/u1/a.pdf', 'resources/u1/b.png']);
  assert.deepEqual(deps.removed, removed);
});

test('NEVER removes a path outside the author’s prefix (cross-user delete guard)', async () => {
  const deps = fakeDeps();
  const removed = await handlePostDeleted(deps, {
    authorId: 'attacker',
    filePaths: ['resources/victim/secret.pdf', 'resources/attacker/own.pdf', 'other/place.pdf', 42],
  });
  assert.deepEqual(removed, ['resources/attacker/own.pdf']);
  assert.deepEqual(deps.removed, ['resources/attacker/own.pdf']);
});

test('a missing authorId or non-list filePaths removes nothing and does not throw', async () => {
  const deps = fakeDeps();
  assert.deepEqual(await handlePostDeleted(deps, { filePaths: ['resources//x.pdf'] }), []);
  assert.deepEqual(await handlePostDeleted(deps, { authorId: 'u1', filePaths: 'nope' }), []);
  assert.deepEqual(deps.removed, []);
});

test('a failing remove (already gone) does not stop the others', async () => {
  const removed = [];
  const deps = { remove: async (p) => { if (p.endsWith('a.pdf')) throw new Error('gone'); removed.push(p); } };
  const out = await handlePostDeleted(deps, { authorId: 'u1', filePaths: ['resources/u1/a.pdf', 'resources/u1/b.pdf'] });
  assert.deepEqual(removed, ['resources/u1/b.pdf']);
  assert.deepEqual(out, ['resources/u1/a.pdf', 'resources/u1/b.pdf']);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `bash tools/test_functions.sh`
Expected: FAIL — `postCreated` / `reviewCreated` / `postDeleted` modules missing.

- [ ] **Step 4: Create `functions/src/postCreated.ts`**

```ts
import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';
import { CREDITS, jstDay } from './common.js';
import { ledgerRef, readBalance, writeCredit } from './credits.js';

export interface PostDeps { exists(path: string): Promise<boolean> }
export interface PostCreatedResult {
  valid: boolean; duplicate: boolean; granted: number; capped: boolean; fulfilled: boolean;
}

const INVALID: PostCreatedResult = { valid: false, duplicate: false, granted: 0, capped: false, fulfilled: false };
const tsMillis = (d: DocumentSnapshot): number => d.get('created_at_ts')?.toMillis?.() ?? 0;

/**
 * Validates a freshly created post and pays the upload credit. The doc is
 * client-created (P2-9) so this is where the server decides it is real: every
 * file must live under the author's own prefix AND exist. An invalid post is
 * deleted (its `onPostDeleted` cleanup is prefix-guarded — see postDeleted.ts).
 */
export async function handlePostCreated(
  db: Firestore,
  deps: PostDeps,
  postId: string,
  now: Date = new Date(),
): Promise<PostCreatedResult> {
  const ref = db.collection('posts').doc(postId);
  const snap = await ref.get();
  const post = snap.data();
  if (!post) return INVALID;

  const authorId = String(post.authorId ?? '');
  const paths: unknown = post.filePaths;
  const prefix = `resources/${authorId}/`;
  const wellFormed = authorId !== '' && Array.isArray(paths) && paths.length >= 1 && paths.length <= 5 &&
    paths.every((p) => typeof p === 'string' && p.startsWith(prefix) && p.length > prefix.length);
  const present = wellFormed && (await Promise.all((paths as string[]).map((p) => deps.exists(p)))).every(Boolean);
  if (!present) {
    await ref.delete();
    return INVALID;
  }

  // Duplicate past exam: same course + year + category already exists from an
  // earlier post (ties broken by id so two simultaneous uploads pay only one).
  let duplicate = false;
  if (post.category === 'past_exam' && Number.isInteger(post.year)) {
    const same = await db.collection('posts')
      .where('subjectId', '==', post.subjectId)
      .where('category', '==', 'past_exam')
      .where('year', '==', post.year)
      .get();
    const mine = tsMillis(snap);
    duplicate = same.docs.some((d) => {
      if (d.id === postId) return false;
      const theirs = tsMillis(d);
      return theirs < mine || (theirs === mine && d.id < postId);
    });
  }

  const requestId = typeof post.requestId === 'string' && post.requestId !== '' ? post.requestId : null;

  const out = await db.runTransaction(async (tx) => {
    const reqRef = requestId ? db.collection('requests').doc(requestId) : null;
    const reqSnap = reqRef ? await tx.get(reqRef) : null;
    const upLed = await tx.get(ledgerRef(db, `upload_${postId}`));
    const fuLed = requestId ? await tx.get(ledgerRef(db, `fulfill_${requestId}`)) : null;
    let cur = await readBalance(tx, db, authorId);

    const day = jstDay(now);
    let used = cur.uploadGrantDay === day ? cur.uploadGrantsToday ?? 0 : 0;
    let granted = 0;
    let capped = false;
    let fulfilled = false;
    const grant = (delta: number, reason: string, ledgerId: string, refId: string) => {
      if (used >= CREDITS.dailyGrantCap) { capped = true; return; }
      used += 1;
      cur = writeCredit(tx, db, { uid: authorId, delta, reason, ledgerId, refId }, cur,
        { uploadGrantDay: day, uploadGrantsToday: used });
      granted += delta;
    };

    if (reqRef && reqSnap?.exists) {
      const r = reqSnap.data()!;
      if (r.isFulfilled !== true && r.authorId !== authorId && !fuLed?.exists) {
        tx.update(reqRef, { isFulfilled: true, fulfilledPostId: postId });
        fulfilled = true; // the requester gets their free download even if the credit is capped
        grant(CREDITS.requestFulfilled, 'request_fulfilled', `fulfill_${requestId}`, requestId!);
      }
    }
    if (!duplicate && !upLed.exists) grant(CREDITS.upload, 'upload', `upload_${postId}`, postId);
    return { granted, capped, fulfilled };
  });

  return { valid: true, duplicate, ...out };
}
```

- [ ] **Step 5: Create `functions/src/reviewCreated.ts` and `functions/src/postDeleted.ts`**

```ts
// reviewCreated.ts
import type { Firestore } from 'firebase-admin/firestore';
import { CREDITS } from './common.js';
import { readBalance, writeCredit } from './credits.js';

/** +2 once per user, on their first review (the flag survives delete + re-post). */
export async function handleReviewCreated(db: Firestore, authorId: string): Promise<boolean> {
  if (!authorId) return false;
  return db.runTransaction(async (tx) => {
    const cur = await readBalance(tx, db, authorId);
    if (cur.firstReviewGranted) return false;
    writeCredit(
      tx, db,
      { uid: authorId, delta: CREDITS.firstReview, reason: 'first_review', ledgerId: `firstreview_${authorId}` },
      cur,
      { firstReviewGranted: true },
    );
    return true;
  });
}
```

```ts
// postDeleted.ts
export interface DeleteDeps { remove(path: string): Promise<void> }

/**
 * Deletes a removed post's files. SECURITY: only paths under the post's OWN
 * author prefix are touched. `handlePostCreated` deletes invalid posts, so a
 * post whose `filePaths` point at someone else's file must never be able to
 * make this trigger delete that file.
 */
export async function handlePostDeleted(
  deps: DeleteDeps,
  post: Record<string, unknown>,
): Promise<string[]> {
  const authorId = String(post.authorId ?? '');
  const prefix = `resources/${authorId}/`;
  const paths = !authorId || !Array.isArray(post.filePaths)
    ? []
    : post.filePaths.filter((p): p is string => typeof p === 'string' && p.startsWith(prefix));
  for (const p of paths) {
    try { await deps.remove(p); } catch { /* already gone */ }
  }
  return paths;
}
```

- [ ] **Step 6: Create `functions/src/index.ts`**

```ts
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onCall } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { REGION, requireKuVerified } from './common.js';
import { claimWelcome } from './welcome.js';
import { processDownload } from './download.js';
import { handlePostCreated } from './postCreated.js';
import { handleReviewCreated } from './reviewCreated.js';
import { handlePostDeleted } from './postDeleted.js';

initializeApp();
const db = getFirestore();
const bucket = () => getStorage().bucket();

// Real Storage-backed implementations of the injected dependencies.
const storageDeps = {
  sign: async (path: string, o: { filename: string; expiresMs: number }) => {
    const [url] = await bucket().file(path).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + o.expiresMs,
      responseDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(o.filename)}`,
    });
    return url;
  },
  exists: async (path: string) => (await bucket().file(path).exists())[0],
  remove: async (path: string) => { await bucket().file(path).delete({ ignoreNotFound: true }); },
};

const opts = { region: REGION, maxInstances: 10 } as const; // cost guard

export const claimWelcomeCredits = onCall(opts, async (req) =>
  claimWelcome(db, requireKuVerified(req.auth)));

export const downloadResource = onCall(opts, async (req) =>
  processDownload(db, storageDeps, requireKuVerified(req.auth), {
    postId: String(req.data?.postId ?? ''),
    fileIndex: req.data?.fileIndex === undefined ? undefined : Number(req.data.fileIndex),
  }));

export const onPostCreated = onDocumentCreated({ ...opts, document: 'posts/{postId}' }, async (event) => {
  await handlePostCreated(db, storageDeps, event.params.postId);
});

export const onReviewCreated = onDocumentCreated({ ...opts, document: 'reviews/{reviewId}' }, async (event) => {
  await handleReviewCreated(db, String(event.data?.data()?.authorId ?? ''));
});

export const onPostDeleted = onDocumentDeleted({ ...opts, document: 'posts/{postId}' }, async (event) => {
  const data = event.data?.data();
  if (data) await handlePostDeleted(storageDeps, data);
});
```

If the installed `firebase-functions` major renamed any of these symbols, adapt the imports (`firebase-functions/v2/https`, `/v2/firestore`) — the handlers under test do not depend on them. `npm run build` must be clean.

- [ ] **Step 7: Run to verify it passes**

Run: `bash tools/test_functions.sh`
Expected: PASS — common 5 + credits 6 + download 8 + postCreated 10 + reviewCreated 2 + postDeleted 4. `tsc` clean (it also type-checks `index.ts`).

- [ ] **Step 8: Commit**

```bash
git add functions/src functions/test
git commit -m "feat(functions): post/review/delete triggers and the Firebase entry points"
```

---

### Task 5: Firestore rules + index + rules tests (credits are Function-only)

**Files:**
- Modify: `firestore.rules`, `firestore.indexes.json`, `firestore-tests/rules.test.mjs`

**Interfaces:**
- Produces (rules): `credit_balances/{uid}` (own read, no client write), `credits_ledger/{id}` (own read by `uid` field, no client write); `posts` create requires server-checkable shape and forbids client-set `downloadCount`; post update loses the downloader carve-out and the author may not touch `reports`/`downloadCount`/`filePaths`; `requests` loses the fulfiller carve-out, the author may not touch `isFulfilled`/`fulfilledPostId`, create pins `isFulfilled == false` and zero cost/reward; `transactions` client create is forbidden.
- Produces (index): `credits_ledger` composite `uid ASC, createdAt DESC` (the client ledger stream).

- [ ] **Step 1: Update the tests first — `firestore-tests/rules.test.mjs`**

1a. Add fixtures near the other fixtures:

```js
// What `Post.toMap()` emits after Plan 2A: private storage paths, no price.
const validPost = (over = {}) => ({
  id: 'p_new', university_id: 'kyoto_u', authorId: 'u1', authorName: 'me',
  subjectId: 'c_1', subjectName: '線形代数', category: 'past_exam', year: 2024,
  title: 't', description: '', fileNames: ['a.pdf'],
  filePaths: ['resources/u1/1_a.pdf'], downloadCount: 0, reports: [],
  createdAt: '2026-09-01T00:00:00.000',
  ...over,
});
```

1b. Seed (in `beforeEach`'s `withSecurityRulesDisabled`) two fixtures used below:

```js
    await setDoc(doc(db, 'credit_balances/u1'), { balance: 3, university_id: 'kyoto_u' });
    await setDoc(doc(db, 'credits_ledger/signup_u1'), {
      uid: 'u1', delta: 3, reason: 'signup_bonus', balanceAfter: 3, university_id: 'kyoto_u',
    });
    await setDoc(doc(db, 'requests/req_self'), {
      authorId: 'u1', university_id: 'kyoto_u', title: 'r', isFulfilled: false, fulfilledPostId: null,
    });
```

1c. **Edit the existing post-create tests** (`'verified KU user can create a post they author'`, the unverified / non-KU / spoof / upper-case / `'cannot create a post attributed to someone else'` ones): every create payload becomes `validPost({...})` (override `authorId` only where the test is about authorship). Their pass/fail expectations do not change.

1d. **Delete** the four I5 tests (`'a downloader may increment downloadCount by exactly one (I5)'`, `'a downloader cannot jump downloadCount (I5)'`, `'a downloader cannot un-flip a reward flag (I5)'`, `'the download-counter carve-out does not smuggle other fields (I5)'`) and the two fixtures `posts/dl_u1`, `posts/dl_rewarded_u1`. Replace with:

```js
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
```

1e. **Replace the whole requests-fulfilment block** (`'a fulfiller may mark a request solved…'` through `'an outsider cannot land the full-document fulfilment write (I4)'`) with:

```js
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
```

Also change `fullRequest`'s defaults to `costSpent: 0, rewardPoints: 0`. In `'requests: verified author only for create, author only for update/delete'` the create payload (`{authorId, university_id, title}`) is still valid (the rule uses `.get(…, 0)` defaults) — leave it.

1f. **Edit the transactions block:** `'verified KU user can create a transaction; unverified cannot'` becomes

```js
test('transactions can no longer be created by any client (ledger is server-authored)', async () => {
  await assertFails(setDoc(doc(asKu(), 'transactions/tx_new'), {
    userId: 'u1', university_id: 'kyoto_u', amount: 1, type: 'upload_reward',
  }));
});
```
(read-own and append-only tests stay.)

1g. **Add the credit-collection tests** (before the catch-all test):

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash tools/test_rules.sh`
Expected: FAIL — the new/changed tests (old rules still allow client credit writes, the downloader carve-out, etc.).

- [ ] **Step 3: Edit `firestore.rules`**

3a. `posts` — replace the `create` line and the `update` rule; keep `read` and `delete` and the long explanatory comment (update the comment to describe the new carve-outs: only `reports` remains):

```
    match /posts/{id} {
      allow read: if kuDomain();
      // Plan 2A: files live in the private bucket under resources/<uid>/. The
      // first path is checked here (rules cannot loop); the onPostCreated
      // trigger validates every path and deletes the post if any is bad.
      // `downloadCount` and `reports` cannot be pre-seeded.
      allow create: if kuVerified()
        && request.resource.data.authorId == request.auth.uid
        && request.resource.data.get('downloadCount', 0) == 0
        && request.resource.data.get('reports', []) == []
        && request.resource.data.filePaths is list
        && request.resource.data.filePaths.size() >= 1
        && request.resource.data.filePaths.size() <= 5
        && request.resource.data.filePaths[0] is string
        && request.resource.data.filePaths[0].matches('resources/' + request.auth.uid + '/.+');
      allow update: if signedIn()
        && ((resource.data.authorId == request.auth.uid
             && request.resource.data.authorId == resource.data.authorId
             && request.resource.data.university_id == resource.data.university_id
             && !request.resource.data.diff(resource.data).affectedKeys()
                  .hasAny(['reports', 'downloadCount', 'filePaths']))
            || (kuVerified()
                && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['reports'])
                && request.resource.data.reports.size()
                     == resource.data.get('reports', []).size() + 1
                && request.resource.data.reports.hasAll(resource.data.get('reports', []))
                && request.resource.data.reports.hasAny([request.auth.uid])
                && !resource.data.get('reports', []).hasAny([request.auth.uid])));
      allow delete: if signedIn()
        && (resource.data.authorId == request.auth.uid
            || (kuVerified() && resource.data.get('reports', []).size() >= 3));
    }
```

3b. `requests`:

```
    // Plan 2A: fulfilment is done by the onPostCreated trigger (Admin SDK), so
    // no client — not even the author — may write the fulfilment fields. The
    // author could otherwise point `fulfilledPostId` at any post and unlock it
    // for free. Create pins the request unfulfilled with no cost or reward.
    match /requests/{id} {
      allow read: if kuDomain();
      allow create: if kuVerified()
        && request.resource.data.authorId == request.auth.uid
        && request.resource.data.get('isFulfilled', false) == false
        && request.resource.data.get('fulfilledPostId', null) == null
        && request.resource.data.get('costSpent', 0) == 0
        && request.resource.data.get('rewardPoints', 0) == 0;
      allow update: if signedIn()
        && resource.data.authorId == request.auth.uid
        && !request.resource.data.diff(resource.data).affectedKeys()
             .hasAny(['isFulfilled', 'fulfilledPostId', 'authorId']);
      allow delete: if signedIn() && resource.data.authorId == request.auth.uid;
    }
```

3c. `transactions` — create becomes `false` (update the comment: legacy history, read-only):

```
    match /transactions/{id} {
      allow read: if signedIn() && resource.data.userId == request.auth.uid;
      allow write: if false;   // Plan 2A: legacy client-authored ledger, now read-only
    }
```

3d. Add before the catch-all:

```
    // Credits (Plan 2A). Written ONLY by Cloud Functions (Admin SDK bypasses
    // rules). A user may read their own balance and their own ledger rows; the
    // ledger query must carry `where('uid', '==', <own uid>)`.
    match /credit_balances/{uid} {
      allow read: if owns(uid);
      allow write: if false;
    }
    match /credits_ledger/{ledgerId} {
      allow read: if signedIn() && resource.data.uid == request.auth.uid;
      allow write: if false;
    }
```

- [ ] **Step 4: Add the composite index to `firestore.indexes.json`**

Append to `"indexes"`:

```json
    {
      "collectionGroup": "credits_ledger",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "uid", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
```

- [ ] **Step 5: Run to verify it passes**

Run: `bash tools/test_rules.sh`
Expected: PASS — the full rules suite (all pre-existing unrelated tests unchanged and green).

- [ ] **Step 6: Commit**

```bash
git add firestore.rules firestore.indexes.json firestore-tests/rules.test.mjs
git commit -m "feat(rules): credits are Function-only; private-file post shape; retire client fulfilment/downloader/transactions writes"
```

---

### Task 6: Storage rules (private bucket) + tests

**Files:**
- Create: `storage.rules`, `firestore-tests/storage.test.mjs`, `tools/test_storage_rules.sh`
- Modify: `firebase.json` (add `"storage": { "rules": "storage.rules" }`), `firestore-tests/package.json` (add `test:storage` script)

**Interfaces:**
- Produces: bucket policy — clients may CREATE objects under `resources/<own uid>/<file>` (verified KU, ≤ 20 MiB, `application/pdf` or `image/*`) and nothing else; NO client read, update or delete anywhere. Downloads are only via signed URLs (Admin SDK); cleanup is the `onPostDeleted` trigger.

- [ ] **Step 1: Write the failing test `firestore-tests/storage.test.mjs`**

```js
import { readFileSync } from 'node:fs';
import { test, before, after } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rules',
    storage: { rules: readFileSync('../storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  });
});
after(() => env.cleanup());

const KU = { sub: 'u1', email: 'a@st.kyoto-u.ac.jp', email_verified: true };
const KU_UNVERIFIED = { sub: 'u2', email: 'b@st.kyoto-u.ac.jp', email_verified: false };
const OUTSIDER = { sub: 'u3', email: 'c@gmail.com', email_verified: true };
const st = (uid, claims) => env.authenticatedContext(uid, claims).storage();
const bytes = new Uint8Array([1, 2, 3]);
const pdf = { contentType: 'application/pdf' };

test('a verified KU user may upload a PDF or image under their own prefix', async () => {
  await assertSucceeds(uploadBytes(ref(st('u1', KU), 'resources/u1/1_a.pdf'), bytes, pdf));
  await assertSucceeds(uploadBytes(ref(st('u1', KU), 'resources/u1/2_a.png'), bytes, { contentType: 'image/png' }));
});

test('uploads to another user’s prefix, the bucket root, or other folders are denied', async () => {
  const s = st('u1', KU);
  await assertFails(uploadBytes(ref(s, 'resources/u2/1_a.pdf'), bytes, pdf));
  await assertFails(uploadBytes(ref(s, '1_a.pdf'), bytes, pdf)); // the old public root layout
  await assertFails(uploadBytes(ref(s, 'elsewhere/u1/a.pdf'), bytes, pdf));
  await assertFails(uploadBytes(ref(s, 'resources/u1/sub/dir/a.pdf'), bytes, pdf));
});

test('unverified, outsider and anonymous users cannot upload', async () => {
  await assertFails(uploadBytes(ref(st('u2', KU_UNVERIFIED), 'resources/u2/1_a.pdf'), bytes, pdf));
  await assertFails(uploadBytes(ref(st('u3', OUTSIDER), 'resources/u3/1_a.pdf'), bytes, pdf));
  await assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(), 'resources/u1/1_a.pdf'), bytes, pdf));
});

test('only PDFs and images, at most 20 MiB', async () => {
  const s = st('u1', KU);
  await assertFails(uploadBytes(ref(s, 'resources/u1/x.exe'), bytes, { contentType: 'application/x-msdownload' }));
  await assertFails(uploadBytes(ref(s, 'resources/u1/x.html'), bytes, { contentType: 'text/html' }));
  await assertFails(uploadBytes(ref(s, 'resources/u1/big.pdf'), new Uint8Array(20 * 1024 * 1024 + 1), pdf));
});

test('NOBODY can read, overwrite or delete through the client SDK — not even the owner', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), 'resources/u1/seeded.pdf'), bytes, pdf);
  });
  await assertFails(getBytes(ref(st('u1', KU), 'resources/u1/seeded.pdf')));
  await assertFails(getBytes(ref(st('u3', OUTSIDER), 'resources/u1/seeded.pdf')));
  await assertFails(uploadBytes(ref(st('u1', KU), 'resources/u1/seeded.pdf'), bytes, pdf)); // overwrite
  await assertFails(deleteObject(ref(st('u1', KU), 'resources/u1/seeded.pdf')));
});
```

- [ ] **Step 2: Create `tools/test_storage_rules.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
# Storage security-rules tests (Plan 2A). The emulators need JDK 21+.
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
cd "$(dirname "$0")/../firestore-tests"
firebase emulators:exec --only storage --project demo-rules "node --test storage.test.mjs"
```

And add to `firestore-tests/package.json` scripts: `"test:storage": "firebase emulators:exec --only storage --project demo-rules \"node --test storage.test.mjs\""`.

- [ ] **Step 3: Run to verify it fails**

Run: `bash tools/test_storage_rules.sh`
Expected: FAIL — `../storage.rules` does not exist.

- [ ] **Step 4: Create `storage.rules`** (and add `"storage": { "rules": "storage.rules" }` to the top level of `firebase.json`)

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {

    // Same start-anchored KU check as firestore.rules `kuVerified()`.
    function kuVerified() {
      return request.auth != null
        && request.auth.token.email is string
        && request.auth.token.email.lower().matches('^[^@]+@st[.]kyoto-u[.]ac[.]jp$')
        && request.auth.token.email_verified == true;
    }

    // Plan 2A: the bucket is PRIVATE. A verified KU user may only CREATE an
    // object under their own `resources/<uid>/` prefix. Nobody can read through
    // the client SDK — downloads are 10-minute signed URLs issued by the
    // `downloadResource` Function (Admin SDK bypasses these rules). Overwrite
    // and delete are denied: cleanup is the `onPostDeleted` trigger, and an
    // owner overwriting a file after the post was validated would defeat that
    // validation.
    match /resources/{uid}/{file} {
      allow read: if false;
      allow create: if kuVerified()
        && request.auth.uid == uid
        && request.resource.size < 20 * 1024 * 1024
        && (request.resource.contentType == 'application/pdf'
            || request.resource.contentType.matches('image/.*'));
      allow update, delete: if false;
    }

    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `bash tools/test_storage_rules.sh`
Expected: PASS — 5 tests. (If the storage emulator reports the project's default bucket is missing, the `emulators:exec` banner names the bucket to use; `initializeTestEnvironment` with `projectId: 'demo-rules'` works with the default.)

- [ ] **Step 6: Commit**

```bash
git add storage.rules firestore-tests/storage.test.mjs firestore-tests/package.json tools/test_storage_rules.sh
git commit -m "feat(storage): private bucket rules — own-prefix create only, no client read/overwrite/delete"
```

---

### Task 7: Flutter — ledger model + `CreditService`

**Files:**
- Modify: `pubspec.yaml`
- Create: `lib/models/credit_ledger_entry.dart`, `lib/services/credit_service.dart`, `test/models/credit_ledger_entry_test.dart`, `test/services/credit_service_test.dart`

**Interfaces:**
- Produces (`credit_ledger_entry.dart`): `class CreditLedgerEntry { final String id; final int delta; final String reason; final String? refId; final int balanceAfter; final DateTime createdAt; String get label; factory CreditLedgerEntry.fromMap(String id, Map<String, dynamic> map) }` — **total** (never throws on a malformed doc); `createdAt` accepts a Firestore `Timestamp`, an ISO string, or falls back to the epoch.
- Produces (`credit_service.dart`):
  - `enum CreditErrorKind { insufficient, notFound, unauthenticated, other }`
  - `class CreditException implements Exception { final CreditErrorKind kind; final String message; factory CreditException.fromCode(String code, String? message) }`
  - `class DownloadResult { final String url; final bool charged; final int balance }`
  - `typedef CallableInvoker = Future<Map<String, dynamic>> Function(String name, Map<String, dynamic> data)`
  - `class CreditService { CreditService(FirebaseFirestore db, CallableInvoker call); factory CreditService.live(FirebaseFirestore db); Stream<int> streamBalance(String uid); Stream<List<CreditLedgerEntry>> streamLedger(String uid, {int limit = 50}); Future<int> claimWelcome(); Future<DownloadResult> downloadResource(String postId, {int fileIndex = 0}); }`

- [ ] **Step 1: Add the dependency**

Run: `flutter pub add cloud_functions` (it resolves `^6.5.0` against `firebase_core ^4.12.1`). Confirm `pubspec.yaml` gains exactly that one line under `dependencies:` and `flutter pub get` succeeds.

- [ ] **Step 2: Write the failing tests**

`test/models/credit_ledger_entry_test.dart`:

```dart
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/credit_ledger_entry.dart';

void main() {
  test('parses a Function-written ledger row (Timestamp createdAt)', () {
    final e = CreditLedgerEntry.fromMap('dl_u_p', {
      'uid': 'u', 'delta': -1, 'reason': 'download', 'refId': 'p', 'balanceAfter': 2,
      'createdAt': Timestamp.fromDate(DateTime.utc(2026, 10, 3, 9)),
    });
    expect(e.id, 'dl_u_p');
    expect(e.delta, -1);
    expect(e.reason, 'download');
    expect(e.refId, 'p');
    expect(e.balanceAfter, 2);
    expect(e.createdAt.toUtc(), DateTime.utc(2026, 10, 3, 9));
  });

  test('is total: garbage fields degrade instead of throwing', () {
    final e = CreditLedgerEntry.fromMap('x', {
      'delta': 'many', 'reason': 7, 'balanceAfter': double.nan, 'createdAt': {'oops': 1},
    });
    expect(e.delta, 0);
    expect(e.reason, '');
    expect(e.balanceAfter, 0);
    expect(e.createdAt, DateTime.fromMillisecondsSinceEpoch(0));
  });

  test('accepts an ISO-8601 createdAt string', () {
    final e = CreditLedgerEntry.fromMap('x', {'delta': 1, 'reason': 'upload', 'createdAt': '2026-10-03T00:00:00.000Z'});
    expect(e.createdAt.toUtc(), DateTime.utc(2026, 10, 3));
  });

  test('label maps every server reason to Japanese copy, unknown reasons fall back', () {
    const expected = {
      'signup_bonus': 'ご登録ボーナス',
      'upload': '資料のアップロード',
      'download': '資料のダウンロード',
      'download_free': '資料のダウンロード（無料）',
      'first_review': '初めてのレビュー投稿',
      'request_fulfilled': 'リクエストへの対応',
    };
    expected.forEach((reason, label) {
      expect(CreditLedgerEntry.fromMap('x', {'reason': reason}).label, label);
    });
    expect(CreditLedgerEntry.fromMap('x', {'reason': 'mystery'}).label, 'クレジットの増減');
  });
}
```

`test/services/credit_service_test.dart`:

```dart
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/services/credit_service.dart';

void main() {
  test('streamBalance emits 0 for a missing doc, then the stored balance', () async {
    final db = FakeFirebaseFirestore();
    final svc = CreditService(db, (_, _) async => {});
    final seen = <int>[];
    final sub = svc.streamBalance('u1').listen(seen.add);
    await Future<void>.delayed(Duration.zero);
    await db.collection('credit_balances').doc('u1').set({'balance': 3});
    await Future<void>.delayed(Duration.zero);
    await sub.cancel();
    expect(seen.first, 0);
    expect(seen.last, 3);
  });

  test('streamBalance tolerates a malformed balance', () async {
    final db = FakeFirebaseFirestore();
    await db.collection('credit_balances').doc('u1').set({'balance': 'lots'});
    expect(await CreditService(db, (_, _) async => {}).streamBalance('u1').first, 0);
  });

  test('streamLedger returns only the caller’s rows, newest first', () async {
    final db = FakeFirebaseFirestore();
    Future<void> row(String id, String uid, int delta, int day) => db.collection('credits_ledger').doc(id).set({
          'uid': uid, 'delta': delta, 'reason': 'upload', 'balanceAfter': delta,
          'createdAt': Timestamp.fromDate(DateTime.utc(2026, 10, day)),
        });
    await row('a', 'u1', 3, 1);
    await row('b', 'u1', -1, 2);
    await row('c', 'u2', 9, 3);
    final list = await CreditService(db, (_, _) async => {}).streamLedger('u1').first;
    expect(list.map((e) => e.id), ['b', 'a']);
  });

  test('claimWelcome calls the callable and returns the balance', () async {
    final calls = <String>[];
    final svc = CreditService(FakeFirebaseFirestore(), (name, data) async {
      calls.add(name);
      return {'granted': true, 'balance': 3};
    });
    expect(await svc.claimWelcome(), 3);
    expect(calls, ['claimWelcomeCredits']);
  });

  test('downloadResource sends postId + fileIndex and parses the result', () async {
    late Map<String, dynamic> sent;
    final svc = CreditService(FakeFirebaseFirestore(), (name, data) async {
      expect(name, 'downloadResource');
      sent = data;
      return {'url': 'https://signed/x', 'charged': true, 'balance': 2};
    });
    final r = await svc.downloadResource('p1', fileIndex: 1);
    expect(sent, {'postId': 'p1', 'fileIndex': 1});
    expect(r.url, 'https://signed/x');
    expect(r.charged, isTrue);
    expect(r.balance, 2);
  });

  test('CreditException.fromCode maps server codes', () {
    expect(CreditException.fromCode('failed-precondition', 'insufficient-credits').kind, CreditErrorKind.insufficient);
    expect(CreditException.fromCode('not-found', null).kind, CreditErrorKind.notFound);
    expect(CreditException.fromCode('unauthenticated', null).kind, CreditErrorKind.unauthenticated);
    expect(CreditException.fromCode('permission-denied', null).kind, CreditErrorKind.unauthenticated);
    expect(CreditException.fromCode('internal', 'boom').kind, CreditErrorKind.other);
    // a failed-precondition that is NOT about credits is not "insufficient"
    expect(CreditException.fromCode('failed-precondition', 'something else').kind, CreditErrorKind.other);
  });
}
```

(Package name in imports: check `name:` in `pubspec.yaml` — it is `kyoto_exam_hub`.)

- [ ] **Step 3: Run to verify it fails**

Run: `flutter test test/models/credit_ledger_entry_test.dart test/services/credit_service_test.dart`
Expected: FAIL — files under test do not exist.

- [ ] **Step 4: Create `lib/models/credit_ledger_entry.dart`**

```dart
import 'package:cloud_firestore/cloud_firestore.dart';

/// One row of `credits_ledger`, written only by Cloud Functions. The reader is
/// total: a malformed row degrades to zeros rather than crashing the マイページ.
class CreditLedgerEntry {
  final String id;
  final int delta;
  final String reason;
  final String? refId;
  final int balanceAfter;
  final DateTime createdAt;

  const CreditLedgerEntry({
    required this.id,
    required this.delta,
    required this.reason,
    this.refId,
    required this.balanceAfter,
    required this.createdAt,
  });

  String get label => switch (reason) {
        'signup_bonus' => 'ご登録ボーナス',
        'upload' => '資料のアップロード',
        'download' => '資料のダウンロード',
        'download_free' => '資料のダウンロード（無料）',
        'first_review' => '初めてのレビュー投稿',
        'request_fulfilled' => 'リクエストへの対応',
        _ => 'クレジットの増減',
      };

  static int _int(dynamic v) => (v is num && v.isFinite) ? v.toInt() : 0;

  static DateTime _time(dynamic v) {
    if (v is Timestamp) return v.toDate();
    if (v is String) return DateTime.tryParse(v) ?? DateTime.fromMillisecondsSinceEpoch(0);
    return DateTime.fromMillisecondsSinceEpoch(0);
  }

  factory CreditLedgerEntry.fromMap(String id, Map<String, dynamic> map) {
    return CreditLedgerEntry(
      id: id,
      delta: _int(map['delta']),
      reason: map['reason'] is String ? map['reason'] as String : '',
      refId: map['refId'] is String ? map['refId'] as String : null,
      balanceAfter: _int(map['balanceAfter']),
      createdAt: _time(map['createdAt']),
    );
  }
}
```

- [ ] **Step 5: Create `lib/services/credit_service.dart`**

```dart
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import '../models/credit_ledger_entry.dart';

enum CreditErrorKind { insufficient, notFound, unauthenticated, other }

class CreditException implements Exception {
  CreditException(this.kind, this.message);
  final CreditErrorKind kind;
  final String message;

  factory CreditException.fromCode(String code, String? message) {
    final msg = message ?? code;
    if (code == 'failed-precondition' && msg.contains('insufficient-credits')) {
      return CreditException(CreditErrorKind.insufficient, msg);
    }
    return switch (code) {
      'not-found' => CreditException(CreditErrorKind.notFound, msg),
      'unauthenticated' || 'permission-denied' => CreditException(CreditErrorKind.unauthenticated, msg),
      _ => CreditException(CreditErrorKind.other, msg),
    };
  }

  @override
  String toString() => 'CreditException($kind, $message)';
}

class DownloadResult {
  const DownloadResult({required this.url, required this.charged, required this.balance});
  final String url;
  final bool charged;
  final int balance;
}

/// Calls a Cloud Function by name. Injected so tests never touch the network.
typedef CallableInvoker = Future<Map<String, dynamic>> Function(String name, Map<String, dynamic> data);

/// Read side of the credit ledger (Firestore, own docs only) plus the two
/// callables. The client never writes a balance — see `firestore.rules`.
class CreditService {
  CreditService(this._db, this._call);

  factory CreditService.live(FirebaseFirestore db) => CreditService(db, _liveInvoker);

  final FirebaseFirestore _db;
  final CallableInvoker _call;

  static Future<Map<String, dynamic>> _liveInvoker(String name, Map<String, dynamic> data) async {
    try {
      final res = await FirebaseFunctions.instanceFor(region: 'asia-east1')
          .httpsCallable(name)
          .call<Map<Object?, Object?>>(data);
      return Map<String, dynamic>.from(res.data);
    } on FirebaseFunctionsException catch (e) {
      throw CreditException.fromCode(e.code, e.message);
    }
  }

  Stream<int> streamBalance(String uid) => _db
      .collection('credit_balances')
      .doc(uid)
      .snapshots()
      .map((s) {
        final b = s.data()?['balance'];
        return (b is num && b.isFinite) ? b.toInt() : 0;
      });

  Stream<List<CreditLedgerEntry>> streamLedger(String uid, {int limit = 50}) => _db
      .collection('credits_ledger')
      .where('uid', isEqualTo: uid)
      .orderBy('createdAt', descending: true)
      .limit(limit)
      .snapshots()
      .map((q) => q.docs.map((d) => CreditLedgerEntry.fromMap(d.id, d.data())).toList());

  /// Idempotent server-side; safe to call on every login.
  Future<int> claimWelcome() async {
    final r = await _call('claimWelcomeCredits', {});
    final b = r['balance'];
    return b is num ? b.toInt() : 0;
  }

  Future<DownloadResult> downloadResource(String postId, {int fileIndex = 0}) async {
    final r = await _call('downloadResource', {'postId': postId, 'fileIndex': fileIndex});
    final b = r['balance'];
    return DownloadResult(
      url: r['url'] as String,
      charged: r['charged'] == true,
      balance: b is num ? b.toInt() : 0,
    );
  }
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `flutter test test/models/credit_ledger_entry_test.dart test/services/credit_service_test.dart` then `flutter analyze` (0 errors) then `flutter test` (all green).
Expected: PASS — 4 + 6 new tests.

- [ ] **Step 7: Commit**

```bash
git add pubspec.yaml pubspec.lock lib/models/credit_ledger_entry.dart lib/services/credit_service.dart test/models/credit_ledger_entry_test.dart test/services/credit_service_test.dart
git commit -m "feat: CreditService (balance/ledger streams, welcome + signed-download callables) and CreditLedgerEntry"
```

---

### Task 8: Flutter — retire client-authored points; wire credits, private upload, signed download

This is the large refactor. Its single deliverable: **after it, no client code writes points, prices, transactions or referral bonuses, and the app compiles and runs against the new Functions/rules.** It touches the models, `AppStore`, `FirestoreService`, `main.dart`, the download helper, and the minimum of `lib/views/*` needed to compile and keep the upload / download / request flows working. Pure copy/visual rewrites are Task 9.

**Files:**
- Modify: `lib/models/post.dart`, `lib/models/user_profile.dart`, `lib/services/app_store.dart`, `lib/services/firestore_service.dart`, `lib/main.dart`, `lib/utils/download_helper.dart` (no change — conditional export), `lib/utils/download_helper_web.dart`, `lib/utils/download_helper_stub.dart`, `lib/views/course/course_resource_tab.dart`, `lib/views/home/home_screen.dart`, `lib/views/mypage/my_page_screen.dart`, `lib/views/auth/signup_screen.dart`
- Test: `test/models/post_test.dart` (new), `test/models/user_profile_test.dart` (new); `flutter analyze` + `flutter test` + `flutter build web --debug`

**Interfaces:**
- Consumes: `CreditService`, `CreditException`, `CreditErrorKind`, `DownloadResult`, `CreditLedgerEntry` (Task 7).
- Produces:
  - `Post`: **removes** `fileUrls`, `downloadCost`, `is5DownloadsRewarded`, `is10DownloadsRewarded`; **adds** `final List<String> filePaths`. `Post.fromMap` stays total over old docs (ignores the removed keys; `filePaths` defaults to `[]`). `copyWith({int? downloadCount, List<String>? reports})`.
  - `UserProfile`: **removes** `points`, `invitationCode`, `pendingReferralCode`. `fromMap` ignores them in old docs. (`downloadCount` is kept as a plain field; nothing increments it any more.)
  - `AppStore(CourseRepository, ReviewService, RankingService, CreditService)`; fields `int creditBalance`, `List<CreditLedgerEntry> ledger`; `Future<bool> downloadPost(Post post)` (**now async**); `Future<String?> uploadFileToStorage(String fileName, Uint8List bytes)` (returns the storage **path** `resources/<uid>/<ts>_<name>`); `Future<bool> addPost({required String subjectId, required PostCategory category, int? year, required String title, required String description, required List<String> fileNames, required List<String> filePaths, String? requestId})`; `Future<bool> addMaterialRequest({required String subjectId, required PostCategory category, int? year, required String title, required String description})` (free, no reward); removed: `transactions`, `_addTransaction`, every `copyWith(points: …)`.
  - `startDownload(String url)` in the download helper (web: hidden `<a>` click in the current tab; stub: no-op). `openUrlInNewTab` stays for other callers.

- [ ] **Step 1: Write the failing model tests**

`test/models/post_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/post.dart';

void main() {
  test('Post round-trips filePaths and no longer carries price or reward flags', () {
    final p = Post(
      id: 'p1', subjectId: 'c_1', subjectName: '線形代数', authorId: 'u1', authorName: 'me',
      category: PostCategory.pastExam, year: 2024, title: 't', description: '',
      filePaths: ['resources/u1/1_a.pdf'], fileNames: ['a.pdf'], createdAt: DateTime.utc(2026, 10, 3),
    );
    final m = p.toMap();
    expect(m['filePaths'], ['resources/u1/1_a.pdf']);
    for (final k in ['fileUrls', 'downloadCost', 'is5DownloadsRewarded', 'is10DownloadsRewarded']) {
      expect(m.containsKey(k), isFalse, reason: '$k must be gone');
    }
    expect(Post.fromMap(m).filePaths, ['resources/u1/1_a.pdf']);
  });

  test('Post.fromMap still reads a legacy doc (fileUrls/downloadCost present, no filePaths)', () {
    final p = Post.fromMap({
      'id': 'old', 'subjectId': 's', 'authorId': 'u', 'category': 'past_exam', 'title': 't',
      'fileUrls': ['https://firebasestorage.googleapis.com/v0/b/x/o/a?alt=media'],
      'fileNames': ['a.pdf'], 'downloadCost': 5, 'downloadCount': 4,
      'is5DownloadsRewarded': true, 'createdAt': '2026-09-01T00:00:00.000',
    });
    expect(p.filePaths, isEmpty); // un-migrated: the UI treats this as "not downloadable"
    expect(p.downloadCount, 4);
  });
}
```

`test/models/user_profile_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/user_profile.dart';

void main() {
  test('UserProfile.toMap never writes points, invitation or referral fields', () {
    final m = UserProfile(uid: 'u', email: 'a@st.kyoto-u.ac.jp', displayName: 'me', createdAt: DateTime.utc(2026, 10, 3)).toMap();
    for (final k in ['points', 'invitationCode', 'pendingReferralCode']) {
      expect(m.containsKey(k), isFalse, reason: '$k must not be client-written');
    }
  });

  test('UserProfile.fromMap tolerates a legacy doc that still has them', () {
    final p = UserProfile.fromMap({'uid': 'u', 'email': 'e', 'displayName': 'd', 'points': 99, 'invitationCode': 'KU1', 'isVerified': true});
    expect(p.isVerified, isTrue);
  });
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `flutter test test/models/post_test.dart test/models/user_profile_test.dart`
Expected: FAIL — `Post` has no `filePaths`; `toMap` still emits the old keys.

- [ ] **Step 3: Models**

`lib/models/post.dart`: delete the fields `fileUrls`, `downloadCost`, `is5DownloadsRewarded`, `is10DownloadsRewarded` from the class, constructor, `toMap`, `fromMap`, `copyWith`; add `final List<String> filePaths;` (required in the constructor; in `toMap` `'filePaths': filePaths`; in `fromMap` `filePaths: List<String>.from(map['filePaths'] ?? [])`). `copyWith` keeps only `downloadCount` and `reports`. The `PostCategory` enum and `PostCategoryX` are unchanged.

`lib/models/user_profile.dart`: delete `points`, `invitationCode`, `pendingReferralCode` from the class, constructor, `copyWith`, `toMap`, `fromMap`. Keep `downloadCount`, `isVerified`, `createdAt`.

- [ ] **Step 4: `FirestoreService` and the download helper**

`lib/services/firestore_service.dart`: delete `recordTransaction`, `streamTransactions`, `getUserByInvitationCode`, `updatePostMilestones`, `incrementPostDownloadCount`, and the now-unused `transaction.dart` import. Keep `updatePostReports`, `createPost`, `deletePost`, `createMaterialRequest`, etc.

`lib/utils/download_helper_web.dart` — add:

```dart
/// Downloads a signed URL. The URL carries `Content-Disposition: attachment`, so
/// navigating the current tab to it saves the file without leaving the app —
/// unlike `window.open`, which popup blockers kill once we have awaited the
/// callable (the user gesture is gone by then).
void startDownload(String url) {
  final a = html.AnchorElement(href: url)
    ..target = '_self'
    ..style.display = 'none';
  html.document.body?.append(a);
  a.click();
  a.remove();
}
```

`lib/utils/download_helper_stub.dart` — add `void startDownload(String url) {}`.

- [ ] **Step 5: `AppStore`**

Make these edits (all in `lib/services/app_store.dart`; keep every unrelated method untouched):

1. **Imports/ctor/fields.** Remove the `transaction.dart` import and `List<PointTransaction> transactions`. Add `import 'credit_service.dart'; import '../models/credit_ledger_entry.dart'; import 'dart:async';`. Constructor becomes `AppStore(this.courses, this.reviews, this.ranking, this.credits)`; add

```dart
  /// Credit balance/ledger streams and the signed-download callable (Plan 2A).
  final CreditService credits;
  int creditBalance = 0;
  List<CreditLedgerEntry> ledger = [];
  StreamSubscription<int>? _balanceSub;
  StreamSubscription<List<CreditLedgerEntry>>? _ledgerSub;

  void _watchCredits(String uid) {
    _balanceSub?.cancel();
    _ledgerSub?.cancel();
    _balanceSub = credits.streamBalance(uid).listen((b) {
      creditBalance = b;
      notifyListeners();
    }, onError: (_) {});
    _ledgerSub = credits.streamLedger(uid).listen((l) {
      ledger = l;
      notifyListeners();
    }, onError: (_) {});
  }

  /// Idempotent server-side (a flag on the balance doc), so calling it on every
  /// verified login is cheap and also back-fills users who verified before
  /// Plan 2A shipped.
  Future<void> _claimWelcome() async {
    try {
      await credits.claimWelcome();
    } catch (_) {/* best-effort; retried on next login */}
  }
```

2. **`_initFirebaseSync`.** In the email-link sign-in branch delete the `points: 30` argument and the `_addTransaction(... 'signup_bonus' ...)` call, and drop `invitationCode:`. In the `authStateChanges` listener, after `currentUser = profile;` add `_watchCredits(fbUser.uid); if (fbUser.emailVerified) _claimWelcome();` and delete the `_firestore.streamTransactions(...)` subscription block.
3. **`signUpWithPassword`.** Remove the `referralCode` parameter, the `points: 0`, `invitationCode:` and `pendingReferralCode:` arguments. (Update `signup_screen.dart` accordingly — Step 6.)
4. **`checkEmailVerification`.** Replace the whole `if (isEmailVerified) { if (currentUser != null && !currentUser!.isVerified) { … } }` bonus/referral body with:

```dart
    if (isEmailVerified && currentUser != null && !currentUser!.isVerified) {
      currentUser = currentUser!.copyWith(isVerified: true);
      await _firestore.saveUserProfile(currentUser!);
      await _claimWelcome();
      lastNoticeMessage = 'メールアドレスの検証が完了しました！ ご登録ボーナスとして3クレジットを付与しました。';
      notifyListeners();
      return true;
    }
    return isEmailVerified;
```

5. **`addPost`.** Replace with the new signature and body:

```dart
  Future<bool> addPost({
    required String subjectId,
    required PostCategory category,
    int? year,
    required String title,
    required String description,
    required List<String> fileNames,
    required List<String> filePaths,
    String? requestId,
  }) async {
    if (currentUser == null) return false;
    final sub = await courses.byId(subjectId);
    final newPost = Post(
      id: 'post_${DateTime.now().millisecondsSinceEpoch}',
      universityId: 'kyoto_u',
      subjectId: subjectId,
      subjectName: sub?.name ?? '不明な科目',
      authorId: currentUser!.uid,
      authorName: currentUser!.displayName,
      category: category,
      year: year,
      title: title,
      description: description,
      filePaths: filePaths,
      fileNames: fileNames,
      createdAt: DateTime.now(),
      requestId: requestId,
    );
    posts.insert(0, newPost);
    // Credits are granted by the `onPostCreated` trigger once it has validated
    // the files; the balance arrives through the `credits` stream. If the post
    // is rejected the trigger deletes it and the posts stream drops it.
    _firestore.createPost(newPost).catchError((_) {});
    _bumpPostCountFor(newPost, 1);
    lastNoticeMessage = '資料をアップロードしました！確認後、クレジットが付与されます。';
    notifyListeners();
    return true;
  }
```
(`Post` needs the optional `requestId` field it already has; the request is marked fulfilled by the trigger, so the old `requests[...] = …copyWith(isFulfilled…)` / `createMaterialRequest` block is deleted.)

6. **`downloadPost`.** Replace the whole method with:

```dart
  Future<bool> downloadPost(Post post) async {
    if (currentUser == null) return false;
    try {
      final r = await credits.downloadResource(post.id);
      startDownload(r.url);
      lastNoticeMessage = r.charged
          ? '資料のダウンロードを開始しました（1クレジット消費）'
          : '資料のダウンロードを開始しました';
      notifyListeners();
      return true;
    } on CreditException catch (e) {
      lastNoticeMessage = switch (e.kind) {
        CreditErrorKind.insufficient => 'クレジットが足りません。資料をアップロードするとクレジットを獲得できます。',
        CreditErrorKind.notFound => 'この資料は削除されたか、見つかりませんでした。',
        _ => 'ダウンロードに失敗しました。時間をおいて再度お試しください。',
      };
      notifyListeners();
      return false;
    } catch (_) {
      lastNoticeMessage = 'ダウンロードに失敗しました。時間をおいて再度お試しください。';
      notifyListeners();
      return false;
    }
  }
```

7. **`uploadFileToStorage`.** Upload to the private per-user prefix and return the path:

```dart
  Future<String?> uploadFileToStorage(String fileName, Uint8List fileBytes) async {
    final uid = currentUser?.uid;
    if (uid == null) return null;
    try {
      final safe = fileName.replaceAll(RegExp(r'[^\w.\-぀-ヿ一-鿿]'), '_');
      final path = 'resources/$uid/${DateTime.now().millisecondsSinceEpoch}_$safe';
      final lower = fileName.toLowerCase();
      final contentType = lower.endsWith('.pdf')
          ? 'application/pdf'
          : lower.endsWith('.png')
              ? 'image/png'
              : lower.endsWith('.webp')
                  ? 'image/webp'
                  : 'image/jpeg';
      await fb_storage.FirebaseStorage.instance
          .ref()
          .child(path)
          .putData(fileBytes, fb_storage.SettableMetadata(contentType: contentType));
      return path;
    } catch (e) {
      lastNoticeMessage = 'ストレージへのファイルアップロードに失敗しました。';
      notifyListeners();
      return null;
    }
  }
```

8. **`deletePost`.** Delete every points/penalty/`_addTransaction`/`currentUser.copyWith(points…)` line; keep: local removal, `_firestore.deletePost`, `_bumpPostCountFor(post, -1)`, and the notice `'投稿を削除しました。'`. (The `onPostDeleted` trigger removes the files.)
9. **`reportPost`.** In the ≥ 3-report branch delete the whole "Claw back points from uploader" block (uploader profile read, penalty, `saveUserProfile`, `_addTransaction`) and the `DefaultFirebaseOptions` bucket usage if it becomes unused; notice becomes `'通報が3件に達したため、投稿は自動削除されました。'`. (P2-11: threshold behaviour is otherwise unchanged.)
10. **`addMaterialRequest`.** New signature without `rewardPoints`; delete the `cost`/`totalCost`/points check/`saveUserProfile`/`_addTransaction`; create the request with `costSpent: 0, rewardPoints: 0`.
11. **`respondToTextbookRequest`.** Delete the `_addTransaction(... 'textbook_borrow' ... -20 ...)` call and change the notice to `'貸し出しに応答しました！トークルームを作成しました。'`.
12. **Delete** `_addTransaction` and any helper left unused. **`logout()`**: also `_balanceSub?.cancel(); _ledgerSub?.cancel(); creditBalance = 0; ledger = [];`.

- [ ] **Step 6: `main.dart` and the views (minimum to compile and keep flows working)**

`lib/main.dart`: pass `CreditService.live(FirebaseFirestore.instance)` as the 4th `AppStore` argument (+ import).

`lib/views/auth/signup_screen.dart`: remove the `_referralController`, the referral `TextField` (line ~422) and its label, and the `referralCode:` argument at the `signUpWithPassword` call (line ~38). Change the notice text at line ~230 to say the 3-credit welcome bonus is granted after verification (`'検証を完了するまで、過去問のダウンロードや投稿機能は利用できません。検証後に、ご登録ボーナス3クレジットが付与されます。'`).

`lib/views/home/home_screen.dart`: line ~392 `${widget.store.currentUser?.points ?? 0} pt` → `${widget.store.creditBalance} クレジット`.

`lib/views/mypage/my_page_screen.dart`: line ~460 `'${user?.points ?? 0}'` → `'${widget.store.creditBalance}'` and its `'pt'` suffix → `'クレジット'`; **delete** the whole "Invitation Code Info" `Container` (lines ~488–503); line ~581 `Text('${p.downloadCost}pt' …)` → remove that trailing widget (posts no longer have a price). Replace the `txs` list source (`widget.store.transactions`) with `widget.store.ledger` and adapt the item builder to `CreditLedgerEntry` (`tx.amount` → `e.delta`, `tx.description` → `e.label`, `tx.createdAt` → `e.createdAt`, `'… pt'` → `'… クレジット'`); title `'ポイント取引・獲得履歴'` → `'クレジット履歴'`.

`lib/views/course/course_resource_tab.dart`:
- Upload flow (line ~406–429): `uploadedName` is now a **path**. Call
  ```dart
  await widget.store.addPost(
    subjectId: widget.subject.id,
    category: category,
    year: category == PostCategory.pastExam ? selectedYear : null,
    title: titleController.text.trim(),
    description: descController.text.trim(),
    fileNames: [pickedFile!.name],
    filePaths: [uploadedPath],
    requestId: requestId,
  );
  ```
  (rename the local `uploadedName` → `uploadedPath`). Delete the `customCost` slider UI and variable (the 0–20pt price picker) — find it with `customCost`.
- Download dialog (`_showDownloadConfirmDialog`): drop the `cost`/`userPoints`/`post.downloadCost` logic. `isFree` stays (author or requester). Show `isFree ? 'あなたは無料でダウンロードできます！' : '1クレジットを消費します（保有: ${widget.store.creditBalance}クレジット）'` and, when `!isFree && widget.store.creditBalance < 1`, `'クレジットが足りません。'`; the confirm button is disabled in that case. Its `onPressed` becomes `async`: `Navigator.pop(context); final ok = await widget.store.downloadPost(post); if (!mounted) return; setState(() {}); ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(widget.store.lastNoticeMessage ?? (ok ? 'ダウンロードを開始しました。' : 'エラーが発生しました。'))));`. A post with `post.filePaths.isEmpty` (un-migrated legacy) shows the button disabled with the text `'この資料は移行中のためダウンロードできません'`.
- Request modal (`_showAddRequestModal`): delete `rewardPoints`, the reward `Slider`, the "合計消費ポイント" row and the `rewardPoints:` argument; the request is free. Delete the `${req.rewardPoints}pt` badge (line ~995) and the `'${post.downloadCost} pt DL'` label (line ~1178) — show `'1クレジット'` there instead (`isFree ? '無料' : '1クレジット'`).

- [ ] **Step 7: Verify**

Run: `flutter analyze` (expect 0 errors; the ~25 pre-existing info lints are fine — report any NEW ones), `flutter test` (expect all green: prior 72 + 10 from Task 7 + 4 new here), `flutter build web --debug` (clean).
Also `grep -rnE "\.points|downloadCost|rewardPoints|invitationCode|pendingReferral|PointTransaction|recordTransaction|_addTransaction|openUrlInNewTab\(post" lib/` must return nothing in `lib/views/`, `lib/services/` and `lib/models/` (`MaterialRequest.rewardPoints`/`costSpent` fields in `lib/models/request.dart` and `lib/models/transaction.dart` itself may remain — they are tolerated legacy shapes).

- [ ] **Step 8: Commit**

```bash
git add lib test
git commit -m "refactor: retire client-authored points — credits stream, private upload, signed download, free requests"
```

---

### Task 9: Flutter — credit copy, balance card, onboarding, rules dialogs

Presentational only. No new behaviour; every string that still explains the old economy is rewritten to the new one.

**Files:**
- Modify: `lib/views/home/home_screen.dart` (rules dialog ~lines 205–260), `lib/views/mypage/my_page_screen.dart` (rules dialog ~lines 265–320, balance card ~lines 440–485), `lib/views/onboarding/onboarding_screen.dart` (slides ~20–50), `lib/views/timetable/timetable_registration_screen.dart` (~line 437), `lib/views/contact/contact_screen.dart` (the `point_refund` option label ~line 20)
- Test: manual (`flutter run -d chrome --web-port 5000`) + `flutter analyze`

**Interfaces:** consumes `AppStore.creditBalance` / `ledger` (Task 8). Produces nothing new.

- [ ] **Step 1: Rewrite the rules dialog (both copies, identical text)**

Title `'クレジット制度のルール'`; intro `'京大InfoHubでは、良質な資料を共有し合うコミュニティを維持するため、以下のクレジット制度を採用しています。'`; the bullet list becomes exactly:

```
🎁 ご登録ボーナス: メール認証を完了すると 3クレジット がもらえます。
📥 資料のダウンロード: 過去問・資料は 1つにつき 1クレジット。一度ダウンロードした資料は、何度でも無料で再ダウンロードできます。
📤 資料のアップロード: 承認されると 3クレジット がもらえます（1日3回まで。既に登録済みの年度の重複投稿は対象外）。
✍️ 授業レビュー: 投稿も閲覧も無料です。初めてのレビュー投稿で 2クレジット がもらえます。
🙋 リクエスト: リクエストの投稿は無料。応えてくれた方には 3クレジット が付き、あなたはその資料を無料でダウンロードできます。
🚫 クレジットは購入できません。投稿者への還元はなく、削除や通報による没収もありません。
⚠️ 転載・無関係なファイルの投稿は通報され、3件で自動削除されます。権利者の方からの削除要請には速やかに対応します。
```

Keep the existing dialog widget structure (Row/Icon/`ListView` of bullets) — only the strings change; remove the 80% royalty, milestone, penalty, and 2020-cut-off lines.

- [ ] **Step 2: Balance card (`my_page_screen.dart`)**

Label `'保有ポイント残高'` → `'保有クレジット'`; the right-hand badge `'過去問 約6年分相当'` → `'1クレジット = 資料1つ'`; delete the `'有効期限: 発行から12ヶ月'` line (credits do not expire in 2A). The button label `'ポイント制度解説'` → `'クレジット制度'`.

- [ ] **Step 3: Onboarding slides** — replace slide 2 and 3 (keep the others and the structure):

```dart
    {
      'title': '初回 3クレジットプレゼント！',
      'subtitle': 'メール認証を完了すると 3クレジット がもらえます。\n過去問・資料は 1つにつき 1クレジット。授業レビューの閲覧・投稿は、ずっと無料です。',
      'icon': Icons.stars_rounded,
      'color': const Color(0xFFD97706),
      'highlight': 'まず3つの資料が手に入る！',
    },
    {
      'title': '投稿して、クレジットを集めよう',
      'subtitle': '・資料のアップロード: +3クレジット（1日3回まで）\n・初めてのレビュー投稿: +2クレジット\n・リクエストに応える: +3クレジット\nクレジットは購入できません。みんなで資料を持ち寄る仕組みです。',
      'icon': Icons.savings_outlined,
      'color': const Color(0xFF059669),
      'highlight': '投稿すれば、また資料がもらえる！',
    },
```

Slide 4 (textbook): replace the subtitle's `応答時に20pt決済され、` with nothing → `'不要になった参考書や探している本をリクエスト掲示板でマッチング！安全な個別トークルームが開設されます。'`.

- [ ] **Step 4: Remaining strings**

`timetable_registration_screen.dart:437`: replace `獲得したポイントは過去問ダウンロードのほか、学内のサークル・新歓等の宣伝広告にも利用可能です。` with `登録した科目の過去問やレビューをチェックしてみましょう。` (credits are not an ad currency — A3 decoupling). `contact_screen.dart:20`: `'② ポイント返却のお問い合わせ (虚偽資料・未受領等の申告)'` → `'② クレジット返却のお問い合わせ (虚偽資料・ダウンロード失敗等の申告)'` (keep the map key `point_refund`; it is an existing inquiry code).

- [ ] **Step 5: Verify**

Run: `flutter analyze` (0 errors, no new lints), `flutter test` (green), `flutter build web --debug` (clean). Then `grep -rnE "ポイント|[0-9]pt|\bpt\b" lib/views` — the only hits allowed are the unchanged inquiry map key and legacy-doc comments; report any other.
Manual (browser, `--web-port 5000`): open マイページ → both rules dialogs read as the new text, balance card says クレジット, onboarding (clear site data → re-sign-up flow or temporarily force `showOnboardingFlow`) shows the new slides.

- [ ] **Step 6: Commit**

```bash
git add lib/views
git commit -m "copy: rewrite point-economy text for the credit system (rules dialogs, balance card, onboarding)"
```

---

### Task 10: Storage migration tool (existing public files → private paths)

Existing posts (≈5 in production) hold `fileNames: ['<ts>_<name>']` + public `fileUrls`, with the object at the **bucket root**. After Task 6's rules + Task 8's client, those posts have no `filePaths` and are undownloadable. This script moves them.

**Files:**
- Create: `tools/migrate_storage.mjs`, `tools/test_migrate_storage_fixture.mjs`, `tools/test_migrate_storage.sh`

**Interfaces:** CLI `node migrate_storage.mjs --project <id> [--dry-run] [--delete-old]`, run by the USER with `GOOGLE_APPLICATION_CREDENTIALS` set (Claude never runs it against production). Exports the pure planner `planMigration(post, bucketHas)` for the fixture test.

Behaviour: for each `posts` doc **without** `filePaths` (and with a non-empty `fileNames`): for each `fileNames[i]`, source = the object `fileNames[i]` at the bucket root; destination = `resources/<authorId>/<fileNames[i]>`. Steps per post: (1) copy every source to its destination (skip if the destination exists — idempotent), (2) only after ALL copies of that post succeed, `update` the post with `filePaths` and delete the `fileUrls` field (`FieldValue.delete()`), (3) only with `--delete-old`, delete the root source objects. A post whose source object is missing is reported and left untouched (never half-migrated). `--dry-run` prints the plan and writes nothing. Without `--delete-old` the old public objects remain (safe to re-run; delete them in a second pass once the app works).

- [ ] **Step 1: Write the failing fixture test `tools/test_migrate_storage_fixture.mjs`**

```js
import assert from 'node:assert/strict';
import { planMigration } from './migrate_storage.mjs';

// A post with two files, both present at the root.
let plan = planMigration({ id: 'p1', authorId: 'u1', fileNames: ['1_a.pdf', '2_b.png'] }, (n) => true);
assert.deepEqual(plan, {
  ok: true,
  moves: [
    { from: '1_a.pdf', to: 'resources/u1/1_a.pdf' },
    { from: '2_b.png', to: 'resources/u1/2_b.png' },
  ],
  filePaths: ['resources/u1/1_a.pdf', 'resources/u1/2_b.png'],
});

// A missing source makes the whole post un-migratable (never half-migrated).
plan = planMigration({ id: 'p2', authorId: 'u1', fileNames: ['1_a.pdf', 'gone.pdf'] }, (n) => n !== 'gone.pdf');
assert.equal(plan.ok, false);
assert.match(plan.reason, /gone\.pdf/);

// Already migrated -> nothing to do.
assert.deepEqual(planMigration({ id: 'p3', authorId: 'u1', fileNames: ['a.pdf'], filePaths: ['resources/u1/a.pdf'] }, () => true),
  { ok: true, moves: [], filePaths: ['resources/u1/a.pdf'], skip: true });

// No files, or no author -> not migratable, with a reason.
assert.equal(planMigration({ id: 'p4', authorId: 'u1', fileNames: [] }, () => true).ok, false);
assert.equal(planMigration({ id: 'p5', fileNames: ['a.pdf'] }, () => true).ok, false);

// A name that would escape the prefix is refused.
assert.equal(planMigration({ id: 'p6', authorId: 'u1', fileNames: ['../x.pdf'] }, () => true).ok, false);
assert.equal(planMigration({ id: 'p7', authorId: 'u1', fileNames: ['a/b.pdf'] }, () => true).ok, false);

console.log('migrate_storage planner: OK');
```

`tools/test_migrate_storage.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node test_migrate_storage_fixture.mjs
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash tools/test_migrate_storage.sh`
Expected: FAIL — `./migrate_storage.mjs` not found.

- [ ] **Step 3: Create `tools/migrate_storage.mjs`**

Follow the structure/CLI conventions of `tools/migrate_ids.mjs` and `tools/backfill_post_counts.mjs` (read them first: argument parsing, `--project`, `--dry-run`, admin init, batching/printing style) and match them. Required content:

```js
// planMigration is pure so it can be unit-tested without Firebase.
export function planMigration(post, bucketHas) {
  const names = Array.isArray(post.fileNames) ? post.fileNames : [];
  if (Array.isArray(post.filePaths) && post.filePaths.length > 0) {
    return { ok: true, moves: [], filePaths: post.filePaths, skip: true };
  }
  if (!post.authorId) return { ok: false, reason: `${post.id}: no authorId` };
  if (names.length === 0) return { ok: false, reason: `${post.id}: no fileNames` };
  const moves = [];
  for (const n of names) {
    if (typeof n !== 'string' || n === '' || n.includes('/') || n.includes('..')) {
      return { ok: false, reason: `${post.id}: unsafe file name ${JSON.stringify(n)}` };
    }
    if (!bucketHas(n)) return { ok: false, reason: `${post.id}: source object missing: ${n}` };
    moves.push({ from: n, to: `resources/${post.authorId}/${n}` });
  }
  return { ok: true, moves, filePaths: moves.map((m) => m.to) };
}
```

The CLI part (guard it so importing the module in the fixture test does not run it: `if (import.meta.url === pathToFileURL(process.argv[1]).href) main()`): initialise `firebase-admin` with `projectId` from `--project` and the default bucket `<project>.firebasestorage.app`; list the root objects once (`bucket.getFiles()` with `delimiter: '/'`, `autoPaginate`) into a `Set` for `bucketHas`; for each `posts` doc run `planMigration`; print a one-line summary per post (`MIGRATE`, `SKIP (already migrated)`, `FAIL <reason>`); unless `--dry-run`: for each ok post copy objects (`bucket.file(from).copy(bucket.file(to))`, skipping an existing destination), then `posts/{id}.update({ filePaths, fileUrls: FieldValue.delete() })`, then — only with `--delete-old` — `bucket.file(from).delete()`. End with a totals line and `done`. Exit code non-zero if any post `FAIL`ed.

- [ ] **Step 4: Run to verify it passes**

Run: `bash tools/test_migrate_storage.sh`
Expected: PASS — prints `migrate_storage planner: OK`. Also run `node tools/migrate_storage.mjs --help` (or with no args) and confirm it prints usage and exits non-zero without touching anything.

- [ ] **Step 5: Commit**

```bash
git add tools/migrate_storage.mjs tools/test_migrate_storage_fixture.mjs tools/test_migrate_storage.sh
git commit -m "feat(tools): migrate_storage — move legacy public files to private resources/<uid>/ paths"
```

---

## Deploy (order-dependent — do NOT improvise)

Who runs what: **Claude** runs the `firebase deploy` steps (allowed by the user's settings rule). **The user** runs anything needing the service-account key (step 3). Run the full local suite first: `bash tools/test_functions.sh`, `bash tools/test_rules.sh`, `bash tools/test_storage_rules.sh`, `flutter analyze`, `flutter test`, `flutter build web --release`.

```
1. firebase deploy --only firestore:indexes --project kyodai-sns
   # adds credits_ledger (uid ASC, createdAt DESC). WAIT until it reads Enabled
   # in the console (the マイページ ledger query fails FAILED_PRECONDITION until then).

2. firebase deploy --only functions --project kyodai-sns
   # FIRST functions deploy in this project: the CLI will offer to enable the
   # Cloud Functions / Cloud Build / Artifact Registry / Eventarc / Cloud Run /
   # Pub/Sub APIs — accept. Firestore-trigger functions can fail the first time
   # with an Eventarc permission-propagation error: wait ~3 minutes and re-run
   # the same command (it is idempotent).
   # REQUIRED once, or downloadResource fails with "signBlob"/"iam.serviceAccounts.signBlob"
   # permission denied: grant the functions' runtime service account the
   # Service Account Token Creator role ON ITSELF:
   #   gcloud iam service-accounts add-iam-policy-binding <PROJECT_NUMBER>-compute@developer.gserviceaccount.com \
   #     --member="serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com" \
   #     --role="roles/iam.serviceAccountTokenCreator" --project kyodai-sns
   # (PROJECT_NUMBER = 932624635949.) If the user prefers the console: IAM → that
   # service account → add itself with role "Service Account Token Creator".

3. USER, with GOOGLE_APPLICATION_CREDENTIALS set (a freshly created key, deleted afterwards):
   cd tools ; node migrate_storage.mjs --project kyodai-sns --dry-run
   # review the plan, then:
   cd tools ; node migrate_storage.mjs --project kyodai-sns
   # copies + sets filePaths. Leave the old root objects (no --delete-old yet).

4. firebase deploy --only firestore:rules,storage --project kyodai-sns
   # Order matters: AFTER the migration (the new storage rules deny the old
   # public root objects) and BEFORE hosting. There is a short window where the
   # still-cached OLD web build cannot post or download — acceptable (a handful of users).

5. flutter build web --release   then   firebase deploy --only hosting --project kyodai-sns

6. After the smoke test passes and a day has gone by:
   cd tools ; node migrate_storage.mjs --project kyodai-sns --delete-old
   # removes the now-redundant public root objects (idempotent; USER runs it).
```

**Rollback:** `firebase deploy --only hosting` of the previous release does NOT restore the old economy (rules are stricter) — the old build cannot write points any more. To roll back fully, redeploy the previous `firestore.rules`/`storage.rules` from git too. Functions can stay deployed.

## Manual E2E (production smoke test, user + Claude browser)

1. Sign in with an already-verified KU account → within a few seconds the balance card shows **3 クレジット** (welcome claimed on login) and the ledger lists 「ご登録ボーナス +3」.
2. Open a course that has a migrated past exam → ダウンロード → confirm dialog says 1クレジット → file downloads, balance **2**, ledger 「資料のダウンロード −1」. Download the same post again → free, balance stays 2.
3. With balance 0 (use a second account that has not claimed, or spend down) → the confirm button is disabled / the notice says クレジットが足りません.
4. Upload a PDF as a past exam → post appears, then within ~5 s the balance rises **+3** and the ledger shows 「資料のアップロード +3」. Upload a 4th in one day → no further credit.
5. Post your first-ever review → **+2**, a second review → no credit.
6. Create a request (free, no slider). From a second account upload against it → request shows solved, the provider gets **+6** (3 upload + 3 request), the requester can download free.
7. Direct-URL check: copy an old `firebasestorage.googleapis.com/...?alt=media` URL of a migrated file → **403/denied**. Open a signed URL after 10+ minutes → expired.
8. DevTools console as a signed-in user: `firebase`-SDK write to `credit_balances/<own uid>` → permission denied.

## Self-Review

**Spec coverage (§4.3, §4.5.3–4.5.4, §6 Phase 2):**
- Credit table: signup +3 → T2; download −1 flat → T3; upload +3 w/ daily cap, dup excluded → T4; first review +2 → T4; own/requested free → T3. ✓
- Abolished economy items (royalty, milestones, penalties, 2020 cut-off, uploader price, reward slider, referral, 20pt textbook) → T8 (code), T9 (copy). ✓
- Server-authoritative ledger, clients never write balances → T2/T5 (`write: false`). ✓
- Private bucket + 10-minute signed URL via Function → T3, T4 (`index.ts` signer), T6, T10. ✓
- Request board simplified (free, fixed +3, requester free DL) → T4, T5, T8. ✓
- Rules: `credits_ledger`/`users.credits` Function-only → T5 (as `credit_balances`, P2-1). ✓
- **Not in 2A (deliberate, → Plan 2B):** takedown flow + rights-holder form + report→hide queue (§4.3 削除対応フロー), notifications, `course_stats` as a Function aggregate, tightening `users`/`talk_rooms` reads, the `ku_verified` claim (P2-7), `invitation_codes`. Phase 3: chat sub-collections, textbook market, AppStore split.

**Placeholder scan:** none — every code step carries the code; Task 8 specifies each edit with replacement code or an exact delete-target.

**Type consistency:** `Balance`/`CreditEvent`/`writeCredit`/`readBalance` (T2) are the only credit writers and are used identically in T3/T4; ledger ids `signup_<uid>`, `dl_<uid>_<postId>`, `upload_<postId>`, `fulfill_<requestId>`, `firstreview_<uid>` are the same strings in code, tests, and the Dart `CreditLedgerEntry.label` reasons (`signup_bonus`, `download`, `download_free`, `upload`, `first_review`, `request_fulfilled`). Callable names `claimWelcomeCredits` / `downloadResource` (T4 `index.ts`) match `CreditService` (T7). Region `asia-east1` in `common.ts` and `CreditService._liveInvoker`. `Post.filePaths` (T8) matches the rules' `filePaths` checks (T5), the trigger (T4), and the migration output (T10).
