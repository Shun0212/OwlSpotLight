"""BM25, literal matching and local NightOwl embeddings over diff-only documents."""
from __future__ import annotations

from collections import Counter, OrderedDict
import hashlib
import math
import re
import unicodedata

from gitdiff import SearchError


def tokenize(text: str) -> list[str]:
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", text)
    text = unicodedata.normalize("NFKC", text).casefold().replace("_", " ")
    tokens = re.findall(r"[a-z0-9]+|[\u3040-\u30ff\u3400-\u9fff]+", text)
    result = []
    for token in tokens:
        if re.search(r"[\u3040-\u9fff]", token):
            result.extend(token[i:i+2] for i in range(max(1, len(token)-1)))
        else:
            result.append(token)
    return result


def bm25_scores(texts: list[str], query: str) -> dict[int, float]:
    words = list(dict.fromkeys(tokenize(query)))
    documents = [Counter(tokenize(t)) for t in texts]
    lengths = [sum(doc.values()) for doc in documents]
    average = sum(lengths) / max(1, len(lengths))
    if not average or not words:
        return {}
    frequencies = Counter(word for document in documents for word in document)
    result = {}
    for index, document in enumerate(documents):
        score = 0.0
        for word in words:
            frequency = document.get(word, 0)
            if not frequency:
                continue
            idf = math.log(1 + (len(documents) - frequencies[word] + 0.5) / (frequencies[word] + 0.5))
            score += idf * frequency * 2.5 / (frequency + 1.5 * (0.25 + 0.75 * lengths[index] / average))
        if score:
            result[index] = score
    return result


def split_text(text: str, size: int = 4000, overlap: int = 400) -> list[str]:
    if len(text) <= size:
        return [text]
    pieces = []
    start = 0
    while start < len(text):
        end = min(len(text), start + size)
        if end < len(text):
            newline = text.rfind("\n", start + size // 2, end)
            if newline > start:
                end = newline
        pieces.append(text[start:end])
        if end == len(text):
            break
        start = max(start + 1, end - overlap)
    return pieces


class DenseRanker:
    def __init__(self):
        self.cache = OrderedDict()

    def warmup(self):
        try:
            from model import get_model
            return get_model()
        except ImportError as error:
            raise SearchError("自然言語検索には「検索エンジンを準備」を実行してください。Keyword / BM25 はモデルなしで使えます。") from error
        except Exception as error:
            raise SearchError(f"NightOwl モデルを読み込めませんでした: {error}") from error

    def score(self, texts: list[str], query: str, progress) -> dict[int, float]:
        self.warmup()
        from model import encode_code
        import numpy as np
        parts = [split_text(text) for text in texts]
        count = sum(len(p) for p in parts)
        if count > 3000:
            raise SearchError("埋め込み対象が大きすぎます。比較範囲か対象ファイルを絞ってください。")
        missing = OrderedDict()
        keys = []
        for pieces in parts:
            unit_keys = []
            for text in pieces:
                key = hashlib.sha256(text.encode("utf-8")).hexdigest()
                unit_keys.append(key)
                if key not in self.cache:
                    missing[key] = text
            keys.append(unit_keys)
        entries = list(missing.items())
        for offset in range(0, len(entries), 2):
            progress(f"差分を埋め込み中: {offset}/{len(entries)}")
            batch = entries[offset:offset+2]
            embeddings = encode_code([item[1] for item in batch], batch_size=2,
                                     show_progress=False, input_type="document")
            for (key, _), vector in zip(batch, embeddings):
                self.cache[key] = vector
        progress("検索文を埋め込み中")
        query_vector = encode_code([query], batch_size=1, show_progress=False, input_type="query")[0]
        scores = {
            index: max(float(np.dot(self.cache[key], query_vector)) for key in unit_keys)
            for index, unit_keys in enumerate(keys)
        }
        # Bound memory only after all vectors used by the current search have been read.
        while len(self.cache) > 4096:
            self.cache.popitem(last=False)
        return scores


def rank_units(units: list[dict], query: str, mode: str, dense: DenseRanker, progress=lambda text: None):
    if mode not in {"keyword", "bm25", "semantic", "hybrid"}:
        raise SearchError("検索モードが不正です。")
    if not query.strip():
        return [(index, 0.0, None, None) for index in range(len(units))]
    texts = [unit["text"] for unit in units]
    lexical_texts = [unit["text"] + "\n" + unit.get("subject", "") for unit in units]
    if mode == "keyword":
        terms = query.casefold().split()
        return [(i, 1.0, None, None) for i, text in enumerate(lexical_texts)
                if all(term in text.casefold() for term in terms)]
    lexical = bm25_scores(lexical_texts, query) if mode in {"bm25", "hybrid"} else {}
    maximum = max(lexical.values(), default=1.0)
    semantic = dense.score(texts, query, progress) if mode in {"semantic", "hybrid"} and units else {}
    indices = set(semantic) | set(lexical)
    ranked = []
    for index in indices:
        lex = lexical.get(index, 0.0) / maximum
        sem = (max(-1.0, min(1.0, semantic.get(index, -1.0))) + 1.0) / 2.0
        score = lex if mode == "bm25" else sem if mode == "semantic" else 0.6 * sem + 0.4 * lex
        ranked.append((index, score, semantic.get(index), lexical.get(index)))
    return sorted(ranked, key=lambda item: (-item[1], item[0]))
