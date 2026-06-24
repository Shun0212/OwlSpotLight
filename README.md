# OwlSpotlight

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.5.2-blue.svg)](https://github.com/Shun0212/owlspotlight)
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
- **Search scopes**: all files, auto-detected source folders, or a `Git Diff` scope where you pick base/head commits from a built-in commit graph and search either the changed functions or the unified diff hunks.
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
| Scope | `All`, `Source`, `Git Diff` |
| Mode | `Hybrid`, `Semantic`, `BM25`, `Keyword` |
| Type | `All`, `Functions`, `Methods`, `CodeBlocks` |

`Source` auto-detects folders such as `src`, `app`, `lib`, `packages`, `client`, `server`, `backend`, and `frontend`.

`Git Diff` restricts the search to a git diff. Pick the base/head commits from the built-in **commit graph** (click a commit to set the base, Shift+Click to set the head; leave both blank to compare `HEAD` against the working tree), then choose a **Diff view**:

- `Functions` — only the functions changed by the selected diff.
- `Unified diff` — the changed lines shown as unified diff hunks.

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

The MCP tool is `owlspotlight.search_code`. It can be called with only `query` when `OWLSPOTLIGHT_WORKSPACE` is set. It also accepts optional `directory`, `file_ext` (`auto` by default, respecting `.owlignore` plus git ignore/exclude rules), `top_k` (`30` by default), `scope`, `search_mode` (`semantic` by default), `search_target` (`functions`, `changed_functions`, or `diff_hunks`), `diff_base_ref`, `diff_head_ref`, and `server_url`.
Agent searches are mirrored into the OwlSpotlight sidebar as compact activity. Use `owlspotlight.search_code` for semantic discovery, `owlspotlight.grep_repo` for repository-wide exact reference checks, `owlspotlight.cancel_embedding` to stop a running indexing/embedding job, and `owlspotlight.mark_results_used` to record only the ranks or grep locations the agent actually used as evidence. Human feedback is optional; the companion MCP tool `owlspotlight.get_human_feedback` is only needed when you explicitly enter query-improvement suggestions in the sidebar.
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
| `owlspotlight.batchSize` | `2` | Embedding batch size |
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
| Memory issues | Lower `owlspotlight.batchSize` to `1` |
| Python file has syntax errors | OwlSpotlight falls back to Tree-sitter and keeps function/method search available |

### Contact

For questions, bug reports, feedback, or collaboration, contact [owlspotlight@gmail.com](mailto:owlspotlight@gmail.com).

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

OwlSpotlight は、関数やクラスの名前を覚えていなくても「**そのコードが何をするものか**」を説明するだけで目的のコードを探せる VS Code 拡張機能です。サイドバーから自然言語（日本語・英語）で入力すると、該当する関数・メソッド・クラス・トップレベルのコードブロック・FastAPI のルート・テストを見つけ出し、その場所へジャンプして定義をハイライト表示します。エディタで選択したコードに似たコードを探したり、検索範囲を Git の変更ファイルだけに絞り込んだり、Hybrid / Semantic / BM25 / 完全一致キーワードの各モードを切り替えたりすることもできます。

検索もインデックス作成もすべて `127.0.0.1` のローカルサーバー上で動くため、コードが外部に送信されることはありません。ファイルを編集すればインデックスも自動で更新されます。さらに、組み込みの Codex MCP ブリッジを介して、AI エージェントからも同じ検索機能を利用できます。

内部的には、単なるチャンク検索ではありません。検索エンジンには、私が独自に開発したコード埋め込みモデル **NightOwl-CodeEmbedding**（約 150M パラメータ、ModernBERT アーキテクチャの Bi-Encoder。ゼロから学習させた自作のベースモデル「NightOwl」をコード検索向けに fine-tune したもの）を採用しています。Python の構造・呼び出し・import・FastAPI のルート・pytest といった静的解析メタデータに、このモデルによる dense retrieval・BM25・完全一致キーワード検索を組み合わせて検索します。

**Codex MCP 対応**: サイドバーから OwlSpotlight を Codex に登録すれば、Codex 内で `owlspotlight.search_code` を直接呼び出せます。Claude Code への対応も数日中に追加予定です。

### 主な機能

- **検索モード**: `Hybrid` / `Semantic` / `BM25` / `Keyword` を切り替え可能。
- **Python の静的解析**: params、return annotation、decorator、import、call、代入名、docstring、call graph、import dependency を抽出。
- **Python の CodeBlock 検索**: 関数やクラスの外にあるトップレベルの処理も検索対象に含めます。
- **FastAPI / pytest のヒント**: ルートや test / fixture をメタデータとして保持。
- **検索スコープ**: 全体、source 系フォルダ、Git の変更済み・未追跡ファイル、またはブランチ比較から作った diff hunk から選択可能。
- **選択範囲からの類似検索**: エディタでコードを選択すると、似たコードへジャンプできます。
- **自動の差分インデックス**: 対応ファイルが変更されると、サーバー側の差分インデックスを更新します。
- **Codex MCP 対応**: サイドバーから Codex へ直接登録し、`owlspotlight.search_code` / `owlspotlight.grep_repo` とコンパクトな Agent Activity を利用できます。
- **Claude Code**: 数日中に対応予定。
- **ローカルファースト**: 検索もインデックスも `127.0.0.1` のローカルサーバーで実行します。
- **日本語クエリ対応**: Gemini API を設定すると、日本語のクエリを英語へ翻訳して検索します。

### クイックスタート

前提: [`uv`](https://docs.astral.sh/uv/getting-started/installation/) をインストールしておいてください。Python 3.11 のインストールも `uv` に任せられます。

1. [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Shun0212.owlspotlight) からインストールします。
2. OwlSpotlight のサイドバーを開きます。
3. **Setup / Start** をクリックします。
4. 自然言語で検索します。

手動で行う場合は、コマンドパレットから次を実行します:

```text
OwlSpotlight: Setup Python Environment
OwlSpotlight: Start Server
```

ログは **表示 -> 出力 -> OwlSpotlight** に表示されます。バックグラウンドで動作するため、VS Code のターミナルを占有することはありません。

### 検索オプション

検索バー右側の **Options** から変更できます。

| Option | 内容 |
|---|---|
| Language | Python, Java, TypeScript, TSX, JavaScript, JSX |
| Scope | `All`, `Source`, `Git Diff` |
| Mode | `Hybrid`, `Semantic`, `BM25`, `Keyword` |
| Type | `All`, `Functions`, `Methods`, `CodeBlocks` |

`Source` は `src`, `app`, `lib`, `packages`, `client`, `server`, `backend`, `frontend` などのフォルダを自動的に検出します。

`Git Diff` は検索対象を git の差分に限定します。内蔵の**コミットグラフ**から base / head のコミットを選び（コミットをクリックで base、Shift+クリックで head を設定。両方空なら `HEAD` とワーキングツリーを比較）、**Diff view** を選択します。

- `Functions` — 選択した差分で変更された関数のみ。
- `Unified diff` — 変更行を unified diff の hunk として表示。

### MCP サーバーモード

先に VS Code 側の OwlSpotlight サーバーを起動してから、MCP の stdio ブリッジを起動します。

```bash
python model_server/mcp_server.py
```

Cursor などの MCP クライアント向けの `.mcp.json` の例:

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

MCP ツールは `owlspotlight.search_code` です。`OWLSPOTLIGHT_WORKSPACE` を設定していれば、`query` だけで呼び出せます。このほか、任意の引数として `directory`、`file_ext`（デフォルトは `auto` で、`.owlignore` と Git の ignore / exclude ルールに従います）、`top_k`（デフォルト `30`）、`scope`、`search_mode`（デフォルト `semantic`）、`search_target`（`functions`、`changed_functions`、`diff_hunks`）、`diff_base_ref`、`diff_head_ref`、`server_url` も受け取ります。
エージェント経由の検索は、OwlSpotlight サイドバーにコンパクトなアクティビティとして表示されます。意味的な検索には `owlspotlight.search_code`、リポジトリ全体での厳密な参照確認には `owlspotlight.grep_repo`、実行中のインデックス作成・埋め込み処理の停止には `owlspotlight.cancel_embedding`、実際に根拠として使った順位や grep の該当箇所の記録には `owlspotlight.mark_results_used` を使います。人間からのフィードバックは任意です。サイドバーで改善案を明示的に入力した場合にのみ、追加の MCP ツール `owlspotlight.get_human_feedback` を通じてエージェントが取得できます。
エージェントの利用可能なツール一覧に `owlspotlight.search_code` が表示されない場合は、`.mcp.json` を更新したあとに MCP クライアントを再読み込み（リロード）または再起動してください。MCP ツールさえ読み込まれていれば、エージェントが `mcp_server.py` を読んだり HTTP API を解析したりする必要はありません。

パスを手作業で書き換えたくない場合は、コマンドパレットの **OwlSpotlight: Generate Agent Setup**、またはサイドバーの **Agent Setup** を使ってください。Codex CLI への直接登録、現在のサーバー URL と絶対パスを埋め込んだワークスペースの `.mcp.json` の作成・更新、エージェント向け指示のコピーが行えます。

- Codex CLI: `codex mcp add` で MCP サーバーを登録してから、Codex を再起動してください:

```bash
codex mcp add owlspotlight \
  --env OWLSPOTLIGHT_SERVER_URL=http://127.0.0.1:8000 \
  --env OWLSPOTLIGHT_WORKSPACE=/absolute/path/to/your/workspace \
  -- /absolute/path/to/owlspotlight/model_server/.venv/bin/python /absolute/path/to/owlspotlight/model_server/mcp_server.py
```

あとで Codex への登録を解除する場合は、Agent Setup の削除オプションを使うか、次を実行します:

```bash
codex mcp remove owlspotlight
```

### 連絡先

質問・不具合報告・フィードバック・共同開発などは、[owlspotlight@gmail.com](mailto:owlspotlight@gmail.com) までご連絡ください。

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
