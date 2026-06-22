---
name: owlspotlight
description: >-
  Local semantic code search for this repository via the OwlSpotlight MCP server.
  Use BEFORE grep/ripgrep whenever locating code by behavior or intent — finding
  functions, methods, classes, Python CodeBlocks, FastAPI routes, handlers, tests,
  or auth/session/storage logic when the exact name is unknown. Works for natural-language
  queries in English or Japanese. Tools: owlspotlight.search_code, owlspotlight.grep_repo,
  owlspotlight.cancel_embedding, owlspotlight.mark_results_used, owlspotlight.get_human_feedback.
---

# OwlSpotlight semantic code search

OwlSpotlight indexes this repository with a code-embedding model and exposes
semantic + lexical search over a local MCP server (`owlspotlight.*` tools). It is
faster and more precise than blind grepping when you are looking for code by what
it *does* rather than by an exact identifier you already know.

## When to use this

Reach for `owlspotlight.search_code` first when:

- The user describes behavior, intent, or a concept ("where is the login session
  refreshed", "the code that parses the index manifest") and you don't know the
  symbol name.
- You need to find routes, handlers, methods, classes, or top-level code blocks
  and aren't sure where they live.
- You'd otherwise start with a broad `grep`/`rg` sweep across the repo to discover
  candidates.

Use plain `grep_repo` (or Grep) **after** semantic discovery, once you know the
exact identifier and want exhaustive references / call sites.

Skip OwlSpotlight when you already have an exact path+line, or the task is not
about locating code (e.g. editing a known file, running tests).

## Preconditions

The MCP tools only work when:

1. The OwlSpotlight **server is running** — started from the VS Code sidebar
   (**Setup / Start**) or `OwlSpotlight: Start Server`. It listens on
   `http://127.0.0.1:8000` by default.
2. The MCP server is **registered** with Claude Code (`claude mcp add owlspotlight …`,
   or a project `.mcp.json` at the repo root). `OWLSPOTLIGHT_WORKSPACE` should point
   at the repository so `directory` can be omitted.

If `owlspotlight.search_code` is **not** in your available tool list, do not try to
reverse-engineer it: tell the user the MCP client needs to reload/restart after
registering OwlSpotlight (or that the server isn't started yet). Only fall back to
plain Grep/Read after saying the tool is unavailable.

If a search returns an error like connection refused, the local server is likely
not started — say so rather than retrying blindly.

## Workflow

1. **Discover** with `owlspotlight.search_code({ "query": "<behavior or intent>" })`.
   Only `query` is required; `directory` defaults to the workspace, `file_ext`
   defaults to `auto`, `search_mode` to `semantic`, `top_k` to `30`.
2. **Read** the top candidate files around the returned line numbers before
   concluding — the ranking is a lead, not a verdict.
3. **Verify exhaustively** with `owlspotlight.grep_repo` once you know likely
   identifiers, to find every call site / reference. OwlSpotlight links the grep
   to the preceding search automatically.
4. *(Optional)* `owlspotlight.mark_results_used` to record the ranks or
   `file:line` locations you actually relied on. Only bother when it's cheap.
5. Do **not** block on human feedback. The sidebar mirrors agent activity for the
   user as observability; only call `owlspotlight.get_human_feedback` when the user
   explicitly says they added suggestions there.

## Tool reference

- **`owlspotlight.search_code`** — semantic / BM25 / hybrid / keyword search.
  - `query` (required): natural-language behavior, a likely identifier, a route/API
    term, or a code snippet.
  - `file_ext`: `auto` (default) | `.py` | `.java` | `.ts` | `.tsx` | `.js` | `.jsx`.
  - `search_mode`: `semantic` (default) | `bm25` | `hybrid` | `keyword`.
  - `scope`: `all` (default) | `source` | `changed` (git changed/untracked only).
  - `top_k`: 1–50 (default 30).
  - `include_globs` / `exclude_globs`: scope noisy repos, e.g.
    `{"include_globs":["src/**/*.ts"],"exclude_globs":["tests/**"]}`.
- **`owlspotlight.grep_repo`** — repo-wide grep that respects `.owlignore` + git
  ignore rules. `pattern` required; patterns containing `|` are treated as regex
  alternation when `regex` is omitted (e.g. `ClassA|ClassB|torch.multinomial`).
  Pass the same `include_globs`/`exclude_globs` to match a prior search's scope.
- **`owlspotlight.cancel_embedding`** — request cancellation of a running
  indexing/embedding job.
- **`owlspotlight.mark_results_used`** — record `referenced_ranks` /
  `referenced_locations` for an `event_id` returned by a search/grep.
- **`owlspotlight.get_human_feedback`** — read optional sidebar suggestions; only
  when the user says they entered some.

## Examples

```jsonc
// 1. Behavior-first discovery (name unknown)
owlspotlight.search_code({ "query": "where is the user login session refreshed" })

// 2. Scope to source TypeScript, skip tests
owlspotlight.search_code({
  "query": "incremental index file watcher",
  "include_globs": ["src/**/*.ts"],
  "exclude_globs": ["**/*.test.ts"]
})

// 3. Japanese query
owlspotlight.search_code({ "query": "埋め込みモデルをロードしている箇所" })

// 4. Exhaustive references after you know the symbol
owlspotlight.grep_repo({ "pattern": "registerCodexMcp|registerClaudeMcp" })
```

## Anti-patterns

- Don't run `command -v owlspotlight`, read `mcp_server.py`, or inspect `.mcp.json`
  to "figure out" the API when the tool is already in your list — just call it.
- Don't lead with a wide `grep`/`rg` for a concept you could describe to
  `search_code`.
- Don't wait for human feedback before continuing autonomous search.
