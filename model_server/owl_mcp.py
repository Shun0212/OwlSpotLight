"""OwlSpotlight MCP (Model Context Protocol) server.

Exposes the OwlSpotlight semantic/hybrid code search as MCP tools so that
MCP-aware clients (Claude Desktop, Copilot, Cursor, Continue, etc.) can
query a local codebase with the same index the VS Code extension uses.

This server is a thin adapter: it talks to the already-running
``model_server`` FastAPI instance over HTTP. Start the FastAPI server
first (or let the VS Code extension start it), then run::

    python -m model_server.owl_mcp

Environment variables:
  OWL_SERVER_URL   Base URL of the FastAPI server (default: http://127.0.0.1:8000)
  OWL_HTTP_TIMEOUT Timeout in seconds for HTTP calls (default: 120)

Tools exposed:
  - search_code         Semantic / lexical / hybrid function search
  - get_symbols         Enriched tree-sitter symbols for a single file
  - graph_neighbors     Callers / callees of a function
  - build_index         Force (re)build of the index for a directory
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Dict, List

try:
    import httpx
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "httpx is required for owl_mcp (installed as an mcp dependency). "
        f"Import failed: {exc}"
    )

try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import TextContent, Tool
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "The 'mcp' Python SDK is required. Install with: pip install mcp"
    ) from exc


SERVER_URL = os.environ.get("OWL_SERVER_URL", "http://127.0.0.1:8000").rstrip("/")
HTTP_TIMEOUT = float(os.environ.get("OWL_HTTP_TIMEOUT", "120"))


server = Server("owlspotlight")


def _tool(name: str, description: str, schema: Dict[str, Any]) -> Tool:
    return Tool(name=name, description=description, inputSchema=schema)


@server.list_tools()
async def list_tools() -> List[Tool]:
    return [
        _tool(
            "search_code",
            "Search the indexed codebase for functions matching a natural-language or "
            "keyword query. Supports semantic (embedding), lexical (BM25) and hybrid "
            "(RRF-fused) retrieval.",
            {
                "type": "object",
                "properties": {
                    "directory": {"type": "string", "description": "Absolute path of the project root to search."},
                    "query": {"type": "string", "description": "Natural-language description or keywords."},
                    "top_k": {"type": "integer", "default": 10, "minimum": 1, "maximum": 100},
                    "file_ext": {"type": "string", "default": ".py", "enum": [".py", ".java", ".ts", ".tsx"]},
                    "mode": {"type": "string", "default": "hybrid", "enum": ["semantic", "lexical", "hybrid"]},
                },
                "required": ["directory", "query"],
            },
        ),
        _tool(
            "get_symbols",
            "Return the enriched tree-sitter symbol table (functions, classes, imports, "
            "calls, decorators, parameters, docstrings) for a single source file.",
            {
                "type": "object",
                "properties": {
                    "file": {"type": "string", "description": "Absolute path to the source file."},
                },
                "required": ["file"],
            },
        ),
        _tool(
            "graph_neighbors",
            "Return callers and callees of a target function. Identify the target by "
            "(file, lineno) or by name. Useful for 'what else would break if I change X?'",
            {
                "type": "object",
                "properties": {
                    "directory": {"type": "string"},
                    "file_ext": {"type": "string", "default": ".py"},
                    "file": {"type": "string"},
                    "lineno": {"type": "integer"},
                    "name": {"type": "string"},
                    "class_name": {"type": "string"},
                    "depth": {"type": "integer", "default": 1, "minimum": 1, "maximum": 5},
                    "limit": {"type": "integer", "default": 25, "minimum": 1, "maximum": 200},
                },
                "required": ["directory"],
            },
        ),
        _tool(
            "build_index",
            "Force a (re)build of the index for the given directory + extension. "
            "Normally not needed – search_code builds on demand.",
            {
                "type": "object",
                "properties": {
                    "directory": {"type": "string"},
                    "file_ext": {"type": "string", "default": ".py"},
                },
                "required": ["directory"],
            },
        ),
    ]


async def _post(path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    url = f"{SERVER_URL}{path}"
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        return resp.json()


def _format_hits(hits: List[Dict[str, Any]], limit_body: int = 400) -> str:
    if not hits:
        return "(no results)"
    lines: List[str] = []
    for i, h in enumerate(hits, 1):
        name = h.get("name") or h.get("function_name") or "<anon>"
        cls = h.get("class_name")
        qual = f"{cls}.{name}" if cls else name
        fpath = h.get("file", "")
        lineno = h.get("lineno", "?")
        end = h.get("end_lineno", lineno)
        doc = (h.get("docstring") or "").strip().splitlines()
        doc_line = doc[0] if doc else ""
        body = (h.get("code") or "").strip()
        if len(body) > limit_body:
            body = body[:limit_body] + "\n…"
        lines.append(f"[{i}] {qual}  ({fpath}:{lineno}-{end})")
        if doc_line:
            lines.append(f"    doc: {doc_line}")
        if body:
            lines.append("    ```")
            for ln in body.splitlines():
                lines.append(f"    {ln}")
            lines.append("    ```")
    return "\n".join(lines)


@server.call_tool()
async def call_tool(name: str, arguments: Dict[str, Any]) -> List[TextContent]:
    try:
        if name == "search_code":
            payload = {
                "directory": arguments["directory"],
                "query": arguments["query"],
                "top_k": int(arguments.get("top_k", 10)),
                "file_ext": arguments.get("file_ext", ".py"),
                "mode": arguments.get("mode", "hybrid"),
            }
            data = await _post("/search_functions_simple", payload)
            results = data.get("results", [])
            summary = (
                f"OwlSpotlight — mode={data.get('mode')}  "
                f"hits={len(results)}/{data.get('num_functions', '?')} "
                f"files={data.get('num_files', '?')}\n"
            )
            return [TextContent(type="text", text=summary + _format_hits(results))]

        if name == "get_symbols":
            data = await _post("/symbols", {"file": arguments["file"]})
            return [TextContent(type="text", text=json.dumps(data, indent=2, ensure_ascii=False))]

        if name == "graph_neighbors":
            payload = {k: v for k, v in arguments.items() if v is not None}
            payload.setdefault("file_ext", ".py")
            data = await _post("/graph/neighbors", payload)
            target = data.get("target") or {}
            callers = data.get("callers", [])
            callees = data.get("callees", [])
            head = (
                f"target: {target.get('class_name') + '.' if target.get('class_name') else ''}"
                f"{target.get('name', '?')}  ({target.get('file', '')}:{target.get('lineno', '?')})\n"
            )
            body = (
                f"\n-- Callers ({len(callers)}) --\n{_format_hits(callers, 200)}\n"
                f"\n-- Callees ({len(callees)}) --\n{_format_hits(callees, 200)}"
            )
            return [TextContent(type="text", text=head + body)]

        if name == "build_index":
            payload = {
                "directory": arguments["directory"],
                "file_ext": arguments.get("file_ext", ".py"),
            }
            data = await _post("/build_index", payload)
            return [TextContent(type="text", text=json.dumps(data, indent=2, ensure_ascii=False))]

        return [TextContent(type="text", text=f"Unknown tool: {name}")]

    except httpx.HTTPError as exc:
        return [TextContent(
            type="text",
            text=f"OwlSpotlight HTTP error: {exc}\n"
                 f"Is the model server running at {SERVER_URL}?",
        )]
    except Exception as exc:  # pragma: no cover - defensive
        return [TextContent(type="text", text=f"Tool '{name}' failed: {exc!r}")]


async def _main() -> None:
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


def main() -> None:
    asyncio.run(_main())


if __name__ == "__main__":
    main()
