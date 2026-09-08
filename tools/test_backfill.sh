#!/usr/bin/env bash
set -euo pipefail
# Emulator test for the course_stats post-count backfill. Mirrors test_migrate.sh.
# The Firestore emulator needs JDK 21+; the default `java` on this host is 1.8.
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
cd "$(dirname "$0")"
# `firebase emulators:exec` injects FIRESTORE_EMULATOR_HOST into the child
# process, so every step below talks to the emulator and never a real project.
# The second backfill run proves idempotence: it is an authoritative recount
# (plain ints, not FieldValue.increment), so re-running must not double the
# totals and the assertions must still hold.
JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot" \
firebase emulators:exec --only firestore --project demo-backfill "\
  node test_backfill_fixture.mjs seed \
  && node backfill_post_counts.mjs --project demo-backfill --dry-run \
  && node backfill_post_counts.mjs --project demo-backfill \
  && node backfill_post_counts.mjs --project demo-backfill \
  && node test_backfill_fixture.mjs check"
