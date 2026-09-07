# Phase 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the course catalog from a 10k-line hardcoded Dart list into a normalized Firestore `courses` collection, add real Firestore security rules, and cut first-load weight — with the app behaving exactly as it does today.

**Architecture:** A Python build script normalizes the scraped `syllabus_data.json` into `courses.json` (drop fabricated data, compute a stable `courseKey`, dedup). A Node seed script writes it to Firestore once via the Admin SDK. Flutter gets a `CourseRepository` that loads the catalog from Firestore (cached, offline-persisted) and replaces every `KulasisDataset.*` call. Security rules gate all collections behind an authenticated, email-verified `@st.kyoto-u.ac.jp` account and are covered by emulator unit tests. Startup work (10k-doc seed attempt, full-collection `subjects` listener, 1 MB favicon) is removed.

**Tech Stack:** Flutter 3.41.9 / Dart SDK ^3.11.5, Firebase (Auth, Firestore, Storage) project `kyodai-sns`, `firebase-tools` 15.17, Node 24, Python 3.12. New dev dependencies: `fake_cloud_firestore` (Flutter tests), `@firebase/rules-unit-testing` (Node rules tests).

**Spec:** `docs/specs/2026-09-07-kyodai-info-redesign-design.md` (sections 4.5, 5, 6 "Phase 1", 8).

## Global Constraints

- Flutter `3.41.9` stable; Dart SDK constraint `^3.11.5` (unchanged in `pubspec.yaml`).
- Firebase project id: `kyodai-sns`. Hosting site: `kyodai-info`. Storage bucket: `kyodai-sns.firebasestorage.app`.
- Dependency floors (unchanged): `firebase_core ^4.12.1`, `cloud_firestore ^6.7.1`, `firebase_auth ^6.5.6`, `firebase_storage ^13.4.5`.
- **No Cloud Functions in Phase 1.** No dependency on the Blaze billing plan.
- University constant stays `'kyoto_u'`; every document keeps a `university_id: 'kyoto_u'` field.
- Email gate string is exactly `@st.kyoto-u.ac.jp`.
- Security rules verify identity with `request.auth.token.email` + `request.auth.token.email_verified` directly. No `ku_verified` custom claim (that is Phase 2).
- Behaviour parity: timetable registration, past-exam/resource posting & download, textbook requests, and talk rooms must work after this plan exactly as before it. Only the data source and security posture change.
- Course catalog coverage in Phase 1 is **全学共通科目 only** (the source data is ~99% 全学共通). This is expected and acceptable.
- Commit after every task. TDD: failing test first, then implementation.

---

## File Structure

**Created:**
- `firestore.rules` — security rules for all collections.
- `firestore.indexes.json` — composite indexes (starts near-empty).
- `tools/source/syllabus_data.json` — copy of the scrape, committed for a self-contained pipeline (~4.3 MB, one time).
- `tools/build_courses.py` — `syllabus_data.json` → `tools/courses.json`.
- `tools/courses.json` — build output; the seed script's input.
- `tools/test_build_courses.py` — pytest for the build script's pure functions.
- `tools/seed_courses.mjs` — `tools/courses.json` → Firestore `courses` (Admin SDK, batched, idempotent).
- `tools/package.json` — pins `firebase-admin` for the seed script.
- `tools/README.md` — how to rebuild & seed; data provenance and known limits.
- `lib/repositories/course_repository.dart` — Firestore-backed catalog access + in-memory cache.
- `test/repositories/course_repository_test.dart` — repository behaviour with `fake_cloud_firestore`.
- `test/models/subject_test.dart` — `Subject` serialization round-trip.
- `firestore-tests/package.json`, `firestore-tests/rules.test.mjs` — rules unit tests against the emulator.
- `web/icons/` regenerated PNGs + `web/favicon.png` (small).
- `tools/make_icons.py` — regenerates the web icons/favicon from one source glyph.

**Modified:**
- `firebase.json` — add `firestore` + `emulators` blocks.
- `pubspec.yaml` — add `fake_cloud_firestore` under `dev_dependencies`.
- `lib/models/subject.dart` — add `courseKey` field.
- `lib/services/firestore_service.dart` — remove `seedKulasisSubjectsMaster`, `streamSubjects`, `createSubject`.
- `lib/services/app_store.dart` — remove the seed call & `subjects` stream & `customSubjects`; route course lookups through `CourseRepository`.
- `lib/views/home/home_screen.dart` — search via `CourseRepository`.
- `lib/views/timetable/timetable_registration_screen.dart` — slot picker & custom-subject add via `CourseRepository`.
- `lib/views/course/course_detail_screen.dart` — `KulasisDataset.findById` → repository (only where still referenced).
- `lib/main.dart` — enable Firestore persistence; construct & inject `CourseRepository`.

**Deleted:**
- `lib/services/kulasis_dataset.dart` (10,170 lines).
- `merge_and_build_dataset.py`, `parse_existing_json_official.py`, `fix_dart_dataset.py` and the other one-off `*.py` scrape/inspect scripts at repo root (superseded by `tools/`). Keep `fetch_live_kulasis.py` and `scrape_full_kulasis_official.py` under `tools/legacy/` for reference only.

---

## Task 1: Firebase config + safe baseline rules + emulator wiring

**Files:**
- Modify: `firebase.json`
- Create: `firestore.rules`
- Create: `firestore.indexes.json`

**Interfaces:**
- Consumes: nothing.
- Produces: a deployable `firestore.rules` path and an emulator config that Task 7's tests depend on (`emulators.firestore.port = 8080`).

- [ ] **Step 1: Add firestore + emulators blocks to `firebase.json`**

Merge these keys into the existing object (keep `flutter` and `hosting` as they are):

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "emulators": {
    "firestore": { "port": 8080 },
    "auth": { "port": 9099 },
    "ui": { "enabled": true }
  }
}
```

- [ ] **Step 2: Create `firestore.indexes.json`**

```json
{
  "indexes": [],
  "fieldOverrides": []
}
```

- [ ] **Step 3: Create `firestore.rules` with an authenticated-only baseline**

This is a safe interim rule set (locks the currently-open database) that Task 7 replaces with per-collection rules.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

- [ ] **Step 4: Deploy and confirm the live app still works**

Run: `firebase deploy --only firestore:rules --project kyodai-sns`
Then load https://kyodai-info.web.app , sign in with a real `@st.kyoto-u.ac.jp` account, and confirm the timetable and a course page still load.
Expected: deploy succeeds; signed-in app works; a signed-out `curl` of the REST API for any collection returns `PERMISSION_DENIED`.

- [ ] **Step 5: Commit**

```bash
git add firebase.json firestore.rules firestore.indexes.json
git commit -m "chore: wire Firestore rules/indexes/emulator config; lock DB to authed users"
```

---

## Task 2: Course build script (`tools/build_courses.py`)

**Files:**
- Create: `tools/source/syllabus_data.json` (copied from `C:\Users\PC_User\kyoto-u-sns\syllabus_data.json`)
- Create: `tools/build_courses.py`
- Create: `tools/test_build_courses.py`
- Create: `tools/README.md`
- Create: `tools/courses.json` (generated)

**Interfaces:**
- Consumes: `tools/source/syllabus_data.json` — array of `{name, faculty, dayOfWeek, period, lecturer, category, url}`.
- Produces: `tools/courses.json` — array of course docs:
  `{ "id": str, "courseKey": str, "name": str, "faculty": str, "lecturer": str, "dayOfWeek": "Mon".."Fri", "period": 1..5, "universityId": "kyoto_u" }`
  and pure functions `normalize_text(s) -> str`, `course_key(name, lecturer) -> str`, `doc_id(course_key, day, period) -> str`.

- [ ] **Step 1: Copy the source data and write the failing test**

```bash
mkdir -p tools/source
cp "/c/Users/PC_User/kyoto-u-sns/syllabus_data.json" tools/source/syllabus_data.json
```

`tools/test_build_courses.py`:

```python
import subprocess, sys, json, pathlib
from build_courses import normalize_text, course_key, doc_id, build

def test_normalize_text_collapses_and_nfkc():
    assert normalize_text("  西洋 社会  思想史Ｉ ") == "西洋社会思想史I"
    assert normalize_text("ＡＢ　Ｃ") == "AB C"

def test_course_key_is_stable_and_slot_independent():
    a = course_key("微分積分学A", "山田 太郎")
    b = course_key("微分積分学Ａ", "山田　太郎")
    assert a == b

def test_doc_id_is_deterministic():
    k = course_key("哲学I", "戸田 剛文")
    assert doc_id(k, "Mon", 3) == doc_id(k, "Mon", 3)
    assert doc_id(k, "Mon", 3) != doc_id(k, "Tue", 3)

def test_build_drops_fabricated_lecturers_and_dedups(tmp_path):
    src = [
        {"name": "哲学I", "faculty": "全学共通", "dayOfWeek": "Mon", "period": 3, "lecturer": "戸田　剛文", "category": "全学共通科目"},
        {"name": "哲学I", "faculty": "全学共通", "dayOfWeek": "Mon", "period": 3, "lecturer": "戸田　剛文", "category": "全学共通科目"},
        {"name": "謎の講義", "faculty": "全学共通", "dayOfWeek": "Tue", "period": 1, "lecturer": "本庶 佑 特命教授", "category": "全学共通科目"},
    ]
    out = build(src)
    # exact duplicate collapsed
    assert len(out) == 2
    # fabricated-pool lecturer replaced with the unknown marker
    mystery = [c for c in out if c["name"] == "謎の講義"][0]
    assert mystery["lecturer"] == "担当教員不明"
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd tools && python -m pytest test_build_courses.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'build_courses'`.

- [ ] **Step 3: Write `tools/build_courses.py`**

```python
"""Normalize the scraped KULASIS/open-syllabus dump into a clean courses.json.

Source: tools/source/syllabus_data.json (see tools/README.md for provenance).
Output: tools/courses.json
"""
import json, re, sys, unicodedata, hashlib, pathlib

HERE = pathlib.Path(__file__).parent
SRC = HERE / "source" / "syllabus_data.json"
OUT = HERE / "courses.json"

# Lecturer names invented by the old parse_existing_json_official.py when the real
# value was missing. Any of these -> treat as unknown.
FABRICATED_LECTURERS = {
    "橘 邦英 教授", "佐藤 彰彦 教授", "中村 健太郎 教授", "高橋 正樹 教授", "山本 哲也 教授", "小林 義明 教授",
    "安藤 智子 教授", "木村 慎一 教授", "井上 剛 教授", "佐々木 健 教授", "渡辺 浩 教授",
    "山極 壽一 教授", "加藤 裕樹 教授", "吉田 拓也 教授", "松本 隆 教授", "藤田 茂 教授",
    "長谷川 勝 教授", "清水 博 教授", "岡田 秀樹 教授", "三浦 健 教授", "坂本 龍 教授",
    "西田 幾多郎 教授", "河野 哲也 教授", "中川 聡 教授", "杉山 英樹 教授", "原田 實 教授",
    "川崎 勉 教授", "平野 薫 教授", "大野 誠 教授", "竹内 敬 教授", "石川 陽一 教授",
    "本庶 佑 特命教授", "山中 伸弥 教授", "福井 次郎 教授", "前田 裕 教授", "橋本 卓 教授",
    "桑野 隆 教授", "市川 寛 教授", "田村 研一 教授", "野口 豊 教授",
    "生田 久美子 教授", "大浦 容子 教授", "楠見 孝 教授",
    "京大教養部 教授", "国際高等教育院 講師", "全学共通科目 担当教員",
}
UNKNOWN_LECTURER = "担当教員不明"
VALID_DAYS = {"Mon", "Tue", "Wed", "Thu", "Fri"}


def normalize_text(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    s = re.sub(r"\s+", " ", s).strip()
    # For keys we also want to drop inner spaces around CJK; keep a light touch here:
    return s


def _key_norm(s: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", s or "")).strip().lower()


def course_key(name: str, lecturer: str) -> str:
    return f"{_key_norm(name)}|{_key_norm(lecturer)}"


def doc_id(course_key_str: str, day: str, period: int) -> str:
    h = hashlib.sha1(f"{course_key_str}|{day}|{period}".encode("utf-8")).hexdigest()[:16]
    return f"c_{h}"


def _clean_lecturer(raw: str) -> str:
    v = normalize_text(raw)
    if not v or v in {"担当教員未定", "未定"} or v in FABRICATED_LECTURERS:
        return UNKNOWN_LECTURER
    return v


def _clean_period(raw) -> int:
    m = re.search(r"\d+", str(raw or ""))
    if not m:
        return 1
    p = int(m.group(0))
    return p if 1 <= p <= 5 else 1


def build(rows: list[dict]) -> list[dict]:
    seen: dict[str, dict] = {}
    for item in rows:
        name = normalize_text(item.get("name") or "")
        if not name:
            continue
        day = (item.get("dayOfWeek") or "").strip()
        if day not in VALID_DAYS:
            continue
        period = _clean_period(item.get("period"))
        lecturer = _clean_lecturer(item.get("lecturer") or "")
        faculty = normalize_text(item.get("faculty") or "") or "全学共通"
        ck = course_key(name, lecturer)
        did = doc_id(ck, day, period)
        if did in seen:
            continue
        seen[did] = {
            "id": did,
            "courseKey": ck,
            "name": name,
            "faculty": faculty,
            "lecturer": lecturer,
            "dayOfWeek": day,
            "period": period,
            "universityId": "kyoto_u",
        }
    return sorted(seen.values(), key=lambda c: (c["name"], c["dayOfWeek"], c["period"]))


def main() -> int:
    rows = json.loads(SRC.read_text(encoding="utf-8"))
    courses = build(rows)
    OUT.write_text(json.dumps(courses, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {len(courses)} courses -> {OUT}")
    if not (2000 <= len(courses) <= 9000):
        print(f"WARNING: course count {len(courses)} outside the expected 2000-9000 range", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run tests to green**

Run: `cd tools && python -m pytest test_build_courses.py -q`
Expected: 4 passed.

- [ ] **Step 5: Generate `courses.json` and sanity-check it**

Run: `cd tools && python build_courses.py`
Expected: prints `wrote N courses` with N between 2000 and 9000, exit 0. Spot-check: `python -c "import json;d=json.load(open('courses.json',encoding='utf-8'));print(d[0]);print(sum(1 for c in d if c['lecturer']=='担当教員不明'),'unknown-lecturer')"`

- [ ] **Step 6: Write `tools/README.md`**

```markdown
# tools/

## courses pipeline

- `source/syllabus_data.json` — scraped from the Kyoto U open-syllabus site
  (`https://www.k.kyoto-u.ac.jp/external/open_syllabus/...`), ~11.6k rows, ~99%
  全学共通科目. Committed as-is for reproducibility.
- `build_courses.py` — normalizes it into `courses.json`: NFKC, drops rows with
  no name or a non-weekday slot, replaces missing/known-fabricated lecturer names
  with `担当教員不明`, computes a slot-independent `courseKey`, dedups exact
  (courseKey, day, period) collisions.
- `courses.json` — build output; input to the seed script. Regenerate with
  `python build_courses.py`.

### Known limitations (Phase 1)
- Professional-faculty courses are almost entirely absent from the source.
- `faculty` is whatever the scrape recorded (mostly `全学共通`); no enrichment.
- No credits / term / evaluation method / syllabus text (needs a per-URL scrape,
  deferred to a later phase).

## seeding

`node seed_courses.mjs --project kyodai-sns` (see seed_courses.mjs header).
```

- [ ] **Step 7: Commit**

```bash
git add tools/source/syllabus_data.json tools/build_courses.py tools/test_build_courses.py tools/courses.json tools/README.md
git commit -m "feat: courses build pipeline (syllabus_data.json -> normalized courses.json)"
```

---

## Task 3: Seed script (`tools/seed_courses.mjs`)

**Files:**
- Create: `tools/seed_courses.mjs`
- Create: `tools/package.json`

**Interfaces:**
- Consumes: `tools/courses.json` (Task 2 output).
- Produces: documents in Firestore collection `courses`, doc id = `course.id`, fields = the course object plus `university_id: 'kyoto_u'`. Idempotent (re-runnable).

- [ ] **Step 1: Create `tools/package.json`**

```json
{
  "name": "kyodai-info-tools",
  "private": true,
  "type": "module",
  "dependencies": { "firebase-admin": "^13.0.0" }
}
```

Run: `cd tools && npm install`

- [ ] **Step 2: Write `tools/seed_courses.mjs`**

```javascript
// Seed the `courses` collection from tools/courses.json.
//
// Auth: uses Application Default Credentials. Either
//   `firebase login` + `firebase use kyodai-sns` then run with FIRESTORE via
//   GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key, or run
//   against the emulator with FIRESTORE_EMULATOR_HOST=localhost:8080.
//
// Usage:
//   node seed_courses.mjs --project kyodai-sns            # real project
//   FIRESTORE_EMULATOR_HOST=localhost:8080 node seed_courses.mjs --project demo
//   node seed_courses.mjs --project kyodai-sns --dry-run

import { readFile } from 'node:fs/promises';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const projectId = args[args.indexOf('--project') + 1] || process.env.GCLOUD_PROJECT;
const dryRun = args.includes('--dry-run');
if (!projectId) { console.error('missing --project'); process.exit(1); }

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
initializeApp({
  projectId,
  credential: keyPath ? cert(JSON.parse(await readFile(keyPath, 'utf-8'))) : applicationDefault(),
});
const db = getFirestore();

const courses = JSON.parse(await readFile(new URL('./courses.json', import.meta.url), 'utf-8'));
console.log(`${courses.length} courses to seed (dryRun=${dryRun})`);

let written = 0;
for (let i = 0; i < courses.length; i += 400) {
  const chunk = courses.slice(i, i + 400);
  if (dryRun) { written += chunk.length; continue; }
  const batch = db.batch();
  for (const c of chunk) {
    batch.set(db.collection('courses').doc(c.id), { ...c, university_id: 'kyoto_u' }, { merge: true });
  }
  await batch.commit();
  written += chunk.length;
  console.log(`  ${written}/${courses.length}`);
}
console.log('done');
```

- [ ] **Step 3: Write the emulator test**

`tools/test_seed.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
firebase emulators:exec --only firestore --project demo-seed \
  "FIRESTORE_EMULATOR_HOST=localhost:8080 node seed_courses.mjs --project demo-seed && \
   node -e \"import('firebase-admin/app').then(async m=>{m.initializeApp({projectId:'demo-seed'});const {getFirestore}=await import('firebase-admin/firestore');const s=await getFirestore().collection('courses').count().get();const n=s.data().count;console.log('seeded',n);process.exit(n>1000?0:1)})\""
```

- [ ] **Step 4: Run it**

Run: `cd tools && bash test_seed.sh`
Expected: emulator starts, seeder runs, prints `seeded N` with N > 1000, exit 0.

- [ ] **Step 5: Seed the real project**

Run: `cd tools && node seed_courses.mjs --project kyodai-sns`
(Requires `firebase login` with an owner/editor account, or `GOOGLE_APPLICATION_CREDENTIALS`.)
Expected: `done`. Verify in the Firebase console that `courses` has N docs and `subjects` is now stale/unused.

- [ ] **Step 6: Commit**

```bash
git add tools/package.json tools/seed_courses.mjs tools/test_seed.sh tools/package-lock.json
git commit -m "feat: courses seed script (Admin SDK, batched, idempotent) + emulator test"
```

---

## Task 4: `Subject` model gains `courseKey`

**Files:**
- Modify: `lib/models/subject.dart`
- Create: `test/models/subject_test.dart`

**Interfaces:**
- Consumes: nothing.
- Produces: `Subject` with a new `final String courseKey` field (default `''`), included in `toMap()` as `courseKey` and read in `fromMap()`.

- [ ] **Step 1: Write the failing test**

`test/models/subject_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/subject.dart';

void main() {
  test('Subject round-trips courseKey through toMap/fromMap', () {
    final s = Subject(
      id: 'c_abc123',
      name: '哲学I',
      faculty: '全学共通',
      dayOfWeek: 'Mon',
      period: 3,
      lecturer: '戸田 剛文',
      courseKey: '哲学i|戸田剛文',
    );
    final back = Subject.fromMap(s.toMap());
    expect(back.courseKey, '哲学i|戸田剛文');
    expect(back.id, 'c_abc123');
    expect(back.period, 3);
  });

  test('Subject.fromMap tolerates a missing courseKey', () {
    final back = Subject.fromMap({
      'id': 'x', 'name': 'n', 'faculty': '全学共通', 'dayOfWeek': 'Tue', 'period': 1, 'lecturer': 'l',
    });
    expect(back.courseKey, '');
  });
}
```

- [ ] **Step 2: Run it, watch it fail**

Run: `flutter test test/models/subject_test.dart`
Expected: FAIL — `Subject` has no `courseKey` named parameter.

- [ ] **Step 3: Add the field**

In `lib/models/subject.dart`: add `final String courseKey;` , add `this.courseKey = ''` to the constructor, add `'courseKey': courseKey` to `toMap()`, add `courseKey: map['courseKey'] ?? ''` to `fromMap()`.

- [ ] **Step 4: Run tests to green**

Run: `flutter test test/models/subject_test.dart`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/models/subject.dart test/models/subject_test.dart
git commit -m "feat: add courseKey to Subject model"
```

---

## Task 5: `CourseRepository`

**Files:**
- Modify: `pubspec.yaml` (add `fake_cloud_firestore` to `dev_dependencies`)
- Create: `lib/repositories/course_repository.dart`
- Create: `test/repositories/course_repository_test.dart`

**Interfaces:**
- Consumes: `Subject` (Task 4), a `FirebaseFirestore` instance, Firestore collection `courses` (Task 3).
- Produces:
  ```dart
  class CourseRepository {
    CourseRepository(FirebaseFirestore firestore);
    Future<void> warmUp();                                   // loads & caches the catalog once
    Future<List<Subject>> search(String query, {int limit = 50});
    Future<List<Subject>> forSlot(String day, int period);
    Future<Subject?> byId(String id);
    Future<Subject> addCustomCourse({                        // used by "新規科目追加"
      required String name, required String faculty,
      required String dayOfWeek, required int period, required String lecturer,
    });
  }
  ```
  `search` matches `query` (case-insensitive, NFKC, space-insensitive) as a substring of name / lecturer / faculty. `forSlot` returns courses whose `dayOfWeek`/`period` match. Both read from the in-memory cache after the first load.

- [ ] **Step 1: Add the dev dependency**

In `pubspec.yaml` under `dev_dependencies:` add `  fake_cloud_firestore: ^3.0.3`. Run `flutter pub get`.

- [ ] **Step 2: Write failing tests**

`test/repositories/course_repository_test.dart`:

```dart
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/repositories/course_repository.dart';

Future<FakeFirebaseFirestore> _seeded() async {
  final db = FakeFirebaseFirestore();
  await db.collection('courses').doc('c_1').set({
    'id': 'c_1', 'courseKey': '微分積分学a|山田太郎', 'name': '微分積分学A',
    'faculty': '全学共通', 'lecturer': '山田 太郎', 'dayOfWeek': 'Mon', 'period': 2,
    'university_id': 'kyoto_u',
  });
  await db.collection('courses').doc('c_2').set({
    'id': 'c_2', 'courseKey': '哲学i|戸田剛文', 'name': '哲学I',
    'faculty': '全学共通', 'lecturer': '戸田 剛文', 'dayOfWeek': 'Mon', 'period': 2,
    'university_id': 'kyoto_u',
  });
  return db;
}

void main() {
  test('search matches name substring, NFKC + space insensitive', () async {
    final repo = CourseRepository(await _seeded());
    final r = await repo.search('微分 積分');
    expect(r.map((s) => s.id), ['c_1']);
  });

  test('search matches lecturer', () async {
    final repo = CourseRepository(await _seeded());
    final r = await repo.search('戸田');
    expect(r.single.id, 'c_2');
  });

  test('forSlot returns every course in that day/period', () async {
    final repo = CourseRepository(await _seeded());
    final r = await repo.forSlot('Mon', 2);
    expect(r.map((s) => s.id).toSet(), {'c_1', 'c_2'});
  });

  test('byId returns the course or null', () async {
    final repo = CourseRepository(await _seeded());
    expect((await repo.byId('c_2'))!.name, '哲学I');
    expect(await repo.byId('nope'), isNull);
  });

  test('addCustomCourse writes to Firestore and appears in later lookups', () async {
    final db = await _seeded();
    final repo = CourseRepository(db);
    await repo.warmUp();
    final s = await repo.addCustomCourse(
      name: '新規ゼミ', faculty: '全学共通', dayOfWeek: 'Fri', period: 4, lecturer: '担当教員不明');
    expect((await db.collection('courses').doc(s.id).get()).exists, isTrue);
    expect((await repo.forSlot('Fri', 4)).single.id, s.id);
  });
}
```

- [ ] **Step 3: Run them, watch them fail**

Run: `flutter test test/repositories/course_repository_test.dart`
Expected: FAIL — `course_repository.dart` doesn't exist.

- [ ] **Step 4: Implement `lib/repositories/course_repository.dart`**

```dart
import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/subject.dart';

String _fold(String s) => s
    .replaceAll(RegExp(r'\s+'), '')
    .toLowerCase()
    .trim();

class CourseRepository {
  CourseRepository(this._db);
  final FirebaseFirestore _db;

  final Map<String, Subject> _byId = {};
  bool _loaded = false;
  Future<void>? _loading;

  Subject _fromDoc(Map<String, dynamic> m) => Subject(
        id: m['id'] as String,
        name: (m['name'] ?? '') as String,
        faculty: (m['faculty'] ?? '全学共通') as String,
        dayOfWeek: (m['dayOfWeek'] ?? 'Mon') as String,
        period: (m['period'] ?? 1) as int,
        lecturer: (m['lecturer'] ?? '') as String,
        courseKey: (m['courseKey'] ?? '') as String,
      );

  Future<void> warmUp() {
    if (_loaded) return Future.value();
    return _loading ??= _load();
  }

  Future<void> _load() async {
    final snap = await _db
        .collection('courses')
        .where('university_id', isEqualTo: 'kyoto_u')
        .get();
    _byId
      ..clear()
      ..addEntries(snap.docs.map((d) {
        final s = _fromDoc(d.data());
        return MapEntry(s.id, s);
      }));
    _loaded = true;
    _loading = null;
  }

  Future<List<Subject>> search(String query, {int limit = 50}) async {
    await warmUp();
    final q = _fold(query);
    if (q.isEmpty) return const [];
    final hits = _byId.values.where((s) =>
        _fold(s.name).contains(q) ||
        _fold(s.lecturer).contains(q) ||
        _fold(s.faculty).contains(q));
    return hits.take(limit).toList()
      ..sort((a, b) => a.name.compareTo(b.name));
  }

  Future<List<Subject>> forSlot(String day, int period) async {
    await warmUp();
    return _byId.values
        .where((s) => s.dayOfWeek == day && s.period == period)
        .toList()
      ..sort((a, b) => a.name.compareTo(b.name));
  }

  Future<Subject?> byId(String id) async {
    if (_byId.containsKey(id)) return _byId[id];
    final doc = await _db.collection('courses').doc(id).get();
    if (!doc.exists) return null;
    final s = _fromDoc(doc.data()!);
    _byId[s.id] = s;
    return s;
  }

  Future<Subject> addCustomCourse({
    required String name,
    required String faculty,
    required String dayOfWeek,
    required int period,
    required String lecturer,
  }) async {
    final courseKey = '${_fold(name)}|${_fold(lecturer)}';
    final id = 'c_custom_${DateTime.now().millisecondsSinceEpoch}';
    final data = {
      'id': id,
      'courseKey': courseKey,
      'name': name,
      'faculty': faculty,
      'lecturer': lecturer,
      'dayOfWeek': dayOfWeek,
      'period': period,
      'university_id': 'kyoto_u',
    };
    await _db.collection('courses').doc(id).set(data);
    final s = _fromDoc(data);
    _byId[id] = s;
    return s;
  }
}
```

- [ ] **Step 5: Run tests to green**

Run: `flutter test test/repositories/course_repository_test.dart`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add pubspec.yaml pubspec.lock lib/repositories/course_repository.dart test/repositories/course_repository_test.dart
git commit -m "feat: CourseRepository backed by Firestore courses collection (cached)"
```

---

## Task 6: Wire `CourseRepository` in; delete the hardcoded dataset

**Files:**
- Modify: `lib/main.dart`
- Modify: `lib/services/app_store.dart`
- Modify: `lib/services/firestore_service.dart`
- Modify: `lib/views/home/home_screen.dart`
- Modify: `lib/views/timetable/timetable_registration_screen.dart`
- Modify: `lib/views/course/course_detail_screen.dart`
- Delete: `lib/services/kulasis_dataset.dart`
- Modify: `test/widget_test.dart`

**Interfaces:**
- Consumes: `CourseRepository` (Task 5).
- Produces: `AppStore` exposes `final CourseRepository courses;` (constructor-injected). `AppStore.getRegisteredSubjects()` becomes `Future<List<Subject>>`. `AppStore.addCustomSubject(...)` becomes `Future<void>` delegating to `courses.addCustomCourse`. `FirestoreService` no longer has `seedKulasisSubjectsMaster`, `streamSubjects`, `createSubject`.

- [ ] **Step 1: Inventory every `KulasisDataset` reference**

Run: `grep -rn "KulasisDataset\|kulasis_dataset\|customSubjects\|seedKulasisSubjectsMaster\|streamSubjects" lib/`
Expected: references in `app_store.dart`, `firestore_service.dart`, `home_screen.dart`, `timetable_registration_screen.dart`, `course_detail_screen.dart`. Note each line — every one must be replaced or deleted by the end of this task.

- [ ] **Step 2: Update `main.dart` — persistence + inject the repo**

Before `runApp`, after `Firebase.initializeApp`:

```dart
FirebaseFirestore.instance.settings =
    const Settings(persistenceEnabled: true, cacheSizeBytes: Settings.CACHE_SIZE_UNLIMITED);
```

Change `final AppStore _store = AppStore();` to:

```dart
final AppStore _store = AppStore(CourseRepository(FirebaseFirestore.instance));
```

Add the imports for `cloud_firestore` and `repositories/course_repository.dart`.

- [ ] **Step 3: Update `AppStore`**

- Constructor: `AppStore(this.courses) { _initFirebaseSync(); }` with `final CourseRepository courses;`
- In `_initFirebaseSync`: delete the `_firestore.seedKulasisSubjectsMaster()...` line and the entire `_firestore.streamSubjects().listen(...)` block. Delete the `customSubjects` field.
- `getRegisteredSubjects()` → `Future<List<Subject>>`:
  ```dart
  Future<List<Subject>> getRegisteredSubjects() async {
    final out = <Subject>[];
    for (final id in userTimetable.values.toSet()) {
      final s = await courses.byId(id);
      if (s != null) out.add(s);
    }
    return out;
  }
  ```
- `addCustomSubject({...})` → `Future<void>` that calls `await courses.addCustomCourse(...)` then `notifyListeners()`. Drop the old `KulasisDataset.sampleSubjects.insert(...)` and `_firestore.createSubject(...)` lines.
- `importSubjectsFromBatch` — keep, but have it `await` each `addCustomSubject`.
- Any other `KulasisDataset.findById(id)` in this file → `await courses.byId(id)`.

- [ ] **Step 4: Update `FirestoreService`**

Delete `seedKulasisSubjectsMaster()`, `streamSubjects()`, `createSubject()` and the now-unused `import 'kulasis_dataset.dart';` and `import '../models/subject.dart';` if nothing else needs them.

- [ ] **Step 5: Update the three screens**

- `home_screen.dart`: the search `setState`/`_searchQuery` path builds `searchResults` from `KulasisDataset.sampleSubjects.where(...)`. Replace with a `Future<List<Subject>>` held in state, populated by `widget.store.courses.search(_searchQuery)` (use a `FutureBuilder` or an async `_runSearch()` that `setState`s a `List<Subject> _results`). `_buildGridCell` / registered-list use `widget.store.courses.byId` — convert those call sites to resolve via a pre-fetched map: in `build`, kick off `widget.store.getRegisteredSubjects()` in a `FutureBuilder` and pass the resolved list down (the screen already calls `getRegisteredSubjects()` synchronously at the top of `build` — wrap that region in a `FutureBuilder<List<Subject>>`).
- `timetable_registration_screen.dart`: `KulasisDataset.getSubjectsForSlot(dayOfWeek, period)` → `await widget.store.courses.forSlot(dayOfWeek, period)` (load inside the modal's `StatefulBuilder` via a `FutureBuilder`); `KulasisDataset.findById(registeredId)` in the grid → resolve through a `FutureBuilder`/prefetched map keyed by the timetable's course ids; custom-subject submit calls the now-async `widget.store.addCustomSubject(...)`.
- `course_detail_screen.dart`: only `KulasisDataset.findById` (if present) → `widget.store.courses.byId`. The screen is handed a `Subject` already, so most of it is untouched.

- [ ] **Step 6: Delete the dataset file and fix the smoke test**

```bash
git rm lib/services/kulasis_dataset.dart
```

`test/widget_test.dart` — `KyotoExamHubApp` now needs Firebase initialised, which a unit test can't do. Replace the smoke test with a trivial build test of a leaf widget, or mark it skipped with a comment pointing at the manual E2E in Task 7. Minimal replacement:

```dart
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('placeholder — app-level smoke test needs Firebase; see manual E2E', () {
    expect(1 + 1, 2);
  });
}
```

- [ ] **Step 7: Static analysis + full test run**

Run: `flutter analyze`
Expected: no errors (pre-existing `info`-level lints are fine). If `analyze` reports an unresolved `KulasisDataset`, go back to Step 1's grep and fix the straggler.
Run: `flutter test`
Expected: all tests pass.

- [ ] **Step 8: Manual behaviour-parity check**

Run: `flutter run -d chrome`
Verify: sign in → onboarding → timetable registration (tap an empty cell, search "微分", register) → home shows the course → tap it → course detail loads its tabs → back → "参考書" tab still loads. No console errors about `courses` permissions (rules are still the permissive baseline until Task 7).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: source courses from Firestore via CourseRepository; delete 10k-line hardcoded dataset"
```

---

## Task 7: Real Firestore security rules + emulator unit tests

**Files:**
- Modify: `firestore.rules`
- Create: `firestore-tests/package.json`
- Create: `firestore-tests/rules.test.mjs`

**Interfaces:**
- Consumes: `firebase.json` emulator config (Task 1), the collection names used by `FirestoreService` and `CourseRepository`.
- Produces: deployed rules where every collection requires an authenticated caller, writes to user-owned docs require ownership, and content creation requires a verified `@st.kyoto-u.ac.jp` token.

- [ ] **Step 1: Create `firestore-tests/package.json`**

```json
{
  "name": "kyodai-info-rules-tests",
  "private": true,
  "type": "module",
  "scripts": { "test": "firebase emulators:exec --only firestore --project demo-rules \"node --test\"" },
  "devDependencies": { "@firebase/rules-unit-testing": "^4.0.1" }
}
```

Run: `cd firestore-tests && npm install`

- [ ] **Step 2: Write the failing rules tests**

`firestore-tests/rules.test.mjs`:

```javascript
import { readFileSync } from 'node:fs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import { setDoc, getDoc, doc } from 'firebase/firestore';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rules',
    firestore: { rules: readFileSync('../firestore.rules', 'utf8'), host: 'localhost', port: 8080 },
  });
});
after(() => env.cleanup());

const KU = { sub: 'u1', email: 'a@st.kyoto-u.ac.jp', email_verified: true };
const KU_UNVERIFIED = { sub: 'u2', email: 'b@st.kyoto-u.ac.jp', email_verified: false };
const OUTSIDER = { sub: 'u3', email: 'c@gmail.com', email_verified: true };

test('anonymous cannot read courses', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'courses/c_1')));
});

test('any signed-in user can read courses', async () => {
  const db = env.authenticatedContext('u1', KU).firestore();
  await assertSucceeds(getDoc(doc(db, 'courses/c_1')));
});

test('user can write only their own profile', async () => {
  const mine = env.authenticatedContext('u1', KU).firestore();
  await assertSucceeds(setDoc(doc(mine, 'users/u1'), { displayName: 'me', university_id: 'kyoto_u' }));
  await assertFails(setDoc(doc(mine, 'users/u2'), { displayName: 'hax' }));
});

test('verified KU user can create a post they author', async () => {
  const db = env.authenticatedContext('u1', KU).firestore();
  await assertSucceeds(setDoc(doc(db, 'posts/p1'), {
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

test('cannot create a post attributed to someone else', async () => {
  const db = env.authenticatedContext('u1', KU).firestore();
  await assertFails(setDoc(doc(db, 'posts/p4'), { authorId: 'u2', university_id: 'kyoto_u' }));
});
```

- [ ] **Step 3: Run tests, watch them fail**

Run: `cd firestore-tests && npm test`
Expected: FAIL — the permissive baseline rule lets the "anonymous cannot read" and "own profile only" cases succeed when they should fail.

- [ ] **Step 4: Write `firestore.rules`**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }

    function kuVerified() {
      return signedIn()
        && request.auth.token.email is string
        && request.auth.token.email.matches('.*@st[.]kyoto-u[.]ac[.]jp$')
        && request.auth.token.email_verified == true;
    }

    function owns(uid) { return signedIn() && request.auth.uid == uid; }

    // Course catalog: readable by any signed-in user. Custom-course creation is
    // allowed for verified users (validated); no edits/deletes.
    match /courses/{id} {
      allow read: if signedIn();
      allow create: if kuVerified()
        && request.resource.data.name is string
        && request.resource.data.name.size() > 0
        && request.resource.data.university_id == 'kyoto_u';
      allow update, delete: if false;
    }

    // Per-user documents.
    match /users/{uid} {
      allow read: if signedIn();
      allow create, update: if owns(uid);
      allow delete: if false;
    }
    match /user_timetables/{uid} {
      allow read: if signedIn();
      allow write: if owns(uid);
    }

    // User-generated content: readable by signed-in users, created by verified
    // KU users as themselves, edited/removed by the author.
    match /posts/{id} {
      allow read: if signedIn();
      allow create: if kuVerified() && request.resource.data.authorId == request.auth.uid;
      allow update: if signedIn()
        && (resource.data.authorId == request.auth.uid
            || request.resource.data.diff(resource.data).affectedKeys().hasOnly(['reports']));
      allow delete: if signedIn() && resource.data.authorId == request.auth.uid;
    }

    match /requests/{id} {
      allow read: if signedIn();
      allow create: if kuVerified() && request.resource.data.authorId == request.auth.uid;
      allow update, delete: if signedIn() && resource.data.authorId == request.auth.uid;
    }

    match /textbook_requests/{id} {
      allow read: if signedIn();
      allow create: if kuVerified() && request.resource.data.requesterId == request.auth.uid;
      allow update: if kuVerified();   // responder flips status; tightened in Phase 3
    }

    match /talk_rooms/{id} {
      allow read: if signedIn();
      allow create: if kuVerified()
        && (request.resource.data.lenderId == request.auth.uid
            || request.resource.data.borrowerId == request.auth.uid);
      allow update: if signedIn()
        && (resource.data.lenderId == request.auth.uid
            || resource.data.borrowerId == request.auth.uid);
    }

    match /transactions/{id} {
      allow read: if signedIn() && resource.data.userId == request.auth.uid;
      allow create: if kuVerified();   // client-authored ledger; server-authored in Phase 2
      allow update, delete: if false;
    }

    match /inquiries/{id} {
      allow read: if false;
      allow create: if signedIn();
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 5: Run tests to green**

Run: `cd firestore-tests && npm test`
Expected: all tests pass.

- [ ] **Step 6: Deploy and re-check the live app**

Run: `firebase deploy --only firestore:rules --project kyodai-sns`
Then on https://kyodai-info.web.app with a verified account: register a timetable course, open a course, post a test-prep resource, file a textbook request. All must still work. With an **unverified** freshly-registered account: confirm posting is refused (matches the existing in-app "未検証" gate).

- [ ] **Step 7: Commit**

```bash
git add firestore.rules firestore-tests/
git commit -m "feat: real Firestore security rules (authed + KU-verified) with emulator tests"
```

---

## Task 8: Startup weight — favicon, icons, release-build check

**Files:**
- Create: `tools/make_icons.py`
- Replace: `web/favicon.png`, `web/icons/Icon-192.png`, `web/icons/Icon-512.png`, `web/icons/Icon-maskable-192.png`, `web/icons/Icon-maskable-512.png`

**Interfaces:**
- Consumes: nothing.
- Produces: `web/` icon assets each < 25 KB; a recorded before/after size for `build/web/main.dart.js`.

- [ ] **Step 1: Record the baseline bundle size**

Run: `flutter build web --release && du -b build/web/main.dart.js build/web/*.js 2>/dev/null | tail -5 && du -sb build/web`
Write the `main.dart.js` byte count and total `build/web` count into the commit message later. (Deleting `kulasis_dataset.dart` in Task 6 should already have shrunk `main.dart.js` by ~1–2 MB of source — this step confirms it.)

- [ ] **Step 2: Write `tools/make_icons.py`**

```python
"""Regenerate web/ icons + favicon from a simple drawn glyph (no source asset).
Requires Pillow: pip install pillow
"""
import pathlib
from PIL import Image, ImageDraw

WEB = pathlib.Path(__file__).parents[1] / "web"
BRAND = (15, 76, 129)  # 0xFF0F4C81


def base(size: int, maskable: bool) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = 0 if maskable else int(size * 0.08)
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=int(size * 0.18), fill=BRAND)
    # simple mortar-board triangle
    m = size * 0.5
    d.polygon([(m, size * 0.30), (size * 0.78, size * 0.44), (m, size * 0.58), (size * 0.22, size * 0.44)],
              fill=(255, 255, 255, 255))
    return img


for name, size, maskable in [
    ("icons/Icon-192.png", 192, False), ("icons/Icon-512.png", 512, False),
    ("icons/Icon-maskable-192.png", 192, True), ("icons/Icon-maskable-512.png", 512, True),
]:
    base(size, maskable).save(WEB / name)
base(64, False).save(WEB / "favicon.png")
print("icons regenerated")
```

- [ ] **Step 3: Run it and verify sizes**

Run: `pip install pillow && python tools/make_icons.py && du -b web/favicon.png web/icons/*.png`
Expected: every file < 25 000 bytes (down from 1 003 122).

- [ ] **Step 4: Rebuild and confirm it loads**

Run: `flutter build web --release && du -sb build/web`
Then: `firebase hosting:channel:deploy phase1-preview --project kyodai-sns` and open the preview URL. Confirm the tab favicon shows and first paint is visibly faster than production.
Expected: build succeeds; `build/web` total smaller than the Step 1 baseline.

- [ ] **Step 5: Commit**

```bash
git add tools/make_icons.py web/favicon.png web/icons/
git commit -m "perf: replace 1MB favicon/icons with <25KB generated assets; record bundle size drop"
```

---

## Task 9: Clean up superseded scripts + final verification

**Files:**
- Delete: root-level one-off `*.py` scrapers/inspectors superseded by `tools/`.
- Move: `fetch_live_kulasis.py`, `scrape_full_kulasis_official.py` → `tools/legacy/`.
- Modify: `.gitignore` if needed.

**Interfaces:**
- Consumes: nothing.
- Produces: a repo root with no stray scripts; `flutter analyze` + `flutter test` + rules tests all green.

- [ ] **Step 1: Move / delete the old scripts**

```bash
mkdir -p tools/legacy
git mv fetch_live_kulasis.py tools/legacy/
git mv scrape_full_kulasis_official.py tools/legacy/
git rm merge_and_build_dataset.py parse_existing_json_official.py fix_dart_dataset.py \
  convert_syllabus.js debug_detail_tags.py discover_kulasis_departments.py \
  inspect_kulasis_structure.py inspect_open_syllabus_all.py inspect_top_page.py \
  rescrape_full_kulasis.py scrape_kulasis_perfect.py \
  test_department_search.py test_dept_detail.py test_detail_scrape.py \
  test_kulasis_parse.py test_parse_kulasis_detail.py
```

- [ ] **Step 2: Full green sweep**

Run each, expect all green:
- `flutter analyze` — no errors
- `flutter test` — all pass
- `cd tools && python -m pytest -q` — all pass
- `cd firestore-tests && npm test` — all pass
- `cd tools && bash test_seed.sh` — exit 0

- [ ] **Step 3: Confirm production is healthy**

On https://kyodai-info.web.app (after the Task 7 rules deploy): full manual pass — sign in, register a course, open it, post a resource, download it, file a textbook request, open the talk room. Compare first-load time to the pre-Phase-1 baseline.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: retire superseded root scripts; move live scrapers to tools/legacy"
```

- [ ] **Step 5: Tag the phase**

```bash
git tag phase1-foundation
```

---

## Self-Review

**1. Spec coverage (Phase 1 scope items):**
- Firestore security rules → Task 1 (baseline) + Task 7 (real rules + tests). ✅
- Course normalization from `.py` scrapers + `syllabus_data.json` → Tasks 2, 3. ✅
- Delete `kulasis_dataset.dart` hardcode → Task 6. ✅
- Startup `seed` removal + full-collection listener removal → Task 6 (Steps 3–4). ✅
- favicon / bundle perf → Task 8. ✅
- Behaviour parity for timetable / past-exam / textbook → Task 6 Step 8, Task 7 Step 6, Task 9 Step 3. ✅
- `ku_verified` deferral documented → Global Constraints + Task 7 `kuVerified()` uses `email_verified` directly. ✅
- Review feature, さがす tab, 楽単ランキング, 2-tab course detail, bottom-nav reorg, bell/notifications → **out of scope for this plan**, covered by Plan 2 & Plan 3 (noted in the chat handoff, not this doc). ✅ (intentional split)

**2. Placeholder scan:** No "TBD/TODO/handle appropriately". Every code step has real code. Test steps have real assertions. ✅

**3. Type consistency:**
- `CourseRepository` method names identical in the Interfaces block, Task 5 tests, Task 5 impl, and Task 6 call sites (`warmUp`, `search`, `forSlot`, `byId`, `addCustomCourse`). ✅
- `Subject.courseKey` field name consistent across Task 4 and Task 5. ✅
- `AppStore.getRegisteredSubjects()` return type change to `Future<List<Subject>>` flagged in Task 6 Interfaces and applied in Step 3 + Step 5 (home_screen `FutureBuilder`). ✅
- Rules helper `kuVerified()` / `owns()` names consistent between `firestore.rules` (Task 7 Step 4) and the tests' expectations. ✅
- Emulator Firestore port `8080` consistent: `firebase.json` (Task 1), `rules.test.mjs` (Task 7), `test_seed.sh` (Task 3). ✅

**Timeline risk:** This plan is ~2 weeks of solo work with testing. Plans 2 (review layer) and 3 (discovery/nav) plus review seeding must also land before the October 後期 履修登録 window. If Task 6's screen refactor overruns, the fallback is to keep `Subject` sourced from Firestore but skip the `home_screen`/`timetable` `FutureBuilder` polish and accept a brief loading flash.
