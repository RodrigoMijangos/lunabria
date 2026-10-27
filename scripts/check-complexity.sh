#!/usr/bin/env bash
# scripts/check-complexity.sh
# Runs complexity analysis for Python (Radon) and JavaScript in Lunabria.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [ -f "backend/.venv/bin/python" ]; then
    PY_EXE="backend/.venv/bin/python"
elif [ -f "../../../backend/.venv/bin/python" ]; then
    PY_EXE="../../../backend/.venv/bin/python"
else
    PY_EXE="python3"
fi

echo "================================================================================"
echo "                  LUNABRIA COMPLEXITY & MAINTAINABILITY AUDIT                   "
echo "================================================================================"

echo ""
echo "[1/3] Backend Python - Cyclomatic Complexity (Radon CC)"
$PY_EXE -m radon cc backend/app -a -s

echo ""
echo "[2/3] Backend Python - Maintainability Index (Radon MI)"
$PY_EXE -m radon mi backend/app -s

echo ""
echo "[3/3] Frontend JavaScript - Cyclomatic & Maintainability Metrics"
if [ "$1" == "--json" ]; then
    node scripts/js-complexity.cjs frontend/js --json
else
    node scripts/js-complexity.cjs frontend/js
fi

if [ "$1" == "--fail-on-threshold" ] || [ "$2" == "--fail-on-threshold" ]; then
    echo ""
    echo "[Quality Gate] Validating Python thresholds with Xenon..."
    $PY_EXE -m xenon --max-absolute F --max-modules F --max-average A backend/app
    echo "[Quality Gate Passed] All complexity thresholds are satisfied."
fi

echo ""
echo "Audit complete."
