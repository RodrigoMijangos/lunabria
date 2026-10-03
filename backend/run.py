import sys
import os
import subprocess
from pathlib import Path
from app.config import HOST, PORT, SSL_PORT

def ensure_ssl_certificates(cert_path: Path, key_path: Path) -> bool:
    """Generate self-signed localhost certificate if not present."""
    if cert_path.exists() and key_path.exists():
        return True
    
    cert_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        cmd = [
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", str(key_path),
            "-out", str(cert_path),
            "-days", "365",
            "-subj", "/CN=localhost",
            "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except Exception as e:
        print(f"[HTTP/2 Notice] Could not auto-generate SSL certificates: {e}")
        return False

def start_server():
    base_dir = Path(__file__).resolve().parent
    cert_path = base_dir / "certs" / "cert.pem"
    key_path = base_dir / "certs" / "key.pem"

    has_ssl = ensure_ssl_certificates(cert_path, key_path)

    cmd = [
        sys.executable, "-m", "hypercorn",
        "app.main:app",
        "--access-logfile", "-",
        "--error-logfile", "-"
    ]
    if os.getenv("RELOAD", "false").lower() == "true" and sys.platform != "win32":
        cmd.append("--reload")

    # Ensure UTF-8 output on Windows consoles
    if sys.platform == "win32":
        try:
            if hasattr(sys.stdout, "reconfigure"):
                sys.stdout.reconfigure(encoding="utf-8")
            if hasattr(sys.stderr, "reconfigure"):
                sys.stderr.reconfigure(encoding="utf-8")
        except Exception:
            pass

    if has_ssl:
        cmd.extend([
            "--bind", f"{HOST}:{SSL_PORT}",
            "--insecure-bind", f"{HOST}:{PORT}",
            "--certfile", str(cert_path),
            "--keyfile", str(key_path)
        ])
        print("=" * 60)
        print("  Lunabria HTTP/2 & ASGI Server (Hypercorn)")
        print("=" * 60)
        print(f"  [HTTPS] (HTTP/2 multiplexing via ALPN 'h2'):")
        print(f"     -> https://localhost:{SSL_PORT}")
        print(f"  [HTTP]  (HTTP/1.1 & h2c cleartext):")
        print(f"     -> http://localhost:{PORT}")
        print("  [Logs]  Live Access Logs: ACTIVADOS (consola stdout)")
        print("=" * 60)
    else:
        cmd.extend([
            "--bind", f"{HOST}:{PORT}"
        ])
        print("=" * 60)
        print(f"  Lunabria running on http://{HOST}:{PORT}")
        print("  [Logs]  Live Access Logs: ACTIVADOS (consola stdout)")
        print("=" * 60)

    try:
        subprocess.run(cmd, cwd=str(base_dir))
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    start_server()
