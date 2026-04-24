# Change Log

## ✨ モデル大幅アップデート (2025-06-21)
- AIモデルを刷新し、検索精度が大幅に向上しました！

## ✨ Major Model Update (2025-06-21)
- The AI model has been upgraded for significantly improved search accuracy!

All notable changes to the "owlspotlight" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Added — Roadmap P1: Foundation refactor
- **`owl_core` package**: Extracted `extractors/`, `indexer.py`, and `model.py` into a reusable `model_server/owl_core/` package so the VS Code extension, future Owl-CLI, MCP server, and LangChain retriever can share the same primitives.
- **Enriched tree-sitter extraction**: Function records now carry `docstring`, `decorators`/`annotations`, `parameters` (name/type/default), `return_type`, `calls` (callees for graph search), `is_async`, `kind`, and more. A new `extract_symbols()` API additionally returns class records (with `bases`) and top-level imports.
- **OpenAPI / CORS**: FastAPI app now has title/version/description, tagged endpoints (`meta`/`index`/`search`/`embeddings`), and a configurable `CORSMiddleware` (`OWL_CORS_ORIGINS`) so external tools can consume the server directly.
- **New endpoints**:
  - `GET /health` — lightweight liveness probe.
  - `GET /info` — runtime + index status.
  - `POST /symbols` — per-file enriched symbol view (functions / classes / imports) without embedding.

### Added — Roadmap P3: UX polish
- **Search mode selector**: new `Semantic / Hybrid / Lexical` segmented control at the top of the sidebar. The chosen mode is persisted in `workspaceState` and passed to `POST /search_functions_simple` as `mode`. Switching mode with an active query re-runs the search automatically.
- **Query history chips**: recently used queries appear as chips under the search bar. Clicking a chip re-runs that query; the ⭐ icon pins it so it survives history trimming. History is persisted per workspace.
- **Callers / Callees panel on results**: every result row now has a `🔗 Callers / Callees` action that expands an inline panel calling `POST /graph/neighbors`. Click a caller or callee to jump straight to it. Every result also exposes a `🦉 Find similar` button that seeds a new search with the result's code.
- **CodeLens**: `🦉 Find similar` and `🔗 Callers / Callees` CodeLenses are shown above every function / method / constructor in Python, Java, and TypeScript (incl. `.tsx`). Toggle with the new `owlspotlight.enableCodeLens` setting (default `true`).
- **New command**: `owlspotlight.showNeighborsAt(uri, lineno, name)` — focuses the sidebar and nudges the user to inspect neighbors for a given symbol (used by CodeLens).
- **Get Started walkthrough**: `contributes.walkthroughs` adds a 5-step onboarding (Setup Python → Start Server → First Search → Find Similar → Hybrid/MCP) with dedicated markdown pages under `media/walkthrough/`.

### Added — Roadmap P2: Differentiation
- **Find similar to selection** (`owlspotlight.findSimilarToSelection`): new editor context-menu command (`editorHasSelection`) that takes the current selection (or the enclosing symbol from `vscode.executeDocumentSymbolProvider`), opens the OwlSpotlight sidebar and runs a search with it as the query.
- **Hybrid retrieval** (`mode=hybrid|lexical|semantic`): `POST /search_functions_simple` now accepts a `mode` field. Hybrid fuses FAISS (semantic) and BM25 (lexical) rankings via Reciprocal Rank Fusion. New module `owl_core.hybrid` (identifier-aware tokenizer, `BM25Index`, `rrf_fuse`). BM25 is built lazily and cached per indexer instance.
- **Code-graph search** (`POST /graph/neighbors`): returns callers and callees of a target function (resolved by `file`+`lineno` or by `name`), using the new `owl_core.graph.build_call_graph` over the tree-sitter `calls` field. Supports multi-hop expansion via `depth` and per-direction `limit`.
- **MCP server** (`python -m owl_mcp`): Model Context Protocol stdio server exposing `search_code`, `get_symbols`, `graph_neighbors`, and `build_index` tools for Claude Desktop / Copilot / Cursor / Continue / any MCP-aware client. Talks to the existing FastAPI server via `OWL_SERVER_URL` (default `http://127.0.0.1:8000`).

### Dependencies
- Added `rank-bm25>=0.2.2` (hybrid retrieval) and `mcp>=1.0.0` (MCP server).
- Bumped `fastapi` to `>=0.118` and `starlette` to `>=1.0` to stay compatible with the MCP SDK.

### Changed
- `model_server/extractor.py` is now a thin backward-compatible shim delegating to `owl_core.extractors`.

- Initial release