#!/usr/bin/env bash
set -euo pipefail
# The Firestore emulator needs JDK 21+; the default `java` on this host is 1.8.
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
# `firebase emulators:exec` injects FIRESTORE_EMULATOR_HOST into the child process,
# so the seeder and the count check both talk to the emulator, never a real project.
JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot" firebase emulators:exec --only firestore --project demo-seed \
  "node seed_courses.mjs --project demo-seed && node check_seed_count.mjs"
