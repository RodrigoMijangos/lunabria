/**
 * ToastView.js
 * Announces brief, non-blocking status messages.
 */
const ToastView = {
  show(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-relevant', 'additions');
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `app-toast app-toast-${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const text = document.createElement('span');
    text.textContent = message;
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'app-toast-dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss notification');
    dismiss.textContent = '×';
    dismiss.onclick = () => toast.remove();

    toast.append(text, dismiss);
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 7000);
    return toast;
  }
};

window.ToastView = ToastView;
