/**
 * ModalView.js
 * Shared visibility behavior for modal overlays.
 */
const ModalView = {
  open(modal) {
    if (!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  },

  close(modal) {
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
};

window.ModalView = ModalView;
