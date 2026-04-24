"""owl_core: reusable semantic code-search primitives for OwlSpotlight.

This package is the shared foundation used by:
  - the VS Code extension's FastAPI server (``model_server/server.py``)
  - future Owl-CLI / MCP server / LangChain retriever integrations

The surface is intentionally small and dependency-light so that it can be
extracted into a standalone ``pip install owl-core`` package later without
breaking callers. Import paths inside this package must be relative.
"""
from .extractors import extract_functions, extract_symbols
from .indexer import CodeIndexer
from .model import (
    DEFAULT_MODEL,
    cleanup_memory,
    encode_code,
    get_current_device,
    get_device,
    get_model,
    get_model_embedding_dim,
)

__all__ = [
    "extract_functions",
    "extract_symbols",
    "CodeIndexer",
    "DEFAULT_MODEL",
    "encode_code",
    "get_model",
    "get_current_device",
    "get_device",
    "get_model_embedding_dim",
    "cleanup_memory",
]
