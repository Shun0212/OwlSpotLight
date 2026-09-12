#!/usr/bin/env python3
"""Minimal MCP stdio bridge for the OwlSpotlight local search server."""

from __future__ import annotations

import json
import fnmatch
import os
import subprocess
import signal
import sys
import threading
import uuid
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from language_scope import matches_language
from pathspec import PathSpec
from pathspec.patterns import GitWildMatchPattern


PROTOCOL_VERSION = "2025-06-18"
DEFAULT_SERVER_URL = os.environ.get("OWLSPOTLIGHT_SERVER_URL", "http://127.0.0.1:8000")
DEFAULT_WORKSPACE = os.environ.get("OWLSPOTLIGHT_WORKSPACE", "")
DEFAULT_SEARCH_MODE = "semantic"
DEFAULT_TOP_K = 30
DEFAULT_SEARCH_TIMEOUT = float(os.environ.get("OWLSPOTLIGHT_SEARCH_TIMEOUT", "1800"))
SUPPORTED_FILE_EXTENSIONS = (".py", ".java", ".ts", ".tsx", ".js", ".jsx")
IGNORED_DIR_NAMES = {
    ".git",
    ".mypy_cache",
    ".owl_index",
    ".pytest_cache",
    ".venv",
    ".vscode-test",
    "__pycache__",
    "build",
    "dist",
    "node_modules",
    "out",
}
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
_write_lock = threading.Lock()
_requests_lock = threading.Lock()
_active_requests: dict[Any, dict[str, Any]] = {}
_request_context = threading.local()
_client_info: dict[str, Any] = {}
_last_search_event_id_by_directory: dict[str, int] = {}


def runtime_settings():
    filename = os.environ.get("OWLSPOTLIGHT_RUNTIME_FILE")
    if filename:
        try:
            with open(filename, encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, ValueError):
            pass
    return {}


def resolve_server_url():
    return str(runtime_settings().get("serverUrl") or DEFAULT_SERVER_URL).rstrip("/")


def explanation_language():
    return "Japanese" if runtime_settings().get("language") == "ja" else "the user's language"


def agent_model_name() -> str | None:
    for name in ("OWLSPOTLIGHT_AGENT_MODEL", "CODEX_MODEL", "OPENAI_MODEL", "OPENAI_API_MODEL"):
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return None


def agent_client_name() -> str:
    name = str(_client_info.get("name") or "mcp").strip()
    version = str(_client_info.get("version") or "").strip()
    return f"{name}/{version}" if version else name


def agent_metadata() -> dict[str, Any]:
    return {
        "agent_client": agent_client_name(),
        "agent_model": agent_model_name(),
    }


def resolve_directory(value: Any) -> str:
    directory = str(value or "").strip()
    if directory:
        return directory
    if DEFAULT_WORKSPACE.strip():
        return DEFAULT_WORKSPACE.strip()
    return os.getcwd()


def is_supported_source_path(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in SUPPORTED_FILE_EXTENSIONS


def should_skip_path(path: Path) -> bool:
    return any(part in IGNORED_DIR_NAMES for part in path.parts)


def load_ignore_spec(directory: str) -> PathSpec | None:
    root = Path(directory).resolve()
    lines: list[str] = []
    for ignore_file in (".gitignore", ".owlignore"):
        ignore_path = root / ignore_file
        if not ignore_path.exists():
            continue
        lines.extend(
            line.rstrip("\n")
            for line in ignore_path.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        )
    if not lines:
        return None
    return PathSpec.from_lines(GitWildMatchPattern, lines)


def is_owl_ignored(path: Path, directory: str, spec: PathSpec | None = None) -> bool:
    ignore_spec = spec if spec is not None else load_ignore_spec(directory)
    if ignore_spec is None:
        return False
    root = Path(directory).resolve()
    try:
        rel_path = path.resolve().relative_to(root)
    except ValueError:
        return True
    return bool(ignore_spec.match_file(str(rel_path)))


def git_visible_files(directory: str) -> list[Path]:
    root = Path(directory).resolve()
    ignore_spec = load_ignore_spec(directory)
    try:
        output = subprocess.check_output(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
            cwd=root,
            text=True,
            encoding="utf-8",
            errors="replace",
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        return []

    paths: list[Path] = []
    for line in output.splitlines():
        rel_path = line.strip()
        if not rel_path:
            continue
        path = (root / rel_path).resolve()
        try:
            path.relative_to(root)
        except ValueError:
            continue
        if is_supported_source_path(path) and not is_owl_ignored(path, directory, ignore_spec):
            paths.append(path)
    return paths


def candidate_source_files(directory: str) -> list[Path]:
    git_files = git_visible_files(directory)
    if git_files:
        return git_files

    root = Path(directory).resolve()
    ignore_spec = load_ignore_spec(directory)
    files: list[Path] = []
    for path in root.rglob("*"):
        if should_skip_path(path) or not is_supported_source_path(path):
            continue
        if is_owl_ignored(path, directory, ignore_spec):
            continue
        files.append(path)
    return files


def detected_file_counts(directory: str, scope: str = "all") -> dict[str, int]:
    counts = {ext: 0 for ext in SUPPORTED_FILE_EXTENSIONS}
    if scope == "changed":
        for ext in SUPPORTED_FILE_EXTENSIONS:
            counts[ext] = len(changed_files(directory, ext))
        return counts
    if scope == "source":
        for ext in SUPPORTED_FILE_EXTENSIONS:
            counts[ext] = len(source_files(directory, ext))
        return counts

    for path in candidate_source_files(directory):
        counts[path.suffix.lower()] += 1
    return counts


def resolve_file_ext(directory: str, requested_ext: Any, scope: str) -> tuple[str, dict[str, int]]:
    requested = str(requested_ext or "auto").strip().lower()
    if requested and requested != "auto":
        if requested not in SUPPORTED_FILE_EXTENSIONS:
            raise ValueError(f"Unsupported file_ext: {requested}")
        return requested, {}

    counts = detected_file_counts(directory, scope if scope in {"all", "source", "changed"} else "all")
    detected = [(ext, count) for ext, count in counts.items() if count > 0]
    if not detected:
        raise ValueError(f"No supported source files found in {directory}")
    return "auto", counts


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
    with _write_lock:
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
    ignore_spec = load_ignore_spec(directory)
    rel_paths: list[str] = []
    for args in (
        ["git", "diff", "--name-only", "--diff-filter=ACMR", "HEAD"],
        ["git", "ls-files", "--others", "--exclude-standard"],
    ):
        try:
            output = subprocess.check_output(
                args,
                cwd=root,
                text=True,
                encoding="utf-8",
                errors="replace",
                stderr=subprocess.DEVNULL,
            )
        except Exception:
            output = ""
        rel_paths.extend(line.strip() for line in output.splitlines() if line.strip())

    files: list[str] = []
    seen: set[str] = set()
    for rel_path in rel_paths:
        path = (root / rel_path).resolve()
        if (
            path in seen
            or not matches_language(str(path), file_ext)
            or not path.exists()
            or should_skip_path(path)
            or is_owl_ignored(path, directory, ignore_spec)
        ):
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
    for path in candidate_source_files(directory):
        if not matches_language(str(path), file_ext):
            continue
        try:
            rel_parts = path.relative_to(root).parts
        except ValueError:
            continue
        if any(part.lower() in SOURCE_DIR_NAMES for part in rel_parts):
            files.append(str(path))
    return files


def normalize_glob_patterns(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    patterns: list[str] = []
    for item in value:
        clean = str(item).strip().replace("\\", "/")
        if clean.startswith("./"):
            clean = clean[2:]
        if clean:
            patterns.append(clean)
    return patterns


def path_matches_glob(rel_path: str, patterns: list[str]) -> bool:
    rel = rel_path.replace("\\", "/").lstrip("./")
    name = rel.rsplit("/", 1)[-1]
    for pattern in patterns:
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


def glob_filtered_files(directory: str, file_ext: str, include_globs: list[str], exclude_globs: list[str]) -> list[str]:
    root = Path(directory).resolve()
    files: list[str] = []
    for path in candidate_source_files(directory):
        if not matches_language(str(path), file_ext):
            continue
        try:
            rel_path = path.resolve().relative_to(root).as_posix()
        except ValueError:
            continue
        if include_globs and not path_matches_glob(rel_path, include_globs):
            continue
        if exclude_globs and path_matches_glob(rel_path, exclude_globs):
            continue
        files.append(str(path))
    return files


def card_tool_definitions():
    common = {"event_id": {"type": "integer"}, "result_id": {"type": "string", "description": "Result rank in this exact search event, e.g. 1."},
              "directory": {"type": "string"}, "server_url": {"type": "string"}}
    return [
        {"name": "owlspotlight.read_code", "description": "Read a captured source/commit page from a search result. Use nextLine as start_line to continue. No Gemini key is needed.",
         "inputSchema": {"type": "object", "properties": {**common, "start_line": {"type": "integer", "minimum": 1}},
                         "required": ["event_id", "result_id"], "additionalProperties": False}},
        {"name": "owlspotlight.publish_result_annotations", "description": "Show a card in OwlSpotlight with your explanation and colored inspected lines. Call read_code first. Write title, reason and labels in the user's language. Code is never generated by this tool.",
         "inputSchema": {"type": "object", "properties": {**common, "title": {"type": "string", "maxLength": 160},
             "reason": {"type": "string", "maxLength": 1000}, "highlights": {"type": "array", "maxItems": 4,
             "items": {"type": "object", "properties": {"startLine": {"type": "integer", "minimum": 1}, "endLine": {"type": "integer", "minimum": 1},
                      "color": {"type": "string", "enum": ["blue", "green", "amber", "purple"]}, "label": {"type": "string", "maxLength": 240}},
                       "required": ["startLine", "endLine", "color", "label"], "additionalProperties": False}}},
             "required": ["event_id", "result_id", "title", "reason", "highlights"], "additionalProperties": False}}
    ]


def call_card_tool(name, arguments):
    server_url = str(arguments.get("server_url", resolve_server_url())).rstrip("/")
    endpoint = "agent_read_code" if name == "owlspotlight.read_code" else "agent_result_annotations"
    payload = {key: value for key, value in arguments.items() if key not in {"server_url", "_meta"}}
    payload["directory"] = resolve_directory(arguments.get("directory"))
    try:
        result = post_json(f"{server_url}/{endpoint}", payload, timeout=30)
        result["explanation_language"] = explanation_language()
        return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}], "structuredContent": result, "isError": False}
    except urllib.error.HTTPError as error:
        detail = error.read().decode('utf-8', errors='replace')[:1000]
        return {"content": [{"type": "text", "text": f"Card request rejected: {detail}"}], "isError": True}
    except urllib.error.URLError as error:
        return {"content": [{"type": "text", "text": f"Card server unavailable: {error}"}], "isError": True}


def tool_definitions() -> list[dict[str, Any]]:
    return [
        *card_tool_definitions(),
        {
            "name": "owlspotlight.search_code",
            "title": "Search code with OwlSpotlight",
            "description": "Search local code with OwlSpotlight. Use this directly before grep/ripgrep when locating functions, methods, routes, handlers, storage/auth/session logic, or implementation details in a repository. Do not inspect .mcp.json or mcp_server.py first when this tool is available. Only query is required when OWLSPOTLIGHT_WORKSPACE or the MCP working directory points at the repo.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "directory": {
                        "type": "string",
                        "description": "Workspace directory to search. Optional; defaults to OWLSPOTLIGHT_WORKSPACE, then the MCP process working directory.",
                    },
                    "query": {
                        "type": "string",
                        "description": "Natural-language behavior, likely identifier, route/API term, or code snippet to search for.",
                    },
                    "file_ext": {
                        "type": "string",
                        "description": "File extension to search. Use auto unless the target language is known; auto searches all supported languages while respecting .owlignore plus git ignore/exclude rules.",
                        "enum": ["auto", ".py", ".java", ".ts", ".tsx", ".js", ".jsx"],
                        "default": "auto",
                    },
                    "top_k": {"type": "integer", "minimum": 1, "maximum": 50, "default": DEFAULT_TOP_K},
                    "scope": {
                        "type": "string",
                        "description": "Optional search scope.",
                        "enum": ["all", "source", "changed"],
                        "default": "all",
                    },
                    "include_globs": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional repository-relative glob patterns to include, for example [\"pylate/**/*.py\"].",
                    },
                    "exclude_globs": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional repository-relative glob patterns to exclude, for example [\"examples/**\", \"tests/**\"].",
                    },
                    "search_mode": {
                        "type": "string",
                        "description": "Search ranking mode.",
                        "enum": ["semantic", "bm25", "hybrid", "keyword"],
                        "default": DEFAULT_SEARCH_MODE,
                    },
                    "search_target": {
                        "type": "string",
                        "description": "Search all extracted code (functions), only functions changed by the selected git diff (changed_functions), or the changed lines shown as unified diff hunks (diff_hunks).",
                        "enum": ["functions", "changed_functions", "diff_hunks"],
                        "default": "functions",
                    },
                    "diff_base_ref": {
                        "type": "string",
                        "description": "Optional git base ref for diff hunk search. With no head ref this compares base...HEAD. Leave blank for HEAD vs working tree.",
                    },
                    "diff_head_ref": {
                        "type": "string",
                        "description": "Optional git head ref for branch-to-branch diff hunk search, used with diff_base_ref as base...head.",
                    },
                    "diff_range_mode": {
                        "type": "string",
                        "enum": ["legacy", "branch", "custom", "working_tree"],
                        "default": "branch",
                        "description": "branch searches current HEAD history including the initial commit; custom searches From-exclusive to To-inclusive; working_tree compares HEAD to local changes. legacy preserves existing ref behavior.",
                    },
                    "first_parent": {
                        "type": "boolean",
                        "default": True,
                        "description": "Follow only first parents, retaining merge commits but excluding individual side-branch commits.",
                    },
                    "force_diff_refresh": {
                        "type": "boolean",
                        "description": "Refresh the cached diff snapshot before searching diff hunks.",
                        "default": False,
                    },
                    "server_url": {
                        "type": "string",
                        "description": "OwlSpotlight HTTP server URL. Defaults to OWLSPOTLIGHT_SERVER_URL or http://127.0.0.1:8000.",
                    },
                },
                "required": ["query"],
                "additionalProperties": False,
            },
        },
        {
            "name": "owlspotlight.cancel_embedding",
            "title": "Cancel OwlSpotlight indexing / embedding",
            "description": "Request cancellation of the currently running OwlSpotlight indexing or embedding operation on the local HTTP server.",
            "inputSchema": {
                "type": "object",
                "required": ["operation_id"],
                "properties": {
                    "operation_id": {"type": "string", "description": "Exact operation_id from this request’s progress notifications."},
                    "server_url": {
                        "type": "string",
                        "description": "OwlSpotlight HTTP server URL. Defaults to OWLSPOTLIGHT_SERVER_URL or http://127.0.0.1:8000.",
                    },
                },
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
        {
            "name": "owlspotlight.mark_results_used",
            "title": "Mark OwlSpotlight results used",
            "description": "Record which OwlSpotlight search results were actually useful after reading files. Call this only after you used specific returned ranks or grep locations as evidence.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "event_id": {"type": "integer", "minimum": 1, "description": "agent_event_id returned by owlspotlight.search_code or owlspotlight.grep_repo."},
                    "referenced_ranks": {
                        "type": "array",
                        "items": {"type": "integer", "minimum": 1},
                        "description": "Ranks from the OwlSpotlight result list that were actually referenced.",
                    },
                    "referenced_locations": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional file:line locations actually referenced, especially for grep results.",
                    },
                    "useful": {"type": "boolean", "default": True},
                    "note": {"type": "string", "description": "Short reason why these results were or were not useful."},
                    "server_url": {
                        "type": "string",
                        "description": "OwlSpotlight HTTP server URL. Defaults to OWLSPOTLIGHT_SERVER_URL or http://127.0.0.1:8000.",
                    },
                },
                "required": ["event_id"],
                "additionalProperties": False,
            },
        },
        {
            "name": "owlspotlight.grep_repo",
            "title": "Grep repository with OwlSpotlight ignores",
            "description": "Repository-wide grep for exact identifiers, call sites, tests, docs, and exhaustive verification after semantic discovery. Searches all text files visible in the repository while respecting .owlignore plus git ignore/exclude rules.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "directory": {
                        "type": "string",
                        "description": "Workspace directory to search. Optional; defaults to OWLSPOTLIGHT_WORKSPACE, then the MCP process working directory.",
                    },
                    "pattern": {"type": "string", "description": "Text or regex pattern to search for."},
                    "regex": {"type": "boolean", "description": "Treat pattern as a regular expression. If omitted, OwlSpotlight treats patterns containing | as regex alternation."},
                    "case_sensitive": {"type": "boolean", "default": True},
                    "max_matches": {"type": "integer", "minimum": 1, "maximum": 500, "default": 100},
                    "include_globs": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional repository-relative glob patterns to include, for example [\"pylate/**/*.py\"].",
                    },
                    "exclude_globs": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional repository-relative glob patterns to exclude, for example [\"examples/**\", \"tests/**\"].",
                    },
                    "parent_event_id": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "Optional OwlSpotlight search event id that this grep follows. Defaults to the last search_code event for the same directory in this MCP session.",
                    },
                    "server_url": {
                        "type": "string",
                        "description": "OwlSpotlight HTTP server URL. Defaults to OWLSPOTLIGHT_SERVER_URL or http://127.0.0.1:8000.",
                    },
                },
                "required": ["pattern"],
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
    if result.get("symbol_kind") == "diff_hunk":
        kind = "UnifiedDiff"
    else:
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
    if result.get("cancelled"):
        return "Search stopped. Do not retry unless the user requests it."
    directory = str(arguments.get("directory", "")).strip()
    query = str(arguments.get("query", "")).strip()
    results = result.get("results", [])
    resolved_file_ext = result.get("file_ext") or arguments.get("file_ext", "auto")
    meta_bits = [
        f"mode={result.get('search_mode') or arguments.get('search_mode', DEFAULT_SEARCH_MODE)}",
        f"file_ext={resolved_file_ext}",
        f"scope={arguments.get('scope', 'all')}",
        f"directory={directory}",
        f"range={arguments.get('diff_range_mode', 'branch')}",
        f"first_parent={arguments.get('first_parent', True)}",
    ]
    search_target = result.get("search_target") or arguments.get("search_target")
    if search_target:
        meta_bits.append(f"target={search_target}")
    if result.get("diff_compare"):
        meta_bits.append(f"diff={result.get('diff_compare')}")
    include_globs = normalize_glob_patterns(arguments.get("include_globs"))
    exclude_globs = normalize_glob_patterns(arguments.get("exclude_globs"))
    if include_globs:
        meta_bits.append(f"include={','.join(include_globs)}")
    if exclude_globs:
        meta_bits.append(f"exclude={','.join(exclude_globs)}")
    if result.get("auto_file_ext_counts"):
        detected = ", ".join(
            f"{ext}:{count}"
            for ext, count in result["auto_file_ext_counts"].items()
            if count
        )
        if detected:
            meta_bits.append(f"auto_detected={detected}")
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
        "- Use owlspotlight.read_code with this event_id and result_id (rank) to inspect captured code; follow page.nextLine for more.",
        f"- Optionally use owlspotlight.publish_result_annotations to show a card with explanations, titles and labels in {explanation_language()}.",
        "- Once likely identifiers or file names are known, call owlspotlight.grep_repo to verify exact references; it will be linked to this search in OwlSpotlight.",
        f"- Record the evidence you actually used with owlspotlight.mark_results_used event_id={result.get('agent_event_id')} and referenced_ranks=[...].",
        "- If the best result is weak, run another OwlSpotlight query with different wording or identifiers.",
        "Suggested follow-up queries:",
        *[f"- {variant}" for variant in variants[1:]],
        "- Human sidebar feedback is optional; do not wait for it unless the user explicitly asks for review.",
    ]
    return "\n\n".join(["\n".join(header), *formatted, "\n".join(footer)])


def format_grep_response_for_agent(arguments: dict[str, Any], result: dict[str, Any]) -> str:
    pattern = str(arguments.get("pattern", "")).strip()
    matches = result.get("matches", [])
    header = [
        f"OwlSpotlight grep: `{pattern}`",
        f"Returned {len(matches)} match(es). Use this for exact references and verification.",
    ]
    include_globs = normalize_glob_patterns(arguments.get("include_globs"))
    exclude_globs = normalize_glob_patterns(arguments.get("exclude_globs"))
    scope_bits = []
    if include_globs:
        scope_bits.append(f"include={','.join(include_globs)}")
    if exclude_globs:
        scope_bits.append(f"exclude={','.join(exclude_globs)}")
    if scope_bits:
        header.append("Meta: " + ", ".join(scope_bits))
    lines = []
    for index, match in enumerate(matches[:40], start=1):
        location = f"{match.get('path') or match.get('file')}:{match.get('line')}"
        lines.append(f"{index}. `{location}`\n   {truncate_text(str(match.get('text') or ''), 300)}")
    footer = [
        f"If you use any grep result as evidence, call owlspotlight.mark_results_used with event_id={result.get('agent_event_id')} and referenced_locations=[\"path:line\", ...]."
    ]
    return "\n\n".join(["\n".join(header), *lines, "\n".join(footer)])


def call_search(arguments: dict[str, Any]) -> dict[str, Any]:
    directory = resolve_directory(arguments.get("directory"))
    query = str(arguments.get("query", "")).strip()
    requested_file_ext = str(arguments.get("file_ext", "auto")).strip() or "auto"
    top_k = int(arguments.get("top_k", DEFAULT_TOP_K))
    scope = str(arguments.get("scope", "all")).strip()
    if scope not in {"all", "source", "changed"}:
        scope = "all"
    search_mode = str(arguments.get("search_mode", DEFAULT_SEARCH_MODE)).strip()
    search_target = str(arguments.get("search_target", "functions")).strip()
    if search_target in {"changed", "changed_hunks", "changed_lines"}:
        search_target = "changed_functions"
    if search_target not in {"functions", "changed_functions", "diff_hunks"}:
        search_target = "functions"
    diff_base_ref = str(arguments.get("diff_base_ref", "") or "").strip()
    diff_head_ref = str(arguments.get("diff_head_ref", "") or "").strip()
    force_diff_refresh = bool(arguments.get("force_diff_refresh", False))
    include_globs = normalize_glob_patterns(arguments.get("include_globs"))
    exclude_globs = normalize_glob_patterns(arguments.get("exclude_globs"))
    server_url = str(arguments.get("server_url", resolve_server_url())).rstrip("/")

    if not query:
        return {"content": [{"type": "text", "text": "query is required."}], "isError": True}
    if not Path(directory).is_dir():
        return {"content": [{"type": "text", "text": f"Workspace directory does not exist: {directory}"}], "isError": True}
    try:
        file_ext, auto_file_ext_counts = resolve_file_ext(directory, requested_file_ext, scope)
    except ValueError as exc:
        return {"content": [{"type": "text", "text": str(exc)}], "isError": True}

    include_files = None
    if search_target != "functions" and scope == "changed":
        include_files = None
    elif scope == "changed":
        include_files = changed_files(directory, file_ext)
    elif scope == "source":
        include_files = source_files(directory, file_ext) or None
    if include_globs or exclude_globs:
        glob_files = glob_filtered_files(directory, file_ext, include_globs, exclude_globs)
        if include_files is None:
            include_files = glob_files
        else:
            scoped = {str(Path(path).resolve()) for path in include_files}
            include_files = [path for path in glob_files if str(Path(path).resolve()) in scoped]

    payload = {
        "operation_id": (getattr(_request_context, "state", None) or {}).get("operation_id"),
        "directory": directory,
        "query": query,
        "file_ext": file_ext,
        "top_k": max(1, min(top_k, 50)),
        "include_files": include_files,
        "include_globs": include_globs,
        "exclude_globs": exclude_globs,
        "search_mode": search_mode if search_mode in {"semantic", "bm25", "hybrid", "keyword"} else DEFAULT_SEARCH_MODE,
        "search_target": search_target,
        "diff_range_mode": str(arguments.get("diff_range_mode", "branch")),
        "first_parent": bool(arguments.get("first_parent", True)),
        "diff_base_ref": diff_base_ref,
        "diff_head_ref": diff_head_ref,
        "force_diff_refresh": force_diff_refresh,
        "scope": scope,
        "capture_agent_event": True,
        "agent_source": "mcp",
        **agent_metadata(),
    }
    state = getattr(_request_context, "state", None)
    if state and state["cancelled"].is_set():
        return cancelled_response()
    try:
        result = post_json(f"{server_url}/search_functions_simple", payload, timeout=DEFAULT_SEARCH_TIMEOUT)
    except urllib.error.HTTPError as exc:
        status = "busy" if exc.code == 409 else "http_error"
        return {"content": [{"type": "text", "text": "OwlSpotlight is busy with another operation; do not cancel it." if exc.code == 409 else f"Search failed: HTTP {exc.code}."}],
                "structuredContent": {"status": status}, "isError": True}
    except (urllib.error.URLError, TimeoutError) as exc:
        if state:
            call_cancel_embedding({"operation_id": state["operation_id"], "server_url": server_url})
        return {
            "content": [{"type": "text", "text": f"Failed to reach OwlSpotlight server at {server_url}: {exc}"}],
            "isError": True,
        }

    if result.get("cancelled") or (state and state["cancelled"].is_set()):
        return cancelled_response()
    results = result.get("results", [])
    event_id = result.get("agent_event_id")
    if isinstance(event_id, int):
        _last_search_event_id_by_directory[str(Path(directory).resolve())] = event_id
    result["file_ext"] = file_ext
    if auto_file_ext_counts:
        result["auto_file_ext_counts"] = auto_file_ext_counts
    response_arguments = {
        **arguments,
        "directory": directory,
        "file_ext": file_ext,
        "server_url": server_url,
        "scope": scope,
        "search_target": search_target,
        "diff_range_mode": str(arguments.get("diff_range_mode", "branch")),
        "first_parent": bool(arguments.get("first_parent", True)),
        "diff_base_ref": diff_base_ref,
        "diff_head_ref": diff_head_ref,
        "include_globs": include_globs,
        "exclude_globs": exclude_globs,
    }
    text = format_search_response_for_agent(response_arguments, result)
    return {
        "content": [{"type": "text", "text": text}],
        "structuredContent": {
            "results": results,
            "meta": {
                key: value
                for key, value in result.items()
                if key != "results"
            },
            "resolved_arguments": response_arguments,
        },
        "isError": False,
    }


def call_cancel_embedding(arguments: dict[str, Any]) -> dict[str, Any]:
    server_url = str(arguments.get("server_url", resolve_server_url())).rstrip("/")
    try:
        operation_id = arguments.get("operation_id")
        if not operation_id:
            return {"content": [{"type": "text", "text": "operation_id is required. Other clients' operations will not be cancelled."}], "isError": True}
        result = post_json(f"{server_url}/cancel_embedding", {"operation_id": operation_id}, timeout=10.0)
    except urllib.error.URLError as exc:
        return {
            "content": [{"type": "text", "text": f"Failed to reach OwlSpotlight server at {server_url}: {exc}"}],
            "isError": True,
        }
    return {
        "content": [{"type": "text", "text": result.get("message", "Cancellation requested.")}],
        "structuredContent": result,
        "isError": False,
    }


def call_get_human_feedback(arguments: dict[str, Any]) -> dict[str, Any]:
    since_id = int(arguments.get("since_id", 0))
    limit = int(arguments.get("limit", 20))
    server_url = str(arguments.get("server_url", resolve_server_url())).rstrip("/")
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


def call_mark_results_used(arguments: dict[str, Any]) -> dict[str, Any]:
    server_url = str(arguments.get("server_url", resolve_server_url())).rstrip("/")
    payload = {
        "event_id": int(arguments.get("event_id", 0)),
        "referenced_ranks": arguments.get("referenced_ranks") or [],
        "referenced_locations": arguments.get("referenced_locations") or [],
        "useful": bool(arguments.get("useful", True)),
        "note": arguments.get("note"),
        **agent_metadata(),
    }
    try:
        result = post_json(f"{server_url}/agent_search_usage", payload)
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8")
        except Exception:
            detail = str(exc)
        return {"content": [{"type": "text", "text": f"Failed to mark results used: {detail}"}], "isError": True}
    except urllib.error.URLError as exc:
        return {
            "content": [{"type": "text", "text": f"Failed to reach OwlSpotlight server at {server_url}: {exc}"}],
            "isError": True,
        }
    usage = result.get("usage", {})
    written = result.get("training_examples_written", 0)
    training_file = result.get("training_examples_file")
    message = f"Recorded OwlSpotlight referenced results and wrote {written} training example(s)."
    if training_file:
        message += f" Training log: {training_file}"
    return {
        "content": [{"type": "text", "text": message}],
        "structuredContent": {
            "usage": usage,
            "training_examples_written": written,
            "training_examples_file": training_file,
        },
        "isError": False,
    }


def call_grep_repo(arguments: dict[str, Any]) -> dict[str, Any]:
    directory = resolve_directory(arguments.get("directory"))
    pattern = str(arguments.get("pattern", "")).strip()
    server_url = str(arguments.get("server_url", resolve_server_url())).rstrip("/")
    if not pattern:
        return {"content": [{"type": "text", "text": "pattern is required."}], "isError": True}
    if not Path(directory).is_dir():
        return {"content": [{"type": "text", "text": f"Workspace directory does not exist: {directory}"}], "isError": True}
    regex_arg = arguments.get("regex")
    use_regex = bool(regex_arg) if regex_arg is not None else "|" in pattern
    include_globs = normalize_glob_patterns(arguments.get("include_globs"))
    exclude_globs = normalize_glob_patterns(arguments.get("exclude_globs"))
    payload = {
        "directory": directory,
        "pattern": pattern,
        "regex": use_regex,
        "case_sensitive": bool(arguments.get("case_sensitive", True)),
        "max_matches": max(1, min(int(arguments.get("max_matches", 100)), 500)),
        "include_globs": include_globs,
        "exclude_globs": exclude_globs,
        "capture_agent_event": True,
        "agent_source": "mcp",
        "parent_event_id": arguments.get("parent_event_id") or _last_search_event_id_by_directory.get(str(Path(directory).resolve())),
        **agent_metadata(),
    }
    try:
        result = post_json(f"{server_url}/grep_repo", payload)
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8")
        except Exception:
            detail = str(exc)
        return {"content": [{"type": "text", "text": f"Grep failed: {detail}"}], "isError": True}
    except urllib.error.URLError as exc:
        return {
            "content": [{"type": "text", "text": f"Failed to reach OwlSpotlight server at {server_url}: {exc}"}],
            "isError": True,
        }
    response_arguments = {
        **arguments,
        "directory": directory,
        "include_globs": include_globs,
        "exclude_globs": exclude_globs,
    }
    text = format_grep_response_for_agent(response_arguments, result)
    return {
        "content": [{"type": "text", "text": text}],
        "structuredContent": {
            "matches": result.get("matches", []),
            "meta": {key: value for key, value in result.items() if key != "matches"},
            "resolved_arguments": response_arguments,
        },
        "isError": False,
    }


def call_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if name in {"owlspotlight.read_code", "owlspotlight.publish_result_annotations"}:
        return call_card_tool(name, arguments)
    if name == "owlspotlight.search_code":
        return call_search(arguments)
    if name == "owlspotlight.cancel_embedding":
        return call_cancel_embedding(arguments)
    if name == "owlspotlight.get_human_feedback":
        return call_get_human_feedback(arguments)
    if name == "owlspotlight.mark_results_used":
        return call_mark_results_used(arguments)
    if name == "owlspotlight.grep_repo":
        return call_grep_repo(arguments)
    raise ValueError(f"Unknown tool: {name}")


def cancelled_response():
    return {"content": [{"type": "text", "text": "Search stopped. Do not retry unless the user requests it."}],
            "structuredContent": {"status": "cancelled", "cancelled": True}, "isError": True}


def run_tool_call(request_id, name, arguments, state=None):
    state = state or {"operation_id": str(uuid.uuid4()), "cancelled": threading.Event(), "done": threading.Event()}
    _request_context.state = state
    try:
        result = cancelled_response() if state["cancelled"].is_set() else call_tool(name, {**arguments, "server_url": state.get("server_url", resolve_server_url())})
        if not state["cancelled"].is_set():
            write_message(response(request_id, result))
    except ValueError as exc:
        if not state["cancelled"].is_set():
            write_message(error_response(request_id, -32602, str(exc)))
    except Exception as exc:
        if not state["cancelled"].is_set():
            write_message(error_response(request_id, -32603, f"Internal error: {exc}"))
    finally:
        state["done"].set()
        with _requests_lock:
            if _active_requests.get(request_id) is state:
                del _active_requests[request_id]
        _request_context.state = None


def report_progress(state, token):
    count = 0
    while not state["done"].wait(5):
        if state["cancelled"].is_set():
            return
        count += 1
        write_message({"jsonrpc": "2.0", "method": "notifications/progress", "params": {
            "progressToken": token, "progress": count,
            "message": "OwlSpotlight is searching / preparing its index. operation_id=" + state["operation_id"]}})


def handle_request(message: dict[str, Any]) -> dict[str, Any] | None:
    method = message.get("method")
    if method == "notifications/cancelled":
        with _requests_lock:
            state = _active_requests.get(message.get("params", {}).get("requestId"))
            if state:
                state["cancelled"].set()
        if state and state["name"] == "owlspotlight.search_code":
            threading.Thread(target=call_cancel_embedding, args=({"operation_id": state["operation_id"],
                "server_url": state["server_url"]},), daemon=True).start()
        return None
    request_id = message.get("id")
    if request_id is None:
        return None

    if method == "initialize":
        global _client_info
        params = message.get("params", {})
        requested = params.get("protocolVersion")
        client_info = params.get("clientInfo")
        _client_info = client_info if isinstance(client_info, dict) else {}
        return response(
            request_id,
            {
                "protocolVersion": requested or PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "owlspotlight-mcp", "title": "OwlSpotlight MCP", "version": "0.1.0"},
                "instructions": "Use owlspotlight.search_code directly for semantic discovery when locating local code by behavior, route, handler, function, method, storage, auth, or session logic. If this tool is available, do not run command -v owlspotlight, inspect .mcp.json, read mcp_server.py, or reverse-engineer the HTTP API before using it. The tool can be called with only a query when OWLSPOTLIGHT_WORKSPACE or the MCP working directory is the repository; file_ext defaults to auto and search_mode defaults to semantic. Use include_globs/exclude_globs to scope searches, for example include_globs=[\"pylate/**/*.py\"] and exclude_globs=[\"examples/**\",\"tests/**\"]. After likely identifiers are found, use owlspotlight.grep_repo for exhaustive exact-reference checks across the repository; pass the same include_globs/exclude_globs when you want the same scope. OR patterns such as ClassA|ClassB are treated as regex alternation when regex is omitted. Optionally call owlspotlight.mark_results_used for returned ranks or grep locations actually used as evidence; skip it if that would slow down the task. The OwlSpotlight sidebar mirrors compact agent activity for observability; human feedback is optional and should not block autonomous search.",
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
        state = {"operation_id": str(uuid.uuid4()), "cancelled": threading.Event(), "done": threading.Event(),
                 "name": name, "server_url": arguments.get("server_url", resolve_server_url())}
        with _requests_lock:
            if request_id in _active_requests:
                return error_response(request_id, -32600, "Request ID is already active")
            _active_requests[request_id] = state
        token = arguments.get("_meta", {}).get("progressToken") if isinstance(arguments.get("_meta"), dict) else None
        token = params.get("_meta", {}).get("progressToken", token)
        if token is not None:
            threading.Thread(target=report_progress, args=(state, token), daemon=True).start()
        threading.Thread(target=run_tool_call, args=(request_id, name, arguments, state), daemon=True).start()
        return None
    return error_response(request_id, -32601, f"Method not found: {method}")


def main() -> None:
    def shutdown(signum, frame):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    # MCP uses UTF-8 JSON over stdio. Windows otherwise commonly selects CP932
    # for redirected streams, which cannot safely decode all JSON input.
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")

    try:
        read_requests()
    finally:
        with _requests_lock:
            pending = list(_active_requests.values())
        for state in pending:
            state["cancelled"].set()
            if state["name"] == "owlspotlight.search_code":
                call_cancel_embedding({"operation_id": state["operation_id"], "server_url": state["server_url"]})


def read_requests():
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
