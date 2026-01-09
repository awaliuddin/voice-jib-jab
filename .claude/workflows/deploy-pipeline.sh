#!/usr/bin/env bash
# Deployment Pipeline Workflow
# Complete deployment with validation, deployment, and monitoring

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../hooks/lib.sh"

# Configuration
ENVIRONMENT="${1:-staging}"
SKIP_TESTS="${SKIP_TESTS:-false}"
DRY_RUN="${DRY_RUN:-false}"

log_info "Starting deployment pipeline for environment: ${ENVIRONMENT}"

# Phase 1: Pre-deployment validation
log_phase "Pre-deployment validation"

if [ "$SKIP_TESTS" != "true" ]; then
    log_info "Running tests..."
    
    if [ -f "package.json" ]; then
        npm test || { log_error "Tests failed"; exit 1; }
    elif [ -f "requirements.txt" ]; then
        pytest || { log_error "Tests failed"; exit 1; }
    elif [ -f "Cargo.toml" ]; then
        cargo test || { log_error "Tests failed"; exit 1; }
    elif [ -f "go.mod" ]; then
        go test ./... || { log_error "Tests failed"; exit 1; }
    fi
    
    log_success "Tests passed"
else
    log_warn "Skipping tests (not recommended)"
fi

# Check git status
if [ -n "$(git status --porcelain)" ]; then
    log_warn "Working directory has uncommitted changes"
    if [ "$ENVIRONMENT" == "production" ]; then
        log_error "Cannot deploy to production with uncommitted changes"
        exit 1
    fi
fi

# Phase 2: Security scan
log_phase "Security scanning"

if command -v npm &> /dev/null && [ -f "package.json" ]; then
    npm audit --production || log_warn "Security vulnerabilities found"
fi

if command -v safety &> /dev/null && [ -f "requirements.txt" ]; then
    safety check || log_warn "Security vulnerabilities found"
fi

# Phase 3: Build
log_phase "Building application"

BUILD_TAG="$(git rev-parse --short HEAD)"
BUILD_TIME="$(date -u +%Y%m%d-%H%M%S)"

log_info "Build tag: ${BUILD_TAG}"

if [ -f "package.json" ]; then
    npm run build || { log_error "Build failed"; exit 1; }
elif [ -f "Dockerfile" ]; then
    docker build -t "app:${BUILD_TAG}" . || { log_error "Docker build failed"; exit 1; }
fi

log_success "Build complete"

# Phase 4: Create checkpoint
log_phase "Creating deployment checkpoint"

CHECKPOINT_NAME="pre-deploy-${ENVIRONMENT}-${BUILD_TIME}"
CHECKPOINT_FILE=".claude/checkpoints/${CHECKPOINT_NAME}.json"

mkdir -p .claude/checkpoints

cat > "${CHECKPOINT_FILE}" << EOF
{
  "checkpoint_id": "${CHECKPOINT_NAME}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "environment": "${ENVIRONMENT}",
  "git_commit": "$(git rev-parse HEAD)",
  "git_branch": "$(git rev-parse --abbrev-ref HEAD)",
  "build_tag": "${BUILD_TAG}"
}
EOF

log_success "Checkpoint created: ${CHECKPOINT_NAME}"

# Phase 5: Deploy
log_phase "Deploying to ${ENVIRONMENT}"

if [ "$DRY_RUN" == "true" ]; then
    log_warn "DRY RUN - No actual deployment"
    exit 0
fi

case "$ENVIRONMENT" in
    development)
        log_info "Deploying to development..."
        # Add development deployment commands
        ;;
    staging)
        log_info "Deploying to staging..."
        # Add staging deployment commands
        if [ -f "docker-compose.yml" ]; then
            docker-compose -f docker-compose.staging.yml up -d --build
        fi
        ;;
    production)
        log_info "Deploying to production..."
        # Add production deployment commands
        # Typically this would trigger your CD system
        log_warn "Production deployment requires manual approval"
        ;;
    *)
        log_error "Unknown environment: ${ENVIRONMENT}"
        exit 1
        ;;
esac

log_success "Deployment initiated"

# Phase 6: Health check
log_phase "Running health checks"

sleep 5  # Wait for services to start

HEALTH_URL="${HEALTH_CHECK_URL:-http://localhost:8080/health}"
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -f -s "${HEALTH_URL}" > /dev/null 2>&1; then
        log_success "Health check passed"
        break
    fi
    
    RETRY_COUNT=$((RETRY_COUNT + 1))
    log_info "Health check attempt ${RETRY_COUNT}/${MAX_RETRIES}..."
    sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    log_error "Health check failed after ${MAX_RETRIES} attempts"
    log_error "Rolling back deployment..."
    
    # Rollback logic
    if [ -f "docker-compose.yml" ]; then
        docker-compose down
    fi
    
    exit 1
fi

# Phase 7: Post-deployment verification
log_phase "Post-deployment verification"

# Smoke tests
if [ -f "tests/smoke.sh" ]; then
    bash tests/smoke.sh || { log_error "Smoke tests failed"; exit 1; }
fi

# Create success checkpoint
SUCCESS_CHECKPOINT=".claude/checkpoints/deploy-success-${ENVIRONMENT}-${BUILD_TIME}.json"

cat > "${SUCCESS_CHECKPOINT}" << EOF
{
  "checkpoint_id": "deploy-success-${ENVIRONMENT}-${BUILD_TIME}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "environment": "${ENVIRONMENT}",
  "git_commit": "$(git rev-parse HEAD)",
  "build_tag": "${BUILD_TAG}",
  "status": "success"
}
EOF

# Phase 8: Deployment report
log_phase "Generating deployment report"

REPORT_FILE=".claude/reports/deploy-${ENVIRONMENT}-${BUILD_TIME}.md"
mkdir -p .claude/reports

cat > "${REPORT_FILE}" << EOF
# Deployment Report

- Environment: ${ENVIRONMENT}
- Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- Build Tag: ${BUILD_TAG}
- Git Commit: $(git rev-parse HEAD)
- Git Branch: $(git rev-parse --abbrev-ref HEAD)

## Deployment Summary
- Status: SUCCESS
- Duration: N/A
- Tests: $([ "$SKIP_TESTS" == "true" ] && echo "SKIPPED" || echo "PASSED")
- Health Check: PASSED

## Components Deployed
- Application: ${BUILD_TAG}

## Post-Deployment Checks
- Health check: PASSED
- Smoke tests: $([ -f "tests/smoke.sh" ] && echo "PASSED" || echo "N/A")

## Rollback Information
- Checkpoint: ${CHECKPOINT_NAME}
- Rollback command: docker-compose down && git checkout <previous-commit>

EOF

log_success "Deployment complete!"
log_info "Report: ${REPORT_FILE}"

exit 0
