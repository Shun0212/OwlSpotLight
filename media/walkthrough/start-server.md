# Start the search server

OwlSpotlight talks to a local FastAPI server on `http://127.0.0.1:8000`.

Run **OwlSpotlight: Start Server** to launch it in the background. The server:

- Extracts functions / methods / classes with tree-sitter (Python, Java,
  TypeScript).
- Builds a FAISS index plus a lightweight call graph.
- Exposes both REST and MCP interfaces.

You can keep the server running across multiple VS Code windows. Indexes are
cached per directory under `model_server/.owl_index/`.
