/**
 * Lunabria Universal Query Compiler
 * Transpiles intuitive symbol queries (+, -, comma, exact quotes, natural boolean words)
 * into Calibre search expressions.
 */
const SINGLE_CHAR_TOKENS = {
  "(": "LPAREN",
  ")": "RPAREN",
  "+": "AND",
  ",": "OR",
  "-": "NOT",
};

const KEYWORD_TOKENS = {
  and: "AND",
  y: "AND",
  or: "OR",
  o: "OR",
  not: "NOT",
};

const CLAUSE_PREFIXES = {
  "-": "- ",
  ",-": ", - ",
  ",": ", ",
};

class LunabriaQueryCompiler {
  static readQuotedToken(s, startIndex) {
    const n = s.length;
    let i = startIndex + 1;
    const valChars = [];
    while (i < n && s[i] !== '"') {
      const escaped = s[i] === "\\" && i + 1 < n;
      valChars.push(escaped ? s[i + 1] : s[i]);
      i += escaped ? 2 : 1;
    }
    return {
      token: { type: "VALUE", value: valChars.join(""), isQuoted: true },
      nextIndex: i < n && s[i] === '"' ? i + 1 : i,
    };
  }

  static appendWordTokens(word, tokens) {
    const keywordType = KEYWORD_TOKENS[word.toLowerCase()];
    if (keywordType) {
      tokens.push({ type: keywordType, value: word });
      return;
    }
    if (word.endsWith(":") && word.length > 1) {
      tokens.push({ type: "FIELD", value: word.slice(0, -1) });
      return;
    }
    const colonIdx = word.indexOf(":");
    if (colonIdx > 0) {
      tokens.push({ type: "FIELD", value: word.slice(0, colonIdx) });
      const rest = word.slice(colonIdx + 1);
      if (rest) tokens.push({ type: "VALUE", value: rest, isQuoted: false });
      return;
    }
    tokens.push({ type: "VALUE", value: word, isQuoted: false });
  }

  static tokenize(s) {
    const tokens = [];
    const n = s.length;
    let i = 0;
    while (i < n) {
      const c = s[i];
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (SINGLE_CHAR_TOKENS[c]) {
        tokens.push({ type: SINGLE_CHAR_TOKENS[c], value: c });
        i++;
        continue;
      }
      if (c === '"') {
        const quoted = this.readQuotedToken(s, i);
        tokens.push(quoted.token);
        i = quoted.nextIndex;
        continue;
      }
      const start = i;
      while (i < n && !/[\s()+\-,"]/.test(s[i])) i++;
      this.appendWordTokens(s.slice(start, i), tokens);
    }
    return tokens;
  }

  /**
   * Parses raw query string into tokens and structured clauses.
   * @param {string} rawQuery
   * @returns {Array<{op: string, field: string|null, values: Array<{value: string, isQuoted: boolean}>, openParens?: number, closeParens?: number}>}
   */
  static parseClauses(rawQuery) {
    if (!rawQuery || typeof rawQuery !== "string") return [];
    const s = rawQuery.trim();
    if (!s) return [];

    const tokens = this.tokenize(s);
    const clauses = [];
    const state = {
      incomingConnector: "+",
      isNegated: false,
      currentField: null,
      currentValues: [],
      pendingComma: false,
      pendingOpenParens: 0,
      pendingCloseParens: 0,
    };

    const flushClause = () => {
      if (!state.currentValues.length) return;
      const isOr = state.incomingConnector === ",";
      const op = state.isNegated ? (isOr ? ",-" : "-") : isOr ? "," : "+";
      const cl = { op, field: state.currentField, values: state.currentValues };
      if (state.pendingOpenParens > 0) cl.openParens = state.pendingOpenParens;
      if (state.pendingCloseParens > 0) cl.closeParens = state.pendingCloseParens;
      clauses.push(cl);
      state.currentValues = [];
      state.isNegated = false;
      state.incomingConnector = "+";
      state.pendingComma = false;
      state.pendingOpenParens = 0;
      state.pendingCloseParens = 0;
    };

    for (const item of tokens) {
      this.consumeToken(item, state, clauses, flushClause);
    }
    flushClause();
    return clauses;
  }

  static consumeToken(item, state, clauses, flushClause) {
    if (item.type === "LPAREN") {
      state.pendingOpenParens++;
      return;
    }
    if (item.type === "RPAREN") {
      if (state.currentValues.length > 0) {
        state.pendingCloseParens++;
        flushClause();
      } else if (clauses.length > 0) {
        const last = clauses[clauses.length - 1];
        last.closeParens = (last.closeParens || 0) + 1;
      }
      return;
    }
    if (item.type === "AND") {
      flushClause();
      state.incomingConnector = "+";
      state.pendingComma = false;
      return;
    }
    if (item.type === "OR") {
      state.pendingComma = true;
      return;
    }
    if (item.type === "NOT") {
      if (state.pendingComma || state.currentValues.length > 0) {
        const wasComma = state.pendingComma;
        flushClause();
        if (wasComma) state.incomingConnector = ",";
      }
      state.isNegated = true;
      return;
    }
    if (item.type === "FIELD") {
      const wasComma = state.pendingComma;
      flushClause();
      if (wasComma) state.incomingConnector = ",";
      state.currentField = item.value;
      return;
    }
    if (state.currentValues.length > 0 && !state.pendingComma) {
      flushClause();
      state.incomingConnector = "+";
    }
    state.currentValues.push({ value: item.value, isQuoted: item.isQuoted });
    state.pendingComma = false;
  }

  /**
   * Reconstructs raw query expression from clauses.
   * @param {Array<{op: string, field: string|null, values: Array<{value: string, isQuoted: boolean}>, openParens?: number, closeParens?: number}>} clauses
   * @returns {string}
   */
  static formatClauses(clauses) {
    if (!Array.isArray(clauses) || clauses.length === 0) return "";
    const parts = clauses.map((cl, idx) => {
      const prefix = CLAUSE_PREFIXES[cl.op] ?? (idx > 0 ? "+ " : "");
      const fieldStr = cl.field ? `${cl.field}: ` : "";
      const valsStr = cl.values.map((v) => (v.isQuoted ? `"${v.value}"` : v.value)).join(", ");
      const openP = "(".repeat(cl.openParens || 0);
      const closeP = ")".repeat(cl.closeParens || 0);
      return `${openP}${prefix}${fieldStr}${valsStr}${closeP}`;
    });
    return parts.join(" ").replace(/\s+,/g, ",");
  }

  static formatValueExpression(field, valItem) {
    if (!valItem.value && !valItem.isQuoted) return null;
    const formattedVal = valItem.isQuoted ? `"=${valItem.value.replace(/^=+/, "")}"` : valItem.value;
    return field ? `${field}:${formattedVal}` : formattedVal;
  }

  /**
   * Compiles an intuitive symbol-based query into Calibre search syntax.
   * @param {string} rawQuery
   * @returns {string}
   */
  static compile(rawQuery) {
    const clauses = this.parseClauses(rawQuery);
    if (!clauses.length) return "";

    const parts = [];
    for (const cl of clauses) {
      const valExprs = cl.values.map((v) => this.formatValueExpression(cl.field, v)).filter(Boolean);
      if (!valExprs.length) continue;

      const baseExpr = valExprs.length === 1 ? valExprs[0] : `(${valExprs.join(" or ")})`;
      const expr = cl.op === "-" || cl.op === ",-" ? `(not ${baseExpr})` : baseExpr;
      const openP = "(".repeat(cl.openParens || 0);
      const closeP = ")".repeat(cl.closeParens || 0);
      if (parts.length > 0) {
        parts.push(cl.op.includes(",") ? "or" : "and");
      }
      parts.push(`${openP}${expr}${closeP}`);
    }
    return parts.join(" ");
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { LunabriaQueryCompiler };
}
