# OwlSpotlight

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.4.1-blue.svg)](https://github.com/shun0212/OwlSpotLight)
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
| **Class Statistics** | View class hierarchies ranked by relevance with method-level scoring |
| **Japanese Translation** | Auto-translate Japanese queries to English via Gemini API |
| **Smart Highlighting** | Jump to results with color-coded highlighting |
| **Background Server** | Server runs silently in the background — logs appear in the VS Code OUTPUT panel, no terminal conflicts |
| **Apple Silicon** | MPS acceleration on M-series chips |
| **CUDA / GPU** | Full NVIDIA GPU acceleration |
| **Similarity Scores** | Score badges and bars showing result relevance |

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

**Prerequisites**: Python 3.11+ installed on your system

> Queries can be entered in English or Japanese. Japanese text is automatically translated to English when the translation feature is enabled.

#### Option 1: Automatic Setup (Recommended)

1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Shun0212.owlspotlight)
2. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run:
   ```
   OwlSpotlight: Setup Python Environment
   ```
3. Start the server:
   ```
   OwlSpotlight: Start Server
   ```
4. Open the OwlSpotlight sidebar and start searching.

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

The `Setup Python Environment` command handles everything automatically — it creates a `.venv` inside `model_server/` and installs all required packages.

**What changed:** Previously, the server was launched directly inside a VS Code integrated terminal. This caused conflicts with the VS Code Python extension's own venv activation. The server now runs as a **background process**, and all output is routed to the VS Code **OUTPUT panel** (`OwlSpotlight Server` channel). Your terminal stays clean and there are no environment conflicts.

#### Manual Setup (Advanced)

```bash
cd model_server

# macOS / Linux
python3.11 bootstrap_env.py --torch-mode cpu
source .venv/bin/activate

# Windows PowerShell
py -3.11 bootstrap_env.py --torch-mode cpu
.\.venv\Scripts\Activate.ps1
```

`--torch-mode` options:

| Flag | Description |
|------|-------------|
| `cpu` | CPU only (default) |
| `cuda` | CUDA 12.8 for NVIDIA GPUs |
| `skip` | Skip PyTorch installation |
| `--force-recreate` | Rebuild the virtual environment from scratch |

#### macOS / Linux with pyenv

```bash
brew install npm pyenv
pyenv install 3.11
cd model_server
pyenv local 3.11
python3.11 bootstrap_env.py --torch-mode cpu
source .venv/bin/activate
```

#### Windows

```powershell
cd model_server
py -3.11 bootstrap_env.py --torch-mode cpu
.\.venv\Scripts\Activate.ps1
```

---

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   VS Code Extension                     │
│  Sidebar UI (Webview) <-> Extension Host (TypeScript)   │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTP (localhost:8000)
┌───────────────────────────▼─────────────────────────────┐
│         FastAPI Server (Background Process)              │
│         Logs -> VS Code OUTPUT panel                     │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Extractors  │  │  Embedding   │  │  FAISS Index  │  │
│  │ (Tree-sitter)│  │  Model       │  │  (Similarity  │  │
│  │  .py .java   │  │(Owl-ph2-2048)│  │   Search)     │  │
│  │  .ts         │  │ MPS/CUDA/CPU │  │  Incremental  │  │
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
| `OwlSpotlight: Setup Python Environment` | Create or update the Python venv |
| `OwlSpotlight: Code Search` | Open the search panel |
| `OwlSpotlight: Clear Cache` | Clear FAISS index and embedding cache |
| `OwlSpotlight: Remove Virtual Environment` | Delete the `.venv` and start fresh |

---

### System Requirements

| Component | Requirement |
|-----------|-------------|
| Python | 3.11+ |
| Memory | 4 GB+ (8 GB+ for large projects) |
| Storage | 2–3 GB (dependencies + model weights) |
| Platform | macOS, Linux, Windows |

---

### API Endpoints

The Python backend exposes these REST endpoints on `localhost:8000`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/search_functions_simple` | POST | Find functions by query |
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

- Verify Python 3.11+ is installed: `python3.11 --version`
- Check if `.venv` exists in `model_server/`. If not, run `OwlSpotlight: Setup Python Environment`.
- Make sure port 8000 is not in use: `lsof -i :8000`
- Check **View → Output → OwlSpotlight Server** for detailed error logs.
</details>

<details>
<summary><strong>No search results</strong></summary>

- Confirm the sidebar status indicator shows **Online**.
- Verify your workspace contains `.py`, `.java`, or `.ts` files.
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
- [x] Incremental indexing
- [x] Apple Silicon and CUDA optimization
- [x] Class statistics and hierarchy visualization
- [x] Japanese to English translation (Gemini API)
- [x] Server status indicator
- [x] Similarity score visualization
- [x] Background server with OUTPUT panel logging
- [x] Auto-start server option

**Upcoming**
- [ ] Multi-language support (JavaScript, C++, Go)
- [ ] Real-time file watching
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
| **クラス統計** | 関連度ランキング付きのクラス階層表示 |
| **日本語対応** | Gemini API による日本語→英語自動翻訳 |
| **スマートハイライト** | 色分けハイライトで結果箇所へジャンプ |
| **バックグラウンドサーバー** | ターミナル不使用 — ログは VS Code の OUTPUT パネルに表示 |
| **Apple Silicon** | M 系チップの MPS アクセラレーション最適化 |
| **CUDA / GPU** | NVIDIA GPU 完全対応 |
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

**前提条件**: Python 3.11+ がインストールされていること

> クエリは英語・日本語どちらでも入力可能。自動翻訳を有効にすると、日本語クエリは英語に変換されて検索されます。

#### 方法1: 自動セットアップ（推奨）

1. [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Shun0212.owlspotlight) から拡張機能をインストール
2. コマンドパレット（`Cmd+Shift+P`）で実行：
   ```
   OwlSpotlight: Setup Python Environment
   ```
3. サーバーを起動：
   ```
   OwlSpotlight: Start Server
   ```
4. OwlSpotlight サイドバーから検索を開始。

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

`Setup Python Environment` コマンドにより、仮想環境の作成から依存パッケージのインストールまで**すべて自動**で行われます。

**以前のバージョンからの変更点:** 旧バージョンではサーバーを VS Code の統合ターミナルで直接起動していたため、VS Code の Python 拡張機能が持つ venv 設定と競合することがありました。現在はサーバーを**バックグラウンドプロセス**として起動し、出力はすべて VS Code の **OUTPUT パネル**（`OwlSpotlight Server` チャンネル）に表示されます。ターミナルは一切使用しないため、他の Python 環境との競合が発生しません。

#### 手動セットアップ（上級者向け）

```bash
cd model_server

# macOS / Linux
python3.11 bootstrap_env.py --torch-mode cpu
source .venv/bin/activate

# Windows PowerShell
py -3.11 bootstrap_env.py --torch-mode cpu
.\.venv\Scripts\Activate.ps1
```

`--torch-mode` オプション:

| フラグ | 説明 |
|--------|------|
| `cpu` | CPU のみ（デフォルト） |
| `cuda` | NVIDIA GPU 向け CUDA 12.8 ビルド |
| `skip` | PyTorch のインストールをスキップ |
| `--force-recreate` | 仮想環境を完全に作り直す |

---

### コマンド一覧

| コマンド | 説明 |
|---------|------|
| `OwlSpotlight: Start Server` | バックグラウンドサーバーを起動 |
| `OwlSpotlight: Stop Server` | サーバーを安全に停止 |
| `OwlSpotlight: Setup Python Environment` | Python 仮想環境を作成・更新 |
| `OwlSpotlight: Code Search` | 検索パネルを開く |
| `OwlSpotlight: Clear Cache` | FAISS インデックスと埋め込みキャッシュをクリア |
| `OwlSpotlight: Remove Virtual Environment` | `.venv` を削除してゼロから再構築 |

---

### 設定項目

| 設定項目 | デフォルト | 説明 |
|---------|---------|------|
| `owlspotlight.modelName` | `Shuu12121/Owl-ph2-len2048` | Hugging Face の埋め込みモデル |
| `owlspotlight.batchSize` | `32` | 埋め込みのバッチサイズ |
| `owlspotlight.autoStartServer` | `false` | VS Code 起動時にサーバーを自動起動 |
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

- Python 3.11+ がインストールされているか確認: `python3.11 --version`
- `model_server/.venv` が存在しない場合は `OwlSpotlight: Setup Python Environment` を実行
- ポート 8000 が使用中でないか確認: `lsof -i :8000`
- `表示 → 出力 → OwlSpotlight Server` でエラー詳細を確認
</details>

<details>
<summary><strong>検索結果が出ない</strong></summary>

- サイドバーのステータスが **Online** になっているか確認
- ワークスペースに `.py`、`.java`、`.ts` ファイルがあるか確認
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
