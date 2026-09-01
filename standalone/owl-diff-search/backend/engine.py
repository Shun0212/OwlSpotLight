"""Only changed code enters this search corpus."""
from __future__ import annotations

import hashlib
import time

from gitdiff import Repository, SearchError, make_hunks
from ranking import DenseRanker, rank_units
from symbols import changed_functions


class Engine:
    def __init__(self, git="git"):
        self.git = git
        self.dense = DenseRanker()
        self.documents = {}

    def search(self, request: dict, progress=lambda text: None) -> dict:
        started = time.monotonic()
        query = str(request.get("query", "")).strip()
        if len(query) > 8000:
            raise SearchError("検索文は 8,000 文字以内にしてください。")
        target = request.get("target", "hunks")
        if target not in {"hunks", "functions"}:
            raise SearchError("検索対象が不正です。")
        repo = Repository(request["directory"], self.git)
        snapshots, meta = repo.snapshots(request, progress)
        units = []
        for snap in snapshots:
            hunks = make_hunks(snap)
            pieces = hunks if target == "hunks" else changed_functions(snap, hunks)
            fingerprint = hashlib.sha256(
                "\0".join([str(repo.root), snap.base, snap.head, snap.commit, snap.path,
                            snap.old_text, snap.new_text]).encode("utf-8")
            ).hexdigest()
            for piece in pieces:
                item = dict(piece)
                item.update({"path": snap.path, "subject": snap.subject, "commit": snap.commit, "snapshot": snap})
                item["id"] = hashlib.sha256((fingerprint + piece["text"]).encode("utf-8")).hexdigest()[:24]
                units.append(item)
                if len(units) > 3000:
                    raise SearchError("検索対象が 3,000 件を超えます。比較範囲か対象ファイルを絞ってください。")
        mode = request.get("mode", "hybrid")
        progress(f"{len(units)} 件の変更を検索中")
        ranked = rank_units(units, query, mode, self.dense, progress)
        limit = max(1, min(200, int(request.get("limit", 30))))
        results, documents = [], {}
        for index, score, semantic, lexical in ranked[:limit]:
            item = units[index]
            snap = item["snapshot"]
            results.append({
                "id": item["id"], "path": item["path"], "title": item["title"],
                "preview": item["code"][:8000], "preview_truncated": len(item["code"]) > 8000,
                "old_line": item["old_line"], "new_line": item["new_line"], "side": item["side"],
                "added": len(item["added"]), "removed": len(item["removed"]),
                "score": round(score, 4), "semantic_score": semantic, "bm25_score": lexical,
                "commit": snap.commit, "subject": snap.subject, "target": target,
                "base": snap.base, "head": snap.head,
            })
            documents[item["id"]] = {
                "old_text": snap.old_text, "new_text": snap.new_text,
                "old_path": snap.old_path, "new_path": snap.new_path,
                "base": snap.base, "head": snap.head,
                "old_line": item["old_line"], "new_line": item["new_line"], "side": item["side"],
            }
        self.documents = documents
        return {"results": results, "total": len(ranked), "units": len(units),
                "mode": mode, "target": target, "directory": str(repo.root),
                "elapsed_ms": round((time.monotonic()-started)*1000), **meta}

    def document(self, result_id: str) -> dict:
        if result_id not in self.documents:
            raise SearchError("検索結果の有効期限が切れました。もう一度検索してください。")
        return self.documents[result_id]
