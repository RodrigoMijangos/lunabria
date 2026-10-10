#!/usr/bin/env bash
# ==============================================================================
# Lunabria Service Installer (Linux / WSL2 / Raspberry Pi)
# Automatically detects current directory and user, then installs systemd unit.
# ==============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CURRENT_USER="${SUDO_USER:-$(id -un)}"
CURRENT_GROUP="$(id -gn "$CURRENT_USER" 2>/dev/null || id -gn)"

# Configurable via environment variables or .env file:
#   LUNABRIA_ENV_FILE      -> path to the .env file (default: repo/.env; empty disables loading)
#   LUNABRIA_VENV          -> virtualenv directory (default: backend/.venv)
#   LUNABRIA_PYTHON        -> full path to a Python executable (overrides LUNABRIA_VENV)
#   LUNABRIA_REQUIRED_VARS -> space-separated variables required to install (defaults listed below)
ENV_FILE="${LUNABRIA_ENV_FILE:-$REPO_DIR/.env}"
if [ -n "$ENV_FILE" ] && [[ "$ENV_FILE" != /* ]]; then
    ENV_FILE="$REPO_DIR/$ENV_FILE"
fi

# ==========================================================================
# Configuration resolution
# 1. Load variables from the .env file. If a variable is missing there,
#    the script falls back to the operating system environment.
# 2. An existing OS environment variable ALWAYS wins over .env (mirrors
#    backend/app/config.py).
# 3. Any required variable still missing aborts the install and names it.
# ==========================================================================
resolve_env() {
    ENV_SOURCE="operating system environment (no .env loaded)"
    if [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
        while IFS= read -r line || [ -n "$line" ]; do
            line="${line%%#*}"
            case "$line" in
                *=*)
                    key="${line%%=*}"
                    key="${key#"${key%%[![:space:]]*}"}"
                    key="${key%"${key##*[![:space:]]}"}"
                    val="${line#*=}"
                    val="${val#"${val%%[![:space:]]*}"}"
                    val="${val%"${val##*[![:space:]]}"}"
                    val="${val%\"}"; val="${val#\"}"
                    val="${val%\'}"; val="${val#\'}"
                    if [ -n "$key" ] && [ -z "${!key+x}" ]; then
                        export "$key=$val"
                    fi
                    ;;
            esac
        done < "$ENV_FILE"
        ENV_SOURCE="$ENV_FILE"
    fi
    return 0
}

resolve_env

REQUIRED_VARS="${LUNABRIA_REQUIRED_VARS:-HOST PORT APP_DATA_DIR CALIBRE_LIBRARY_PATH APP_STATE_DB_PATH}"

missing_vars=""
for var in $REQUIRED_VARS; do
    if [ -z "${!var:-}" ]; then
        missing_vars="$missing_vars $var"
    fi
done

if [ -n "$missing_vars" ]; then
    echo "=========================================================="
    echo "  Lunabria service install aborted"
    echo "=========================================================="
    echo "❌ Missing required variable(s):$missing_vars"
    echo "   Set them in your shell environment, or copy .env.example to $ENV_FILE"
    echo "   and adjust the values there. Currently loaded from: $ENV_SOURCE"
    exit 1
fi

VENV_DIR="${LUNABRIA_VENV:-$REPO_DIR/backend/.venv}"
if [[ "$VENV_DIR" != /* ]]; then
    VENV_DIR="$REPO_DIR/$VENV_DIR"
fi
VENV_DIR="$(cd "$VENV_DIR" 2>/dev/null && pwd || echo "${VENV_DIR%/}")"

if [ -n "${LUNABRIA_PYTHON:-}" ]; then
    VENV_PYTHON="$LUNABRIA_PYTHON"
    if [[ "$VENV_PYTHON" == ./* || "$VENV_PYTHON" == ../* ]]; then
        VENV_PYTHON="$REPO_DIR/$VENV_PYTHON"
    elif [[ "$VENV_PYTHON" != /* ]]; then
        resolved_bin="$(command -v "$VENV_PYTHON" 2>/dev/null || true)"
        if [ -n "$resolved_bin" ]; then
            VENV_PYTHON="$resolved_bin"
        fi
    fi
else
    VENV_PYTHON="$VENV_DIR/bin/python3"
fi
PYTHON_BIN_DIR="$(dirname "$VENV_PYTHON")"

echo "=========================================================="
echo "  Installing Lunabria systemd Service"
echo "=========================================================="
echo "  Repository root:       $REPO_DIR"
echo "  Run as user:           $CURRENT_USER:$CURRENT_GROUP"
echo "  Python venv:           $VENV_DIR"
echo "  Python binary:         $VENV_PYTHON"
echo "  Config source:         $ENV_SOURCE"
echo "  Bind:                  ${HOST}:${PORT}"
echo "  APP_DATA_DIR:          $APP_DATA_DIR"
echo "  CALIBRE_LIBRARY_PATH:  $CALIBRE_LIBRARY_PATH"
echo "  APP_STATE_DB_PATH:     $APP_STATE_DB_PATH"
echo "=========================================================="

if [ ! -x "$VENV_PYTHON" ]; then
    echo "❌ Error: Linux/WSL Python executable not found: $VENV_PYTHON"
    echo "   Create a Linux virtual environment in backend/.venv (or custom path via LUNABRIA_VENV),"
    echo "   or set LUNABRIA_PYTHON to an existing executable. A Windows .venv is not executable in WSL."
    exit 1
fi

if ! "$VENV_PYTHON" -m hypercorn --help >/dev/null 2>&1; then
    echo "❌ Error: Hypercorn is not installed for Python binary: $VENV_PYTHON"
    echo "   Install backend/requirements.txt into this Python environment first:"
    echo "   $VENV_PYTHON -m pip install -r $REPO_DIR/backend/requirements.txt"
    exit 1
fi

SERVICE_FILE="/etc/systemd/system/lunabria.service"

# systemd ignores a missing .env file ('-' prefix). We also write an explicit
# Environment= line for every resolved variable so values coming from the shell
# environment reach the service too.
if [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
    SOURCE_LINE="EnvironmentFile=-$ENV_FILE"
    echo "✅ Using .env file: $ENV_FILE"
else
    SOURCE_LINE="# No .env file found at $ENV_FILE; config sourced from the shell environment"
    echo "⚠️  No .env file at $ENV_FILE; configuration comes from the shell environment"
fi

ENV_LINES=""
for var in $REQUIRED_VARS; do
    ENV_LINES="$ENV_LINES
Environment=\"$var=${!var}\""
done

sudo bash -c "cat <<EOF > $SERVICE_FILE
[Unit]
Description=Lunabria Backend Service
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
Group=$CURRENT_GROUP
WorkingDirectory=$REPO_DIR/backend
$SOURCE_LINE
$ENV_LINES
Environment=\"PATH=$PYTHON_BIN_DIR:/usr/local/bin:/usr/bin\"
ExecStart=$VENV_PYTHON -m hypercorn app.main:app --bind ${HOST}:${PORT} --access-logfile - --error-logfile -
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF"

echo "✅ Created $SERVICE_FILE"

sudo systemctl daemon-reload
sudo systemctl enable --now lunabria

echo "🚀 Lunabria service enabled and started successfully!"
echo "   Status: sudo systemctl status lunabria"
echo "   Logs:   journalctl -u lunabria.service -f"
