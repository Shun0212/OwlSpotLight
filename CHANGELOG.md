# Change Log

## Claude Code 対応 / Claude Code support (2026-06-22)
- Agent Setup から Claude Code の MCP サーバーを直接登録・解除できるようになりました（`claude mcp add` / `claude mcp remove`）。
- Added one-click Claude Code MCP registration/removal to **Generate Agent Setup**.
- 同梱の Agent Skill `.claude/skills/owlspotlight/SKILL.md` を追加し、Claude Code が OwlSpotlight の検索ツールを優先的に使うよう案内します。
- Bundled an Agent Skill at `.claude/skills/owlspotlight/SKILL.md` so Claude Code knows when to use `owlspotlight.search_code` over plain grep.

## モデル大幅アップデート (2025-06-21)
- AIモデルを刷新し、検索精度が大幅に向上しました！

## Major Model Update (2025-06-21)
- The AI model has been upgraded for significantly improved search accuracy!

All notable changes to the "owlspotlight" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Initial release
