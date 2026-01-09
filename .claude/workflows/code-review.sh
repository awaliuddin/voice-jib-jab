#!/usr/bin/env bash
# Code Review Workflow
# Automated code review with quality checks and suggestions

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../hooks/lib.sh"

# Configuration
REVIEW_BRANCH="${1:-HEAD}"
BASE_BRANCH="${2:-main}"
OUTPUT_FILE="${3:-.claude/reports/code-review-$(date +%Y%m%d-%H%M%S).md}"

log_info "Starting code review workflow"
log_info "Reviewing: ${REVIEW_BRANCH} against ${BASE_BRANCH}"

# Phase 1: Collect changes
log_phase "Collecting changes"

git diff "${BASE_BRANCH}...${REVIEW_BRANCH}" --stat > /tmp/review-stat.txt
git diff "${BASE_BRANCH}...${REVIEW_BRANCH}" --name-only > /tmp/review-files.txt

CHANGED_FILES=$(cat /tmp/review-files.txt)
TOTAL_FILES=$(wc -l < /tmp/review-files.txt)

log_info "Files changed: ${TOTAL_FILES}"

# Phase 2: Run static analysis
log_phase "Running static analysis"

# Language detection and appropriate linting
ISSUES_FOUND=0

for file in $CHANGED_FILES; do
    case "$file" in
        *.py)
            log_info "Linting Python: $file"
            if command -v flake8 &> /dev/null; then
                flake8 "$file" || ISSUES_FOUND=$((ISSUES_FOUND + 1))
            fi
            if command -v mypy &> /dev/null; then
                mypy "$file" || ISSUES_FOUND=$((ISSUES_FOUND + 1))
            fi
            ;;
        *.js|*.ts|*.jsx|*.tsx)
            log_info "Linting JavaScript/TypeScript: $file"
            if command -v eslint &> /dev/null; then
                eslint "$file" || ISSUES_FOUND=$((ISSUES_FOUND + 1))
            fi
            ;;
        *.go)
            log_info "Linting Go: $file"
            if command -v golint &> /dev/null; then
                golint "$file" || ISSUES_FOUND=$((ISSUES_FOUND + 1))
            fi
            ;;
        *.rs)
            log_info "Linting Rust: $file"
            if command -v cargo &> /dev/null; then
                cargo clippy --all-targets -- -D warnings || ISSUES_FOUND=$((ISSUES_FOUND + 1))
            fi
            ;;
    esac
done

# Phase 3: Check code complexity
log_phase "Analyzing complexity"

if command -v radon &> /dev/null; then
    radon cc $CHANGED_FILES -a -nb > /tmp/complexity.txt || true
fi

# Phase 4: Security scan
log_phase "Security scanning"

if command -v bandit &> /dev/null; then
    bandit -r . -f json -o /tmp/security.json || true
fi

# Phase 5: Check test coverage
log_phase "Checking test coverage"

COVERAGE_PERCENT=0
if [ -f ".coverage" ]; then
    if command -v coverage &> /dev/null; then
        COVERAGE_PERCENT=$(coverage report | grep TOTAL | awk '{print $4}' | sed 's/%//')
    fi
fi

# Phase 6: Generate report
log_phase "Generating review report"

cat > "${OUTPUT_FILE}" << EOF
# Code Review Report
Generated: $(date +%Y-%m-%d\ %H:%M:%S)
Branch: ${REVIEW_BRANCH}
Base: ${BASE_BRANCH}

## Summary
- Files Changed: ${TOTAL_FILES}
- Issues Found: ${ISSUES_FOUND}
- Test Coverage: ${COVERAGE_PERCENT}%

## Changed Files
\`\`\`
$(cat /tmp/review-stat.txt)
\`\`\`

## Static Analysis
EOF

if [ $ISSUES_FOUND -gt 0 ]; then
    cat >> "${OUTPUT_FILE}" << EOF

### Issues Detected
Found ${ISSUES_FOUND} potential issues. Review linter output for details.

EOF
else
    cat >> "${OUTPUT_FILE}" << EOF

No issues detected in static analysis.

EOF
fi

# Add complexity analysis if available
if [ -f /tmp/complexity.txt ]; then
    cat >> "${OUTPUT_FILE}" << EOF

## Complexity Analysis
\`\`\`
$(cat /tmp/complexity.txt)
\`\`\`

EOF
fi

# Add security scan results if available
if [ -f /tmp/security.json ]; then
    SECURITY_ISSUES=$(jq '.results | length' /tmp/security.json 2>/dev/null || echo "0")
    cat >> "${OUTPUT_FILE}" << EOF

## Security Scan
Found ${SECURITY_ISSUES} potential security issues.

EOF
fi

# Phase 7: Review suggestions
cat >> "${OUTPUT_FILE}" << EOF

## Review Checklist

### Code Quality
- [ ] Code follows project style guide
- [ ] No code duplication
- [ ] Functions are small and focused
- [ ] Variable names are descriptive
- [ ] Comments explain "why" not "what"

### Testing
- [ ] New features have tests
- [ ] Edge cases are tested
- [ ] Tests are maintainable
- [ ] Coverage meets threshold (${COVERAGE_PERCENT}% / 80% target)

### Architecture
- [ ] Changes follow existing patterns
- [ ] No circular dependencies
- [ ] Proper separation of concerns
- [ ] Interfaces used where appropriate

### Security
- [ ] Input validation present
- [ ] No hardcoded secrets
- [ ] SQL injection prevented
- [ ] XSS prevented
- [ ] Authentication/authorization correct

### Documentation
- [ ] Public APIs documented
- [ ] README updated if needed
- [ ] Breaking changes documented
- [ ] Migration guide provided if needed

### Performance
- [ ] No obvious inefficiencies
- [ ] Database queries optimized
- [ ] Caching used where beneficial
- [ ] No N+1 queries

## Recommendations
EOF

# Add automated recommendations based on findings
if [ $ISSUES_FOUND -gt 5 ]; then
    echo "- Fix linting issues before merging" >> "${OUTPUT_FILE}"
fi

if [ "$COVERAGE_PERCENT" -lt 80 ]; then
    echo "- Increase test coverage to at least 80%" >> "${OUTPUT_FILE}"
fi

cat >> "${OUTPUT_FILE}" << EOF

## Approval Status
- [ ] Code review complete
- [ ] All issues addressed
- [ ] Tests passing
- [ ] Ready to merge

EOF

# Cleanup
rm -f /tmp/review-stat.txt /tmp/review-files.txt /tmp/complexity.txt /tmp/security.json

log_success "Code review complete"
log_info "Report saved to: ${OUTPUT_FILE}"

# Exit with error if critical issues found
if [ $ISSUES_FOUND -gt 0 ]; then
    log_warn "Found ${ISSUES_FOUND} issues that should be addressed"
    exit 1
fi

exit 0
