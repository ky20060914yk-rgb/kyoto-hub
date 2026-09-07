#!/usr/bin/env bash
set -euo pipefail
# Emulator test for the legacy-id migration (C2). Mirrors test_seed.sh.
# The Firestore emulator needs JDK 21+; the default `java` on this host is 1.8.
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
cd "$(dirname "$0")"
# `firebase emulators:exec` injects FIRESTORE_EMULATOR_HOST into the child
# process, so every step below talks to the emulator and never a real project.
# The second migrate run proves idempotence: it must rewrite nothing and the
# assertions must still hold.
JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot" \
firebase emulators:exec --only firestore --project demo-migrate "\
  node test_migrate_fixture.mjs seed \
  && node migrate_ids.mjs --project demo-migrate --dry-run \
  && node migrate_ids.mjs --project demo-migrate \
  && node migrate_ids.mjs --project demo-migrate \
  && node test_migrate_fixture.mjs check"
