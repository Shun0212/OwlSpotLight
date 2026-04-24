# OwlSpotlight

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.4.3-blue.svg)](https://github.com/shun0212/OwlSpotLight)
[![Python](https://img.shields.io/badge/python-3.11+-green.svg)](https://www.python.org/)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.100+-blue.svg)](https://code.visualstudio.com/)
[![Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-brightgreen.svg)](https://marketplace.visualstudio.com/items?itemName=Shun0212.owlspotlight)

**AI-powered semantic code search for VS Code**

*Find Python, Java, and TypeScript code using natural language — describe what the code does, not what it's called.*

[English](#english) | [日本語](#japanese)

</div>

---

<a name="english"></a>
## English

### What is OwlSpotlight?

OwlSpotlight brings **semantic understanding** to VS Code code navigation. Instead of hunting for exact function names, describe what the code does in plain language — *"function that validates email"* or *"class for database connections"* — and find it instantly.

![Demo Preview](screenshot/detect_function.png)

---

### Key Features

| Feature | Description |
|---------|-------------|
| **Semantic Search** | Find code by intent, not keywords — powered by `Owl-ph2-len2048` (ModernBERT) |
| **Incremental Indexing** | Only changed files are re-indexed for fast subsequent searches |
| **Multi-symbol Support** | Search functions, classes, methods, and their relationships |
| **Python CodeBlocks** | Search top-level Python logic outside functions, such as `if`, `for`, `with`, `try`, assignments, and expressions |
| **Python Static Analysis** | Adds Python metadata such as params, return annotations, decorators, imports, calls, assigned names, and docstrings |
| **Web Project Support** | Python, Java, TypeScript, TSX, JavaScript, and JSX symbol extraction |
| **Class Statistics** | View class hierarchies ranked by relevance with method-level scoring |
| **Japanese Translation** | Auto-translate Japanese queries to English via Gemini API |
| **Smart Highlighting** | Jump to results with color-coded highlighting |
| **Background Server** | Server runs silently in the background — logs appear in the VS Code OUTPUT panel, no terminal conflicts |
| **Apple Silicon** | MPS acceleration on M-series chips |
| **CUDA / GPU** | Auto-detects NVIDIA driver support and installs CUDA 12.8 / 12.4 when possible; otherwise uses the CPU build |
| **Cross-platform** | Supported on macOS, Linux, and Windows |
| **Similarity Scores** | Similarity badges and bars showing result relevance |

---

### See It In Action

| Feature | Preview |
|---------|---------|
| Semantic Function Search | ![Function Search](screenshot/detect_function.png) |
| Server Output Panel | ![Server Output](screenshot/init_server.png) |
| Settings Panel | ![Settings](screenshot/Setting.png) |
| Environment Alert | ![Environment Alert](screenshot/alart_No_venv.png) |

---

### Quick Start

**Prerequisites**: `uv` installed on your system (`uv` can manage Python 3.11 automatically)

> OwlSpotlight now installs its Python environment with `uv`. The same `OwlSpotlight: Setup Python Environment` flow works on macOS, Linux, and Windows.

> Queries can be entered in English or Japanese. Japanese text is automatically translated to English when the translation feature is enabled.

#### Option 1: Automatic Setup (Recommended)

1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Shun0212.owlspotlight)
2. Open the OwlSpotlight sidebar and click **Setup / Start**.
3. Choose the recommended PyTorch build when prompted.
4. Start searching with natural-language queries.

You can also run the setup manually from the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):
   ```
   OwlSpotlight: Setup Python Environment
   OwlSpotlight: Start Server
   ```

Server logs appear in **View → Output → OwlSpotlight Server**. No terminal window is opened.

![Server Initialization](screenshot/init_server.png)

#### Option 2: Build from Source

```bash
git clone https://github.com/shun0212/OwlSpotLight.git
cd OwlSpotLight
npm install && npm run compile && npx vsce package
# Install the generated .vsix via: Extensions: Install from VSIX...
```

Then run `OwlSpotlight: Setup Python Environment` from the Command Palette.

---

### Environment Setup

The `Setup Python Environment` command handles everything automatically with `uv` — it creates a `.venv` inside `model_server/` and installs all required packages on macOS, Linux, and Windows.

With `--torch-mode auto`, OwlSpotlight tries to detect NVIDIA support via `nvidia-smi`, chooses the newest compatible build from the shared CUDA matrix (`cu130` → `cu129` → `cu128` → `cu126` → `cu124` → `cu121` → `cu118`), and falls back to the CPU PyTorch build if no compatible GPU/driver is found or if CUDA runtime validation fails.

On macOS, OwlSpotlight always installs the CPU PyTorch build because CUDA wheels are not supported there. Apple Silicon can still use MPS acceleration at runtime.

The setup flow also searches for `uv` and `nvidia-smi` in `PATH` and common install locations (standalone installer, pipx, cargo, WinGet, Scoop, and typical NVIDIA utility paths) before giving up.

**What changed:** Previously, the server was launched directly inside a VS Code integrated terminal. This caused conflicts with the VS Code Python extension's own venv activation. The server now runs as a **background process**, and all output is routed to the VS Code **OUTPUT panel** (`OwlSpotlight Server` channel). Your terminal stays clean and there are no environment conflicts.

#### Manual Setup (Advanced)

```bash
cd model_server

# macOS / Linux
uv run --no-project --python 3.11 bootstrap_env.py --python 3.11 --torch-mode auto
source .venv/bin/activate
```

```powershell
# Windows PowerShell
cd model_server
uv run --no-project --python 3.11 bootstrap_env.py --python 3.11 --torch-mode auto
.\.venv\Scripts\Activate.ps1
```

`--torch-mode` options:

| Flag | Description |
|------|-------------|
| `auto` | Detect NVIDIA driver support and choose the newest compatible CUDA build from the shared matrix, otherwise fall back to CPU |
| `cpu` | CPU only |
| `cuda` | Install a specific CUDA build via `--torch-build` (or a custom wheel index via `--torch-index`) |
| `skip` | Skip PyTorch installation |
| `--force-recreate` | Rebuild the virtual environment from scratch |

`--torch-build` matrix:

| Key | CUDA | Wheel index | Linux min driver | Windows min driver | Architectures |
|-----|------|-------------|------------------|--------------------|---------------|
| `cu130` | 13.0 | `https://download.pytorch.org/whl/cu130` | `580.0+` | `580.0+` | Linux `x64`, `arm64`; Windows `x64` |
| `cu129` | 12.9 | `https://download.pytorch.org/whl/cu129` | `575.51.03+` | `576.02+` | Linux `x64`, `arm64`; Windows `x64` |
| `cu128` | 12.8 | `https://download.pytorch.org/whl/cu128` | `570.26+` | `570.65+` | Linux `x64`, `arm64`; Windows `x64` |
| `cu126` | 12.6 | `https://download.pytorch.org/whl/cu126` | `560.28.03+` | `560.76+` | Linux `x64`; Windows `x64` |
| `cu124` | 12.4 | `https://download.pytorch.org/whl/cu124` | `550.54.14+` | `551.61+` | Linux `x64`; Windows `x64` |
| `cu121` | 12.1 | `https://download.pytorch.org/whl/cu121` | `530.30.02+` | `531.14+` | Linux `x64`; Windows `x64` |
| `cu118` | 11.8 | `https://download.pytorch.org/whl/cu118` | `520.61.05+` | `520.06+` | Linux `x64`; Windows `x64` |

#### Installing uv

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
```

```powershell
# Windows PowerShell
winget install --id=astral-sh.uv -e
```

#### macOS / Linux with a pinned Python version

```bash
brew install npm uv
cd model_server
uv run --no-project --python 3.11 bootstrap_env.py --python 3.11 --torch-mode auto
source .venv/bin/activate
```

#### Windows

```powershell
cd model_server
uv run --no-project --python 3.11 bootstrap_env.py --python 3.11 --torch-mode auto
.\.venv\Scripts\Activate.ps1
```

If you want the extension to pick the safest GPU build automatically, use `--torch-mode auto`. For manual override, use `--torch-mode cuda --torch-build cu126` (or another key from the matrix above). If you need a custom or future wheel index that is not in the shared matrix yet, you can still pass `--torch-mode cuda --torch-index https://download.pytorch.org/whl/cuXXX`. The setup script replaces any existing CPU-only PyTorch build before installing the selected build, and auto mode falls back to CPU if CUDA cannot be used safely.

---

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   VS Code Extension                     │
│  Sidebar UI (Webview) <-> Extension Host (TypeScript)   │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTP (localhost:8000 by default,
                            │        next free port if needed)
┌───────────────────────────▼─────────────────────────────┐
│         FastAPI Server (Background Process)              │
│         Logs -> VS Code OUTPUT panel                     │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Extractors  │  │  Embedding   │  │  FAISS Index  │  │
│  │ (Tree-sitter)│  │  Model       │  │  (Similarity  │  │
│  │ .py .java    │  │(Owl-ph2-2048)│  │   Search)     │  │
│  │ .ts .tsx     │  │ MPS/CUDA/CPU │  │  Incremental  │  │
│  │ .js .jsx     │  │              │  │               │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────┘
```

- **Extractors** — Tree-sitter parsers for Python, Java, and TypeScript
- **Embedding Model** — `Shuu12121/Owl-ph2-len2048` (ModernBERT, 2048-token context)
- **FAISS Index** — Fast nearest-neighbor lookup with incremental updates
- **3-tier Cache** — Memory, disk, and code-to-embedding cache

---

### Why OwlSpotlight?

| Traditional Search | OwlSpotlight |
|-------------------|--------------|
| `def email_validation` | *"function that validates email addresses"* |
| `class Database` | *"class for database connections"* |
| Exact keyword matching | Semantic understanding of code purpose |
| Function names only | Logic, comments, and documentation included |

---

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `owlspotlight.modelName` | `Shuu12121/Owl-ph2-len2048` | Hugging Face embedding model |
| `owlspotlight.batchSize` | `32` | Batch size for embedding |
| `owlspotlight.autoStartServer` | `false` | Auto-start server when VS Code opens |
| `owlspotlight.autoIndexOnFileChange` | `true` | Refresh the incremental index when supported files change |
| `owlspotlight.enableJapaneseTranslation` | `false` | Enable Japanese to English auto-translation |
| `owlspotlight.geminiApiKey` | `""` | Google Gemini API key for translation |
| `owlspotlight.cacheSettings.autoClearCache` | `false` | Auto-clear cache on server start |
| `owlspotlight.environmentSettings.pythonVersion` | `3.11` | Python version for virtual environment |

#### Japanese Translation Setup

1. Get a free API key at [Google AI Studio](https://aistudio.google.com/app/apikey)
2. In VS Code Settings (`Cmd+,`):
   - `owlspotlight.enableJapaneseTranslation` → `true`
   - `owlspotlight.geminiApiKey` → your key

![Settings](screenshot/Setting.png)

---

### Commands

| Command | Description |
|---------|-------------|
| `OwlSpotlight: Start Server` | Start the background server |
| `OwlSpotlight: Stop Server` | Cleanly shut down the server |
| `OwlSpotlight: Setup Python Environment` | Create or update the uv-managed Python venv |
| `OwlSpotlight: Code Search` | Open the search panel |
| `OwlSpotlight: Find Similar to Selection` | Search for code similar to the current editor selection |
| `OwlSpotlight: Clear Cache` | Clear FAISS index and embedding cache |
| `OwlSpotlight: Remove Virtual Environment` | Delete the `.venv` and start fresh |

---

### Search Scopes

The sidebar search scope can be set to:

| Scope | Description |
|-------|-------------|
| `All` | Search all indexed files for the selected language |
| `Source` | Auto-detect source-like folders such as `src`, `app`, `lib`, `packages`, `client`, and `server` |
| `Changed` | Search only git changed and untracked files |

The editor context menu also provides **OwlSpotlight: Find Similar to Selection**. Select a code block, run the command, choose a scope, then jump directly to a similar result.

---

### MCP Server Mode

OwlSpotlight includes a lightweight stdio MCP bridge for AI coding agents:

```bash
python model_server/mcp_server.py
```

Start the OwlSpotlight VS Code server first, then configure your MCP client to launch the script above. The MCP tool `owlspotlight.search_code` accepts `directory`, `query`, `file_ext`, `top_k`, and `scope` (`all`, `source`, or `changed`). Set `OWLSPOTLIGHT_SERVER_URL` if the local HTTP server is not using `http://127.0.0.1:8000`.

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

For Cursor, use `.cursor/mcp.json` in the project or `~/.cursor/mcp.json` globally. For Claude Code, use `.mcp.json` or `claude mcp add-json`. For Cline, add the same `mcpServers.owlspotlight` entry in its MCP settings and include `"disabled": false` if your Cline config requires it.

---

### System Requirements

| Component | Requirement |
|-----------|-------------|
| Runtime | `uv` + Python 3.11 (uv-managed or system-installed) |
| Memory | 4 GB+ (8 GB+ for large projects) |
| Storage | 2–3 GB (dependencies + model weights) |
| Platform | macOS, Linux, Windows |

---

### API Endpoints

The Python backend exposes these REST endpoints on the OwlSpotlight local server. The extension uses `localhost:8000` by default and automatically falls back to the next free port when needed:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/search_functions_simple` | POST | Find functions by query, including relative `similarity` fields |
| `/get_class_stats` | POST | Get class/method statistics |
| `/build_index` | POST | Build FAISS index for a directory |
| `/force_rebuild_index` | POST | Clear cache and rebuild index |
| `/index_status` | GET | Check if index is up-to-date |
| `/embed` | POST | Encode text to embeddings |
| `/settings` | GET | View current server settings |
| `/update_settings` | POST | Update batch size and settings |

---

### Troubleshooting

<details>
<summary><strong>Server won't start</strong></summary>

- Verify `uv` is installed: `uv --version`
- If needed, install Python 3.11 through uv: `uv python install 3.11`
- Check if `.venv` exists in `model_server/`. If not, run `OwlSpotlight: Setup Python Environment`.
- If port 8000 is already in use, OwlSpotlight will try the next free local port automatically.
- Use `OwlSpotlight: Stop Server` or the sidebar **Stop Server** button to stop a server started by the extension.
- Check **View → Output → OwlSpotlight Server** for detailed error logs.
</details>

<details>
<summary><strong>No search results</strong></summary>

- Confirm the sidebar status indicator shows **Online**.
- Verify your workspace contains `.py`, `.java`, `.ts`, `.tsx`, `.js`, or `.jsx` files.
- Try `OwlSpotlight: Clear Cache` and rebuild the index.
</details>

<details>
<summary><strong>Memory errors / Out of memory</strong></summary>

- Reduce `owlspotlight.batchSize` to `8` or `4`.
- The server auto-falls back to CPU if GPU memory is insufficient.
</details>

<details>
<summary><strong>Japanese translation not working</strong></summary>

- Confirm `enableJapaneseTranslation` is `true`.
- Verify the Gemini API key is correctly set.
- Check the OUTPUT panel for error messages.
</details>

<details>
<summary><strong>Conflict with VS Code Python extension (upgrading from an older version)</strong></summary>

Since v0.4.0 the server runs as a background process — no terminal is used. If you upgraded from an older version and encounter issues, run `OwlSpotlight: Remove Virtual Environment` then `OwlSpotlight: Setup Python Environment` to rebuild the environment cleanly.
</details>

---

### Roadmap

**Current**
- [x] Natural language search for Python, Java, TypeScript
- [x] JavaScript, JSX, and TSX symbol extraction
- [x] Incremental indexing
- [x] Apple Silicon and CUDA optimization
- [x] Class statistics and hierarchy visualization
- [x] Japanese to English translation (Gemini API)
- [x] Server status indicator
- [x] Similarity score visualization
- [x] Background server with OUTPUT panel logging
- [x] Auto-start server option
- [x] Selection-based similar code search
- [x] Source-only and changed-file search scopes
- [x] MCP stdio bridge
- [x] Python CodeBlock extraction and static metadata

**Upcoming**
- [ ] Multi-language support (C++, Go, Rust)
- [ ] Class inheritance diagrams
- [ ] Search history and bookmarks
- [ ] Code preview on hover

---

### CI/CD

GitHub Actions workflows:
- **CI** — `npm test` + `eslint` on push/PR to `main`
- **Release** — Tag `v*.*.*` to auto-build `.vsix` and publish via `vsce publish` (requires `VSCE_TOKEN` secret)

---

### Contributing

Bug reports, feature requests, and pull requests are welcome via [GitHub](https://github.com/shun0212/OwlSpotLight/issues).

### License

MIT — see [LICENSE](LICENSE).

---

<a name="japanese"></a>
## 日本語

### OwlSpotlightとは？

OwlSpotlightは、VS CodeでPython・Java・TypeScriptコードを**自然言語で検索**できる拡張機能です。
[Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Shun0212.owlspotlight)から無料でインストールできます。

「メールを検証する関数」「データベース接続を処理するクラス」など、**コードの意図を表現したクエリ**で関連するコードを素早く見つけられます。

![Demo Preview](screenshot/detect_function.png)

---

### 主な特長

| 機能 | 説明 |
|------|------|
| **意味的検索** | `Owl-ph2-len2048`（ModernBERT）によるコードの意図ベース検索 |
| **高速インデックス** | 変更ファイルのみ再インデックス |
| **マルチシンボル対応** | 関数・クラス・メソッドとその関係を検索 |
| **Python CodeBlock** | 関数外の `if`、`for`、`with`、`try`、代入、式などのトップレベル処理も検索 |
| **Python 静的解析** | params、return annotation、decorator、import、call、代入名、docstring などのメタデータを付与 |
| **Webプロジェクト対応** | Python、Java、TypeScript、TSX、JavaScript、JSX のシンボル抽出 |
| **クラス統計** | 関連度ランキング付きのクラス階層表示 |
| **日本語対応** | Gemini API による日本語→英語自動翻訳 |
| **スマートハイライト** | 色分けハイライトで結果箇所へジャンプ |
| **バックグラウンドサーバー** | ターミナル不使用 — ログは VS Code の OUTPUT パネルに表示 |
| **Apple Silicon** | M 系チップの MPS アクセラレーション最適化 |
| **CUDA / GPU** | NVIDIA ドライバ対応を自動判定し、可能なら CUDA 12.8 / 12.4 を導入。難しい場合は CPU 版を使用 |
| **クロスプラットフォーム** | macOS / Linux / Windows に対応 |
| **類似度スコア** | 結果の関連度をバッジとバーで視覚表示 |

---

### 実行画面

| 機能 | プレビュー |
|------|-----------|
| 関数の意味的検索 | ![Function Search](screenshot/detect_function.png) |
| OUTPUT パネルへのサーバーログ出力 | ![Server Output](screenshot/init_server.png) |
| 設定画面 | ![Settings](screenshot/Setting.png) |
| 環境アラート | ![Environment Alert](screenshot/alart_No_venv.png) |

---

### クイックスタート

**前提条件**: `uv` がインストールされていること（Python 3.11 は `uv` に管理させても構いません）

> OwlSpotlight の Python 環境構築は `uv` ベースになりました。`OwlSpotlight: Setup Python Environment` は macOS / Linux / Windows で同じ流れで利用できます。

> クエリは英語・日本語どちらでも入力可能。自動翻訳を有効にすると、日本語クエリは英語に変換されて検索されます。

#### 方法1: 自動セットアップ（推奨）

1. [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Shun0212.owlspotlight) から拡張機能をインストール
2. OwlSpotlight サイドバーを開き、**Setup / Start** をクリック
3. 表示された PyTorch ビルド選択で推奨項目を選択
4. 自然言語クエリで検索開始

手動で実行する場合は、コマンドパレット（`Cmd+Shift+P` / `Ctrl+Shift+P`）から次を実行します：
   ```
   OwlSpotlight: Setup Python Environment
   OwlSpotlight: Start Server
   ```

サーバーのログは `表示 → 出力 → OwlSpotlight Server` に表示されます。ターミナルウィンドウは開きません。

![Server Initialization](screenshot/init_server.png)

#### 方法2: ソースからビルド

```bash
git clone https://github.com/shun0212/OwlSpotLight.git
cd OwlSpotLight
npm install && npm run compile && npx vsce package
# 生成された .vsix を「Extensions: Install from VSIX...」でインストール
```

その後、コマンドパレットから `OwlSpotlight: Setup Python Environment` を実行してください。

---

### 環境構築について

`Setup Python Environment` コマンドにより、`uv` を使って仮想環境の作成から依存パッケージのインストールまで**すべて自動**で行われます。macOS / Linux / Windows のいずれでも同じコマンドでセットアップできます。

`--torch-mode auto` を使うと、OwlSpotlight は `nvidia-smi` で NVIDIA 環境をできる限り自動判定し、共有 CUDA 対応表（`cu130` → `cu129` → `cu128` → `cu126` → `cu124` → `cu121` → `cu118`）から、使える中で最も新しいビルドを選びます。対応 GPU / ドライバが見つからない場合や CUDA の runtime 検証に失敗した場合は、CPU 版の PyTorch に自動でフォールバックします。

macOS では CUDA ホイールが使えないため、常に CPU 版の PyTorch を導入します。Apple Silicon では実行時に MPS アクセラレーションを利用できます。

また、セットアップ時は `uv` や `nvidia-smi` を `PATH` だけでなく、standalone installer / pipx / cargo / WinGet / Scoop / NVIDIA ユーティリティの典型的な配置場所も含めて探索します。

**以前のバージョンからの変更点:** 旧バージョンではサーバーを VS Code の統合ターミナルで直接起動していたため、VS Code の Python 拡張機能が持つ venv 設定と競合することがありました。現在はサーバーを**バックグラウンドプロセス**として起動し、出力はすべて VS Code の **OUTPUT パネル**（`OwlSpotlight Server` チャンネル）に表示されます。ターミナルは一切使用しないため、他の Python 環境との競合が発生しません。

#### 手動セットアップ（上級者向け）

```bash
cd model_server

# macOS / Linux
uv run --no-project --python 3.11 bootstrap_env.py --python 3.11 --torch-mode auto
source .venv/bin/activate
```

```powershell
# Windows PowerShell
cd model_server
uv run --no-project --python 3.11 bootstrap_env.py --python 3.11 --torch-mode auto
.\.venv\Scripts\Activate.ps1
```

`--torch-mode` オプション:

| フラグ | 説明 |
|--------|------|
| `auto` | NVIDIA ドライバを見て共有対応表から最も新しい互換 CUDA ビルドを自動選択し、使えない場合は CPU にフォールバック |
| `cpu` | CPU のみ |
| `cuda` | `--torch-build` で特定の CUDA ビルドを指定して導入（または `--torch-index` で任意 index を指定） |
| `skip` | PyTorch のインストールをスキップ |
| `--force-recreate` | 仮想環境を完全に作り直す |

`--torch-build` 対応表:

| Key | CUDA | Wheel index | Linux 最低 driver | Windows 最低 driver | 対応アーキテクチャ |
|-----|------|-------------|--------------------|----------------------|--------------------|
| `cu130` | 13.0 | `https://download.pytorch.org/whl/cu130` | `580.0+` | `580.0+` | Linux `x64`, `arm64`; Windows `x64` |
| `cu129` | 12.9 | `https://download.pytorch.org/whl/cu129` | `575.51.03+` | `576.02+` | Linux `x64`, `arm64`; Windows `x64` |
| `cu128` | 12.8 | `https://download.pytorch.org/whl/cu128` | `570.26+` | `570.65+` | Linux `x64`, `arm64`; Windows `x64` |
| `cu126` | 12.6 | `https://download.pytorch.org/whl/cu126` | `560.28.03+` | `560.76+` | Linux `x64`; Windows `x64` |
| `cu124` | 12.4 | `https://download.pytorch.org/whl/cu124` | `550.54.14+` | `551.61+` | Linux `x64`; Windows `x64` |
| `cu121` | 12.1 | `https://download.pytorch.org/whl/cu121` | `530.30.02+` | `531.14+` | Linux `x64`; Windows `x64` |
| `cu118` | 11.8 | `https://download.pytorch.org/whl/cu118` | `520.61.05+` | `520.06+` | Linux `x64`; Windows `x64` |

---

### コマンド一覧

| コマンド | 説明 |
|---------|------|
| `OwlSpotlight: Start Server` | バックグラウンドサーバーを起動 |
| `OwlSpotlight: Stop Server` | サーバーを安全に停止 |
| `OwlSpotlight: Setup Python Environment` | uv 管理の Python 仮想環境を作成・更新 |
| `OwlSpotlight: Code Search` | 検索パネルを開く |
| `OwlSpotlight: Find Similar to Selection` | エディタの選択範囲に似たコードを検索 |
| `OwlSpotlight: Clear Cache` | FAISS インデックスと埋め込みキャッシュをクリア |
| `OwlSpotlight: Remove Virtual Environment` | `.venv` を削除してゼロから再構築 |

---

### 検索スコープ

サイドバーの検索スコープは次から選べます。

| スコープ | 説明 |
|---------|------|
| `All` | 選択中の言語の全インデックス対象を検索 |
| `Source` | `src`、`app`、`lib`、`packages`、`client`、`server` などのソース系フォルダを自動検知して検索 |
| `Changed` | git の変更済み・未追跡ファイルだけを検索 |

エディタのコンテキストメニューから **OwlSpotlight: Find Similar to Selection** も実行できます。コードを選択してコマンドを実行し、検索スコープを選ぶと、類似した結果へジャンプできます。

---

### MCP Server Mode

AI coding agent から使える軽量な stdio MCP ブリッジを同梱しています。

```bash
python model_server/mcp_server.py
```

先に OwlSpotlight の VS Code サーバーを起動してください。MCP クライアント側では上記スクリプトを起動するように設定します。MCP tool `owlspotlight.search_code` は `directory`、`query`、`file_ext`、`top_k`、`scope`（`all`、`source`、`changed`）を受け取ります。HTTP サーバーが `http://127.0.0.1:8000` 以外の場合は `OWLSPOTLIGHT_SERVER_URL` を設定してください。

Claude Code / Cursor 向けの `.mcp.json` 例:

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

Cursor はプロジェクトの `.cursor/mcp.json` またはグローバルの `~/.cursor/mcp.json` に設定できます。Claude Code は `.mcp.json` または `claude mcp add-json` を使えます。Cline は MCP 設定に同じ `mcpServers.owlspotlight` を追加し、必要なら `"disabled": false` を含めてください。

---

### 設定項目

| 設定項目 | デフォルト | 説明 |
|---------|---------|------|
| `owlspotlight.modelName` | `Shuu12121/Owl-ph2-len2048` | Hugging Face の埋め込みモデル |
| `owlspotlight.batchSize` | `32` | 埋め込みのバッチサイズ |
| `owlspotlight.autoStartServer` | `false` | VS Code 起動時にサーバーを自動起動 |
| `owlspotlight.autoIndexOnFileChange` | `true` | 対応ファイル変更時に差分インデックスを自動更新 |
| `owlspotlight.enableJapaneseTranslation` | `false` | 日本語→英語自動翻訳を有効化 |
| `owlspotlight.geminiApiKey` | `""` | Google Gemini API キー |
| `owlspotlight.cacheSettings.autoClearCache` | `false` | サーバー起動時にキャッシュを自動クリア |
| `owlspotlight.environmentSettings.pythonVersion` | `3.11` | 仮想環境に使用する Python バージョン |

#### 日本語翻訳の設定

1. [Google AI Studio](https://aistudio.google.com/app/apikey) で無料 API キーを取得
2. VS Code の設定（`Cmd+,`）で以下を設定：
   - `owlspotlight.enableJapaneseTranslation` → `true`
   - `owlspotlight.geminiApiKey` → 取得したキー

使用例: 「メールアドレスを検証する関数」→ *"function that validates email address"*

![Settings](screenshot/Setting.png)

---

### OwlSpotlight を選ぶ理由

| 従来の検索 | OwlSpotlight |
|-----------|--------------|
| `def email_validation` | 「メールアドレスを検証する関数」で検索可能 |
| `class Database` | 「データベース接続を管理するクラス」で検索可能 |
| キーワード完全一致が必要 | 意図が伝われば検索可能 |
| 関数名・クラス名のみ | コメントや処理内容も検索対象 |

---

### トラブルシューティング

<details>
<summary><strong>サーバーが起動しない</strong></summary>

- `uv` がインストールされているか確認: `uv --version`
- 必要なら `uv python install 3.11` で Python を用意
- `model_server/.venv` が存在しない場合は `OwlSpotlight: Setup Python Environment` を実行
- ポート 8000 が使用中でも、拡張機能は次に空いているローカルポートへ自動で切り替えます
- 拡張機能が起動したサーバーは `OwlSpotlight: Stop Server` またはサイドバーの **Stop Server** ボタンで停止できます
- `表示 → 出力 → OwlSpotlight Server` でエラー詳細を確認
</details>

<details>
<summary><strong>検索結果が出ない</strong></summary>

- サイドバーのステータスが **Online** になっているか確認
- ワークスペースに `.py`、`.java`、`.ts`、`.tsx`、`.js`、`.jsx` ファイルがあるか確認
- `OwlSpotlight: Clear Cache` でキャッシュをクリア
</details>

<details>
<summary><strong>メモリエラー</strong></summary>

- `owlspotlight.batchSize` を `8` や `4` に減らす
- GPU メモリ不足時はサーバーが自動的に CPU にフォールバック
</details>

<details>
<summary><strong>日本語翻訳が動かない</strong></summary>

- `enableJapaneseTranslation` が `true` になっているか確認
- Gemini API キーが正しく設定されているか確認
- OUTPUT パネルの `OwlSpotlight Server` チャンネルでエラーを確認
</details>

<details>
<summary><strong>VS Code の Python 拡張機能と競合する（旧バージョンからの移行）</strong></summary>

v0.4.0 以降、サーバーはバックグラウンドプロセスとして動作するためターミナルは使用しません。旧バージョンからアップデートした場合は `OwlSpotlight: Remove Virtual Environment` を実行してから `OwlSpotlight: Setup Python Environment` でセットアップし直すことを推奨します。
</details>

---

### 開発ロードマップ

**実装済み**
- [x] Python・Java・TypeScript の自然言語検索
- [x] インクリメンタルインデックス更新
- [x] Apple Silicon および CUDA 最適化
- [x] クラス統計・構造可視化
- [x] 自動言語検出
- [x] 日本語自動翻訳（Gemini API）
- [x] サーバーステータス表示
- [x] 類似度スコア表示
- [x] バックグラウンドサーバー（OUTPUT パネル出力、ターミナル不使用）
- [x] サーバー自動起動オプション

**今後の予定**
- [ ] 多言語対応拡張（JavaScript, C++, Go）
- [ ] ファイル保存時の自動インデックス更新
- [ ] クラス継承図の表示
- [ ] 検索履歴・ブックマーク
- [ ] ホバー時のコードプレビュー

---

### CI/CD

- **CI** — `main` へのプッシュ・PR 時に `npm test` と `eslint` を実行
- **Release** — `v*.*.*` タグ作成で `.vsix` を自動ビルドし `vsce publish` で公開（`VSCE_TOKEN` シークレットが必要）

---

### コントリビューション

バグ報告・機能提案・プルリクエストは [GitHub Issues](https://github.com/shun0212/OwlSpotLight/issues) からどうぞ。

### ライセンス

MIT — 詳細は [LICENSE](LICENSE) をご覧ください。

---

<div align="center">

[Star this project](https://github.com/shun0212/OwlSpotLight) | [Report Issues](https://github.com/shun0212/OwlSpotLight/issues) | [Discussions](https://github.com/shun0212/OwlSpotLight/discussions)

</div>
