from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

class BookBase(BaseModel):
    id: int
    title: str
    authors: str
    formats: List[str] = []
    tags: List[str] = []
    series: Optional[str] = None
    series_index: Optional[float] = None
    pubdate: Optional[str] = None
    date_added: Optional[str] = None
    last_read_at: Optional[str] = None
    comments: Optional[str] = None
    isbn: Optional[str] = None
    has_cover: bool = False
    cover_url: Optional[str] = None

class BookWithProgress(BookBase):
    current_page: Optional[int] = None
    total_pages: Optional[int] = None
    percentage: Optional[float] = None
    last_read_at: Optional[str] = None

class PaginatedBooksResponse(BaseModel):
    books: List[BookBase]
    total: int
    page: int
    page_size: int

class VirtualLibraryBase(BaseModel):
    name: str
    type: str = "query"  # "query" or "manual"
    query: Optional[str] = ""
    book_ids: Optional[List[int]] = []

class VirtualLibraryCreate(VirtualLibraryBase):
    pass

class VirtualLibraryBooksAddRequest(BaseModel):
    book_ids: List[int] = Field(min_length=1)

class VirtualLibraryResponse(VirtualLibraryBase):
    id: int
    created_at: str
    updated_at: str

class ReadingProgressUpdate(BaseModel):
    current_page: int
    total_pages: int
    percentage: float

class ReadingProgressResponse(BaseModel):
    book_id: int
    current_page: int
    total_pages: int
    percentage: float
    last_read_at: str

class AnnotationBase(BaseModel):
    book_id: int
    page: int
    color: str
    category: Optional[str] = ""
    text: str
    comment: Optional[str] = ""
    rects: Optional[List[Dict[str, Any]]] = []

class AnnotationCreate(AnnotationBase):
    id: Optional[str] = None

class AnnotationUpdate(BaseModel):
    color: Optional[str] = None
    category: Optional[str] = None
    comment: Optional[str] = None

class AnnotationResponse(AnnotationBase):
    id: str
    created_at: str
    updated_at: str

class HighlightColor(BaseModel):
    id: str
    name: str
    color: str
    textColor: Optional[str] = "#000000"

class MetadataFetchRequest(BaseModel):
    isbn: Optional[str] = None
    title: Optional[str] = None
    authors: Optional[str] = None

class MetadataSourcesResponse(BaseModel):
    available_sources: List[str]
    selected_sources: List[str]
    unavailable_sources: List[str] = Field(default_factory=list)

class MetadataSourcesUpdateRequest(BaseModel):
    selected_sources: List[str] = Field(min_length=1)

class MetadataFetchResponse(BaseModel):
    title: Optional[str] = None
    authors: Optional[List[str]] = []
    isbn: Optional[str] = None
    publisher: Optional[str] = None
    tags: Optional[List[str]] = []
    comments: Optional[str] = None
    has_cover: bool = False
    cover_data_base64: Optional[str] = None

class MetadataUpdateRequest(BaseModel):
    title: Optional[str] = None
    authors: Optional[str] = None
    tags: Optional[str] = None
    series: Optional[str] = None
    series_index: Optional[float] = None
    comments: Optional[str] = None
    isbn: Optional[str] = None
