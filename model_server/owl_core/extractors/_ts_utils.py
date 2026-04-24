"""Shared tree-sitter helpers used by per-language extractors.

Keeps the extractors compact and consistent. All helpers work on tree-sitter
``Node`` objects + the original ``source_bytes``; none of them load grammars.
"""
from __future__ import annotations

from typing import Iterable, List, Optional


def node_text(node, source_bytes: bytes) -> str:
    return source_bytes[node.start_byte:node.end_byte].decode("utf-8", errors="replace")


def find_child_by_field(node, field_name: str):
    """Return the first child accessible via ``child_by_field_name``."""
    try:
        return node.child_by_field_name(field_name)
    except Exception:
        return None


def iter_descendants(node):
    """Depth-first iteration over descendants (excluding ``node`` itself)."""
    stack = list(reversed(node.children)) if node.children else []
    while stack:
        current = stack.pop()
        yield current
        if current.children:
            stack.extend(reversed(current.children))


def collect_call_names(body_node, source_bytes: bytes) -> List[str]:
    """Collect the textual names of call targets inside ``body_node``.

    We don't resolve bindings — just return identifiers/attribute paths used in
    call position. This is intentionally cheap and language-agnostic; each
    language extractor adapts the node-type check to its grammar.
    """
    seen: dict[str, None] = {}
    for desc in iter_descendants(body_node):
        if desc.type not in ("call", "call_expression", "method_invocation"):
            continue
        target = find_child_by_field(desc, "function") or find_child_by_field(desc, "name")
        if target is None and desc.children:
            target = desc.children[0]
        if target is None:
            continue
        text = node_text(target, source_bytes).strip()
        if not text:
            continue
        # keep only the last path segment for readability, but also keep full form
        if text not in seen:
            seen[text] = None
    return list(seen.keys())


def unique(seq: Iterable[str]) -> List[str]:
    seen: dict[str, None] = {}
    for item in seq:
        if item and item not in seen:
            seen[item] = None
    return list(seen.keys())


def safe_decode(source_bytes: bytes, start: int, end: int) -> str:
    return source_bytes[start:end].decode("utf-8", errors="replace")


def strip_common_indent(text: Optional[str]) -> Optional[str]:
    if text is None:
        return None
    lines = text.splitlines()
    non_empty = [ln for ln in lines if ln.strip()]
    if not non_empty:
        return text.strip() or None
    indent = min(len(ln) - len(ln.lstrip()) for ln in non_empty)
    return "\n".join(ln[indent:] if len(ln) >= indent else ln for ln in lines).strip() or None
