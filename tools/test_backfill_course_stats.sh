#!/usr/bin/env bash
set -euo pipefail
# Pure + emulator tests for backfill_course_stats.mjs (Plan 2B). Firestore
# emulator only (project demo-*): never touches production.
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
cd "$(dirname "$0")"
npm --prefix ../functions run build   # the tool runs the compiled trigger code (M-17)
node test_backfill_course_stats_fixture.mjs
# No --project, or --prune-orphans without --apply, must refuse (exit non-zero, nothing touched).
if node backfill_course_stats.mjs >/dev/null 2>&1; then echo "expected usage failure"; exit 1; fi
if node backfill_course_stats.mjs --project demo-cstats --prune-orphans >/dev/null 2>&1; then echo "expected usage failure"; exit 1; fi
# changed=3: K1 (forged), the slash course (new), KGONE (stale -> zero). The 2nd --apply proves idempotence.
firebase emulators:exec --only firestore --project demo-cstats "\
  node test_backfill_course_stats_fixture.mjs seed \
  && node test_backfill_course_stats_fixture.mjs run 'changed=3 unchanged=0 orphans=1 pruned=0 skipped=1 failed=0' --project demo-cstats \
  && node test_backfill_course_stats_fixture.mjs unchanged \
  && node test_backfill_course_stats_fixture.mjs run 'changed=3' --project demo-cstats --apply \
  && node test_backfill_course_stats_fixture.mjs check \
  && node test_backfill_course_stats_fixture.mjs run 'changed=0' --project demo-cstats --apply \
  && node test_backfill_course_stats_fixture.mjs check \
  && node test_backfill_course_stats_fixture.mjs run 'pruned=1' --project demo-cstats --apply --prune-orphans \
  && node test_backfill_course_stats_fixture.mjs pruned"
