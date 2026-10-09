import sys
import os
import subprocess
import argparse
from pathlib import Path
from app.config import HOST, PORT, SSL_PORT

def get_lan_ip() -> str | None:
    """Attempt to discover the host's LAN IP address for external device access."""
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.2)
        s.connect(('10.254.254.254', 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None

def ensure_ssl_certificates(cert_path: Path, key_path: Path, extra_ips: list[str] | None = None) -> bool:
    """Generate self-signed certificate if not present."""
    if cert_path.exists() and key_path.exists():
        return True
    
    cert_path.parent.mkdir(parents=True, exist_ok=True)
    san_list = ["DNS:localhost", "IP:127.0.0.1", "IP:0.0.0.0"]
    if extra_ips:
        for ip in extra_ips:
            if ip and ip not in ("127.0.0.1", "0.0.0.0", "localhost"):
                san_list.append(f"IP:{ip}")
    san_str = ",".join(san_list)
    try:
        cmd = [
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", str(key_path),
            "-out", str(cert_path),
            "-days", "365",
            "-subj", "/CN=localhost",
            "-addext", f"subjectAltName={san_str}"
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except Exception as e:
        print(f"[HTTP/2 Notice] Could not auto-generate SSL certificates: {e}")
        return False

def start_server():
    base_dir = Path(__file__).resolve().parent

    parser = argparse.ArgumentParser(description="Lunabria HTTP/2 & ASGI Server")
    parser.add_argument("--host", "-H", help="Host address to bind to (e.g. 0.0.0.0 or 127.0.0.1)")
    parser.add_argument("--port", "-p", type=int, help="Port to bind to (default: 8000)")
    parser.add_argument("--ssl-port", type=int, help="SSL Port to bind to (default: 8443)")
    parser.add_argument("--bind", "-b", "--listen", dest="bind", help="Custom bind string (e.g. 0.0.0.0:8000)")
    parser.add_argument("positional_args", nargs="*", help="Optional positional arguments [host] [port]")

    args, _ = parser.parse_known_args()

    host = HOST
    port = PORT
    ssl_port = SSL_PORT

    if args.host:
        host = args.host.strip()
    if args.port:
        port = args.port
    if args.ssl_port:
        ssl_port = args.ssl_port

    if args.bind:
        raw_b = args.bind.strip()
        if ":" in raw_b:
            parts = raw_b.rsplit(":", 1)
            if parts[0]:
                host = parts[0].strip("[]")
            try:
                port = int(parts[1])
            except ValueError:
                pass
        else:
            if raw_b.isdigit():
                port = int(raw_b)
            else:
                host = raw_b

    if args.positional_args:
        if len(args.positional_args) >= 1 and not args.host and not args.bind:
            cand = args.positional_args[0].strip()
            if cand.isdigit():
                port = int(cand)
            else:
                host = cand
        if len(args.positional_args) >= 2 and not args.port:
            try:
                port = int(args.positional_args[1])
            except ValueError:
                pass

    cert_path = base_dir / "certs" / "cert.pem"
    key_path = base_dir / "certs" / "key.pem"
    lan_ip = get_lan_ip() if host in ("0.0.0.0", "::") else None

    has_ssl = ensure_ssl_certificates(cert_path, key_path, [lan_ip] if lan_ip else None)

    cmd = [
        sys.executable, "-m", "hypercorn",
        "app.main:app",
        "--access-logfile", "-",
        "--error-logfile", "-"
    ]

    # Windows multiprocess spawning with Hypercorn has known WaitForMultipleObjects issues.
    # Running in single-process mode (-w 0) executes worker_func in-process, preventing SpawnProcess crashes.
    if sys.platform == "win32":
        cmd.extend(["--workers", "0"])

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
            "--bind", f"{host}:{ssl_port}",
            "--insecure-bind", f"{host}:{port}",
            "--certfile", str(cert_path),
            "--keyfile", str(key_path)
        ])
        print("=" * 60, flush=True)
        print("  Lunabria HTTP/2 & ASGI Server (Hypercorn)", flush=True)
        print("=" * 60, flush=True)
        print(f"  [HTTPS] (HTTP/2 multiplexing via ALPN 'h2'):", flush=True)
        print(f"     -> https://localhost:{ssl_port}", flush=True)
        if lan_ip:
            print(f"     -> https://{lan_ip}:{ssl_port} (Red Local / Dispositivos Móviles)", flush=True)
        elif host not in ("127.0.0.1", "localhost", "0.0.0.0", "::"):
            print(f"     -> https://{host}:{ssl_port}", flush=True)
        print(f"  [HTTP]  (HTTP/1.1 & h2c cleartext):", flush=True)
        print(f"     -> http://localhost:{port}", flush=True)
        if lan_ip:
            print(f"     -> http://{lan_ip}:{port} (Red Local / Dispositivos Móviles)", flush=True)
        elif host not in ("127.0.0.1", "localhost", "0.0.0.0", "::"):
            print(f"     -> http://{host}:{port}", flush=True)
        print(f"  [Host]  Host de escucha: {host}", flush=True)
        print("  [Logs]  Live Access Logs: ACTIVADOS (consola stdout)", flush=True)
        print("=" * 60, flush=True)
    else:
        cmd.extend([
            "--bind", f"{host}:{port}"
        ])
        print("=" * 60, flush=True)
        print(f"  Lunabria running on:", flush=True)
        print(f"     -> http://localhost:{port}", flush=True)
        if lan_ip:
            print(f"     -> http://{lan_ip}:{port} (Red Local / Dispositivos Móviles)", flush=True)
        elif host not in ("127.0.0.1", "localhost", "0.0.0.0", "::"):
            print(f"     -> http://{host}:{port}", flush=True)
        print(f"  [Host]  Host de escucha: {host}", flush=True)
        print("  [Logs]  Live Access Logs: ACTIVADOS (consola stdout)", flush=True)
        print("=" * 60, flush=True)

    try:
        subprocess.run(cmd, cwd=str(base_dir))
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    start_server()

