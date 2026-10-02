#!/usr/bin/env bash
set -euo pipefail
# Planner unit test + emulator end-to-end test for migrate_storage.mjs (Plan 2A).
# Firestore + Storage emulators only (project demo-*): never touches production.
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
cd "$(dirname "$0")"
node test_migrate_storage_fixture.mjs
# No --project / --delete-old without --apply must refuse (non-zero, nothing touched).
if node migrate_storage.mjs >/dev/null 2>&1; then echo "expected usage failure"; exit 1; fi
if node migrate_storage.mjs --project demo-mstore --delete-old >/dev/null 2>&1; then echo "expected usage failure"; exit 1; fi
# `run` asserts the tool's exit code (1 = some post FAILed by design in the fixture).
firebase emulators:exec --only firestore,storage --project demo-mstore "\
  node test_migrate_storage_fixture.mjs seed \
  && node test_migrate_storage_fixture.mjs run 1 'migrate=2' \
  && node test_migrate_storage_fixture.mjs unchanged \
  && node test_migrate_storage_fixture.mjs run 1 'copied=3' --apply \
  && node test_migrate_storage_fixture.mjs migrated \
  && node test_migrate_storage_fixture.mjs run 1 'copied=0' --apply \
  && node test_migrate_storage_fixture.mjs migrated \
  && node test_migrate_storage_fixture.mjs run 1 'deleted=3' --apply --delete-old \
  && node test_migrate_storage_fixture.mjs deleted"

# A destination whose token cannot be stripped must block --delete-old for that post.
MIGRATE_TEST_FAIL_STRIP=resources/u3 firebase emulators:exec --only firestore,storage --project demo-mstore "\
  node test_migrate_storage_fixture.mjs seed \
  && node test_migrate_storage_fixture.mjs run 1 'FAIL p5' --apply --delete-old \
  && node test_migrate_storage_fixture.mjs stripfail"
