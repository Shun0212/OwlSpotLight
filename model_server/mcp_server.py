#!/usr/bin/env python3
"""Minimal MCP stdio bridge for the OwlSpotlight local search server."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


PROTOCOL_VERSION = "2025-06-18"
DEFAULT_SERVER_URL = os.environ.get("OWLSPOTLIGHT_SERVER_URL", "http://127.0.0.1:8000")
SOURCE_DIR_NAMES = {
    "src",
    "app",
    "lib",
    "packages",
    "components",
    "server",
    "client",
    "backend",
    "frontend",
}


def write_message(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def response(request_id: str | int, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def error_response(request_id: str | int | None, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def post_json(url: str, payload: dict[str, Any], timeout: float = 120.0) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def changed_files(directory: str, file_ext: str) -> list[str]:
    root = Path(directory).resolve()
    rel_paths: list[str] = []
    for args in (
        ["git", "diff", "--name-only", "--diff-filter=ACMR", "HEAD"],
        ["git", "ls-files", "--others", "--exclude-standard"],
    ):
        try:
            output = subprocess.check_output(args, cwd=root, text=True, stderr=subprocess.DEVNULL)
        except Exception:
            output = ""
        rel_paths.extend(line.strip() for line in output.splitlines() if line.strip())

    files: list[str] = []
    seen: set[str] = set()
    for rel_path in rel_paths:
        path = (root / rel_path).resolve()
        if path in seen or path.suffix.lower() != file_ext or not path.exists():
            continue
        try:
            path.relative_to(root)
        except ValueError:
            continue
        seen.add(path)
        files.append(str(path))
    return files


def source_files(directory: str, file_ext: str) -> list[str]:
    root = Path(directory).resolve()
    files: list[str] = []
    for path in root.rglob(f"*{file_ext}"):
        if any(part in {".git", "node_modules", "dist", "build", "out", ".venv"} for part in path.parts):
            continue
        try:
            rel_parts = path.relative_to(root).parts
        except ValueError:
            continue
        if any(part.lower() in SOURCE_DIR_NAMES for part in rel_parts):
            files.append(str(path))
    return files


def tool_definitions() -> list[dict[str, Any]]:
    return [
        {
            "name": "owlspotlight.search_code",
            "title": "Search code with OwlSpotlight",
            "description": "Search a local workspace using OwlSpotlight semantic code search. Requires the OwlSpotlight VS Code server to be running.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "directory": {"type": "string", "description": "Workspace directory to search."},
                    "query": {"type": "string", "description": "Natural-language query or code snippet."},
                    "file_ext": {
                        "type": "string",
                        "description": "File extension to search.",
                        "enum": [".py", ".java", ".ts", ".tsx", ".js", ".jsx"],
                        "default": ".py",
                    },
                    "top_k": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
                    "scope": {
                        "type": "string",
                        "description": "Optional search scope.",
                        "enum": ["all", "source", "changed"],
                        "default": "all",
                    },
                    "search_mode": {
                        "type": "string",
                        "description": "Search ranking mode.",
                        "enum": ["semantic", "bm25", "hybrid"],
                        "default": "hybrid",
                    },
                    "server_url": {
                        "type": "string",
                        "description": "OwlSpotlight HTTP server URL. Defaults to OWLSPOTLIGHT_SERVER_URL or http://127.0.0.1:8000.",
                    },
                },
                "required": ["directory", "query"],
                "additionalProperties": False,
            },
        }
    ]


def call_search(arguments: dict[str, Any]) -> dict[str, Any]:
    directory = str(arguments.get("directory", "")).strip()
    query = str(arguments.get("query", "")).strip()
    file_ext = str(arguments.get("file_ext", ".py")).strip() or ".py"
    top_k = int(arguments.get("top_k", 10))
    scope = str(arguments.get("scope", "all")).strip()
    search_mode = str(arguments.get("search_mode", "hybrid")).strip()
    server_url = str(arguments.get("server_url", DEFAULT_SERVER_URL)).rstrip("/")

    if not directory or not query:
        return {"content": [{"type": "text", "text": "directory and query are required."}], "isError": True}
    if file_ext not in {".py", ".java", ".ts", ".tsx", ".js", ".jsx"}:
        return {"content": [{"type": "text", "text": f"Unsupported file_ext: {file_ext}"}], "isError": True}

    include_files = None
    if scope == "changed":
        include_files = changed_files(directory, file_ext)
    elif scope == "source":
        include_files = source_files(directory, file_ext) or None

    payload = {
        "directory": directory,
        "query": query,
        "file_ext": file_ext,
        "top_k": max(1, min(top_k, 50)),
        "include_files": include_files,
        "search_mode": search_mode if search_mode in {"semantic", "bm25", "hybrid"} else "hybrid",
    }
    try:
        result = post_json(f"{server_url}/search_functions_simple", payload)
    except urllib.error.URLError as exc:
        return {
            "content": [{"type": "text", "text": f"Failed to reach OwlSpotlight server at {server_url}: {exc}"}],
            "isError": True,
        }

    results = result.get("results", [])
    text = json.dumps(results, ensure_ascii=False, indent=2)
    return {
        "content": [{"type": "text", "text": text}],
        "structuredContent": {"results": results, "meta": {key: value for key, value in result.items() if key != "results"}},
        "isError": False,
    }


def handle_request(message: dict[str, Any]) -> dict[str, Any] | None:
    method = message.get("method")
    request_id = message.get("id")
    if request_id is None:
        return None

    if method == "initialize":
        requested = message.get("params", {}).get("protocolVersion")
        return response(
            request_id,
            {
                "protocolVersion": requested or PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "owlspotlight-mcp", "title": "OwlSpotlight MCP", "version": "0.1.0"},
                "instructions": "Use owlspotlight.search_code to retrieve local semantic code search results.",
            },
        )
    if method == "ping":
        return response(request_id, {})
    if method == "tools/list":
        return response(request_id, {"tools": tool_definitions()})
    if method == "tools/call":
        params = message.get("params", {})
        name = params.get("name")
        arguments = params.get("arguments") or {}
        if name != "owlspotlight.search_code":
            return error_response(request_id, -32602, f"Unknown tool: {name}")
        return response(request_id, call_search(arguments))
    return error_response(request_id, -32601, f"Method not found: {method}")


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
            result = handle_request(message)
            if result is not None:
                write_message(result)
        except Exception as exc:
            write_message(error_response(None, -32603, f"Internal error: {exc}"))


if __name__ == "__main__":
    main()
