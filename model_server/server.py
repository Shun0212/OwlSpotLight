from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import torch
from threading import Lock
import os
from typing import List, Dict, Optional
from concurrent.futures import ThreadPoolExecutor
import pathlib
from tqdm import tqdm
import faiss
import numpy as np
from pathspec import PathSpec
from pathspec.patterns import GitWildMatchPattern

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

class SearchFunctionsSimpleRequest(BaseModel):
    directory: str
    query: str
    top_k: int = 5

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

def load_gitignore_spec(root_dir: str) -> Optional[PathSpec]:
    """
    指定ディレクトリ直下の .gitignore を読み込み、Git のワイルドカード仕様
    をそのまま解釈できる PathSpec を返す。存在しなければ None。
    """
    gi_path = os.path.join(root_dir, ".gitignore")
    if not os.path.exists(gi_path):
        return None
    with open(gi_path, encoding="utf-8") as f:
        lines = [ln.rstrip("\n") for ln in f if ln.strip() and not ln.startswith("#")]
    return PathSpec.from_lines(GitWildMatchPattern, lines)

def is_ignored(path: str, spec: Optional[PathSpec], root_dir: str) -> bool:
    if spec is None:
        return False
    rel_path = os.path.relpath(path, root_dir)
    return spec.match_file(rel_path)

# ディレクトリ内の全ファイルから関数抽出・インデックス作成（一時的なインデックス、状態保存なし）
def build_index(directory: str, file_ext: str = ".py", max_workers: int = 8):
    spec = load_gitignore_spec(directory)
    file_paths = []
    for root, dirs, files in os.walk(directory):
        # --- ディレクトリをフィルタリング ---
        dirs[:] = [d for d in dirs if not is_ignored(os.path.join(root, d), spec, directory)]
        # --- ファイルを収集 ---
        for fname in files:
            if not fname.endswith(file_ext):
                continue
            fpath = os.path.join(root, fname)
            if is_ignored(fpath, spec, directory):
                continue
            file_paths.append(fpath)

    def process_file(fpath):
        try:
            funcs = extract_functions(fpath)
            for func in funcs:
                func["file"] = fpath
            return funcs
        except Exception as e:
            print(f"⚠️ {fpath}: {e}")
            return []

    results = []
    if len(file_paths) < 16:
        # ファイル数が少なければ直列で十分
        for fpath in tqdm(file_paths, desc="Indexing (serial)"):
            results.extend(process_file(fpath))
    else:
        # 多い場合は並列
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            for res in tqdm(executor.map(process_file, file_paths), total=len(file_paths), desc="Indexing (parallel)"):
                results.extend(res)

    indexer = CodeIndexer()
    indexer.add_functions(results)
    print(f"[build_index] {len(file_paths)} files scanned, {len(results)} functions indexed.")
    return results, len(file_paths), indexer

@app.post("/embed")
async def embed(req: EmbedRequest):
    print("/embed called")
    device = get_device()
    embeddings = model.encode(req.texts, convert_to_numpy=True, device=device).tolist()
    return {"embeddings": embeddings}

@app.post("/index_and_search")
async def index_and_search(req: IndexAndSearchRequest):
    print("/index_and_search called")
    global global_indexer
    device = get_device()
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
    print(f"/build_index called for directory: {req.directory}")
    results, file_count, _ = build_index(req.directory, req.file_ext)
    return {"num_functions": len(results), "num_files": file_count}

@app.get("/index_status")
async def index_status():
    print("/index_status called")
    up_to_date = global_index_state.is_up_to_date()
    return IndexStatus(
        directory=global_index_state.directory or "",
        indexed_files=list(global_index_state.file_mtimes.keys()),
        last_indexed=global_index_state.last_indexed,
        up_to_date=up_to_date
    )

@app.post("/search")
async def search_api(query: str, top_k: int = 5):
    print(f"/search called with query: {query}")
    device = get_device()
    with index_lock:
        if not global_index_state.indexer:
            return {"results": [], "error": "No index built."}
        results = global_index_state.indexer.search(query, top_k=top_k)
    return {"results": results}

@app.post("/search_functions")
async def search_functions_api(directory: str, query: str, top_k: int = 5):
    # 1. 関数抽出・埋め込み・インデックス作成（毎回一時的に実行）
    results, file_count, indexer = build_index(directory)
    if not results:
        return {"results": [], "message": "No functions found."}
    # 2. クエリの埋め込み
    query_emb = model.encode([query], device=get_device())
    import numpy as np
    D, I = indexer.index.search(np.array(query_emb).astype('float32'), top_k)
    # 3. 検索結果を整形
    found = []
    for idx in I[0]:
        if 0 <= idx < len(results):
            found.append(results[idx])
    return {"results": found, "num_functions": len(results), "num_files": file_count}

def build_index_and_search(directory: str, query: str, file_ext: str = ".py", top_k: int = 5, max_workers: int = 8):
    spec = load_gitignore_spec(directory)
    file_paths = []
    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if not is_ignored(os.path.join(root, d), spec, directory)]
        for fname in files:
            if not fname.endswith(file_ext):
                continue
            fpath = os.path.join(root, fname)
            if is_ignored(fpath, spec, directory):
                continue
            file_paths.append(fpath)

    def process_file(fpath):
        try:
            funcs = extract_functions(fpath)
            for func in funcs:
                func["file"] = fpath
            return funcs
        except Exception as e:
            print(f"⚠️ {fpath}: {e}")
            return []

    results = []
    if len(file_paths) < 16:
        for fpath in tqdm(file_paths, desc="Indexing (serial)"):
            results.extend(process_file(fpath))
    else:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            for res in tqdm(executor.map(process_file, file_paths), total=len(file_paths), desc="Indexing (parallel)"):
                results.extend(res)

    if not results:
        return {"results": [], "message": "No functions found."}

    device = get_device()
    print(device)
    model.to(device)
    codes = [func["code"] for func in results]
    embeddings = model.encode(codes, batch_size=1, show_progress_bar=True, device=device)
    query_emb = model.encode([query], device=device)
    index = faiss.IndexFlatL2(embeddings.shape[1])
    index.add(np.array(embeddings).astype('float32'))
    D, I = index.search(np.array(query_emb).astype('float32'), top_k)
    found = []
    for idx in I[0]:
        if 0 <= idx < len(results):
            found.append(results[idx])
    return {"results": found, "num_functions": len(results), "num_files": len(file_paths)}

@app.post("/search_functions_simple")
async def search_functions_simple_api(req: SearchFunctionsSimpleRequest):
    """
    指定ディレクトリ内の関数を抽出・埋め込み・FAISSで検索し、該当関数リストを返すシンプルなAPI
    """
    return build_index_and_search(req.directory, req.query, top_k=req.top_k)

def get_device():
    # Apple Silicon (M1/M2/M3) などで mps が使える場合は mps を優先
    if torch.backends.mps.is_available() and torch.backends.mps.is_built():
        return "mps"
    elif torch.cuda.is_available():
        return "cuda"
    else:
        return "cpu"
