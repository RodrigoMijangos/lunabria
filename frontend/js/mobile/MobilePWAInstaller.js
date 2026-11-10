/**
 * MobilePWAInstaller.js
 * Manages PWA installation triggers across Mobile, Tablet, and Desktop.
 * Listens to `beforeinstallprompt`, renders or enables install triggers, and handles iOS instructions.
 */
class MobilePWAInstaller {
  constructor() {
    this.deferredPrompt = null;
    this.isInstalled = false;
    this.init();
  }

  init() {
    this.checkIfInstalled();
    this.bindInstallEvents();
  }

  checkIfInstalled() {
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
      this.isInstalled = true;
    }
  }

  bindInstallEvents() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      this.updateInstallButtonUI(true);
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.isInstalled = true;
      this.updateInstallButtonUI(false);
      console.log('[MobilePWAInstaller] Lunabria successfully installed');
    });

    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) {
      installBtn.addEventListener('click', () => this.promptInstall());
    }
  }

  async promptInstall() {
    if (this.deferredPrompt) {
      this.deferredPrompt.prompt();
      const choiceResult = await this.deferredPrompt.userChoice;
      if (choiceResult && choiceResult.outcome === 'accepted') {
        console.log('[MobilePWAInstaller] User accepted PWA install prompt');
      }
      this.deferredPrompt = null;
      this.updateInstallButtonUI(false);
    } else {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      if (isIOS) {
        alert('To install Lunabria on your iPhone or iPad, tap the Share button in Safari and select "Add to Home Screen".');
      } else {
        alert('Lunabria is already installed or your browser allows installing it from the address bar menu.');
      }
    }
  }

  updateInstallButtonUI(canInstall) {
    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) {
      installBtn.style.display = canInstall && !this.isInstalled ? 'inline-flex' : 'none';
    }
  }
}

window.MobilePWAInstaller = MobilePWAInstaller;
