# 🦉 OwlSpotlight

**Instantly discover code with semantic search. A VS Code extension for searching Python functions, classes, and methods using natural language.**

---

## 📝 Prerequisites

- **You must clone this repository locally** to use OwlSpotlight. The extension works on your local codebase and does not support remote repositories or online browsing.

---

![Demo](screenshot/result.png)

## ✨ Key Features

- 🔍 **Natural language code search** – Find Python functions, classes, and methods with intuitive queries
- ⚡ **Instant jump** – Jump directly to results in your editor
- 🎯 **Function, class & method support** – Search both standalone functions and class methods, as well as class definitions
- 📊 **Class ranking view** – See class relevance based on function/method scores
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
Search Python functions, class methods, and class definitions across your project using natural language queries and semantic (contextual) search. **Note:** The search engine works by extracting and indexing Python functions (including class methods). Class definitions are included for navigation and ranking, but the search itself is function-based.

### 2. Class Ranking View
Classes are ranked by a score: (proportion of top-ranked functions/methods in the class) × (inverse of the highest function/method rank). You can also choose to show only standalone functions (not belonging to any class).

![Class Statistics](screenshot/show_class_stats.png)

### 3. Function-Only Filtering
Display only functions that do not belong to any class.

![Function Only](screenshot/show_only_function.png)

### 4. Powerful Result Highlighting
OwlSpotlight instantly highlights all matching functions, classes, and methods in the editor:
- **Multi-location highlighting:** All relevant functions, classes, and methods are color-coded and emphasized.
- **Jump integration:** Click to jump directly to highlighted locations.
- **Dynamic updates:** Highlights update instantly as you change your search query.
- **Scales to large files:** Even files with thousands of lines are highlighted smoothly.

This makes it easy to find, refactor, and review code with confidence.

---

## 💡 Why Choose OwlSpotlight

### 🎯 Semantic Search Accuracy
- **Natural language queries** – Search for functions, classes, and methods by intent and context (semantic search)
- **Code fragment search** – Find code by example
- **Comprehensive support** – Functions, classes, and class methods are all searchable

### ⚡ Performance
- **Fast incremental updates** – Only changed files are re-indexed
- **Clustered indexing** – Fast even for large projects
- **FAISS-powered** – Instant search for tens of thousands of functions and classes

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

- **Search is performed on Python functions only.** While you can search using natural language and semantic context, the underlying search and indexing are based on Python function definitions (including class methods). Class definitions themselves are indexed for navigation and ranking, but the core search is function-centric.
- **Initial indexing may take time** depending on the number of extracted functions and classes, especially for large projects.
- **Only Python code is searchable.** Variables and constants are not indexed. If important information is only in variables/constants, it may not be found.
- **Class ranking is based on function/method scores.** Class docstrings and attributes do not affect ranking.
- **OwlSpotlight uses semantic (contextual) search, not simple keyword matching.**

---

## 🛠️ インストール方法（VSIXファイルからの手動インストール）

1. このリポジトリで以下のコマンドを実行し、VSIXファイルを作成します。
   ```sh
   npm install
   npm run compile
   npx vsce package
   ```
   生成された `owlspotlight-*.vsix` ファイルが拡張機能パッケージです。

2. VS Code を開き、コマンドパレット（`Cmd+Shift+P` または `Ctrl+Shift+P`）で
   `Extensions: Install from VSIX...`（VSIX からインストール）を選択します。

3. 先ほど生成した `.vsix` ファイルを選択し、インストールします。

4. サイドバーに「OwlSpotlight」が表示されます。

5. コマンドパレットから
   - `OwlSpotlight: Setup Python Environment`
   - `OwlSpotlight: Start Server`
   を順に実行してください。

6. サイドバーから自然言語でコード検索が利用できます。

> **アンインストール方法**
>
> 拡張機能ビューで「OwlSpotlight」を右クリックし「アンインストール」を選択してください。

---

## 🛠️ Installation (Manual VSIX Install)

1. In this repository, run the following commands to build the VSIX file:
   ```sh
   npm install
   npm run compile
   npx vsce package
   ```
   This will generate a file like `owlspotlight-*.vsix` (the extension package).

2. Open VS Code and open the Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`).
   Select `Extensions: Install from VSIX...`.

3. Choose the generated `.vsix` file and install it.

4. The "OwlSpotlight" icon will appear in the sidebar.

5. From the Command Palette, run:
   - `OwlSpotlight: Setup Python Environment`
   - `OwlSpotlight: Start Server`
   in order.

6. You can now search code using natural language from the sidebar.

> **To uninstall:**
>
> Open the Extensions view, right-click "OwlSpotlight", and select "Uninstall".

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
   # On macOS/Linux:
   source .venv/bin/activate
   # On Windows (Command Prompt):
   .venv\Scripts\activate
   # On Windows (PowerShell):
   .venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   cd ..
   ```
   > If you see an error with `source .venv/bin/activate`, make sure you are using a POSIX shell (like bash or zsh). On Windows, use the appropriate command above. If you still have trouble, check your Python installation and permissions.
3. Launch the extension in VS Code (F5) and click "Start Server" in the OwlSpotlight sidebar.
4. Search for functions, classes, or keywords from the sidebar.

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
- ✅ Python function, class & method search
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
- Only functions, classes, and class methods are indexed (variables/constants are not)
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

**意味的検索でコードを瞬時に発見。Pythonプロジェクトの関数・クラス・メソッドを自然言語で検索できるVS Code拡張機能**

---

## 📝 ご利用前に

- **まず最初に、このリポジトリをローカル環境にクローンしてください。**
  - OwlSpotlightはローカルのコードベース上で動作します。リモートリポジトリやオンライン上での利用には対応していません。

---

![Demo](screenshot/result.png)

## ✨ 主な機能

- 🔍 **自然言語でコード検索** - Pythonの関数・クラス・メソッドを直感的なクエリで検索
- ⚡ **瞬時のジャンプ** - 検索結果から該当コードに即座に移動
- 🎯 **関数・クラス・メソッド両対応** - スタンドアロン関数、クラス定義、クラスメソッドすべてを検索対象
- 📊 **クラス統計表示** - プロジェクト内のクラス構造をスコア付きで一覧表示
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
Pythonの関数・クラス・クラスメソッドを「文脈」や「意味」に基づいて自然言語で横断的に検索できます（単なるキーワード一致ではなく意味的検索）。
**注意：** 検索エンジンはPythonの関数（クラスメソッド含む）を抽出・インデックス化して動作します。クラス定義もナビゲーションやランキングのために扱われますが、検索の本質は関数ベースです。

### 2. クラスランキング表示
関連度の高いクラスは「上位に含まれる関数・メソッドの割合 × 最上位関数・メソッドの順位の逆数」でスコア化され、ランキング表示されます。
また、オプションで「関数のみ（クラスに属さないもの）」の表示も可能です。

![Class Statistics](screenshot/show_class_stats.png)

### 3. 関数のみの絞り込み
クラスに属さない関数のみを表示することもできます。

![Function Only](screenshot/show_only_function.png)

### 4. 検索結果のハイライト
OwlSpotlightは、検索結果の関数・クラス・メソッドをエディタ上で即座にハイライト表示します。
- **複数箇所同時ハイライト**：関連する関数・クラス・メソッドがすべて色分けされて強調表示されます。
- **ジャンプ機能と連動**：ハイライトされた箇所へワンクリックでジャンプ可能。
- **動的なハイライト更新**：検索ワードを変更するたびに、ハイライトも即座に切り替わります。
- **大規模ファイルでも快適**：数千行規模のファイルでもストレスなくハイライト。

これにより、目的のコードがどこにあるかを瞬時に把握でき、リファクタリングやレビューも圧倒的に効率化されます。

---

## 💡 OwlSpotlightの特長

### 🎯 高精度な意味的検索
- **自然言語クエリ対応** - 関数・クラス・メソッドを意図や文脈で検索（意味的検索）
- **コード断片検索** - 実際のコード片でも検索できる
- **包括的な検索対象** - 関数・クラス・クラスメソッドすべてをカバー

### ⚡ パフォーマンス
- **高速インクリメンタル更新** - 変更部分のみを効率的に更新
- **クラスタ分割インデックス** - 大規模プロジェクトでも高速検索
- **FAISS最適化** - 数万関数・クラス規模でも瞬時に検索

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

- **検索の対象はあくまでPythonの関数です。** 自然言語や文脈で検索できますが、実際にインデックス・検索されるのはPythonの関数（クラスメソッド含む）です。クラス定義自体もナビゲーションやランキングのために扱われますが、検索の本質は関数ベースです。
- **初回インデックス作成には時間がかかる場合があります。**
  - 関数・クラスの抽出数が多い大規模プロジェクトほど、初回セットアップやインデックス作成に時間を要します。
- **検索対象はPythonコードのみです。**
  - 変数・定数は検索対象外です。
  - 重要な情報が変数・定数のみの場合、検索で見つからないことがあります。
- **クラスランキングは関数・メソッドのスコアに基づきます。**
  - クラス自体の説明や属性はランキングに直接影響しません。
- **OwlSpotlightはキーワード一致ではなく文脈・意味に基づく検索（意味的検索）を行います。**

---