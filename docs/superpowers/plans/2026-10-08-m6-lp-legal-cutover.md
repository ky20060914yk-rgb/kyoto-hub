# M6 — Landing page, legal pages, migration, cutover

**Spec:** migration spec §8, §10 M6; `design.md` §7.

## Done
1. `/` LP (Notion + Studyplus): sticky header, hero with 「楽単」 pill and a mock built from the real course components, stats band (course count live, review count shown once ≥ 100), four feature cards, trust section, brand CTA block, footer with legal links. Scroll reveal and count-up via `components/lp/Reveal.tsx` (IntersectionObserver, once, reduced-motion aware).
2. `/legal/terms`, `/legal/privacy` (drafts for the owner), `/legal/takedown` (public form → `POST /api/takedown`; works without a resource id). Resource cards show their id.
3. `tools/migrate_to_next.mjs` (+ `test_migrate_to_next.sh` / fixture): legacy posts get `courseKey`/`filePaths` (files copied into `resources/`), requests get `courseKey`, post counters recounted. Dry run by default, idempotent.
4. `docs/cutover.md`: owner steps (Blaze, App Hosting backend, domain, legal review), cutover-day order (migrate → rules → rollout → redirect), post-cutover cleanup.
5. `design.md` §8.1 rewritten for Next.js (token → utility mapping, banned literals, shared components).
6. Verified: all pages at 375px without horizontal scroll; build passes without database access.

## Not done (owner decision)
- Playwright E2E and Lighthouse runs: the flows were exercised by hand on the emulators.
