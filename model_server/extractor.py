from tree_sitter import Language, Parser
import tree_sitter_python

_LANGUAGE = Language(tree_sitter_python.language())
_PARSER = Parser(_LANGUAGE)

_QUERY = _LANGUAGE.query("""
(function_definition
  name: (identifier) @func.name
  body: (block) @func.body) @func.def
""")

def extract_functions(code: str):
    tree = _PARSER.parse(code.encode("utf-8"))
    root_node = tree.root_node
    matches = _QUERY.matches(root_node)

    results = []
    for _, capture in matches:
        name_node = capture["func.name"][0]
        def_node  = capture["func.def"][0]

        name = code[name_node.start_byte:name_node.end_byte]
        func_code = code[def_node.start_byte:def_node.end_byte]
        results.append({"name": name, "code": func_code})
    return results
