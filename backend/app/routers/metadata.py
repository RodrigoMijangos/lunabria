from fastapi import APIRouter, HTTPException
from app.services.calibre_service import calibre_service
from app.services.metadata_service import metadata_service
from app.models import (
    MetadataFetchRequest,
    MetadataFetchResponse,
    MetadataSourcesResponse,
    MetadataSourcesUpdateRequest,
    MetadataUpdateRequest,
)

router = APIRouter(prefix="/api/metadata", tags=["Metadata"])

@router.get("/sources", response_model=MetadataSourcesResponse)
def get_metadata_sources():
    try:
        return metadata_service.get_source_preferences()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error detecting Calibre sources: {e}")

@router.put("/sources", response_model=MetadataSourcesResponse)
def update_metadata_sources(req: MetadataSourcesUpdateRequest):
    try:
        return metadata_service.save_source_preferences(req.selected_sources)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving Calibre sources: {e}")

@router.post("/fetch", response_model=MetadataFetchResponse)
def fetch_online_metadata(req: MetadataFetchRequest):
    """
    Scrapes online metadata using Calibre's fetch-ebook-metadata CLI.
    Useful for previewing synopsis, cover, authors, and tags before applying.
    """
    if not req.isbn and not req.title:
        raise HTTPException(status_code=400, detail="At least an ISBN or title must be specified")
    
    try:
        data = calibre_service.fetch_metadata(
            isbn=req.isbn,
            title=req.title,
            authors=req.authors
        )
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching metadata from Calibre: {e}")

@router.put("/{book_id}")
def update_book_metadata(book_id: int, req: MetadataUpdateRequest):
    """
    Updates a book's metadata in Calibre's metadata.db using calibredb set_metadata.
    """
    book = calibre_service.get_book(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    try:
        calibre_service.update_metadata(
            book_id=book_id,
            title=req.title,
            authors=req.authors,
            tags=req.tags,
            series=req.series,
            series_index=req.series_index,
            comments=req.comments,
            isbn=req.isbn
        )
        updated = calibre_service.get_book(book_id)
        return {"message": "Metadata updated successfully", "book": updated}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating metadata: {e}")
