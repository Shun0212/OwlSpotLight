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

1. VS Code で拡張機能を有効化  
2. サイドバー「OwlSpotlight」から「サーバー起動」ボタンを押す  
3. 検索バーに関数名やコード断片を入力し「検索」ボタンを押す  

---

## Features & Overview (English)

**OwlSpotlight** is a VS Code extension that enables **semantic search and highlighting of similar Python code snippets**.  
It uses a custom-developed model: [CodeSearch-ModernBERT-Owl-2.0-Plus](https://huggingface.co/Shuu12121/CodeSearch-ModernBERT-Owl-2.0-Plus) to provide high-accuracy search based on both natural language and code fragments.

- Fast semantic search from the sidebar  
- Function-level indexing with `.gitignore` support  
- Powered by a custom BERT-based embedding model  
- Tested on Mac M4

### How to Run

1. Activate the extension in VS Code  
2. Click "Start Server" in the OwlSpotlight sidebar  
3. Enter a function name or code fragment in the search bar and click "Search"  

---

## セットアップ・デバッグ方法（日本語）

1. このリポジトリをクローンします。
   ```zsh
   git clone https://github.com/yourname/owlspotlight.git
   cd owlspotlight
   ```
2. VS Code で本フォルダを開きます。
3. 拡張機能のデバッグモード（F5 または「実行とデバッグ」→「拡張機能のデバッグ」）を開始します。
4. サイドバー「OwlSpotlight」から「サーバー起動」ボタンを押し、動作をテストしてください。

---

## Setup & Debug Instructions (English)

1. Clone this repository:
   ```zsh
   git clone https://github.com/yourname/owlspotlight.git
   cd owlspotlight
   ```
2. Open the folder in VS Code.
3. Start the extension in debug mode (press F5 or use "Run & Debug" → "Start Debugging").
4. In the OwlSpotlight sidebar, click "Start Server" and test the extension.

---

## 注意点・環境構築について

- Python 3.9 以上（動作確認は 3.11 で実施）、pip、virtualenv などの基本的な開発環境が必要です。
- `model_server/requirements.txt` を使って依存パッケージをインストールしてください。
- Transformerベースのモデル（CodeSearch-ModernBERT-Owl-2.0-Plus）を利用するため、**メモリを大量に消費する場合があります**。
- 検索やインデックス作成の効率は、**CPUやGPUの性能に大きく依存**します。高速なGPUがあるとより快適に動作します。
- Apple Silicon (M1/M2/M3/M4) では `torch` の `mps` サポートにより高速化されますが、環境によっては追加のセットアップが必要な場合があります。

---

## Notes on Environment Setup

- Requires Python 3.9+ (tested with 3.11), pip, and basic development tools (e.g., virtualenv).
- Install dependencies using `model_server/requirements.txt`.
- Since this extension uses a transformer-based model (CodeSearch-ModernBERT-Owl-2.0-Plus), **it may consume a large amount of memory**.
- The efficiency of search and indexing depends heavily on your **CPU and GPU performance**. A fast GPU is recommended for best results.
- On Apple Silicon (M1/M2/M3/M4), PyTorch's `mps` backend can accelerate processing, but additional setup may be required depending on your environment.

---

## 開発状況 / Development Status

この拡張機能は現在開発中です。仕様や挙動は今後予告なく変更される可能性があります。  
_This extension is under active development. Features and behaviors may change._

---

## ライセンス / License

MIT