# OwlSpotlight

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.4.0-blue.svg)](https://github.com/shun0212/OwlSpotLight)
[![Python](https://img.shields.io/badge/python-3.11+-green.svg)](https://www.python.org/)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.100+-blue.svg)](https://code.visualstudio.com/)
[![Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-brightgreen.svg)](https://marketplace.visualstudio.com/items?itemName=Shun0212.owlspotlight)

**AI-powered semantic code search for VS Code**

*Find Python, Java, and TypeScript code using natural language — describe what the code does, not what it's called.*

[English](#english) | [日本語](#japanese)

</div>

---

## English

### What is OwlSpotlight?

OwlSpotlight transforms code navigation by bringing **semantic understanding** to your VS Code workspace. Instead of searching for exact text matches, describe what the code does in plain language — like *"function that validates email"* or *"class for database connections"* — and instantly find relevant code.

![Demo Preview](screenshot/detect_method_in_class.png)

---

### What's New in v0.4.0

**New default model: `Shuu12121/Owl-ph2-len2048`**

This version introduces a new embedding model based on **ModernBERT** with a 2048-token context window, fine-tuned specifically for code search tasks. Compared to earlier models:

- Better semantic understanding of code structure and intent
- 2048-token context window for capturing longer function bodies
- Improved ranking accuracy for multi-language codebases (Python, Java, TypeScript)
- Trained on curated code-query pairs for higher precision

> You can switch models at any time via `owlspotlight.modelName` in settings. Compatible with any Sentence Transformers model on Hugging Face.

**Server startup improvements**

The server now starts as a background process instead of opening a terminal. This eliminates the issue where VS Code's Python extension would interfere with the venv activation in the terminal.

- Server output is shown in the "OwlSpotlight Server" Output panel
- New command: `OwlSpotlight: Stop Server` to cleanly shut down
- Auto-start option available (`owlspotlight.autoStartServer`)
- No more terminal conflicts with other Python environments

| Feature | Screenshot |
|---------|-----------|
| Server output in Output panel | ![Server Init](screenshot/init_server.png) |
| Settings panel | ![Settings](screenshot/Setting.png) |

**UI improvements**

- Server status indicator (online/offline dot) in the sidebar header
- Similarity score badges and bars on search results
- Loading spinner during search
- Cleaner tab and button styling
- Empty state messages when no results are shown

---

### Key Features

| Feature | Description |
|---------|-------------|
| **Semantic Search** | Find code by intent, not just keywords — powered by `Owl-ph2-len2048` (ModernBERT) |
| **Incremental Indexing** | Only changed files are re-indexed for fast subsequent searches |
| **Multi-symbol Support** | Search functions, classes, methods, and their relationships |
| **Class Statistics** | View class hierarchies ranked by relevance with method-level scoring |
| **Japanese Translation** | Auto-translate Japanese queries to English via Gemini API |
| **Smart Highlighting** | Jump to results with color-coded highlighting for classes and functions |
| **Apple Silicon** | Optimized for MPS acceleration on M-series chips |
| **CUDA/GPU** | Full GPU acceleration support for NVIDIA GPUs |
| **Background Server** | Server runs as a background process — no terminal conflicts |
| **Similarity Scores** | Visual score badges and bars showing result relevance |

### See It In Action

| Feature | Description | Preview |
|---------|-------------|---------|
| **Semantic Function Search** | Find functions by describing what they do | ![Function Search](screenshot/detect_function.png) |
| **Class & Method Discovery** | Explore class hierarchies with context-aware search | ![Class Methods](screenshot/detect_method_in_class.png) |
| **Intelligent Ranking** | Classes ranked by relevance with method-level statistics | ![Class Rankings](screenshot/class_stats_mode.png) |
| **Environment Management** | Built-in alerts for Python environment setup | ![Environment Alert](screenshot/alart_No_venv.png) |

---

### Quick Start

**Prerequisites**: Python 3.11+ installed on your system

> **Note:** Queries can be entered in English or Japanese. Japanese text is automatically translated to English when the translation feature is enabled.

#### Option 1: Automatic Setup (Recommended)

```bash
# 1. Install the extension from VS Code Marketplace
#    Or build locally:
npm install && npm run compile && npx vsce package

# 2. Open Command Palette (Cmd+Shift+P / Ctrl+Shift+P) and run:
OwlSpotlight: Setup Python Environment

# 3. Start the server:
OwlSpotlight: Start Server

# 4. Open the OwlSpotlight sidebar and start searching!
```

![Server Initialization](screenshot/init_server.png)

#### Option 2: Manual Installation

1. **Build the extension**:
   ```bash
   npm install
   npm run compile
   npx vsce package
   ```

2. **Install in VS Code**:
   - Open Command Palette (`Cmd+Shift+P`)
   - Select `Extensions: Install from VSIX...`
   - Choose the generated `.vsix` file

3. **Setup Python environment**:
   ```bash
   cd model_server

   # macOS/Linux
   python3.11 bootstrap_env.py --torch-mode cpu
   source .venv/bin/activate

   # Windows PowerShell
   py -3.11 bootstrap_env.py --torch-mode cpu
   .\.venv\Scripts\Activate.ps1
   ```

   **Options:**
   - `--torch-mode cuda` — Install CUDA 12.8 build for NVIDIA GPUs
   - `--torch-mode skip` — Skip PyTorch installation (manual setup)
   - `--force-recreate` — Rebuild virtual environment from scratch

4. **Start searching**: Run `OwlSpotlight: Start Server` from the Command Palette

---

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   VS Code Extension                     │
│  Sidebar UI (Webview) ←→ Extension Host (TypeScript)    │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTP (localhost:8000)
┌───────────────────────────▼─────────────────────────────┐
│               FastAPI Server (Background Process)        │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Extractors  │  │  Embedding   │  │  FAISS Index  │  │
│  │  (Tree-sitter│  │  Model       │  │  (Similarity  │  │
│  │   parsing)   │  │(Owl-ph2-2048)│  │   Search)     │  │
│  └──────┬───┬──┘  └──────┬───────┘  └───────┬───────┘  │
│    .py  .java .ts     MPS/CUDA/CPU      Incremental     │
└─────────────────────────────────────────────────────────┘
```

**Components:**
- **Extractors** — Tree-sitter based parsers for Python, Java, and TypeScript
- **Embedding Model** — `Shuu12121/Owl-ph2-len2048` (ModernBERT, 2048 tokens) for code-to-vector encoding
- **FAISS Index** — Facebook AI Similarity Search for fast nearest-neighbor lookup
- **Caching** — 3-tier cache (memory, disk, code-to-embedding) with incremental updates

---

### Why OwlSpotlight?

| Traditional Search | OwlSpotlight |
|-------------------|--------------|
| `def email_validation` | *"function that validates email addresses"* |
| `class Database` | *"class for database connections"* |
| Exact keyword matching | Semantic understanding of code purpose |
| Limited to function names | Searches documentation, comments, and logic |

---

### Configuration

#### Available Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `owlspotlight.modelName` | `Shuu12121/Owl-ph2-len2048` | Hugging Face embedding model |
| `owlspotlight.batchSize` | `32` | Batch size for embedding (higher = faster but more memory) |
| `owlspotlight.autoStartServer` | `false` | Auto-start the server when VS Code opens |
| `owlspotlight.enableJapaneseTranslation` | `false` | Enable JP to EN auto-translation |
| `owlspotlight.geminiApiKey` | `""` | Google Gemini API key for translation |
| `owlspotlight.cacheSettings.autoClearCache` | `false` | Auto-clear cache on server start |
| `owlspotlight.environmentSettings.pythonVersion` | `3.11` | Python version for virtual environment |

#### Japanese Translation Setup

1. Get a free API key at [Google AI Studio](https://aistudio.google.com/app/apikey)
2. In VS Code Settings, set:
   - `owlspotlight.enableJapaneseTranslation`: `true`
   - `owlspotlight.geminiApiKey`: *your key*

![Settings Example](screenshot/Setting.png)

#### Advanced Setup (macOS/Linux)

```bash
brew install npm pyenv
pyenv install 3.11
cd model_server
pyenv local 3.11
python3.11 bootstrap_env.py --torch-mode cpu
source .venv/bin/activate
```

#### Advanced Setup (Windows)

```powershell
cd model_server
py -3.11 bootstrap_env.py --torch-mode cpu
.\.venv\Scripts\Activate.ps1
```

**Performance Tips:**
- Use SSD storage for faster indexing
- Allocate 8GB+ RAM for large projects
- Exclude unnecessary files via `.gitignore`
- Consider `flash-attn` for CUDA environments
- Set `OWL_PROGRESS=0` to disable progress bars

---

### System Requirements

| Component | Requirement | Notes |
|-----------|-------------|-------|
| **Python** | 3.11+ | Virtual environment recommended |
| **Memory** | 4GB+ (8GB+ for large projects) | More RAM = better performance |
| **Storage** | 2-3GB | For dependencies and models |
| **Platform** | macOS, Linux, Windows | Apple Silicon fully supported |

---

### API Endpoints (Server)

The Python backend exposes these REST endpoints on `localhost:8000`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/search_functions_simple` | POST | Main search — find functions by query |
| `/get_class_stats` | POST | Get class/method statistics with scoring |
| `/build_index` | POST | Build FAISS index for a directory |
| `/force_rebuild_index` | POST | Clear cache and rebuild index |
| `/index_status` | GET | Check if index is up-to-date |
| `/embed` | POST | Encode text snippets to embeddings |
| `/settings` | GET | View current server settings |
| `/update_settings` | POST | Update batch size and settings |

---

### Troubleshooting

<details>
<summary><strong>Server won't start</strong></summary>

- Ensure Python 3.11+ is installed: `python3.11 --version`
- Check if `.venv` exists in `model_server/`; if not, run `Setup Python Environment`
- Make sure port 8000 is not in use: `lsof -i :8000`
- Check the "OwlSpotlight Server" Output panel for error details
</details>

<details>
<summary><strong>No search results</strong></summary>

- Verify the server status indicator shows "Online" in the sidebar
- Check that your workspace contains `.py`, `.java`, or `.ts` files
- Try clearing the cache with `OwlSpotlight: Clear Cache`
</details>

<details>
<summary><strong>Memory errors / Out of memory</strong></summary>

- Reduce `owlspotlight.batchSize` to `8` or `4`
- The server auto-falls back to CPU if GPU memory is insufficient
- Close other memory-intensive applications
</details>

<details>
<summary><strong>Japanese translation not working</strong></summary>

- Ensure `enableJapaneseTranslation` is `true` in settings
- Verify your Gemini API key is set correctly
- Check VS Code Output panel for error messages
</details>

---

### Development Roadmap

#### Current Features
- [x] Natural language search for Python/Java/TypeScript
- [x] Real-time incremental indexing
- [x] Apple Silicon and CUDA optimization
- [x] Class relationship visualization and statistics
- [x] Advanced filtering with score display
- [x] Automatic language detection
- [x] Japanese to English translation (Gemini API)
- [x] Server status indicator
- [x] Similarity score visualization
- [x] Background server process (no terminal conflicts)
- [x] Auto-start server option

#### Coming Soon
- [ ] **Multi-language expansion** (JavaScript, C++, Go)
- [ ] **Real-time file watching** (auto-update on save)
- [ ] **Class inheritance diagrams**
- [ ] **Search history** with bookmarks
- [ ] **Code preview on hover**

---

### CI/CD

GitHub Actions workflows handle:
- **CI**: `npm test` + `eslint` on push/PR to `main`
- **Release**: Tag `v*.*.*` to auto-build `.vsix` and publish via `vsce publish` (requires `VSCE_TOKEN` secret)

---

### Contributing

Contributions are welcome.

- **Report bugs** in [Issues](https://github.com/shun0212/OwlSpotLight/issues)
- **Suggest features** via GitHub Issues
- **Submit pull requests** for improvements

### License

MIT License — see [LICENSE](LICENSE) file for details.

---

## Japanese

### OwlSpotlightとは？

OwlSpotlightは、VS CodeでPython・Java・TypeScriptコードを**自然言語で検索**できる拡張機能です。
[Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Shun0212.owlspotlight)で公開・配布しています。

従来のキーワード検索とは異なり、「メールを検証する関数」や「データベース接続を処理するクラス」など、**コードの意図を表現したクエリ**で関連するコードを素早く見つけることができます。

---

### v0.4.0の更新内容

**新デフォルトモデル: `Shuu12121/Owl-ph2-len2048`**

**ModernBERT**ベースの埋め込みモデルで、2048トークンのコンテキストウィンドウを持ち、コード検索タスクに特化してファインチューニングされています。

- コード構造と意図のより深い意味理解
- 2048トークンの長いコンテキストウィンドウにより、長い関数本体も捕捉可能
- Python/Java/TypeScriptの多言語コードベースでのランキング精度向上
- 厳選されたコード-クエリペアで学習し、高い検索精度を実現

> `owlspotlight.modelName` 設定でいつでもモデルを切り替え可能です。Hugging Face上のSentence Transformersモデルに対応しています。

**サーバー起動方式の改善**

ターミナルを開く方式からバックグラウンドプロセス方式に変更しました。VS CodeのPython拡張機能がターミナル内のvenv有効化と干渉する問題を解消しています。

- サーバーログは「出力」パネルの「OwlSpotlight Server」チャンネルに表示
- 新コマンド: `OwlSpotlight: Stop Server` でサーバーを安全に停止
- 自動起動オプション（`owlspotlight.autoStartServer`）を追加
- 他のPython環境とのターミナル競合が発生しません

| 機能 | スクリーンショット |
|------|-------------------|
| サーバー初期化 | ![Server Init](screenshot/init_server.png) |
| 設定画面 | ![Settings](screenshot/Setting.png) |

**UI改善**

- サイドバーヘッダーにサーバーステータスインジケーター（オンライン/オフラインのドット表示）
- 検索結果に類似度スコアのバッジとバーを表示
- 検索中のローディングスピナー
- タブとボタンのスタイリングをクリーンに
- 結果がないときの空状態メッセージ

---

### 主な特長

| 機能 | 説明 |
|------|------|
| **意味的検索** | キーワード一致ではなく、コードの意味を理解して検索（`Owl-ph2-len2048`モデル使用） |
| **高速インデックス** | 変更されたファイルのみ再インデックス |
| **マルチシンボル対応** | 関数・クラス・メソッドとその関係を検索 |
| **クラス統計** | 関連度ランキング付きのクラス階層表示 |
| **日本語対応** | Gemini APIによる日本語→英語自動翻訳 |
| **スマートハイライト** | 色分けされたハイライトでジャンプ |
| **Apple Silicon** | M系チップのMPSアクセラレーション最適化 |
| **CUDA/GPU** | NVIDIA GPU完全対応 |
| **バックグラウンドサーバー** | ターミナル不使用 — 他のPython環境と競合しません |
| **類似度スコア** | 結果の関連度をバッジとバーで視覚的に表示 |

---

### クイックスタート

**前提条件**: Python 3.11+がインストールされていること

> **注意:** クエリは英語・日本語どちらでも入力可能。設定で自動翻訳を有効にすると、日本語クエリは英語に変換されて検索されます。

#### 方法1: 自動セットアップ（推奨）

1. VS Codeでプロジェクトを開く
2. コマンドパレット（`Cmd+Shift+P`）で実行：
   ```
   OwlSpotlight: Setup Python Environment
   ```
3. サーバー開始：
   ```
   OwlSpotlight: Start Server
   ```
4. サイドバーから検索を開始

#### 方法2: 手動インストール

1. 拡張機能をビルド：
   ```bash
   npm install && npm run compile && npx vsce package
   ```
2. VS Codeで「Extensions: Install from VSIX...」から`.vsix`ファイルをインストール
3. Python環境をセットアップ：
   ```bash
   cd model_server
   # macOS/Linux
   python3.11 bootstrap_env.py --torch-mode cpu
   source .venv/bin/activate

   # Windows PowerShell
   py -3.11 bootstrap_env.py --torch-mode cpu
   .\.venv\Scripts\Activate.ps1
   ```

---

### 設定

| 設定項目 | デフォルト | 説明 |
|---------|---------|-------------|
| `owlspotlight.modelName` | `Shuu12121/Owl-ph2-len2048` | Hugging Faceの埋め込みモデル |
| `owlspotlight.batchSize` | `32` | 埋め込みのバッチサイズ |
| `owlspotlight.autoStartServer` | `false` | VS Code起動時にサーバーを自動起動 |
| `owlspotlight.enableJapaneseTranslation` | `false` | 日本語→英語自動翻訳を有効化 |
| `owlspotlight.geminiApiKey` | `""` | Google Gemini APIキー |
| `owlspotlight.cacheSettings.autoClearCache` | `false` | サーバー起動時にキャッシュを自動クリア |

---

### OwlSpotlightを選ぶ理由

| 従来の検索 | OwlSpotlight |
|-----------|--------------|
| `def email_validation` | 「メールアドレスを検証する関数」で検索可能 |
| `class Database` | 「データベース接続を管理するクラス」で検索可能 |
| キーワード完全一致 | 意図が伝われば一致しなくても検索可能 |
| 関数名のみ | コメントや処理内容も検索対象 |

---

### 翻訳設定（日本語検索）

1. [Google AI Studio](https://aistudio.google.com/app/apikey)で無料APIキーを取得
2. VS Codeの設定で以下を設定：
   - `owlspotlight.enableJapaneseTranslation`: `true`
   - `owlspotlight.geminiApiKey`: あなたのAPIキー

**使用例：**
- 「メールアドレスを検証する関数」→ "function that validates email address"
- 「データベース接続を管理するクラス」→ "class that manages database connection"

---

### トラブルシューティング

<details>
<summary><strong>サーバーが起動しない</strong></summary>

- Python 3.11+がインストールされているか確認: `python3.11 --version`
- `model_server/.venv` が存在するか確認。なければ `Setup Python Environment` を実行
- ポート8000が使用中でないか確認: `lsof -i :8000`
- 「出力」パネルの「OwlSpotlight Server」チャンネルでエラー詳細を確認
</details>

<details>
<summary><strong>検索結果が出ない</strong></summary>

- サイドバーのステータスが「Online」になっているか確認
- ワークスペースに `.py`、`.java`、`.ts` ファイルがあるか確認
- `OwlSpotlight: Clear Cache` でキャッシュをクリア
</details>

<details>
<summary><strong>メモリエラー</strong></summary>

- `owlspotlight.batchSize` を `8` や `4` に減少
- サーバーはGPUメモリ不足時に自動的にCPUにフォールバック
</details>

---

### 開発ロードマップ

#### 現在の機能
- Python・Java・TypeScriptの自然言語検索
- インクリメンタルインデックス更新
- Apple Silicon and CUDA最適化
- クラス統計・構造可視化
- 自動言語検出
- 日本語自動翻訳（Gemini API）
- サーバーステータス表示
- 類似度スコア表示
- バックグラウンドサーバープロセス
- サーバー自動起動オプション

#### 今後の予定
- 多言語対応拡張（JavaScript, C++, Go）
- ファイル保存時の自動更新
- クラス継承図の表示
- 検索履歴・ブックマーク
- ホバー時のコードプレビュー

---

### 自動テストとデプロイ

GitHub Actionsを利用したCIワークフロー:
- `main` ブランチへのプッシュ・PR時に `npm test` と `eslint` を実行
- タグ `v*.*.*` 作成で自動的に `.vsix` を生成し、`vsce publish` でマーケットプレースへ公開（`VSCE_TOKEN` シークレットが必要）

### ライセンス

MIT License — 詳細は[LICENSE](LICENSE)をご覧ください。

---

<div align="center">

[Star this project](https://github.com/shun0212/OwlSpotLight) | [Report Issues](https://github.com/shun0212/OwlSpotLight/issues) | [Discussions](https://github.com/shun0212/OwlSpotLight/discussions)

</div>
