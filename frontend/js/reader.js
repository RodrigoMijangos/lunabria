/**
 * reader.js
 * Moon-Calibre PDF Reader Entry Point & Facade
 * Implements MVVM Pattern:
 * - Model: ReaderModel (frontend/js/models/ReaderModel.js)
 * - Views: PDFPageView, TextLayerView, HighlightOverlayView, DrawingCanvasView, ReaderHUDView, NotesView (frontend/js/views/ReaderViews.js)
 * - ViewModel: ReaderViewModel (frontend/js/viewmodels/ReaderViewModel.js)
 */

class MoonReader extends ReaderViewModel {
  constructor() {
    super();
  }
}

// Global singleton instance for backward compatibility and HTML attribute handlers
const reader = new MoonReader();
window.reader = reader;
