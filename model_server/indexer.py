import faiss
import numpy as np
from model import encode_code

class CodeIndexer:
    def __init__(self, dim: int = 768):
        self.index = faiss.IndexFlatIP(dim)
        self.metadata = []

    def add_functions(self, functions: list[dict]):
        codes = [f["code"] for f in functions]
        embeddings = encode_code(codes)
        self.index.add(embeddings)
        self.metadata.extend(functions)

    def search(self, query_code: str, top_k=5):
        query_vec = encode_code([query_code])
        D, I = self.index.search(query_vec, top_k)
        return [self.metadata[i] for i in I[0]]
