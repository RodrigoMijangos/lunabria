/** Colors API domain. Compose on the facade to preserve dynamic this. */
const createColorsApiService = () => ({
  // Highlight Colors Settings
  async getColors() {
    const res = await fetch('/api/settings/colors');
    if (!res.ok) return [];
    return res.json();
  },

  async saveColors(colors) {
    console.log('[Lunabria] 🎨 Saving color configuration:', colors);
    const res = await fetch('/api/settings/colors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(colors)
    });
    if (!res.ok) throw new Error('Error saving colors');
    const result = await res.json();
    console.log('[Lunabria] ✔️ Color palette saved');
    return result;
  },
});
