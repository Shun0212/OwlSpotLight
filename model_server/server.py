from fastapi import FastAPI, HTTPException
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
import sys
from functools import partial
from pathlib import Path
import json
import hashlib

OWL_INDEX_DIR = ".owl_index"

from extractor import extract_functions
from indexer import CodeIndexer
from cluster_index import ClusterIndex

app = FastAPI()

# モデルロード
model = SentenceTransformer("Shuu12121/CodeSearch-ModernBERT-Owl-2.0-Plus")
model_device = None  # 現在のデバイスを記録

def get_device_and_prepare():
    global model_device
    device = get_device()
    if model_device != device:
        model.to(device)
        model_device = device
    return device

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

class FunctionRangeRequest(BaseModel):
    file: str
    func_name: str

# クラス統計表示用のリクエストモデル
class ClassStatsRequest(BaseModel):
    directory: str
    query: str  # 検索クエリ
    top_k: int = 50  # 上位何件の関数を取得するか

# サーバー全体で1つのインデックスを保持
index_lock = Lock()
global_indexer = None

# インデックス情報を保持するクラス
class GlobalIndexerState:
    def __init__(self):
        self.indexer: Optional[CodeIndexer] = None
        self.file_info: Dict[str, Dict[str, float | str]] = {}  # mtimeとhashを保持
        self.directory: Optional[str] = None
        self.last_indexed: float = 0.0
        self.file_ext: str = ".py"
        self.embeddings: Optional[np.ndarray] = None  # 追加: 関数埋め込み
        self.faiss_index: Optional[faiss.IndexFlatL2] = None  # 追加: FAISSインデックス
        self.index_dir = None  # ディレクトリごとに動的に設定

    def set_index_dir(self, directory: str):
        safe_dir = os.path.basename(os.path.abspath(directory))
        self.index_dir = os.path.join(os.getcwd(), OWL_INDEX_DIR, safe_dir)
        # ディレクトリの作成は保存時のみ行う（startup時は作成しない）

    def is_up_to_date(self, tol: float = 1e-3, directory: Optional[str] = None) -> bool:
        # directory引数が指定された場合はそれとself.directoryを比較
        if directory is not None:
            if os.path.abspath(directory) != os.path.abspath(self.directory or ""):
                print(f"[is_up_to_date] directory mismatch: {directory} != {self.directory}")
                return False
        if not self.directory:
            print("[is_up_to_date] self.directory is None")
            return False
        for path, info in self.file_info.items():
            if not os.path.exists(path):
                print(f"[is_up_to_date] file missing: {path}")
                return False
            mtime = os.path.getmtime(path)
            hash_now = file_hash(path)
            if abs(mtime - info["mtime"]) > tol or hash_now != info["hash"]:
                print(f"[is_up_to_date] file changed: {path}")
                return False
        return True

    def clear_cache(self):
        """メモリキャッシュをクリアして強制的に再構築を促す"""
        self.indexer = None
        self.embeddings = None
        self.faiss_index = None
        self.file_info = {}
        self.directory = None
        self.last_indexed = 0.0

    def force_rebuild_from_disk(self, directory: str):
        """ディスクから強制的にインデックスを再構築"""
        self.clear_cache()
        self.load(directory)

    def save(self):
        if not self.index_dir:
            return
        os.makedirs(self.index_dir, exist_ok=True)
        # 関数リスト
        if self.indexer:
            with open(os.path.join(self.index_dir, "functions.json"), "w", encoding="utf-8") as f:
                json.dump(self.indexer.functions, f, ensure_ascii=False)
        # 埋め込み
        if self.embeddings is not None:
            np.save(os.path.join(self.index_dir, "embeddings.npy"), self.embeddings)
        # faiss
        if self.faiss_index is not None:
            faiss.write_index(self.faiss_index, os.path.join(self.index_dir, "faiss.index"))
        # その他メタ
        meta = {
            "file_info": self.file_info,
            "directory": os.path.abspath(self.directory) if self.directory else None,
            "last_indexed": self.last_indexed,
            "file_ext": self.file_ext
        }
        with open(os.path.join(self.index_dir, "meta.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False)

    def load(self, directory: str):
        directory = os.path.abspath(directory)
        self.set_index_dir(directory)
        
        # インデックスディレクトリが存在しない場合は何もしない（メモリキャッシュ優先）
        if not os.path.exists(self.index_dir):
            self.indexer = None
            self.embeddings = None
            self.faiss_index = None
            self.file_info = {}
            self.directory = None
            self.last_indexed = 0.0
            self.file_ext = ".py"
            return
            
        try:
            with open(os.path.join(self.index_dir, "functions.json"), "r", encoding="utf-8") as f:
                functions = json.load(f)
            self.indexer = CodeIndexer()
            self.indexer.add_functions(functions)
        except Exception:
            self.indexer = None
        try:
            self.embeddings = np.load(os.path.join(self.index_dir, "embeddings.npy"))
        except Exception:
            self.embeddings = None
        try:
            self.faiss_index = faiss.read_index(os.path.join(self.index_dir, "faiss.index"))
        except Exception:
            self.faiss_index = None
        try:
            with open(os.path.join(self.index_dir, "meta.json"), "r", encoding="utf-8") as f:
                meta = json.load(f)
            self.file_info = meta.get("file_info", {})
            self.directory = os.path.abspath(meta.get("directory", directory))
            self.last_indexed = meta.get("last_indexed", 0.0)
            self.file_ext = meta.get("file_ext", ".py")
        except Exception:
            self.file_info = {}
            self.directory = None
            self.last_indexed = 0.0
            self.file_ext = ".py"

global_index_state = GlobalIndexerState()
# サーバー起動時は自動ロードを行わない（メモリキャッシュ優先、必要時のみディスクアクセス）

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
def build_index(directory: str, file_ext: str = ".py", max_workers: int = 8, update_state: bool = False):
    import hashlib
    def func_id(func):
        # ファイルパス・関数名・lineno・end_linenoを組み合わせて一意なIDを生成
        key = f"{func.get('file','')}|{func.get('name','')}|{func.get('lineno','')}|{func.get('end_lineno','')}"
        return hashlib.sha256(key.encode()).hexdigest()

    directory = os.path.abspath(directory)
    
    # メモリキャッシュが有効で、同じディレクトリで最新なら、ディスクアクセスをスキップ
    if (global_index_state.indexer is not None and 
        global_index_state.directory == directory and 
        global_index_state.file_ext == file_ext and
        global_index_state.is_up_to_date(directory=directory)):
        print(f"[build_index] メモリキャッシュが最新、ディスクアクセスをスキップ (funcs={len(global_index_state.indexer.functions)}, files={len(global_index_state.file_info)})")
        return (global_index_state.indexer.functions, 
                len(global_index_state.file_info), 
                global_index_state.indexer)
    
    # 必要な時のみディスクからロード
    global_index_state.load(directory)
    global_index_state.set_index_dir(directory)
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

    # 差分インデックス用: 既存情報
    prev_info = dict(global_index_state.file_info) if update_state else {}
    prev_indexer = global_index_state.indexer if update_state else None
    prev_funcs_by_file = {}
    if prev_indexer:
        for func in prev_indexer.functions:
            prev_funcs_by_file.setdefault(func.get("file"), []).append(func)

    # 追加・変更・削除ファイルを判定（mtimeとhash両方で判定）
    new_info = {f: {"mtime": os.path.getmtime(f), "hash": file_hash(f)} for f in file_paths}
    added_or_modified = [f for f in file_paths if f not in prev_info or prev_info[f]["hash"] != new_info[f]["hash"]]
    unchanged = [f for f in file_paths if f in prev_info and prev_info[f]["hash"] == new_info[f]["hash"]]
    deleted = [f for f in prev_info if f not in new_info]

    # 変更・削除ゼロなら何もしないで戻る（キャッシュ再利用）
    if update_state and not added_or_modified and not deleted:
        print("[build_index] up-to-date ⇒ cache reuse")
        return (
            global_index_state.indexer.functions,
            len(global_index_state.file_info),
            global_index_state.indexer,
        )

    # 追加・変更ファイルのみ再抽出
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
    for f in unchanged:
        results.extend(prev_funcs_by_file.get(f, []))
    added_modified_funcs = []
    if added_or_modified:
        if len(added_or_modified) < 16:
            for fpath in tqdm(added_or_modified, desc="Indexing (serial, diff)", disable=False, file=sys.stdout):
                added_modified_funcs.extend(process_file(fpath))
        else:
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                for res in tqdm(executor.map(process_file, added_or_modified), total=len(added_or_modified), desc="Indexing (parallel, diff)", disable=False, file=sys.stdout):
                    added_modified_funcs.extend(res)
        results.extend(added_modified_funcs)

    # --- 差分高速化: 削除ファイルがあっても全再エンコードを避ける ---
    if update_state:
        # 1. 既存関数IDリスト
        prev_funcs = prev_indexer.functions if prev_indexer else []
        prev_func_ids = [func_id(f) for f in prev_funcs]
        prev_func_id2idx = {fid: i for i, fid in enumerate(prev_func_ids)}
        # 2. 削除ファイルに含まれる関数ID
        deleted_func_ids = set()
        for f in deleted:
            for func in prev_funcs_by_file.get(f, []):
                deleted_func_ids.add(func_id(func))
        # 3. 変更のない関数ID
        unchanged_func_ids = [func_id(f) for f in results]
        # 4. 追加・変更分の関数ID
        added_func_ids = [func_id(f) for f in added_modified_funcs]
        # 5. 新しい全関数リスト
        new_funcs = results
        # 6. 新しい全関数IDリスト
        new_func_ids = unchanged_func_ids + added_func_ids
        # 7. 埋め込みの再構築
        if prev_indexer and global_index_state.embeddings is not None and global_index_state.faiss_index is not None:
            # 既存埋め込みから削除分を除外
            prev_embeddings = global_index_state.embeddings
            keep_indices = [prev_func_id2idx[fid] for fid in unchanged_func_ids if fid in prev_func_id2idx]
            kept_embeddings = prev_embeddings[keep_indices] if keep_indices else np.zeros((0, prev_embeddings.shape[1]), dtype=prev_embeddings.dtype)
            # 追加・変更分の埋め込み
            if added_modified_funcs:
                get_device_and_prepare()
                encode = partial(model.encode, show_progress_bar=True)
                new_codes = [func["code"] for func in added_modified_funcs]
                new_embeddings = encode(new_codes, batch_size=32, convert_to_numpy=True)
                embeddings = np.vstack([kept_embeddings, new_embeddings]) if kept_embeddings.shape[0] > 0 else new_embeddings
            else:
                embeddings = kept_embeddings
            # FAISSインデックス再構築
            if embeddings is not None and embeddings.shape[0] > 0:
                faiss_index = faiss.IndexFlatL2(embeddings.shape[1])
                faiss_index.add(embeddings)
            else:
                faiss_index = None
                embeddings = None
            global_index_state.embeddings = embeddings
            global_index_state.faiss_index = faiss_index
        else:
            # 初回 or キャッシュなし: 全件エンコード
            codes = [func["code"] for func in new_funcs]
            if codes:
                get_device_and_prepare()
                encode = partial(model.encode, show_progress_bar=True)
                embeddings = encode(codes, batch_size=32, convert_to_numpy=True)
                faiss_index = faiss.IndexFlatL2(embeddings.shape[1])
                faiss_index.add(embeddings)
                global_index_state.embeddings = embeddings
                global_index_state.faiss_index = faiss_index
            else:
                global_index_state.embeddings = None
                global_index_state.faiss_index = None
        # インデックス・メタ情報更新
        indexer = CodeIndexer()
        indexer.add_functions(new_funcs)
        global_index_state.indexer = indexer
        global_index_state.directory = os.path.abspath(directory)
        global_index_state.file_ext = file_ext
        global_index_state.last_indexed = float(__import__('time').time())
        global_index_state.file_info = new_info
        global_index_state.save()
    else:
        indexer = CodeIndexer()
        indexer.add_functions(results)
    return results, len(file_paths), indexer

@app.post("/embed")
async def embed(req: EmbedRequest):
    print("/embed called")
    get_device_and_prepare()
    embeddings = model.encode(req.texts, convert_to_numpy=True).tolist()
    return {"embeddings": embeddings}

@app.post("/index_and_search")
async def index_and_search(req: IndexAndSearchRequest):
    print("/index_and_search called")
    get_device_and_prepare()
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
    print(f"/build_index called for directory: {req.directory}")
    with index_lock:
        results, file_count, _ = build_index(req.directory, req.file_ext, update_state=True)
    return {"num_functions": len(results), "num_files": file_count}

@app.post("/force_rebuild_index")
async def force_rebuild_index_api(req: BuildIndexRequest):
    """キャッシュをクリアして強制的にインデックスを再構築"""
    print(f"/force_rebuild_index called for directory: {req.directory}")
    with index_lock:
        global_index_state.clear_cache()
        results, file_count, _ = build_index(req.directory, req.file_ext, update_state=True)
    return {"num_functions": len(results), "num_files": file_count, "message": "Index forcefully rebuilt"}

@app.get("/index_status")
async def index_status():
    print("/index_status called")
    up_to_date = global_index_state.is_up_to_date()
    return IndexStatus(
        directory=global_index_state.directory or "",
        indexed_files=list(global_index_state.file_info.keys()),
        last_indexed=global_index_state.last_indexed,
        up_to_date=up_to_date
    )

@app.post("/search")
async def search_api(query: str, top_k: int = 5):
    print(f"/search called with query: {query}")
    get_device_and_prepare()
    with index_lock:
        if not global_index_state.indexer:
            return {"results": [], "error": "No index built."}
        results = global_index_state.indexer.search(query, top_k=top_k)
    return {"results": results}

# --- クラスタ分割・ClusterManager利用の雛形 ---
# グローバルでクラスタマネージャを保持（本実装ではリクエストごとに再構築せずキャッシュ推奨）
global_cluster_manager = None

def get_or_create_cluster_manager(directory: str, file_ext: str = ".py"):
    global global_cluster_manager
    if global_cluster_manager is None or global_cluster_manager.base_dir != directory:
        global_cluster_manager = ClusterManager(directory, file_ext)
    return global_cluster_manager

@app.post("/search_functions")
async def search_functions_api(directory: str, query: str, top_k: int = 5):
    # クラスタ分割・検索の雛形
    cluster_manager = get_or_create_cluster_manager(directory)
    # まず全クラスタのcentroidを計算し、クエリに近いクラスタを選ぶ（ここでは全クラスタ検索の雛形）
    found = []
    for cluster in cluster_manager.get_all_clusters():
        # centroidや部分検索は後続で実装、ここでは全件検索の雛形
        if cluster.index is not None:
            get_device_and_prepare()
            query_emb = model.encode([query], convert_to_numpy=True)
            results = cluster.search(query_emb, top_k)
            found.extend(results)
    # top_k件だけ返す（スコア順ソートは後続で実装）
    return {"results": found[:top_k], "num_clusters": len(cluster_manager.cluster_indexes)}

def build_index_and_search(directory: str, query: str, file_ext: str = ".py", top_k: int = 5, max_workers: int = 8):
    # メモリキャッシュが有効で最新なら、ディスクアクセスをスキップ
    if (
        global_index_state.indexer is not None and
        global_index_state.directory == directory and
        global_index_state.file_ext == file_ext and
        global_index_state.is_up_to_date(directory=directory) and
        global_index_state.embeddings is not None and
        global_index_state.faiss_index is not None
    ):
        results = global_index_state.indexer.functions
        embeddings = global_index_state.embeddings
        faiss_index = global_index_state.faiss_index
        file_count = len(global_index_state.file_info)
    else:
        results, file_count, indexer = build_index(directory, file_ext, max_workers, update_state=True)
        embeddings = global_index_state.embeddings
        faiss_index = global_index_state.faiss_index
    if not results or embeddings is None or faiss_index is None:
        return {"results": [], "message": "No functions found."}
    get_device_and_prepare()
    query_emb = model.encode([query], convert_to_numpy=True)
    D, I = faiss_index.search(query_emb, top_k)
    found = []
    for idx in I[0]:
        if 0 <= idx < len(results):
            found.append(results[idx])
    return {"results": found, "num_functions": len(results), "num_files": file_count}

@app.post("/search_functions_simple")
async def search_functions_simple_api(req: SearchFunctionsSimpleRequest):
    print("indexer_exists:", global_index_state.indexer is not None)
    print("up_to_date:", global_index_state.is_up_to_date())
    print("embeddings_cached:", global_index_state.embeddings is not None)
    print("file_ext:", global_index_state.file_ext)
    with index_lock:
        # メモリキャッシュが有効で最新なら、ディスクアクセスをスキップ
        if (
            global_index_state.indexer is not None and
            global_index_state.directory == req.directory and
            global_index_state.file_ext == ".py" and
            global_index_state.is_up_to_date(directory=req.directory) and
            global_index_state.embeddings is not None and
            global_index_state.faiss_index is not None
        ):
            print("[search_functions_simple] メモリキャッシュを使用")
            results = global_index_state.indexer.functions
            embeddings = global_index_state.embeddings
            faiss_index = global_index_state.faiss_index
            file_count = len(global_index_state.file_info)
        else:
            print("[search_functions_simple] インデックス再構築")
            results, file_count, indexer = build_index(req.directory, ".py", update_state=True)
            embeddings = global_index_state.embeddings
            faiss_index = global_index_state.faiss_index
        if not results or embeddings is None or faiss_index is None:
            return {"results": [], "message": "No functions found."}
        get_device_and_prepare()
        query_emb = model.encode([req.query], convert_to_numpy=True)
        D, I = faiss_index.search(query_emb, req.top_k)
        found = []
        for idx in I[0]:
            if 0 <= idx < len(results):
                found.append(results[idx])
        return {"results": found, "num_functions": len(results), "num_files": file_count}

@app.post("/get_function_range")
async def get_function_range(req: FunctionRangeRequest):
    """
    指定ファイル・関数名に該当する関数の開始・終了行番号を返すAPI
    """
    try:
        funcs = extract_functions(req.file)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"extract_functions error: {e}")
    for func in funcs:
        if func.get("name") == req.func_name:
            return {
                "start_line": func.get("lineno"),
                "end_line": func.get("end_lineno")
            }
    raise HTTPException(status_code=404, detail="Function not found")

@app.post("/get_class_stats")
async def get_class_stats(request: ClassStatsRequest):
    try:
        # まず検索を実行して検索結果を取得
        search_request = SearchFunctionsSimpleRequest(
            directory=request.directory, 
            query=request.query, 
            top_k=request.top_k
        )
        search_response = await search_functions_simple_api(search_request)
        search_results = search_response["results"]
        
        # 全ての関数を抽出
        all_functions = []
        directory = request.directory
        ignore_spec = load_gitignore_spec(directory)
        
        files = []
        for root, dirs, filenames in os.walk(directory):
            # .gitignoreのパターンでディレクトリをフィルタ
            dirs[:] = [d for d in dirs if not is_ignored(os.path.join(root, d), ignore_spec, directory)]
            
            for filename in filenames:
                if filename.endswith('.py'):
                    file_path = os.path.join(root, filename)
                    if not is_ignored(file_path, ignore_spec, directory):
                        files.append(file_path)
        
        for file_path in files:
            try:
                functions = extract_functions(file_path)
                for func in functions:
                    func['file_path'] = file_path
                    all_functions.append(func)
            except Exception as e:
                print(f"Error processing {file_path}: {e}")
                continue
        
        # クラス別にグループ化（ファイルごとに管理）
        classes = {}
        standalone_functions = []
        
        for func in all_functions:
            if func.get("class_name"):
                class_name = func["class_name"]
                file_path = func.get("file_path", func.get("file", ""))
                class_key = (class_name, file_path)
                if class_key not in classes:
                    classes[class_key] = {
                        "name": class_name,
                        "file_path": file_path,
                        "methods": [],
                        "method_count": 0
                    }
                classes[class_key]["methods"].append(func)
                classes[class_key]["method_count"] += 1
            else:
                standalone_functions.append(func)
        
        print(f"Found {len(classes)} classes and {len(standalone_functions)} standalone functions")
        for class_key, class_info in classes.items():
            print(f"Class {class_info['name']} in {class_info['file_path']}: {class_info['method_count']} methods")
        
        # 検索結果ベースの重み付けスコア計算
        for class_key, class_info in classes.items():
            search_result_ranks = []
            matched_methods = set()
            for i, result in enumerate(search_results):
                result_func_name = result["name"]
                result_file = result.get("file", "")
                result_lineno = result.get("lineno", result.get("line_number", 0))
                
                # ファイルパスを正規化して比較
                result_file_abs = os.path.abspath(result_file) if result_file else ""
                
                for method in class_info["methods"]:
                    method_file = method.get("file_path", method.get("file", ""))
                    method_file_abs = os.path.abspath(method_file) if method_file else ""
                    method_lineno = method.get("lineno", method.get("line_number", 0))
                    method_key = (method["name"], method_file_abs, method_lineno)
                    
                    if (method["name"] == result_func_name and 
                        method_file_abs == result_file_abs and
                        method_lineno == result_lineno and
                        method_key not in matched_methods):
                        search_result_ranks.append(i + 1)
                        matched_methods.add(method_key)
                        print(f"Matched method {method['name']} in class {class_info['name']} at rank {i + 1}")
                        break
            if search_result_ranks:
                sum_inverse_ranks = sum(1.0 / rank for rank in search_result_ranks)
                weighted_score = sum_inverse_ranks
                best_rank = min(search_result_ranks)  # 最高順位（最小のランク値）
            else:
                weighted_score = 0.0
                best_rank = None
            
            proportion = len(search_result_ranks) / class_info["method_count"] if class_info["method_count"] > 0 else 0
            
            # 複合スコア: weighted_score * (1 + proportion_bonus)
            # proportion_bonusは割合に基づくボーナス（0.0～1.0の範囲で最大100%のボーナス）
            proportion_bonus = proportion * 1.0  # 100%ヒットなら100%ボーナス
            composite_score = (weighted_score * (1 + proportion_bonus))/2
            
            class_info["weighted_score"] = weighted_score
            class_info["search_hits"] = len(search_result_ranks)
            class_info["all_ranks"] = search_result_ranks
            class_info["best_rank"] = best_rank
            class_info["proportion"] = proportion
            class_info["composite_score"] = composite_score
        
        sorted_classes = sorted(classes.values(), key=lambda x: x["composite_score"], reverse=True)
        
        # --- ここから standalone_functions をランキング順にソート ---
        # 検索結果の (name, file_path, lineno) で一致するものを先頭に並べる
        def func_key(func):
            name = func.get("name")
            file_path = os.path.abspath(func.get("file_path", func.get("file", "")))
            lineno = func.get("lineno", func.get("line_number", 0))
            return (name, file_path, lineno)
        # 検索結果のキー順リスト
        search_func_keys = [
            (r["name"], os.path.abspath(r.get("file", "")), r.get("lineno", r.get("line_number", 0)))
            for r in search_results
        ]
        # standalone_functions を検索結果の順に並べる
        func_key_to_func = {func_key(f): f for f in standalone_functions}
        sorted_funcs = []
        used_keys = set()
        for k in search_func_keys:
            if k in func_key_to_func and k not in used_keys:
                sorted_funcs.append(func_key_to_func[k])
                used_keys.add(k)
        # 残り（検索結果に出てこないもの）
        for f in standalone_functions:
            k = func_key(f)
            if k not in used_keys:
                sorted_funcs.append(f)
        standalone_functions = sorted_funcs
        # --- ここまで追加 ---
        
        return {
            "classes": sorted_classes,
            "standalone_functions": standalone_functions,
            "total_classes": len(classes),
            "total_standalone_functions": len(standalone_functions),
            "search_query": request.query,
            "search_results_count": len(search_results),
            "scoring_method": "composite_score",
            "scoring_description": "Classes (per file) ranked by composite score: weighted_score × (1 + proportion_bonus). This combines ranking quality (∑(1/rank)) with hit proportion to favor classes with both high-ranking methods and good coverage."
        }
    except Exception as e:
        print(f"Error getting class stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))

def get_device():
    # Apple Silicon (M1/M2/M3) などで mps が使える場合は mps を優先
    if torch.backends.mps.is_available() and torch.backends.mps.is_built():
        return "mps"
    elif torch.cuda.is_available():
        return "cuda"
    else:
        return "cpu"

# ファイルのハッシュ計算関数

def file_hash(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(8192)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()

# ディレクトリ単位でクラスタ分割
# 例: src/ → cluster_src, tests/ → cluster_tests

def get_clusters_for_directory(directory: str, file_ext: str = ".py"):
    clusters = {}
    for root, dirs, files in os.walk(directory):
        rel_root = os.path.relpath(root, directory)
        if rel_root == ".":
            cluster_name = "root"
        else:
            cluster_name = rel_root.replace(os.sep, "_")
        cluster_files = [os.path.join(root, f) for f in files if f.endswith(file_ext)]
        if cluster_files:
            clusters[cluster_name] = cluster_files
    return clusters

# クラスタごとに .owl_index/cluster_xxx/ を作成

def get_cluster_index_path(base_dir: str, cluster_name: str) -> str:
    return os.path.join(base_dir, OWL_INDEX_DIR, f"cluster_{cluster_name}")

# クラスタ一覧を管理
class ClusterManager:
    def __init__(self, base_dir: str, file_ext: str = ".py"):
        self.base_dir = base_dir
        self.file_ext = file_ext
        self.clusters = get_clusters_for_directory(base_dir, file_ext)
        self.cluster_indexes = {}
        for cname in self.clusters:
            cpath = get_cluster_index_path(base_dir, cname)
            # ディレクトリは作成せず、必要時に作成
            self.cluster_indexes[cname] = ClusterIndex(cname, Path(cpath))

    def get_cluster_for_file(self, file_path: str) -> str:
        rel = os.path.relpath(file_path, self.base_dir)
        parts = rel.split(os.sep)
        if len(parts) == 1:
            return "root"
        return parts[0]

    def get_all_clusters(self):
        return self.cluster_indexes.values()

    def rebuild_changed_clusters(self):
        # 変更があったディレクトリ（クラスタ）は問答無用で再構築
        for cname, files in self.clusters.items():
            cluster = self.cluster_indexes[cname]
            # 関数抽出
            funcs = []
            for f in files:
                try:
                    funcs.extend(extract_functions(f))
                except Exception as e:
                    print(f"[ClusterManager] extract error: {f}: {e}")
            # 埋め込み生成
            codes = [func["code"] for func in funcs]
            if codes:
                get_device_and_prepare()
                encode = partial(model.encode, show_progress_bar=True)
                embeddings = encode(codes, batch_size=32, convert_to_numpy=True)
                # FAISSインデックス再構築
                faiss_index = faiss.IndexFlatL2(embeddings.shape[1])
                faiss_index.add(embeddings)
                cluster.meta = funcs
                cluster.index = faiss_index
                cluster.save()
            else:
                # ファイルが空ならインデックス削除
                cluster.meta = []
                cluster.index = None
                cluster.save()

    def rebuild_clusters_with_diff(self, changed_dirs: set, added_files: set):
        # 追加ファイルは差分追加、変更ディレクトリは問答無用で再構築
        for cname, files in self.clusters.items():
            cluster = self.cluster_indexes[cname]
            cluster_dir = os.path.join(self.base_dir, *(cname.split('_'))) if cname != 'root' else self.base_dir
            if cluster_dir in changed_dirs:
                # ディレクトリごと再構築
                funcs = []
                for f in files:
                    try:
                        funcs.extend(extract_functions(f))
                    except Exception as e:
                        print(f"[ClusterManager] extract error: {f}: {e}")
                codes = [func["code"] for func in funcs]
                if codes:
                    get_device_and_prepare()
                    encode = partial(model.encode, show_progress_bar=True)
                    embeddings = encode(codes, batch_size=32, convert_to_numpy=True)
                    faiss_index = faiss.IndexFlatL2(embeddings.shape[1])
                    faiss_index.add(embeddings)
                    cluster.meta = funcs
                    cluster.index = faiss_index
                    cluster.save()
                else:
                    cluster.meta = []
                    cluster.index = None
                    cluster.save()
            else:
                # 追加ファイルのみ差分追加
                add_funcs = []
                add_files = [f for f in files if f in added_files]
                for f in add_files:
                    try:
                        add_funcs.extend(extract_functions(f))
                    except Exception as e:
                        print(f"[ClusterManager] extract error: {f}: {e}")
                if add_funcs:
                    codes = [func["code"] for func in add_funcs]
                    get_device_and_prepare()
                    encode = partial(model.encode, show_progress_bar=True)
                    embeddings = encode(codes, batch_size=32, convert_to_numpy=True)
                    if cluster.index is None and len(embeddings) > 0:
                        faiss_index = faiss.IndexFlatL2(embeddings.shape[1])
                        faiss_index.add(embeddings)
                        cluster.index = faiss_index
                        cluster.meta = add_funcs
                    else:
                        cluster.index.add(embeddings)
                        cluster.meta.extend(add_funcs)
                    cluster.save()
