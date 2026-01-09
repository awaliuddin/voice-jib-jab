#!/usr/bin/env bash
# TDD Cycle Workflow
# Test-Driven Development workflow: Red -> Green -> Refactor

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../hooks/lib.sh"

# Configuration
TEST_FILE="${1:?Test file required}"
IMPL_FILE="${2:-}"
WATCH="${WATCH:-false}"

log_info "Starting TDD cycle"
log_info "Test file: ${TEST_FILE}"
[ -n "${IMPL_FILE}" ] && log_info "Implementation file: ${IMPL_FILE}"

# Detect test framework
detect_test_framework() {
    if [[ "$TEST_FILE" == *.py ]]; then
        echo "pytest"
    elif [[ "$TEST_FILE" == *.js ]] || [[ "$TEST_FILE" == *.ts ]]; then
        echo "jest"
    elif [[ "$TEST_FILE" == *.go ]]; then
        echo "go-test"
    elif [[ "$TEST_FILE" == *_test.rs ]]; then
        echo "cargo-test"
    else
        echo "unknown"
    fi
}

run_tests() {
    local framework="$1"
    local file="$2"
    
    case "$framework" in
        pytest)
            pytest "$file" -v
            ;;
        jest)
            npm test -- "$file"
            ;;
        go-test)
            go test -v "./${file%/*}"
            ;;
        cargo-test)
            cargo test
            ;;
        *)
            log_error "Unknown test framework"
            return 1
            ;;
    esac
}

FRAMEWORK=$(detect_test_framework)
log_info "Detected framework: ${FRAMEWORK}"

# TDD Cycle
cycle_count=1

tdd_cycle() {
    log_phase "TDD Cycle ${cycle_count}: RED phase"
    
    # RED: Run tests (should fail)
    log_info "Running tests (expecting failures)..."
    
    if run_tests "$FRAMEWORK" "$TEST_FILE"; then
        log_warn "Tests are passing! Expected failures in RED phase."
    else
        log_success "Tests failing as expected (RED phase)"
    fi
    
    # Prompt for implementation
    log_phase "GREEN phase"
    echo ""
    echo "Write minimal code to make tests pass."
    [ -n "${IMPL_FILE}" ] && echo "Edit: ${IMPL_FILE}"
    echo ""
    read -p "Press Enter when implementation is ready..." -r
    
    # GREEN: Run tests (should pass)
    log_info "Running tests (expecting success)..."
    
    if run_tests "$FRAMEWORK" "$TEST_FILE"; then
        log_success "Tests passing (GREEN phase)"
    else
        log_error "Tests still failing. Continue implementing."
        return 1
    fi
    
    # REFACTOR
    log_phase "REFACTOR phase"
    echo ""
    echo "Refactor code while keeping tests green."
    echo "- Remove duplication"
    echo "- Improve naming"
    echo "- Simplify logic"
    echo ""
    read -p "Press Enter to run tests after refactoring (or Ctrl+C to finish)..." -r
    
    # Verify tests still pass
    log_info "Verifying tests after refactor..."
    
    if run_tests "$FRAMEWORK" "$TEST_FILE"; then
        log_success "Tests still passing after refactor"
    else
        log_error "Tests broken by refactoring! Revert changes."
        return 1
    fi
    
    cycle_count=$((cycle_count + 1))
    
    echo ""
    read -p "Start another TDD cycle? (y/N) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        tdd_cycle
    fi
}

# Watch mode
if [ "$WATCH" == "true" ]; then
    log_info "Watch mode enabled"
    
    while true; do
        clear
        log_info "Running tests..."
        run_tests "$FRAMEWORK" "$TEST_FILE" || true
        
        echo ""
        echo "Watching for changes... (Ctrl+C to exit)"
        
        # Wait for file changes
        if command -v inotifywait &> /dev/null; then
            inotifywait -e modify "$TEST_FILE" ${IMPL_FILE:+"$IMPL_FILE"} 2>/dev/null
        else
            sleep 2
        fi
    done
else
    # Single cycle
    tdd_cycle
fi

log_success "TDD cycle complete"

exit 0
