# Owl Diff Search

**Git の変更を、自然言語で探す VS Code 拡張。**

[OwlSpotLight](https://github.com/Shun0212/OwlSpotLight) の「コード差分検索」に絞った独立版です。
検索対象は選択した Git 差分だけです。ローカルの NightOwl-CodeEmbedding を使い、
関連する変更から VS Code 標準の左右 diff を開けます。

## インストール

1. 配布された **owl-diff-search-0.1.0.vsix** をダウンロードします。
2. VS Code の拡張機能画面の **… → VSIX からのインストール** で選択します。
3. Git リポジトリのフォルダーを開き、サイドバーの **Owl Diff Search** を開きます。
4. 自然言語で探す場合は **検索エンジンを準備** を押します。

VS Code 1.100 以降と Git が必要です。デスクトップ VS Code と、
Remote SSH / WSL / Dev Containers のワークスペース側で動きます。
ブラウザー版 VS Code の仮想ワークスペースには対応しません。

### 最小構成ですぐ試す

Git と **Python 3.11 または 3.12** が入っていれば、
検索方法を **Keyword** または **BM25** にして検索できます。
Python の関数検索も標準ライブラリだけで動作します。

Python を自動検出できない場合は **owlDiff.pythonPath** に実行ファイルを指定してください。
例: macOS / Linux では Python の実行ファイル、Windows では python.exe の絶対パス。

### 自然言語検索の準備

**検索エンジンを準備** は拡張専用の Python 仮想環境を作り、
PyTorch、Sentence Transformers、Tree-sitter と NightOwl モデルをインストールします。

- uv があれば、uv を使って Python 3.11 も準備します。
- uv がなければ、インストール済みの Python 3.11 / 3.12 を使います。
- 初回はネット接続と、モデル・実行環境のダウンロード用に数 GB の空き容量が必要です。
- 初回準備後の検索はローカルで実行します。コードや検索文を API へ送信しません。
- Python パッケージはプロジェクトの環境と分けて保存します。
- macOS は利用できれば MPS を使います。通常の Windows / Linux セットアップは CPU 版です。
- 中止ボタンで検索・準備を止められます。中断した準備は同じボタンでやり直せます。

モデルは元と同じ **Shuu12121/NightOwl-CodeEmbedding** です。
日本語もそのまま入力できますが、英語のコードに対する日本語クエリの精度は
モデルに依存します。結果が弱い場合は英語やコードの識別子でも試してください。
この独立版には Gemini によるクエリ翻訳は含めていません。

## 使い方

検索文、比較方法、検索対象、検索方法を選び、**差分を検索** を押します。
Ctrl / Cmd + Enter でも検索できます。空の検索文では変更一覧を表示します。

### 比較方法

| 比較方法 | 検索対象 |
| --- | --- |
| 作業中の変更 | Base と保存済みの作業ツリー。Base の空欄は HEAD。ステージ済み・未ステージ・未追跡を含む |
| 2つのコミットを比較 | Base → Head の最終的な差分。Head の空欄は HEAD |
| コミット履歴を検索 | Base..Head に含まれる各非 merge コミットとその親の差分。途中で追加して後で削除したコードも検索可能 |

Base / Head にはブランチ、タグ、SHA、HEAD~3 などの参照を指定できます。
**選択** ボタンからブランチ・タグ・最近のコミットを選べます。
比較・検索のための checkout やファイル書き換えは行いません。

「2つのコミットを比較」は 2 点の差分です。
PR の共通祖先から比較したい場合は、共通祖先の SHA を Base に指定してください。
コミット履歴モードは merge コミットそのものを除外します。merge 時の競合解決は
2 点比較で確認してください。リモートの fetch は自動実行しません。

未保存のエディター内容は検索に入りません。必要な変更を保存してから検索してください。
作業ツリーは検索ごとに読み直します。検索後の結果表示はその時点のスナップショットです。

### 検索対象

- **差分 (Unified diff)**: 追加・削除・前後の文脈を含む差分のかたまりを検索します。
  UTF-8 のテキストファイルが対象です。
- **変更された関数**: 実際の変更行が属する関数・メソッドを検索します。
  変更前・変更後のコードを使うため、削除された関数も探せます。

関数検索は Python、Java、TypeScript / TSX、JavaScript / JSX / MJS / CJS に対応します。
Python は AST、他の言語と構文が壊れた Python は Tree-sitter を使います。
JavaScript / TypeScript の名前付き arrow function も対象です。
関数外の変更は Unified diff で検索してください。

### 検索方法

| 方法 | 振る舞い | モデル |
| --- | --- | --- |
| Hybrid | 差分の意味 60% と BM25 40% を組み合わせる | 必要 |
| Semantic | 差分・変更された関数の意味で順位付けする | 必要 |
| BM25 | コード、パス、コミット件名の用語で順位付けする | 不要 |
| Keyword | 空白区切りの全語を部分一致で探す。大文字・小文字は区別しない | 不要 |

BM25 は camelCase / snake_case を分割し、日本語は文字 bigram で照合します。
スコアは結果を並べるための値で、正解の確率ではありません。

### 結果を開く

- **diff を開く**: 検索に使った変更前・変更後の全文を左右に表示します。
- **コードを開く / 変更前のコード**: 該当側のスナップショットで対象行へ移動します。

作業中のファイルも検索時点で固定しているため、検索後に編集しても
表示内容と検索結果が食い違いません。スナップショットは読み取り専用です。
拡張・ウィンドウを再読み込みした後は再検索してください。

### ファイル条件と上限

対象・除外にはカンマ区切りの glob を指定できます。

- 対象例: **/*.py, **/*.ts
- 除外例: **/tests/**, **/*.lock

未追跡ファイルでは Git の ignore / exclude ルールを適用します。
Git で追跡済みの変更は .gitignore に追記されていても対象です。

1 ファイル 1 MB、比較する全文の合計 32 MB、検索対象 3,000 件を上限にしています。
バイナリ、UTF-8 以外、シンボリックリンク、サブモジュール、
本文が変わらない名前・種類だけの変更は除外し、画面に理由を表示します。
大きい比較は参照や glob で絞り込んでください。

| 設定 | 初期値 | 内容 |
| --- | --- | --- |
| owlDiff.pythonPath | 自動検出 | 基本検索・専用環境の作成に使う Python |
| owlDiff.modelName | Shuu12121/NightOwl-CodeEmbedding | Sentence Transformers 互換モデル名またはローカルパス |
| owlDiff.maxFiles | 300 | 1 回に読むファイル変更数 |
| owlDiff.maxCommits | 100 | 履歴検索のコミット数 |

## 元の拡張からの切り出し範囲

残した機能は、差分内の自然言語・BM25・キーワード検索、変更された関数、
参照選択、過去のコード・削除されたコードの表示です。

リポジトリ全体の検索、MCP、エージェント連携、API キー設定、翻訳、
常駐 HTTP サーバー、全体の自動インデックスは含めていません。
拡張が必要なときだけローカル Python 子プロセスを起動します。

元の最新実装と全く同じランキングではありません。
この版は差分のかたまり・関数を単位に順位付けし、BM25 では差分本文も対象にします。
比較範囲を選んだときは、その時点の Git オブジェクトから関数を抽出します。

## 開発・ビルド

ソースのフォルダーを VS Code で開き、F5 で Extension Development Host を起動できます。
拡張本体は CommonJS なので、実行のための TypeScript ビルドは不要です。

Node.js 22 以降で依存関係を準備します。

~~~sh
npm install
npm run check
npm test
npm run package
~~~

生成した VSIX を VS Code にインストールしてください。
npm の依存関係はビルド・テスト用であり、実行時の VSIX には同梱しません。

Python テスト:

~~~sh
python -m pip install -r backend/requirements-parsers.txt
python -m unittest discover -s backend/tests -p "test_*.py" -v
~~~

VS Code Extension Host の実機テスト:

~~~sh
npm run test:extension
~~~

Linux のヘッドレス環境では xvfb-run -a npm run test:extension を使います。
検証用 VS Code 1.100.0 が初回にダウンロードされます。

実モデルを使う明示的な確認:

~~~sh
python -m pip install torch==2.7.1 --index-url https://download.pytorch.org/whl/cpu
python -m pip install -r backend/requirements.txt
python backend/tests/semantic_smoke.py
~~~

上の PyTorch CPU コマンドは Linux / Windows 向けです。
macOS では通常の PyPI から torch==2.7.1 をインストールしてください。

## ライセンス

MIT。OwlSpotLight の著作権表示を LICENSE に保持しています。
再利用箇所とモデルの扱いは THIRD_PARTY_NOTICES.md を参照してください。
