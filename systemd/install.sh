#!/usr/bin/env bash
# ==============================================================================
# Lunabria Service Installer (Linux / WSL2 / Raspberry Pi)
# Automatically detects current directory and user, then installs systemd unit.
# ==============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CURRENT_USER="${SUDO_USER:-$(id -un)}"
CURRENT_GROUP="$(id -gn "$CURRENT_USER" 2>/dev/null || id -gn)"
VENV_PYTHON="$REPO_DIR/backend/.venv/bin/python3"
VENV_HYPERCORN="$REPO_DIR/backend/.venv/bin/hypercorn"

echo "=========================================================="
echo "  Installing Lunabria systemd Service"
echo "=========================================================="
echo "  Repository root: $REPO_DIR"
echo "  Run as user:     $CURRENT_USER:$CURRENT_GROUP"
echo "  Python venv:     $VENV_PYTHON"
echo "=========================================================="

if [ ! -f "$VENV_PYTHON" ]; then
    echo "⚠️  Warning: Virtual environment not found at $REPO_DIR/backend/.venv"
    echo "   Make sure you ran:"
    echo "     cd backend && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt"
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
Environment=\"PATH=$REPO_DIR/backend/.venv/bin:/usr/local/bin:/usr/bin\"
ExecStart=$VENV_HYPERCORN app.main:app --bind 127.0.0.1:8000 --access-logfile - --error-logfile -
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
