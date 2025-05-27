from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import torch
from threading import Lock
import os
from typing import List, Dict, Optional

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

class IndexStatus(BaseModel):
    directory: str
    indexed_files: List[str]
    last_indexed: float
    up_to_date: bool

class BuildIndexRequest(BaseModel):
    directory: str
    file_ext: str = ".py"

# サーバー全体で1つのインデックスを保持
global_indexer = None
index_lock = Lock()

# インデックス情報を保持するクラス
class GlobalIndexerState:
    def __init__(self):
        self.indexer: Optional[CodeIndexer] = None
        self.file_mtimes: Dict[str, float] = {}
        self.directory: Optional[str] = None
        self.last_indexed: float = 0.0

    def is_up_to_date(self) -> bool:
        if not self.directory:
            return False
        for path, old_mtime in self.file_mtimes.items():
            if not os.path.exists(path) or os.path.getmtime(path) != old_mtime:
                return False
        return True

global_index_state = GlobalIndexerState()

# ディレクトリ内の全ファイルから関数抽出・インデックス作成
def build_index(directory: str, file_ext: str = ".py"):
    functions = []
    file_mtimes = {}
    for root, _, files in os.walk(directory):
        for fname in files:
            if fname.endswith(file_ext):
                fpath = os.path.join(root, fname)
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        code = f.read()
                    funcs = extract_functions(code)
                    for func in funcs:
                        func["file"] = fpath
                    functions.extend(funcs)
                    file_mtimes[fpath] = os.path.getmtime(fpath)
                except Exception:
                    continue
    indexer = CodeIndexer()
    indexer.add_functions(functions)
    global_index_state.indexer = indexer
    global_index_state.file_mtimes = file_mtimes
    global_index_state.directory = directory
    global_index_state.last_indexed = float(os.times().elapsed)
    return functions

@app.post("/embed")
async def embed(req: EmbedRequest):
    embeddings = model.encode(req.texts, convert_to_numpy=True).tolist()
    return {"embeddings": embeddings}

@app.post("/index_and_search")
async def index_and_search(req: IndexAndSearchRequest):
    global global_indexer
    with index_lock:
        if global_indexer is None:
            # 初回のみインデックス作成
            functions = extract_functions(req.source_code)
            if not functions:
                return {"results": []}
            global_indexer = CodeIndexer()
            global_indexer.add_functions(functions)
        # 既存インデックスで検索
        results = global_indexer.search(req.query_code, top_k=req.top_k)
    return {"results": results}

@app.post("/build_index")
async def build_index_api(req: BuildIndexRequest):
    with index_lock:
        functions = build_index(req.directory, req.file_ext)
    return {"num_functions": len(functions), "indexed_files": list(global_index_state.file_mtimes.keys())}

@app.get("/index_status")
async def index_status():
    up_to_date = global_index_state.is_up_to_date()
    return IndexStatus(
        directory=global_index_state.directory or "",
        indexed_files=list(global_index_state.file_mtimes.keys()),
        last_indexed=global_index_state.last_indexed,
        up_to_date=up_to_date
    )

@app.post("/search")
async def search_api(query: str, top_k: int = 5):
    with index_lock:
        if not global_index_state.indexer:
            return {"results": [], "error": "No index built."}
        results = global_index_state.indexer.search(query, top_k=top_k)
    return {"results": results}
