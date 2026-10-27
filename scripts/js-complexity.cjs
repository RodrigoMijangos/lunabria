#!/usr/bin/env node
/**
 * scripts/js-complexity.cjs
 * Computes Cyclomatic Complexity (CC) and Maintainability Index (MI)
 * across JavaScript source files without external npm dependencies.
 */

const fs = require('fs');
const path = require('path');

function getJsFiles(dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        results = results.concat(getJsFiles(fullPath));
      }
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Strips comments and string literals to calculate decision points accurately
 */
function stripLiteralsAndComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // multi-line comments
    .replace(/\/\/.*/g, ' ')            // single-line comments
    .replace(/`(?:\\.|[^`\\])*`/g, '""') // template strings
    .replace(/"(?:\\.|[^"\\])*"/g, '""') // double quotes
    .replace(/'(?:\\.|[^'\\])*'/g, "''"); // single quotes
}

/**
 * Evaluates cyclomatic complexity based on McCabe's formula: CC = 1 + decision_points
 */
function analyzeFileComplexity(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const totalLines = lines.length;
  const blankLines = lines.filter(l => !l.trim()).length;
  const sloc = totalLines - blankLines;

  const stripped = stripLiteralsAndComments(content);

  // Decision point tokens
  const decisionPatterns = [
    /\bif\s*\(/g,
    /\belse\s+if\s*\(/g,
    /\bfor\s*\(/g,
    /\bwhile\s*\(/g,
    /\bcase\s+[^:]+:/g,
    /\bcatch\s*\(/g,
    /\&\&/g,
    /\|\|/g,
    /\?\?/g,
    /\?[^:?]+:/g, // ternary
  ];

  let decisionPoints = 0;
  for (const pattern of decisionPatterns) {
    const matches = stripped.match(pattern);
    if (matches) decisionPoints += matches.length;
  }

  const cyclomatic = 1 + decisionPoints;

  // Approximate Halstead volume & Maintainability Index (MI)
  // MI = max(0, (171 - 5.2 * ln(V) - 0.23 * (CC) - 16.2 * ln(SLOC)) * 100 / 171)
  const tokens = stripped.match(/\b[A-Za-z_$][A-Za-z0-9_$]*\b|[^\sA-Za-z0-9_$]/g) || [];
  const N = tokens.length;
  const n = new Set(tokens).size;
  const volume = N > 0 && n > 0 ? N * Math.log2(n) : 1;
  const safeSloc = Math.max(1, sloc);
  const rawMi = 171 - 5.2 * Math.log(Math.max(1, volume)) - 0.23 * cyclomatic - 16.2 * Math.log(safeSloc);
  const mi = Math.max(0, Math.min(100, Math.round((rawMi * 100) / 171)));

  let rank = 'A';
  if (mi < 20) rank = 'C';
  else if (mi < 40) rank = 'B';

  return {
    file: filePath.replace(/\\/g, '/'),
    sloc,
    cyclomatic,
    mi,
    rank
  };
}

function run() {
  const targetDir = process.argv[2] || 'frontend/js';
  const jsonOutput = process.argv.includes('--json');
  const files = getJsFiles(targetDir);

  const results = files.map(analyzeFileComplexity);
  results.sort((a, b) => b.cyclomatic - a.cyclomatic);

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log('='.repeat(80));
  console.log(` FRONTEND JAVASCRIPT COMPLEXITY & MAINTAINABILITY (Target: ${targetDir})`);
  console.log('='.repeat(80));
  console.log(
    `Rank   |   MI |    CC |   SLOC | File`
  );
  console.log('-'.repeat(80));

  let totalCC = 0;
  let totalMI = 0;

  for (const r of results) {
    totalCC += r.cyclomatic;
    totalMI += r.mi;
    const rankStr = `[${r.rank}]`.padEnd(6);
    const miStr = String(r.mi).padStart(4);
    const ccStr = String(r.cyclomatic).padStart(5);
    const slocStr = String(r.sloc).padStart(6);
    console.log(
      `${rankStr} | ${miStr} | ${ccStr} | ${slocStr} | ${r.file}`
    );
  }

  const avgCC = (totalCC / results.length).toFixed(1);
  const avgMI = (totalMI / results.length).toFixed(1);

  console.log('-'.repeat(80));
  console.log(`Analyzed: ${results.length} files | Avg Cyclomatic: ${avgCC} | Avg Maintainability: ${avgMI}/100`);
  console.log('='.repeat(80));
}

run();
