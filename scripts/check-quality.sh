#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [[ -n "${LUNABRIA_PYTHON:-}" ]]; then
    PYTHON="$LUNABRIA_PYTHON"
elif [[ -x "backend/.venv/bin/python" ]]; then
    PYTHON="backend/.venv/bin/python"
elif [[ -x "../../../backend/.venv/bin/python" ]]; then
    PYTHON="../../../backend/.venv/bin/python"
else
    PYTHON="python3"
fi

export PYTHONPATH="$REPO_ROOT/backend${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONIOENCODING="utf-8"
export PYTHONUTF8=1

run_check() {
    local name="$1"
    shift
    printf '\n=== %s ===\n' "$name"
    "$@"
}

run_check "Ruff lint" "$PYTHON" -m ruff check backend/
run_check "Mypy" "$PYTHON" -m mypy
run_check "Biome" npm run lint
run_check "JavaScript types" npm run typecheck
run_check "Frontend tests" npm test
run_check "Backend tests" "$PYTHON" -m unittest discover -s backend/tests -v

printf '\nAll quality checks passed.\n'
