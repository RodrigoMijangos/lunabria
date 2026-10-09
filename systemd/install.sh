#!/usr/bin/env bash
# ==============================================================================
# Lunabria Service Installer (Linux / WSL2 / Raspberry Pi)
# Automatically detects current directory and user, then installs systemd unit.
# ==============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CURRENT_USER="${SUDO_USER:-$(id -un)}"
CURRENT_GROUP="$(id -gn "$CURRENT_USER" 2>/dev/null || id -gn)"
VENV_DIR="${LUNABRIA_VENV:-$REPO_DIR/backend/.venv}"
VENV_PYTHON="$VENV_DIR/bin/python3"

echo "=========================================================="
echo "  Installing Lunabria systemd Service"
echo "=========================================================="
echo "  Repository root: $REPO_DIR"
echo "  Run as user:     $CURRENT_USER:$CURRENT_GROUP"
echo "  Python venv:     $VENV_DIR"
echo "=========================================================="

if [ ! -x "$VENV_PYTHON" ]; then
    echo "❌ Error: Linux/WSL Python executable not found: $VENV_PYTHON"
    echo "   Create a Linux virtual environment in backend/.venv, or set LUNABRIA_VENV"
    echo "   to an existing Linux virtual environment. A Windows .venv is not executable in WSL."
    exit 1
fi

if ! "$VENV_PYTHON" -m hypercorn --help >/dev/null 2>&1; then
    echo "❌ Error: Hypercorn is not installed in $VENV_DIR"
    echo "   Install backend/requirements.txt into this Linux virtual environment first."
    exit 1
fi

SERVICE_FILE="/etc/systemd/system/lunabria.service"

sudo bash -c "cat <<EOF > $SERVICE_FILE
[Unit]
Description=Lunabria Backend Service
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
Group=$CURRENT_GROUP
WorkingDirectory=$REPO_DIR/backend
Environment=\"PATH=$VENV_DIR/bin:/usr/local/bin:/usr/bin\"
ExecStart=$VENV_PYTHON -m hypercorn app.main:app --bind 127.0.0.1:8000 --access-logfile - --error-logfile -
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
