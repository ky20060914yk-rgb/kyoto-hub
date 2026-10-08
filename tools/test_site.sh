#!/usr/bin/env bash
# Runs the Next.js site tests against the Firebase emulators.
set -euo pipefail
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
cd "$(dirname "$0")/.."
firebase emulators:exec --project demo-site-test --only auth,firestore,storage "cd site && npx vitest run $*"
