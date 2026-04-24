"""Java code symbol extractor (tree-sitter based).

Extends the legacy output (``name``/``code``/``lineno``/``end_lineno``/
``class_name``) with Javadoc, annotations, modifiers, parameters, return
type, and callee names.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional

import tree_sitter_java
from tree_sitter import Language, Parser

from ._ts_utils import (
    collect_call_names,
    find_child_by_field,
    node_text,
    strip_common_indent,
    unique,
)


_JAVA_LANGUAGE = Language(tree_sitter_java.language())
_JAVA_PARSER = Parser(_JAVA_LANGUAGE)


_CLASS_QUERY = _JAVA_LANGUAGE.query(
    """
    (class_declaration
      name: (identifier) @class.name
      body: (class_body) @class.body) @class.def
    """
)

_METHOD_QUERY = _JAVA_LANGUAGE.query(
    """
    (method_declaration
      name: (identifier) @func.name
      body: (block) @func.body) @func.def
    """
)


_JAVADOC_PATTERN = re.compile(r"/\*\*([\s\S]*?)\*/", re.MULTILINE)


def _extract_annotations_and_modifiers(def_node, source_bytes: bytes):
    annotations: List[str] = []
    modifiers: List[str] = []
    modifiers_node = None
    for child in def_node.children:
        if child.type == "modifiers":
            modifiers_node = child
            break
    if modifiers_node is None:
        return annotations, modifiers
    for child in modifiers_node.children:
        t = child.type
        if t in ("marker_annotation", "annotation"):
            annotations.append(node_text(child, source_bytes).lstrip("@").strip())
        elif child.is_named:
            modifiers.append(node_text(child, source_bytes))
        else:
            text = node_text(child, source_bytes).strip()
            if text:
                modifiers.append(text)
    return annotations, modifiers


def _extract_parameters(def_node, source_bytes: bytes) -> List[Dict[str, Optional[str]]]:
    params_node = find_child_by_field(def_node, "parameters")
    if params_node is None:
        return []
    results: List[Dict[str, Optional[str]]] = []
    for child in params_node.children:
        if child.type not in ("formal_parameter", "spread_parameter"):
            continue
        name_node = find_child_by_field(child, "name")
        type_node = find_child_by_field(child, "type")
        name = node_text(name_node, source_bytes) if name_node is not None else None
        type_text = node_text(type_node, source_bytes) if type_node is not None else None
        if name:
            results.append({"name": name, "type": type_text, "default": None})
    return results


def _extract_throws(def_node, source_bytes: bytes) -> List[str]:
    throws: List[str] = []
    for child in def_node.children:
        if child.type == "throws":
            for sub in child.children:
                if sub.is_named:
                    throws.append(node_text(sub, source_bytes))
    return throws


def _extract_class_bases(class_def_node, source_bytes: bytes) -> List[str]:
    bases: List[str] = []
    superclass = find_child_by_field(class_def_node, "superclass")
    if superclass is not None:
        bases.append(node_text(superclass, source_bytes).replace("extends", "").strip())
    interfaces = find_child_by_field(class_def_node, "interfaces")
    if interfaces is not None:
        for sub in interfaces.children:
            if sub.is_named:
                bases.append(node_text(sub, source_bytes))
    return [b for b in (b.strip() for b in bases) if b]


def _extract_imports(root_node, source_bytes: bytes) -> List[str]:
    imports: List[str] = []
    for child in root_node.children:
        if child.type == "import_declaration":
            imports.append(node_text(child, source_bytes).strip())
    return imports


def _attach_closest_javadoc(func_start_byte: int, jsdocs) -> Optional[str]:
    closest = None
    for start, end, text in reversed(jsdocs):
        if end <= func_start_byte:
            closest = text
            break
    if not closest:
        return None
    stripped = re.sub(r"^\s*\*\s?", "", closest[3:-2], flags=re.MULTILINE)
    return strip_common_indent(stripped)


def extract_java_symbols(source_bytes: bytes) -> Dict[str, list]:
    tree = _JAVA_PARSER.parse(source_bytes)
    root_node = tree.root_node
    source_text = source_bytes.decode("utf-8", errors="replace")
    jsdocs = [(m.start(), m.end(), m.group(0)) for m in _JAVADOC_PATTERN.finditer(source_text)]

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
        annotations, modifiers = _extract_annotations_and_modifiers(class_def_node, source_bytes)
        class_records.append(
            {
                "name": class_name,
                "lineno": class_def_node.start_point[0] + 1,
                "end_lineno": class_def_node.end_point[0] + 1,
                "bases": _extract_class_bases(class_def_node, source_bytes),
                "annotations": annotations,
                "modifiers": modifiers,
            }
        )

    functions: List[Dict] = []
    for _, cap in _METHOD_QUERY.matches(root_node):
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
        belonging_class = None
        for class_name, rng in class_ranges.items():
            if rng["start"][0] <= start_pt[0] <= rng["end"][0]:
                belonging_class = class_name
                break

        annotations, modifiers = _extract_annotations_and_modifiers(func_def_node, source_bytes)
        return_type_node = find_child_by_field(func_def_node, "type")
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
                "docstring": _attach_closest_javadoc(func_def_node.start_byte, jsdocs),
                "annotations": annotations,
                "modifiers": modifiers,
                "parameters": _extract_parameters(func_def_node, source_bytes),
                "return_type": return_type,
                "throws": _extract_throws(func_def_node, source_bytes),
                "calls": unique(calls),
                "is_async": False,
            }
        )

    return {
        "functions": functions,
        "classes": class_records,
        "imports": _extract_imports(root_node, source_bytes),
    }


def extract_java_functions(source_bytes: bytes) -> List[Dict]:
    """Backward-compatible entry point."""
    return extract_java_symbols(source_bytes)["functions"]
