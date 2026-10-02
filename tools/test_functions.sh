#!/usr/bin/env bash
set -euo pipefail
# Cloud Functions unit tests (Plan 2A). The Firestore emulator needs JDK 21+.
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
cd "$(dirname "$0")/../functions"
npm run build
firebase emulators:exec --only firestore --project demo-fn "node --test test/*.test.mjs"
