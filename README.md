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
   pyenv install 3.11.9
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
   ※ 検索を行うたびに、まず「サーバー起動」を押してからご利用ください。
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
   pyenv install 3.11.9
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
5. In the OwlSpotlight sidebar, click the "Start Server" button before each search.  
   ※ Always click "Start Server" before searching.
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

## Setup & Debug Instructions (English)

1. Install npm if not already installed:
   ```zsh
   brew install npm
   ```
2. Set up the Python environment for the model server:
   ```zsh
   cd model_server
   pyenv local 3.11
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   cd ..
   ```
3. Clone this repository:
   ```zsh
   git clone https://github.com/yourname/owlspotlight.git
   cd owlspotlight
   ```
4. Open the folder in VS Code.
5. Start the extension in debug mode (press F5 or use "Run & Debug" → "Start Debugging").
6. In the OwlSpotlight sidebar, click "Start Server" and test the extension.

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