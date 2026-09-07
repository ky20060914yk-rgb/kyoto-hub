#!/usr/bin/env bash
set -euo pipefail
# Firestore security-rules unit tests (Task 7).
# The Firestore emulator needs JDK 21+; the default `java` on this host is 1.8.
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
cd "$(dirname "$0")/../firestore-tests"
# `firebase emulators:exec` injects FIRESTORE_EMULATOR_HOST, so the tests only
# ever talk to the local emulator under the throwaway `demo-rules` project.
firebase emulators:exec --only firestore --project demo-rules "node --test rules.test.mjs"
