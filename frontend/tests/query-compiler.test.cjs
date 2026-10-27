const test = require('node:test');
const assert = require('node:assert/strict');
const { LunabriaQueryCompiler } = require('../js/services/LunabriaQueryCompiler.js');

test('LunabriaQueryCompiler empty input handling', () => {
  assert.equal(LunabriaQueryCompiler.compile(''), '');
  assert.equal(LunabriaQueryCompiler.compile('   '), '');
  assert.equal(LunabriaQueryCompiler.compile(null), '');
  assert.equal(LunabriaQueryCompiler.compile(undefined), '');
});

test('LunabriaQueryCompiler single unquoted field', () => {
  assert.equal(LunabriaQueryCompiler.compile('author: Tanenbaum'), 'author:Tanenbaum');
  assert.equal(LunabriaQueryCompiler.compile('author:Tanenbaum'), 'author:Tanenbaum');
});

test('LunabriaQueryCompiler single quoted field exact match', () => {
  assert.equal(LunabriaQueryCompiler.compile('author: "Tanenbaum"'), 'author:"=Tanenbaum"');
  assert.equal(LunabriaQueryCompiler.compile('author:"Tanenbaum"'), 'author:"=Tanenbaum"');
  assert.equal(LunabriaQueryCompiler.compile('tags: "=University"'), 'tags:"=University"');
  assert.equal(LunabriaQueryCompiler.compile('tags:=University'), 'tags:=University');
});

test('LunabriaQueryCompiler OR list with commas', () => {
  assert.equal(
    LunabriaQueryCompiler.compile('tags: "Física", "Química"'),
    '(tags:"=Física" or tags:"=Química")'
  );
  assert.equal(
    LunabriaQueryCompiler.compile('format: epub, pdf'),
    '(format:epub or format:pdf)'
  );
  assert.equal(
    LunabriaQueryCompiler.compile('tags: "Física", Química'),
    '(tags:"=Física" or tags:Química)'
  );
});

test('LunabriaQueryCompiler composite query from ticket', () => {
  const query = 'tags: "Física", "Química" + format: epub - author: Curie';
  const expected = '(tags:"=Física" or tags:"=Química") and format:epub and (not author:Curie)';
  assert.equal(LunabriaQueryCompiler.compile(query), expected);
});

test('LunabriaQueryCompiler exclusion operator', () => {
  assert.equal(LunabriaQueryCompiler.compile('- author: Curie'), '(not author:Curie)');
  assert.equal(LunabriaQueryCompiler.compile('-author:Curie'), '(not author:Curie)');
  assert.equal(LunabriaQueryCompiler.compile('- tags: Fiction'), '(not tags:Fiction)');
});

test('LunabriaQueryCompiler tolerance with unclosed quotes', () => {
  assert.equal(LunabriaQueryCompiler.compile('tags: "Fí'), 'tags:"=Fí"');
});

test('LunabriaQueryCompiler bare terms', () => {
  assert.equal(LunabriaQueryCompiler.compile('clean code'), 'clean and code');
  assert.equal(LunabriaQueryCompiler.compile('"Clean Code"'), '"=Clean Code"');
});

test('LunabriaQueryCompiler parseClauses structured breakdown', () => {
  const query = 'tags: "Physics", "Chemistry" + format: epub - author: Curie';
  const clauses = LunabriaQueryCompiler.parseClauses(query);
  assert.equal(clauses.length, 3);
  assert.deepEqual(clauses[0], {
    op: '+',
    field: 'tags',
    values: [
      { value: 'Physics', isQuoted: true },
      { value: 'Chemistry', isQuoted: true }
    ]
  });
  assert.deepEqual(clauses[1], {
    op: '+',
    field: 'format',
    values: [{ value: 'epub', isQuoted: false }]
  });
  assert.deepEqual(clauses[2], {
    op: '-',
    field: 'author',
    values: [{ value: 'Curie', isQuoted: false }]
  });
});

test('LunabriaQueryCompiler formatClauses roundtrip', () => {
  const clauses = [
    { op: '+', field: 'tags', values: [{ value: 'Physics', isQuoted: true }] },
    { op: '-', field: 'author', values: [{ value: 'Curie', isQuoted: false }] }
  ];
  const formatted = LunabriaQueryCompiler.formatClauses(clauses);
  assert.equal(formatted, 'tags: "Physics" - author: Curie');
});

test('LunabriaQueryCompiler comma between different fields acts as OR', () => {
  const query = 'tags: linux, comment:linux';
  assert.equal(LunabriaQueryCompiler.compile(query), 'tags:linux or comment:linux');
  const clauses = LunabriaQueryCompiler.parseClauses(query);
  assert.equal(clauses.length, 2);
  assert.equal(clauses[0].op, '+');
  assert.equal(clauses[1].op, ',');
});

test('LunabriaQueryCompiler natural words and, or, not', () => {
  assert.equal(
    LunabriaQueryCompiler.compile('tags:linux and not tags:arch'),
    'tags:linux and (not tags:arch)'
  );
  assert.equal(
    LunabriaQueryCompiler.compile('tags:linux not tags:arch'),
    'tags:linux and (not tags:arch)'
  );
  assert.equal(
    LunabriaQueryCompiler.compile('tags:linux or comment:linux'),
    'tags:linux or comment:linux'
  );
  assert.equal(
    LunabriaQueryCompiler.compile('tags:linux, not tags:arch'),
    'tags:linux or (not tags:arch)'
  );
});

test('LunabriaQueryCompiler parentheses grouping', () => {
  assert.equal(
    LunabriaQueryCompiler.compile('(tags:linux or comment:linux) and not tags:arch'),
    '(tags:linux or comment:linux) and (not tags:arch)'
  );
  assert.equal(
    LunabriaQueryCompiler.compile('(tags:linux, comment:linux) and not tags:arch'),
    '(tags:linux or comment:linux) and (not tags:arch)'
  );
});
