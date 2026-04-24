import ast

from tree_sitter import Language, Parser
import tree_sitter_python


_PY_LANGUAGE = Language(tree_sitter_python.language())
_PY_PARSER = Parser(_PY_LANGUAGE)


def _source_segment(source_lines: list[str], node: ast.AST) -> str:
    start = getattr(node, "lineno", 1)
    end = getattr(node, "end_lineno", start)
    return "".join(source_lines[start - 1:end]).rstrip("\n")


def _annotation_name(node: ast.AST | None) -> str | None:
    if node is None:
        return None
    try:
        return ast.unparse(node)
    except Exception:
        return None


def _decorator_names(node: ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef) -> list[str]:
    names: list[str] = []
    for decorator in node.decorator_list:
        value = _annotation_name(decorator)
        if value:
            names.append(value)
    return names


def _route_info(decorators: list[str]) -> list[dict]:
    routes: list[dict] = []
    http_methods = {"get", "post", "put", "patch", "delete", "options", "head", "api_route", "route"}
    for decorator in decorators:
        try:
            parsed = ast.parse(decorator, mode="eval").body
        except SyntaxError:
            continue
        if not isinstance(parsed, ast.Call):
            continue
        func = parsed.func
        method_name = func.attr if isinstance(func, ast.Attribute) else None
        if not method_name or method_name not in http_methods:
            continue
        route_path = None
        if parsed.args and isinstance(parsed.args[0], ast.Constant) and isinstance(parsed.args[0].value, str):
            route_path = parsed.args[0].value
        routes.append({"framework": "fastapi", "method": method_name.upper(), "path": route_path})
    return routes


def _framework_tags(node: ast.FunctionDef | ast.AsyncFunctionDef, decorators: list[str]) -> list[str]:
    tags: set[str] = set()
    if _route_info(decorators):
        tags.add("fastapi_route")
    if node.name.startswith("test_") or any(name in decorators for name in ["pytest.fixture", "fixture"]):
        tags.add("pytest")
    if any("django" in decorator.lower() for decorator in decorators):
        tags.add("django")
    return sorted(tags)


def _argument_names(node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[str]:
    args = []
    all_args = [
        *node.args.posonlyargs,
        *node.args.args,
        *node.args.kwonlyargs,
    ]
    if node.args.vararg:
        all_args.append(node.args.vararg)
    if node.args.kwarg:
        all_args.append(node.args.kwarg)
    for arg in all_args:
        if arg.annotation:
            args.append(f"{arg.arg}: {_annotation_name(arg.annotation)}")
        else:
            args.append(arg.arg)
    return args


def _call_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _call_name(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    return None


def _assigned_names(node: ast.AST) -> list[str]:
    names: set[str] = set()
    for child in ast.walk(node):
        if isinstance(child, ast.Name) and isinstance(child.ctx, ast.Store):
            names.add(child.id)
        elif isinstance(child, ast.arg):
            continue
    return sorted(names)


def _called_names(node: ast.AST) -> list[str]:
    names: set[str] = set()
    for child in ast.walk(node):
        if isinstance(child, ast.Call):
            name = _call_name(child.func)
            if name:
                names.add(name)
    return sorted(names)


def _import_names(node: ast.AST) -> list[str]:
    imports: list[str] = []
    for child in ast.walk(node):
        if isinstance(child, ast.Import):
            imports.extend(alias.name for alias in child.names)
        elif isinstance(child, ast.ImportFrom):
            module = child.module or ""
            imports.extend(f"{module}.{alias.name}" if module else alias.name for alias in child.names)
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


def _function_item(
    node: ast.FunctionDef | ast.AsyncFunctionDef,
    source_lines: list[str],
    class_name: str | None = None,
) -> dict:
    raw_code = _source_segment(source_lines, node)
    decorators = _decorator_names(node)
    routes = _route_info(decorators)
    metadata = {
        "docstring": ast.get_docstring(node),
        "params": _argument_names(node),
        "returns": _annotation_name(node.returns),
        "decorators": decorators,
        "calls": _called_names(node),
        "assigned_names": _assigned_names(node),
        "is_async": isinstance(node, ast.AsyncFunctionDef),
        "routes": routes,
        "framework_tags": _framework_tags(node, decorators),
    }
    item = {
        "name": node.name,
        "function_name": node.name,
        "code": _enrich_code_for_embedding(raw_code, metadata),
        "raw_code": raw_code,
        "lineno": node.lineno,
        "end_lineno": getattr(node, "end_lineno", node.lineno),
        "class_name": class_name,
        "symbol_kind": "method" if class_name else "function",
        "python_static": metadata,
    }
    if metadata["docstring"]:
        item["docstring"] = metadata["docstring"]
    return item


def _code_block_item(nodes: list[ast.stmt], source_lines: list[str], index: int) -> dict:
    start_line = min(getattr(node, "lineno", 1) for node in nodes)
    end_line = max(getattr(node, "end_lineno", getattr(node, "lineno", 1)) for node in nodes)
    raw_code = "".join(source_lines[start_line - 1:end_line]).strip("\n")
    block_types = [type(node).__name__ for node in nodes]
    synthetic_module = ast.Module(body=nodes, type_ignores=[])
    metadata = {
        "block_type": "+".join(dict.fromkeys(block_types)),
        "block_types": block_types,
        "imports": _import_names(synthetic_module),
        "calls": _called_names(synthetic_module),
        "assigned_names": _assigned_names(synthetic_module),
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


def _is_module_docstring(node: ast.AST) -> bool:
    return (
        isinstance(node, ast.Expr)
        and isinstance(node.value, ast.Constant)
        and isinstance(node.value.value, str)
    )


def _is_code_block_candidate(node: ast.AST) -> bool:
    return isinstance(
        node,
        (
            ast.Assign,
            ast.AnnAssign,
            ast.AugAssign,
            ast.Expr,
            ast.If,
            ast.For,
            ast.AsyncFor,
            ast.While,
            ast.With,
            ast.AsyncWith,
            ast.Try,
            ast.Match,
        ),
    )


def _is_import_or_docstring(node: ast.AST) -> bool:
    return isinstance(node, (ast.Import, ast.ImportFrom)) or _is_module_docstring(node)


def _extract_module_code_blocks(tree: ast.Module, source_lines: list[str]) -> list[dict]:
    blocks: list[dict] = []
    current: list[ast.stmt] = []
    block_index = 1

    def flush() -> None:
        nonlocal block_index
        if current:
            blocks.append(_code_block_item(current.copy(), source_lines, block_index))
            current.clear()
            block_index += 1

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            flush()
            continue
        if _is_import_or_docstring(node):
            if current:
                current.append(node)
            continue
        if _is_code_block_candidate(node):
            current.append(node)
            continue
        flush()

    flush()
    return blocks


def _extract_python_functions_with_tree_sitter(source_bytes: bytes) -> list[dict]:
    tree = _PY_PARSER.parse(source_bytes)
    root_node = tree.root_node

    class_query = _PY_LANGUAGE.query(
        """
    (class_definition
      name: (identifier) @class.name
      body: (block) @class.body) @class.def
    """
    )
    class_matches = class_query.matches(root_node)

    class_ranges = {}
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

    func_query = _PY_LANGUAGE.query(
        """
    (function_definition
      name: (identifier) @func.name
      body: (block) @func.body) @func.def
    """
    )
    func_matches = func_query.matches(root_node)

    results = []
    for _, capture_dict in func_matches:
        name_nodes = capture_dict.get("func.name", [])
        func_def_nodes = capture_dict.get("func.def", [])
        if not name_nodes or not func_def_nodes:
            continue
        name_node = name_nodes[0]
        func_def_node = func_def_nodes[0]
        func_name = source_bytes[name_node.start_byte:name_node.end_byte].decode(
            "utf-8", errors="replace"
        )
        func_code = source_bytes[func_def_node.start_byte:func_def_node.end_byte].decode(
            "utf-8", errors="replace"
        )

        func_start = func_def_node.start_point
        belonging_class = None
        for class_name, class_range in class_ranges.items():
            if class_range["start"][0] <= func_start[0] <= class_range["end"][0]:
                belonging_class = class_name
                break

        results.append(
            {
                "name": func_name,
                "function_name": func_name,
                "code": func_code,
                "raw_code": func_code,
                "lineno": func_def_node.start_point[0] + 1,
                "end_lineno": func_def_node.end_point[0] + 1,
                "class_name": belonging_class,
                "symbol_kind": "method" if belonging_class else "function",
                "python_static": {"fallback": "tree_sitter"},
            }
        )
    return results


def extract_python_functions(source_bytes: bytes) -> list[dict]:
    source_text = source_bytes.decode("utf-8", errors="replace")
    source_lines = source_text.splitlines(keepends=True)
    try:
        tree = ast.parse(source_text)
    except SyntaxError as error:
        print(f"[Python extractor] AST syntax error, falling back to tree-sitter: {error}")
        return _extract_python_functions_with_tree_sitter(source_bytes)

    results: list[dict] = []

    def visit_body(body: list[ast.stmt], class_name: str | None = None) -> None:
        for node in body:
            if isinstance(node, ast.ClassDef):
                for child in node.body:
                    if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        results.append(_function_item(child, source_lines, node.name))
                continue
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                results.append(_function_item(node, source_lines, class_name))

    visit_body(tree.body)

    results.extend(_extract_module_code_blocks(tree, source_lines))
    function_names = {item["name"] for item in results if item.get("symbol_kind") in {"function", "method"}}
    import_dependency: dict[str, list[str]] = {}
    call_graph: dict[str, list[str]] = {}
    for item in results:
        static = item.get("python_static", {})
        local_calls = sorted({call for call in static.get("calls", []) if call.split(".")[-1] in function_names})
        external_import_calls = sorted(
            {
                call
                for call in static.get("calls", [])
                if any(call == imported or call.startswith(f"{imported}.") for imported in static.get("imports", []))
            }
        )
        static["local_calls"] = local_calls
        static["external_import_calls"] = external_import_calls
        item["python_static"] = static
        if item.get("symbol_kind") in {"function", "method"}:
            call_graph[item["name"]] = local_calls
        if static.get("imports"):
            import_dependency[item["name"]] = static["imports"]

    for item in results:
        static = item.get("python_static", {})
        static["call_graph"] = call_graph
        static["import_dependency"] = import_dependency
        item["python_static"] = static

    return sorted(results, key=lambda item: (item["lineno"], item.get("symbol_kind") == "code_block"))
