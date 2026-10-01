from typing import List, Optional
from fastapi import APIRouter, HTTPException
from app.services.library_service import library_service
from app.models import VirtualLibraryBooksAddRequest, VirtualLibraryCreate, VirtualLibraryResponse, BookBase

router = APIRouter(prefix="/api/virtual-libraries", tags=["Virtual Libraries"])

@router.get("", response_model=List[VirtualLibraryResponse])
def list_virtual_libraries():
    return library_service.list_virtual_libraries()

@router.post("", response_model=VirtualLibraryResponse)
def create_virtual_library(req: VirtualLibraryCreate):
    try:
        return library_service.create_virtual_library(
            name=req.name,
            lib_type=req.type,
            query=req.query or "",
            book_ids=req.book_ids or []
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error creating virtual library: {e}")

@router.post("/{lib_id}/books", response_model=VirtualLibraryResponse)
def add_books_to_virtual_library(lib_id: int, req: VirtualLibraryBooksAddRequest):
    try:
        lib = library_service.add_books_to_manual_library(lib_id, req.book_ids)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not lib:
        raise HTTPException(status_code=404, detail="Virtual library not found")
    return lib

@router.get("/{lib_id}", response_model=VirtualLibraryResponse)
def get_virtual_library(lib_id: int):
    lib = library_service.get_virtual_library(lib_id)
    if not lib:
        raise HTTPException(status_code=404, detail="Virtual library not found")
    return lib

@router.put("/{lib_id}", response_model=VirtualLibraryResponse)
def update_virtual_library(lib_id: int, req: VirtualLibraryCreate):
    lib = library_service.update_virtual_library(
        lib_id=lib_id,
        name=req.name,
        query=req.query,
        book_ids=req.book_ids
    )
    if not lib:
        raise HTTPException(status_code=404, detail="Virtual library not found")
    return lib

@router.delete("/{lib_id}")
def delete_virtual_library(lib_id: int):
    success = library_service.delete_virtual_library(lib_id)
    if not success:
        raise HTTPException(status_code=404, detail="Virtual library not found")
    return {"message": "Virtual library deleted"}

@router.get("/{lib_id}/books", response_model=List[BookBase])
def get_books_in_virtual_library(lib_id: int):
    return library_service.get_books_in_virtual_library(lib_id)
