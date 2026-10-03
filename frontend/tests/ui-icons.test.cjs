'use strict';

const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
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

