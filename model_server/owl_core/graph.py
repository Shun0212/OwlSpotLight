"""Call-graph construction over extracted functions.

Uses the ``calls`` field populated by the tree-sitter extractors to build
caller/callee adjacency maps. Name resolution is intentionally loose –
tree-sitter cannot do full type resolution, but matching on unqualified
identifiers and ``Class.method`` suffixes is good enough to power
"related functions" navigation in the UI.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


def _short_name(call: str) -> str:
    if not call:
        return ""
    # Strip generics/args e.g. "foo<T>" → "foo"
    base = call.split("<", 1)[0]
    # Use the tail of a dotted call as the method/function name
    return base.rstrip(")").split(".")[-1]


def build_call_graph(functions: Sequence[dict]) -> Dict[str, Any]:
    """Build caller/callee adjacency.

    Returns a dict with keys:
      - ``callees[i]``: list of indices called by function ``i``
      - ``callers[i]``: list of indices that call function ``i``
      - ``by_name[name]``: list of indices with that (short) name

    Name resolution ignores self-edges and deduplicates.
    """
    by_name: Dict[str, List[int]] = {}
    by_qualified: Dict[str, List[int]] = {}
    for idx, fn in enumerate(functions):
        name = str(fn.get("name") or fn.get("function_name") or "").strip()
        if not name:
            continue
        by_name.setdefault(name, []).append(idx)
        cls = fn.get("class_name")
        if cls:
            by_qualified.setdefault(f"{cls}.{name}", []).append(idx)

    callees: Dict[int, List[int]] = {i: [] for i in range(len(functions))}
    callers: Dict[int, List[int]] = {i: [] for i in range(len(functions))}

    for idx, fn in enumerate(functions):
        calls = fn.get("calls") or []
        if not isinstance(calls, (list, tuple)):
            continue
        seen: set[int] = set()
        for raw in calls:
            target = str(raw or "").strip()
            if not target:
                continue
            matches: Iterable[int]
            if target in by_qualified:
                matches = by_qualified[target]
            else:
                short = _short_name(target)
                matches = by_name.get(short, [])
            for m in matches:
                if m == idx or m in seen:
                    continue
                seen.add(m)
                callees[idx].append(m)
                callers[m].append(idx)

    return {
        "callees": callees,
        "callers": callers,
        "by_name": by_name,
        "by_qualified": by_qualified,
    }


def resolve_target(
    functions: Sequence[dict],
    *,
    file: Optional[str] = None,
    lineno: Optional[int] = None,
    name: Optional[str] = None,
    class_name: Optional[str] = None,
) -> Optional[int]:
    """Locate a function index by (file,lineno) or (name[,class_name]).

    When ``lineno`` is given, returns the function whose range most
    tightly contains that line. Falls back to name-based matching.
    """
    import os

    file_norm = os.path.abspath(file) if file else None

    best_idx: Optional[int] = None
    best_span = float("inf")
    if file_norm and lineno is not None:
        for idx, fn in enumerate(functions):
            fpath = fn.get("file")
            if not fpath:
                continue
            if os.path.abspath(fpath) != file_norm:
                continue
            start = fn.get("lineno")
            end = fn.get("end_lineno") or start
            if start is None:
                continue
            if start <= lineno <= (end or start):
                span = (end or start) - start
                if span < best_span:
                    best_idx = idx
                    best_span = span
        if best_idx is not None:
            return best_idx

    if name:
        for idx, fn in enumerate(functions):
            if str(fn.get("name") or fn.get("function_name") or "") != name:
                continue
            if class_name and fn.get("class_name") != class_name:
                continue
            if file_norm and fn.get("file") and os.path.abspath(fn["file"]) != file_norm:
                continue
            return idx
    return None


def graph_signature(functions: Optional[Sequence[dict]]) -> Optional[Tuple[int, int]]:
    if functions is None:
        return None
    return (id(functions), len(functions))
