/**
 * app.js
 * Moon-Calibre Main Application Entry Point & Facade
 * Implements MVVM Pattern:
 * - Model: LibraryModel (frontend/js/models/LibraryModel.js)
 * - Views: BookCardView, RecentReadsView, VirtualLibraryView, UploadModalView (frontend/js/views/LibraryViews.js)
 * - ViewModel: LibraryViewModel (frontend/js/viewmodels/LibraryViewModel.js)
 */

const app = new LibraryViewModel();
window.app = app;

document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
