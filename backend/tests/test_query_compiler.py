import unittest
from app.services.query_compiler import compile_lunabria_query, parse_query_clauses


class TestLunabriaQueryCompiler(unittest.TestCase):
    def test_empty_or_whitespace(self):
        self.assertEqual(compile_lunabria_query(""), "")
        self.assertEqual(compile_lunabria_query("   "), "")
        self.assertEqual(compile_lunabria_query(None), "")

    def test_single_unquoted_field(self):
        self.assertEqual(compile_lunabria_query("author: Tanenbaum"), "author:Tanenbaum")
        self.assertEqual(compile_lunabria_query("author:Tanenbaum"), "author:Tanenbaum")

    def test_single_quoted_field_exact_match(self):
        self.assertEqual(compile_lunabria_query('author: "Tanenbaum"'), 'author:"=Tanenbaum"')
        self.assertEqual(compile_lunabria_query('author:"Tanenbaum"'), 'author:"=Tanenbaum"')
        # Pre-existing = should not be duplicated
        self.assertEqual(compile_lunabria_query('tags: "=University"'), 'tags:"=University"')
        self.assertEqual(compile_lunabria_query('tags:=University'), 'tags:=University')

    def test_or_list_with_commas(self):
        self.assertEqual(
            compile_lunabria_query('tags: "Física", "Química"'),
            '(tags:"=Física" or tags:"=Química")'
        )
        self.assertEqual(
            compile_lunabria_query('format: epub, pdf'),
            '(format:epub or format:pdf)'
        )

    def test_mixed_exact_and_partial_or_list(self):
        self.assertEqual(
            compile_lunabria_query('tags: "Física", Química'),
            '(tags:"=Física" or tags:Química)'
        )

    def test_composite_expression_from_ticket(self):
        query = 'tags: "Física", "Química" + format: epub - author: Curie'
        expected = '(tags:"=Física" or tags:"=Química") and format:epub and (not author:Curie)'
        self.assertEqual(compile_lunabria_query(query), expected)

    def test_exclusion_operator(self):
        self.assertEqual(compile_lunabria_query("- author: Curie"), "(not author:Curie)")
        self.assertEqual(compile_lunabria_query("-author:Curie"), "(not author:Curie)")
        self.assertEqual(compile_lunabria_query("- tags: Fiction"), "(not tags:Fiction)")

    def test_unclosed_quotes_tolerance(self):
        # Typing in real-time shouldn't crash
        compiled = compile_lunabria_query('tags: "Fí')
        self.assertEqual(compiled, 'tags:"=Fí"')

    def test_bare_terms(self):
        self.assertEqual(compile_lunabria_query("clean code"), "clean and code")
        self.assertEqual(compile_lunabria_query('"Clean Code"'), '"=Clean Code"')

    def test_comma_between_different_fields_acts_as_or(self):
        query = "tags: linux, comment:linux"
        self.assertEqual(compile_lunabria_query(query), "tags:linux or comment:linux")
        clauses = parse_query_clauses(query)
        self.assertEqual(len(clauses), 2)
        self.assertEqual(clauses[0]["op"], "+")
        self.assertEqual(clauses[1]["op"], ",")

    def test_natural_words_and_or_not(self):
        self.assertEqual(
            compile_lunabria_query("tags:linux and not tags:arch"),
            "tags:linux and (not tags:arch)"
        )
        self.assertEqual(
            compile_lunabria_query("tags:linux not tags:arch"),
            "tags:linux and (not tags:arch)"
        )
        self.assertEqual(
            compile_lunabria_query("tags:linux or comment:linux"),
            "tags:linux or comment:linux"
        )
        self.assertEqual(
            compile_lunabria_query("tags:linux, not tags:arch"),
            "tags:linux or (not tags:arch)"
        )

    def test_parentheses_grouping(self):
        self.assertEqual(
            compile_lunabria_query("(tags:linux or comment:linux) and not tags:arch"),
            "(tags:linux or comment:linux) and (not tags:arch)"
        )
        self.assertEqual(
            compile_lunabria_query("(tags:linux, comment:linux) and not tags:arch"),
            "(tags:linux or comment:linux) and (not tags:arch)"
        )


if __name__ == "__main__":
    unittest.main()
