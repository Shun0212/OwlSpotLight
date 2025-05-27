# OwlSpotLight README

This is the README for your extension "OwlSpotLight". After writing up a brief description, we recommend including the following sections.

## 機能紹介・概要（日本語）

**OwlSpotlight** は、VS Code上で類似コードスニペットをセマンティック検索し、ハイライト表示できる拡張機能です。Pythonコードを対象に、関数単位でインデックスを作成し、自然言語やコード断片で高速に検索できます。検索結果から該当箇所へジャンプも可能です。

- サイドバーUIから簡単に検索・ジャンプ
- 独自のBERTベース埋め込みモデルを利用
- `.gitignore` 準拠のインデックス作成
- Mac M4で動作確認中

### 起動方法
1. VS Codeで拡張機能を有効化
2. サイドバーの「OwlSpotlight」から「サーバー起動」ボタンを押す
3. 検索バーに関数名やコード断片を入力し「検索」

---

## Features & Overview (English)

**OwlSpotlight** is a VS Code extension for semantic search and highlighting of similar code snippets. It indexes Python functions and enables fast search using natural language or code fragments. You can jump directly to the found code from the sidebar UI.

- Easy search and jump from the sidebar UI
- Uses a custom BERT-based embedding model
- Indexing respects `.gitignore`
- Tested on Mac M4

### How to Run
1. Enable the extension in VS Code
2. Click the "Start Server" button in the OwlSpotlight sidebar
3. Enter a function name or code fragment in the search bar and click "Search"

---

現在開発中のため、動作や仕様は今後変更される可能性があります。

This extension is under development; features and behavior may change.

## Features

Describe specific features of your extension including screenshots of your extension in action. Image paths are relative to this README file.

For example if there is an image subfolder under your extension project workspace:

\!\[feature X\]\(images/feature-x.png\)

> Tip: Many popular extensions utilize animations. This is an excellent way to show off your extension! We recommend short, focused animations that are easy to follow.

## Requirements

If you have any requirements or dependencies, add a section describing those and how to install and configure them.

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: Enable/disable this extension.
* `myExtension.thing`: Set to `blah` to do something.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
