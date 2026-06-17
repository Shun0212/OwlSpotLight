# OwlSpotlight

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.5.0-blue.svg)](https://github.com/Shun0212/owlspotlight)
[![Python](https://img.shields.io/badge/python-3.11+-green.svg)](https://www.python.org/)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.100+-blue.svg)](https://code.visualstudio.com/)
[![Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-brightgreen.svg)](https://marketplace.visualstudio.com/items?itemName=Shun0212.owlspotlight)

**Local-first semantic code search for VS Code, optimized for Python structure and Japanese/English natural-language queries.**

**Codex-ready MCP integration:** register OwlSpotlight from the sidebar and use `owlspotlight.search_code` directly inside Codex. Claude Code support is planned in the next few days.

Find functions, methods, classes, Python CodeBlocks, routes, tests, and call-heavy logic by describing intent instead of remembering names.

[English](#english) | [日本語](#japanese)

</div>

---

<a name="english"></a>
## English

### Why OwlSpotlight?

OwlSpotlight lets you search your codebase by **describing what code does**, instead of remembering names or guessing keywords. Type a query in natural language (English or Japanese) from the VS Code sidebar, and it finds the matching functions, methods, classes, top-level code blocks, FastAPI routes, and tests, then jumps straight to the location and highlights the definition. You can also select a block in the editor and find similar code, scope the search to only your changed git files, and choose between hybrid / semantic / BM25 / literal-keyword modes.

Everything runs locally on `127.0.0.1`, so your code never leaves your machine, and the index refreshes automatically as you edit. AI agents can use the same search through the built-in Codex MCP bridge.

Under the hood, it is more than generic chunk search: the retrieval engine is **NightOwl-CodeEmbedding** — a ~150M-parameter code-embedding model I built myself (a bi-encoder on the ModernBERT architecture, fine-tuned for code retrieval from my own NightOwl base model trained from scratch). OwlSpotlight builds a local semantic index from your code's structure, then blends this model's dense retrieval with lightweight BM25 lexical ranking and literal keyword matching.

| What you need | OwlSpotlight gives you |
|---|---|
| “Where is the FastAPI route that loads users?” | Route-aware Python metadata and hybrid search |
| “Find code like this selected block” | Editor selection search with direct jump |
| “Only search files I changed” | Git changed/untracked-file scope |
| “Search outside functions too” | Python `CodeBlock` extraction for top-level logic |
| “Use this from Codex” | Codex-ready MCP bridge with `owlspotlight.search_code` |
| “Keep code private” | Local index/search server on `127.0.0.1` |

![Demo Preview](screenshot/detect_function.png)

### Highlights

- **Search modes**: `hybrid`, `semantic`, `bm25`, or literal `keyword` mode.
- **Python static analysis**: params, return annotations, decorators, imports, calls, assigned names, docstrings, local call graph, import dependencies.
- **Python CodeBlocks**: searches top-level logic outside functions/classes, grouped between function/class definitions.
- **Framework-aware metadata**: FastAPI route and pytest symbol hints.
- **Search scopes**: all files, auto-detected source folders, or only git changed/untracked files.
- **Selection search**: right-click selected code and run `OwlSpotlight: Find Similar to Selection`.
- **Auto incremental indexing**: file watcher refreshes the index when supported files change.
- **Codex MCP support**: register OwlSpotlight directly from the sidebar and use `owlspotlight.search_code`, `owlspotlight.grep_repo`, and compact Agent Activity inside Codex.
- **Claude Code**: support is planned in the next few days.
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
| Mode | `Hybrid`, `Semantic`, `BM25`, `Keyword` |
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

Example `.mcp.json` for Cursor and other MCP clients:

```json
{
  "mcpServers": {
    "owlspotlight": {
      "type": "stdio",
      "command": "python",
      "args": ["/absolute/path/to/owlspotlight/model_server/mcp_server.py"],
      "env": {
        "OWLSPOTLIGHT_SERVER_URL": "http://127.0.0.1:8000",
        "OWLSPOTLIGHT_WORKSPACE": "/absolute/path/to/your/workspace"
      }
    }
  }
}
```

The MCP tool is `owlspotlight.search_code`. It can be called with only `query` when `OWLSPOTLIGHT_WORKSPACE` is set. It also accepts optional `directory`, `file_ext` (`auto` by default, respecting `.owlignore` plus git ignore/exclude rules), `top_k`, `scope`, `search_mode`, and `server_url`.
Agent searches are mirrored into the OwlSpotlight sidebar as compact activity. Use `owlspotlight.search_code` for semantic discovery, `owlspotlight.grep_repo` for repository-wide exact reference checks, and `owlspotlight.mark_results_used` to record only the ranks or grep locations the agent actually used as evidence. Human feedback is optional; the companion MCP tool `owlspotlight.get_human_feedback` is only needed when you explicitly enter query-improvement suggestions in the sidebar.
If an agent cannot see `owlspotlight.search_code` in its available tools, reload or restart the MCP client after updating `.mcp.json`; the agent should not need to inspect `mcp_server.py` or reverse-engineer the HTTP API when the MCP tool is loaded.

To avoid hand-editing paths, run **OwlSpotlight: Generate Agent Setup** from the Command Palette or click **Agent Setup** in the sidebar. It can register OwlSpotlight directly with Codex CLI, create/update the workspace `.mcp.json`, or copy agent instructions with the current server URL.

- Codex CLI: register the MCP server with `codex mcp add`, then restart Codex:

```bash
codex mcp add owlspotlight \
  --env OWLSPOTLIGHT_SERVER_URL=http://127.0.0.1:8000 \
  --env OWLSPOTLIGHT_WORKSPACE=/absolute/path/to/your/workspace \
  -- /absolute/path/to/owlspotlight/model_server/.venv/bin/python /absolute/path/to/owlspotlight/model_server/mcp_server.py
```

To remove the Codex registration later, use Agent Setup's remove option or run:

```bash
codex mcp remove owlspotlight
```

- Cursor: use project `.cursor/mcp.json` or global `~/.cursor/mcp.json`.
- Claude Code: support is planned in the next few days.
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
        |-- NightOwl-CodeEmbedding embeddings
        |-- FAISS vector index
        |-- Lightweight BM25 ranking
        |-- Literal keyword matching
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
| `owlspotlight.modelName` | `Shuu12121/NightOwl-CodeEmbedding` | Hugging Face embedding model |
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

OwlSpotlight は、関数やクラスの名前を覚えていなくても「**そのコードが何をしているか**」を説明するだけでコードを探せる VS Code 拡張機能です。サイドバーから自然言語（日本語・英語）でクエリを入力すると、該当する関数・メソッド・クラス・トップレベルのコードブロック・FastAPI route・テストを見つけて、その場所へジャンプし、定義をハイライト表示します。エディタで選択したコードから類似コードを探したり、検索範囲を git の変更ファイルだけに絞ったり、Hybrid / Semantic / BM25 / 完全一致キーワードのモードを切り替えることもできます。

検索・インデックスはすべて `127.0.0.1` のローカルサーバーで動くのでコードが外部に出ることはなく、ファイルを編集するとインデックスも自動で更新されます。さらに、組み込みの Codex MCP ブリッジを通じて AI エージェントから同じ検索を利用できます。

内部的には単なるチャンク検索ではありません。検索エンジンには、私自身が開発した独自のコード埋め込みモデル **NightOwl-CodeEmbedding**（約150Mパラメータ、ModernBERT アーキテクチャの Bi-Encoder。ゼロから学習させた自作 base model「NightOwl」をコード検索向けに fine-tune）を採用し、Python の構造・呼び出し・import・FastAPI route・pytest などの静的解析メタデータと、このモデルによる dense retrieval・BM25・完全一致キーワード検索を組み合わせて検索します。

**Codex MCP 対応**: sidebar から OwlSpotlight を Codex に登録し、Codex 内で `owlspotlight.search_code` を直接使えます。Claude Code 対応は数日中に追加予定です。

### 主な機能

- **検索モード**: `Hybrid`, `Semantic`, `BM25`, `Keyword` を切り替え可能。
- **Python静的解析**: params、return annotation、decorator、import、call、代入名、docstring、call graph、import dependency を抽出。
- **Python CodeBlock検索**: 関数/クラス外のトップレベル処理も検索対象。
- **FastAPI / pytest ヒント**: route や test/fixture をメタデータとして保持。
- **検索スコープ**: 全体、source系フォルダ、git変更済み/未追跡ファイルのみ。
- **選択範囲から類似検索**: エディタでコードを選択して類似コードへジャンプ。
- **自動差分インデックス**: 対応ファイル変更時にサーバー側の差分インデックスを更新。
- **Codex MCP対応**: sidebar から Codex へ直接登録し、`owlspotlight.search_code` / `owlspotlight.grep_repo` と compact Agent Activity を利用可能。
- **Claude Code**: 数日中に対応予定。
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
| Mode | `Hybrid`, `Semantic`, `BM25`, `Keyword` |
| Type | `All`, `Functions`, `Methods`, `CodeBlocks` |

`Source` は `src`, `app`, `lib`, `packages`, `client`, `server`, `backend`, `frontend` などを自動検知します。

`Changed` は git の変更済み・未追跡ファイルのみを検索します。

### MCP Server Mode

先に VS Code 側の OwlSpotlight server を起動してから、MCP stdio bridge を起動します。

```bash
python model_server/mcp_server.py
```

Cursor などの MCP client 向け `.mcp.json` 例:

```json
{
  "mcpServers": {
    "owlspotlight": {
      "type": "stdio",
      "command": "python",
      "args": ["/absolute/path/to/owlspotlight/model_server/mcp_server.py"],
      "env": {
        "OWLSPOTLIGHT_SERVER_URL": "http://127.0.0.1:8000",
        "OWLSPOTLIGHT_WORKSPACE": "/absolute/path/to/your/workspace"
      }
    }
  }
}
```

MCP tool は `owlspotlight.search_code` です。`OWLSPOTLIGHT_WORKSPACE` が設定されていれば `query` だけで呼べます。任意で `directory`, `file_ext` (`auto` がデフォルトで `.owlignore` と git ignore/exclude ルールを尊重), `top_k`, `scope`, `search_mode`, `server_url` も受け取ります。
エージェント経由の検索は OwlSpotlight サイドバーに compact activity として反映されます。意味的な発見には `owlspotlight.search_code`、リポジトリ全体の厳密な参照確認には `owlspotlight.grep_repo`、実際に根拠として使った rank や grep location の記録には `owlspotlight.mark_results_used` を使います。人間の feedback は任意です。サイドバーで明示的に改善案を入力した場合だけ、追加 MCP tool `owlspotlight.get_human_feedback` からエージェントが取得できます。
エージェントの available tools に `owlspotlight.search_code` が見えていない場合は、`.mcp.json` 更新後に MCP client を reload/restart してください。MCP tool が読み込まれていれば、エージェントが `mcp_server.py` を読んだり HTTP API を逆引きしたりする必要はありません。

パスを手で書き換えたくない場合は、コマンドパレットの **OwlSpotlight: Generate Agent Setup** またはサイドバーの **Agent Setup** を使ってください。Codex CLI へ直接登録したり、現在の server URL と絶対パス入りで workspace `.mcp.json` を作成/更新したり、エージェント向け指示をコピーできます。

- Codex CLI: `codex mcp add` で MCP server を登録してから Codex を再起動してください:

```bash
codex mcp add owlspotlight \
  --env OWLSPOTLIGHT_SERVER_URL=http://127.0.0.1:8000 \
  --env OWLSPOTLIGHT_WORKSPACE=/absolute/path/to/your/workspace \
  -- /absolute/path/to/owlspotlight/model_server/.venv/bin/python /absolute/path/to/owlspotlight/model_server/mcp_server.py
```

あとで Codex 登録を消す場合は、Agent Setup の remove option を使うか、次を実行します:

```bash
codex mcp remove owlspotlight
```

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
