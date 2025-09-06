from tree_sitter import Language, Parser
from tree_sitter_language_pack import get_parser 
import re

# --- Initialize once ---
_PARSER = get_parser("typescript")
_LANGUAGE = _PARSER.language


def _build_class_ranges(root_node, source_bytes):
    class_ranges = {}
    try:
        class_query = _LANGUAGE.query(
            """
            (class_declaration
              name: (_) @class.name
              body: (class_body) @class.body) @class.def
            """
        )
        class_matches = class_query.matches(root_node)
        for _, capture_dict in class_matches:
            class_name_nodes = capture_dict.get("class.name", [])
            class_def_nodes = capture_dict.get("class.def", [])
            if class_name_nodes and class_def_nodes:
                class_name_node = class_name_nodes[0]
                class_def_node = class_def_nodes[0]
                class_name = source_bytes[class_name_node.start_byte:class_name_node.end_byte].decode(
                    "utf-8", errors="replace"
                )
                class_ranges[class_name] = {
                    "start": class_def_node.start_point,
                    "end": class_def_node.end_point,
                }
    except Exception as e:
        print(f"[TS extractor] class query error: {e}")
    return class_ranges


_JSDOC_PATTERN = re.compile(r"/\*\*([\s\S]*?)\*/", re.MULTILINE)


def extract_typescript_functions(source_bytes: bytes) -> list[dict]:
    """Extract TypeScript class methods and standalone functions.

    Keep it simple and robust: mirror python_extractor by capturing only
    - function_declaration
    - method_definition (inside classes)
    and skip variable-assigned/arrow functions.
    """
    tree = _PARSER.parse(source_bytes)
    root_node = tree.root_node

    class_ranges = _build_class_ranges(root_node, source_bytes)

    # Minimal, grammar-stable patterns
    query_src = """
    ; standalone function declarations
    (function_declaration
      name: (identifier) @func.name
      body: (statement_block) @func.body) @func.def

    ; class methods
    (method_definition
      name: (property_identifier) @func.name
      body: (statement_block) @func.body) @func.def

    ; private methods (#name)
    (method_definition
      name: (private_property_identifier) @func.name
      body: (statement_block) @func.body) @func.def
    """

    try:
        func_query = _LANGUAGE.query(query_src)
        func_matches = func_query.matches(root_node)
    except Exception as e:
        print(f"[TS extractor] function query error: {e}")
        return []

    # Prepare JSDoc list over the original text
    source_text = source_bytes.decode("utf-8", errors="replace")
    jsdocs = [(m.start(), m.end(), m.group(0)) for m in _JSDOC_PATTERN.finditer(source_text)]

    results = []
    for _, capture_dict in func_matches:
        func_def_nodes = capture_dict.get("func.def", [])
        if not func_def_nodes:
            continue
        func_def_node = func_def_nodes[0]

        name_nodes = capture_dict.get("func.name", [])
        if not name_nodes:
            func_name = "<anonymous>"
        else:
            name_node = name_nodes[0]
            func_name = source_bytes[name_node.start_byte:name_node.end_byte].decode(
                "utf-8", errors="replace"
            )

        func_code = source_bytes[func_def_node.start_byte:func_def_node.end_byte].decode(
            "utf-8", errors="replace"
        )

        # Attach JSDoc if the closest preceding one exists
        docstring_content = None
        func_start_byte = func_def_node.start_byte
        closest_jsdoc = None
        for jsdoc_start, jsdoc_end, jsdoc_text in reversed(jsdocs):
            if jsdoc_end <= func_start_byte:
                closest_jsdoc = jsdoc_text
                break
        if closest_jsdoc:
            # remove /** and */ and leading *
            docstring_content = re.sub(r"^\s*\* ?", "", closest_jsdoc[3:-2], flags=re.MULTILINE).strip()

        func_start = func_def_node.start_point
        belonging_class = None
        for class_name, class_range in class_ranges.items():
            if class_range["start"][0] <= func_start[0] <= class_range["end"][0]:
                belonging_class = class_name
                break

        item = {
            "name": func_name,
            "function_name": func_name,  # UI 互換
            "code": func_code,
            "lineno": func_def_node.start_point[0] + 1,
            "end_lineno": func_def_node.end_point[0] + 1,
            "class_name": belonging_class,
        }
        if docstring_content:
            item["docstring"] = docstring_content
        results.append(item)

    return results
