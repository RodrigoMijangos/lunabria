/**
 * Lunabria Universal Query Compiler
 * Transpiles intuitive symbol queries (+, -, comma, exact quotes, natural boolean words)
 * into Calibre search expressions.
 */
class LunabriaQueryCompiler {
  /**
   * Parses raw query string into tokens and structured clauses.
   * @param {string} rawQuery
   * @returns {Array<{op: string, field: string|null, values: Array<{value: string, isQuoted: boolean}>, openParens?: number, closeParens?: number}>}
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
      if (c === '(') {
        tokens.push({ type: 'LPAREN', value: '(' });
        i++;
        continue;
      }
      if (c === ')') {
        tokens.push({ type: 'RPAREN', value: ')' });
        i++;
        continue;
      }
      if (c === '+') {
        tokens.push({ type: 'AND', value: '+' });
        i++;
        continue;
      }
      if (c === ',') {
        tokens.push({ type: 'OR', value: ',' });
        i++;
        continue;
      }
      if (c === '-') {
        tokens.push({ type: 'NOT', value: '-' });
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
      while (i < n && !/\s/.test(s[i]) && s[i] !== '(' && s[i] !== ')' && s[i] !== '+' && s[i] !== '-' && s[i] !== ',' && s[i] !== '"') {
        i++;
      }
      const word = s.slice(start, i);
      const lowerWord = word.toLowerCase();

      if (lowerWord === 'and' || lowerWord === 'y') {
        tokens.push({ type: 'AND', value: word });
      } else if (lowerWord === 'or' || lowerWord === 'o') {
        tokens.push({ type: 'OR', value: word });
      } else if (lowerWord === 'not') {
        tokens.push({ type: 'NOT', value: word });
      } else if (word.endsWith(':') && word.length > 1) {
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
    let incomingConnector = '+';
    let isNegated = false;
    let currentField = null;
    let currentValues = [];
    let pendingComma = false;
    let pendingOpenParens = 0;
    let pendingCloseParens = 0;

    const flushClause = () => {
      if (!currentValues.length) return;
      let op = '+';
      if (isNegated) {
        op = incomingConnector === ',' ? ',-' : '-';
      } else {
        op = incomingConnector === ',' ? ',' : '+';
      }

      const cl = {
        op,
        field: currentField,
        values: currentValues
      };
      if (pendingOpenParens > 0) {
        cl.openParens = pendingOpenParens;
        pendingOpenParens = 0;
      }
      if (pendingCloseParens > 0) {
        cl.closeParens = pendingCloseParens;
        pendingCloseParens = 0;
      }

      clauses.push(cl);
      currentValues = [];
      isNegated = false;
      incomingConnector = '+';
      pendingComma = false;
    };

    for (const item of tokens) {
      if (item.type === 'LPAREN') {
        pendingOpenParens++;
        continue;
      }
      if (item.type === 'RPAREN') {
        if (currentValues.length > 0) {
          pendingCloseParens++;
          flushClause();
        } else if (clauses.length > 0) {
          clauses[clauses.length - 1].closeParens = (clauses[clauses.length - 1].closeParens || 0) + 1;
        }
        continue;
      }
      if (item.type === 'AND') {
        flushClause();
        incomingConnector = '+';
        pendingComma = false;
        continue;
      }
      if (item.type === 'OR') {
        pendingComma = true;
        continue;
      }
      if (item.type === 'NOT') {
        if (pendingComma) {
          flushClause();
          incomingConnector = ',';
          pendingComma = false;
        } else if (currentValues.length > 0) {
          flushClause();
        }
        isNegated = true;
        continue;
      }
      if (item.type === 'FIELD') {
        if (pendingComma) {
          flushClause();
          incomingConnector = ',';
          pendingComma = false;
        } else {
          flushClause();
        }
        currentField = item.value;
        continue;
      }
      if (item.type === 'VALUE') {
        if (currentValues.length > 0 && !pendingComma) {
          flushClause();
          incomingConnector = '+';
        }
        currentValues.push({ value: item.value, isQuoted: item.isQuoted });
        pendingComma = false;
      }
    }

    flushClause();
    return clauses;
  }

  /**
   * Reconstructs raw query expression from clauses.
   * @param {Array<{op: string, field: string|null, values: Array<{value: string, isQuoted: boolean}>, openParens?: number, closeParens?: number}>} clauses
   * @returns {string}
   */
  static formatClauses(clauses) {
    if (!Array.isArray(clauses) || clauses.length === 0) return '';
    const parts = [];
    for (let idx = 0; idx < clauses.length; idx++) {
      const cl = clauses[idx];
      let prefix = '';
      if (cl.op === '-') {
        prefix = '- ';
      } else if (cl.op === ',-') {
        prefix = ', - ';
      } else if (cl.op === ',') {
        prefix = ', ';
      } else if (idx > 0) {
        prefix = '+ ';
      }
      const fieldStr = cl.field ? `${cl.field}: ` : '';
      const valsStr = cl.values.map(v => v.isQuoted ? `"${v.value}"` : v.value).join(', ');
      const openP = '('.repeat(cl.openParens || 0);
      const closeP = ')'.repeat(cl.closeParens || 0);
      parts.push(`${openP}${prefix}${fieldStr}${valsStr}${closeP}`);
    }
    return parts.join(' ').replace(/\s+,/g, ',');
  }

  /**
   * Compiles an intuitive symbol-based query into Calibre search syntax.
   * @param {string} rawQuery
   * @returns {string}
   */
  static compile(rawQuery) {
    const clauses = this.parseClauses(rawQuery);
    if (!clauses.length) return '';

    const tokensOut = [];

    for (let idx = 0; idx < clauses.length; idx++) {
      const cl = clauses[idx];
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
      if (op === '-' || op === ',-') {
        expr = `(not ${expr})`;
      }

      const openP = '('.repeat(cl.openParens || 0);
      const closeP = ')'.repeat(cl.closeParens || 0);
      const connector = op.includes(',') ? 'or' : 'and';

      tokensOut.push({
        openP,
        expr,
        closeP,
        connector,
        isFirst: (idx === 0)
      });
    }

    if (!tokensOut.length) return '';

    const parts = [];
    for (const item of tokensOut) {
      if (!item.isFirst) {
        parts.push(item.connector);
      }
      parts.push(`${item.openP}${item.expr}${item.closeP}`);
    }

    return parts.join(' ');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LunabriaQueryCompiler };
}
