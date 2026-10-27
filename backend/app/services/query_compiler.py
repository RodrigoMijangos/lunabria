"""
Lunabria Universal Query Compiler (Python implementation)
Compiles intuitive symbol-based search queries (+, -, comma, exact quotes, natural boolean words)
into Calibre-native search expressions.
"""
from typing import List, Tuple, Optional, Dict, Any


def parse_query_clauses(raw_query: Optional[str]) -> List[Dict[str, Any]]:
    if not raw_query or not raw_query.strip():
        return []

    s = raw_query.strip()
    n = len(s)

    tokens: List[Tuple[str, Any]] = []
    i = 0
    while i < n:
        c = s[i]
        if c.isspace():
            i += 1
            continue
        if c == '(':
            tokens.append(('LPAREN', '('))
            i += 1
            continue
        if c == ')':
            tokens.append(('RPAREN', ')'))
            i += 1
            continue
        if c == '+':
            tokens.append(('AND', '+'))
            i += 1
            continue
        if c == ',':
            tokens.append(('OR', ','))
            i += 1
            continue
        if c == '-':
            tokens.append(('NOT', '-'))
            i += 1
            continue
        if c == '"':
            i += 1
            val_chars: List[str] = []
            while i < n and s[i] != '"':
                if s[i] == '\\' and i + 1 < n:
                    val_chars.append(s[i + 1])
                    i += 2
                else:
                    val_chars.append(s[i])
                    i += 1
            if i < n and s[i] == '"':
                i += 1
            tokens.append(('VALUE', (''.join(val_chars), True)))
            continue

        start = i
        while i < n and not s[i].isspace() and s[i] not in ('(', ')', '+', ',', '-', '"'):
            i += 1
        word = s[start:i]

        lower_word = word.lower()
        if lower_word in ('and', 'y'):
            tokens.append(('AND', word))
        elif lower_word in ('or', 'o'):
            tokens.append(('OR', word))
        elif lower_word == 'not':
            tokens.append(('NOT', word))
        elif word.endswith(':') and len(word) > 1:
            tokens.append(('FIELD', word[:-1]))
        elif ':' in word and not word.startswith(':'):
            parts = word.split(':', 1)
            tokens.append(('FIELD', parts[0]))
            if parts[1]:
                tokens.append(('VALUE', (parts[1], False)))
        else:
            tokens.append(('VALUE', (word, False)))

    clauses: List[Dict[str, Any]] = []
    incoming_connector = '+'
    is_negated = False
    current_field: Optional[str] = None
    current_values: List[Tuple[str, bool]] = []
    pending_comma = False
    pending_open_parens = 0
    pending_close_parens = 0

    def flush_clause():
        nonlocal current_values, current_field, incoming_connector, is_negated
        nonlocal pending_open_parens, pending_close_parens, pending_comma
        if not current_values:
            return

        if is_negated:
            op = ',-' if incoming_connector == ',' else '-'
        else:
            op = ',' if incoming_connector == ',' else '+'

        cl: Dict[str, Any] = {
            'op': op,
            'field': current_field,
            'values': current_values,
        }
        if pending_open_parens > 0:
            cl['openParens'] = pending_open_parens
            pending_open_parens = 0
        if pending_close_parens > 0:
            cl['closeParens'] = pending_close_parens
            pending_close_parens = 0

        clauses.append(cl)
        current_values = []
        is_negated = False
        incoming_connector = '+'
        pending_comma = False

    for tok_type, tok_val in tokens:
        if tok_type == 'LPAREN':
            pending_open_parens += 1
            continue

        if tok_type == 'RPAREN':
            if current_values:
                pending_close_parens += 1
                flush_clause()
            elif clauses:
                clauses[-1]['closeParens'] = clauses[-1].get('closeParens', 0) + 1
            continue

        if tok_type == 'AND':
            flush_clause()
            incoming_connector = '+'
            pending_comma = False
            continue

        if tok_type == 'OR':
            pending_comma = True
            continue

        if tok_type == 'NOT':
            if pending_comma:
                flush_clause()
                incoming_connector = ','
                pending_comma = False
            elif current_values:
                flush_clause()
            is_negated = True
            continue

        if tok_type == 'FIELD':
            if pending_comma:
                flush_clause()
                incoming_connector = ','
                pending_comma = False
            else:
                flush_clause()
            current_field = tok_val
            continue

        if tok_type == 'VALUE':
            val, is_quoted = tok_val
            if current_values and not pending_comma:
                flush_clause()
                incoming_connector = '+'
            current_values.append((val, is_quoted))
            pending_comma = False

    flush_clause()
    return clauses


def compile_lunabria_query(raw_query: Optional[str]) -> str:
    """
    Transpiles user-friendly symbol query expressions into Calibre search syntax:
    - `+` / `and` (or whitespace between independent clauses) -> `and`
    - `,` / `or` -> `or`
    - `-` / `not` -> `(not ...)`
    - `(...)` -> preserves grouping parentheses
    - `\"value\"` (with quotes) -> exact match (`field:\"=value\"`)
    - `value` (without quotes) -> substring / partial match (`field:value`)
    """
    clauses = parse_query_clauses(raw_query)
    if not clauses:
        return ""

    tokens_out = []

    for idx, cl in enumerate(clauses):
        field = cl['field']
        op = cl['op']
        val_exprs: List[str] = []

        for val, is_quoted in cl['values']:
            if not val and not is_quoted:
                continue
            if field:
                if is_quoted:
                    clean_val = val.lstrip('=')
                    val_exprs.append(f'{field}:"={clean_val}"')
                else:
                    val_exprs.append(f'{field}:{val}')
            else:
                if is_quoted:
                    clean_val = val.lstrip('=')
                    val_exprs.append(f'"={clean_val}"')
                else:
                    val_exprs.append(val)

        if not val_exprs:
            continue

        if len(val_exprs) == 1:
            expr = val_exprs[0]
        else:
            joined_vals = ' or '.join(val_exprs)
            expr = f"({joined_vals})"

        if op in ('-', ',-'):
            expr = f"(not {expr})"

        open_p = '(' * cl.get('openParens', 0)
        close_p = ')' * cl.get('closeParens', 0)
        connector = 'or' if (',' in op) else 'and'

        tokens_out.append({
            'open_p': open_p,
            'expr': expr,
            'close_p': close_p,
            'connector': connector,
            'is_first': (idx == 0)
        })

    if not tokens_out:
        return ""

    parts: List[str] = []
    for item in tokens_out:
        if not item['is_first']:
            parts.append(item['connector'])
        parts.append(f"{item['open_p']}{item['expr']}{item['close_p']}")

    return ' '.join(parts)
