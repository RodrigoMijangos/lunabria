"""
Lunabria Universal Query Compiler (Python implementation)
Compiles intuitive symbol-based search queries (+, -, comma, exact quotes)
into Calibre-native search expressions.
"""
from typing import List, Tuple, Optional, Dict, Any


def compile_lunabria_query(raw_query: Optional[str]) -> str:
    """
    Transpiles user-friendly symbol query expressions into Calibre search syntax:
    - `+` (or whitespace between independent clauses) -> `and`
    - `,` -> `or`
    - `-` -> `not` (exclusion)
    - `"value"` (with quotes) -> exact match (`field:"=value"`)
    - `value` (without quotes) -> substring / partial match (`field:value`)
    
    Example:
      `tags: "Física", "Química" + format: epub - author: Curie`
      -> `(tags:"=Física" or tags:"=Química") and format:epub and (not author:Curie)`
    """
    if not raw_query or not raw_query.strip():
        return ""

    s = raw_query.strip()
    n = len(s)

    # Tokenizer
    # Tokens:
    # ('OP', '+') | ('OP', '-')
    # ('COMMA', ',')
    # ('FIELD', field_name)
    # ('VALUE', val, is_quoted)
    tokens: List[Tuple[str, Any]] = []
    i = 0
    while i < n:
        c = s[i]
        if c.isspace():
            i += 1
            continue
        if c in ('+', '-'):
            tokens.append(('OP', c))
            i += 1
            continue
        if c == ',':
            tokens.append(('COMMA', ','))
            i += 1
            continue
        if c == '"':
            # Quoted string literal
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

        # Word or Field
        start = i
        while i < n and not s[i].isspace() and s[i] not in ('+', '-', ',', '"'):
            i += 1
        word = s[start:i]

        if word.endswith(':') and len(word) > 1:
            tokens.append(('FIELD', word[:-1]))
        elif ':' in word and not word.startswith(':'):
            parts = word.split(':', 1)
            tokens.append(('FIELD', parts[0]))
            if parts[1]:
                tokens.append(('VALUE', (parts[1], False)))
        else:
            tokens.append(('VALUE', (word, False)))

    # Parsing into clauses
    clauses: List[Dict[str, Any]] = []
    current_op = '+'
    current_field: Optional[str] = None
    current_values: List[Tuple[str, bool]] = []
    pending_comma = False

    for item in tokens:
        tok_type = item[0]
        tok_val = item[1]

        if tok_type == 'OP':
            if current_values:
                clauses.append({
                    'op': current_op,
                    'field': current_field,
                    'values': current_values
                })
                current_values = []
                current_field = None
            current_op = tok_val
            pending_comma = False
            continue

        if tok_type == 'FIELD':
            if current_values:
                clauses.append({
                    'op': current_op,
                    'field': current_field,
                    'values': current_values
                })
                current_values = []
                current_op = '+'
            current_field = tok_val
            pending_comma = False
            continue

        if tok_type == 'COMMA':
            # Comma marks that the subsequent VALUE continues the OR list for current clause
            pending_comma = True
            continue

        if tok_type == 'VALUE':
            val, is_quoted = tok_val
            if current_values and not pending_comma:
                # No comma between values: space implies AND, so finish current clause
                clauses.append({
                    'op': current_op,
                    'field': current_field,
                    'values': current_values
                })
                current_values = []
                # Keep current_field if it was part of a field clause, or clear if bare
                current_op = '+'

            current_values.append((val, is_quoted))
            pending_comma = False
            continue

    if current_values:
        clauses.append({
            'op': current_op,
            'field': current_field,
            'values': current_values
        })

    # Code generation
    clause_strings: List[str] = []
    for cl in clauses:
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

        if op == '-':
            expr = f"(not {expr})"

        clause_strings.append(expr)

    return ' and '.join(clause_strings)
