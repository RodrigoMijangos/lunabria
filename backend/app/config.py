import os
from pathlib import Path

# Base directories
BASE_DIR = Path(__file__).resolve().parent.parent
WORKSPACE_DIR = BASE_DIR.parent

def _load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip().strip("'\"")
                if key and key not in os.environ:
                    os.environ[key] = val
    except Exception:
        pass

# Automatically load .env if present
_load_env_file(WORKSPACE_DIR / ".env")
_load_env_file(BASE_DIR / ".env")

def _resolve_path(raw_path: str | None, default: Path) -> Path:
    if not raw_path:
        return default
    p = Path(raw_path)
    return p if p.is_absolute() else (WORKSPACE_DIR / p).resolve()

DATA_DIR = _resolve_path(os.getenv("APP_DATA_DIR"), WORKSPACE_DIR / "data")
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Calibre Library Path (can be set via env var)
# Default for testing: data/test_library or user-specified path
CALIBRE_LIBRARY_PATH = str(_resolve_path(os.getenv("CALIBRE_LIBRARY_PATH"), DATA_DIR / "calibre_library"))

# Application State Database (SQLite)
APP_STATE_DB_PATH = str(_resolve_path(os.getenv("APP_STATE_DB_PATH"), DATA_DIR / "app_state.db"))

# Upload temp directory
UPLOAD_DIR = DATA_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Server port & host resolution
# Supports HOST, LISTEN (e.g. "0.0.0.0", "0.0.0.0:8000", ":8000"), SERVER_HOST, BIND, and PORT
def _resolve_server_binding():
    raw_listen = (
        os.getenv("LISTEN")
        or os.getenv("SERVER_LISTEN")
        or os.getenv("BIND")
        or os.getenv("HYPERCORN_BIND")
    )
    raw_host = (
        os.getenv("SERVER_HOST")
        or os.getenv("HOST")
    )
    raw_port = (
        os.getenv("SERVER_PORT")
        or os.getenv("PORT")
    )
    raw_ssl_port = os.getenv("SSL_PORT", "8443")

    host = "0.0.0.0"
    port = 8000
    ssl_port = 8443

    if raw_port:
        try:
            port = int(raw_port)
        except ValueError:
            pass

    if raw_ssl_port:
        try:
            ssl_port = int(raw_ssl_port)
        except ValueError:
            pass

    if raw_host:
        host = raw_host.strip()

    if raw_listen:
        raw_listen = raw_listen.strip()
        if ":" in raw_listen:
            parts = raw_listen.rsplit(":", 1)
            h = parts[0].strip("[]")
            p = parts[1]
            if h:
                host = h
            try:
                port = int(p)
            except ValueError:
                pass
        else:
            if raw_listen.isdigit():
                port = int(raw_listen)
            else:
                host = raw_listen

    return host, port, ssl_port

HOST, PORT, SSL_PORT = _resolve_server_binding()


# Calibre CLI commands
CALIBREDB_BIN = os.getenv("CALIBREDB_BIN", "calibredb")
EBOOK_CONVERT_BIN = os.getenv("EBOOK_CONVERT_BIN", "ebook-convert")
CONVERTED_PDF_DIR = DATA_DIR / "converted_pdfs"
FETCH_METADATA_BIN = os.getenv("FETCH_METADATA_BIN", "fetch-ebook-metadata")
