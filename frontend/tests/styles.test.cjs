const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const cssDirectory = path.join(__dirname, '..', 'css');
// Immutable fingerprint of style.css before the mechanical extraction (UTF-8, LF).
const originalFixture = {
  sha256: 'b7e567dac5e5e20571117df85866d06385be2699269f247f17e849618bc86152',
  bytes: 67143,
  lines: 3275,
};
const sheets = [
  ['themes.css', 74],
  ['base-navbar.css', 245],
  ['library-catalog.css', 433],
  ['library-cards.css', 268],
  ['reader-pages.css', 564],
  ['drawing.css', 300],
  ['reader-selection-drawer.css', 356],
  ['modals.css', 372],
  ['notebook.css', 459],
  ['responsive.css', 204],
];

function imports() {
  const entry = readFileSync(path.join(cssDirectory, 'style.css'), 'utf8');
  const matches = [...entry.matchAll(/@import "([a-z-]+\.css)";\r?\n/g)];
  assert.equal(matches.map((match) => match[0]).join(''), entry,
    'The entry must contain only unconditional imports, one per line');
  return matches.map((match) => match[1]);
}

// A boundary check, not a CSS validator: each sheet must finish outside any
// comment, string or bracketed construct, and after a complete top-level rule.
function assertSafeBoundary(text, name) {
  const stack = [];
  let quote = null;
  let comment = false;
  let pendingRule = false;
  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    const next = text[i + 1];
    if (comment) {
      if (character === '*' && next === '/') {
        comment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (character === '\\') i += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '/' && next === '*') {
      comment = true;
      i += 1;
      continue;
    }
    if (character === '\\') {
      pendingRule = true;
      i += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      pendingRule = true;
      continue;
    }
    if ('{(['.includes(character)) {
      stack.push(character);
      pendingRule = true;
    } else if ('})]'.includes(character)) {
      const opening = { '}': '{', ')': '(', ']': '[' }[character];
      assert.equal(stack.pop(), opening, `${name}: unmatched ${character}`);
      if (character === '}' && stack.length === 0) pendingRule = false;
    } else if (character === ';' && stack.length === 0) {
      pendingRule = false;
    } else if (!/\s/.test(character)) {
      pendingRule = true;
    }
  }
  assert.equal(comment, false, `${name}: unterminated comment`);
  assert.equal(quote, null, `${name}: unterminated string`);
  assert.deepEqual(stack, [], `${name}: split inside a rule or media block`);
  assert.equal(pendingRule, false, `${name}: incomplete top-level rule`);
}

test('style.css imports every extracted sheet once in original cascade order', () => {
  const names = imports();
  assert.deepEqual(names, [...sheets.map(([name]) => name), 'design.css']);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(
    readdirSync(cssDirectory).filter((name) => name.endsWith('.css')).sort(),
    ['style.css', ...names].sort(),
  );
});

test('concatenation without separators matches the original SHA-256 fixture', () => {
  // The intentional icon/theme refinements are appended separately, not part of extraction.
  const bytes = Buffer.concat(sheets.map(([name]) =>
    readFileSync(path.join(cssDirectory, name))));
  assert.equal(bytes.length, originalFixture.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), originalFixture.sha256);
  assert.equal(bytes.toString('utf8').split('\n').length - 1, originalFixture.lines);
  assert.deepEqual(Buffer.from(bytes.toString('utf8'), 'utf8'), bytes);
});

test('sheets preserve original line boundaries and stay within 700 lines', () => {
  for (const [name, expectedLines] of sheets) {
    const text = readFileSync(path.join(cssDirectory, name), 'utf8');
    assert.ok(!text.includes('\r'), `${name}: original uses LF, not CRLF`);
    assert.ok(text.endsWith('\n'), `${name}: missing original final newline`);
    const lines = text.split('\n').length - 1;
    assert.equal(lines, expectedLines, `${name}: changed extraction boundary`);
    assert.ok(lines <= 700, `${name}: exceeds 700 lines`);
    assert.ok(!/@import\b/i.test(text), `${name}: nested import`);
    assertSafeBoundary(text, name);
  }
});

test('visual refinements are isolated from document and annotation rendering', () => {
  const text = readFileSync(path.join(cssDirectory, 'design.css'), 'utf8');
  assertSafeBoundary(text, 'design.css');
  assert.ok(!/--pdf-filter|\.textLayer|\.pdf-highlight-rect|\.pdf-page|--bg-primary/.test(text));
  assert.match(text, /stroke:\s*currentColor/);
  assert.match(text, /pointer-events:\s*none/);
  assert.match(text, /\.floating-toolbar\s*\{[^}]*max-width:\s*calc\(100vw - 24px\)/);
  assert.match(text, /\.floating-toolbar\s*\{[^}]*background-color:\s*var\(--bg-elevated\)/);
  assert.match(text, /\.floating-toolbar\s*\{[^}]*transition:\s*opacity 0\.15s ease;/);
  assert.match(text, /\.highlight-action-toolbar\s*\{[^}]*transform:\s*translateX\(-50%\)/);
  assert.match(text, /\.floating-toolbar button:focus-visible/);
  for (const rgb of ['168, 82, 34', '226, 135, 67', '245, 158, 11']) {
    assert.ok(text.includes(`--ui-accent-rgb: ${rgb}`));
  }
});

test('sync modal declares responsive layout safeguards for mobile viewports', () => {
  const text = readFileSync(path.join(cssDirectory, 'design.css'), 'utf8');
  assertSafeBoundary(text, 'design.css');
  assert.match(text, /\.sync-option-card\s*\{[^}]*box-sizing:\s*border-box/);
  assert.match(text, /\.sync-card-content\s*\{[^}]*min-width:\s*0/);
  assert.match(text, /\.sync-interval-picker\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(text, /\.sync-quick-btns\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(text, /@media\s*\(max-width:\s*580px\)/);
});
