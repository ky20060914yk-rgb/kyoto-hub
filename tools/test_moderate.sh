#!/usr/bin/env bash
set -euo pipefail
# Pure + emulator tests for the moderation CLI (Plan 2B). Firestore emulator
# only (project demo-*): never touches production.
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
cd "$(dirname "$0")"
npm --prefix ../functions run build   # the CLI runs the compiled moderation code (M-17)
node test_moderate_fixture.mjs
# Usage errors must refuse (exit non-zero) before touching anything.
if node moderate.mjs list >/dev/null 2>&1; then echo "expected usage failure (no --project)"; exit 1; fi
if node moderate.mjs restore ph --project demo-mod --apply >/dev/null 2>&1; then echo "expected usage failure (no --operator)"; exit 1; fi
M="node moderate.mjs"
T="node test_moderate_fixture.mjs"
firebase emulators:exec --only firestore --project demo-mod "\
  $T seed \
  && $T listcheck \
  && $M restore ph --project demo-mod \
  && $M hide px --project demo-mod \
  && $M delete pv --project demo-mod \
  && $M delete pghost --project demo-mod \
  && $M close t1 --project demo-mod \
  && ! $M hide px --project demo-mod --apply \
  && $T dry-clean \
  && $T still-hidden \
  && $M hide px --project demo-mod --apply --operator tester \
  && $T hidden-x \
  && ! $M hide pdup --project demo-mod --apply --operator tester \
  && $T dup-untouched \
  && $M delete pghost --project demo-mod --apply --operator tester \
  && $T ghost-retired \
  && $M restore ph --project demo-mod --apply --operator tester \
  && $T restored \
  && $M delete pv --project demo-mod --apply --operator tester \
  && $T deleted \
  && ! $M delete nope --project demo-mod --apply --operator tester \
  && $M close t1 --project demo-mod --apply --operator tester \
  && $T closed \
  && $M strip-legacy-reports --project demo-mod \
  && $T reports-kept \
  && $M strip-legacy-reports --project demo-mod --apply --operator tester \
  && $T reports-stripped \
  && $T strip-audited \
  && $T strip-failures"
