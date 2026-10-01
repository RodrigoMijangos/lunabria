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

DATA_DIR = Path(os.getenv("APP_DATA_DIR", str(WORKSPACE_DIR / "data")))
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Calibre Library Path (can be set via env var)
# Default for testing: data/test_library or user-specified path
CALIBRE_LIBRARY_PATH = os.getenv("CALIBRE_LIBRARY_PATH", str(DATA_DIR / "calibre_library"))

# Application State Database (SQLite)
APP_STATE_DB_PATH = os.getenv("APP_STATE_DB_PATH", str(DATA_DIR / "app_state.db"))

# Upload temp directory
UPLOAD_DIR = DATA_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Server port & host
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
SSL_PORT = int(os.getenv("SSL_PORT", "8443"))


# Calibre CLI commands
CALIBREDB_BIN = os.getenv("CALIBREDB_BIN", "calibredb")
EBOOK_CONVERT_BIN = os.getenv("EBOOK_CONVERT_BIN", "ebook-convert")
CONVERTED_PDF_DIR = DATA_DIR / "converted_pdfs"
FETCH_METADATA_BIN = os.getenv("FETCH_METADATA_BIN", "fetch-ebook-metadata")
