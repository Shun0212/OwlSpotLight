"""Tree-sitter function extractor for Rust, Go, C and C++ (Python backend only)."""
from tree_sitter_language_pack import get_parser

_PARSER_CACHE = {}

# Function node types and the enclosing node types that act as a "class".
_FUNCTION_TYPES = {
    "rust": {"function_item"},
    "go": {"function_declaration", "method_declaration"},
    "c": {"function_definition"},
    "cpp": {"function_definition"},
}
_CONTAINER_TYPES = {
    "rust": {"impl_item", "trait_item"},
    "go": set(),
    "c": set(),
    "cpp": {"class_specifier", "struct_specifier"},
}
_DOC_COMMENT_TYPES = {"comment", "line_comment", "block_comment"}


def _get_parser(language: str):
    if language not in _PARSER_CACHE:
        _PARSER_CACHE[language] = get_parser(language)
    return _PARSER_CACHE[language]


def _text(node, source_bytes: bytes) -> str:
    return source_bytes[node.start_byte:node.end_byte].decode("utf-8", errors="replace")


def _strip_generics(name: str) -> str:
    return name.split("<", 1)[0].strip()


def _c_declarator_name(node, source_bytes: bytes):
    """Follow C/C++ declarator chains (pointer/reference/function) to the identifier."""
    while node is not None:
        if node.type in {"identifier", "field_identifier", "qualified_identifier",
                         "destructor_name", "operator_name", "template_function"}:
            return _text(node, source_bytes)
        next_node = node.child_by_field_name("declarator")
        if next_node is None:
            next_node = next((c for c in node.named_children if c.type.endswith("declarator")), None)
        node = next_node
    return None


def _function_name(node, language: str, source_bytes: bytes):
    if language in {"c", "cpp"}:
        return _c_declarator_name(node.child_by_field_name("declarator"), source_bytes)
    name_node = node.child_by_field_name("name")
    return _text(name_node, source_bytes) if name_node is not None else None


def _container_name(node, language: str, source_bytes: bytes):
    if language == "rust" and node.type == "impl_item":
        type_node = node.child_by_field_name("type")
        return _strip_generics(_text(type_node, source_bytes)) if type_node is not None else None
    name_node = node.child_by_field_name("name")
    return _text(name_node, source_bytes) if name_node is not None else None


def _go_receiver_type(node, source_bytes: bytes):
    receiver = node.child_by_field_name("receiver")
    if receiver is None:
        return None
    for param in receiver.named_children:
        type_node = param.child_by_field_name("type")
        if type_node is not None:
            return _strip_generics(_text(type_node, source_bytes).lstrip("*"))
    return None


def _leading_doc(node, source_bytes: bytes):
    """Collect contiguous comments directly above the function (///, //, /* */)."""
    lines = []
    sibling = node.prev_named_sibling
    expected_row = node.start_point[0]
    while sibling is not None and sibling.type in _DOC_COMMENT_TYPES and sibling.end_point[0] >= expected_row - 1:
        lines.insert(0, _text(sibling, source_bytes))
        expected_row = sibling.start_point[0]
        sibling = sibling.prev_named_sibling
    if not lines:
        return None
    cleaned = []
    for raw in "\n".join(lines).splitlines():
        line = raw.strip()
        for prefix in ("///", "//!", "//", "/**", "/*", "*/", "*"):
            if line.startswith(prefix):
                line = line[len(prefix):]
                break
        if line.endswith("*/"):
            line = line[:-2]
        cleaned.append(line.strip())
    doc = "\n".join(cleaned).strip()
    return doc or None


def extract_generic_functions(source_bytes: bytes, language: str) -> list[dict]:
    function_types = _FUNCTION_TYPES[language]
    container_types = _CONTAINER_TYPES[language]
    tree = _get_parser(language).parse(source_bytes)

    results = []
    # Iterative DFS carrying the nearest enclosing container name.
    stack = [(tree.root_node, None)]
    while stack:
        node, container = stack.pop()
        if node.type in container_types:
            container = _container_name(node, language, source_bytes) or container
        if node.type in function_types:
            name = _function_name(node, language, source_bytes)
            if name:
                class_name = container
                if language == "go" and node.type == "method_declaration":
                    class_name = _go_receiver_type(node, source_bytes)
                elif language == "cpp" and "::" in name:
                    scope, _, name = name.rpartition("::")
                    class_name = class_name or _strip_generics(scope.rsplit("::", 1)[-1]) or None
                item = {
                    "name": name,
                    "function_name": name,
                    "code": _text(node, source_bytes),
                    "lineno": node.start_point[0] + 1,
                    "end_lineno": node.end_point[0] + 1,
                    "class_name": class_name,
                }
                doc = _leading_doc(node, source_bytes)
                if doc:
                    item["docstring"] = doc
                results.append(item)
        for child in reversed(node.named_children):
            stack.append((child, container))
    return results
