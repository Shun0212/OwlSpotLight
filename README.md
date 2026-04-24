# OwlSpotlight

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.4.4-blue.svg)](https://github.com/Shun0212/owlspotlight)
[![Python](https://img.shields.io/badge/python-3.11+-green.svg)](https://www.python.org/)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.100+-blue.svg)](https://code.visualstudio.com/)
[![Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-brightgreen.svg)](https://marketplace.visualstudio.com/items?itemName=Shun0212.owlspotlight)

**Local-first semantic code search for VS Code, optimized for Python structure and Japanese/English natural-language queries.**

Find functions, methods, classes, Python CodeBlocks, routes, tests, and call-heavy logic by describing intent instead of remembering names.

[English](#english) | [日本語](#japanese)

</div>

---

<a name="english"></a>
## English

### Why OwlSpotlight?

OwlSpotlight is not just generic chunk search. It builds a local semantic index from code structure, then combines ModernBERT embeddings with lightweight BM25 lexical ranking.

| What you need | OwlSpotlight gives you |
|---|---|
| “Where is the FastAPI route that loads users?” | Route-aware Python metadata and hybrid search |
| “Find code like this selected block” | Editor selection search with direct jump |
| “Only search files I changed” | Git changed/untracked-file scope |
| “Search outside functions too” | Python `CodeBlock` extraction for top-level logic |
| “Use this from an AI agent” | stdio MCP bridge with `owlspotlight.search_code` |
| “Keep code private” | Local index/search server on `127.0.0.1` |

![Demo Preview](screenshot/detect_function.png)

### Highlights

- **Hybrid search**: `hybrid`, `semantic`, or `bm25` mode.
- **Python static analysis**: params, return annotations, decorators, imports, calls, assigned names, docstrings, local call graph, import dependencies.
- **Python CodeBlocks**: searches top-level logic outside functions/classes, grouped between function/class definitions.
- **Framework-aware metadata**: FastAPI route and pytest symbol hints.
- **Search scopes**: all files, auto-detected source folders, or only git changed/untracked files.
- **Selection search**: right-click selected code and run `OwlSpotlight: Find Similar to Selection`.
- **Auto incremental indexing**: file watcher refreshes the index when supported files change.
- **MCP bridge**: use OwlSpotlight as a local semantic search tool from Claude Code, Cursor, Cline, and other MCP clients.
- **Cross-platform setup**: `uv` + Python 3.11 on macOS, Linux, and Windows, with CPU/GPU/MPS support.
- **Japanese queries**: optional Japanese to English query translation through Gemini API.

### Supported Languages

| Language | Support |
|---|---|
| Python | Stable. Functions, methods, CodeBlocks, AST metadata, FastAPI/pytest hints |
| Java | Functions/methods/classes via Tree-sitter |
| TypeScript / TSX | Functions and class methods via Tree-sitter |
| JavaScript / JSX | Functions and class methods via Tree-sitter |

### Quick Start

Prerequisite: install [`uv`](https://docs.astral.sh/uv/getting-started/installation/). `uv` can also manage Python 3.11 for you.

1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Shun0212.owlspotlight).
2. Open the OwlSpotlight sidebar.
3. Click **Setup / Start**.
4. Search with natural language.

Manual command-palette flow:

```text
OwlSpotlight: Setup Python Environment
OwlSpotlight: Start Server
```

Server logs are shown in **View -> Output -> OwlSpotlight**. OwlSpotlight runs as a background process and does not take over your terminal.

### Search Options

The sidebar keeps the main search bar compact. Click **Options** to choose:

| Option | Values |
|---|---|
| Language | Python, Java, TypeScript, TSX, JavaScript, JSX |
| Scope | `All`, `Source`, `Changed` |
| Mode | `Hybrid`, `Semantic`, `BM25` |
| Type | `All`, `Functions`, `Methods`, `CodeBlocks` |

`Source` auto-detects folders such as `src`, `app`, `lib`, `packages`, `client`, `server`, `backend`, and `frontend`.

`Changed` searches only git changed and untracked files.

### Python Static Analysis

For Python, OwlSpotlight uses `ast` first and falls back to Tree-sitter when AST parsing fails, for example while a file is temporarily syntactically broken during editing.

Extracted metadata includes:

- `params`
- `returns`
- `decorators`
- `imports`
- `calls`
- `assigned_names`
- `docstring`
- `framework_tags`
- `routes`
- `local_calls`
- `external_import_calls`
- `call_graph`
- `import_dependency`

CodeBlocks represent top-level code not inside functions/classes. They are grouped by the region between function/class definitions, not split aggressively by blank lines.

### MCP Server Mode

Start the VS Code OwlSpotlight server first, then run the MCP stdio bridge:

```bash
python model_server/mcp_server.py
```

Example `.mcp.json` for Claude Code or Cursor:

```json
{
  "mcpServers": {
    "owlspotlight": {
      "type": "stdio",
      "command": "python",
      "args": ["/absolute/path/to/owlspotlight/model_server/mcp_server.py"],
      "env": {
        "OWLSPOTLIGHT_SERVER_URL": "http://127.0.0.1:8000"
      }
    }
  }
}
```

The MCP tool is `owlspotlight.search_code`. It accepts `directory`, `query`, `file_ext`, `top_k`, `scope`, `search_mode`, and optional `server_url`.

- Cursor: use project `.cursor/mcp.json` or global `~/.cursor/mcp.json`.
- Claude Code: use `.mcp.json` or `claude mcp add-json`.
- Cline: add the same `mcpServers.owlspotlight` entry in MCP settings and include `"disabled": false` if required by your config.

### Build From Source

```bash
git clone https://github.com/Shun0212/owlspotlight.git
cd owlspotlight
npm install
npm run compile
npx vsce package
```

Then install the generated `.vsix` with `Extensions: Install from VSIX...`.

### Architecture

```text
VS Code Sidebar/Webview
        |
        | localhost HTTP
        v
FastAPI background server
        |
        |-- Tree-sitter extractors: Java, JS, JSX, TS, TSX
        |-- Python AST extractor + Tree-sitter fallback
        |-- ModernBERT embeddings
        |-- FAISS vector index
        |-- Lightweight BM25 ranking
        |-- Disk + memory incremental cache
```

### Commands

| Command | Description |
|---|---|
| `OwlSpotlight: Setup Python Environment` | Create/update the uv-managed Python environment |
| `OwlSpotlight: Start Server` | Start the background search server |
| `OwlSpotlight: Stop Server` | Stop the server |
| `OwlSpotlight: Code Search` | Open the sidebar search panel |
| `OwlSpotlight: Find Similar to Selection` | Search for code similar to selected editor text |
| `OwlSpotlight: Clear Cache` | Clear FAISS/index cache |
| `OwlSpotlight: Remove Virtual Environment` | Delete `.venv` and start fresh |

### Configuration

| Setting | Default | Description |
|---|---:|---|
| `owlspotlight.modelName` | `Shuu12121/Owl-ph2-len2048` | Hugging Face embedding model |
| `owlspotlight.batchSize` | `32` | Embedding batch size |
| `owlspotlight.autoStartServer` | `false` | Start server when VS Code opens |
| `owlspotlight.autoIndexOnFileChange` | `true` | Refresh incremental index when supported files change |
| `owlspotlight.enableJapaneseTranslation` | `false` | Enable Japanese to English query translation |
| `owlspotlight.geminiApiKey` | `""` | Gemini API key for translation |
| `owlspotlight.cacheSettings.autoClearCache` | `false` | Clear index cache on server start |
| `owlspotlight.environmentSettings.pythonVersion` | `3.11` | Python version used by `uv` |

### Troubleshooting

| Problem | Fix |
|---|---|
| Server will not start | Run `OwlSpotlight: Setup Python Environment`, then check **Output -> OwlSpotlight** |
| `uv` not found | Install uv from the official uv docs or with Homebrew/WinGet/pipx |
| No results | Check server status, language option, scope option, and whether files exist for that extension |
| Changed scope returns nothing | Ensure the workspace is a git repository and files are modified or untracked |
| Memory issues | Lower `owlspotlight.batchSize` to `8` or `4` |
| Python file has syntax errors | OwlSpotlight falls back to Tree-sitter and keeps function/method search available |

### Roadmap

- Python framework extractors beyond FastAPI/pytest: Django views, SQLAlchemy models, Pydantic schemas.
- Call graph UI panel.
- Import dependency explorer.
- Search history and bookmarks.
- Benchmarks on real repositories.

---

<a name="japanese"></a>
## 日本語

### OwlSpotlight とは

OwlSpotlight は、VS Code 上でローカルコードを自然言語検索するための拡張機能です。単なるチャンク検索ではなく、Python の構造・呼び出し・import・FastAPI route・pytest などの静的解析メタデータを使い、semantic embedding と BM25 を組み合わせて検索します。

### 主な機能

- **ハイブリッド検索**: `Hybrid`, `Semantic`, `BM25` を切り替え可能。
- **Python静的解析**: params、return annotation、decorator、import、call、代入名、docstring、call graph、import dependency を抽出。
- **Python CodeBlock検索**: 関数/クラス外のトップレベル処理も検索対象。
- **FastAPI / pytest ヒント**: route や test/fixture をメタデータとして保持。
- **検索スコープ**: 全体、source系フォルダ、git変更済み/未追跡ファイルのみ。
- **選択範囲から類似検索**: エディタでコードを選択して類似コードへジャンプ。
- **自動差分インデックス**: 対応ファイル変更時にサーバー側の差分インデックスを更新。
- **MCP対応**: Claude Code / Cursor / Cline などから `owlspotlight.search_code` を呼び出し可能。
- **ローカルファースト**: 検索・インデックスは `127.0.0.1` のローカルサーバーで実行。
- **日本語クエリ対応**: Gemini API を設定すると日本語クエリを英語へ翻訳して検索。

### クイックスタート

前提: [`uv`](https://docs.astral.sh/uv/getting-started/installation/) をインストールしてください。Python 3.11 は `uv` に管理させることもできます。

1. [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Shun0212.owlspotlight) からインストール。
2. OwlSpotlight サイドバーを開く。
3. **Setup / Start** をクリック。
4. 自然言語で検索。

手動で行う場合:

```text
OwlSpotlight: Setup Python Environment
OwlSpotlight: Start Server
```

ログは **表示 -> 出力 -> OwlSpotlight** に出ます。VS Code のターミナルは占有しません。

### 検索オプション

検索バー右側の **Options** から変更できます。

| Option | 内容 |
|---|---|
| Language | Python, Java, TypeScript, TSX, JavaScript, JSX |
| Scope | `All`, `Source`, `Changed` |
| Mode | `Hybrid`, `Semantic`, `BM25` |
| Type | `All`, `Functions`, `Methods`, `CodeBlocks` |

`Source` は `src`, `app`, `lib`, `packages`, `client`, `server`, `backend`, `frontend` などを自動検知します。

`Changed` は git の変更済み・未追跡ファイルのみを検索します。

### MCP Server Mode

先に VS Code 側の OwlSpotlight server を起動してから、MCP stdio bridge を起動します。

```bash
python model_server/mcp_server.py
```

Claude Code / Cursor 向け `.mcp.json` 例:

```json
{
  "mcpServers": {
    "owlspotlight": {
      "type": "stdio",
      "command": "python",
      "args": ["/absolute/path/to/owlspotlight/model_server/mcp_server.py"],
      "env": {
        "OWLSPOTLIGHT_SERVER_URL": "http://127.0.0.1:8000"
      }
    }
  }
}
```

MCP tool は `owlspotlight.search_code` です。`directory`, `query`, `file_ext`, `top_k`, `scope`, `search_mode`, `server_url` を受け取ります。

### 開発

```bash
npm install
npm run compile
npm run lint
npm test
python3 -m unittest model_server.tests.test_extractors
```

### License

MIT
