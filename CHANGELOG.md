# Change Log

## [0.5.5] - 2026-09-11

v0.5.3 から v0.5.5 への主な更新内容です。

### Agentic search

Settings → **Gemini Search** → **Agentic search** を有効にすると、Gemini が検索結果を確認し、クエリの修正とキーワード検索による確認を繰り返します。検索範囲・言語・差分の From/To は、検索開始時の指定を維持します。

- 検索回数は既定で3回、`owlspotlight.agenticMaxSearches` で最大6回まで設定できます。
- **Agent search** で検索クエリ・件数・終了理由を確認できます。結果には関連度の推定と短い説明を表示します。関連度は確率ではなく、既存のスコアバッジ・バーで表示します。
- APIキー未設定やGeminiエラー時は、元のクエリによる通常検索、または取得済みの結果を表示し、理由を **Agent search** に示します。
- **■ Stop**、コマンドパレット、ステータスバーの停止処理を統一しました。Geminiの翻訳・エージェントリクエストを中断し、後続検索を停止します。サーバーの埋め込み処理中は現在のバッチの完了を待ちます。

### コードの追加取得と説明カード

- エージェントは `read_code` で検索結果に含まれるファイルを追加取得できます。通常のファイルは取得時点、コミットの結果はそのコミット時点の内容を読み、削除されたファイルは親コミットの内容であることを明記します。
- 長いファイルは最大200行・20,000文字ずつ取得します。1回のエージェント検索につき読み取りは最大6回、1ファイルは1MiBまでです。カードには取得範囲と行数を表示します。
- AIがカードの見出し、注目する行、色、短い説明を指定できます。ハイライトは取得済みの実コードに限り、最大4箇所・各20行、青・緑・黄・紫に対応します。見出しをクリックすると「取得したコード」を展開し、該当行を表示します。
- CodexなどのMCPクライアントも `owlspotlight.read_code` と `owlspotlight.publish_result_annotations` で同じ形式のカードを作成できます。**Agent Activity → Show** から確認でき、MCP経由のカード作成にはGemini APIキーは不要です。

### Geminiの設定とデータ共有

- Geminiを有効にすると、外部送信の説明とAPIキーの設定画面が開きます。**APIキーを取得** からGoogle AI Studioへ移動し、作成したキーを貼り付けて保存できます。画面は **Gemini Search → API key & data sharing** から再度開けます。
- APIキーはVS Code SecretStorageへ保存します。従来の設定値は保存成功後に移行・削除し、グローバル／ワークスペース／フォルダーの設定優先順位を維持します。既存キーは画面へ返さず、設定済みかどうかだけを表示します。
- Gemini使用時には、クエリ、コードの抜粋、追加取得したソースがGemini APIへ送信されます。追加取得したコードも送信対象であることを利用案内に表示します。
- 翻訳モード（JP → EN）がオンの場合、利用案内とエージェントの説明は日本語になります。
- 拡張機能の既定モデルを **Gemini 3.8 Flash**、軽量モデルを **3.5 Flash-Lite** に設定しました。明示的に選択した3.5 Flashは維持し、旧3.1モデルの設定は3.8 Flashとして扱います。

## モデル大幅アップデート (2025-06-21)
- AIモデルを刷新し、検索精度が大幅に向上しました！

## Major Model Update (2025-06-21)
- The AI model has been upgraded for significantly improved search accuracy!

All notable changes to the "owlspotlight" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Initial release
