#!/usr/bin/env bash
set -euo pipefail
# Pure + emulator tests for migrate_chats.mjs (Plan 3). Firestore emulator only
# (project demo-*): never touches production.
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
cd "$(dirname "$0")"
node test_migrate_chats_fixture.mjs
# No --project must refuse (exit non-zero, nothing touched).
if node migrate_chats.mjs >/dev/null 2>&1; then echo "expected usage failure"; exit 1; fi
T="node test_migrate_chats_fixture.mjs"
# 1) dry run writes nothing; 2) an injected failure in big's FINAL batch leaves its array (exit 1) while the
# other rooms (array or not) are migrated / reset; 3) a room created by the Functions after the first --apply
# exists; 4) a re-run finishes `big` and leaves that room alone; 5) a third run has nothing left to do.
firebase emulators:exec --only firestore --project demo-chats "\
  $T seed \
  && $T run 0 'migrate=3 reset=2 skip=0 messages=452 skipped-messages=1 foreign-senders=1' --project demo-chats \
  && $T unchanged \
  && MIGRATE_CHATS_TEST_FAIL=big $T run 1 'failed=1' --project demo-chats --apply \
  && $T partial \
  && $T seedpost \
  && $T run 0 'migrate=1 reset=0' --project demo-chats --apply \
  && $T migrated \
  && $T run 0 'migrate=0 reset=0' --project demo-chats --apply \
  && $T migrated"
