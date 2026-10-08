#!/usr/bin/env bash
# Runs migrate_to_next.mjs against the emulators with a legacy-shaped fixture and checks the result.
set -euo pipefail
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
cd "$(dirname "$0")"
firebase emulators:exec --project demo-migrate --only firestore,storage "node test_migrate_to_next_fixture.mjs"
