"""Hybrid (lexical + semantic) retrieval utilities.

Combines a BM25 lexical index over function bodies with the existing
FAISS semantic index via Reciprocal Rank Fusion (RRF). The BM25 side is
deliberately lightweight (pure Python via ``rank_bm25``) so it can live
alongside the embedding index without extra infra.
"""

from __future__ import annotations

import re
from typing import Iterable, List, Optional, Sequence, Tuple

try:
    from rank_bm25 import BM25Okapi
except ImportError:  # pragma: no cover - optional dep
    BM25Okapi = None  # type: ignore[assignment]


_TOKEN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_CAMEL_RE = re.compile(r"(?<!^)(?=[A-Z])")


def tokenize(text: str) -> List[str]:
    """Identifier-aware tokenizer.

    Splits on non-word chars, then splits camelCase and snake_case so that
    ``parseJsonConfig`` and ``parse_json_config`` both match ``json``.
    Tokens are lowercased; stopword-free (BM25 handles IDF).
    """
    if not text:
        return []
    tokens: List[str] = []
    for raw in _TOKEN_RE.findall(text):
        tokens.append(raw.lower())
        # snake_case parts
        for part in raw.split("_"):
            if not part:
                continue
            lowered = part.lower()
            if lowered != raw.lower():
                tokens.append(lowered)
            # camelCase parts
            for sub in _CAMEL_RE.split(part):
                sub_lower = sub.lower()
                if sub_lower and sub_lower != lowered:
                    tokens.append(sub_lower)
    return tokens


def _document_text(func: dict) -> str:
    parts = [
        str(func.get("name") or func.get("function_name") or ""),
        str(func.get("class_name") or ""),
        str(func.get("docstring") or ""),
        str(func.get("code") or ""),
    ]
    params = func.get("parameters") or []
    if isinstance(params, (list, tuple)):
        parts.append(" ".join(str(p) for p in params))
    calls = func.get("calls") or []
    if isinstance(calls, (list, tuple)):
        parts.append(" ".join(str(c) for c in calls))
    return " \n ".join(parts)


class BM25Index:
    """Thin wrapper around ``BM25Okapi`` for a list of function dicts."""

    def __init__(self, functions: Sequence[dict]):
        if BM25Okapi is None:
            raise RuntimeError(
                "rank-bm25 is not installed. Add 'rank-bm25' to requirements "
                "or run: pip install rank-bm25"
            )
        self._corpus_tokens: List[List[str]] = [tokenize(_document_text(f)) for f in functions]
        # BM25Okapi chokes on an empty corpus; guard with a sentinel token.
        safe_corpus = [toks if toks else ["__empty__"] for toks in self._corpus_tokens]
        self._bm25 = BM25Okapi(safe_corpus)
        self._size = len(functions)

    def __len__(self) -> int:
        return self._size

    def search(self, query: str, top_k: int) -> List[Tuple[int, float]]:
        if self._size == 0:
            return []
        q_tokens = tokenize(query)
        if not q_tokens:
            return []
        scores = self._bm25.get_scores(q_tokens)
        # Argsort descending, then filter zero-score hits
        order = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
        out: List[Tuple[int, float]] = []
        for idx in order[: max(top_k, 0)]:
            if scores[idx] <= 0.0:
                break
            out.append((idx, float(scores[idx])))
        return out


def rrf_fuse(
    rankings: Iterable[Sequence[int]],
    top_k: int,
    k: int = 60,
) -> List[Tuple[int, float]]:
    """Reciprocal Rank Fusion.

    ``rankings`` is an iterable of ranked-id lists (best first). Returns
    the top-``top_k`` ids with fused scores, best first.
    """
    scores: dict[int, float] = {}
    for ranking in rankings:
        for rank, idx in enumerate(ranking):
            if idx < 0:
                continue
            scores[idx] = scores.get(idx, 0.0) + 1.0 / (k + rank + 1)
    fused = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    return fused[: max(top_k, 0)]


def bm25_signature(functions: Optional[Sequence[dict]]) -> Optional[Tuple[int, int]]:
    """Cheap identity+length fingerprint to decide whether to rebuild BM25."""
    if functions is None:
        return None
    return (id(functions), len(functions))
