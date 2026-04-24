"""TypeScript code symbol extractor (tree-sitter based).

Extends the previous output (``name``/``code``/``lineno``/``end_lineno``/
``class_name``/optional ``docstring``) with parameters, return type,
modifiers, callee names, ``is_async``, and class bases.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional

from tree_sitter_language_pack import get_parser

from ._ts_utils import (
    collect_call_names,
    find_child_by_field,
    node_text,
    strip_common_indent,
    unique,
)


_PARSER = get_parser("typescript")
_LANGUAGE = _PARSER.language


_CLASS_QUERY = _LANGUAGE.query(
    """
    (class_declaration
      name: (_) @class.name
      body: (class_body) @class.body) @class.def
    """
)

_FUNC_QUERY_SRC = """
    (function_declaration
      name: (identifier) @func.name
      body: (statement_block) @func.body) @func.def

    (method_definition
      name: (property_identifier) @func.name
      body: (statement_block) @func.body) @func.def

    (method_definition
      name: (private_property_identifier) @func.name
      body: (statement_block) @func.body) @func.def
    """


_JSDOC_PATTERN = re.compile(r"/\*\*([\s\S]*?)\*/", re.MULTILINE)


def _attach_closest_jsdoc(func_start_byte: int, jsdocs) -> Optional[str]:
    closest = None
    for start, end, text in reversed(jsdocs):
        if end <= func_start_byte:
            closest = text
            break
    if not closest:
        return None
    stripped = re.sub(r"^\s*\*\s?", "", closest[3:-2], flags=re.MULTILINE)
    return strip_common_indent(stripped)


def _extract_parameters(def_node, source_bytes: bytes) -> List[Dict[str, Optional[str]]]:
    params_node = find_child_by_field(def_node, "parameters")
    if params_node is None:
        return []
    results: List[Dict[str, Optional[str]]] = []
    for child in params_node.children:
        if child.type in ("(", ")", ","):
            continue
        if not child.is_named:
            continue
        # required_parameter / optional_parameter
        name_node = find_child_by_field(child, "pattern") or find_child_by_field(child, "name")
        type_node = find_child_by_field(child, "type")
        value_node = find_child_by_field(child, "value")
        name = node_text(name_node, source_bytes) if name_node is not None else node_text(child, source_bytes)
        type_text: Optional[str] = None
        if type_node is not None:
            type_text = node_text(type_node, source_bytes).lstrip(":").strip() or None
        default = node_text(value_node, source_bytes) if value_node is not None else None
        if name:
            results.append({"name": name, "type": type_text, "default": default})
    return results


def _extract_modifiers(def_node, source_bytes: bytes) -> List[str]:
    mods: List[str] = []
    for child in def_node.children:
        if child.type in (
            "accessibility_modifier",
            "static",
            "abstract",
            "override_modifier",
            "readonly",
            "async",
        ):
            text = node_text(child, source_bytes).strip()
            if text:
                mods.append(text)
    return mods


def _is_async(def_node, source_bytes: bytes) -> bool:
    for child in def_node.children:
        if child.type == "async":
            return True
        if not child.is_named and node_text(child, source_bytes).strip() == "async":
            return True
    return False


def _extract_class_bases(class_def_node, source_bytes: bytes) -> List[str]:
    bases: List[str] = []
    heritage = None
    for child in class_def_node.children:
        if child.type == "class_heritage":
            heritage = child
            break
    if heritage is None:
        return bases
    for child in heritage.children:
        if child.type in ("extends_clause", "implements_clause"):
            for sub in child.children:
                if sub.is_named:
                    bases.append(node_text(sub, source_bytes))
    return unique(bases)


def _extract_imports(root_node, source_bytes: bytes) -> List[str]:
    imports: List[str] = []
    for child in root_node.children:
        if child.type == "import_statement":
            imports.append(node_text(child, source_bytes).strip())
    return imports


def _build_class_ranges(root_node, source_bytes):
    class_ranges: Dict[str, Dict] = {}
    class_records: List[Dict] = []
    try:
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
                }
            )
    except Exception as e:
        print(f"[TS extractor] class query error: {e}")
    return class_ranges, class_records


def extract_typescript_symbols(source_bytes: bytes) -> Dict[str, list]:
    tree = _PARSER.parse(source_bytes)
    root_node = tree.root_node

    class_ranges, class_records = _build_class_ranges(root_node, source_bytes)

    source_text = source_bytes.decode("utf-8", errors="replace")
    jsdocs = [(m.start(), m.end(), m.group(0)) for m in _JSDOC_PATTERN.finditer(source_text)]

    try:
        func_query = _LANGUAGE.query(_FUNC_QUERY_SRC)
        func_matches = func_query.matches(root_node)
    except Exception as e:
        print(f"[TS extractor] function query error: {e}")
        return {"functions": [], "classes": class_records, "imports": _extract_imports(root_node, source_bytes)}

    functions: List[Dict] = []
    for _, cap in func_matches:
        def_nodes = cap.get("func.def", [])
        body_nodes = cap.get("func.body", [])
        if not def_nodes:
            continue
        func_def_node = def_nodes[0]
        body_node = body_nodes[0] if body_nodes else find_child_by_field(func_def_node, "body")

        name_nodes = cap.get("func.name", [])
        if not name_nodes:
            func_name = "<anonymous>"
        else:
            func_name = node_text(name_nodes[0], source_bytes)

        func_code = node_text(func_def_node, source_bytes)
        start_pt = func_def_node.start_point
        belonging_class = None
        for class_name, rng in class_ranges.items():
            if rng["start"][0] <= start_pt[0] <= rng["end"][0]:
                belonging_class = class_name
                break

        return_type_node = find_child_by_field(func_def_node, "return_type")
        return_type: Optional[str] = None
        if return_type_node is not None:
            return_type = node_text(return_type_node, source_bytes).lstrip(":").strip() or None

        calls = collect_call_names(body_node, source_bytes) if body_node is not None else []

        item: Dict = {
            "name": func_name,
            "function_name": func_name,  # UI backward-compat
            "code": func_code,
            "lineno": func_def_node.start_point[0] + 1,
            "end_lineno": func_def_node.end_point[0] + 1,
            "class_name": belonging_class,
            "kind": "method" if belonging_class else "function",
            "parameters": _extract_parameters(func_def_node, source_bytes),
            "return_type": return_type,
            "modifiers": _extract_modifiers(func_def_node, source_bytes),
            "calls": unique(calls),
            "is_async": _is_async(func_def_node, source_bytes),
        }
        docstring = _attach_closest_jsdoc(func_def_node.start_byte, jsdocs)
        if docstring:
            item["docstring"] = docstring
        functions.append(item)

    return {
        "functions": functions,
        "classes": class_records,
        "imports": _extract_imports(root_node, source_bytes),
    }


def extract_typescript_functions(source_bytes: bytes) -> List[Dict]:
    """Backward-compatible entry point."""
    return extract_typescript_symbols(source_bytes)["functions"]
