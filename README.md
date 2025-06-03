# 🦉 OwlSpotlight

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.0.3-blue.svg)](https://github.com/shun0212/OwlSpotLight)
[![Python](https://img.shields.io/badge/python-3.9+-green.svg)](https://www.python.org/)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.100+-blue.svg)](https://code.visualstudio.com/)

**🔍 Instantly discover code with AI-powered semantic search**

*A powerful VS Code extension that revolutionizes how you navigate Python codebases using natural language queries*

[English](#english) | [日本語](#japanese)

</div>

---

## English

### 🚀 What is OwlSpotlight?

OwlSpotlight transforms code navigation by bringing **semantic understanding** to your VS Code workspace. Instead of searching for exact matches, ask questions like *"function that validates email"* or *"class for handling database connections"* and instantly find relevant code across your entire Python project.

![Demo Preview](screenshot/detect_method_in_class.png)

**Instantly discover code with semantic search. A VS Code extension for searching Python functions, classes, and methods using natural language.**

**意味的検索でPython関数・クラス・メソッドを瞬時に発見できるVS Code拡張機能。**

---

### Key Features

- AI-powered semantic search – Find code by intent, not just keywords
- Fast search and incremental indexing
- Search functions, classes, methods, and their relationships
- Results ranked by relevance
- Only changed files are re-indexed
- Simple, intuitive sidebar interface
- Apple Silicon optimized
- Built-in cache clearing and environment management

### See It In Action

| Feature | Description | Preview |
|---------|-------------|---------|
| **🔍 Semantic Function Search** | Find functions by describing what they do in natural language | ![Function Search](screenshot/detect_function.png) |
| **🏗️ Class & Method Discovery** | Explore class hierarchies and their methods with context-aware search | ![Class Methods](screenshot/detect_method_in_class.png) |
| **📊 Intelligent Ranking** | View classes ranked by relevance with detailed statistics | ![Class Rankings](screenshot/class_stats_mode.png) |
| **⚙️ Environment Management** | Built-in alerts and management for Python environments | ![Environment Alert](screenshot/alart_No_venv.png) |

### 🚀 Quick Start

**Prerequisites**: Python 3.9+ installed on your system

> **注意:** 現在、検索クエリは英語で入力してください。

#### Option 1: Automatic Setup (Recommended for macOS/Linux)

1. **Open this project** in VS Code
2. **Setup environment** - Open Command Palette (`Cmd+Shift+P`) and run:
   ```
   OwlSpotlight: Setup Python Environment
   ```
3. **Start the server**:
   ```
   OwlSpotlight: Start Server
   ```
4. **Start searching!** Open the OwlSpotlight sidebar and enter your query

![Server Initialization](screenshot/init_server.png)

#### Option 2: Manual Installation

1. **Build the extension**:
   ```bash
   npm install
   npm run compile
   npx vsce package
   ```

2. **Install in VS Code**:
   - Open Command Palette (`Cmd+Shift+P`)
   - Select `Extensions: Install from VSIX...`
   - Choose the generated `.vsix` file

3. **Setup Python environment**:
   ```bash
   cd model_server
   python3 -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

4. **Launch**: Run the commands from Option 1, steps 2-4

### 💡 Why OwlSpotlight?

| Traditional Search | OwlSpotlight |
|-------------------|--------------|
| `def email_validation` | *"function that validates email addresses"* |
| `class Database` | *"class for database connections"* |
| Exact keyword matching | Semantic understanding of code purpose |
| Limited to function names | Searches documentation, comments, and logic |

### ⚙️ System Requirements

| Component | Requirement | Notes |
|-----------|-------------|-------|
| **Python** | 3.9+ (3.11 recommended) | Virtual environment recommended |
| **Memory** | 4GB+ (8GB+ for large projects) | More RAM = better performance |
| **Storage** | 2-3GB | For dependencies and models |
| **Platform** | macOS (optimized), Linux, Windows | Apple Silicon fully supported |

### 🛠️ Advanced Configuration

For Windows users or manual setup:

```bash
# Install dependencies (macOS with Homebrew)
brew install npm pyenv
pyenv install 3.11

# Setup Python environment
cd model_server
pyenv local 3.11
python3 -m venv .venv

# Activate virtual environment
source .venv/bin/activate          # macOS/Linux
# .venv\Scripts\activate           # Windows CMD
# .venv\Scripts\Activate.ps1       # Windows PowerShell

pip install -r requirements.txt
```

**Performance Tips**:
- Use SSD storage for faster indexing
- Allocate more RAM for large projects
- Exclude unnecessary files via `.gitignore`
- Consider `flash-attn` for CUDA environments

### 🚧 Development Roadmap

#### ✅ Current Features
- [x] Natural language search for Python functions/classes/methods
- [x] Real-time incremental indexing
- [x] Apple Silicon optimization
- [x] Class relationship visualization
- [x] Advanced filtering and statistics

#### 🔄 Coming Soon
- [ ] **Multi-language support** (JavaScript, TypeScript, Java, C++)
- [ ] **CUDA/GPU acceleration** with flash-attention
- [ ] **VS Code Marketplace** release
- [ ] **Real-time file watching** (auto-update on save)
- [ ] **Class inheritance diagrams**

### 🤝 Contributing

We welcome contributions! Here's how you can help:

- 🐛 **Report bugs** in [Issues](https://github.com/shun0212/OwlSpotLight/issues)
- 💡 **Suggest features** via GitHub Issues
- 🔧 **Submit pull requests** for improvements
- 📖 **Improve documentation**

### 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

## Japanese

### OwlSpotlightとは？

OwlSpotlightは、VS CodeでPythonコードを自然言語で検索できる拡張機能です。
現在[Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Shun0212.owlspotlight)でも公開・配布しています。
従来のキーワード検索とは異なり、「メールを検証する関数」や「データベース接続を処理するクラス」など、意図を表現したクエリで関連するコードを素早く見つけることができます。

### 主な特長

- 自然言語によるコード検索
- 高速な検索とインデックス更新
- 関数・クラス・メソッドの検索
- 関連度に基づくランキング
- 変更ファイルのみ再インデックス
- シンプルで使いやすいUI
- Apple Silicon対応
- サイドバーから環境管理やキャッシュクリアが可能

### クイックスタート

**前提条件**: システムにPython 3.9+がインストールされていること

> **注意:** 現在、検索クエリは英語で入力してください。

#### 方法1: 自動セットアップ（macOS/Linux推奨）

1. プロジェクトを開く - VS Codeでこのプロジェクトを開く
2. 環境セットアップ - コマンドパレット（`Cmd+Shift+P`）で実行：
   ```
   OwlSpotlight: Setup Python Environment
   ```
3. サーバー開始：
   ```
   OwlSpotlight: Start Server
   ```
4. サイドバーから検索を開始

#### 方法2: 手動インストール

1. 拡張機能をビルド：
   ```bash
   npm install
   npm run compile
   npx vsce package
   ```
2. VS Codeで「Extensions: Install from VSIX...」を選択し、生成された`.vsix`ファイルをインストール
3. Python環境をセットアップ：
   ```bash
   cd model_server
   python3 -m venv .venv
   source .venv/bin/activate  # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

### OwlSpotlightを選ぶ理由

| 従来の検索 | OwlSpotlight |
|-----------|--------------|
| `def email_validation` | "function that validates email address" など、目的や意味で英語クエリ検索可能 |
| `class Database` | "class for database connections" など、英語で自然なクエリで検索可能 |
| キーワード完全一致が必要 | 完全一致でなくても意図が伝われば検索可能 |
| 関数名のみ対象 | コメントや処理内容も英語クエリで検索対象 |

### 高度な設定

Windowsユーザーや手動セットアップの場合：

```bash
brew install npm pyenv
pyenv install 3.11
cd model_server
pyenv local 3.11
python3 -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 開発ロードマップ

#### 現在の機能
- Python関数・クラス・メソッドの自然言語検索
- インクリメンタルインデックス更新
- Apple Silicon対応
- クラス構造の可視化
- フィルタ・統計表示

#### 今後の予定
- 多言語対応（JavaScript, TypeScript, Java, C++など）
- CUDA/GPU対応
- VS Code Marketplace公開
- ファイル保存時の自動更新
- クラス継承図の表示

### ライセンス

MIT License - 詳細は[LICENSE](LICENSE)をご覧ください。

---

<div align="center">

**⚡ Made with ❤️ for developers who love efficient code navigation**

[⭐ Star this project](https://github.com/shun0212/OwlSpotLight) | [🐛 Report Issues](https://github.com/shun0212/OwlSpotLight/issues) | [💬 Discussions](https://github.com/shun0212/OwlSpotLight/discussions)

</div>