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
from pydantic_settings import BaseSettings

OWL_INDEX_DIR = ".owl_index"

from extractor import extract_functions
from indexer import CodeIndexer
from cluster_index import ClusterIndex
import hashlib
import sys
import os
import time
import torch
import faiss
import numpy as np

app = FastAPI()

# Model loading
model = SentenceTransformer("Shuu12121/CodeSearch-ModernBERT-Owl-2.0-Plus")
model_device = None  # Current device

# === Settings: batch size etc. ===
class OwlSettings(BaseSettings):
    batch_size: int = 32

settings = OwlSettings()

def get_device():
    # Prefer mps if available (Apple Silicon M1/M2/M3), otherwise cuda, otherwise cpu
    if torch.backends.mps.is_available() and torch.backends.mps.is_built():
        return "mps"
    elif torch.cuda.is_available():
        return "cuda"
    else:
        return "cpu"

def get_device_and_prepare():
    global model_device
    device = get_device()
    if model_device != device:
        model.to(device)
        model_device = device
    return device

# ✅ Pydantic models for requests
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

# Request model for class statistics display
class ClassStatsRequest(BaseModel):
    directory: str
    query: str  # Search query
    top_k: int = 50  # Number of top functions to retrieve

# Only one index is held for the entire server
index_lock = Lock()
global_indexer = None

# Class to hold index information
class GlobalIndexerState:
    def __init__(self):
        self.indexer: Optional[CodeIndexer] = None
        self.file_info: Dict[str, Dict[str, float | str]] = {}  # Holds mtime and hash
        self.directory: Optional[str] = None
        self.last_indexed: float = 0.0
        self.file_ext: str = ".py"
        self.embeddings: Optional[np.ndarray] = None  # Function embeddings
        self.faiss_index: Optional[faiss.IndexFlatL2] = None  # FAISS index
        self.index_dir = None  # Set dynamically per directory

    def set_index_dir(self, directory: str):
        safe_dir = os.path.basename(os.path.abspath(directory))
        self.index_dir = os.path.join(os.getcwd(), OWL_INDEX_DIR, safe_dir)
        # Directory creation is only done at save time (not at startup)

    def is_up_to_date(self, tol: float = 1e-3, directory: Optional[str] = None) -> bool:
        # If directory argument is specified, compare with self.directory
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
        """Clear memory cache to force rebuild"""
        self.indexer = None
        self.embeddings = None
        self.faiss_index = None
        self.file_info = {}
        self.directory = None
        self.last_indexed = 0.0

    def force_rebuild_from_disk(self, directory: str):
        """Force rebuild index from disk"""
        self.clear_cache()
        self.load(directory)

    def save(self):
        if not self.index_dir:
            return
        os.makedirs(self.index_dir, exist_ok=True)
        # Function list
        if self.indexer:
            with open(os.path.join(self.index_dir, "functions.json"), "w", encoding="utf-8") as f:
                json.dump(self.indexer.functions, f, ensure_ascii=False)
        # Embeddings
        if self.embeddings is not None:
            np.save(os.path.join(self.index_dir, "embeddings.npy"), self.embeddings)
        # faiss
        if self.faiss_index is not None:
            faiss.write_index(self.faiss_index, os.path.join(self.index_dir, "faiss.index"))
        # Other meta
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
        
        # If index directory does not exist, do nothing (prefer memory cache)
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
# Do not auto-load on server startup (prefer memory cache, only access disk when needed)

def load_gitignore_spec(root_dir: str) -> Optional[PathSpec]:
    """
    Read .gitignore in the specified directory and return a PathSpec that can interpret Git wildcards as is. Returns None if not found.
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

# Extract functions and build index from all files in a directory (temporary index, no state saved)
def build_index(directory: str, file_ext: str = ".py", max_workers: int = 8, update_state: bool = False):
    def func_id(func):
        # Generate a unique ID by combining file path, function name, lineno, and end_lineno
        key = f"{func.get('file','')}|{func.get('name','')}|{func.get('lineno','')}|{func.get('end_lineno','')}"
        return hashlib.sha256(key.encode()).hexdigest()

    directory = os.path.abspath(directory)
    
    # If memory cache is valid and up-to-date for the same directory, skip disk access
    if (global_index_state.indexer is not None and 
        global_index_state.directory == directory and 
        global_index_state.file_ext == file_ext and
        global_index_state.is_up_to_date(directory=directory)):
        print(f"[build_index] Memory cache is up-to-date, skipping disk access (funcs={len(global_index_state.indexer.functions)}, files={len(global_index_state.file_info)})")
        return (global_index_state.indexer.functions, 
                len(global_index_state.file_info), 
                global_index_state.indexer)
    
    # Load from disk only when needed
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

    # For diff index: previous info
    prev_info = dict(global_index_state.file_info) if update_state else {}
    prev_indexer = global_index_state.indexer if update_state else None
    prev_funcs_by_file = {}
    if prev_indexer:
        for func in prev_indexer.functions:
            prev_funcs_by_file.setdefault(func.get("file"), []).append(func)

    # Determine added/modified/deleted files (by mtime and hash)
    new_info = {f: {"mtime": os.path.getmtime(f), "hash": file_hash(f)} for f in file_paths}
    added_or_modified = [f for f in file_paths if f not in prev_info or prev_info[f]["hash"] != new_info[f]["hash"]]
    unchanged = [f for f in file_paths if f in prev_info and prev_info[f]["hash"] == new_info[f]["hash"]]
    deleted = [f for f in prev_info if f not in new_info]

    # If no changes or deletions, reuse cache
    if update_state and not added_or_modified and not deleted:
        print("[build_index] up-to-date ⇒ cache reuse")
        return (
            global_index_state.indexer.functions,
            len(global_index_state.file_info),
            global_index_state.indexer,
        )

    # Re-extract only added/modified files
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

    # --- Diff speedup: avoid full re-encoding even if files are deleted ---
    if update_state:
        # 1. Previous function ID list
        prev_funcs = prev_indexer.functions if prev_indexer else []
        prev_func_ids = [func_id(f) for f in prev_funcs]
        prev_func_id2idx = {fid: i for i, fid in enumerate(prev_func_ids)}
        # 2. Function IDs in deleted files
        deleted_func_ids = set()
        for f in deleted:
            for func in prev_funcs_by_file.get(f, []):
                deleted_func_ids.add(func_id(func))
        # 3. Unchanged function IDs
        unchanged_func_ids = [func_id(f) for f in results]
        # 4. Added/modified function IDs
        added_func_ids = [func_id(f) for f in added_modified_funcs]
        # 5. New all function list
        new_funcs = results
        # 6. New all function ID list
        new_func_ids = unchanged_func_ids + added_func_ids
        # 7. Rebuild embeddings
        if prev_indexer and global_index_state.embeddings is not None and global_index_state.faiss_index is not None:
            # Remove deleted from existing embeddings
            prev_embeddings = global_index_state.embeddings
            keep_indices = [prev_func_id2idx[fid] for fid in unchanged_func_ids if fid in prev_func_id2idx]
            kept_embeddings = prev_embeddings[keep_indices] if keep_indices else np.zeros((0, prev_embeddings.shape[1]), dtype=prev_embeddings.dtype)
            # Embeddings for added/modified
            if added_modified_funcs:
                get_device_and_prepare()
                encode = partial(model.encode, show_progress_bar=True)
                new_codes = [func["code"] for func in added_modified_funcs]
                new_embeddings = encode(new_codes, batch_size=settings.batch_size, convert_to_numpy=True)
                embeddings = np.vstack([kept_embeddings, new_embeddings]) if kept_embeddings.shape[0] > 0 else new_embeddings
            else:
                embeddings = kept_embeddings
            # Rebuild FAISS index
            if embeddings is not None and embeddings.shape[0] > 0:
                faiss_index = faiss.IndexFlatL2(embeddings.shape[1])
                faiss_index.add(embeddings)
            else:
                faiss_index = None
                embeddings = None
            global_index_state.embeddings = embeddings
            global_index_state.faiss_index = faiss_index
        else:
            # First time or no cache: encode all
            codes = [func["code"] for func in new_funcs]
            if codes:
                get_device_and_prepare()
                encode = partial(model.encode, show_progress_bar=True)
                embeddings = encode(codes, batch_size=settings.batch_size, convert_to_numpy=True)
                faiss_index = faiss.IndexFlatL2(embeddings.shape[1])
                faiss_index.add(embeddings)
                global_index_state.embeddings = embeddings
                global_index_state.faiss_index = faiss_index
            else:
                global_index_state.embeddings = None
                global_index_state.faiss_index = None
        # Update index/meta info
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
            # Build index only on first call
            functions = extract_functions(req.source_code)
            if not functions:
                return {"results": []}
            global_indexer = CodeIndexer()
            global_indexer.add_functions(functions)
        # Search with existing index
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
    """Clear cache and forcefully rebuild index"""
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

# --- Cluster split / ClusterManager usage template ---
# Hold cluster manager globally (in real implementation, recommend caching instead of rebuilding per request)
global_cluster_manager = None

def get_or_create_cluster_manager(directory: str, file_ext: str = ".py"):
    global global_cluster_manager
    if global_cluster_manager is None or global_cluster_manager.base_dir != directory:
        global_cluster_manager = ClusterManager(directory, file_ext)
    return global_cluster_manager

@app.post("/search_functions")
async def search_functions_api(directory: str, query: str, top_k: int = 5):
    """Cluster-based search API"""
    with index_lock:
        cluster_manager = get_or_create_cluster_manager(directory)
        # Run diff update
        cluster_manager.update_all_clusters()
        # Run search
        results = cluster_manager.search_in_clusters(query, top_k)
        return {"results": results, "num_clusters": len(cluster_manager.cluster_indexes)}

@app.post("/build_cluster_index")
async def build_cluster_index_api(req: BuildIndexRequest):
    """Build cluster index"""
    print(f"/build_cluster_index called for directory: {req.directory}")
    with index_lock:
        cluster_manager = get_or_create_cluster_manager(req.directory, req.file_ext)
        cluster_manager.update_all_clusters(force_rebuild=True)
        
        # Calculate statistics
        total_functions = 0
        total_files = 0
        for cluster in cluster_manager.cluster_indexes.values():
            total_functions += len(cluster.meta)
            total_files += len(cluster.file_map)
        
        return {
            "num_functions": total_functions,
            "num_files": total_files,
            "num_clusters": len(cluster_manager.cluster_indexes),
            "clusters": list(cluster_manager.cluster_indexes.keys())
        }

@app.post("/update_cluster_index")
async def update_cluster_index_api(req: BuildIndexRequest):
    """Diff update for cluster index"""
    print(f"/update_cluster_index called for directory: {req.directory}")
    with index_lock:
        cluster_manager = get_or_create_cluster_manager(req.directory, req.file_ext)
        cluster_manager.update_all_clusters(force_rebuild=False)
        
        # Calculate statistics
        total_functions = 0
        total_files = 0
        updated_clusters = []
        for cluster_name, cluster in cluster_manager.cluster_indexes.items():
            total_functions += len(cluster.meta)
            total_files += len(cluster.file_map)
            # Record clusters with changes
            files = cluster_manager.clusters.get(cluster_name, [])
            if not cluster.is_up_to_date(files):
                updated_clusters.append(cluster_name)
        
        return {
            "num_functions": total_functions,
            "num_files": total_files,
            "num_clusters": len(cluster_manager.cluster_indexes),
            "updated_clusters": updated_clusters
        }

def build_index_and_search(directory: str, query: str, file_ext: str = ".py", top_k: int = 5, max_workers: int = 8):
    # If memory cache is valid and up-to-date, skip disk access
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
        # If memory cache is valid and up-to-date, skip disk access
        if (
            global_index_state.indexer is not None and
            global_index_state.directory == req.directory and
            global_index_state.file_ext == ".py" and
            global_index_state.is_up_to_date(directory=req.directory) and
            global_index_state.embeddings is not None and
            global_index_state.faiss_index is not None
        ):
            print("[search_functions_simple] Using memory cache")
            results = global_index_state.indexer.functions
            embeddings = global_index_state.embeddings
            faiss_index = global_index_state.faiss_index
            file_count = len(global_index_state.file_info)
        else:
            print("[search_functions_simple] Rebuilding index")
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
    Return the start and end line numbers of the function matching the specified file and function name
    """
    try:
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

    def get_changed_clusters(self) -> Dict[str, tuple[List[str], List[str]]]:
        """各クラスタで変更されたファイルを取得"""
        changed_clusters = {}
        for cluster_name, files in self.clusters.items():
            cluster = self.cluster_indexes[cluster_name]
            added_or_modified, deleted = cluster.get_changed_files(files)
            if added_or_modified or deleted:
                changed_clusters[cluster_name] = (added_or_modified, deleted)
        return changed_clusters

    def update_cluster_incrementally(self, cluster_name: str, added_files: List[str], deleted_files: List[str]):
        """クラスタを差分更新"""
        cluster = self.cluster_indexes[cluster_name]
        
        # 追加・変更ファイルから関数を抽出
        added_funcs = []
        for file_path in added_files:
            try:
                funcs = extract_functions(file_path)
                for func in funcs:
                    func['file'] = file_path
                added_funcs.extend(funcs)
            except Exception as e:
                print(f"[ClusterManager] extract error: {file_path}: {e}")
        
        # 埋め込み生成（追加分のみ）
        embeddings = None
        if added_funcs:
            codes = [func["code"] for func in added_funcs]
            if codes:
                get_device_and_prepare()
                encode = partial(model.encode, show_progress_bar=True)
                embeddings = encode(codes, batch_size=settings.batch_size, convert_to_numpy=True)
        
        # クラスタインデックスを更新
        cluster.update_files(added_funcs, deleted_files, embeddings)
        print(f"[ClusterManager] Updated cluster '{cluster_name}': +{len(added_files)} files, -{len(deleted_files)} files")

    def rebuild_cluster(self, cluster_name: str):
        """クラスタを完全再構築"""
        cluster = self.cluster_indexes[cluster_name]
        files = self.clusters.get(cluster_name, [])
        
        # 関数抽出
        funcs = []
        for f in files:
            try:
                funcs_in_file = extract_functions(f)
                for func in funcs_in_file:
                    func['file'] = f
                funcs.extend(funcs_in_file)
            except Exception as e:
                print(f"[ClusterManager] extract error: {f}: {e}")
        
        # 埋め込み生成
        embeddings = None
        if funcs:
            codes = [func["code"] for func in funcs]
            if codes:
                get_device_and_prepare()
                encode = partial(model.encode, show_progress_bar=True)
                embeddings = encode(codes, batch_size=settings.batch_size, convert_to_numpy=True)
        
        # インデックス再構築
        cluster.rebuild_from_functions(funcs, embeddings)
        print(f"[ClusterManager] Rebuilt cluster '{cluster_name}': {len(funcs)} functions from {len(files)} files")

    def update_all_clusters(self, force_rebuild: bool = False):
        """全クラスタを更新（差分または完全再構築）"""
        if force_rebuild:
            for cluster_name in self.clusters:
                self.rebuild_cluster(cluster_name)
        else:
            changed_clusters = self.get_changed_clusters()
            for cluster_name, (added_files, deleted_files) in changed_clusters.items():
                if deleted_files:
                    # 削除があった場合は完全再構築
                    print(f"[ClusterManager] Files deleted in cluster '{cluster_name}', rebuilding...")
                    self.rebuild_cluster(cluster_name)
                else:
                    # 追加のみの場合は差分更新
                    self.update_cluster_incrementally(cluster_name, added_files, deleted_files)

    def search_in_clusters(self, query: str, top_k: int = 5) -> List[Dict]:
        """全クラスタで検索を実行"""
        get_device_and_prepare()
        query_emb = model.encode([query], convert_to_numpy=True)
        
        all_results = []
        for cluster in self.cluster_indexes.values():
            results = cluster.search(query_emb, top_k)
            all_results.extend(results)
        
        # スコア順でソート（ここでは簡単な実装）
        return all_results[:top_k]

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
                embeddings = encode(codes, batch_size=settings.batch_size, convert_to_numpy=True)
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
                    embeddings = encode(codes, batch_size=settings.batch_size, convert_to_numpy=True)
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
                    embeddings = encode(codes, batch_size=settings.batch_size, convert_to_numpy=True)
                    if cluster.index is None and len(embeddings) > 0:
                        faiss_index = faiss.IndexFlatL2(embeddings.shape[1])
                        faiss_index.add(embeddings)
                        cluster.index = faiss_index
                        cluster.meta = add_funcs
                    else:
                        cluster.index.add(embeddings)
                        cluster.meta.extend(add_funcs)
                    cluster.save()
