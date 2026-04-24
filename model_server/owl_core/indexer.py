import faiss
import numpy as np
from .model import encode_code, get_model_embedding_dim

class CodeIndexer:
    def __init__(self, dim: int = None):
        # Dynamically determine embedding dimension from the model if not provided
        if dim is None:
            dim = get_model_embedding_dim()
        self.index = faiss.IndexFlatIP(dim)
        self.metadata = []
        self.functions = []  # 関数リスト
        self.code2emb = {}   # コード文字列→埋め込みベクトル

    def add_functions(self, functions: list[dict]):
        # 空のリストが渡された場合は何もしない
        if not functions:
            return
            
        codes = [f["code"] for f in functions]
        new_codes = [c for c in codes if c not in self.code2emb]
        if new_codes:
            print(f"🔄 Encoding {len(new_codes)} new code snippets...")
            new_embs = encode_code(new_codes, show_progress=True)
            for c, e in zip(new_codes, new_embs):
                self.code2emb[c] = e
        embeddings = np.stack([self.code2emb[c] for c in codes])
        self.index.add(embeddings)
        self.metadata.extend(functions)
        self.functions.extend(functions)

    def search(self, query_code: str, top_k=5):
        query_vec = encode_code([query_code], show_progress=False)
        D, I = self.index.search(query_vec, top_k)
        return [self.metadata[i] for i in I[0]]

    def add_functions_without_embedding(self, functions: list[dict]):
        """
        埋め込み計算を行わずに関数リストのみを追加する
        ディスクからロード時など、既に埋め込みが存在する場合に使用
        """
        if not functions:
            return
        self.functions.extend(functions)
        self.metadata.extend(functions)
