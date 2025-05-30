# 🦉 OwlSpotlight

**Instantly discover code with semantic search. A VS Code extension for searching Python functions and classes using natural language.**

![Demo](screenshot/result.png)

## ✨ Key Features

- 🔍 **Natural language code search** – Find functions and classes with intuitive queries
- ⚡ **Instant jump** – Jump directly to results in your editor
- 🎯 **Function & class support** – Search both functions and class methods
- 📊 **Class ranking view** – See class relevance based on function scores
- 🚀 **Fast incremental updates** – Only changed files are re-indexed
- 🎨 **Intuitive UI** – Simple sidebar interface

---

## 🚀 Quick Start

> **Note for Windows users:**
> Automatic setup (Quick Start) is not supported on Windows. Please follow the manual setup instructions below to create the Python environment and install dependencies yourself.

### Automatic Setup (macOS/Linux recommended)

1. Open this project in VS Code.
2. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run:
   ```
   OwlSpotlight: Setup Python Environment
   ```
3. Start the server:
   ```
   OwlSpotlight: Start Server
   ```
4. Start searching from the sidebar!

![Quick Setup](screenshot/startserver.png)

---

## 🎬 Usage Examples

### 1. Natural Language & Function/Class Search
Search functions and class methods across your project using natural language queries.

### 2. Class Ranking View
Classes are ranked by a score: (proportion of top-ranked functions in the class) × (inverse of the highest function rank). You can also choose to show only standalone functions (not belonging to any class).

![Class Statistics](screenshot/show_class_stats.png)

### 3. Function-Only Filtering
Display only functions that do not belong to any class.

![Function Only](screenshot/show_only_function.png)

### 4. Powerful Result Highlighting
OwlSpotlight instantly highlights all matching functions and classes in the editor:
- **Multi-location highlighting:** All relevant functions/classes are color-coded and emphasized.
- **Jump integration:** Click to jump directly to highlighted locations.
- **Dynamic updates:** Highlights update instantly as you change your search query.
- **Scales to large files:** Even files with thousands of lines are highlighted smoothly.

This makes it easy to find, refactor, and review code with confidence.

---

## 💡 Why Choose OwlSpotlight

### 🎯 Semantic Search Accuracy
- **Natural language queries** – Search for functions by intent
- **Code fragment search** – Find code by example
- **Function & class support** – Comprehensive search across your codebase

### ⚡ Performance
- **Fast incremental updates** – Only changed files are re-indexed
- **Clustered indexing** – Fast even for large projects
- **FAISS-powered** – Instant search for tens of thousands of functions

### 🛠 Developer Experience
- **Intuitive UI** – Simple sidebar interface
- **Instant highlighting** – See results in your editor immediately
- **.gitignore aware** – Unnecessary files are excluded
- **Apple Silicon optimized** – Fast on M1/M2/M3/M4 chips

### 🔄 Smart Updates
- **Automatic change detection** – Index updates on file add/change/delete
- **Function-level management** – Precise, up-to-date search
- **Real-time sync** – Always current with your codebase

---

## ⚠️ Important Notes

- **Initial indexing may take time** depending on the number of extracted functions, especially for large projects.
- **Only functions are searchable.** Class definitions, variables, and constants are not indexed. If important information is only in class definitions or outside functions, it may not be found.
- **Class ranking is based on function scores.** Class docstrings and attributes do not affect ranking.

---

## 🔧 Manual Setup

If automatic setup does not work (or on Windows):

1. Install required tools:
   ```zsh
   brew install npm
   brew install pyenv
   pyenv install 3.11
   ```
2. Set up the Python environment:
   ```zsh
   cd model_server
   pyenv local 3.11
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   cd ..
   ```
3. Launch the extension in VS Code (F5) and click "Start Server" in the OwlSpotlight sidebar.
4. Search for functions or keywords from the sidebar.

---

## ⚙️ System Requirements & Environment

- **Python**: 3.9+ (3.11 recommended)
- **Memory**: 4GB+ (8GB+ for large projects)
- **Storage**: Several GB for virtualenv and dependencies
- **Apple Silicon (M1/M2/M3/M4)**: Fully supported
- **Windows/Linux**: Manual setup required; not fully tested
- **CUDA/GPU**: Not tested (support planned)

### Performance Tips
- More memory = better performance (Transformer model)
- Fast CPU/GPU = faster indexing/search
- SSD recommended for best search speed
- Always use Python 3.11 for the virtual environment
- Exclude unnecessary files (e.g. `.venv/`) in `.gitignore`
- Install `flash-attn` for CUDA environments if needed

---

## 🚧 Development Status & Roadmap

### Current Status
- ✅ Python function & class search
- ✅ Natural language & code fragment search
- ✅ Apple Silicon optimization
- ✅ Incremental indexing updates
- ✅ Class ranking view
- ✅ Function-only filtering

### Upcoming Features
- 🔄 CUDA/flash-attention support (GPU acceleration)
- 🔄 Multi-language support (JavaScript, TypeScript, Java, etc.)
- 🔄 Class inheritance visualization
- 🔄 VS Code Marketplace release
- 🔄 Real-time code change detection (auto-update on save)

### Limitations
- Python only (multi-language support planned)
- Only functions & class methods are indexed (variables/constants are not)
- CUDA environments untested (support planned)

---

## 📄 License

MIT License – See the `LICENSE` file for details.

---

**Notice:**
*This extension is under active development. Features and behaviors may change without notice.*

**Contributing:**
Bug reports and feature requests are welcome in Issues.

---

# 🦉 OwlSpotlight（日本語版）

**意味的検索でコードを瞬時に発見。Pythonプロジェクトの関数・クラスを自然言語で検索できるVS Code拡張機能**

![Demo](screenshot/result.png)

## ✨ 主な機能

- 🔍 **自然言語でコード検索** - 「データを処理する関数」のような検索が可能
- ⚡ **瞬時のジャンプ** - 検索結果から該当コードに即座に移動
- 🎯 **関数・クラス両対応** - 関数とクラスメソッドの両方を検索対象
- 📊 **クラス統計表示** - プロジェクト内のクラス構造を一覧表示
- 🚀 **高速インクリメンタル更新** - ファイル変更時も差分のみ更新
- 🎨 **直感的なUI** - サイドバーから簡単操作

---

## 🚀 クイックスタート

> **Windowsユーザーへの注意：**
> クイックスタート（自動セットアップ）はWindowsでは利用できません。下記の手動セットアップ手順に従ってPython環境の作成と依存パッケージのインストールを行ってください。

### 自動セットアップ（macOS/Linux推奨）

1. VS Codeで本プロジェクトを開く
2. コマンドパレット（`Cmd+Shift+P` / `Ctrl+Shift+P`）で以下を実行：
   ```
   OwlSpotlight: Setup Python Environment
   ```
3. サーバー起動：
   ```
   OwlSpotlight: Start Server
   ```
4. サイドバーから検索開始！

![Quick Setup](screenshot/startserver.png)

---

## 🎬 使用例

### 1. 自然言語・関数/クラス検索
自然言語で関数やクラスメソッドを横断的に検索できます。

### 2. クラスランキング表示
関連度の高いクラスは「上位に含まれる関数の割合 × 最上位関数の順位の逆数」でスコア化され、ランキング表示されます。
また、オプションで「関数のみ（クラスに属さないもの）」の表示も可能です。

![Class Statistics](screenshot/show_class_stats.png)

### 3. 関数のみの絞り込み
クラスに属さない関数のみを表示することもできます。

![Function Only](screenshot/show_only_function.png)

### 4. 検索結果のハイライト
OwlSpotlightは、検索結果の関数やクラスをエディタ上で即座にハイライト表示します。
- **複数箇所同時ハイライト**：関連する関数・クラスがすべて色分けされて強調表示されます。
- **ジャンプ機能と連動**：ハイライトされた箇所へワンクリックでジャンプ可能。
- **動的なハイライト更新**：検索ワードを変更するたびに、ハイライトも即座に切り替わります。
- **大規模ファイルでも快適**：数千行規模のファイルでもストレスなくハイライト。

これにより、目的のコードがどこにあるかを瞬時に把握でき、リファクタリングやレビューも圧倒的に効率化されます。

---

## 💡 OwlSpotlightの特長

### 🎯 高精度な意味的検索
- **自然言語クエリ対応** - 「データを処理する関数」のような検索が可能
- **コード断片検索** - 実際のコード片でも検索できる
- **関数・クラス両対応** - 関数とクラスメソッドを包括的に検索

### ⚡ パフォーマンス
- **高速インクリメンタル更新** - 変更部分のみを効率的に更新
- **クラスタ分割インデックス** - 大規模プロジェクトでも高速検索
- **FAISS最適化** - 数万関数規模でも瞬時に検索

### 🛠 開発体験
- **直感的UI** - サイドバーから簡単操作
- **即座のハイライト** - 検索結果をエディタで即座に表示
- **.gitignore準拠** - 不要ファイルを自動除外
- **Apple Silicon最適化** - M1/M2/M3/M4チップで高速動作

### 🔄 スマートな更新
- **差分検出** - ファイルの追加・変更・削除を自動検知
- **関数レベル管理** - 関数単位での精密なインデックス管理
- **リアルタイム同期** - コード変更に即座に対応

---

## ⚠️ 注意事項

- **初回インデックス作成には時間がかかる場合があります。**
  - 関数の抽出数が多い大規模プロジェクトほど、初回セットアップやインデックス作成に時間を要します。
- **検索対象は「関数」のみです。**
  - クラス定義自体やクラス外の変数・定数は検索対象外です。
  - クラス内の関数（メソッド）以外に重要な情報が含まれている場合、意図した検索結果が得られないことがあります。
- **クラスランキングは関数のスコアに基づきます。**
  - クラス自体の説明や属性はランキングに直接影響しません。

---

## 🔧 手動セットアップ

自動セットアップがうまくいかない場合（またはWindowsの場合）は、以下の手順でセットアップしてください：

1. 必要なツールをインストール：
   ```zsh
   brew install npm
   brew install pyenv
   pyenv install 3.11
   ```
2. Python環境をセットアップ：
   ```zsh
   cd model_server
   pyenv local 3.11
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   cd ..
   ```
3. VS Codeで拡張機能を起動（F5）し、サイドバーの「Start Server」ボタンを押してください。
4. サイドバーから関数名やキーワードで検索できます。

---

## ⚙️ システム要件・環境

- **Python**: 3.9以上（推奨: 3.11）
- **メモリ**: 4GB以上（大規模プロジェクトでは8GB以上推奨）
- **ストレージ**: 仮想環境・依存パッケージ用に数GB
- **Apple Silicon (M1/M2/M3/M4)**: 完全対応
- **Windows/Linux**: 手動セットアップ必須・動作未検証
- **CUDA/GPU**: 未検証（今後対応予定）

### パフォーマンスのヒント
- メモリが多いほど快適（Transformerモデル）
- 高速CPU/GPUほどインデックス作成・検索が高速
- SSD推奨
- 仮想環境は必ずPython 3.11で作成
- `.gitignore`で不要ファイル（例：`.venv/`）を除外
- CUDA環境では`flash-attn`の追加インストールも可能

---

## 🚧 開発状況・今後の予定

### 現在の状況
- ✅ Python関数・クラス検索
- ✅ 自然言語・コード断片検索
- ✅ Apple Silicon最適化
- ✅ インクリメンタル更新
- ✅ クラス統計表示
- ✅ 関数のみ絞り込み

### 今後の予定
- 🔄 CUDA/flash-attention対応（GPU高速化）
- 🔄 多言語対応（JavaScript, TypeScript, Java等）
- 🔄 クラス継承関係の可視化
- 🔄 VS Code Marketplace公開
- 🔄 コード変更のリアルタイム検知（自動更新）

### 制限事項
- Python専用（多言語対応予定）
- 関数・クラスメソッドのみインデックス対象（変数・定数は対象外）
- CUDA環境未検証（今後対応予定）

---

## 📄 ライセンス

MIT License – 詳細は`LICENSE`ファイルを参照してください。

---

**注意：**
*この拡張機能は現在開発中です。仕様や挙動は今後予告なく変更される可能性があります。*

**貢献：**
バグ報告や機能要望はIssuesでお知らせください。