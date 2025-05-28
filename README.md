# OwlSpotlight

**OwlSpotlight** は、VS Code 上で Python コードの関数を対象に、**意味的なコード検索（semantic code search）とハイライト表示**を可能にする拡張機能です。  
独自開発の [CodeSearch-ModernBERT-Owl-2.0-Plus](https://huggingface.co/Shuu12121/CodeSearch-ModernBERT-Owl-2.0-Plus) モデルを用いて、自然言語またはコード断片による高速・高精度な検索が行えます。

---

## 機能概要（日本語）

- サイドバーUIから簡単に検索・ジャンプ  
- 関数単位での自動インデックス化（`.gitignore` 準拠）  
- 独自の BERT ベース埋め込みモデルを使用  
- Mac M4 で動作確認済み

### 起動方法

1. npm をインストールしていない場合、インストールします:
   ```zsh
   brew install npm
   ```
2. Python 3.11 がインストールされていない場合、インストールします:
   ```zsh
   brew install pyenv
   pyenv install 3.11
   ```
3. モデルサーバー用の Python 環境をセットアップします:
   ```zsh
   cd model_server
   pyenv local 3.11
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   cd ..
   ```
4. VS Code で本フォルダを開き、デバッグモード（F5 または「実行とデバッグ」→「拡張機能のデバッグ」）で起動します。
5. サイドバー「OwlSpotlight」から「サーバー起動」ボタンを押してください。  
   ※ エディタを再起動するたびに、まず「サーバー起動」を押してからご利用ください。
6. 検索バーに関数名やコード断片を入力し「検索」ボタンを押します。  
   ※ 一度サーバーを起動しインデックスが作成されれば、以降は変更がない限り高速に検索できます。

---

## Features & Overview (English)

**OwlSpotlight** is a VS Code extension that enables **semantic search and highlighting of similar Python code snippets**.  
It uses a custom-developed model: [CodeSearch-ModernBERT-Owl-2.0-Plus](https://huggingface.co/Shuu12121/CodeSearch-ModernBERT-Owl-2.0-Plus) to provide high-accuracy search based on both natural language and code fragments.

- Fast semantic search from the sidebar  
- Function-level indexing with `.gitignore` support  
- Powered by a custom BERT-based embedding model  
- Tested on Mac M4

### How to Run

1. Install npm if not already installed:
   ```zsh
   brew install npm
   ```
2. If Python 3.11 is not installed, install it:
   ```zsh
   brew install pyenv
   pyenv install 3.11
   ```
3. Set up the Python environment for the model server:
   ```zsh
   cd model_server
   pyenv local 3.11
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   cd ..
   ```
4. Open this folder in VS Code and start in debug mode (press F5 or use "Run & Debug" → "Start Debugging").
5. In the OwlSpotlight sidebar, click the "Start Server" button.  
   ※ Please click "Start Server" every time you restart the editor before searching.
6. Enter a function name or code fragment in the search bar and click "Search".  
   ※ After the first run, an index is created, so as long as there are no changes, subsequent searches will be much faster.

---

## セットアップ・デバッグ方法（日本語）

1. npm をインストールしていない場合、インストールします:
   ```zsh
   brew install npm
   ```
2. モデルサーバー用の Python 環境をセットアップします:
   ```zsh
   cd model_server
   pyenv local 3.11
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   cd ..
   ```
3. このリポジトリをクローンします。
   ```zsh
   git clone https://github.com/yourname/owlspotlight.git
   cd owlspotlight
   ```
4. VS Code で本フォルダを開きます。
5. 拡張機能のデバッグモード（F5 または「実行とデバッグ」→「拡張機能のデバッグ」）を開始します。
6. サイドバー「OwlSpotlight」から「サーバー起動」ボタンを押し、動作をテストしてください。

---

## 技術的な特徴・アーキテクチャのポイント / Technical Highlights

- **独自BERTモデルによる意味的コード検索 / Custom BERT-based model for semantic code search**
  - [CodeSearch-ModernBERT-Owl-2.0-Plus](https://huggingface.co/Shuu12121/CodeSearch-ModernBERT-Owl-2.0-Plus) を活用し、自然言語・コード断片の両方で高精度な関数検索が可能。
  - Utilizes [CodeSearch-ModernBERT-Owl-2.0-Plus](https://huggingface.co/Shuu12121/CodeSearch-ModernBERT-Owl-2.0-Plus) for high-accuracy function search with both natural language and code fragments.
- **関数単位の自動インデックス化と差分更新 / Automatic function-level indexing and incremental updates**
  - コードベース全体を関数単位で自動抽出し、`.gitignore` 準拠で不要ファイルを除外。
  - Extracts all functions automatically, respects `.gitignore` to exclude unnecessary files.
  - 追加ファイルは差分のみインデックス化、変更ディレクトリは問答無用で再構築することで、大規模リポジトリでも効率的な運用が可能。
  - Newly added files are indexed incrementally; directories with changes are fully rebuilt for efficient operation on large repositories.
- **クラスタ分割によるスケーラビリティと高速化 / Clustered indexing for scalability and speed**
  - ディレクトリ単位でクラスタ分割し、各クラスタごとにFAISSインデックスを管理。
  - Splits the codebase into clusters by directory, each with its own FAISS index.
  - クラスタごとに部分的な再構築や検索ができるため、巨大なプロジェクトでもメモリ消費・検索速度を最適化。
  - Enables partial rebuild/search per cluster, optimizing memory usage and search speed for large projects.
- **FAISSによる高速ベクトル検索 / Fast vector search with FAISS**
  - 埋め込みベクトルの類似度計算にFAISSを利用し、数万関数規模でも高速な検索レスポンスを実現。
  - Uses FAISS for similarity search, providing fast responses even with tens of thousands of functions.
- **VS Code拡張としての高いユーザビリティ / High usability as a VS Code extension**
  - サイドバーUIから直感的に検索・ジャンプ・ハイライトが可能。
  - Intuitive sidebar UI for search, jump, and highlight.
  - 検索結果は即座にエディタ上でハイライト表示。
  - Search results are instantly highlighted in the editor.
- **マルチプラットフォーム・最新環境対応 / Multi-platform & modern environment support**
  - Apple Silicon (M1/M2/M3/M4) など最新Macにも最適化。PyTorchのmps対応で高速動作。
  - Optimized for Apple Silicon (M1/M2/M3/M4) with PyTorch mps backend.
  - **CUDA環境では未検証**ですが、今後対応予定です。
  - **CUDA environments are not yet tested**, but support is planned.
- **堅牢な差分検出・インデックス管理 / Robust diff detection and index management**
  - ファイルの追加・削除・関数の消失も正確に検知し、インデックスを自動で更新。
  - Detects file addition, deletion, and function removal accurately, updating the index automatically.
  - クラスタごとにメタ情報・インデックスを分離管理し、部分的な再構築やGCも容易。
  - Each cluster manages its own metadata and index, making partial rebuilds and GC easy.
- **flash-attention対応モデルの場合 / If using a flash-attention compatible model**
  - flash-attentionに対応したモデルを利用する場合は、仮想環境に`flash-attn`を追加インストールしてください。
  - Please install `flash-attn` in your virtual environment:
    ```zsh
    pip install flash-attn --no-build-isolation
    ```

---

## 注意点・環境構築について

- Python 3.9 以上（動作確認は 3.11 で実施）、pip、virtualenv などの基本的な開発環境が必要です。
- サーバーはPython仮想環境（venv）上で起動します。**必ずPython 3.11系で仮想環境を作成してください。**
   ```zsh
   python3.11 -m venv .venv
   source .venv/bin/activate
   pip install -r model_server/requirements.txt
   ```
- 仮想環境や依存パッケージのインストールには数GBの空き容量が必要になる場合があります。
- `model_server/requirements.txt` を使って依存パッケージをインストールしてください。
- Transformerベースのモデル（CodeSearch-ModernBERT-Owl-2.0-Plus）を利用するため、**メモリを大量に消費する場合があります**。
- 検索やインデックス作成の効率は、**CPUやGPUの性能に大きく依存**します。高速なGPUがあるとより快適に動作します。
- Apple Silicon (M1/M2/M3/M4) では `torch` の `mps` サポートにより高速化されますが、環境によっては追加のセットアップが必要な場合があります。
- 検索対象外としたいファイルやディレクトリ（例: 仮想環境 `.venv/` など）は `.gitignore` に追加しておくことを推奨します。

---

## Notes on Environment Setup

- Requires Python 3.9+ (tested with 3.11), pip, and basic development tools (e.g., virtualenv).
- The server runs in a Python virtual environment (venv). **Be sure to create the venv with Python 3.11.**
   ```zsh
   python3.11 -m venv .venv
   source .venv/bin/activate
   pip install -r model_server/requirements.txt
   ```
- Installing the virtual environment and dependencies may require several GB of free disk space.
- Install dependencies using `model_server/requirements.txt`.
- Since this extension uses a transformer-based model (CodeSearch-ModernBERT-Owl-2.0-Plus), **it may consume a large amount of memory**.
- The efficiency of search and indexing depends heavily on your **CPU and GPU performance**. A fast GPU is recommended for best results.
- On Apple Silicon (M1/M2/M3/M4), PyTorch's `mps` backend can accelerate processing, but additional setup may be required depending on your environment.
- It is recommended to add unnecessary files and directories (e.g., virtual environments like `.venv/`) to `.gitignore` to exclude them from search and indexing.

---

## 開発状況 / Development Status

この拡張機能は現在開発中です。仕様や挙動は今後予告なく変更される可能性があります。  
_This extension is under active development. Features and behaviors may change._

---

## ライセンス / License

MIT