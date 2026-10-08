# M5 — Textbook marketplace

**Spec:** redesign spec §4.4; migration spec §6.3.

## Done
1. `lib/domain/textbook.ts`: types 譲ります/売ります/買いたい, conditions, campus hand-off presets, price ≤ 30,000円, ≤ 3 photos (must be the caller's own `textbook_photos/{uid}/` URLs), 30-day listings.
2. `lib/server/textbooks.ts` (tests: `tests/textbooks.test.ts`): `createListing` (max 20 open; give/sell for a course notifies open 買いたい for the same courseKey), `updateListing` (close / extend 30 days, seller only), `openChat` (one chat per listing × buyer, seller notified), `completeChat` (closes the listing), `rateTrade` (once per side after completion; aggregates in server-only `user_stats/{uid}`).
3. Routes: `POST/PATCH /api/textbooks`, `POST/PATCH /api/textbooks/chats`.
4. Rules: `textbook_listings`, `trade_ratings`, `user_stats` server-only writes; `chats` member-read, members may only bump `lastMessage`/`lastAt`; `chats/{id}/messages` member create as themselves (1–1000 chars). Indexes: listings `(status, createdAt desc)`, chats `(members contains, lastAt desc)`.
5. UI: `/textbooks` (search, type tabs, card grid, 出品・募集 sheet with photo upload and course picker), `/textbooks/[id]` (photos, details, seller rating, apply / seller's inbox, close / re-open), `/textbooks/chats`, `/textbooks/chats/[id]` (real-time messages, complete, rate).

## Deviation
- No scheduled 「まだ有効？」 reminder: listings simply drop out of the list after 30 days and the seller can re-open them. Add a scheduled job if stale listings become a problem.
- Legacy `textbook_requests` / `talk_rooms` / `transactions` are not migrated (spec §6.1).
