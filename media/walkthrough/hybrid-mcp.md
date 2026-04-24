# Hybrid search, code graph & MCP

OwlSpotlight goes beyond vector search:

- **Mode selector** (top of the sidebar): switch between **Semantic**,
  **Hybrid** (BM25 + embeddings via RRF), and **Lexical** (pure BM25).
- **🔗 Callers / Callees**: every result has a button that reveals the code
  graph neighborhood — who calls this function, and what does it call? Click an
  entry to jump there.
- **MCP server**: a Model Context Protocol server is bundled at
  `model_server/owl_mcp.py`. Point Claude Desktop / Cursor / any MCP client at
  it to let AI agents run semantic searches and follow the call graph.

```bash
cd model_server
.venv/bin/python -m owl_mcp
```

See the README for a full MCP client configuration example.
