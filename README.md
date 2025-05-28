# OwlSpotlight

**OwlSpotlightは、どなたでも手軽に使えるPythonコードの意味的検索拡張です。VS Code上で関数単位の検索・ジャンプ・ハイライトを、シンプルな操作で実現します。**

_OwlSpotlight is a semantic code search extension for Python that anyone can use easily. It enables function-level search, jump, and highlight in VS Code with simple steps._

---

## OwlSpotlightの強み・おすすめポイント / What Makes OwlSpotlight Great

- **直感的なUIと即応性 / Intuitive UI & Responsiveness**  
  サイドバーからすぐに検索・ジャンプでき、検索結果も即座にハイライトされます。  
  Instantly search and jump from the sidebar, with immediate highlighting of results in the editor.

- **繰り返しの検索が高速 / Fast for Repeated Searches**  
  一度インデックスを作成すれば、同じリポジトリ内での繰り返し検索はとても速くなります。  
  After the initial indexing, repeated searches in the same repository are very fast.

- **差分インデックスで常に最新 / Always Up-to-date with Incremental Indexing**  
  追加・変更・削除を自動検知し、必要な部分だけインデックスを更新。  
  Automatically detects additions, changes, and deletions, updating only what is needed.

- **.gitignore準拠で不要なファイルを除外 / Respects .gitignore**  
  仮想環境やビルド成果物など、不要なファイルは自動で除外されます。  
  Unnecessary files (e.g., venv, build artifacts) are excluded automatically.

- **自然言語でもコード断片でもOK / Flexible Querying**  
  「○○する関数」やコードの一部など、自然言語・コード断片どちらでも検索可能。  
  Search with natural language or code fragments—both are supported.

- **セットアップが簡単 / Easy Setup**  
  Python仮想環境と依存パッケージをインストールするだけですぐに使えます。  
  Just set up a Python virtual environment and install dependencies to get started.

- **Apple Silicon最適化 / Optimized for Apple Silicon**  
  最新のMac (M1/M2/M3/M4) では動作確認済みです。  
  Runs on the latest Apple Silicon Macs (M1/M2/M3/M4; tested).

- **GPU・CUDA環境について / About GPU & CUDA Environments**  
  GPUやCUDA環境での動作は現時点で十分な確認ができていません。  
  Operation on GPU or CUDA environments has not been fully tested yet.

- **今後も拡張予定 / Actively Improving**  
  CUDAやflash-attention対応、さらなる機能追加も予定しています。また、現状はPythonのみ対応ですが、CodeSearch-ModernBERT-Owl-2.0は複数言語対応モデルのため、今後も対応言語を追加予定です。  
  CUDA/flash-attention support and more features are planned. Currently, only Python is supported, but since CodeSearch-ModernBERT-Owl-2.0 is a multi-language model, support for more languages is planned in the future.

---

## 主な特徴 / Features

- サイドバーUIから簡単に検索・ジャンプ  
  Intuitive sidebar UI for quick search and jump
- 関数単位での自動インデックス化（`.gitignore` 準拠）  
  Automatic function-level indexing (respects `.gitignore`)
- 独自BERTモデルによる意味的検索  
  Semantic search powered by a custom BERT model
- Mac M4 で動作確認済み  
  Tested on Mac M4

---

## 使い方 / How to Use

1. 必要なツールをインストール:  
   Install required tools:
   ```zsh
   brew install npm
   brew install pyenv
   pyenv install 3.11
   ```
2. Python環境セットアップ:  
   Set up Python environment:
   ```zsh
   cd model_server
   pyenv local 3.11
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   cd ..
   ```
3. VS Codeで本フォルダを開き、デバッグモード（F5）で起動。  
   Open this folder in VS Code and start debug mode (F5).
4. サイドバー「OwlSpotlight」から「サーバー起動」ボタンを押す。  
   In the OwlSpotlight sidebar, click "Start Server".
5. 検索バーに関数名やキーワードを入力し「検索」。  
   Enter a function name or keyword in the search bar and click "Search".
   - サーバーはエディタ再起動ごとに「サーバー起動」ボタンを押してください。  
     Please click "Start Server" every time you restart the editor.
   - 一度インデックス作成後は、変更がなければ高速に検索できます。  
     After the first run, searches will be fast unless there are changes.

---

## スクリーンショット / Screenshots

1. **デバッグモード起動 / Launching Debug Mode**

   ![init](screenshot/init.png)
   
   VS Codeで拡張機能のデバッグモードを起動します。左側のOwlSpotlightサイドバーが表示されます。
   _Start the extension in debug mode in VS Code. The OwlSpotlight sidebar will appear on the left._

2. **サーバー起動ボタンを押す / Click "Start Server"**

   ![startserver](screenshot/startserver.png)
   
   サイドバーの「サーバー起動」ボタンを押して、検索用のモデルサーバーを起動します。
   _Click the "Start Server" button in the sidebar to launch the model server for code search._

3. **検索例：「how to train CodeBERT」 / Example Search: "how to train CodeBERT"**

   ![codesearchresult](screenshot/codesearchresult.png)
   
   検索バーに「how to train CodeBERT」と入力して検索すると、関連する関数がリストアップされます。
   _Type "how to train CodeBERT" in the search bar and press search. Related functions are listed as results._

   例としてヒットした関数：
   
   `def convert_examples_to_features(examples, label_list, max_seq_length, tokenizer, output_mode, ...)`

   この関数は、入力データ（examples）をBERTなどのモデルで学習・推論できる形式（InputFeaturesのリスト）に変換する処理を行います。
   - テキストをトークン化し、必要に応じてペアシーケンスの切り詰めやパディングを行う
   - BERTの入力形式（[CLS], [SEP]トークンやsegment_idsなど）に整形
   - 分類・回帰タスクに応じてラベルIDを付与
   - 変換結果をInputFeaturesとしてまとめて返します

   _This function converts input examples into a list of InputFeatures suitable for training or inference with BERT-like models. It tokenizes text, handles sequence truncation and padding, formats inputs for BERT ([CLS], [SEP], segment_ids), assigns label IDs for classification/regression, and returns the results as InputFeatures._

---

## 注意事項 / Notes

- 検索対象は「def」で定義された関数のみです。クラス定義や関数外コードは対象外です。
- Only functions defined with `def` are searchable. Class definitions and code outside functions are not included.

---

## 技術的な特徴・アーキテクチャ / Technical Highlights

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
- **flash-attention対応モデル（CUDA環境のみ） / If using a flash-attention compatible model (CUDA only)**
  - CUDA環境でflash-attention対応モデルを利用する場合は、仮想環境に`flash-attn`を追加インストールしてください。
  - If you use a flash-attention compatible model on CUDA, please install `flash-attn` in your virtual environment:
    ```zsh
    pip install flash-attn --no-build-isolation
    ```

---

## 注意点・環境構築について / Environment Setup

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

## 開発状況 / Development Status

この拡張機能は現在開発中です。仕様や挙動は今後予告なく変更される可能性があります。  
_This extension is under active development. Features and behaviors may change._

---

## ライセンス / License

MIT