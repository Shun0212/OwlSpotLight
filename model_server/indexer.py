import faiss
import numpy as np
from model import encode_code, get_model_embedding_dim

class CodeIndexer:
    def __init__(self, dim: int | None = None):
        """Simple wrapper around a FAISS index with optional embedding cache."""

        # Dynamically determine embedding dimension from the model if not provided
        if dim is None:
            dim = get_model_embedding_dim()
        self.index = faiss.IndexFlatIP(dim)
        self.metadata: list[dict] = []
        self.functions: list[dict] = []  # 関数リスト
        self.code2emb: dict[str, np.ndarray] = {}   # コード文字列→埋め込みベクトル

    def add_functions(self, functions: list[dict], embeddings: np.ndarray | None = None):
        """Add functions to the index.

        If ``embeddings`` is provided, it is used directly. Otherwise the
        embeddings are generated on demand via :func:`encode_code`.
        """

        # 空のリストが渡された場合は何もしない
        if not functions:
            return

        codes = [f["code"] for f in functions]

        if embeddings is not None:
            if len(embeddings) != len(functions):
                raise ValueError("Embeddings length must match number of functions")
            for c, e in zip(codes, embeddings):
                self.code2emb[c] = e
            embeddings_to_add = embeddings
        else:
            new_codes = [c for c in codes if c not in self.code2emb]
            if new_codes:
                print(f"🔄 Encoding {len(new_codes)} new code snippets...")
                new_embs = encode_code(new_codes, show_progress=True)
                for c, e in zip(new_codes, new_embs):
                    self.code2emb[c] = e
            embeddings_to_add = np.stack([self.code2emb[c] for c in codes])

        self.index.add(embeddings_to_add)
        self.metadata.extend(functions)
        self.functions.extend(functions)

    def search(self, query_code: str, top_k=5):
        query_vec = encode_code([query_code], show_progress=False)
        D, I = self.index.search(query_vec, top_k)
        return [self.metadata[i] for i in I[0]]
