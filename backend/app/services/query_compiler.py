"""
Lunabria Universal Query Compiler (Python implementation)
Compiles intuitive symbol-based search queries (+, -, comma, exact quotes, natural boolean words)
into Calibre-native search expressions.
"""
from typing import Any, Dict, List, Optional, Tuple

_SINGLE_CHAR_TOKENS = {
    "(": ("LPAREN", "("),
    ")": ("RPAREN", ")"),
    "+": ("AND", "+"),
    ",": ("OR", ","),
    "-": ("NOT", "-"),
}

_DELIMITER_CHARS = ("(", ")", "+", ",", "-", '"')


def _read_quoted_token(s: str, start_idx: int) -> Tuple[Tuple[str, Any], int]:
    n = len(s)
    i = start_idx + 1
    val_chars: List[str] = []
    while i < n and s[i] != '"':
        if s[i] == "\\" and i + 1 < n:
            val_chars.append(s[i + 1])
            i += 2
        else:
            val_chars.append(s[i])
            i += 1
    if i < n and s[i] == '"':
        i += 1
    return ("VALUE", ("".join(val_chars), True)), i


def _classify_word_token(word: str) -> List[Tuple[str, Any]]:
    lower_word = word.lower()
    if lower_word in ("and", "y"):
        return [("AND", word)]
    if lower_word in ("or", "o"):
        return [("OR", word)]
    if lower_word == "not":
        return [("NOT", word)]
    if word.endswith(":") and len(word) > 1:
        return [("FIELD", word[:-1])]
    if ":" in word and not word.startswith(":"):
        field_part, val_part = word.split(":", 1)
        out: List[Tuple[str, Any]] = [("FIELD", field_part)]
        if val_part:
            out.append(("VALUE", (val_part, False)))
        return out
    return [("VALUE", (word, False))]


def _tokenize_query(s: str) -> List[Tuple[str, Any]]:
    tokens: List[Tuple[str, Any]] = []
    n = len(s)
    i = 0
    while i < n:
        c = s[i]
        if c.isspace():
            i += 1
            continue
        if c in _SINGLE_CHAR_TOKENS:
            tokens.append(_SINGLE_CHAR_TOKENS[c])
            i += 1
            continue
        if c == '"':
            tok, i = _read_quoted_token(s, i)
            tokens.append(tok)
            continue

        start = i
        while i < n and not s[i].isspace() and s[i] not in _DELIMITER_CHARS:
            i += 1
        tokens.extend(_classify_word_token(s[start:i]))
    return tokens


class _ClauseBuilder:
    def __init__(self) -> None:
        self.clauses: List[Dict[str, Any]] = []
        self.incoming_connector = "+"
        self.is_negated = False
        self.current_field: Optional[str] = None
        self.current_values: List[Tuple[str, bool]] = []
        self.pending_comma = False
        self.pending_open_parens = 0
        self.pending_close_parens = 0

    def flush(self) -> None:
        if not self.current_values:
            return

        if self.is_negated:
            op = ",-" if self.incoming_connector == "," else "-"
        else:
            op = "," if self.incoming_connector == "," else "+"

        cl: Dict[str, Any] = {
            "op": op,
            "field": self.current_field,
            "values": self.current_values,
        }
        if self.pending_open_parens > 0:
            cl["openParens"] = self.pending_open_parens
            self.pending_open_parens = 0
        if self.pending_close_parens > 0:
            cl["closeParens"] = self.pending_close_parens
            self.pending_close_parens = 0

        self.clauses.append(cl)
        self.current_values = []
        self.is_negated = False
        self.incoming_connector = "+"
        self.pending_comma = False

    def consume(self, tok_type: str, tok_val: Any) -> None:
        if tok_type == "LPAREN":
            self.pending_open_parens += 1
        elif tok_type == "RPAREN":
            self._handle_rparen()
        elif tok_type == "AND":
            self.flush()
            self.incoming_connector = "+"
            self.pending_comma = False
        elif tok_type == "OR":
            self.pending_comma = True
        elif tok_type == "NOT":
            self._handle_not()
        elif tok_type == "FIELD":
            self._handle_field(tok_val)
        elif tok_type == "VALUE":
            self._handle_value(tok_val)

    def _handle_rparen(self) -> None:
        if self.current_values:
            self.pending_close_parens += 1
            self.flush()
        elif self.clauses:
            self.clauses[-1]["closeParens"] = self.clauses[-1].get("closeParens", 0) + 1

    def _handle_not(self) -> None:
        if self.pending_comma:
            self.flush()
            self.incoming_connector = ","
            self.pending_comma = False
        elif self.current_values:
            self.flush()
        self.is_negated = True

    def _handle_field(self, field_name: str) -> None:
        if self.pending_comma:
            self.flush()
            self.incoming_connector = ","
            self.pending_comma = False
        else:
            self.flush()
        self.current_field = field_name

    def _handle_value(self, tok_val: Tuple[str, bool]) -> None:
        val, is_quoted = tok_val
        if self.current_values and not self.pending_comma:
            self.flush()
            self.incoming_connector = "+"
        self.current_values.append((val, is_quoted))
        self.pending_comma = False


def parse_query_clauses(raw_query: Optional[str]) -> List[Dict[str, Any]]:
    if not raw_query or not raw_query.strip():
        return []

    tokens = _tokenize_query(raw_query.strip())
    builder = _ClauseBuilder()
    for tok_type, tok_val in tokens:
        builder.consume(tok_type, tok_val)
    builder.flush()
    return builder.clauses


def _format_clause_value(field: Optional[str], val: str, is_quoted: bool) -> Optional[str]:
    if not val and not is_quoted:
        return None
    if is_quoted:
        clean_val = val.lstrip("=")
        return f'{field}:"={clean_val}"' if field else f'"={clean_val}"'
    return f"{field}:{val}" if field else val


def compile_lunabria_query(raw_query: Optional[str]) -> str:
    """
    Transpiles user-friendly symbol query expressions into Calibre search syntax:
    - `+` / `and` (or whitespace between independent clauses) -> `and`
    - `,` / `or` -> `or`
    - `-` / `not` -> `(not ...)`
    - `(...)` -> preserves grouping parentheses
    - `\"value\"` (with quotes) -> exact match (`field:\" =value\"`)
    - `value` (without quotes) -> substring / partial match (`field:value`)
    """
    clauses = parse_query_clauses(raw_query)
    if not clauses:
        return ""

    parts: List[str] = []
    for idx, cl in enumerate(clauses):
        field = cl["field"]
        op = cl["op"]
        val_exprs = [
            formatted
            for val, is_quoted in cl["values"]
            if (formatted := _format_clause_value(field, val, is_quoted)) is not None
        ]
        if not val_exprs:
            continue

        expr = val_exprs[0] if len(val_exprs) == 1 else f"({' or '.join(val_exprs)})"
        if op in ("-", ",-"):
            expr = f"(not {expr})"

        open_p = "(" * cl.get("openParens", 0)
        close_p = ")" * cl.get("closeParens", 0)
        connector = "or" if ("," in op) else "and"

        if idx > 0 and parts:
            parts.append(connector)
        parts.append(f"{open_p}{expr}{close_p}")

    return " ".join(parts)
