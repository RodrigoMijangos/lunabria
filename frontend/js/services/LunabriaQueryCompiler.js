/**
 * Lunabria Universal Query Compiler
 * Transpiles intuitive symbol queries (+, -, comma, exact quotes) into Calibre search expressions.
 */
class LunabriaQueryCompiler {
  /**
   * Parses raw query string into tokens and structured clauses.
   * @param {string} rawQuery
   * @returns {Array<{op: string, field: string|null, values: Array<{value: string, isQuoted: boolean}>}>}
   */
  static parseClauses(rawQuery) {
    if (!rawQuery || typeof rawQuery !== 'string') return [];
    const s = rawQuery.trim();
    if (!s) return [];
    const n = s.length;

    const tokens = [];
    let i = 0;
    while (i < n) {
      const c = s[i];
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (c === '+' || c === '-') {
        tokens.push({ type: 'OP', value: c });
        i++;
        continue;
      }
      if (c === ',') {
        tokens.push({ type: 'COMMA', value: c });
        i++;
        continue;
      }
      if (c === '"') {
        i++;
        const valChars = [];
        while (i < n && s[i] !== '"') {
          if (s[i] === '\\' && i + 1 < n) {
            valChars.push(s[i + 1]);
            i += 2;
          } else {
            valChars.push(s[i]);
            i++;
          }
        }
        if (i < n && s[i] === '"') i++;
        tokens.push({ type: 'VALUE', value: valChars.join(''), isQuoted: true });
        continue;
      }

      const start = i;
      while (i < n && !/\s/.test(s[i]) && s[i] !== '+' && s[i] !== '-' && s[i] !== ',' && s[i] !== '"') {
        i++;
      }
      const word = s.slice(start, i);
      if (word.endsWith(':') && word.length > 1) {
        tokens.push({ type: 'FIELD', value: word.slice(0, -1) });
      } else if (word.includes(':') && !word.startsWith(':')) {
        const colonIdx = word.indexOf(':');
        const field = word.slice(0, colonIdx);
        const rest = word.slice(colonIdx + 1);
        tokens.push({ type: 'FIELD', value: field });
        if (rest) {
          tokens.push({ type: 'VALUE', value: rest, isQuoted: false });
        }
      } else {
        tokens.push({ type: 'VALUE', value: word, isQuoted: false });
      }
    }

    const clauses = [];
    let currentOp = '+';
    let currentField = null;
    let currentValues = [];
    let pendingComma = false;

    for (const item of tokens) {
      if (item.type === 'OP') {
        if (currentValues.length > 0) {
          clauses.push({ op: currentOp, field: currentField, values: currentValues });
          currentValues = [];
          currentField = null;
        }
        currentOp = item.value;
        pendingComma = false;
        continue;
      }
      if (item.type === 'FIELD') {
        if (currentValues.length > 0) {
          clauses.push({ op: currentOp, field: currentField, values: currentValues });
          currentValues = [];
          currentOp = '+';
        }
        currentField = item.value;
        pendingComma = false;
        continue;
      }
      if (item.type === 'COMMA') {
        pendingComma = true;
        continue;
      }
      if (item.type === 'VALUE') {
        if (currentValues.length > 0 && !pendingComma) {
          clauses.push({ op: currentOp, field: currentField, values: currentValues });
          currentValues = [];
          currentOp = '+';
        }
        currentValues.push({ value: item.value, isQuoted: item.isQuoted });
        pendingComma = false;
      }
    }

    if (currentValues.length > 0) {
      clauses.push({ op: currentOp, field: currentField, values: currentValues });
    }

    return clauses;
  }

  /**
   * Reconstructs raw query expression from clauses.
   * @param {Array<{op: string, field: string|null, values: Array<{value: string, isQuoted: boolean}>}>} clauses
   * @returns {string}
   */
  static formatClauses(clauses) {
    if (!Array.isArray(clauses) || clauses.length === 0) return '';
    const parts = [];
    for (let idx = 0; idx < clauses.length; idx++) {
      const cl = clauses[idx];
      const prefix = cl.op === '-' ? '- ' : (idx > 0 ? '+ ' : '');
      const fieldStr = cl.field ? `${cl.field}: ` : '';
      const valsStr = cl.values.map(v => v.isQuoted ? `"${v.value}"` : v.value).join(', ');
      parts.push(`${prefix}${fieldStr}${valsStr}`);
    }
    return parts.join(' ');
  }

  /**
   * Compiles an intuitive symbol-based query into Calibre search syntax.
   * @param {string} rawQuery
   * @returns {string}
   */
  static compile(rawQuery) {
    const clauses = this.parseClauses(rawQuery);
    if (!clauses.length) return '';

    const clauseStrings = [];
    for (const cl of clauses) {
      const field = cl.field;
      const op = cl.op;
      const valExprs = [];

      for (const valItem of cl.values) {
        const val = valItem.value;
        const isQuoted = valItem.isQuoted;
        if (!val && !isQuoted) continue;

        if (field) {
          if (isQuoted) {
            const cleanVal = val.replace(/^=+/, '');
            valExprs.push(`${field}:"=${cleanVal}"`);
          } else {
            valExprs.push(`${field}:${val}`);
          }
        } else {
          if (isQuoted) {
            const cleanVal = val.replace(/^=+/, '');
            valExprs.push(`"=${cleanVal}"`);
          } else {
            valExprs.push(val);
          }
        }
      }

      if (valExprs.length === 0) continue;
      let expr = valExprs.length === 1 ? valExprs[0] : `(${valExprs.join(' or ')})`;
      if (op === '-') {
        expr = `(not ${expr})`;
      }
      clauseStrings.push(expr);
    }

    return clauseStrings.join(' and ');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LunabriaQueryCompiler };
}
