"""Python code symbol extractor (tree-sitter based).

Returns per-function dicts with a backward-compatible schema (``name``,
``code``, ``lineno``, ``end_lineno``, ``class_name``) plus enriched fields:

    docstring        str | None
    decorators       list[str]
    parameters       list[{"name": str, "type": str | None, "default": str | None}]
    return_type      str | None
    calls            list[str]    (callee names referenced in the body)
    is_async         bool
    kind             "function" | "method"

An ``extract_python_symbols`` helper additionally returns top-level imports
and class records (with ``bases``) so callers can build dependency / class
hierarchy views without re-parsing.
"""
from __future__ import annotations

from typing import Dict, List, Optional

import tree_sitter_python
from tree_sitter import Language, Parser

from ._ts_utils import (
    collect_call_names,
    find_child_by_field,
    iter_descendants,
    node_text,
    strip_common_indent,
    unique,
)


_PY_LANGUAGE = Language(tree_sitter_python.language())
_PY_PARSER = Parser(_PY_LANGUAGE)


_CLASS_QUERY = _PY_LANGUAGE.query(
    """
    (class_definition
      name: (identifier) @class.name
      body: (block) @class.body) @class.def
    """
)

_FUNC_QUERY = _PY_LANGUAGE.query(
    """
    (function_definition
      name: (identifier) @func.name
      body: (block) @func.body) @func.def
    """
)


def _extract_docstring(body_node, source_bytes: bytes) -> Optional[str]:
    if body_node is None or not body_node.children:
        return None
    first = body_node.children[0]
    if first.type != "expression_statement":
        return None
    if not first.children:
        return None
    inner = first.children[0]
    if inner.type != "string":
        return None
    raw = node_text(inner, source_bytes)
    # strip triple/single quotes
    for quote in ('"""', "'''", '"', "'"):
        if raw.startswith(quote) and raw.endswith(quote) and len(raw) >= 2 * len(quote):
            raw = raw[len(quote):-len(quote)]
            break
    return strip_common_indent(raw)


def _extract_decorators(def_node, source_bytes: bytes) -> List[str]:
    """Decorators appear as sibling nodes before ``def_node`` under a
    ``decorated_definition`` parent. Handle both shapes."""
    decorators: List[str] = []
    parent = def_node.parent
    if parent and parent.type == "decorated_definition":
        for child in parent.children:
            if child.type == "decorator":
                text = node_text(child, source_bytes).lstrip("@").strip()
                if text:
                    decorators.append(text)
    return decorators


def _extract_parameters(def_node, source_bytes: bytes) -> List[Dict[str, Optional[str]]]:
    params_node = find_child_by_field(def_node, "parameters")
    if params_node is None:
        return []
    results: List[Dict[str, Optional[str]]] = []
    for child in params_node.children:
        if child.type in ("(", ")", ","):
            continue
        name: Optional[str] = None
        type_annotation: Optional[str] = None
        default: Optional[str] = None
        t = child.type
        if t == "identifier":
            name = node_text(child, source_bytes)
        elif t == "typed_parameter":
            # first identifier child is the name, "type" field holds annotation
            for sub in child.children:
                if sub.type == "identifier" and name is None:
                    name = node_text(sub, source_bytes)
            ann = find_child_by_field(child, "type")
            if ann is not None:
                type_annotation = node_text(ann, source_bytes)
        elif t == "default_parameter":
            name_node = find_child_by_field(child, "name")
            value_node = find_child_by_field(child, "value")
            if name_node is not None:
                name = node_text(name_node, source_bytes)
            if value_node is not None:
                default = node_text(value_node, source_bytes)
        elif t == "typed_default_parameter":
            name_node = find_child_by_field(child, "name")
            type_node = find_child_by_field(child, "type")
            value_node = find_child_by_field(child, "value")
            if name_node is not None:
                name = node_text(name_node, source_bytes)
            if type_node is not None:
                type_annotation = node_text(type_node, source_bytes)
            if value_node is not None:
                default = node_text(value_node, source_bytes)
        elif t in ("list_splat_pattern", "dictionary_splat_pattern"):
            name = node_text(child, source_bytes)
        else:
            name = node_text(child, source_bytes)
        if name:
            results.append({"name": name, "type": type_annotation, "default": default})
    return results


def _is_async(def_node) -> bool:
    # ``async def`` is represented as function_definition whose first child is
    # the ``async`` keyword token.
    if not def_node.children:
        return False
    return def_node.children[0].type == "async"


def _extract_class_bases(class_def_node, source_bytes: bytes) -> List[str]:
    superclasses = find_child_by_field(class_def_node, "superclasses")
    if superclasses is None:
        return []
    bases: List[str] = []
    for child in superclasses.children:
        if child.type in ("(", ")", ","):
            continue
        text = node_text(child, source_bytes).strip()
        if text:
            bases.append(text)
    return bases


def _extract_imports(root_node, source_bytes: bytes) -> List[str]:
    imports: List[str] = []
    for child in root_node.children:
        if child.type in ("import_statement", "import_from_statement", "future_import_statement"):
            imports.append(node_text(child, source_bytes).strip())
    return imports


def extract_python_symbols(source_bytes: bytes) -> Dict[str, list]:
    tree = _PY_PARSER.parse(source_bytes)
    root_node = tree.root_node

    class_ranges: Dict[str, Dict] = {}
    class_records: List[Dict] = []
    for _, cap in _CLASS_QUERY.matches(root_node):
        name_nodes = cap.get("class.name", [])
        def_nodes = cap.get("class.def", [])
        if not name_nodes or not def_nodes:
            continue
        class_name = node_text(name_nodes[0], source_bytes)
        class_def_node = def_nodes[0]
        class_ranges[class_name] = {
            "start": class_def_node.start_point,
            "end": class_def_node.end_point,
        }
        class_records.append(
            {
                "name": class_name,
                "lineno": class_def_node.start_point[0] + 1,
                "end_lineno": class_def_node.end_point[0] + 1,
                "bases": _extract_class_bases(class_def_node, source_bytes),
                "decorators": _extract_decorators(class_def_node, source_bytes),
            }
        )

    functions: List[Dict] = []
    for _, cap in _FUNC_QUERY.matches(root_node):
        name_nodes = cap.get("func.name", [])
        def_nodes = cap.get("func.def", [])
        body_nodes = cap.get("func.body", [])
        if not name_nodes or not def_nodes:
            continue
        func_def_node = def_nodes[0]
        body_node = body_nodes[0] if body_nodes else find_child_by_field(func_def_node, "body")

        func_name = node_text(name_nodes[0], source_bytes)
        func_code = node_text(func_def_node, source_bytes)

        start_pt = func_def_node.start_point
        belonging_class: Optional[str] = None
        for class_name, rng in class_ranges.items():
            if rng["start"][0] <= start_pt[0] <= rng["end"][0]:
                belonging_class = class_name
                break

        return_type_node = find_child_by_field(func_def_node, "return_type")
        return_type = node_text(return_type_node, source_bytes) if return_type_node is not None else None

        calls = collect_call_names(body_node, source_bytes) if body_node is not None else []

        functions.append(
            {
                "name": func_name,
                "code": func_code,
                "lineno": func_def_node.start_point[0] + 1,
                "end_lineno": func_def_node.end_point[0] + 1,
                "class_name": belonging_class,
                "kind": "method" if belonging_class else "function",
                "docstring": _extract_docstring(body_node, source_bytes),
                "decorators": _extract_decorators(func_def_node, source_bytes),
                "parameters": _extract_parameters(func_def_node, source_bytes),
                "return_type": return_type,
                "calls": unique(calls),
                "is_async": _is_async(func_def_node),
            }
        )

    return {
        "functions": functions,
        "classes": class_records,
        "imports": _extract_imports(root_node, source_bytes),
    }


def extract_python_functions(source_bytes: bytes) -> List[Dict]:
    """Backward-compatible entry point returning only the function list."""
    return extract_python_symbols(source_bytes)["functions"]
