# M3 — Timetable, My Page, Contact, Notifications

**Spec:** `docs/specs/2026-10-08-nextjs-migration-design.md` §4, §5, §6.2 (`/api/welcome`); 2A plan P2-2 (invitation codes).

## Tasks (done)
1. `lib/server/welcome.ts` + `POST /api/welcome`: +3 welcome, own 6-char code (`invitation_codes/{code}`), referral +3/+3, inviter cap 10, idempotent. Called once per verified session from `AuthProvider`. Tests: `tests/welcome.test.ts`.
2. `/timetable`: `user_timetables/{uid}.timetable` (`Mon_1 → courseId`, Flutter-compatible, client-written under the existing owner rule). Empty cell → slot-filtered `SearchBox` sheet → 登録; filled cell → 科目を見る / 変える / 外す. Colors from `lib/timetable.ts#assignColors` (grid order, one color per course). Tests: `tests/timetable.test.ts`.
3. `lib/server/notify.ts` (server-only writer) + `/notifications` (mark-read is the only client write). Helpful votes notify the review author.
4. `/mypage`: display name edit, credit balance + last 20 ledger rows, invitation code copy, own reviews, menu (contact, legal, logout). `/mypage/contact` writes `inquiries` (Flutter category keys).
5. Indexes: `notifications (uid, createdAt desc)`, `credits_ledger (uid, createdAt desc)`.
6. Tests run under emulator project `demo-site-test` (never touch dev data); ID tokens are built as unsigned emulator JWTs.

## Deferred
- Timetable "new review / past exam" badges per cell (needs a last-seen marker per user) — add when users ask; the bell covers re-visits for now.
