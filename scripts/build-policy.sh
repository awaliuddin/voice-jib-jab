#!/usr/bin/env bash
# build-policy.sh — Compile OPA Rego policies to a WASM bundle.
#
# Downloads the OPA CLI if not present, then builds a multi-entrypoint
# WASM bundle containing both PolicyGate and ModeratorCheck rules.
#
# Output: server/policies/bundle.tar.gz
#
# Usage:
#   bash scripts/build-policy.sh
#   npm run build:policy     (from server/)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
POLICIES_DIR="${REPO_ROOT}/server/policies"
OUTPUT="${POLICIES_DIR}/bundle.tar.gz"
OPA_BIN="${REPO_ROOT}/.bin/opa"
OPA_VERSION="v0.71.0"

# ── Download OPA CLI if not present ────────────────────────────────────

if [[ ! -x "${OPA_BIN}" ]]; then
  echo "[build-policy] Downloading OPA CLI ${OPA_VERSION}..."
  mkdir -p "$(dirname "${OPA_BIN}")"

  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m)"
  case "${ARCH}" in
    x86_64)  ARCH="amd64" ;;
    aarch64) ARCH="arm64_static" ;;
    arm64)   ARCH="arm64_static" ;;
    *)       echo "[build-policy] Unsupported arch: ${ARCH}"; exit 1 ;;
  esac

  URL="https://github.com/open-policy-agent/opa/releases/download/${OPA_VERSION}/opa_${OS}_${ARCH}"
  curl -fsSL "${URL}" -o "${OPA_BIN}"
  chmod +x "${OPA_BIN}"
  echo "[build-policy] OPA CLI downloaded to ${OPA_BIN}"
fi

# ── Build WASM bundle ───────────────────────────────────────────────────

echo "[build-policy] Building WASM bundle..."
echo "  Entrypoints: voice_jib_jab/result, voice_jib_jab/moderator_check"
echo "  Output: ${OUTPUT}"

"${OPA_BIN}" build \
  -t wasm \
  -e voice_jib_jab/result \
  -e voice_jib_jab/moderator_check \
  -o "${OUTPUT}" \
  "${POLICIES_DIR}"

echo "[build-policy] Done — bundle written to ${OUTPUT}"
