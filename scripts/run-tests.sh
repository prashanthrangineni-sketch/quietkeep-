#!/usr/bin/env bash
# Run every unit test suite in tests/.
#
# WHY THIS EXISTS
# There were nine test files in tests/ and nothing that ran them - not a CI
# job, not an npm script. They passed whenever someone remembered to run them
# by hand, which is the same as not having them: a test nobody executes cannot
# fail, so it cannot protect anything. That is the same family of defect as a
# swallowed import or a comment asserting a vendor had shut down.
#
# The suites are plain node scripts that exit non-zero on failure, so there is
# no test runner to install and no dependencies to fetch.
#
# Usage:  bash scripts/run-tests.sh
set -o pipefail
shopt -s nullglob

files=(tests/*.test.mjs)
if [ ${#files[@]} -eq 0 ]; then
  echo "No test files found in tests/ - failing rather than reporting a silent pass."
  exit 1
fi

failed=0
for f in "${files[@]}"; do
  echo "── $f"
  if node "$f"; then
    echo "   OK"
  else
    echo "   FAILED"
    failed=1
  fi
done

if [ "$failed" -eq 0 ]; then
  echo ""
  echo "All ${#files[@]} suites passed."
fi
exit $failed
