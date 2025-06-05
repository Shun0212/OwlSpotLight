import os
import json
from pathlib import Path
from threading import Lock
import faiss
import numpy as np
from typing import List, Dict, Any, Optional

class ClusterIndex:
    def __init__(self, name: str, path: Path):
        self.name = name
        self.path = path
        self.path.mkdir(parents=True, exist_ok=True)
        self.meta_path = path / "meta.json"
        self.index_path = path / "faiss.index"
        self.file_map_path = path / "file_map.json"
        self.last_update_path = path / "last_update.json"
        self.lock = Lock()
        self.meta = self._load_json(self.meta_path, default=[])  # List[dict]
        self.file_map = self._load_json(self.file_map_path, default={})  # file -> [func_id]
        self.last_update = self._load_json(self.last_update_path, default={})  # file -> mtime
        self.index = self._load_faiss_index()

    def _load_json(self, path: Path, default):
        if path.exists():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                print(f"Error loading {path}: {e}")
                return default
        return default

    def _save_json(self, path: Path, obj):
        self.path.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)

    def _load_faiss_index(self):
        if self.index_path.exists():
            try:
                return faiss.read_index(str(self.index_path))
            except Exception as e:
                print(f"Error loading FAISS index {self.index_path}: {e}")
                return None
        return None

    def save(self):
        with self.lock:
            self.path.mkdir(parents=True, exist_ok=True)
            self._save_json(self.meta_path, self.meta)
            self._save_json(self.file_map_path, self.file_map)
            self._save_json(self.last_update_path, self.last_update)
            if self.index is not None:
                try:
                    faiss.write_index(self.index, str(self.index_path))
                except Exception as e:
                    print(f"Error saving FAISS index {self.index_path}: {e}")

    def search(self, q_emb: np.ndarray, k: int):
        with self.lock:
            if self.index is None or len(self.meta) == 0:
                return []
            try:
                D, I = self.index.search(q_emb, min(k, len(self.meta)))
                results = []
                for i in I[0]:
                    if i != -1 and i < len(self.meta):
                        results.append(self.meta[i])
                return results
            except Exception as e:
                print(f"Error during search in cluster {self.name}: {e}")
                return []

    def is_up_to_date(self, files: List[str]) -> bool:
        """指定されたファイルリストに対してクラスタが最新かチェック"""
        with self.lock:
            for file_path in files:
                if not os.path.exists(file_path):
                    continue
                current_mtime = os.path.getmtime(file_path)
                if file_path not in self.last_update:
                    return False
                if abs(current_mtime - self.last_update[file_path]) > 1e-3:
                    return False
            return True

    def get_changed_files(self, files: List[str]) -> tuple[List[str], List[str]]:
        """追加・変更されたファイルと削除されたファイルを取得"""
        with self.lock:
            added_or_modified = []
            for file_path in files:
                if not os.path.exists(file_path):
                    continue
                current_mtime = os.path.getmtime(file_path)
                if (file_path not in self.last_update or 
                    abs(current_mtime - self.last_update[file_path]) > 1e-3):
                    added_or_modified.append(file_path)
            
            deleted = [f for f in self.last_update.keys() if f not in files or not os.path.exists(f)]
            return added_or_modified, deleted

    def update_files(self, added_funcs: List[Dict[str, Any]], deleted_files: List[str], 
                    embeddings: Optional[np.ndarray] = None):
        """ファイルの追加・削除に基づいてクラスタインデックスを更新"""
        with self.lock:
            # 削除処理
            if deleted_files:
                remove_indices = set()
                for file in deleted_files:
                    if file in self.file_map:
                        for func_idx in self.file_map[file]:
                            remove_indices.add(func_idx)
                        del self.file_map[file]
                    if file in self.last_update:
                        del self.last_update[file]
                
                if remove_indices:
                    # 削除対象以外のメタデータを保持
                    new_meta = []
                    old_to_new_idx = {}
                    new_idx = 0
                    for old_idx, func in enumerate(self.meta):
                        if old_idx not in remove_indices:
                            old_to_new_idx[old_idx] = new_idx
                            new_meta.append(func)
                            new_idx += 1
                    
                    self.meta = new_meta
                    
                    # ファイルマップのインデックスを更新
                    new_file_map = {}
                    for file, indices in self.file_map.items():
                        new_indices = []
                        for old_idx in indices:
                            if old_idx in old_to_new_idx:
                                new_indices.append(old_to_new_idx[old_idx])
                        if new_indices:
                            new_file_map[file] = new_indices
                    self.file_map = new_file_map
                    
                    # FAISSインデックスを再構築（削除された要素を除く）
                    if self.index is not None and len(self.meta) > 0:
                        # 残ったメタデータに対応する埋め込みを抽出して再構築
                        # 注意: この実装では埋め込みの再計算が必要
                        self.index = None  # 再構築が必要
            
            # 追加処理
            if added_funcs and embeddings is not None:
                start_idx = len(self.meta)
                self.meta.extend(added_funcs)
                
                # ファイルマップを更新
                for i, func in enumerate(added_funcs):
                    file_path = func.get('file')
                    if file_path:
                        if file_path not in self.file_map:
                            self.file_map[file_path] = []
                        self.file_map[file_path].append(start_idx + i)
                        # mtimeを更新
                        if os.path.exists(file_path):
                            self.last_update[file_path] = os.path.getmtime(file_path)
                
                # FAISSインデックスを更新
                if self.index is None:
                    if len(embeddings) > 0:
                        self.index = faiss.IndexFlatL2(embeddings.shape[1])
                        self.index.add(embeddings)
                else:
                    self.index.add(embeddings)
            
            self.save()

    def rebuild_from_functions(self, funcs: List[Dict[str, Any]], embeddings: Optional[np.ndarray] = None):
        """関数リストから完全にインデックスを再構築"""
        from tqdm import tqdm
        
        with self.lock:
            self.meta = funcs
            self.file_map = {}
            self.last_update = {}
            
            # ファイルマップとmtimeを構築
            print(f"🔄 Building file map for {len(funcs)} functions in cluster '{self.name}'...")
            for i, func in enumerate(tqdm(funcs, desc=f"Mapping functions ({self.name})", disable=len(funcs) < 10)):
                file_path = func.get('file')
                if file_path:
                    if file_path not in self.file_map:
                        self.file_map[file_path] = []
                    self.file_map[file_path].append(i)
                    if os.path.exists(file_path):
                        self.last_update[file_path] = os.path.getmtime(file_path)
            
            # FAISSインデックスを再構築
            if embeddings is not None and len(embeddings) > 0:
                print(f"🔄 Building FAISS index for cluster '{self.name}' with {len(embeddings)} embeddings...")
                self.index = faiss.IndexFlatL2(embeddings.shape[1])
                self.index.add(embeddings)
            else:
                self.index = None
            
            self.save()
        # 追加/更新: add_with_ids, 削除: remove_ids
        # meta, file_map, indexを更新
