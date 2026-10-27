# Development

Lunabria keeps its production deployment build-free. Quality tools are development-only and do not change the runtime requirements.

## Install development tools

From the repository root:

```powershell
python -m venv backend/.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
npm ci
```

On Linux or macOS, use `backend/.venv/bin/python` in place of the Windows executable path.

## Run checks

Run the complete local quality suite:

```powershell
.\scripts\check-quality.ps1
```

```sh
./scripts/check-quality.sh
```

The suite runs Ruff correctness, Bugbear, and security rules with explicit exceptions for existing diagnostics; Mypy checks all of `backend/app` and checks untyped function bodies; Biome analyzes `frontend/js` and `frontend/css`; and TypeScript checks the JSDoc-backed query compiler, selection geometry, HTTP helpers, and highlight overlay. Biome cognitive-complexity and unused-variable findings remain warnings so legacy zero-build scripts do not block unrelated work. Formatting is available but not enforced repository-wide because the existing backend would need broad reformatting. To run one check directly:

```text
python -m ruff check backend/
python -m mypy backend/app
npm run lint
npm run typecheck
npm test
```

Ruff formatting is available with `python -m ruff format backend/`; Biome formatting is available with `npm run format`. Both commands write changes, so target individual files and review the resulting diff before committing. The complexity and maintainability report is available separately through `scripts/check-complexity.ps1` or `scripts/check-complexity.sh`.

The optional `.pre-commit-config.yaml` runs the static checks before commits when the `pre-commit` package is installed and configured.
