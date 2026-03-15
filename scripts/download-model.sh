#!/usr/bin/env bash
# download-model.sh — Pre-download the all-MiniLM-L6-v2 ONNX embedding model.
#
# Mirrors the build-policy.sh pattern for external runtime binaries:
# check if already cached → download if not → verify ready.
#
# Model: Xenova/all-MiniLM-L6-v2 (384-dim sentence embeddings, ~22MB ONNX)
# Cache: $MODEL_CACHE_DIR (default: ~/.cache/huggingface/hub)
#
# Usage:
#   bash scripts/download-model.sh
#   MODEL_CACHE_DIR=/opt/models bash scripts/download-model.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVER_DIR="${REPO_ROOT}/server"

MODEL_NAME="${EMBEDDING_MODEL:-Xenova/all-MiniLM-L6-v2}"
CACHE_DIR="${MODEL_CACHE_DIR:-${HOME}/.cache/huggingface/hub}"

echo "[download-model] Model: ${MODEL_NAME}"
echo "[download-model] Cache: ${CACHE_DIR}"

# Check if model already downloaded (fast path)
MODEL_SLUG="${MODEL_NAME//\//-}"
if [ -d "${CACHE_DIR}" ] && find "${CACHE_DIR}" -name "*.onnx" 2>/dev/null | grep -q "${MODEL_SLUG}"; then
  echo "[download-model] Model already cached. Skipping download."
  exit 0
fi

echo "[download-model] Downloading model via @huggingface/transformers..."

# Run from server/ so the package is resolvable
node --input-type=module << EOF
import { pipeline } from '@huggingface/transformers';

process.env.TRANSFORMERS_CACHE = '${CACHE_DIR}';

console.log('[download-model] Loading pipeline (this may take a moment on first run)...');
const extractor = await pipeline('feature-extraction', '${MODEL_NAME}', { dtype: 'fp32' });
// Run a warm-up encode to confirm the model works end-to-end.
await extractor('warm-up', { pooling: 'mean', normalize: true });
console.log('[download-model] Model ready and verified.');
process.exit(0);
EOF

echo "[download-model] Done. Model cached at ${CACHE_DIR}"
