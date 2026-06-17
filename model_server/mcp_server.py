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


def truncate_text(text: str, limit: int = 900) -> str:
    clean = " ".join(text.split()) if "\n" not in text else text.strip()
    if len(clean) <= limit:
        return clean
    return clean[: max(0, limit - 1)].rstrip() + "…"


def build_query_variants(query: str) -> list[str]:
    cleaned = " ".join(query.split()).strip()
    if not cleaned:
        return []
    variants = [
        cleaned,
        f"{cleaned} function method implementation",
        f"{cleaned} handler service repository",
        f"{cleaned} route endpoint request response",
        f"{cleaned} state cache session auth",
    ]
    deduped: list[str] = []
    seen: set[str] = set()
    for variant in variants:
        key = variant.lower()
        if key not in seen:
            seen.add(key)
            deduped.append(variant)
    return deduped[:5]


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


def get_json(url: str, timeout: float = 30.0) -> dict[str, Any]:
    request = urllib.request.Request(url, method="GET")
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
            "description": "Search a local workspace using OwlSpotlight semantic code search. Use this early when locating functions, methods, routes, or code blocks. Results are candidates with file/line evidence and are mirrored into the OwlSpotlight sidebar for observability.",
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
        },
        {
            "name": "owlspotlight.get_human_feedback",
            "title": "Get human feedback for OwlSpotlight searches",
            "description": "Optionally read query-improvement suggestions entered in the OwlSpotlight sidebar. Do not wait for this unless the user explicitly says they added feedback.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "since_id": {
                        "type": "integer",
                        "minimum": 0,
                        "default": 0,
                        "description": "Return feedback items with an id greater than this value.",
                    },
                    "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
                    "server_url": {
                        "type": "string",
                        "description": "OwlSpotlight HTTP server URL. Defaults to OWLSPOTLIGHT_SERVER_URL or http://127.0.0.1:8000.",
                    },
                },
                "additionalProperties": False,
            },
        },
    ]


def format_result_for_agent(result: dict[str, Any], directory: str, index: int) -> str:
    file_path = str(result.get("file_path") or result.get("file") or "")
    try:
        rel_path = str(Path(file_path).resolve().relative_to(Path(directory).resolve())) if file_path else ""
    except Exception:
        rel_path = file_path
    line = result.get("lineno") or result.get("line_number") or 1
    end_line = result.get("end_lineno")
    location = f"{rel_path}:{line}" + (f"-{end_line}" if end_line else "")
    name = result.get("function_name") or result.get("name") or "unknown"
    if result.get("class_name"):
        name = f"{result.get('class_name')}.{name}"
    kind = "CodeBlock" if result.get("symbol_kind") == "code_block" else ("Method" if result.get("class_name") else "Function")
    score = result.get("hybrid_score", result.get("score", result.get("similarity")))
    score_text = f"{float(score):.3f}" if isinstance(score, (int, float)) else "n/a"
    semantic = result.get("semantic_similarity")
    bm25 = result.get("bm25_score")
    parts = [
        f"{index}. {kind} `{name}` at `{location}`",
        f"   rank_score={score_text}"
        + (f", semantic={float(semantic):.3f}" if isinstance(semantic, (int, float)) else "")
        + (f", bm25={float(bm25):.3f}" if isinstance(bm25, (int, float)) and bm25 > 0 else ""),
    ]
    static = result.get("python_static") or {}
    routes = static.get("routes") if isinstance(static, dict) else None
    if isinstance(routes, list) and routes:
        route = routes[0]
        if isinstance(route, dict):
            parts.append(f"   route={route.get('method', '')} {route.get('path', '')}".rstrip())
    calls = static.get("calls") if isinstance(static, dict) else None
    if isinstance(calls, list) and calls:
        parts.append(f"   calls={', '.join(str(call) for call in calls[:6])}")
    snippet_source = str(result.get("raw_code") or result.get("code") or "")
    snippet_lines = [line.rstrip() for line in snippet_source.strip().splitlines()[:8]]
    if snippet_lines:
        snippet = truncate_text("\n".join(snippet_lines), 900)
        parts.append("   snippet:\n```text\n" + snippet + "\n```")
    return "\n".join(parts)


def format_search_response_for_agent(arguments: dict[str, Any], result: dict[str, Any]) -> str:
    directory = str(arguments.get("directory", "")).strip()
    query = str(arguments.get("query", "")).strip()
    results = result.get("results", [])
    meta_bits = [
        f"mode={result.get('search_mode') or arguments.get('search_mode', 'hybrid')}",
        f"file_ext={arguments.get('file_ext', '.py')}",
        f"scope={arguments.get('scope', 'all')}",
    ]
    header = [
        f"OwlSpotlight search: `{query}`",
        "Meta: " + ", ".join(meta_bits),
        f"Returned {len(results)} candidate(s). Treat these as leads: open/read the file regions before making a final claim.",
    ]
    variants = build_query_variants(query)
    if not results:
        header.append(
            "No candidates found. Try these alternate queries instead of waiting for human fallback:\n"
            + "\n".join(f"- {variant}" for variant in variants[1:])
        )
        return "\n".join(header)
    formatted = [format_result_for_agent(item, directory, idx) for idx, item in enumerate(results[:12], start=1)]
    footer = [
        "Next steps:",
        "- Read the top candidate files around the listed lines.",
        "- If the best result is weak, run another OwlSpotlight query with different wording or identifiers.",
        "Suggested follow-up queries:",
        *[f"- {variant}" for variant in variants[1:]],
        "- Human sidebar feedback is optional; do not wait for it unless the user explicitly asks for review.",
    ]
    return "\n\n".join(["\n".join(header), *formatted, "\n".join(footer)])


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
        "scope": scope if scope in {"all", "source", "changed"} else "all",
        "capture_agent_event": True,
        "agent_source": "mcp",
    }
    try:
        result = post_json(f"{server_url}/search_functions_simple", payload)
    except urllib.error.URLError as exc:
        return {
            "content": [{"type": "text", "text": f"Failed to reach OwlSpotlight server at {server_url}: {exc}"}],
            "isError": True,
        }

    results = result.get("results", [])
    text = format_search_response_for_agent(arguments, result)
    return {
        "content": [{"type": "text", "text": text}],
        "structuredContent": {"results": results, "meta": {key: value for key, value in result.items() if key != "results"}},
        "isError": False,
    }


def call_get_human_feedback(arguments: dict[str, Any]) -> dict[str, Any]:
    since_id = int(arguments.get("since_id", 0))
    limit = int(arguments.get("limit", 20))
    server_url = str(arguments.get("server_url", DEFAULT_SERVER_URL)).rstrip("/")
    try:
        result = get_json(
            f"{server_url}/agent_search_feedback?since_id={max(0, since_id)}&limit={max(1, min(limit, 100))}",
        )
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8")
        except Exception:
            detail = str(exc)
        return {"content": [{"type": "text", "text": f"Failed to read feedback: {detail}"}], "isError": True}
    except urllib.error.URLError as exc:
        return {
            "content": [{"type": "text", "text": f"Failed to reach OwlSpotlight server at {server_url}: {exc}"}],
            "isError": True,
        }

    feedback = result.get("feedback", [])
    if feedback:
        text = "Human OwlSpotlight feedback:\n" + "\n".join(
            f"- #{item.get('id')} for search event {item.get('event_id')}: {item.get('suggestion')}"
            for item in feedback
        )
    else:
        text = "No human OwlSpotlight feedback is available yet."
    return {
        "content": [{"type": "text", "text": text}],
        "structuredContent": {"feedback": feedback},
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
                "instructions": "Use owlspotlight.search_code to retrieve local semantic code search results. The OwlSpotlight sidebar mirrors agent searches for observability; human feedback is optional and should not block autonomous search.",
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
        if name == "owlspotlight.search_code":
            return response(request_id, call_search(arguments))
        if name == "owlspotlight.get_human_feedback":
            return response(request_id, call_get_human_feedback(arguments))
        return error_response(request_id, -32602, f"Unknown tool: {name}")
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
