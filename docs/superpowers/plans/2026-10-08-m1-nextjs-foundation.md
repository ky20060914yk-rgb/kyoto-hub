# M1 — Next.js Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `site/` Next.js app that builds, carries the design.md tokens, signs KU students up / in / verifies them against the existing Firebase project, shows the app shell (bottom tabs on mobile, sidebar on desktop), and can verify a KU user on the server.

**Architecture:** Next.js App Router in `site/`. Design tokens live once in `site/app/globals.css` as Tailwind v4 `@theme` variables. The browser talks to Firebase through the JS SDK (`lib/firebase/client.ts`); the server uses the Admin SDK (`lib/server/admin.ts`, `server-only`) and verifies a Bearer ID token in `lib/server/auth.ts`. Auth state is client-side (`AuthProvider` context); `(app)` routes redirect to `/login` when signed out.

**Tech Stack:** Next.js 16.4 (App Router, TypeScript, Turbopack), React 19, Tailwind CSS 4.3, firebase 13, firebase-admin 14, Vitest 5, Firebase Emulators (Auth/Firestore) with JDK 21.

**Spec:** `docs/specs/2026-10-08-nextjs-migration-design.md` (§3, §4, §5, §7, §10 M1) and `design.md`.

## Global Constraints

- KU email pattern (verbatim from `firestore.rules`): lower-cased address must match `^[^@]+@st[.]kyoto-u[.]ac[.]jp$`.
- Firebase project `kyodai-sns`; web config from `lib/firebase_options.dart` (`web`). Region for App Hosting `asia-east1`.
- `users/{uid}` doc written at signup keeps the Flutter shape: `uid, university_id:'kyoto_u', email, displayName:'京大生_NNNN', points:0, invitationCode:'', createdAt (ISO string), downloadCount:0, isVerified:false, pendingReferralCode`.
- No service-account key in the repo. Admin SDK uses ADC (App Hosting) or the emulators locally.
- No color/size literals outside `globals.css`: no `#hex`, `rgb(`, or Tailwind arbitrary values (`-[...]` with px/#) in `site/app` or `site/components` (enforced by `tests/tokens.test.ts`).
- No animation library. Durations: instant 100ms, fast 180ms, normal 260ms, slow 400ms.
- Production is not touched in M1: no `firebase deploy`, no App Hosting backend creation (owner does that).
- User's shell is PowerShell 5.1; scripts run under Git Bash. Emulators need `JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"`.

## File Structure

- `site/` scaffold (create-next-app): `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`
- `site/app/globals.css` — design tokens (`@theme`) + base styles + reduced-motion
- `site/app/layout.tsx` — `<html lang="ja">`, Noto Sans JP, `AuthProvider`
- `site/lib/ku.ts` — `isKuEmail(email): boolean` (shared by client and server)
- `site/lib/firebase/client.ts` — `firebaseApp`, `auth`, `db` (emulator when `NEXT_PUBLIC_USE_EMULATORS=1`)
- `site/lib/firebase/auth-actions.ts` — `signUp`, `signIn`, `resendVerification`, `refreshVerified`, `resetPassword`, `signOutUser`
- `site/components/auth/AuthProvider.tsx` — `useAuth(): { user, loading, verified }`
- `site/lib/server/admin.ts` — `adminApp`, `adminAuth`, `adminDb`
- `site/lib/server/auth.ts` — `requireKuUser(req): Promise<KuUser>`, `HttpError`
- `site/app/api/me/route.ts` — `GET` returns `{uid,email}` (smoke endpoint for requireKuUser)
- `site/app/(auth)/{login,signup,verify,reset}/page.tsx`
- `site/app/(app)/layout.tsx` — guard + `AppShell`
- `site/app/(app)/{search,timetable,textbooks,mypage,notifications}/page.tsx` — placeholders replaced in later milestones
- `site/components/shell/{AppShell,BottomTabs,Sidebar,AppBar}.tsx`, `site/components/shell/nav.ts`
- `site/components/ui/{Button,TextField}.tsx`
- `site/tests/*.test.ts`, `site/vitest.config.ts`
- `site/apphosting.yaml`
- root `firebase.json` — add `storage` emulator port; root `tools/test_site.sh`

---

### Task 1: Scaffold `site/` with tokens and the token guard

**Files:** Create `site/` via create-next-app; Modify `site/app/globals.css`, `site/app/layout.tsx`, `site/app/page.tsx`; Create `site/vitest.config.ts`, `site/tests/tokens.test.ts`

**Interfaces:** Produces Tailwind utilities named after design.md tokens: colors `brand brand-pressed brand-subtle bg surface surface-muted border border-strong text text-2 text-disabled success success-bg warning warning-bg danger danger-bg star`, course colors `course-{blue,green,yellow,orange,red,purple,teal,gray}` and `course-{...}-fg`; radii `rounded-s|m|l|xl|full`; font sizes `text-display|title|heading|body|caption|label` (+ LP `text-hero|h2|h3|lead|stat`); durations `duration-instant|fast|normal|slow`.

- [ ] **Step 1:** `cd site/..; npx create-next-app@16.4.0 site --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --turbopack --yes`; `cd site; npm i firebase@13 firebase-admin@14 server-only; npm i -D vitest@5`.
- [ ] **Step 2: Write the failing test** `tests/tokens.test.ts`: walks `app/` and `components/` (`.ts/.tsx`), fails on `/#[0-9a-fA-F]{3,8}\b/`, `/rgba?\(/`, `/-\[[^\]]*(px|#|rem)/`, listing offending file:line.
- [ ] **Step 3:** Run `npx vitest run tests/tokens.test.ts` → FAIL (scaffold page has arbitrary values).
- [ ] **Step 4:** Replace `globals.css` with the token sheet (values verbatim from design.md §2–§5), replace `page.tsx` with a token-only placeholder, set `layout.tsx` to `lang="ja"` + `Noto_Sans_JP({weight:['400','500','700'], subsets:['latin'], display:'swap'})`.
- [ ] **Step 5:** Run test → PASS; `npm run build` → success.
- [ ] **Step 6:** Commit `feat(site): scaffold Next.js app with design tokens`.

### Task 2: KU email check + Firebase client + AuthProvider

**Files:** Create `site/lib/ku.ts`, `site/lib/firebase/client.ts`, `site/lib/firebase/auth-actions.ts`, `site/components/auth/AuthProvider.tsx`, `site/tests/ku.test.ts`, `site/.env.local.example`

**Interfaces:** Produces `isKuEmail(email: string): boolean`; `auth`, `db`; `signUp(email, password, referralCode?) : Promise<void>` (creates user, sends verification, writes `users/{uid}`), `signIn(email,password)`, `resendVerification()`, `refreshVerified(): Promise<boolean>` (reload + `getIdToken(true)`), `resetPassword(email)`, `signOutUser()`; `useAuth(): {user: User|null, loading: boolean, verified: boolean}`; `authErrorMessage(e: unknown): string` (Japanese).

- [ ] **Step 1: Failing test** `tests/ku.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isKuEmail } from '@/lib/ku';
describe('isKuEmail', () => {
  it.each([
    ['taro.kyodai.12a@st.kyoto-u.ac.jp', true],
    ['A@ST.KYOTO-U.AC.JP', true],
    ['evil@evil.com@st.kyoto-u.ac.jp', false],
    ['a@st.kyoto-u.ac.jp.attacker.com', false],
    ['a@kyoto-u.ac.jp', false],
    ['@st.kyoto-u.ac.jp', false],
    [' a@st.kyoto-u.ac.jp', false],
  ])('%s -> %s', (e, ok) => expect(isKuEmail(e)).toBe(ok));
});
```
- [ ] **Step 2:** Run → FAIL (module missing).
- [ ] **Step 3:** `export const isKuEmail = (e: string) => /^[^@\s]+@st[.]kyoto-u[.]ac[.]jp$/.test(e.toLowerCase());` then client.ts / auth-actions.ts / AuthProvider.tsx.
- [ ] **Step 4:** Run → PASS. Commit `feat(site): KU email check, Firebase client and auth provider`.

### Task 3: Server-side KU verification (`requireKuUser`)

**Files:** Create `site/lib/server/admin.ts`, `site/lib/server/auth.ts`, `site/app/api/me/route.ts`, `site/tests/server-auth.test.ts`, `tools/test_site.sh`; Modify root `firebase.json` (add `"storage": {"port": 9199}`)

**Interfaces:** Produces `class HttpError extends Error { status: number }`; `type KuUser = { uid: string; email: string }`; `requireKuUser(req: Request): Promise<KuUser>` — 401 no/invalid token, 403 non-KU or unverified; `jsonError(e: unknown): Response`.

- [ ] **Step 1: Failing test** (Auth emulator): create users via Admin SDK — verified KU, unverified KU, verified non-KU; mint ID tokens via the emulator REST `signInWithPassword`; assert: missing header → 401, garbage → 401, unverified → 403, gmail → 403, verified KU → `{uid,email}`.
- [ ] **Step 2:** `bash tools/test_site.sh` → FAIL.
- [ ] **Step 3:** Implement admin.ts (`getApps()[0] ?? initializeApp({projectId: 'kyodai-sns'})`) and auth.ts.
- [ ] **Step 4:** Run → PASS. Commit `feat(site): server-side KU user verification`.

### Task 4: Auth screens

**Files:** Create `site/app/(auth)/layout.tsx`, `login/page.tsx`, `signup/page.tsx`, `verify/page.tsx`, `reset/page.tsx`, `site/components/ui/Button.tsx`, `site/components/ui/TextField.tsx`

- Signup: email (KU only, inline error), password ≥ 8, optional 招待コード → `signUp` → `/verify`.
- Verify: shows the address, 「確認メールを再送」 (60s cooldown), polls `refreshVerified()` every 5s → `/search`.
- Login: email+password → verified ? `/search` : `/verify`. Note under form: 「以前メールのリンクで登録した方は『パスワードを忘れた』から設定してください」.
- Reset: sends reset mail, neutral confirmation (does not reveal whether the address exists).
- [ ] Build passes, token test passes. Manual check in browser against emulators. Commit `feat(site): signup, login, verify and reset screens`.

### Task 5: App shell

**Files:** Create `site/components/shell/nav.ts`, `AppShell.tsx`, `BottomTabs.tsx`, `Sidebar.tsx`, `AppBar.tsx`, `site/app/(app)/layout.tsx`, the five placeholder pages.

**Interfaces:** Produces `NAV: {href, label, icon}[]` (さがす `/search`, 時間割 `/timetable`, 教科書 `/textbooks`, マイページ `/mypage`); `<AppShell title>` wrapper used by every `(app)` page through the layout; `<AppBar title>`.

- Mobile (<768px): bottom tabs 64px, active = brand icon+label and a 56×32 `brand-subtle` pill (transition `duration-fast`). Desktop: 240px sidebar, active row `bg-brand-subtle text-brand`.
- Guard: `loading` → skeleton; no user → `router.replace('/login')`; unverified → `/verify`.
- [ ] Build + token test pass; screenshot 375px and 1280px. Commit `feat(site): app shell with bottom tabs and sidebar`.

### Task 6: App Hosting config

**Files:** Create `site/apphosting.yaml` (`runConfig: {minInstances: 0, maxInstances: 2, region via backend}`, `env` for `NEXT_PUBLIC_FIREBASE_*` values from `firebase_options.dart` web block, `availability: [BUILD, RUNTIME]`).
- [ ] `npm run build` passes. Commit `chore(site): App Hosting config`.
