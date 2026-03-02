from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import torch
from threading import Lock
import os
from typing import List, Dict, Optional
import fnmatch
from concurrent.futures import ThreadPoolExecutor
from tqdm import tqdm
import faiss
import numpy as np
from pathspec import PathSpec
from pathspec.patterns import GitWildMatchPattern
import sys
import json
import hashlib
import io
import re
import tokenize
from pydantic_settings import BaseSettings
from dotenv import load_dotenv
import shutil
import time

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '.env'))

OWL_INDEX_DIR = ".owl_index"

from extractors import extract_functions
from indexer import CodeIndexer

# モデル管理を model.py から import
from model import get_model, get_current_device, cleanup_memory, encode_code, DEFAULT_MODEL, get_device

# グローバル変数
model_name = os.environ.get("OWL_MODEL_NAME", DEFAULT_MODEL)

app = FastAPI()

# === 設定: バッチサイズなど ===
class OwlSettings(BaseSettings):
    batch_size: int = 8
    
    class Config:
        env_prefix = "OWL_"  # 環境変数はOWL_BATCH_SIZEで設定可能

settings = OwlSettings()

class IndexStatus(BaseModel):
    directory: str
    indexed_files: List[str]
    last_indexed: float
    up_to_date: bool
    current_model_name: str
    indexed_model_name: str
    strip_comments_for_embeddings: bool

class BuildIndexRequest(BaseModel):
    directory: str
    file_ext: str = ".py"
    include_paths: List[str] = Field(default_factory=list)
    exclude_paths: List[str] = Field(default_factory=list)
    strip_comments_for_embeddings: bool = False

class SearchFunctionsSimpleRequest(BaseModel):
    directory: str
    query: str
    top_k: int = 5
    file_ext: str = ".py"
    include_paths: List[str] = Field(default_factory=list)
    exclude_paths: List[str] = Field(default_factory=list)
    strip_comments_for_embeddings: bool = False
    search_mode: str = "semantic"

class BatchSearchFunctionsRequest(BaseModel):
    directory: str
    queries: List[str]
    top_k: int = 5
    file_ext: str = ".py"
    include_paths: List[str] = Field(default_factory=list)
    exclude_paths: List[str] = Field(default_factory=list)
    strip_comments_for_embeddings: bool = False
    search_mode: str = "semantic"


# クラス統計表示用のリクエストモデル
class ClassStatsRequest(BaseModel):
    directory: str
    query: str  # 検索クエリ
    top_k: int = 50  # 上位何件の関数を取得するか
    file_ext: str = ".py"
    include_paths: List[str] = Field(default_factory=list)
    exclude_paths: List[str] = Field(default_factory=list)
    strip_comments_for_embeddings: bool = False
    search_mode: str = "semantic"

class OwlIgnoreManagerRequest(BaseModel):
    directory: str
    max_depth: int = 4
    ensure_initialized: bool = True
    include_tree: bool = True

class OwlIgnoreUpdateRequest(BaseModel):
    directory: str
    patterns: List[str] = Field(default_factory=list)
    max_depth: int = 4

# サーバー全体で1つのインデックスを保持
index_lock = Lock()

# インデックス情報を保持するクラス
class GlobalIndexerState:
    def __init__(self):
        self.indexer: Optional[CodeIndexer] = None
        self.file_info: Dict[str, Dict[str, float | str]] = {}  # mtimeとhashを保持
        self.directory: Optional[str] = None
        self.last_indexed: float = 0.0
        self.file_ext: str = ".py"
        self.include_paths: List[str] = []
        self.exclude_paths: List[str] = []
        self.strip_comments_for_embeddings: bool = False
        self.scope_signature: str = ""
        self.embeddings: Optional[np.ndarray] = None  # 追加: 関数埋め込み
        self.faiss_index: Optional[faiss.IndexFlatL2] = None  # 追加: FAISSインデックス
        self.index_dir = None  # ディレクトリごとに動的に設定
        self.model_name: Optional[str] = None  # 追加: インデックス構築に使用したモデル名
        self.model_config: dict = {}  # 追加: モデル構成情報

    def get_current_model_config(self) -> dict:
        # Add new config keys here as needed for extensibility
        return {
            "model_name": model_name,
            # e.g. add more: "embedding_dim": ..., "other_param": ...
        }

    def set_index_dir(self, directory: str, file_ext: str = ".py"):
        dir_hash = hashlib.md5(os.path.abspath(directory).encode()).hexdigest()[:16]
        safe_dir = os.path.basename(os.path.abspath(directory))
        ext_dir = file_ext.lstrip(".")
        # Create index inside model_server (avoid duplication by using directory name + hash)
        model_server_dir = os.path.dirname(os.path.abspath(__file__))
        self.index_dir = os.path.join(model_server_dir, OWL_INDEX_DIR, f"{safe_dir}_{dir_hash}", ext_dir)
        # Directory creation is only done on save (not on startup)

    def is_up_to_date(
        self,
        directory: Optional[str] = None,
        include_paths: Optional[List[str]] = None,
        exclude_paths: Optional[List[str]] = None,
        strip_comments_for_embeddings: bool = False
    ) -> bool:
        # If directory argument is specified, compare it with self.directory
        if directory is not None:
            if os.path.abspath(directory) != os.path.abspath(self.directory or ""):
                print(f"[is_up_to_date] Directory mismatch: {directory} != {self.directory}")
                return False
        normalized_include = normalize_scope_patterns(include_paths)
        normalized_exclude = normalize_scope_patterns(exclude_paths)
        if self.include_paths != normalized_include:
            print(f"[is_up_to_date] include_paths mismatch: {self.include_paths} != {normalized_include}")
            return False
        if self.exclude_paths != normalized_exclude:
            print(f"[is_up_to_date] exclude_paths mismatch: {self.exclude_paths} != {normalized_exclude}")
            return False
        if bool(self.strip_comments_for_embeddings) != bool(strip_comments_for_embeddings):
            print(
                f"[is_up_to_date] strip_comments_for_embeddings mismatch: "
                f"{self.strip_comments_for_embeddings} != {strip_comments_for_embeddings}"
            )
            return False
        current_model_config = self.get_current_model_config()
        if self.model_config and self.model_config != current_model_config:
            print(f"[is_up_to_date] Model config mismatch: {self.model_config} != {current_model_config}")
            return False
        if not self.directory:
            print("[is_up_to_date] self.directory is None")
            return False
        current_scope_signature = compute_scope_signature(os.path.abspath(self.directory), self.exclude_paths)
        if self.scope_signature != current_scope_signature:
            print("[is_up_to_date] ignore scope signature changed")
            return False
        # If file info is empty, consider it outdated
        if not self.file_info:
            print("[is_up_to_date] file_info is empty")
            return False
        # Compare hash values (for speed, only log changed files)
        changed_files = []
        for path, info in self.file_info.items():
            if not os.path.exists(path):
                print(f"[is_up_to_date] File missing: {path}")
                return False
            hash_now = file_hash(path)
            if hash_now != info["hash"]:
                changed_files.append(path)
        if changed_files:
            print(f"[is_up_to_date] {len(changed_files)} files changed: {changed_files[:3]}{'...' if len(changed_files) > 3 else ''}")
            return False
        # Detect newly added files that match the target extension and are not ignored
        try:
            scan_dir = os.path.abspath(self.directory)
            spec = load_ignore_spec(scan_dir, self.exclude_paths)
            for root, dirs, files in os.walk(scan_dir):
                # Respect ignore files for directories
                dirs[:] = [d for d in dirs if not is_ignored(os.path.join(root, d), spec, scan_dir)]
                for fname in files:
                    if not fname.endswith(self.file_ext):
                        continue
                    fpath = os.path.join(root, fname)
                    if is_ignored(fpath, spec, scan_dir):
                        continue
                    if not is_included(fpath, scan_dir, self.include_paths):
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
        self.include_paths = []
        self.exclude_paths = []
        self.strip_comments_for_embeddings = False
        self.scope_signature = ""
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
            "include_paths": self.include_paths,
            "exclude_paths": self.exclude_paths,
            "strip_comments_for_embeddings": self.strip_comments_for_embeddings,
            "scope_signature": self.scope_signature,
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
            self.include_paths = []
            self.exclude_paths = []
            self.strip_comments_for_embeddings = False
            self.scope_signature = ""
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
            self.include_paths = normalize_scope_patterns(meta.get("include_paths", []))
            self.exclude_paths = normalize_scope_patterns(meta.get("exclude_paths", []))
            self.strip_comments_for_embeddings = bool(meta.get("strip_comments_for_embeddings", False))
            self.scope_signature = meta.get("scope_signature", "")
            self.model_name = meta.get("model_name")
            self.model_config = meta.get("model_config", {"model_name": self.model_name})
            loaded_items.append(f"meta({len(self.file_info)} files)")
        except Exception as e:
            print(f"[load] Failed to load meta.json: {e}")
            self.file_info = {}
            self.directory = None
            self.last_indexed = 0.0
            self.file_ext = ".py"
            self.include_paths = []
            self.exclude_paths = []
            self.strip_comments_for_embeddings = False
            self.scope_signature = ""
            self.model_name = None
            self.model_config = {}
        if loaded_items:
            print(f"[load] Load complete: {', '.join(loaded_items)}")
        else:
            print("[load] Failed to load any cache files")

global_index_state = GlobalIndexerState()
# サーバー起動時は自動ロードを行わない（メモリキャッシュ優先、必要時のみディスクアクセス）

def normalize_scope_patterns(patterns: Optional[List[str]]) -> List[str]:
    if not patterns:
        return []
    normalized: List[str] = []
    for pattern in patterns:
        if not isinstance(pattern, str):
            continue
        cleaned = pattern.strip().replace("\\", "/")
        if cleaned.startswith("./"):
            cleaned = cleaned[2:]
        cleaned = cleaned.lstrip("/")
        if cleaned:
            normalized.append(cleaned)
    return sorted(set(normalized))


DEFAULT_OWLIGNORE_PATTERNS = [
    "node_modules/",
    "out/",
    "dist/",
    "build/",
    ".venv/",
    "__pycache__/",
    ".owl_index/"
]


SCOPE_STORE_DIR = ".owl_scope"


def _workspace_scope_key(root_dir: str) -> str:
    abs_root = os.path.abspath(root_dir)
    dir_hash = hashlib.md5(abs_root.encode()).hexdigest()[:16]
    safe_dir = os.path.basename(abs_root) or "workspace"
    return f"{safe_dir}_{dir_hash}"


def get_owlignore_path(root_dir: str) -> str:
    model_server_dir = os.path.dirname(os.path.abspath(__file__))
    store_dir = os.path.join(model_server_dir, SCOPE_STORE_DIR)
    os.makedirs(store_dir, exist_ok=True)
    return os.path.join(store_dir, f"{_workspace_scope_key(root_dir)}.json")


def read_gitignore_patterns(root_dir: str) -> List[str]:
    gitignore_path = os.path.join(root_dir, ".gitignore")
    if not os.path.exists(gitignore_path):
        return []
    with open(gitignore_path, encoding="utf-8") as f:
        lines = [
            ln.rstrip("\n")
            for ln in f
            if ln.strip() and not ln.strip().startswith("#")
        ]
    return normalize_scope_patterns(lines)


def read_owlignore_patterns(root_dir: str) -> List[str]:
    store_path = get_owlignore_path(root_dir)
    if not os.path.exists(store_path):
        return []
    try:
        with open(store_path, encoding="utf-8") as f:
            payload = json.load(f)
        return normalize_scope_patterns(payload.get("patterns", []))
    except Exception as e:
        print(f"[read_owlignore_patterns] Failed to read {store_path}: {e}")
        return []


def write_owlignore_patterns(root_dir: str, patterns: List[str]):
    store_path = get_owlignore_path(root_dir)
    normalized = normalize_scope_patterns(patterns)
    payload = {
        "directory": os.path.abspath(root_dir),
        "patterns": normalized,
        "updated_at": time.time()
    }
    tmp = store_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, store_path)


def ensure_owlignore_file(root_dir: str):
    existing = read_owlignore_patterns(root_dir)
    if existing:
        return existing
    defaults = read_gitignore_patterns(root_dir)
    if not defaults:
        defaults = DEFAULT_OWLIGNORE_PATTERNS
    write_owlignore_patterns(root_dir, defaults)
    return normalize_scope_patterns(defaults)


def build_directory_tree(root_dir: str, patterns: List[str], max_depth: int = 4, max_nodes: int = 1500):
    root_dir = os.path.abspath(root_dir)
    max_depth = max(1, min(int(max_depth or 4), 12))
    node_count = 0
    scope_spec = PathSpec.from_lines(GitWildMatchPattern, patterns) if patterns else None

    def is_checked(rel_path: str) -> bool:
        if scope_spec is None:
            return False
        rp = rel_path.replace("\\", "/")
        return scope_spec.match_file(rp) or scope_spec.match_file(f"{rp}/")

    def walk(abs_dir: str, depth: int):
        nonlocal node_count
        if depth > max_depth or node_count >= max_nodes:
            return []
        entries = []
        try:
            with os.scandir(abs_dir) as it:
                for entry in it:
                    if not entry.is_dir(follow_symlinks=False):
                        continue
                    if entry.name in [".git", ".svn", ".hg"]:
                        continue
                    rel_path = os.path.relpath(entry.path, root_dir).replace("\\", "/")
                    node_count += 1
                    node = {
                        "name": entry.name,
                        "rel_path": rel_path,
                        "checked": is_checked(rel_path),
                        "children": []
                    }
                    if depth < max_depth and node_count < max_nodes:
                        node["children"] = walk(entry.path, depth + 1)
                    entries.append(node)
                    if node_count >= max_nodes:
                        break
        except Exception as e:
            print(f"[build_directory_tree] Failed to scan {abs_dir}: {e}")
            return []
        entries.sort(key=lambda x: x["name"].lower())
        return entries

    root_node = {
        "name": os.path.basename(root_dir) or root_dir,
        "rel_path": ".",
        "checked": False,
        "children": walk(root_dir, 1)
    }
    return root_node


def collect_scope_patterns(root_dir: str, extra_excludes: Optional[List[str]] = None) -> List[str]:
    lines: List[str] = []
    lines.extend(read_gitignore_patterns(root_dir))
    lines.extend(read_owlignore_patterns(root_dir))
    lines.extend(normalize_scope_patterns(extra_excludes))
    return normalize_scope_patterns(lines)


def compute_scope_signature(root_dir: str, extra_excludes: Optional[List[str]] = None) -> str:
    patterns = collect_scope_patterns(root_dir, extra_excludes)
    payload = "\n".join(patterns)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def load_ignore_spec(root_dir: str, extra_excludes: Optional[List[str]] = None) -> Optional[PathSpec]:
    """
    .gitignore とサーバー管理の .owlignore パターンを統合して読み込む。
    GUI 由来の除外パターンは extra_excludes として追加できる。
    """
    lines = collect_scope_patterns(root_dir, extra_excludes)
    if not lines:
        return None
    return PathSpec.from_lines(GitWildMatchPattern, lines)


def is_included(path: str, root_dir: str, include_patterns: Optional[List[str]] = None) -> bool:
    normalized = normalize_scope_patterns(include_patterns)
    if not normalized:
        return True
    rel_path = os.path.relpath(path, root_dir).replace("\\", "/")
    for pattern in normalized:
        if fnmatch.fnmatch(rel_path, pattern):
            return True
        # フォルダ指定 (例: src) でも配下を対象にする
        if rel_path == pattern or rel_path.startswith(f"{pattern.rstrip('/')}/"):
            return True
    return False

def is_ignored(path: str, spec: Optional[PathSpec], root_dir: str) -> bool:
    if spec is None:
        return False
    rel_path = os.path.relpath(path, root_dir).replace("\\", "/")
    if spec.match_file(rel_path):
        return True
    # `dir/` パターンに対応するため、ディレクトリは末尾スラッシュでも判定する。
    if os.path.isdir(path):
        return spec.match_file(f"{rel_path}/")
    return False


_C_BLOCK_COMMENT_RE = re.compile(r"/\*[\s\S]*?\*/")
_CPP_LINE_COMMENT_RE = re.compile(r"//.*?$", re.MULTILINE)


def strip_python_comments_and_docstrings(code: str) -> str:
    if not code:
        return code
    out: List[str] = []
    prev_toktype = tokenize.INDENT
    last_lineno = 1
    last_col = 0
    try:
        token_stream = tokenize.generate_tokens(io.StringIO(code).readline)
    except Exception:
        return code

    for tok in token_stream:
        tok_type = tok.type
        tok_text = tok.string
        (start_line, start_col) = tok.start
        (end_line, end_col) = tok.end
        if tok_type == tokenize.COMMENT:
            prev_toktype = tok_type
            last_lineno, last_col = end_line, end_col
            continue
        # module/class/function level docstrings
        if tok_type == tokenize.STRING and prev_toktype in (
            tokenize.INDENT,
            tokenize.DEDENT,
            tokenize.NEWLINE,
            tokenize.NL,
            tokenize.ENCODING,
        ):
            prev_toktype = tok_type
            last_lineno, last_col = end_line, end_col
            continue
        if start_line > last_lineno:
            last_col = 0
        if start_col > last_col:
            out.append(" " * (start_col - last_col))
        out.append(tok_text)
        prev_toktype = tok_type
        last_lineno, last_col = end_line, end_col
    return "".join(out)


def strip_c_style_comments(code: str) -> str:
    if not code:
        return code
    no_block = _C_BLOCK_COMMENT_RE.sub("", code)
    return _CPP_LINE_COMMENT_RE.sub("", no_block)


def strip_comments_for_embedding_text(text: str, file_ext: str) -> str:
    if not text:
        return text
    ext = (file_ext or "").lower()
    if ext == ".py":
        stripped = strip_python_comments_and_docstrings(text)
    elif ext in {".ts", ".tsx", ".js", ".jsx", ".java", ".c", ".cc", ".cpp", ".h", ".hpp"}:
        stripped = strip_c_style_comments(text)
    else:
        stripped = text
    return stripped if stripped.strip() else text


def prepare_text_for_embedding(text: str, file_ext: str, strip_comments_for_embeddings: bool) -> str:
    if not strip_comments_for_embeddings:
        return text
    return strip_comments_for_embedding_text(text, file_ext)


_TOKEN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*|\d+")
_CAMEL_RE = re.compile(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|\d+")


def normalize_search_mode(search_mode: Optional[str]) -> str:
    mode = (search_mode or "semantic").strip().lower()
    if mode in {"bm25", "keyword", "lexical"}:
        return "bm25"
    return "semantic"


def tokenize_bm25_text(text: str) -> List[str]:
    if not text:
        return []
    tokens: List[str] = []
    for raw in _TOKEN_RE.findall(text):
        if not raw:
            continue
        lower_raw = raw.lower()
        tokens.append(lower_raw)
        for part in raw.split("_"):
            if not part:
                continue
            camel_parts = _CAMEL_RE.findall(part)
            if camel_parts:
                for cp in camel_parts:
                    cp_l = cp.lower()
                    if cp_l and cp_l != lower_raw:
                        tokens.append(cp_l)
    return tokens


def function_text_for_bm25(
    func: dict,
    file_ext: str,
    strip_comments_for_embeddings: bool = False
) -> str:
    code_text = str(func.get("code", "") or "")
    if strip_comments_for_embeddings:
        code_text = prepare_text_for_embedding(code_text, file_ext, True)

    # Python docstring等のコメント相当テキストは除外モード時にBM25対象外にする
    docstring_text = str(func.get("docstring", "") or "")
    if strip_comments_for_embeddings:
        docstring_text = ""

    return "\n".join(
        str(part) for part in [
            func.get("name", ""),
            func.get("function_name", ""),
            func.get("class_name", ""),
            docstring_text,
            code_text,
        ] if part
    )


def bm25_search_functions(
    functions: List[dict],
    query: str,
    top_k: int,
    file_ext: str = ".py",
    strip_comments_for_embeddings: bool = False
) -> List[dict]:
    if not functions or not query.strip() or top_k <= 0:
        return []

    doc_lens: List[int] = []
    postings: Dict[str, List[tuple[int, int]]] = {}
    doc_count = len(functions)

    for idx, func in enumerate(functions):
        tokens = tokenize_bm25_text(
            function_text_for_bm25(
                func,
                file_ext=file_ext,
                strip_comments_for_embeddings=strip_comments_for_embeddings
            )
        )
        doc_lens.append(len(tokens))
        if not tokens:
            continue
        tf: Dict[str, int] = {}
        for t in tokens:
            tf[t] = tf.get(t, 0) + 1
        for term, freq in tf.items():
            postings.setdefault(term, []).append((idx, freq))

    if not postings:
        return []

    avgdl = (sum(doc_lens) / doc_count) if doc_count > 0 else 0.0
    if avgdl <= 0:
        avgdl = 1.0

    # Robertson/Sparck Jones idf
    idf: Dict[str, float] = {}
    for term, plist in postings.items():
        df = len(plist)
        idf[term] = float(np.log(1.0 + ((doc_count - df + 0.5) / (df + 0.5))))

    k1 = 1.5
    b = 0.75
    scores: Dict[int, float] = {}

    query_text = prepare_text_for_embedding(query, file_ext, strip_comments_for_embeddings)
    query_terms = tokenize_bm25_text(query_text)
    if not query_terms:
        return []

    for term in query_terms:
        plist = postings.get(term)
        if not plist:
            continue
        term_idf = idf.get(term, 0.0)
        if term_idf <= 0:
            continue
        for doc_idx, tf in plist:
            dl = max(doc_lens[doc_idx], 1)
            denom = tf + k1 * (1.0 - b + b * (dl / avgdl))
            if denom <= 0:
                continue
            score = term_idf * (tf * (k1 + 1.0)) / denom
            scores[doc_idx] = scores.get(doc_idx, 0.0) + score

    if not scores:
        return []

    ranked = sorted(scores.items(), key=lambda x: (-x[1], x[0]))[:top_k]
    return [functions[idx] for idx, _ in ranked]

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

# ディレクトリ内の全ファイルから関数抽出・インデックス作成（一時的なインデックス、状態保存なし）
def build_index(
    directory: str,
    file_ext: str = ".py",
    max_workers: int = 8,
    update_state: bool = False,
    include_paths: Optional[List[str]] = None,
    exclude_paths: Optional[List[str]] = None,
    strip_comments_for_embeddings: bool = False
):
    def func_id(func):
        # ファイルパス・関数名・lineno・end_linenoを組み合わせて一意なIDを生成
        key = f"{func.get('file','')}|{func.get('name','')}|{func.get('lineno','')}|{func.get('end_lineno','')}"
        return hashlib.sha256(key.encode()).hexdigest()

    directory = os.path.abspath(directory)
    include_patterns = normalize_scope_patterns(include_paths)
    exclude_patterns = normalize_scope_patterns(exclude_paths)
    current_scope_signature = compute_scope_signature(directory, exclude_patterns)
    current_model_config = global_index_state.get_current_model_config()

    # 1. まずメモリキャッシュが有効かつ up_to_date なら即リターン（メモリのみ）
    if (
        global_index_state.indexer is not None and 
        global_index_state.directory == directory and
        global_index_state.file_ext == file_ext and
        global_index_state.is_up_to_date(
            directory=directory,
            include_paths=include_patterns,
            exclude_paths=exclude_patterns,
            strip_comments_for_embeddings=strip_comments_for_embeddings
        )
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
        global_index_state.is_up_to_date(
            directory=directory,
            include_paths=include_patterns,
            exclude_paths=exclude_patterns,
            strip_comments_for_embeddings=strip_comments_for_embeddings
        ) and
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

    strip_mode_changed = bool(global_index_state.strip_comments_for_embeddings) != bool(strip_comments_for_embeddings)
    if strip_mode_changed:
        print(
            "[build_index] strip_comments_for_embeddings changed: "
            f"{global_index_state.strip_comments_for_embeddings} -> {strip_comments_for_embeddings}"
        )
    spec = load_ignore_spec(directory, exclude_patterns)
    file_paths = []
    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if not is_ignored(os.path.join(root, d), spec, directory)]
        for fname in files:
            if not fname.endswith(file_ext):
                continue
            fpath = os.path.join(root, fname)
            if is_ignored(fpath, spec, directory):
                continue
            if not is_included(fpath, directory, include_patterns):
                continue
            file_paths.append(fpath)

    # ハッシュ値のみで判定
    new_info = {f: {"hash": file_hash(f)} for f in file_paths}
    added_or_modified = [f for f in file_paths if f not in prev_info or prev_info[f]["hash"] != new_info[f]["hash"]]
    unchanged = [f for f in file_paths if f in prev_info and prev_info[f]["hash"] == new_info[f]["hash"]]
    deleted = [f for f in prev_info if f not in new_info]

    # 変更・削除ゼロなら何もしないで戻る（キャッシュ再利用）
    if (
        update_state and
        not added_or_modified and
        not deleted and
        global_index_state.indexer is not None and
        not strip_mode_changed
    ):
        print(f"[build_index] No changes – reusing cache (funcs={len(global_index_state.indexer.functions)}, files={len(global_index_state.file_info)})")
        return (
            global_index_state.indexer.functions,
            len(global_index_state.file_info),
            global_index_state.indexer,
        )
    
    print(f"[build_index] File changes detected: added/modified={len(added_or_modified)}, deleted={len(deleted)}, unchanged={len(unchanged)}")

    # 追加・変更ファイルのみ再抽出
    def process_file(fpath):
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
        if len(added_or_modified) < 16:
            for fpath in tqdm(added_or_modified, desc="Indexing (serial, diff)", disable=False, file=sys.stdout):
                funcs = process_file(fpath)
                added_modified_funcs.extend(funcs)
                file_to_funcs[fpath] = funcs
                for func in funcs:
                    results.append(func)
                    results_func_ids.append(func_id(func))
        else:
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                for res, fpath in zip(
                    tqdm(executor.map(process_file, added_or_modified), total=len(added_or_modified), desc="Indexing (parallel, diff)", disable=False, file=sys.stdout),
                    added_or_modified
                ):
                    added_modified_funcs.extend(res)
                    file_to_funcs[fpath] = res
                    for func in res:
                        results.append(func)
                        results_func_ids.append(func_id(func))

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
        if (
            not strip_mode_changed and
            prev_indexer and
            global_index_state.embeddings is not None and
            global_index_state.faiss_index is not None and
            keep_indices
        ):
            prev_embeddings = global_index_state.embeddings
            kept_embeddings = prev_embeddings[keep_indices] if keep_indices else np.zeros((0, prev_embeddings.shape[1]), dtype=prev_embeddings.dtype)
            # 新規分のみ埋め込み
            if new_func_indices:
                new_codes = [
                    prepare_text_for_embedding(
                        results[i]["code"],
                        file_ext,
                        strip_comments_for_embeddings
                    )
                    for i in new_func_indices
                ]
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
                codes = [
                    prepare_text_for_embedding(code, file_ext, strip_comments_for_embeddings)
                    for code in codes
                ]
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
        global_index_state.include_paths = include_patterns
        global_index_state.exclude_paths = exclude_patterns
        global_index_state.strip_comments_for_embeddings = bool(strip_comments_for_embeddings)
        global_index_state.scope_signature = current_scope_signature
        global_index_state.last_indexed = float(__import__('time').time())
        global_index_state.file_info = new_info
        global_index_state.model_name = model_name
        global_index_state.save()
    else:
        indexer = CodeIndexer()
        indexer.add_functions_without_embedding(results)  # 埋め込み計算なしで関数リストのみ追加
    return results, len(file_paths), indexer

@app.post("/build_index")
async def build_index_api(req: BuildIndexRequest):
    print(f"/build_index called for directory: {req.directory}")
    with index_lock:
        results, file_count, _ = build_index(
            req.directory,
            req.file_ext,
            update_state=True,
            include_paths=req.include_paths,
            exclude_paths=req.exclude_paths,
            strip_comments_for_embeddings=req.strip_comments_for_embeddings
        )
    return {"num_functions": len(results), "num_files": file_count}

@app.post("/force_rebuild_index")
async def force_rebuild_index_api(req: BuildIndexRequest):
    """キャッシュをクリアして強制的にインデックスを再構築"""
    print(f"/force_rebuild_index called for directory: {req.directory}")
    with index_lock:
        global_index_state.clear_cache(clear_disk=True)
        results, file_count, _ = build_index(
            req.directory,
            req.file_ext,
            update_state=True,
            include_paths=req.include_paths,
            exclude_paths=req.exclude_paths,
            strip_comments_for_embeddings=req.strip_comments_for_embeddings
        )
    return {"num_functions": len(results), "num_files": file_count, "message": "Index forcefully rebuilt"}

@app.get("/index_status")
async def index_status():
    print("/index_status called")
    # If no directory is set, consider it up to date (no index to check)
    if global_index_state.directory is None:
        up_to_date = True
    else:
        up_to_date = global_index_state.is_up_to_date(
            directory=global_index_state.directory,
            include_paths=global_index_state.include_paths,
            exclude_paths=global_index_state.exclude_paths,
            strip_comments_for_embeddings=global_index_state.strip_comments_for_embeddings
        )
    return IndexStatus(
        directory=global_index_state.directory or "",
        indexed_files=list(global_index_state.file_info.keys()),
        last_indexed=global_index_state.last_indexed,
        up_to_date=up_to_date,
        current_model_name=model_name,
        indexed_model_name=global_index_state.model_name or model_name,
        strip_comments_for_embeddings=bool(global_index_state.strip_comments_for_embeddings)
    )


@app.post("/owlignore_manager_data")
async def owlignore_manager_data(req: OwlIgnoreManagerRequest):
    directory = os.path.abspath(req.directory)
    if not os.path.isdir(directory):
        raise HTTPException(status_code=400, detail=f"Directory not found: {directory}")

    gitignore_patterns = read_gitignore_patterns(directory)
    if req.ensure_initialized:
        patterns = ensure_owlignore_file(directory)
    else:
        patterns = read_owlignore_patterns(directory)

    payload = {
        "directory": directory,
        "owlignore_path": get_owlignore_path(directory),
        "patterns": patterns,
        "exists": os.path.exists(get_owlignore_path(directory)),
        "default_patterns": gitignore_patterns
    }
    if req.include_tree:
        payload["tree"] = build_directory_tree(directory, patterns, req.max_depth)
    return payload


@app.post("/update_owlignore")
async def update_owlignore(req: OwlIgnoreUpdateRequest):
    directory = os.path.abspath(req.directory)
    if not os.path.isdir(directory):
        raise HTTPException(status_code=400, detail=f"Directory not found: {directory}")
    write_owlignore_patterns(directory, req.patterns)
    patterns = read_owlignore_patterns(directory)
    return {
        "directory": directory,
        "owlignore_path": get_owlignore_path(directory),
        "patterns": patterns,
        "exists": True,
        "tree": build_directory_tree(directory, patterns, req.max_depth)
    }


def search_functions_for_queries(
    directory: str,
    queries: List[str],
    file_ext: str = ".py",
    top_k: int = 5,
    max_workers: int = 8,
    include_paths: Optional[List[str]] = None,
    exclude_paths: Optional[List[str]] = None,
    strip_comments_for_embeddings: bool = False,
    search_mode: str = "semantic"
):
    results, file_count, _ = build_index(
        directory,
        file_ext,
        max_workers,
        update_state=True,
        include_paths=include_paths,
        exclude_paths=exclude_paths,
        strip_comments_for_embeddings=strip_comments_for_embeddings
    )
    # build_index後のキャッシュ状態をprint
    print("indexer_exists:", global_index_state.indexer is not None)
    print(
        "up_to_date:",
        global_index_state.is_up_to_date(
            directory=directory,
            include_paths=include_paths,
            exclude_paths=exclude_paths,
            strip_comments_for_embeddings=strip_comments_for_embeddings
        )
    )
    print("embeddings_cached:", global_index_state.embeddings is not None)
    print("file_ext:", global_index_state.file_ext)
    embeddings = global_index_state.embeddings
    faiss_index = global_index_state.faiss_index
    normalized_search_mode = normalize_search_mode(search_mode)

    cleaned_queries = [q.strip() for q in queries if isinstance(q, str) and q.strip()]
    if not results:
        return {
            "items": [{"query": q, "results": []} for q in cleaned_queries],
            "num_functions": len(results),
            "num_files": file_count,
            "message": "No functions found."
        }
    if not cleaned_queries:
        return {"items": [], "num_functions": len(results), "num_files": file_count}

    if normalized_search_mode == "bm25":
        items = []
        for query in cleaned_queries:
            found = bm25_search_functions(
                results,
                query,
                top_k,
                file_ext=file_ext,
                strip_comments_for_embeddings=strip_comments_for_embeddings
            )
            items.append({"query": query, "results": found})
        return {"items": items, "num_functions": len(results), "num_files": file_count, "search_mode": "bm25"}

    if embeddings is None or faiss_index is None:
        return {
            "items": [{"query": q, "results": []} for q in cleaned_queries],
            "num_functions": len(results),
            "num_files": file_count,
            "message": "No embedding index found."
        }

    items = []
    for query in cleaned_queries:
        embedding_query = prepare_text_for_embedding(query, file_ext, strip_comments_for_embeddings)
        query_embedding = encode_code([embedding_query], batch_size=1, show_progress=False)
        _, indices = faiss_index.search(query_embedding, top_k)
        found = []
        for idx in indices[0]:
            if 0 <= idx < len(results):
                found.append(results[idx])
        items.append({"query": query, "results": found})
    return {"items": items, "num_functions": len(results), "num_files": file_count, "search_mode": "semantic"}


def build_index_and_search(
    directory: str,
    query: str,
    file_ext: str = ".py",
    top_k: int = 5,
    max_workers: int = 8,
    include_paths: Optional[List[str]] = None,
    exclude_paths: Optional[List[str]] = None,
    strip_comments_for_embeddings: bool = False,
    search_mode: str = "semantic"
):
    searched = search_functions_for_queries(
        directory=directory,
        queries=[query],
        file_ext=file_ext,
        top_k=top_k,
        max_workers=max_workers,
        include_paths=include_paths,
        exclude_paths=exclude_paths,
        strip_comments_for_embeddings=strip_comments_for_embeddings,
        search_mode=search_mode
    )
    items = searched.get("items", [])
    first_results = items[0]["results"] if items else []
    payload = {
        "results": first_results,
        "num_functions": searched.get("num_functions", 0),
        "num_files": searched.get("num_files", 0),
        "search_mode": searched.get("search_mode", normalize_search_mode(search_mode))
    }
    if "message" in searched:
        payload["message"] = searched["message"]
    return payload

@app.post("/search_functions_simple")
async def search_functions_simple_api(req: SearchFunctionsSimpleRequest):
    with index_lock:
        return build_index_and_search(
            directory=req.directory,
            query=req.query,
            file_ext=req.file_ext,
            top_k=req.top_k,
            include_paths=req.include_paths,
            exclude_paths=req.exclude_paths,
            strip_comments_for_embeddings=req.strip_comments_for_embeddings,
            search_mode=req.search_mode
        )


@app.post("/search_functions_batch")
async def search_functions_batch_api(req: BatchSearchFunctionsRequest):
    with index_lock:
        return search_functions_for_queries(
            directory=req.directory,
            queries=req.queries,
            file_ext=req.file_ext,
            top_k=req.top_k,
            include_paths=req.include_paths,
            exclude_paths=req.exclude_paths,
            strip_comments_for_embeddings=req.strip_comments_for_embeddings,
            search_mode=req.search_mode
        )



@app.post("/get_class_stats")
async def get_class_stats(request: ClassStatsRequest):
    try:
        with index_lock:
            search_response = search_functions_for_queries(
                directory=request.directory,
                queries=[request.query],
                top_k=request.top_k,
                file_ext=request.file_ext,
                include_paths=request.include_paths,
                exclude_paths=request.exclude_paths,
                strip_comments_for_embeddings=request.strip_comments_for_embeddings,
                search_mode=request.search_mode
            )
            all_functions, _, _ = build_index(
                request.directory,
                request.file_ext,
                update_state=True,
                include_paths=request.include_paths,
                exclude_paths=request.exclude_paths,
                strip_comments_for_embeddings=request.strip_comments_for_embeddings
            )
        search_items = search_response.get("items", [])
        search_results = search_items[0]["results"] if search_items else []

        # 表示ロジックの都合で file_path を付与
        for func in all_functions:
            if "file_path" not in func:
                func["file_path"] = func.get("file", "")
        
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
        "device": get_device()
    }

class UpdateSettingsRequest(BaseModel):
    batch_size: Optional[int] = None

@app.post("/update_settings")
async def update_settings(req: UpdateSettingsRequest):
    """設定値を動的に更新するAPI"""
    if req.batch_size is not None:
        settings.batch_size = req.batch_size
    return {
        "message": "Settings updated",
        "batch_size": settings.batch_size
    }
