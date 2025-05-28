import os
import json
from pathlib import Path
from threading import Lock
import faiss
import numpy as np
from typing import List, Dict, Any

class ClusterIndex:
    def __init__(self, name: str, path: Path):
        self.name = name
        self.path = path
        self.meta_path = path / "meta.json"
        self.index_path = path / "faiss.index"
        self.file_map_path = path / "file_map.json"
        self.lock = Lock()
        self.meta = self._load_json(self.meta_path, default=[])  # List[dict]
        self.file_map = self._load_json(self.file_map_path, default={})  # file -> [func_id]
        self.index = self._load_faiss_index()

    def _load_json(self, path: Path, default):
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        return default

    def _save_json(self, path: Path, obj):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)

    def _load_faiss_index(self):
        if self.index_path.exists():
            return faiss.read_index(str(self.index_path))
        return None

    def save(self):
        self._save_json(self.meta_path, self.meta)
        self._save_json(self.file_map_path, self.file_map)
        if self.index is not None:
            faiss.write_index(self.index, str(self.index_path))

    def search(self, q_emb: np.ndarray, k: int):
        with self.lock:
            if self.index is None:
                return []
            D, I = self.index.search(q_emb, k)
            return [self.meta[i] for i in I[0] if i != -1 and i < len(self.meta)]

    def update_files(self, added: List[Dict[str, Any]], deleted_files: List[str], embeddings: np.ndarray, ids: List[int]):
        # 追加/更新: add_with_ids, 削除: remove_ids
        # meta, file_map, indexを更新
        with self.lock:
            # 削除処理
            remove_ids = set()
            for file in deleted_files:
                if file in self.file_map:
                    remove_ids.update(self.file_map[file])
                    del self.file_map[file]
            if remove_ids and self.index is not None:
                remove_ids_list = list(remove_ids)
                self.index.remove_ids(np.array(remove_ids_list, dtype=np.int64))
                # metaからも削除
                self.meta = [m for i, m in enumerate(self.meta) if i not in remove_ids]
                # file_mapのfunc_idも再構成
                new_file_map = {}
                id_map = {}
                new_idx = 0
                for i, m in enumerate(self.meta):
                    id_map[i] = new_idx
                    new_idx += 1
                for file, ids in self.file_map.items():
                    new_file_map[file] = [id_map[i] for i in ids if i in id_map]
                self.file_map = new_file_map
            # 追加処理
            if len(added) > 0 and embeddings is not None and self.index is not None:
                start_id = len(self.meta)
                self.index.add_with_ids(embeddings, np.array(ids, dtype=np.int64))
                self.meta.extend(added)
                for i, item in enumerate(added):
                    file = item.get('file')
                    if file:
                        self.file_map.setdefault(file, []).append(ids[i])
            self.save()
