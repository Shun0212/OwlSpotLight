"""Local JSON-lines subprocess, with stdout reserved for the protocol."""
from __future__ import annotations

import contextlib
import json
import os
import sys
import traceback

from engine import Engine
from gitdiff import Repository, SearchError


def send(payload):
    sys.__stdout__.write(json.dumps(payload, ensure_ascii=True, allow_nan=False) + "\n")
    sys.__stdout__.flush()


def main():
    engine = Engine(os.environ.get("OWL_DIFF_GIT", "git"))
    send({"event": "ready", "version": "0.1.0"})
    for line in sys.stdin:
        request_id = None
        try:
            if len(line) > 200000:
                raise SearchError("リクエストが大きすぎます。")
            request = json.loads(line)
            request_id = request["id"]
            method = request["method"]
            params = request.get("params", {})
            progress = lambda message: send({"event": "progress", "id": request_id, "message": message})
            with contextlib.redirect_stdout(sys.stderr):
                if method == "search":
                    result = engine.search(params, progress)
                elif method == "refs":
                    result = Repository(params["directory"], engine.git).refs()
                elif method == "document":
                    result = engine.document(params["result_id"])
                elif method == "warmup":
                    progress("NightOwl モデルを準備中（初回はダウンロードします）")
                    engine.dense.warmup()
                    result = {"ready": True}
                else:
                    raise SearchError("不明な操作です。")
            send({"id": request_id, "result": result})
        except Exception as error:
            if not isinstance(error, SearchError):
                traceback.print_exc(file=sys.stderr)
            send({"id": request_id, "error": {"message": str(error), "type": type(error).__name__}})


if __name__ == "__main__":
    main()
