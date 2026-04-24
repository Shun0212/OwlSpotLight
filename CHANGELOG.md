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

### Changed
- `model_server/extractor.py` is now a thin backward-compatible shim delegating to `owl_core.extractors`.

- Initial release