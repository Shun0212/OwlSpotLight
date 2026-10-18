"""Tree-sitter function and module code-block extractor for Python."""
import inspect

from tree_sitter import Language, Parser
import tree_sitter_python


PY_LANGUAGE = Language(tree_sitter_python.language())
PY_PARSER = Parser(PY_LANGUAGE)

_HTTP_METHODS = {"get", "post", "put", "patch", "delete", "options", "head", "api_route", "route"}
_IMPORT_TYPES = {"import_statement", "import_from_statement", "future_import_statement"}
_DEFINITION_TYPES = {"function_definition", "class_definition", "decorated_definition"}
# Top-level statements grouped into code blocks, named after their Python AST class.
_BLOCK_STATEMENT_TYPES = {
    "if_statement": "If",
    "for_statement": "For",
    "while_statement": "While",
    "with_statement": "With",
    "try_statement": "Try",
    "match_statement": "Match",
}
_TARGET_CONTAINER_TYPES = {
    "pattern_list", "tuple_pattern", "list_pattern", "tuple", "list",
    "list_splat_pattern", "parenthesized_expression", "as_pattern_target",
}


def _text(node, source_bytes: bytes) -> str:
    return source_bytes[node.start_byte:node.end_byte].decode("utf-8", errors="replace")


def _expression_text(node, source_bytes: bytes) -> str:
    """Source text of an expression on one line, without comments or trailing commas."""
    leaves = []
    stack = [node]
    while stack:
        current = stack.pop()
        if current.type == "comment":
            continue
        if current.child_count == 0 or current.type == "string":
            leaves.append(current)
        else:
            stack.extend(reversed(current.children))
    parts: list[str] = []
    for index, leaf in enumerate(leaves):
        following = leaves[index + 1] if index + 1 < len(leaves) else None
        if leaf.type == "," and following is not None and following.type in {")", "]", "}"}:
            continue
        if parts and leaf.start_byte > leaves[index - 1].end_byte:
            if leaves[index - 1].type not in {"(", "[", "{"} and leaf.type not in {")", "]", "}"}:
                parts.append(" ")
        parts.append(_text(leaf, source_bytes))
    return "".join(parts)


def _walk(node):
    stack = [node]
    while stack:
        current = stack.pop()
        yield current
        stack.extend(reversed(current.children))


def _last_code_node(node):
    # Tree-sitter attaches trailing comments to the enclosing block; Python's ast does not.
    while node.child_count:
        children = [child for child in node.children if child.type != "comment"]
        if not children:
            break
        node = children[-1]
    return node


def _line_range(node) -> tuple[int, int]:
    start = node.start_point[0] + 1
    last = _last_code_node(node)
    end = last.end_point[0] + 1
    if last.end_point[1] == 0 and end > start:
        end -= 1
    return start, end


def _source_segment(source_lines: list[bytes], start: int, end: int) -> str:
    return b"".join(source_lines[start - 1:end]).decode("utf-8", errors="replace")


def _is_async(node) -> bool:
    return any(child.type == "async" for child in node.children)


def _unwrap_definition(node):
    if node.type == "decorated_definition":
        return node.child_by_field_name("definition")
    return node


def _string_value(node, source_bytes: bytes) -> str | None:
    """Value of a plain (non-f, non-bytes) string literal, or None."""
    if node.type == "concatenated_string":
        parts = [_string_value(child, source_bytes) for child in node.named_children]
        return None if any(part is None for part in parts) else "".join(parts)
    if node.type != "string" or len(node.children) < 2:
        return None
    start, end = node.children[0], node.children[-1]
    prefix = _text(start, source_bytes).lower()
    if "f" in prefix or "b" in prefix or "t" in prefix:
        return None
    value = source_bytes[start.end_byte:end.start_byte].decode("utf-8", errors="replace")
    if "r" in prefix or "\\" not in value:
        return value
    try:
        return value.encode("latin-1", "backslashreplace").decode("unicode_escape")
    except UnicodeDecodeError:
        return value


def _docstring_value(statement, source_bytes: bytes) -> str | None:
    if statement.type != "expression_statement" or statement.named_child_count != 1:
        return None
    return _string_value(statement.named_children[0], source_bytes)


def _body_docstring(body, source_bytes: bytes) -> str | None:
    statement = next((child for child in body.named_children if child.type != "comment"), None)
    if statement is None:
        return None
    value = _docstring_value(statement, source_bytes)
    return inspect.cleandoc(value) if value is not None else None


def _decorator_nodes(node) -> list:
    """Decorator expressions of a function/class definition."""
    parent = node.parent
    if parent is None or parent.type != "decorated_definition":
        return []
    return [child.named_children[0] for child in parent.children
            if child.type == "decorator" and child.named_child_count]


def _route_info(decorator_nodes: list, source_bytes: bytes) -> list[dict]:
    routes: list[dict] = []
    for decorator in decorator_nodes:
        if decorator.type != "call":
            continue
        func = decorator.child_by_field_name("function")
        if func is None or func.type != "attribute":
            continue
        method_name = _text(func.child_by_field_name("attribute"), source_bytes)
        if method_name not in _HTTP_METHODS:
            continue
        route_path = None
        arguments = decorator.child_by_field_name("arguments")
        first = next((arg for arg in arguments.named_children if arg.type != "comment"), None) if arguments else None
        if first is not None:
            route_path = _string_value(first, source_bytes)
        routes.append({"framework": "fastapi", "method": method_name.upper(), "path": route_path})
    return routes


def _framework_tags(name: str, decorators: list[str], routes: list[dict]) -> list[str]:
    tags: set[str] = set()
    if routes:
        tags.add("fastapi_route")
    if name.startswith("test_") or any(decorator in decorators for decorator in ["pytest.fixture", "fixture"]):
        tags.add("pytest")
    if any("django" in decorator.lower() for decorator in decorators):
        tags.add("django")
    return sorted(tags)


def parameter_binding(node, source_bytes: bytes) -> tuple[str | None, str | None, bool]:
    """Return (name, annotation, is_star) for one entry of a parameters node."""
    annotation_node = node.child_by_field_name("type")
    annotation = _expression_text(annotation_node, source_bytes) if annotation_node is not None else None
    if node.type == "identifier":
        return _text(node, source_bytes), None, False
    if node.type in {"list_splat_pattern", "dictionary_splat_pattern"}:
        inner = next((child for child in node.named_children if child.type == "identifier"), None)
        return (_text(inner, source_bytes) if inner else None), None, True
    if node.type in {"default_parameter", "typed_default_parameter"}:
        name_node = node.child_by_field_name("name")
        return (_text(name_node, source_bytes) if name_node else None), annotation, False
    if node.type == "typed_parameter":
        inner = next((child for child in node.named_children if child is not annotation_node), None)
        if inner is None:
            return None, annotation, False
        name, _, is_star = parameter_binding(inner, source_bytes)
        return name, annotation, is_star
    return None, None, False


def _parameter_nodes(parameters) -> list:
    return [child for child in parameters.named_children if child.type != "comment"] if parameters else []


def _argument_names(node, source_bytes: bytes) -> list[str]:
    # Same order as Python's ast: regular/keyword-only first, then *args and **kwargs.
    regular: list[str] = []
    star: list[str] = []
    for child in _parameter_nodes(node.child_by_field_name("parameters")):
        name, annotation, is_star = parameter_binding(child, source_bytes)
        if not name:
            continue
        (star if is_star else regular).append(f"{name}: {annotation}" if annotation else name)
    return regular + star


def _call_name(node, source_bytes: bytes) -> str | None:
    # `(x).f()` and tree-sitter's `[*f(x)]` -> call(list_splat(f)) wrap the callee.
    while node.type in {"parenthesized_expression", "list_splat"} and node.named_child_count == 1:
        node = node.named_children[0]
    if node.type == "identifier":
        return _text(node, source_bytes)
    if node.type == "attribute":
        attribute = _text(node.child_by_field_name("attribute"), source_bytes)
        base = _call_name(node.child_by_field_name("object"), source_bytes)
        return f"{base}.{attribute}" if base else attribute
    return None


def target_names(node, source_bytes: bytes, names: set[str]) -> None:
    if node.type == "identifier":
        names.add(_text(node, source_bytes))
    elif node.type in _TARGET_CONTAINER_TYPES:
        for child in node.named_children:
            target_names(child, source_bytes, names)


def store_targets(node) -> list:
    """Nodes that bind names (assignment targets, loop targets, `as` targets, walrus)."""
    if node.type in {"assignment", "augmented_assignment", "for_statement", "for_in_clause"}:
        target = node.child_by_field_name("left")
        return [target] if target is not None else []
    if node.type == "named_expression":
        target = node.child_by_field_name("name")
        return [target] if target is not None else []
    if node.type == "as_pattern" and _in_with_item(node):
        return [child for child in node.children if child.type == "as_pattern_target"]
    return []


def _in_with_item(node) -> bool:
    # `except E as e` and `case X as y` bind plain strings in Python's ast, not stored names.
    parent = node.parent
    while parent is not None and parent.type not in {"except_clause", "case_clause", "block", "module"}:
        if parent.type == "with_item":
            return True
        parent = parent.parent
    return False


def _assigned_names(nodes: list, source_bytes: bytes) -> list[str]:
    names: set[str] = set()
    for root in nodes:
        for child in _walk(root):
            for target in store_targets(child):
                target_names(target, source_bytes, names)
    return sorted(names)


def _called_names(nodes: list, source_bytes: bytes) -> list[str]:
    names: set[str] = set()
    for root in nodes:
        for child in _walk(root):
            if child.type == "call":
                name = _call_name(child.child_by_field_name("function"), source_bytes)
                if name:
                    names.add(name)
    return sorted(names)


def _imported_name(node, source_bytes: bytes) -> str:
    if node.type == "aliased_import":
        node = node.child_by_field_name("name")
    return _text(node, source_bytes)


def _import_names(nodes: list, source_bytes: bytes) -> list[str]:
    imports: list[str] = []
    for root in nodes:
        for child in _walk(root):
            if child.type == "import_statement":
                imports.extend(_imported_name(name, source_bytes) for name in child.children_by_field_name("name"))
            elif child.type in {"import_from_statement", "future_import_statement"}:
                module_node = child.child_by_field_name("module_name")
                module = _text(module_node, source_bytes).lstrip(".") if module_node else "__future__"
                names = [_imported_name(name, source_bytes) for name in child.children_by_field_name("name")]
                if any(grandchild.type == "wildcard_import" for grandchild in child.children):
                    names.append("*")
                imports.extend(f"{module}.{name}" if module else name for name in names)
    return sorted(set(imports))


def _enrich_code_for_embedding(code: str, metadata: dict) -> str:
    parts = [code]
    if metadata.get("docstring"):
        parts.append(f"\nDocstring: {metadata['docstring']}")
    for key, label in [
        ("params", "Parameters"),
        ("returns", "Returns"),
        ("decorators", "Decorators"),
        ("framework_tags", "Framework tags"),
        ("routes", "Routes"),
        ("imports", "Imports"),
        ("calls", "Calls"),
        ("assigned_names", "Assigned names"),
    ]:
        value = metadata.get(key)
        if value:
            if isinstance(value, list):
                parts.append(f"{label}: {', '.join(str(item) for item in value)}")
            else:
                parts.append(f"{label}: {value}")
    return "\n".join(parts)


def _function_item(node, source_bytes: bytes, source_lines: list[bytes], class_name: str | None = None) -> dict:
    start, end = _line_range(node)
    raw_code = _source_segment(source_lines, start, end).rstrip("\n")
    name = _text(node.child_by_field_name("name"), source_bytes)
    body = node.child_by_field_name("body")
    returns_node = node.child_by_field_name("return_type")
    decorator_nodes = _decorator_nodes(node)
    decorators = [_expression_text(decorator, source_bytes) for decorator in decorator_nodes]
    routes = _route_info(decorator_nodes, source_bytes)
    metadata = {
        "docstring": _body_docstring(body, source_bytes) if body is not None else None,
        "params": _argument_names(node, source_bytes),
        "returns": _expression_text(returns_node, source_bytes) if returns_node is not None else None,
        "decorators": decorators,
        "calls": _called_names([*decorator_nodes, node], source_bytes),
        "assigned_names": _assigned_names([*decorator_nodes, node], source_bytes),
        "is_async": _is_async(node),
        "routes": routes,
        "framework_tags": _framework_tags(name, decorators, routes),
    }
    item = {
        "name": name,
        "function_name": name,
        "code": _enrich_code_for_embedding(raw_code, metadata),
        "raw_code": raw_code,
        "lineno": start,
        "end_lineno": end,
        "class_name": class_name,
        "symbol_kind": "method" if class_name else "function",
        "python_static": metadata,
    }
    if metadata["docstring"]:
        item["docstring"] = metadata["docstring"]
    return item


def _statement_type(node) -> str | None:
    """Python AST class name of a top-level statement, or None if it is not block-worthy."""
    if node.type in _BLOCK_STATEMENT_TYPES:
        name = _BLOCK_STATEMENT_TYPES[node.type]
        return f"Async{name}" if name in {"For", "With"} and _is_async(node) else name
    if node.type == "import_statement":
        return "Import"
    if node.type in {"import_from_statement", "future_import_statement"}:
        return "ImportFrom"
    if node.type == "expression_statement":
        expression = node.named_children[0] if node.named_child_count else None
        if expression is not None and expression.type == "assignment":
            return "AnnAssign" if expression.child_by_field_name("type") is not None else "Assign"
        if expression is not None and expression.type == "augmented_assignment":
            return "AugAssign"
        return "Expr"
    return None


def _code_block_item(nodes: list, source_bytes: bytes, source_lines: list[bytes]) -> dict:
    start_line = min(_line_range(node)[0] for node in nodes)
    end_line = max(_line_range(node)[1] for node in nodes)
    raw_code = _source_segment(source_lines, start_line, end_line).strip("\n")
    block_types = [_statement_type(node) for node in nodes]
    metadata = {
        "block_type": "+".join(dict.fromkeys(block_types)),
        "block_types": block_types,
        "imports": _import_names(nodes, source_bytes),
        "calls": _called_names(nodes, source_bytes),
        "assigned_names": _assigned_names(nodes, source_bytes),
        "statement_count": len(nodes),
    }
    call_suffix = f":calls={','.join(metadata['calls'][:3])}" if metadata["calls"] else ""
    name = f"CodeBlock:{start_line}-{end_line}{call_suffix}"
    return {
        "name": name,
        "function_name": name,
        "code": _enrich_code_for_embedding(raw_code, metadata),
        "raw_code": raw_code,
        "lineno": start_line,
        "end_lineno": end_line,
        "class_name": None,
        "symbol_kind": "code_block",
        "python_static": metadata,
    }


def _extract_module_code_blocks(root_node, source_bytes: bytes, source_lines: list[bytes]) -> list[dict]:
    blocks: list[dict] = []
    current: list = []

    def flush() -> None:
        if current:
            blocks.append(_code_block_item(current.copy(), source_bytes, source_lines))
            current.clear()

    for node in root_node.named_children:
        if node.type == "comment":
            continue
        if node.type in _DEFINITION_TYPES:
            flush()
            continue
        # Imports and docstrings only extend a block that has already started.
        if node.type in _IMPORT_TYPES or _docstring_value(node, source_bytes) is not None:
            if current:
                current.append(node)
            continue
        if _statement_type(node) is not None:
            current.append(node)
            continue
        flush()

    flush()
    return blocks


def _add_static_graphs(results: list[dict]) -> None:
    function_names = {item["name"] for item in results if item.get("symbol_kind") in {"function", "method"}}
    import_dependency: dict[str, list[str]] = {}
    call_graph: dict[str, list[str]] = {}
    for item in results:
        static = item["python_static"]
        calls = static.get("calls", [])
        imports = static.get("imports", [])
        static["local_calls"] = sorted({call for call in calls if call.split(".")[-1] in function_names})
        static["external_import_calls"] = sorted(
            {call for call in calls if any(call == imported or call.startswith(f"{imported}.") for imported in imports)}
        )
        if item.get("symbol_kind") in {"function", "method"}:
            call_graph[item["name"]] = static["local_calls"]
        if imports:
            import_dependency[item["name"]] = imports

    for item in results:
        item["python_static"]["call_graph"] = call_graph
        item["python_static"]["import_dependency"] = import_dependency


def extract_python_functions(source_bytes: bytes) -> list[dict]:
    tree = PY_PARSER.parse(source_bytes)
    root_node = tree.root_node
    source_lines = source_bytes.split(b"\n")
    source_lines = [line + b"\n" for line in source_lines[:-1]] + source_lines[-1:]

    results: list[dict] = []
    for node in root_node.named_children:
        definition = _unwrap_definition(node)
        if definition is None:
            continue
        if definition.type == "function_definition":
            results.append(_function_item(definition, source_bytes, source_lines))
        elif definition.type == "class_definition":
            class_name = _text(definition.child_by_field_name("name"), source_bytes)
            body = definition.child_by_field_name("body")
            for child in body.named_children if body is not None else []:
                method = _unwrap_definition(child)
                if method is not None and method.type == "function_definition":
                    results.append(_function_item(method, source_bytes, source_lines, class_name))

    results.extend(_extract_module_code_blocks(root_node, source_bytes, source_lines))
    _add_static_graphs(results)
    return sorted(results, key=lambda item: (item["lineno"], item.get("symbol_kind") == "code_block"))
