#!/usr/bin/env bash
set -euo pipefail
# Storage security-rules tests (Plan 2A). The emulators need JDK 21+.
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
cd "$(dirname "$0")/../firestore-tests"
firebase emulators:exec --only storage --project demo-rules "node --test storage.test.mjs"
