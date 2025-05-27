from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import torch

from extractor import extract_functions
from indexer import CodeIndexer

app = FastAPI()

# モデルロード
model = SentenceTransformer("Shuu12121/CodeSearch-ModernBERT-Owl-2.0-Plus")

# ✅ リクエスト用の Pydantic モデル
class EmbedRequest(BaseModel):
    texts: list[str]

class IndexAndSearchRequest(BaseModel):
    source_code: str
    query_code: str
    top_k: int = 5

# ✅ POSTエンドポイントに型指定を追加
@app.post("/embed")
async def embed(req: EmbedRequest):
    embeddings = model.encode(req.texts, convert_to_numpy=True).tolist()
    return {"embeddings": embeddings}

@app.post("/index_and_search")
async def index_and_search(req: IndexAndSearchRequest):
    # 1. 関数抽出
    functions = extract_functions(req.source_code)
    if not functions:
        return {"results": []}
    # 2. インデックス作成
    indexer = CodeIndexer()
    indexer.add_functions(functions)
    # 3. クエリで検索
    results = indexer.search(req.query_code, top_k=req.top_k)
    return {"results": results}
