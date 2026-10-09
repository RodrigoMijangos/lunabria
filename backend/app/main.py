import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import init_db
from app.routers import books, metadata, virtual_libraries, reader, media
from app.config import WORKSPACE_DIR

app = FastAPI(
    title="Lunabria API",
    description="Backend for Calibre with enhanced reading experience and virtual libraries",
    version="1.3.1"
)

import time
from starlette.requests import Request

# Live Request Logging Middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    duration_ms = round((time.time() - start_time) * 1000, 1)

    client_ip = request.client.host if request.client else "127.0.0.1"
    http_version = request.scope.get("http_version", "1.1")
    method = request.method
    path = request.url.path
    if request.url.query:
        path += f"?{request.url.query}"
    status_code = response.status_code

    print(f"INFO:     {client_ip} - \"{method} {path} HTTP/{http_version}\" {status_code} ({duration_ms}ms)")
    return response

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Placeholder cover must be registered BEFORE parametric /{book_id} routes
from fastapi.responses import Response as FastAPIResponse
@app.get("/api/books/placeholder-cover", tags=["Media"])
def placeholder_cover():
    svg = """<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160">
  <rect width="120" height="160" rx="6" fill="#e8dcc8"/>
  <rect x="10" y="10" width="100" height="140" rx="4" fill="#f4ecd8" stroke="#c9b99a" stroke-width="1"/>
  <text x="60" y="75" font-family="serif" font-size="36" text-anchor="middle" fill="#a08060">📖</text>
  <text x="60" y="105" font-family="sans-serif" font-size="9" text-anchor="middle" fill="#8a7060">No cover</text>
</svg>"""
    return FastAPIResponse(content=svg, media_type="image/svg+xml",
                           headers={"Cache-Control": "public, max-age=86400"})

# Include Routers
app.include_router(books.router)
app.include_router(metadata.router)
app.include_router(virtual_libraries.router)
app.include_router(reader.router)
app.include_router(media.router)

@app.on_event("startup")
def startup_event():
    init_db()

@app.get("/api/health")
def health_check():
    return {"status": "ok", "app": "Lunabria"}

# Mount frontend static directory if exists
frontend_dir = WORKSPACE_DIR / "frontend"
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
