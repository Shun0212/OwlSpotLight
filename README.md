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

## 開発状況 / Development Status

この拡張機能は現在開発中です。仕様や挙動は今後予告なく変更される可能性があります。  
_This extension is under active development. Features and behaviors may change._

---

## ライセンス / License

MIT