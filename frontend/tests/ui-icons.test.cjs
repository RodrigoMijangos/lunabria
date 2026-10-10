'use strict';

const assert = require('node:assert/strict');
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const frontend = path.resolve(__dirname, '..');
const read = relative => readFileSync(path.join(frontend, relative), 'utf8');
const pictograph = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{25A0}-\u{27FF}\u{2B00}-\u{2BFF}]/u;
const spriteIds = new Set(
  [...read('icons.svg').matchAll(/<symbol\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1]),
);
const userInterfaceScripts = [
  ...readdirSync(path.join(frontend, 'js', 'views'), { recursive: true })
    .filter(file => /\.js$/.test(file))
    .map(file => path.join('js', 'views', file)),
  ...readdirSync(path.join(frontend, 'js', 'viewmodels'), { recursive: true })
    .filter(file => /\.js$/.test(file))
    .map(file => path.join('js', 'viewmodels', file)),
].filter(file => !file.includes(`${path.sep}services${path.sep}`));

test('menus and UI render SVG icons instead of pictographic glyphs', () => {
  for (const file of ['index.html', ...userInterfaceScripts]) {
    assert.equal(pictograph.test(read(file)), false, `${file} contains a pictograph used as interface chrome`);
  }
});

test('all external sprite references point to defined reusable SVG symbols', () => {
  assert.ok(spriteIds.size >= 25, 'The shared icon sprite should cover the application menus');
  const referencedIds = new Set();
  for (const file of ['index.html', ...userInterfaceScripts]) {
    for (const match of read(file).matchAll(/(?:href|xlink:href)=["']\.\/icons\.svg#([\w-]+)/g)) {
      referencedIds.add(match[1]);
    }
  }
  assert.ok(referencedIds.size >= 20, 'Expected reusable icons across the menus and generated views');
  for (const id of referencedIds) assert.ok(spriteIds.has(id), `Missing SVG symbol: ${id}`);
});

test('icon-only static buttons retain accessible names and hide decorative SVGs', () => {
  const html = read('index.html');
  for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const [, attributes, contents] = match;
    if (!/<svg\b/i.test(contents)) continue;

    const text = contents.replace(/<svg\b[\s\S]*?<\/svg>/gi, '').replace(/<[^>]+>/g, '').trim();
    if (!text) {
      assert.match(attributes, /\b(?:aria-label|title)=["'][^"']+/, 'Icon-only buttons need an accessible name');
    }
    for (const svg of contents.matchAll(/<svg\b([^>]*)>/gi)) {
      assert.match(svg[1], /\baria-hidden=["']true["']/i, 'Decorative icons must not duplicate button names');
      assert.match(svg[1], /\bfocusable=["']false["']/i);
    }
  }
});

test('brand identity declares valid SVG favicon, fallback PNG and maskable touch icon', () => {
  const html = read('index.html');
  assert.match(html, /<link\s+rel=["']icon["']\s+type=["']image\/svg\+xml["']\s+href=["']\.\/icons\/favicon\.svg["']/i);
  assert.match(html, /<link\s+rel=["']icon["']\s+type=["']image\/png["']\s+sizes=["']192x192["']\s+href=["']\.\/icons\/icon-192\.png["']/i);
  assert.match(html, /<link\s+rel=["']apple-touch-icon["']\s+href=["']\.\/icons\/maskable-192\.png["']/i);

  assert.ok(existsSync(path.join(frontend, 'icons', 'favicon.svg')), 'favicon.svg must exist');
  const faviconSvg = read('icons/favicon.svg');
  assert.match(faviconSvg, /viewBox=["']0 0 24 24["']/);
  assert.match(faviconSvg, /prefers-color-scheme:\s*dark/);
});

test('manifest declares dedicated any and maskable icons', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(Array.isArray(manifest.icons), 'manifest.json must have icons array');

  const purposes = new Set(manifest.icons.map(icon => icon.purpose));
  assert.ok(purposes.has('any'), 'manifest must declare any icons');
  assert.ok(purposes.has('maskable'), 'manifest must declare maskable icons');

  for (const icon of manifest.icons) {
    const iconPath = path.join(frontend, icon.src.replace(/^\.\//, ''));
    assert.ok(existsSync(iconPath), `Icon file must exist: ${icon.src}`);
  }
});

test('brand design tokens and reduced motion transitions are defined for all themes', () => {
  const designCss = read('css/design.css');
  for (const themeSelector of [':root', '\\[data-theme="dark"\\]', '\\[data-theme="amoled"\\]']) {
    const rx = new RegExp(`${themeSelector}[^{]*\\{[^}]*--brand-bg:[^}]*--brand-fg:[^}]*--brand-accent:[^}]*--brand-accent-rgb:`, 's');
    assert.match(designCss, rx, `Missing brand tokens in ${themeSelector}`);
  }
  assert.match(designCss, /prefers-reduced-motion:\s*reduce/);
});

test('brand logo uses monoline open-book crescent symbol with accessible name', () => {
  const iconsSvg = read('icons.svg');
  assert.match(iconsSvg, /<symbol\s+id=["']moon["']\s+viewBox=["']0 0 24 24["']>/);

  const html = read('index.html');
  assert.match(html, /<span class=["']brand-badge["']><svg class=["']ui-icon["']\s+aria-hidden=["']true["']\s+focusable=["']false["']><use href=["']\.\/icons\.svg#moon["']><\/use><\/svg><\/span>/);
  assert.match(html, /<span class=["']brand-title["']>Lunabria<\/span>/);
});