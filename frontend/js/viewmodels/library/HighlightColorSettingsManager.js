/**
 * HighlightColorSettingsManager.js
 * Manages editing and persistence of the highlight color palette.
 */
class HighlightColorSettingsManager {
  constructor() {
    this.modal = document.getElementById('colors-modal');
    this.colors = this.defaultColors();
  }

  defaultColors() {
    return [
      { id: 'yellow', name: 'Key Idea', color: '#fef08a' },
      { id: 'green', name: 'Definition', color: '#bbf7d0' },
      { id: 'blue', name: 'Reference', color: '#bfdbfe' },
      { id: 'red', name: 'Question / Important', color: '#fecaca' },
      { id: 'purple', name: 'Quote', color: '#e9d5ff' }
    ];
  }

  init() {
    document.getElementById('settings-colors-btn')?.addEventListener('click', () => this.open());
    document.getElementById('colors-cancel-btn')?.addEventListener('click', () => ModalView.close(this.modal));
    document.getElementById('colors-save-btn')?.addEventListener('click', () => this.save());
  }

  async open() {
    if (!this.modal) return;
    ModalView.open(this.modal);
    this.setStatus('Loading palette…');

    try {
      this.colors = this.normalizeColors(await api.getColors());
      this.render();
      this.setStatus('');
    } catch (error) {
      this.colors = this.defaultColors();
      this.render();
      this.setStatus('Could not load saved palette. Showing default colors.');
      console.error('[HighlightColorSettingsManager] Error loading colors:', error);
    }
  }

  normalizeColors(colors) {
    if (!Array.isArray(colors) || colors.length === 0) return this.defaultColors();
    const legacyMap = {
      'Idea Clave': 'Key Idea',
      'Definición': 'Definition',
      'Definicion': 'Definition',
      'Referencia': 'Reference',
      'Duda / Importante': 'Question / Important',
      'Cita': 'Quote'
    };
    return colors.map(color => ({
      ...color,
      id: String(color.id || ''),
      name: legacyMap[color.name] || String(color.name || ''),
      color: /^#[0-9a-f]{6}$/i.test(color.color || '') ? color.color : '#64748b'
    })).filter(color => color.id);
  }

  render() {
    const container = document.getElementById('colors-list');
    if (!container) return;
    container.replaceChildren();

    this.colors.forEach(color => {
      const row = document.createElement('div');
      row.className = 'highlight-color-row';
      row.dataset.colorId = color.id;

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'input-custom highlight-color-name';
      nameInput.value = color.name;
      nameInput.setAttribute('aria-label', `Name for ${color.name || color.id}`);
      nameInput.maxLength = 40;

      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.className = 'highlight-color-value';
      colorInput.value = color.color;
      colorInput.setAttribute('aria-label', `Color for ${color.name || color.id}`);

      row.append(nameInput, colorInput);
      container.appendChild(row);
    });
  }

  async save() {
    const saveButton = document.getElementById('colors-save-btn');
    const rows = Array.from(document.querySelectorAll('#colors-list .highlight-color-row'));
    const colors = rows.map(row => {
      const previous = this.colors.find(color => color.id === row.dataset.colorId);
      return {
        ...previous,
        name: row.querySelector('.highlight-color-name')?.value.trim() || '',
        color: row.querySelector('.highlight-color-value')?.value || previous.color
      };
    });

    if (colors.some(color => !color.name)) {
      this.setStatus('Each color requires a name.');
      return;
    }

    if (saveButton) saveButton.disabled = true;
    this.setStatus('Saving palette…');
    try {
      await api.saveColors(colors);
      this.colors = colors;
      ModalView.close(this.modal);
    } catch (error) {
      this.setStatus('Could not save palette. Please try again.');
      console.error('[HighlightColorSettingsManager] Error saving colors:', error);
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  }

  setStatus(message) {
    const status = document.getElementById('colors-status');
    if (status) status.textContent = message;
  }
}

window.HighlightColorSettingsManager = HighlightColorSettingsManager;
