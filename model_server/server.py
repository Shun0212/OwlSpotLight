from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import asyncio
from sentence_transformers import SentenceTransformer
import torch
from threading import Lock
import os
import time
from typing import List, Dict, Optional
from concurrent.futures import ThreadPoolExecutor
from tqdm import tqdm
import faiss
import numpy as np
from pathspec import PathSpec
from pathspec.patterns import GitWildMatchPattern
import sys
from pathlib import Path
import json
import hashlib
import math
import re
import fnmatch
from collections import Counter
from pydantic_settings import BaseSettings
from dotenv import load_dotenv
import shutil
import subprocess

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '.env'))

OWL_INDEX_DIR = ".owl_index"
OWL_TRAINING_LOG_DIR = os.environ.get(
    "OWL_TRAINING_LOG_DIR",
    os.path.join(os.path.dirname(__file__), OWL_INDEX_DIR, "training"),
)
OWL_TRAINING_EXAMPLES_FILE = os.environ.get(
    "OWL_TRAINING_EXAMPLES_FILE",
    os.path.join(OWL_TRAINING_LOG_DIR, "agent_training_examples.jsonl"),
)

from extractors import extract_functions
from indexer import CodeIndexer
import progress

# モデル管理を model.py から import
from model import get_model, get_current_device, cleanup_memory, encode_code, DEFAULT_MODEL, get_device

import builtins as _builtins

# 詳細なサーバーログは既定でオフ。OWLSPOTLIGHT_DEBUG=1 で再度有効化できる。
OWL_DEBUG = os.environ.get("OWLSPOTLIGHT_DEBUG", "").strip().lower() in ("1", "true", "yes", "on")

def print(*args, **kwargs):  # noqa: A001 - 冗長ログを抑制するためモジュール内で組み込み print を上書き
    if OWL_DEBUG:
        _builtins.print(*args, **kwargs)

# グローバル変数
model_name = os.environ.get("OWL_MODEL_NAME", DEFAULT_MODEL)
DEFAULT_BATCH_SIZE = 2


def normalize_batch_size(value) -> int:
    try:
        size = int(float(value))
    except (TypeError, ValueError):
        return DEFAULT_BATCH_SIZE
    return max(1, size)

def encode_with_memory_management(
    codes: list[str],
    batch_size: int = None,
    max_retries: int = 3,
    show_progress: bool = True,
    input_type: str = "document",
):
    """後方互換性のためのラッパー関数"""
    if batch_size is None:
        batch_size = DEFAULT_BATCH_SIZE
    batch_size = normalize_batch_size(batch_size)
    return encode_code(codes, batch_size, max_retries, show_progress, input_type=input_type)

# 互換性のため、model変数を追加
model = get_model()
model_device = get_current_device()

app = FastAPI()

# === 設定: バッチサイズなど ===
class OwlSettings(BaseSettings):
    batch_size: int | str = DEFAULT_BATCH_SIZE
    
    class Config:
        env_prefix = "OWL_"  # 環境変数はOWL_BATCH_SIZEで設定可能

settings = OwlSettings()
settings.batch_size = normalize_batch_size(settings.batch_size)

# リクエスト用の Pydantic モデル
class EmbedRequest(BaseModel):
    texts: list[str]

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
    file_ext: str = ".py"
    include_files: Optional[List[str]] = None
    include_globs: Optional[List[str]] = None
    exclude_globs: Optional[List[str]] = None
    search_mode: str = "semantic"
    semantic_weight: float = 0.75
    capture_agent_event: bool = False
    agent_source: Optional[str] = None
    agent_client: Optional[str] = None
    agent_model: Optional[str] = None
    original_query: Optional[str] = None
    scope: Optional[str] = None
    search_target: str = "functions"
    diff_base_ref: Optional[str] = None
    diff_head_ref: Optional[str] = None
    force_diff_refresh: bool = False

class PrepareDiffSearchRequest(BaseModel):
    directory: str
    file_ext: str = ".py"
    include_files: Optional[List[str]] = None
    include_globs: Optional[List[str]] = None
    exclude_globs: Optional[List[str]] = None
    search_mode: str = "semantic"
    search_target: str = "diff_hunks"
    semantic_weight: float = 0.75
    diff_base_ref: Optional[str] = None
    diff_head_ref: Optional[str] = None
    force: bool = False

class AgentSearchFeedbackRequest(BaseModel):
    event_id: int
    suggestion: str
    query: Optional[str] = None

class AgentSearchUsageRequest(BaseModel):
    event_id: int
    referenced_ranks: List[int] = []
    referenced_locations: List[str] = []
    useful: bool = True
    note: Optional[str] = None
    agent_client: Optional[str] = None
    agent_model: Optional[str] = None

class GrepRepoRequest(BaseModel):
    directory: str
    pattern: str
    regex: bool = False
    case_sensitive: bool = True
    max_matches: int = 100
    include_globs: Optional[List[str]] = None
    exclude_globs: Optional[List[str]] = None
    capture_agent_event: bool = False
    agent_source: Optional[str] = None
    agent_client: Optional[str] = None
    agent_model: Optional[str] = None
    parent_event_id: Optional[int] = None

class FunctionRangeRequest(BaseModel):
    file: str
    func_name: str

# クラス統計表示用のリクエストモデル
class ClassStatsRequest(BaseModel):
    directory: str
    query: str  # 検索クエリ
    top_k: int = 50  # 上位何件の関数を取得するか
    file_ext: str = ".py"
    include_files: Optional[List[str]] = None
    search_mode: str = "semantic"
    semantic_weight: float = 0.75

# サーバー全体で1つのインデックスを保持
index_lock = Lock()
diff_search_lock = Lock()
agent_event_lock = Lock()
agent_search_events: list[dict] = []
agent_search_feedback: list[dict] = []
agent_search_usage: list[dict] = []
MAX_AGENT_SEARCH_EVENTS = 100
MAX_AGENT_SEARCH_FEEDBACK = 100
MAX_AGENT_SEARCH_USAGE = 100


def result_identity(result: dict) -> str:
    file_path = result.get("file") or result.get("file_path") or result.get("path") or ""
    line = result.get("lineno") or result.get("line_number") or result.get("line") or ""
    end_line = result.get("end_lineno") or result.get("end_line") or ""
    name = result.get("function_name") or result.get("name") or ""
    return f"{file_path}:{line}:{end_line}:{name}"


def training_result_payload(result: dict) -> dict:
    code = str(result.get("raw_code") or result.get("code") or result.get("text") or "")
    file_path = result.get("file") or result.get("file_path") or result.get("path")
    return {
        "rank": result.get("rank"),
        "file": file_path,
        "lineno": result.get("lineno") or result.get("line_number") or result.get("line"),
        "end_lineno": result.get("end_lineno") or result.get("end_line"),
        "name": result.get("function_name") or result.get("name"),
        "class_name": result.get("class_name"),
        "symbol_kind": result.get("symbol_kind"),
        "score": result.get("score"),
        "similarity": result.get("similarity"),
        "semantic_similarity": result.get("semantic_similarity"),
        "bm25_score": result.get("bm25_score"),
        "hybrid_score": result.get("hybrid_score"),
        "distance": result.get("distance"),
        "code_sha256": hashlib.sha256(code.encode("utf-8")).hexdigest() if code else None,
        "code": code,
    }


def normalize_glob_patterns(patterns: Optional[List[str]]) -> list[str]:
    normalized = []
    for pattern in patterns or []:
        clean = str(pattern).strip().replace("\\", "/")
        if clean.startswith("./"):
            clean = clean[2:]
        if clean:
            normalized.append(clean)
    return normalized


def path_matches_glob(rel_path: str, patterns: Optional[List[str]]) -> bool:
    rel = rel_path.replace("\\", "/").lstrip("./")
    name = rel.rsplit("/", 1)[-1]
    for pattern in normalize_glob_patterns(patterns):
        if pattern.endswith("/**"):
            prefix = pattern[:-3].rstrip("/")
            if rel == prefix or rel.startswith(prefix + "/"):
                return True
        if pattern.endswith("/"):
            prefix = pattern.rstrip("/")
            if rel == prefix or rel.startswith(prefix + "/"):
                return True
        if fnmatch.fnmatchcase(rel, pattern):
            return True
        if "/" not in pattern and fnmatch.fnmatchcase(name, pattern):
            return True
    return False


def path_allowed_by_globs(file_path: str, directory: str, include_globs: Optional[List[str]], exclude_globs: Optional[List[str]]) -> bool:
    if not file_path:
        return False
    root = Path(directory).resolve()
    try:
        rel_path = Path(file_path).resolve().relative_to(root).as_posix()
    except Exception:
        rel_path = str(file_path).replace("\\", "/")
    includes = normalize_glob_patterns(include_globs)
    excludes = normalize_glob_patterns(exclude_globs)
    if includes and not path_matches_glob(rel_path, includes):
        return False
    if excludes and path_matches_glob(rel_path, excludes):
        return False
    return True


def parse_reference_location(location: str) -> tuple[str, Optional[int]]:
    match = re.match(r"^(?P<path>.+?):(?P<line>\d+)(?:-\d+)?$", location.strip())
    if not match:
        return location.strip(), None
    return match.group("path").strip(), int(match.group("line"))


def location_matches_result(location: str, result: dict, directory: Optional[str]) -> bool:
    location_path, location_line = parse_reference_location(location)
    if not location_path:
        return False
    normalized_location = location_path.replace("\\", "/").lstrip("./")
    file_path = str(result.get("file") or result.get("file_path") or "")
    result_path = str(result.get("path") or "")
    candidates = {result_path.replace("\\", "/").lstrip("./")} if result_path else set()
    if file_path:
        candidates.add(file_path.replace("\\", "/"))
        if directory:
            try:
                candidates.add(Path(file_path).resolve().relative_to(Path(directory).resolve()).as_posix())
            except Exception:
                pass
    if normalized_location not in candidates:
        return False
    if location_line is None:
        return True
    start_line = result.get("lineno") or result.get("line_number") or result.get("line")
    if start_line is None:
        return True
    end_line = result.get("end_lineno") or result.get("end_line") or start_line
    try:
        return int(start_line) <= location_line <= int(end_line)
    except (TypeError, ValueError):
        return True


def append_training_examples_for_usage(event: dict, usage: dict) -> int:
    query = event.get("original_query") or event.get("query") or ""
    if not query:
        return 0
    referenced_ranks = {
        int(rank)
        for rank in usage.get("referenced_ranks", [])
        if isinstance(rank, int) or str(rank).isdigit()
    }
    referenced_locations = {
        str(location).strip()
        for location in usage.get("referenced_locations", [])
        if str(location).strip()
    }
    results = event.get("results") if isinstance(event.get("results"), list) else []
    referenced_identities = set()
    examples = []

    base = {
        "schema_version": 1,
        "created_at": time.time(),
        "event_id": event.get("id"),
        "usage_id": usage.get("id"),
        "parent_event_id": event.get("parent_event_id"),
        "source": event.get("source"),
        "kind": event.get("kind", "search"),
        "directory": event.get("directory"),
        "query": query,
        "file_ext": event.get("file_ext"),
        "search_mode": event.get("search_mode"),
        "semantic_weight": event.get("semantic_weight"),
        "embedding_model": event.get("embedding_model"),
        "embedding_api": event.get("embedding_api"),
        "agent_client": usage.get("agent_client") or event.get("agent_client"),
        "agent_model": usage.get("agent_model") or event.get("agent_model"),
        "note": usage.get("note"),
        "useful": usage.get("useful", True),
    }

    for result in results:
        rank = result.get("rank")
        if isinstance(rank, int) and rank in referenced_ranks:
            referenced_identities.add(result_identity(result))
            examples.append({
                **base,
                "label": "positive",
                "label_source": "referenced_rank",
                "target": training_result_payload(result),
            })

    for location in referenced_locations:
        matched_result = None
        for result in results:
            if location_matches_result(location, result, event.get("directory")):
                matched_result = result
                break
        if not matched_result:
            continue
        identity = result_identity(matched_result)
        referenced_identities.add(identity)
        if any(example.get("target") and result_identity(example["target"]) == identity for example in examples):
            continue
        examples.append({
            **base,
            "label": "positive",
            "label_source": "referenced_location",
            "location": location,
            "target": training_result_payload(matched_result),
        })

    for result in results:
        rank = result.get("rank")
        identity = result_identity(result)
        if identity in referenced_identities:
            continue
        examples.append({
            **base,
            "label": "weak_negative",
            "label_source": "returned_not_referenced",
            "target": training_result_payload(result),
            "rank_above_referenced": isinstance(rank, int) and any(rank < referenced for referenced in referenced_ranks),
        })

    if not examples:
        return 0
    os.makedirs(os.path.dirname(OWL_TRAINING_EXAMPLES_FILE), exist_ok=True)
    with open(OWL_TRAINING_EXAMPLES_FILE, "a", encoding="utf-8") as f:
        for example in examples:
            f.write(json.dumps(example, ensure_ascii=False) + "\n")
    return len(examples)


def find_agent_search_event(event_id: int) -> Optional[dict]:
    for event in agent_search_events:
        if event.get("id") == event_id:
            return event
    return None

def append_agent_search_event(event: dict) -> dict:
    with agent_event_lock:
        next_id = (agent_search_events[-1]["id"] + 1) if agent_search_events else 1
        stored = {"id": next_id, "created_at": time.time(), **event}
        agent_search_events.append(stored)
        parent_id = stored.get("parent_event_id")
        if isinstance(parent_id, int):
            for parent in agent_search_events:
                if parent.get("id") == parent_id:
                    children = parent.setdefault("child_event_ids", [])
                    if stored["id"] not in children:
                        children.append(stored["id"])
                    break
        if len(agent_search_events) > MAX_AGENT_SEARCH_EVENTS:
            del agent_search_events[:-MAX_AGENT_SEARCH_EVENTS]
        return stored

def append_agent_search_feedback(feedback: dict) -> dict:
    with agent_event_lock:
        next_id = (agent_search_feedback[-1]["id"] + 1) if agent_search_feedback else 1
        stored = {"id": next_id, "created_at": time.time(), **feedback}
        agent_search_feedback.append(stored)
        if len(agent_search_feedback) > MAX_AGENT_SEARCH_FEEDBACK:
            del agent_search_feedback[:-MAX_AGENT_SEARCH_FEEDBACK]
        return stored

def append_agent_search_usage(usage: dict) -> dict:
    with agent_event_lock:
        next_id = (agent_search_usage[-1]["id"] + 1) if agent_search_usage else 1
        stored = {"id": next_id, "created_at": time.time(), **usage}
        agent_search_usage.append(stored)
        if len(agent_search_usage) > MAX_AGENT_SEARCH_USAGE:
            del agent_search_usage[:-MAX_AGENT_SEARCH_USAGE]
        for event in agent_search_events:
            if event.get("id") == stored.get("event_id"):
                reports = event.setdefault("usage_reports", [])
                reports.append(stored)
                event["referenced_ranks"] = sorted({
                    int(rank)
                    for report in reports
                    for rank in report.get("referenced_ranks", [])
                    if isinstance(rank, int) or str(rank).isdigit()
                })
                event["referenced_locations"] = sorted({
                    str(location)
                    for report in reports
                    for location in report.get("referenced_locations", [])
                    if location
                })
                break
        return stored

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
        self.model_name: Optional[str] = None  # 追加: インデックス構築に使用したモデル名
        self.model_config: dict = {}  # 追加: モデル構成情報

    def get_current_model_config(self) -> dict:
        # Add new config keys here as needed for extensibility
        return {
            "model_name": model_name,
            "embedding_api": "sentence-transformers-ir-v1",
            # e.g. add more: "embedding_dim": ..., "other_param": ...
        }

    def set_index_dir(self, directory: str, file_ext: str = ".py"):
        # Hash the directory name to make it unique
        import hashlib
        dir_hash = hashlib.md5(os.path.abspath(directory).encode()).hexdigest()[:16]
        safe_dir = os.path.basename(os.path.abspath(directory))
        ext_dir = file_ext.lstrip(".")
        # Create index inside model_server (avoid duplication by using directory name + hash)
        model_server_dir = os.path.dirname(os.path.abspath(__file__))
        self.index_dir = os.path.join(model_server_dir, OWL_INDEX_DIR, f"{safe_dir}_{dir_hash}", ext_dir)
        # Directory creation is only done on save (not on startup)

    def is_up_to_date(self, directory: Optional[str] = None) -> bool:
        # If directory argument is specified, compare it with self.directory
        if directory is not None:
            if os.path.abspath(directory) != os.path.abspath(self.directory or ""):
                print(f"[is_up_to_date] Directory mismatch: {directory} != {self.directory}")
                return False
        current_model_config = self.get_current_model_config()
        if self.model_config and self.model_config != current_model_config:
            print(f"[is_up_to_date] Model config mismatch: {self.model_config} != {current_model_config}")
            return False
        if not self.directory:
            print("[is_up_to_date] self.directory is None")
            return False
        # If file info is empty, consider it outdated
        if not self.file_info:
            print("[is_up_to_date] file_info is empty")
            return False
        # Compare hash values (for speed, only log changed files)
        changed_files = []
        scan_dir = os.path.abspath(self.directory)
        spec = load_gitignore_spec(scan_dir)
        for path, info in self.file_info.items():
            if not os.path.exists(path):
                print(f"[is_up_to_date] File missing: {path}")
                return False
            if is_ignored(path, spec, scan_dir):
                print(f"[is_up_to_date] Indexed file is now ignored: {path}")
                return False
            hash_now = file_hash(path)
            if hash_now != info["hash"]:
                changed_files.append(path)
        if changed_files:
            print(f"[is_up_to_date] {len(changed_files)} files changed: {changed_files[:3]}{'...' if len(changed_files) > 3 else ''}")
            return False
        # Detect newly added files that match the target extension and are not ignored
        try:
            for root, dirs, files in os.walk(scan_dir):
                # Respect .gitignore for directories
                dirs[:] = [d for d in dirs if not is_ignored(os.path.join(root, d), spec, scan_dir)]
                for fname in files:
                    if not fname.endswith(self.file_ext):
                        continue
                    fpath = os.path.join(root, fname)
                    if is_ignored(fpath, spec, scan_dir):
                        continue
                    if fpath not in self.file_info:
                        print(f"[is_up_to_date] New file detected: {fpath}")
                        return False
        except Exception as e:
            # Be conservative: if scanning fails, treat as outdated to force rebuild
            print(f"[is_up_to_date] Error while scanning for new files: {e}")
            return False
        print(f"[is_up_to_date] All {len(self.file_info)} files are up to date")
        return True

    def clear_cache(self, clear_disk: bool = False):
        """Clear memory cache and force rebuild"""
        self.indexer = None
        self.embeddings = None
        self.faiss_index = None
        self.file_info = {}
        self.directory = None
        self.last_indexed = 0.0
        self.model_name = None
        self.model_config = {}
        if clear_disk and self.index_dir and os.path.exists(self.index_dir):
            shutil.rmtree(self.index_dir, ignore_errors=True)

    def force_rebuild_from_disk(self, directory: str, file_ext: str = ".py"):
        """Force rebuild index from disk"""
        self.clear_cache()
        self.load(directory, file_ext)

    def save(self):
        if not self.directory:
            return
        self.set_index_dir(self.directory, self.file_ext)
        if not self.index_dir:
            return
        os.makedirs(self.index_dir, exist_ok=True)

        def _atomic_numpy_save(path: str, array: np.ndarray):
            tmp = path + ".tmp"
            try:
                with open(tmp, "wb") as f:
                    np.save(f, array)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(tmp, path)
            except Exception as e:
                print(f"Error saving {path}: {e}")
                if os.path.exists(tmp):
                    os.remove(tmp)

        def _atomic_faiss_save(index: faiss.Index, path: str):
            tmp = path + ".tmp"
            try:
                faiss.write_index(index, tmp)
                os.replace(tmp, path)
            except Exception as e:
                print(f"Error saving {path}: {e}")
                if os.path.exists(tmp):
                    os.remove(tmp)

        # Function list
        if self.indexer:
            with open(os.path.join(self.index_dir, "functions.json"), "w", encoding="utf-8") as f:
                json.dump(self.indexer.functions, f, ensure_ascii=False)
        # Embeddings
        if self.embeddings is not None:
            _atomic_numpy_save(os.path.join(self.index_dir, "embeddings.npy"), self.embeddings)
        # faiss
        if self.faiss_index is not None:
            _atomic_faiss_save(self.faiss_index, os.path.join(self.index_dir, "faiss.index"))
        # Other meta
        meta = {
            "file_info": self.file_info,
            "directory": os.path.abspath(self.directory) if self.directory else None,
            "last_indexed": self.last_indexed,
            "file_ext": self.file_ext,
            "model_name": self.model_name or model_name,
            "model_config": self.model_config or self.get_current_model_config(),
        }
        with open(os.path.join(self.index_dir, "meta.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False)

    def load(self, directory: str, file_ext: str = ".py"):
        directory = os.path.abspath(directory)
        self.set_index_dir(directory, file_ext)
        # If index directory does not exist, do nothing (prefer memory cache)
        if not os.path.exists(self.index_dir):
            print(f"[load] index_dir does not exist: {self.index_dir}")
            self.indexer = None
            self.embeddings = None
            self.faiss_index = None
            self.file_info = {}
            self.directory = None
            self.last_indexed = 0.0
            self.file_ext = ".py"
            self.model_name = None
            self.model_config = {}
            return
        print(f"[load] Loading disk cache: {self.index_dir}")
        loaded_items = []
        try:
            with open(os.path.join(self.index_dir, "functions.json"), "r", encoding="utf-8") as f:
                functions = json.load(f)
            self.indexer = CodeIndexer()
            self.indexer.add_functions_without_embedding(functions)  # Add function list only, no embedding calculation
            loaded_items.append(f"functions({len(functions)})")
        except Exception as e:
            print(f"[load] Failed to load functions.json: {e}")
            self.indexer = None
        try:
            self.embeddings = np.load(os.path.join(self.index_dir, "embeddings.npy"))
            loaded_items.append(f"embeddings({self.embeddings.shape})")
        except Exception as e:
            print(f"[load] Failed to load embeddings.npy: {e}")
            self.embeddings = None
        try:
            self.faiss_index = faiss.read_index(os.path.join(self.index_dir, "faiss.index"))
            loaded_items.append(f"faiss({self.faiss_index.ntotal})")
        except Exception as e:
            print(f"[load] Failed to load faiss.index: {e}")
            self.faiss_index = None
        try:
            with open(os.path.join(self.index_dir, "meta.json"), "r", encoding="utf-8") as f:
                meta = json.load(f)
            self.file_info = meta.get("file_info", {})
            self.directory = os.path.abspath(meta.get("directory", directory))
            self.last_indexed = meta.get("last_indexed", 0.0)
            self.file_ext = meta.get("file_ext", ".py")
            self.model_name = meta.get("model_name")
            self.model_config = meta.get("model_config", {"model_name": self.model_name})
            loaded_items.append(f"meta({len(self.file_info)} files)")
        except Exception as e:
            print(f"[load] Failed to load meta.json: {e}")
            self.file_info = {}
            self.directory = None
            self.last_indexed = 0.0
            self.file_ext = ".py"
            self.model_name = None
            self.model_config = {}
        if loaded_items:
            print(f"[load] Load complete: {', '.join(loaded_items)}")
        else:
            print("[load] Failed to load any cache files")

global_index_state = GlobalIndexerState()
# サーバー起動時は自動ロードを行わない（メモリキャッシュ優先、必要時のみディスクアクセス）


class DiffSearchState:
    def __init__(self):
        self.signature: str = ""
        self.embedding_signature: str = ""
        self.hunks: list[dict] = []
        self.file_count: int = 0
        self.embeddings: Optional[np.ndarray] = None
        self.faiss_index: Optional[faiss.IndexFlatL2] = None
        self.last_prepared: float = 0.0
        self.index_embedding_ms: float = 0.0
        self.hunk_build_ms: float = 0.0

    def clear_embeddings(self):
        self.embedding_signature = ""
        self.embeddings = None
        self.faiss_index = None
        self.index_embedding_ms = 0.0

    def replace_hunks(self, signature: str, hunks: list[dict], file_count: int, hunk_build_ms: float):
        self.signature = signature
        self.hunks = hunks
        self.file_count = file_count
        self.hunk_build_ms = hunk_build_ms
        self.last_prepared = time.time()
        self.clear_embeddings()


diff_search_state = DiffSearchState()

def load_gitignore_spec(root_dir: str) -> Optional[PathSpec]:
    """
    指定ディレクトリ直下の .gitignore と .owlignore を読み込み、Git の
    ワイルドカード仕様をそのまま解釈できる PathSpec を返す。
    """
    lines: list[str] = []
    for ignore_file in [".gitignore", ".owlignore"]:
        ignore_path = os.path.join(root_dir, ignore_file)
        if not os.path.exists(ignore_path):
            continue
        with open(ignore_path, encoding="utf-8") as f:
            lines.extend(
                ln.rstrip("\n")
                for ln in f
                if ln.strip() and not ln.lstrip().startswith("#")
            )
    if not lines:
        return None
    return PathSpec.from_lines(GitWildMatchPattern, lines)

def is_ignored(path: str, spec: Optional[PathSpec], root_dir: str) -> bool:
    if spec is None:
        return False
    rel_path = os.path.relpath(path, root_dir)
    return spec.match_file(rel_path)

def repo_visible_files(root_dir: str, spec: Optional[PathSpec]) -> list[str]:
    root = Path(root_dir).resolve()
    files: list[str] = []
    try:
        output = subprocess.check_output(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
            cwd=str(root),
            text=True,
            stderr=subprocess.DEVNULL,
        )
        for line in output.splitlines():
            rel_path = line.strip()
            if not rel_path:
                continue
            path = (root / rel_path).resolve()
            try:
                path.relative_to(root)
            except ValueError:
                continue
            if path.is_file() and not is_ignored(str(path), spec, str(root)):
                files.append(str(path))
        if files:
            return files
    except Exception:
        pass

    ignored_dirs = {".git", "node_modules", "dist", "build", "out", ".venv", ".owl_index", "__pycache__"}
    for current_root, dirs, filenames in os.walk(root):
        dirs[:] = [
            dirname
            for dirname in dirs
            if dirname not in ignored_dirs and not is_ignored(os.path.join(current_root, dirname), spec, str(root))
        ]
        for filename in filenames:
            path = os.path.join(current_root, filename)
            if not is_ignored(path, spec, str(root)):
                files.append(path)
    return files


def normalize_search_target(value: Optional[str]) -> str:
    target = (value or "functions").strip().lower()
    if target in {"changed_functions", "changed_function", "changed_funcs", "changed_func"}:
        return "changed_functions"
    # Legacy "changed lines / changed hunks" target was removed; map it to the
    # changed-functions view, which is the closest replacement.
    if target in {"changed", "changed_hunk", "changed_hunks", "changed-lines", "changed_lines"}:
        return "changed_functions"
    if target in {"diff", "diff_hunk", "diff_hunks", "patch", "unified_diff"}:
        return "diff_hunks"
    return "functions"


def sanitize_git_ref(value: Optional[str]) -> str:
    ref = (value or "").strip()
    if not ref:
        return ""
    if ref.startswith("-") or "\x00" in ref or re.search(r"\s", ref):
        raise ValueError(f"Unsupported git ref: {ref!r}")
    return ref


def display_diff_compare(base_ref: str, head_ref: str) -> str:
    if base_ref and head_ref:
        return f"{base_ref}...{head_ref}"
    if base_ref:
        return f"{base_ref}...HEAD"
    return "HEAD...working tree"


def git_diff_text(directory: str, base_ref: str, head_ref: str) -> str:
    base = sanitize_git_ref(base_ref)
    head = sanitize_git_ref(head_ref)
    args = ["git", "diff", "--no-color", "--no-ext-diff", "--unified=3"]
    if base and head:
        args.append(f"{base}...{head}")
    elif base:
        args.append(f"{base}...HEAD")
    else:
        args.append("HEAD")
    args.append("--")
    proc = subprocess.run(args, cwd=directory, capture_output=True, text=True)
    if proc.returncode != 0 and not base:
        fallback = subprocess.run(
            ["git", "diff", "--no-color", "--no-ext-diff", "--unified=3", "--"],
            cwd=directory,
            capture_output=True,
            text=True,
        )
        proc = fallback
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "git diff failed").strip()
        raise RuntimeError(detail)
    text = proc.stdout
    if not base and not head:
        text += untracked_files_as_diff(directory)
    return text


def untracked_files_as_diff(directory: str) -> str:
    try:
        output = subprocess.check_output(
            ["git", "ls-files", "--others", "--exclude-standard"],
            cwd=directory,
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        return ""
    chunks: list[str] = []
    root = Path(directory).resolve()
    for rel_path in output.splitlines():
        rel_path = rel_path.strip()
        if not rel_path:
            continue
        file_path = (root / rel_path).resolve()
        try:
            file_path.relative_to(root)
        except ValueError:
            continue
        if not file_path.is_file():
            continue
        try:
            raw = file_path.read_bytes()
        except Exception:
            continue
        if b"\0" in raw[:4096]:
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("utf-8", errors="replace")
        lines = text.splitlines()
        line_count = max(1, len(lines))
        chunks.extend([
            "",
            f"diff --git a/{rel_path} b/{rel_path}",
            "new file mode 100644",
            "--- /dev/null",
            f"+++ b/{rel_path}",
            f"@@ -0,0 +1,{line_count} @@",
        ])
        chunks.extend(f"+{line}" for line in lines)
    return "\n".join(chunks)


_DIFF_HUNK_RE = re.compile(
    r"^@@ -(?P<old_start>\d+)(?:,(?P<old_count>\d+))? "
    r"\+(?P<new_start>\d+)(?:,(?P<new_count>\d+))? @@(?P<header>.*)$"
)


def diff_header_path(value: str) -> Optional[str]:
    text = value.strip()
    if text == "/dev/null":
        return None
    if "\t" in text:
        text = text.split("\t", 1)[0]
    if text.startswith("a/") or text.startswith("b/"):
        text = text[2:]
    return text.strip('"') or None


def append_line_range(ranges: list[tuple[int, int]], line_number: int):
    if line_number <= 0:
        return
    if ranges and ranges[-1][1] + 1 == line_number:
        ranges[-1] = (ranges[-1][0], line_number)
    else:
        ranges.append((line_number, line_number))


def format_line_ranges(ranges: list[tuple[int, int]]) -> str:
    return ", ".join(str(start) if start == end else f"{start}-{end}" for start, end in ranges)


def diff_signature(
    directory: str,
    file_ext: str,
    include_files: Optional[List[str]],
    include_globs: Optional[List[str]],
    exclude_globs: Optional[List[str]],
    diff_base_ref: Optional[str],
    diff_head_ref: Optional[str],
) -> tuple[str, str, str]:
    root = str(Path(directory).resolve())
    base_ref = sanitize_git_ref(diff_base_ref)
    head_ref = sanitize_git_ref(diff_head_ref)
    payload = {
        "directory": root,
        "file_ext": file_ext,
        "include_files": sorted(str(Path(path).resolve()) for path in include_files or []),
        "include_globs": normalize_glob_patterns(include_globs),
        "exclude_globs": normalize_glob_patterns(exclude_globs),
        "diff_base_ref": base_ref,
        "diff_head_ref": head_ref,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest(), base_ref, head_ref


def diff_embedding_signature(signature: str) -> str:
    payload = {
        "diff_signature": signature,
        "model_name": model_name,
        "embedding_api": global_index_state.get_current_model_config().get("embedding_api"),
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def collect_diff_hunks(
    directory: str,
    file_ext: str,
    include_files: Optional[List[str]],
    include_globs: Optional[List[str]],
    exclude_globs: Optional[List[str]],
    diff_base_ref: Optional[str],
    diff_head_ref: Optional[str],
) -> tuple[list[dict], int, str, str]:
    root = Path(directory).resolve()
    if not root.is_dir():
        raise RuntimeError(f"directory does not exist: {directory}")
    _signature, base_ref, head_ref = diff_signature(
        str(root),
        file_ext,
        include_files,
        include_globs,
        exclude_globs,
        diff_base_ref,
        diff_head_ref,
    )
    include_file_set = {str(Path(path).resolve()) for path in include_files or []}
    ignore_spec = load_gitignore_spec(str(root))
    diff_text = git_diff_text(str(root), base_ref, head_ref)
    if not diff_text.strip():
        return [], 0, base_ref, head_ref

    hunks: list[dict] = []
    files_seen: set[str] = set()
    current_old_path: Optional[str] = None
    current_new_path: Optional[str] = None
    hunk_header = ""
    diff_lines: list[str] = []
    changed_lines: list[str] = []
    added_ranges: list[tuple[int, int]] = []
    removed_ranges: list[tuple[int, int]] = []
    old_start = 0
    new_start = 0
    old_line = 0
    new_line = 0

    def path_allowed(rel_path: Optional[str]) -> bool:
        if not rel_path or not rel_path.endswith(file_ext):
            return False
        file_path = str((root / rel_path).resolve())
        if include_file_set and file_path not in include_file_set:
            return False
        if is_ignored(file_path, ignore_spec, str(root)):
            return False
        return path_allowed_by_globs(file_path, str(root), include_globs, exclude_globs)

    def flush_hunk():
        nonlocal hunk_header, diff_lines, changed_lines, added_ranges, removed_ranges
        if not hunk_header:
            diff_lines = []
            changed_lines = []
            added_ranges = []
            removed_ranges = []
            return
        rel_path = current_new_path or current_old_path
        if not path_allowed(rel_path):
            hunk_header = ""
            diff_lines = []
            changed_lines = []
            added_ranges = []
            removed_ranges = []
            return
        additions = sum(1 for line in diff_lines if line.startswith("+") and not line.startswith("+++"))
        deletions = sum(1 for line in diff_lines if line.startswith("-") and not line.startswith("---"))
        if additions or deletions:
            file_path = str((root / str(rel_path)).resolve())
            first_line = added_ranges[0][0] if added_ranges else max(new_start, 1)
            end_line = max(first_line, new_line - 1)
            changed_code = "\n".join(changed_lines).rstrip()
            unified_diff = "\n".join([hunk_header, *diff_lines]).rstrip()
            range_bits = []
            if added_ranges:
                range_bits.append("+" + format_line_ranges(added_ranges))
            if removed_ranges:
                range_bits.append("-" + format_line_ranges(removed_ranges))
            range_label = f" ({', '.join(range_bits)})" if range_bits else ""
            hunks.append({
                "name": f"Diff hunk: {rel_path}{range_label}",
                "function_name": f"Diff hunk: {rel_path}{range_label}",
                "class_name": None,
                "symbol_kind": "diff_hunk",
                "result_type": "diff_hunk",
                "file": file_path,
                "file_path": file_path,
                "path": str(rel_path),
                "lineno": first_line,
                "line_number": first_line,
                "end_lineno": end_line,
                "raw_code": changed_code,
                "code": changed_code,
                "search_text": changed_code,
                "changed_code": changed_code,
                "diff_code": unified_diff,
                "diff_compare": display_diff_compare(base_ref, head_ref),
                "diff_base_ref": base_ref,
                "diff_head_ref": head_ref,
                "added_ranges": added_ranges,
                "removed_ranges": removed_ranges,
                "additions": additions,
                "deletions": deletions,
            })
            files_seen.add(str(rel_path))
        hunk_header = ""
        diff_lines = []
        changed_lines = []
        added_ranges = []
        removed_ranges = []

    for line in diff_text.splitlines():
        if line.startswith("diff --git "):
            flush_hunk()
            current_old_path = None
            current_new_path = None
            continue
        if line.startswith("--- "):
            current_old_path = diff_header_path(line[4:])
            continue
        if line.startswith("+++ "):
            current_new_path = diff_header_path(line[4:])
            continue
        match = _DIFF_HUNK_RE.match(line)
        if match:
            flush_hunk()
            hunk_header = line
            old_start = int(match.group("old_start"))
            new_start = int(match.group("new_start"))
            old_line = old_start
            new_line = new_start
            continue
        if not hunk_header:
            continue
        if line.startswith("\\ No newline"):
            diff_lines.append(line)
            continue
        diff_lines.append(line)
        if line.startswith("+") and not line.startswith("+++"):
            changed_lines.append(line[1:])
            append_line_range(added_ranges, new_line)
            new_line += 1
        elif line.startswith("-") and not line.startswith("---"):
            changed_lines.append(line[1:])
            append_line_range(removed_ranges, old_line)
            old_line += 1
        else:
            old_line += 1
            new_line += 1
    flush_hunk()
    return hunks, len(files_seen), base_ref, head_ref

def grep_repo_files(
    directory: str,
    pattern: str,
    regex: bool,
    case_sensitive: bool,
    max_matches: int,
    include_globs: Optional[List[str]] = None,
    exclude_globs: Optional[List[str]] = None,
) -> list[dict]:
    if not pattern:
        return []
    flags = 0 if case_sensitive else re.IGNORECASE
    compiled = re.compile(pattern if regex else re.escape(pattern), flags)
    spec = load_gitignore_spec(directory)
    root = Path(directory).resolve()
    matches: list[dict] = []
    for file_path in repo_visible_files(str(root), spec):
        if not path_allowed_by_globs(file_path, str(root), include_globs, exclude_globs):
            continue
        try:
            raw = Path(file_path).read_bytes()
        except Exception:
            continue
        if b"\0" in raw[:4096]:
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            try:
                text = raw.decode("utf-8", errors="replace")
            except Exception:
                continue
        for line_number, line in enumerate(text.splitlines(), start=1):
            if not compiled.search(line):
                continue
            rel_path = os.path.relpath(file_path, root)
            matches.append({
                "file": file_path,
                "path": rel_path,
                "line": line_number,
                "text": line[:500],
            })
            if len(matches) >= max_matches:
                return matches
    return matches

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


_TOKEN_PATTERN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*|\d+")


def tokenize_for_bm25(text: str) -> list[str]:
    return [token.lower() for token in _TOKEN_PATTERN.findall(text)]


def normalize_scores(scores: dict[int, float]) -> dict[int, float]:
    if not scores:
        return {}
    values = list(scores.values())
    min_score = min(values)
    max_score = max(values)
    if max_score <= min_score:
        return {index: 1.0 for index in scores}
    return {index: (score - min_score) / (max_score - min_score) for index, score in scores.items()}


def bm25_search_scores(functions: list[dict], query: str) -> dict[int, float]:
    query_tokens = tokenize_for_bm25(query)
    if not query_tokens:
        return {}
    documents = []
    for func in functions:
        if func.get("result_type") == "diff_hunk" and func.get("search_text") is not None:
            documents.append(tokenize_for_bm25(str(func.get("search_text") or "")))
            continue
        name = func.get("name", "")
        function_name = func.get("function_name", "")
        file_path = func.get("file_path") or func.get("file", "")
        source_code = func.get("raw_code") or func.get("code", "")
        parts = [
            name,
            function_name if function_name != name else "",
            func.get("class_name", ""),
            func.get("symbol_kind", ""),
            file_path,
            os.path.basename(str(file_path)) if file_path else "",
            source_code,
            json.dumps(func.get("python_static", {}), ensure_ascii=False),
        ]
        documents.append(tokenize_for_bm25("\n".join(str(part) for part in parts if part)))
    if not documents:
        return {}

    doc_freq: Counter[str] = Counter()
    term_freqs: list[Counter[str]] = []
    doc_lengths: list[int] = []
    for tokens in documents:
        tf = Counter(tokens)
        term_freqs.append(tf)
        doc_lengths.append(len(tokens))
        doc_freq.update(tf.keys())

    avg_doc_length = sum(doc_lengths) / len(doc_lengths) if doc_lengths else 0.0
    if avg_doc_length <= 0:
        return {}

    k1 = 1.5
    b = 0.75
    scores: dict[int, float] = {}
    total_docs = len(documents)
    for index, tf in enumerate(term_freqs):
        doc_length = doc_lengths[index]
        score = 0.0
        for token in query_tokens:
            freq = tf.get(token, 0)
            if freq <= 0:
                continue
            df = doc_freq.get(token, 0)
            idf = math.log(1 + ((total_docs - df + 0.5) / (df + 0.5)))
            denom = freq + k1 * (1 - b + b * (doc_length / avg_doc_length))
            score += idf * ((freq * (k1 + 1)) / denom)
        if score > 0:
            scores[index] = score
    return scores


def searchable_function_text(func: dict) -> str:
    if func.get("result_type") == "diff_hunk" and func.get("search_text") is not None:
        return str(func.get("search_text") or "")
    name = func.get("name", "")
    function_name = func.get("function_name", "")
    source_code = func.get("raw_code") or func.get("code", "")
    parts = [
        name,
        function_name if function_name != name else "",
        func.get("class_name", ""),
        func.get("docstring", ""),
        source_code,
        json.dumps(func.get("python_static", {}), ensure_ascii=False),
    ]
    return "\n".join(str(part) for part in parts if part)


def keyword_search_matches(functions: list[dict], query: str) -> dict[int, list[str]]:
    keywords = [keyword.strip() for keyword in query.split() if keyword.strip()]
    if not keywords:
        return {}
    folded_keywords = [keyword.casefold() for keyword in keywords]

    matches: dict[int, list[str]] = {}
    for index, func in enumerate(functions):
        searchable_text = searchable_function_text(func).casefold()
        if all(keyword in searchable_text for keyword in folded_keywords):
            matches[index] = keywords
    return matches


def diff_result_for_target(hunk: dict, search_target: str) -> dict:
    # Only the "diff_hunks" (unified diff) target reaches this code path now;
    # the legacy "changed lines" target was removed.
    item = dict(hunk)
    item["code"] = hunk.get("diff_code") or hunk.get("changed_code") or ""
    item["raw_code"] = item["code"]
    item["function_name"] = str(hunk.get("function_name") or "").replace("Diff hunk:", "Unified diff:", 1)
    item["name"] = item["function_name"]
    item["search_target"] = "diff_hunks"
    return item


def changed_line_ranges_by_file(
    directory: str,
    file_ext: str,
    include_files: Optional[List[str]],
    include_globs: Optional[List[str]],
    exclude_globs: Optional[List[str]],
    diff_base_ref: Optional[str],
    diff_head_ref: Optional[str],
) -> dict[str, list[tuple[int, int]]]:
    """Return, per absolute file path, the line ranges (in head/working-tree
    coordinates) that were changed by the selected diff. Reuses the unified-diff
    hunk collector so the ranges honor the chosen base/head refs."""
    hunks, _count, _base, _head = collect_diff_hunks(
        directory,
        file_ext,
        include_files,
        include_globs,
        exclude_globs,
        diff_base_ref,
        diff_head_ref,
    )
    ranges: dict[str, list[tuple[int, int]]] = {}
    for hunk in hunks:
        path = os.path.abspath(str(hunk.get("file_path") or hunk.get("file") or ""))
        if not path:
            continue
        bucket = ranges.setdefault(path, [])
        added = hunk.get("added_ranges") or []
        if added:
            for pair in added:
                bucket.append((int(pair[0]), int(pair[1])))
        else:
            # Deletion-only hunk: anchor on the surrounding line so the enclosing
            # function is still treated as changed.
            anchor = int(hunk.get("lineno") or 1)
            bucket.append((anchor, anchor))
    return ranges


def function_intersects_changes(func: dict, changed_ranges: dict[str, list[tuple[int, int]]]) -> bool:
    path = os.path.abspath(str(func.get("file") or func.get("file_path") or ""))
    ranges = changed_ranges.get(path)
    if not ranges:
        return False
    start = int(func.get("lineno") or func.get("line_number") or 1)
    end = int(func.get("end_lineno") or start)
    if end < start:
        end = start
    for range_start, range_end in ranges:
        if start <= range_end and range_start <= end:
            return True
    return False


def prepare_diff_search_index(
    directory: str,
    file_ext: str,
    include_files: Optional[List[str]],
    include_globs: Optional[List[str]],
    exclude_globs: Optional[List[str]],
    search_mode: str,
    diff_base_ref: Optional[str],
    diff_head_ref: Optional[str],
    force: bool = False,
) -> dict:
    signature, base_ref, head_ref = diff_signature(
        directory,
        file_ext,
        include_files,
        include_globs,
        exclude_globs,
        diff_base_ref,
        diff_head_ref,
    )
    hunk_cache_hit = (
        not force
        and diff_search_state.signature == signature
        and diff_search_state.last_prepared > 0
    )
    if not hunk_cache_hit:
        start = time.perf_counter()
        hunks, file_count, base_ref, head_ref = collect_diff_hunks(
            directory,
            file_ext,
            include_files,
            include_globs,
            exclude_globs,
            diff_base_ref,
            diff_head_ref,
        )
        diff_search_state.replace_hunks(
            signature,
            hunks,
            file_count,
            (time.perf_counter() - start) * 1000,
        )

    normalized_mode = search_mode if search_mode in {"semantic", "bm25", "hybrid", "keyword"} else "hybrid"
    needs_embeddings = normalized_mode in {"semantic", "hybrid"}
    embedding_cache_hit = not needs_embeddings
    index_embedding_ms = 0.0
    if needs_embeddings:
        emb_signature = diff_embedding_signature(signature)
        embedding_cache_hit = (
            not force
            and diff_search_state.embedding_signature == emb_signature
            and diff_search_state.embeddings is not None
            and diff_search_state.faiss_index is not None
        )
        if not embedding_cache_hit:
            texts = [str(hunk.get("search_text") or "") for hunk in diff_search_state.hunks]
            if texts:
                progress.raise_if_cancelled()
                start = time.perf_counter()
                embeddings = encode_code(texts, settings.batch_size, show_progress=True, input_type="document")
                index_embedding_ms = (time.perf_counter() - start) * 1000
                faiss_index = faiss.IndexFlatL2(embeddings.shape[1])
                faiss_index.add(embeddings)
                diff_search_state.embeddings = embeddings
                diff_search_state.faiss_index = faiss_index
                diff_search_state.embedding_signature = emb_signature
                diff_search_state.index_embedding_ms = index_embedding_ms
            else:
                diff_search_state.clear_embeddings()
                diff_search_state.embedding_signature = emb_signature
        index_embedding_ms = 0.0 if embedding_cache_hit else diff_search_state.index_embedding_ms

    return {
        "num_diff_hunks": len(diff_search_state.hunks),
        "num_files": diff_search_state.file_count,
        "diff_cache_hit": hunk_cache_hit,
        "diff_embedding_cache_hit": embedding_cache_hit,
        "diff_compare": display_diff_compare(base_ref, head_ref),
        "diff_base_ref": base_ref,
        "diff_head_ref": head_ref,
        "diff_prepared_at": diff_search_state.last_prepared,
        "diff_hunk_build_ms": round(diff_search_state.hunk_build_ms, 1),
        "index_embedding_ms": round(index_embedding_ms, 1),
        "search_mode": normalized_mode,
    }


def search_diff_hunks(req: SearchFunctionsSimpleRequest) -> dict:
    # This path now only serves the unified-diff ("diff_hunks") view.
    search_target = "diff_hunks"
    search_mode = req.search_mode if req.search_mode in {"semantic", "bm25", "hybrid", "keyword"} else "hybrid"
    semantic_weight = max(0.0, min(1.0, req.semantic_weight))
    prepared = prepare_diff_search_index(
        req.directory,
        req.file_ext,
        req.include_files,
        req.include_globs,
        req.exclude_globs,
        search_mode,
        req.diff_base_ref,
        req.diff_head_ref,
        req.force_diff_refresh,
    )
    hunks = diff_search_state.hunks
    needs_embeddings = search_mode in {"semantic", "hybrid"}
    if not hunks or (needs_embeddings and diff_search_state.faiss_index is None):
        return {
            "results": [],
            "message": "No changed hunks found.",
            "num_functions": 0,
            "num_files": prepared["num_files"],
            "search_mode": search_mode,
            "search_target": search_target,
            **prepared,
        }

    if search_mode == "keyword":
        matches = keyword_search_matches(hunks, req.query)
        found = []
        for rank, hunk_index in enumerate(sorted(matches)[:req.top_k], start=1):
            item = diff_result_for_target(hunks[hunk_index], search_target)
            item.update({
                "rank": rank,
                "distance": None,
                "semantic_similarity": 0.0,
                "bm25_score": 0.0,
                "hybrid_score": None,
                "search_mode": search_mode,
                "keyword_match": True,
                "matched_keywords": matches[hunk_index],
            })
            found.append(item)
        return {
            "results": found,
            "num_functions": len(hunks),
            "num_files": prepared["num_files"],
            "search_mode": search_mode,
            "search_target": search_target,
            "semantic_weight": semantic_weight,
            **prepared,
        }

    semantic_scores: dict[int, float] = {}
    semantic_distances: dict[int, float] = {}
    if search_mode in {"semantic", "hybrid"}:
        progress.raise_if_cancelled()
        query_emb = encode_code([req.query], batch_size=1, show_progress=False, input_type="query")
        semantic_k = len(hunks) if search_mode == "hybrid" else min(req.top_k, len(hunks))
        D, I = diff_search_state.faiss_index.search(query_emb, semantic_k)
        valid_distances = [
            float(distance)
            for distance, idx in zip(D[0], I[0])
            if 0 <= idx < len(hunks) and np.isfinite(distance)
        ]
        min_distance = min(valid_distances) if valid_distances else 0.0
        max_distance = max(valid_distances) if valid_distances else 0.0
        for distance, idx in zip(D[0], I[0]):
            if 0 <= idx < len(hunks):
                distance_value = float(distance)
                if max_distance > min_distance and np.isfinite(distance_value):
                    score = max(0.0, min(1.0, 1.0 - ((distance_value - min_distance) / (max_distance - min_distance))))
                else:
                    score = 1.0
                semantic_scores[int(idx)] = score
                semantic_distances[int(idx)] = distance_value

    bm25_scores = bm25_search_scores(hunks, req.query) if search_mode in {"bm25", "hybrid"} else {}
    normalized_bm25 = normalize_scores(bm25_scores)
    candidate_indices = set(semantic_scores) | set(normalized_bm25)
    if not candidate_indices and search_mode in {"bm25", "hybrid"}:
        candidate_indices = set(range(len(hunks)))

    ranked = []
    for hunk_index in candidate_indices:
        semantic_score = semantic_scores.get(hunk_index, 0.0)
        bm25_score = normalized_bm25.get(hunk_index, 0.0)
        if search_mode == "semantic":
            hybrid_score = semantic_score
        elif search_mode == "bm25":
            hybrid_score = bm25_score
        else:
            hybrid_score = (semantic_weight * semantic_score) + ((1.0 - semantic_weight) * bm25_score)
        ranked.append((hybrid_score, semantic_score, bm25_score, hunk_index))
    ranked.sort(key=lambda item: item[0], reverse=True)

    found = []
    for rank, (hybrid_score, semantic_score, bm25_score, hunk_index) in enumerate(ranked[:req.top_k], start=1):
        item = diff_result_for_target(hunks[hunk_index], search_target)
        item.update({
            "rank": rank,
            "distance": semantic_distances.get(hunk_index),
            "score": hybrid_score,
            "similarity": semantic_score if search_mode != "bm25" else bm25_score,
            "semantic_similarity": semantic_score,
            "bm25_score": bm25_score,
            "hybrid_score": hybrid_score,
            "search_mode": search_mode,
        })
        found.append(item)
    return {
        "results": found,
        "num_functions": len(hunks),
        "num_files": prepared["num_files"],
        "search_mode": search_mode,
        "search_target": search_target,
        "semantic_weight": semantic_weight,
        **prepared,
    }


def record_diff_agent_event(req: SearchFunctionsSimpleRequest, response: dict, message: Optional[str] = None) -> Optional[dict]:
    if not req.capture_agent_event:
        return None
    found = response.get("results") if isinstance(response.get("results"), list) else []
    event = {
        "source": req.agent_source or "agent",
        "agent_client": req.agent_client,
        "agent_model": req.agent_model,
        "directory": os.path.abspath(req.directory),
        "query": req.query,
        "original_query": req.original_query or req.query,
        "file_ext": req.file_ext,
        "top_k": req.top_k,
        "scope": req.scope or "diff",
        "search_target": response.get("search_target"),
        "diff_compare": response.get("diff_compare"),
        "diff_base_ref": response.get("diff_base_ref"),
        "diff_head_ref": response.get("diff_head_ref"),
        "include_globs": normalize_glob_patterns(req.include_globs),
        "exclude_globs": normalize_glob_patterns(req.exclude_globs),
        "search_mode": response.get("search_mode"),
        "semantic_weight": response.get("semantic_weight", req.semantic_weight),
        "embedding_model": model_name,
        "embedding_api": global_index_state.get_current_model_config().get("embedding_api"),
        "include_files_count": len(req.include_files or []),
        "result_count": len(found),
        "results": found,
    }
    if message:
        event["message"] = message
    return append_agent_search_event(event)

# ディレクトリ内の全ファイルから関数抽出・インデックス作成（一時的なインデックス、状態保存なし）
def build_index(directory: str, file_ext: str = ".py", max_workers: int = 8, update_state: bool = False):
    import hashlib
    def func_id(func):
        # ファイルパス・関数名・lineno・end_linenoを組み合わせて一意なIDを生成
        key = f"{func.get('file','')}|{func.get('name','')}|{func.get('lineno','')}|{func.get('end_lineno','')}"
        return hashlib.sha256(key.encode()).hexdigest()

    progress.raise_if_cancelled()
    directory = os.path.abspath(directory)
    current_model_config = global_index_state.get_current_model_config()

    # 1. まずメモリキャッシュが有効かつ up_to_date なら即リターン（メモリのみ）
    if (
        global_index_state.indexer is not None and 
        global_index_state.directory == directory and
        global_index_state.file_ext == file_ext and
        global_index_state.is_up_to_date(directory=directory)
    ):
        if global_index_state.model_config and global_index_state.model_config != current_model_config:
            print("[build_index] Model config mismatch – rebuilding")
            global_index_state.clear_cache(clear_disk=True)
        else:
            print(f"[build_index] Memory cache is up to date, returning without recalculation (funcs={len(global_index_state.indexer.functions)}, files={len(global_index_state.file_info)})")
            return (
                global_index_state.indexer.functions, 
                len(global_index_state.file_info), 
                global_index_state.indexer)
    
    # 2. メモリキャッシュが無効な場合、ディスクからロード
    global_index_state.load(directory, file_ext)
    global_index_state.set_index_dir(directory, file_ext)
    
    # 3. ディスクからロードした直後にモデル設定をチェック
    global_index_state.model_config = current_model_config
    
    # 4. ディスクキャッシュが最新かつモデル設定が一致するなら即リターン
    if (
        global_index_state.indexer is not None and 
        global_index_state.directory == directory and
        global_index_state.file_ext == file_ext and
        global_index_state.is_up_to_date(directory=directory) and
        global_index_state.model_config == current_model_config and
        (global_index_state.model_name is None or global_index_state.model_name == model_name)
    ):
        print(f"[build_index] Disk cache is up to date, returning without recalculation (funcs={len(global_index_state.indexer.functions)}, files={len(global_index_state.file_info)})")
        return (
            global_index_state.indexer.functions, 
            len(global_index_state.file_info), 
            global_index_state.indexer)
    
    # 5. ここに到達する場合のみ再構築が必要
    print("[build_index] Cache is invalid or outdated, rebuilding index")
    
    # モデル設定やモデル名の不一致でキャッシュクリア
    if global_index_state.model_config != current_model_config:
        print("[build_index] Model config mismatch after load – rebuilding")
        global_index_state.clear_cache(clear_disk=True)
        global_index_state.model_config = current_model_config
    if global_index_state.model_name and global_index_state.model_name != model_name:
        print("[build_index] Cached model mismatch – rebuilding")
        global_index_state.clear_cache(clear_disk=True)
        prev_info = {}
        prev_indexer = None
        prev_funcs_by_file = {}
    else:
        prev_info = dict(global_index_state.file_info) if update_state else {}
        prev_indexer = global_index_state.indexer if update_state else None
        prev_funcs_by_file = {}
        if prev_indexer:
            for func in prev_indexer.functions:
                prev_funcs_by_file.setdefault(func.get("file"), []).append(func)
    spec = load_gitignore_spec(directory)
    file_paths = []
    for root, dirs, files in os.walk(directory):
        progress.raise_if_cancelled()
        dirs[:] = [d for d in dirs if not is_ignored(os.path.join(root, d), spec, directory)]
        for fname in files:
            progress.raise_if_cancelled()
            if not fname.endswith(file_ext):
                continue
            fpath = os.path.join(root, fname)
            if is_ignored(fpath, spec, directory):
                continue
            file_paths.append(fpath)

    # ハッシュ値のみで判定
    new_info = {f: {"hash": file_hash(f)} for f in file_paths}
    added_or_modified = [f for f in file_paths if f not in prev_info or prev_info[f]["hash"] != new_info[f]["hash"]]
    unchanged = [f for f in file_paths if f in prev_info and prev_info[f]["hash"] == new_info[f]["hash"]]
    deleted = [f for f in prev_info if f not in new_info]

    # 変更・削除ゼロなら何もしないで戻る（キャッシュ再利用）
    if update_state and not added_or_modified and not deleted:
        print(f"[build_index] No changes – reusing cache (funcs={len(global_index_state.indexer.functions)}, files={len(global_index_state.file_info)})")
        return (
            global_index_state.indexer.functions,
            len(global_index_state.file_info),
            global_index_state.indexer,
        )
    
    print(f"[build_index] File changes detected: added/modified={len(added_or_modified)}, deleted={len(deleted)}, unchanged={len(unchanged)}")

    # 追加・変更ファイルのみ再抽出
    def process_file(fpath):
        progress.raise_if_cancelled()
        try:
            funcs = extract_functions(fpath)
            for func in funcs:
                func["file"] = fpath
            return funcs
        except Exception as e:
            print(f"\u26a0\ufe0f {fpath}: {e}")
            return []

    # --- 差分埋め込みの順序厳密化 ---
    # 1. まず全関数リストをファイルごとに構築
    results = []
    results_func_ids = []
    file_to_funcs = {}
    for f in unchanged:
        funcs = prev_funcs_by_file.get(f, [])
        file_to_funcs[f] = funcs
        for func in funcs:
            results.append(func)
            results_func_ids.append(func_id(func))
    added_modified_funcs = []
    if added_or_modified:
        scan_total = len(added_or_modified)
        progress.start("Scanning files", scan_total)
        scanned = 0
        if scan_total < 16:
            for fpath in tqdm(added_or_modified, desc="Indexing (serial, diff)", disable=not OWL_DEBUG, file=sys.stdout):
                progress.raise_if_cancelled()
                funcs = process_file(fpath)
                added_modified_funcs.extend(funcs)
                file_to_funcs[fpath] = funcs
                for func in funcs:
                    results.append(func)
                    results_func_ids.append(func_id(func))
                scanned += 1
                progress.update(scanned, scan_total)
        else:
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                for res, fpath in zip(
                    tqdm(executor.map(process_file, added_or_modified), total=scan_total, desc="Indexing (parallel, diff)", disable=not OWL_DEBUG, file=sys.stdout),
                    added_or_modified
                ):
                    progress.raise_if_cancelled()
                    added_modified_funcs.extend(res)
                    file_to_funcs[fpath] = res
                    for func in res:
                        results.append(func)
                        results_func_ids.append(func_id(func))
                    scanned += 1
                    progress.update(scanned, scan_total)

    # --- 埋め込み再利用ロジックの厳密化 ---
    if update_state:
        prev_funcs = prev_indexer.functions if prev_indexer else []
        prev_func_ids = [func_id(f) for f in prev_funcs]
        prev_func_id2idx = {fid: i for i, fid in enumerate(prev_func_ids)}
        # results_func_ids: 新しい順序
        keep_indices = [prev_func_id2idx[fid] for fid in results_func_ids if fid in prev_func_id2idx]
        # 新規関数（前回に存在しないもの）
        new_func_indices = [i for i, fid in enumerate(results_func_ids) if fid not in prev_func_id2idx]
        # 埋め込み配列を順序通りに構築
        if prev_indexer and global_index_state.embeddings is not None and global_index_state.faiss_index is not None and keep_indices:
            prev_embeddings = global_index_state.embeddings
            kept_embeddings = prev_embeddings[keep_indices] if keep_indices else np.zeros((0, prev_embeddings.shape[1]), dtype=prev_embeddings.dtype)
            # 新規分のみ埋め込み
            if new_func_indices:
                progress.raise_if_cancelled()
                new_codes = [results[i]["code"] for i in new_func_indices]
                print(f"Generating embeddings for {len(new_codes)} new/modified functions...")
                new_embeddings = encode_code(new_codes, settings.batch_size, show_progress=True)
                # 埋め込みを順序通りに合成
                embeddings = np.zeros((len(results), new_embeddings.shape[1]), dtype=new_embeddings.dtype)
                # 既存分
                for idx, keep_idx in enumerate(keep_indices):
                    embeddings[idx] = prev_embeddings[keep_idx]
                # 新規分
                for arr_idx, res_idx in enumerate(new_func_indices):
                    embeddings[res_idx] = new_embeddings[arr_idx]
            else:
                embeddings = kept_embeddings
            if embeddings is not None and embeddings.shape[0] > 0:
                faiss_index = faiss.IndexFlatL2(embeddings.shape[1])
                faiss_index.add(embeddings)
            else:
                faiss_index = None
                embeddings = None
            global_index_state.embeddings = embeddings
            global_index_state.faiss_index = faiss_index
        else:
            # 全関数分再計算
            codes = [func["code"] for func in results]
            if codes:
                progress.raise_if_cancelled()
                print(f"Generating embeddings for {len(codes)} functions (full rebuild)...")
                embeddings = encode_code(codes, settings.batch_size, show_progress=True)
                faiss_index = faiss.IndexFlatL2(embeddings.shape[1])
                faiss_index.add(embeddings)
                global_index_state.embeddings = embeddings
                global_index_state.faiss_index = faiss_index
            else:
                global_index_state.embeddings = None
                global_index_state.faiss_index = None
        # インデックス・メタ情報更新
        indexer = CodeIndexer()
        indexer.add_functions_without_embedding(results)  # 埋め込み計算なしで関数リストのみ追加
        global_index_state.indexer = indexer
        global_index_state.directory = os.path.abspath(directory)
        global_index_state.file_ext = file_ext
        global_index_state.last_indexed = float(time.time())
        global_index_state.file_info = new_info
        global_index_state.model_name = model_name
        global_index_state.save()
    else:
        indexer = CodeIndexer()
        indexer.add_functions_without_embedding(results)  # 埋め込み計算なしで関数リストのみ追加
    return results, len(file_paths), indexer

@app.post("/embed")
async def embed(req: EmbedRequest):
    print("/embed called")
    progress.clear_cancel()
    try:
        embeddings = encode_with_memory_management(req.texts, settings.batch_size)
        return {"embeddings": embeddings.tolist()}
    except progress.OperationCancelled:
        return {"embeddings": [], "cancelled": True, "message": "Embedding cancelled."}
    finally:
        progress.finish()

@app.post("/cancel_embedding")
async def cancel_embedding():
    progress.request_cancel()
    return {"message": "Cancellation requested for the current indexing/embedding operation.", "cancel_requested": True}

@app.post("/cancel_indexing")
async def cancel_indexing():
    return await cancel_embedding()

@app.post("/build_index")
async def build_index_api(req: BuildIndexRequest):
    print(f"/build_index called for directory: {req.directory}")
    with index_lock:
        progress.clear_cancel()
        try:
            results, file_count, _ = await asyncio.to_thread(build_index, req.directory, req.file_ext, update_state=True)
        except progress.OperationCancelled:
            return {"num_functions": 0, "num_files": 0, "cancelled": True, "message": "Indexing cancelled."}
        finally:
            progress.finish()
    return {"num_functions": len(results), "num_files": file_count}

@app.post("/force_rebuild_index")
async def force_rebuild_index_api(req: BuildIndexRequest):
    """キャッシュをクリアして強制的にインデックスを再構築"""
    print(f"/force_rebuild_index called for directory: {req.directory}")
    with index_lock:
        progress.clear_cancel()
        global_index_state.clear_cache()
        try:
            results, file_count, _ = await asyncio.to_thread(build_index, req.directory, req.file_ext, update_state=True)
        except progress.OperationCancelled:
            return {"num_functions": 0, "num_files": 0, "cancelled": True, "message": "Index rebuild cancelled."}
        finally:
            progress.finish()
    return {"num_functions": len(results), "num_files": file_count, "message": "Index forcefully rebuilt"}

@app.get("/index_status")
async def index_status():
    # If no directory is set, consider it up to date (no index to check)
    if global_index_state.directory is None:
        up_to_date = True
    else:
        up_to_date = global_index_state.is_up_to_date()
    return IndexStatus(
        directory=global_index_state.directory or "",
        indexed_files=list(global_index_state.file_info.keys()),
        last_indexed=global_index_state.last_indexed,
        up_to_date=up_to_date
    )

@app.get("/index_progress")
async def index_progress():
    """インデックス作成の進捗（実際の割合）を返す。"""
    return progress.snapshot()

@app.post("/prepare_diff_search")
async def prepare_diff_search_api(req: PrepareDiffSearchRequest):
    # Preparing the hunk index only matters for the unified-diff view.
    search_target = "diff_hunks"
    search_mode = req.search_mode if req.search_mode in {"semantic", "bm25", "hybrid", "keyword"} else "hybrid"
    with diff_search_lock:
        progress.clear_cancel()
        try:
            prepared = await asyncio.to_thread(
                prepare_diff_search_index,
                req.directory,
                req.file_ext,
                req.include_files,
                req.include_globs,
                req.exclude_globs,
                search_mode,
                req.diff_base_ref,
                req.diff_head_ref,
                req.force,
            )
        except progress.OperationCancelled:
            return {"cancelled": True, "message": "Diff preparation cancelled.", "results": []}
        finally:
            progress.finish()
    return {
        **prepared,
        "search_target": search_target,
        "message": f"Prepared {prepared.get('num_diff_hunks', 0)} changed hunk(s) from {prepared.get('num_files', 0)} file(s).",
    }

@app.post("/search")
async def search_api(query: str, top_k: int = 5):
    print(f"/search called with query: {query}")
    with index_lock:
        if not global_index_state.indexer:
            return {"results": [], "error": "No index built."}
        results = global_index_state.indexer.search(query, top_k=top_k)
    return {"results": results}

@app.post("/search_functions_simple")
async def search_functions_simple_api(req: SearchFunctionsSimpleRequest):
    search_target = normalize_search_target(req.search_target)
    if search_target == "diff_hunks":
        with diff_search_lock:
            progress.clear_cancel()
            try:
                response = await asyncio.to_thread(search_diff_hunks, req)
            except progress.OperationCancelled:
                return {"results": [], "cancelled": True, "message": "Diff search cancelled."}
            finally:
                progress.finish()
        agent_event = record_diff_agent_event(req, response, response.get("message"))
        response["agent_event_id"] = agent_event["id"] if agent_event else None
        return response

    search_mode = req.search_mode if req.search_mode in {"semantic", "bm25", "hybrid", "keyword"} else "hybrid"
    semantic_weight = max(0.0, min(1.0, req.semantic_weight))
    # キーワード/BM25 は埋め込み(FAISS インデックス)が不要。意味検索/ハイブリッドのみ埋め込みを構築する。
    needs_embeddings = search_mode in {"semantic", "hybrid"}
    with index_lock:
        effective_include_files = list(req.include_files) if req.include_files is not None else None
        effective_scope = req.scope or ("scoped" if effective_include_files is not None else "all")
        progress.clear_cancel()
        # 意味検索/ハイブリッド: 埋め込みを構築 (update_state=True)
        # キーワード/BM25: 関数リストのみ取得し埋め込み計算をスキップ (update_state=False)
        try:
            results, file_count, indexer = await asyncio.to_thread(
                build_index, req.directory, req.file_ext, 8, needs_embeddings
            )
        except progress.OperationCancelled:
            return {"results": [], "cancelled": True, "message": "Search indexing cancelled."}
        finally:
            progress.finish()
        def record_agent_event(found: list[dict], search_mode_value: str, semantic_weight_value: float, message: Optional[str] = None):
            if not req.capture_agent_event:
                return None
            event = {
                "source": req.agent_source or "agent",
                "agent_client": req.agent_client,
                "agent_model": req.agent_model,
                "directory": os.path.abspath(req.directory),
                "query": req.query,
                "original_query": req.original_query or req.query,
                "file_ext": req.file_ext,
                "top_k": req.top_k,
                "scope": effective_scope,
                "include_globs": normalize_glob_patterns(req.include_globs),
                "exclude_globs": normalize_glob_patterns(req.exclude_globs),
                "search_mode": search_mode_value,
                "semantic_weight": semantic_weight_value,
                "embedding_model": model_name,
                "embedding_api": global_index_state.get_current_model_config().get("embedding_api"),
                "include_files_count": len(effective_include_files or []),
                "result_count": len(found),
                "results": found,
            }
            if message:
                event["message"] = message
            return append_agent_search_event(event)

        # build_index後のキャッシュ状態をprint
        print("indexer_exists:", global_index_state.indexer is not None)
        print("up_to_date:", global_index_state.is_up_to_date())
        print("embeddings_cached:", global_index_state.embeddings is not None)
        print("file_ext:", global_index_state.file_ext)
        embeddings = global_index_state.embeddings
        faiss_index = global_index_state.faiss_index
        # 意味検索/ハイブリッドのみ埋め込み必須。キーワード/BM25 は関数リストだけで検索する。
        if not results or (needs_embeddings and (embeddings is None or faiss_index is None)):
            agent_event = record_agent_event([], search_mode, semantic_weight, "No functions found.")
            return {"results": [], "message": "No functions found.", "agent_event_id": agent_event["id"] if agent_event else None}
        if req.include_globs or req.exclude_globs:
            glob_scoped_files = []
            for func in results:
                file_path = func.get("file") or func.get("file_path", "")
                if path_allowed_by_globs(file_path, req.directory, req.include_globs, req.exclude_globs):
                    glob_scoped_files.append(os.path.abspath(file_path))
            if effective_include_files is not None:
                existing_scope = {os.path.abspath(path) for path in effective_include_files}
                effective_include_files = [path for path in glob_scoped_files if path in existing_scope]
            else:
                effective_include_files = glob_scoped_files
            effective_scope = req.scope or "glob"
        search_results = results
        search_embeddings = embeddings
        index_to_result_index = list(range(len(results)))
        if effective_include_files is not None:
            include_files = {os.path.abspath(path) for path in effective_include_files}
            scoped_indices = [
                index
                for index, func in enumerate(results)
                if os.path.abspath(func.get("file", func.get("file_path", ""))) in include_files
            ]
            if not scoped_indices:
                agent_event = record_agent_event([], search_mode, semantic_weight, "No functions found in the selected file/glob scope.")
                return {
                    "results": [],
                    "message": "No functions found in the selected file/glob scope.",
                    "num_functions": len(results),
                    "num_files": file_count,
                    "scoped_files": len(include_files),
                    "agent_event_id": agent_event["id"] if agent_event else None,
                }
            search_results = [results[index] for index in scoped_indices]
            index_to_result_index = scoped_indices
            # 埋め込みを使うモードのときのみ、スコープ済み FAISS インデックスを構築
            if needs_embeddings and embeddings is not None and faiss_index is not None:
                search_embeddings = embeddings[scoped_indices]
                scoped_faiss_index = faiss.IndexFlatL2(search_embeddings.shape[1])
                scoped_faiss_index.add(search_embeddings)
                faiss_index = scoped_faiss_index

        # "Changed functions" view: keep only functions whose line range overlaps
        # the diff between the selected base/head refs.
        if search_target == "changed_functions":
            changed_ranges = changed_line_ranges_by_file(
                req.directory,
                req.file_ext,
                effective_include_files,
                req.include_globs,
                req.exclude_globs,
                req.diff_base_ref,
                req.diff_head_ref,
            )
            kept_positions = [
                pos
                for pos, func in enumerate(search_results)
                if function_intersects_changes(func, changed_ranges)
            ]
            if not kept_positions:
                agent_event = record_agent_event([], search_mode, semantic_weight, "No changed functions found for the selected diff.")
                return {
                    "results": [],
                    "message": "No changed functions found for the selected diff.",
                    "num_functions": len(results),
                    "num_files": file_count,
                    "search_mode": search_mode,
                    "search_target": "changed_functions",
                    "agent_event_id": agent_event["id"] if agent_event else None,
                }
            search_results = [search_results[pos] for pos in kept_positions]
            index_to_result_index = [index_to_result_index[pos] for pos in kept_positions]
            if needs_embeddings and embeddings is not None:
                search_embeddings = embeddings[index_to_result_index]
                scoped_faiss_index = faiss.IndexFlatL2(search_embeddings.shape[1])
                scoped_faiss_index.add(search_embeddings)
                faiss_index = scoped_faiss_index

        if search_mode == "keyword":
            scoped_keyword_matches = keyword_search_matches(search_results, req.query)
            found = []
            for rank, scoped_index in enumerate(sorted(scoped_keyword_matches)[:req.top_k], start=1):
                result_index = index_to_result_index[scoped_index]
                item = dict(results[result_index])
                item["rank"] = rank
                item["distance"] = None
                item["semantic_similarity"] = 0.0
                item["bm25_score"] = 0.0
                item["hybrid_score"] = None
                item["search_mode"] = search_mode
                item["keyword_match"] = True
                item["matched_keywords"] = scoped_keyword_matches[scoped_index]
                found.append(item)
            agent_event = record_agent_event(found, search_mode, semantic_weight)
            return {
                "results": found,
                "num_functions": len(results),
                "num_files": file_count,
                "scoped_files": len(effective_include_files or []),
                "search_mode": search_mode,
                "semantic_weight": semantic_weight,
                "agent_event_id": agent_event["id"] if agent_event else None,
            }

        semantic_scores: dict[int, float] = {}
        semantic_distances: dict[int, float] = {}
        if search_mode in {"semantic", "hybrid"}:
            try:
                progress.raise_if_cancelled()
                query_emb = encode_code([req.query], batch_size=1, show_progress=False, input_type="query")  # クエリは1つなので進捗報告は不要
            except progress.OperationCancelled:
                return {"results": [], "cancelled": True, "message": "Search embedding cancelled."}
            semantic_k = len(search_results) if search_mode == "hybrid" else min(req.top_k, len(search_results))
            D, I = faiss_index.search(query_emb, semantic_k)
            valid_distances = [
                float(distance)
                for distance, idx in zip(D[0], I[0])
                if 0 <= idx < len(search_results) and np.isfinite(distance)
            ]
            min_distance = min(valid_distances) if valid_distances else 0.0
            max_distance = max(valid_distances) if valid_distances else 0.0
            for distance, idx in zip(D[0], I[0]):
                if 0 <= idx < len(search_results):
                    distance_value = float(distance)
                    if max_distance > min_distance and np.isfinite(distance_value):
                        score = max(0.0, min(1.0, 1.0 - ((distance_value - min_distance) / (max_distance - min_distance))))
                    else:
                        score = 1.0
                    result_index = index_to_result_index[idx]
                    semantic_scores[result_index] = score
                    semantic_distances[result_index] = distance_value

        scoped_bm25_scores = bm25_search_scores(search_results, req.query) if search_mode in {"bm25", "hybrid"} else {}
        bm25_scores = {
            index_to_result_index[index]: score
            for index, score in scoped_bm25_scores.items()
            if 0 <= index < len(index_to_result_index)
        }
        normalized_bm25 = normalize_scores(bm25_scores)

        candidate_indices = set(semantic_scores) | set(normalized_bm25)
        if not candidate_indices and search_mode in {"bm25", "hybrid"}:
            candidate_indices = set(index_to_result_index)

        ranked = []
        for result_index in candidate_indices:
            semantic_score = semantic_scores.get(result_index, 0.0)
            bm25_score = normalized_bm25.get(result_index, 0.0)
            if search_mode == "semantic":
                hybrid_score = semantic_score
            elif search_mode == "bm25":
                hybrid_score = bm25_score
            else:
                hybrid_score = (semantic_weight * semantic_score) + ((1.0 - semantic_weight) * bm25_score)
            ranked.append((hybrid_score, semantic_score, bm25_score, result_index))

        ranked.sort(key=lambda item: item[0], reverse=True)
        found = []
        for rank, (hybrid_score, semantic_score, bm25_score, result_index) in enumerate(ranked[:req.top_k], start=1):
            item = dict(results[result_index])
            item["rank"] = rank
            item["distance"] = semantic_distances.get(result_index)
            item["score"] = hybrid_score
            item["similarity"] = semantic_score if search_mode != "bm25" else bm25_score
            item["semantic_similarity"] = semantic_score
            item["bm25_score"] = bm25_score
            item["hybrid_score"] = hybrid_score
            item["search_mode"] = search_mode
            found.append(item)
        agent_event = record_agent_event(found, search_mode, semantic_weight)
        return {
            "results": found,
            "num_functions": len(results),
            "num_files": file_count,
            "scoped_files": len(effective_include_files or []),
            "search_mode": search_mode,
            "semantic_weight": semantic_weight,
            "agent_event_id": agent_event["id"] if agent_event else None,
        }


@app.get("/agent_search_events")
async def agent_search_events_api(since_id: int = 0, limit: int = 20):
    with agent_event_lock:
        events = [event for event in agent_search_events if event["id"] > since_id]
        return {"events": events[-max(1, min(limit, 100)) :]}

@app.post("/agent_search_feedback")
async def agent_search_feedback_api(req: AgentSearchFeedbackRequest):
    suggestion = req.suggestion.strip()
    if not suggestion:
        raise HTTPException(status_code=400, detail="suggestion is required")
    stored = append_agent_search_feedback({
        "event_id": req.event_id,
        "query": req.query,
        "suggestion": suggestion,
    })
    return {"ok": True, "feedback": stored}

@app.post("/agent_search_usage")
async def agent_search_usage_api(req: AgentSearchUsageRequest):
    referenced_ranks = sorted({
        rank
        for rank in req.referenced_ranks
        if isinstance(rank, int) and rank > 0
    })
    referenced_locations = [
        location.strip()
        for location in req.referenced_locations
        if location and location.strip()
    ]
    if not referenced_ranks and not referenced_locations:
        raise HTTPException(status_code=400, detail="referenced_ranks or referenced_locations is required")
    stored = append_agent_search_usage({
        "event_id": req.event_id,
        "agent_client": req.agent_client,
        "agent_model": req.agent_model,
        "referenced_ranks": referenced_ranks,
        "referenced_locations": referenced_locations,
        "useful": req.useful,
        "note": req.note,
    })
    event = find_agent_search_event(req.event_id)
    training_examples_written = append_training_examples_for_usage(event, stored) if event else 0
    return {
        "ok": True,
        "usage": stored,
        "training_examples_written": training_examples_written,
        "training_examples_file": OWL_TRAINING_EXAMPLES_FILE,
    }

@app.get("/agent_search_feedback")
async def agent_search_feedback_list_api(since_id: int = 0, limit: int = 20):
    with agent_event_lock:
        feedback = [item for item in agent_search_feedback if item["id"] > since_id]
        return {"feedback": feedback[-max(1, min(limit, 100)) :]}

@app.get("/agent_training_examples")
async def agent_training_examples_api(limit: int = 20):
    path = OWL_TRAINING_EXAMPLES_FILE
    if not os.path.exists(path):
        return {"path": path, "count": 0, "examples": []}
    max_lines = max(1, min(limit, 200))
    with open(path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    examples = []
    for line in lines[-max_lines:]:
        try:
            examples.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return {"path": path, "count": len(lines), "examples": examples}

@app.post("/grep_repo")
async def grep_repo_api(req: GrepRepoRequest):
    directory = os.path.abspath(req.directory)
    if not os.path.isdir(directory):
        raise HTTPException(status_code=400, detail=f"directory does not exist: {directory}")
    max_matches = max(1, min(req.max_matches, 500))
    try:
        matches = grep_repo_files(
            directory,
            req.pattern,
            req.regex,
            req.case_sensitive,
            max_matches,
            req.include_globs,
            req.exclude_globs,
        )
    except re.error as exc:
        raise HTTPException(status_code=400, detail=f"invalid regex: {exc}") from exc

    agent_event = None
    if req.capture_agent_event:
        agent_event = append_agent_search_event({
            "source": req.agent_source or "agent",
            "agent_client": req.agent_client,
            "agent_model": req.agent_model,
            "parent_event_id": req.parent_event_id,
            "kind": "grep",
            "directory": directory,
            "query": req.pattern,
            "original_query": req.pattern,
            "file_ext": "all",
            "top_k": max_matches,
            "scope": "glob" if req.include_globs or req.exclude_globs else "repo",
            "include_globs": normalize_glob_patterns(req.include_globs),
            "exclude_globs": normalize_glob_patterns(req.exclude_globs),
            "search_mode": "grep_regex" if req.regex else "grep_literal",
            "semantic_weight": 0.0,
            "include_files_count": 0,
            "result_count": len(matches),
            "results": matches,
        })
    return {
        "matches": matches,
        "result_count": len(matches),
        "search_mode": "grep_regex" if req.regex else "grep_literal",
        "include_globs": normalize_glob_patterns(req.include_globs),
        "exclude_globs": normalize_glob_patterns(req.exclude_globs),
        "agent_event_id": agent_event["id"] if agent_event else None,
    }


@app.post("/get_class_stats")
async def get_class_stats(request: ClassStatsRequest):
    try:
        # まず検索を実行して検索結果を取得
        search_request = SearchFunctionsSimpleRequest(
            directory=request.directory,
            query=request.query,
            top_k=request.top_k,
            file_ext=request.file_ext,
            include_files=request.include_files,
            search_mode=request.search_mode,
            semantic_weight=request.semantic_weight,
        )
        search_response = await search_functions_simple_api(search_request)
        search_results = search_response["results"]
        
        # 全ての関数を抽出
        all_functions = []
        directory = request.directory
        ignore_spec = load_gitignore_spec(directory)
        
        if request.include_files:
            include_files = {os.path.abspath(path) for path in request.include_files}
            files = [
                file_path
                for file_path in include_files
                if file_path.endswith(request.file_ext)
                and os.path.exists(file_path)
                and not is_ignored(file_path, ignore_spec, directory)
            ]
        else:
            files = []
            for root, dirs, filenames in os.walk(directory):
                # .gitignoreのパターンでディレクトリをフィルタ
                dirs[:] = [d for d in dirs if not is_ignored(os.path.join(root, d), ignore_spec, directory)]
                
                for filename in filenames:
                    if filename.endswith(request.file_ext):
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

            for method in class_info["methods"]:
                method_file = method.get("file_path", method.get("file", ""))
                method_file_abs = os.path.abspath(method_file) if method_file else ""
                method_lineno = method.get("lineno", method.get("line_number", 0))
                method_key = (method["name"], method_file_abs, method_lineno)

                method_rank = None
                for i, result in enumerate(search_results):
                    result_func_name = result["name"]
                    result_file = result.get("file", "")
                    result_lineno = result.get("lineno", result.get("line_number", 0))
                    result_file_abs = os.path.abspath(result_file) if result_file else ""

                    if (method["name"] == result_func_name and
                        method_file_abs == result_file_abs and
                        method_lineno == result_lineno):
                        method_rank = i + 1
                        if method_key not in matched_methods:
                            search_result_ranks.append(method_rank)
                            matched_methods.add(method_key)
                            print(f"Matched method {method['name']} in class {class_info['name']} at rank {method_rank}")
                        break

                method["search_rank"] = method_rank

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

            # クラス内メソッドを検索順位でソート（順位がないものは末尾）
            class_info["methods"] = sorted(
                class_info["methods"],
                key=lambda m: m.get("search_rank") if m.get("search_rank") is not None else float("inf")
            )
        
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


@app.get("/settings")
async def get_settings():
    """現在の設定値を返すAPI"""
    return {
        "batch_size": settings.batch_size,
        "device": get_device(),
        "model_device": model_device
    }

class UpdateSettingsRequest(BaseModel):
    batch_size: Optional[int] = None

@app.post("/update_settings")
async def update_settings(req: UpdateSettingsRequest):
    """設定値を動的に更新するAPI"""
    if req.batch_size is not None:
        settings.batch_size = normalize_batch_size(req.batch_size)
    return {
        "message": "Settings updated",
        "batch_size": settings.batch_size
    }
