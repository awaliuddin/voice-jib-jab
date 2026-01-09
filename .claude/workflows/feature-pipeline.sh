#!/usr/bin/env bash
# Feature Development Pipeline
# Complete workflow for feature development from spec to deployment

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../hooks/lib.sh"

# Configuration
FEATURE_NAME="${1:?Feature name required}"
FEATURE_ID="feat-$(date +%Y%m%d-%H%M%S)"
BRANCH_NAME="feature/${FEATURE_NAME}"

log_info "Starting feature development pipeline: ${FEATURE_NAME}"
log_info "Feature ID: ${FEATURE_ID}"

# Phase 1: Create feature branch
log_phase "Creating feature branch"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
BASE_BRANCH="${BASE_BRANCH:-main}"

if git show-ref --verify --quiet "refs/heads/${BRANCH_NAME}"; then
    log_warn "Branch ${BRANCH_NAME} already exists"
    git checkout "${BRANCH_NAME}"
else
    git checkout -b "${BRANCH_NAME}" "${BASE_BRANCH}"
    log_success "Created branch: ${BRANCH_NAME}"
fi

# Phase 2: Generate specification
log_phase "Generating feature specification"

SPEC_FILE=".claude/features/${FEATURE_ID}-spec.md"
mkdir -p .claude/features

cat > "${SPEC_FILE}" << EOF
# Feature Specification: ${FEATURE_NAME}

Feature ID: ${FEATURE_ID}
Created: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Branch: ${BRANCH_NAME}

## Overview
[Description of the feature]

## Requirements

### Functional Requirements
- [ ] Requirement 1
- [ ] Requirement 2

### Non-Functional Requirements
- [ ] Performance: Response time < 100ms
- [ ] Security: Input validation implemented
- [ ] Testing: Coverage > 80%

## Architecture

### Components
- Component 1: [Description]
- Component 2: [Description]

### Data Models
\`\`\`
[Data model definitions]
\`\`\`

### API Endpoints
\`\`\`
[API endpoint definitions]
\`\`\`

## Implementation Plan

### Phase 1: Foundation
- [ ] Create data models
- [ ] Set up database schema
- [ ] Create repositories

### Phase 2: Business Logic
- [ ] Implement core functionality
- [ ] Add validation
- [ ] Error handling

### Phase 3: API
- [ ] Create endpoints
- [ ] Add middleware
- [ ] Documentation

### Phase 4: Testing
- [ ] Unit tests
- [ ] Integration tests
- [ ] E2E tests

### Phase 5: Documentation
- [ ] API docs
- [ ] User guide
- [ ] Migration guide

## Testing Strategy
[Testing approach]

## Acceptance Criteria
- [ ] All requirements implemented
- [ ] All tests passing
- [ ] Code reviewed
- [ ] Documentation complete

## Estimated Effort: [X hours]

EOF

log_success "Specification created: ${SPEC_FILE}"
log_info "Edit ${SPEC_FILE} to complete the specification"

# Phase 3: Update project state
log_phase "Updating project state"

STATE_FILE=".claude/state.json"

if [ -f "${STATE_FILE}" ]; then
    # Update state with new feature
    jq --arg feature_id "${FEATURE_ID}" \
       --arg feature_name "${FEATURE_NAME}" \
       --arg branch "${BRANCH_NAME}" \
       '.active_features += [{
           id: $feature_id,
           name: $feature_name,
           branch: $branch,
           status: "in_progress",
           started_at: now | todate
       }]' "${STATE_FILE}" > "${STATE_FILE}.tmp"
    
    mv "${STATE_FILE}.tmp" "${STATE_FILE}"
    log_success "State updated"
fi

# Phase 4: Create feature directory structure
log_phase "Creating feature directory structure"

# This would create the appropriate directories based on the project type
# For now, just log the intent
log_info "Feature structure ready for implementation"

# Phase 5: Create initial commit
log_phase "Creating initial commit"

git add "${SPEC_FILE}"

if [ -f "${STATE_FILE}" ]; then
    git add "${STATE_FILE}"
fi

git commit -m "feat: Initialize ${FEATURE_NAME} feature

Feature ID: ${FEATURE_ID}
Branch: ${BRANCH_NAME}

- Created feature specification
- Updated project state
- Ready for implementation" || log_warn "Nothing to commit"

log_success "Initial commit created"

# Phase 6: Implementation checklist
log_phase "Feature development checklist"

cat << EOF

Next Steps:
1. [ ] Complete specification in ${SPEC_FILE}
2. [ ] Implement functionality
3. [ ] Write tests
4. [ ] Update documentation
5. [ ] Create pull request
6. [ ] Code review
7. [ ] Merge to ${BASE_BRANCH}

Development Commands:
- Run tests: npm test / pytest / cargo test
- Run linter: npm run lint / flake8 / cargo clippy
- Check coverage: npm run coverage / coverage report
- Create PR: gh pr create

Feature Branch: ${BRANCH_NAME}
Base Branch: ${BASE_BRANCH}

EOF

log_success "Feature pipeline initialized"
log_info "Specification: ${SPEC_FILE}"
log_info "Branch: ${BRANCH_NAME}"

exit 0
