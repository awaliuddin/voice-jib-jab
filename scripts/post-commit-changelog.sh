#!/bin/bash
# ASIF CHANGELOG Hook — Post-Commit
# Appends a CHANGELOG entry for feature/fix/docs commits.
#
# Install:
#   cp scripts/post-commit-changelog.sh .git/hooks/post-commit
#   chmod +x .git/hooks/post-commit
#
# Format follows Q50 guidance: group by outcome, not initiative ID.
# Entry: "- **Type** · YYYY-MM-DD · <summary> (commit `sha`)"
#
# Triggers on conventional commit prefixes:
#   feat:  fix:  docs:  refactor:  perf:  security:
#
# Skips: cos:  chore:  empty-delta patterns

set -euo pipefail

CHANGELOG="$(git rev-parse --show-toplevel)/CHANGELOG.md"
COMMIT_MSG=$(git log -1 --pretty=%s)
SHORT_SHA=$(git log -1 --pretty=%h)
DATE=$(date +%Y-%m-%d)

# Skip CoS check-ins and chore commits
if echo "$COMMIT_MSG" | grep -qE "^(cos:|chore:)"; then
  exit 0
fi

# Skip empty-delta patterns
if echo "$COMMIT_MSG" | grep -qiE "empty.delta|empty delta"; then
  exit 0
fi

# Determine entry type from conventional commit prefix
if echo "$COMMIT_MSG" | grep -qE "^feat(\([^)]+\))?:"; then
  TYPE="Added"
elif echo "$COMMIT_MSG" | grep -qE "^fix(\([^)]+\))?:"; then
  TYPE="Fixed"
elif echo "$COMMIT_MSG" | grep -qE "^docs(\([^)]+\))?:"; then
  TYPE="Docs"
elif echo "$COMMIT_MSG" | grep -qE "^refactor(\([^)]+\))?:"; then
  TYPE="Changed"
elif echo "$COMMIT_MSG" | grep -qE "^perf(\([^)]+\))?:"; then
  TYPE="Performance"
elif echo "$COMMIT_MSG" | grep -qE "^security(\([^)]+\))?:"; then
  TYPE="Security"
else
  exit 0
fi

# Strip conventional prefix to get the outcome summary
SUMMARY=$(echo "$COMMIT_MSG" | sed -E 's/^[a-z]+(\([^)]+\))?:[[:space:]]*//')

# Append test count if present in commit body
TEST_NOTE=""
BODY=$(git log -1 --pretty=%b)
if echo "$BODY" | grep -qE "Tests?:[[:space:]]*[0-9]+ passed"; then
  TEST_NOTE=" · $(echo "$BODY" | grep -oE "Tests?:[[:space:]]*[0-9]+ passed" | head -1)"
fi

ENTRY="- **${TYPE}** · ${DATE} · ${SUMMARY}${TEST_NOTE} (\`${SHORT_SHA}\`)"

# Insert under ## [Unreleased]
if grep -q "## \[Unreleased\]" "$CHANGELOG"; then
  awk -v entry="$ENTRY" '
    /^## \[Unreleased\]/ { print; print ""; print entry; next }
    { print }
  ' "$CHANGELOG" > "${CHANGELOG}.tmp" && mv "${CHANGELOG}.tmp" "$CHANGELOG"
  echo "[CHANGELOG] Appended: $ENTRY"
else
  echo "[CHANGELOG] Warning: ## [Unreleased] section not found in CHANGELOG.md"
fi
