"""Language dispatch for tree-sitter based symbol extraction.

Public API:
    extract_functions(file_path)  -> list[dict]   (backward compatible)
    extract_symbols(file_path)    -> dict         (enriched, includes classes + imports)
"""
from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Union

from .java_extractor import extract_java_functions, extract_java_symbols
from .python_extractor import extract_python_functions, extract_python_symbols
from .typescript_extractor import extract_typescript_functions, extract_typescript_symbols


_FUNC_DISPATCH = {
    ".py": extract_python_functions,
    ".java": extract_java_functions,
    ".ts": extract_typescript_functions,
}

_SYMBOL_DISPATCH = {
    ".py": extract_python_symbols,
    ".java": extract_java_symbols,
    ".ts": extract_typescript_symbols,
}


def _read_source(file_path: Union[str, Path]) -> bytes:
    path = Path(file_path)
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read().encode("utf-8")
    except Exception as e:  # pragma: no cover - defensive I/O
        print(f"Error reading {path}: {e}")
        return b""


def extract_functions(file_path: Union[str, Path]) -> List[Dict]:
    path = Path(file_path)
    ext = path.suffix.lower()
    handler = _FUNC_DISPATCH.get(ext)
    if handler is None:
        return []
    source_bytes = _read_source(path)
    if not source_bytes:
        return []
    return handler(source_bytes)


def extract_symbols(file_path: Union[str, Path]) -> Dict[str, list]:
    """Return ``{"functions": [...], "classes": [...], "imports": [...]}``.

    For unsupported file types, returns empty lists.
    """
    path = Path(file_path)
    ext = path.suffix.lower()
    handler = _SYMBOL_DISPATCH.get(ext)
    if handler is None:
        return {"functions": [], "classes": [], "imports": []}
    source_bytes = _read_source(path)
    if not source_bytes:
        return {"functions": [], "classes": [], "imports": []}
    return handler(source_bytes)


__all__ = ["extract_functions", "extract_symbols"]
