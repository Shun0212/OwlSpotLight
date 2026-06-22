---
name: owlspotlight
description: >-
  Local semantic code search for this repository via the OwlSpotlight MCP server,
  powered by the purpose-built NightOwl-CodeEmbedding model. Use it to locate code
  by behavior or intent, to trace call flow and FastAPI routes without reading whole
  files, and to semantically search only your git-changed files. Reach for it BEFORE
  grep/ripgrep when the exact symbol name is unknown. Natural-language queries in
  English or Japanese. Tools: owlspotlight.search_code, owlspotlight.grep_repo,
  owlspotlight.mark_results_used, owlspotlight.cancel_embedding, owlspotlight.get_human_feedback.
---

# OwlSpotlight: code-investigation playbook

OwlSpotlight is not a generic chunk search. Its retrieval runs on
**NightOwl-CodeEmbedding**, a code-specific embedding model, and every result it
returns carries **structured Python metadata** — the symbol kind, FastAPI route,
and the local **call graph** (`calls=…`). Lean on that structure: it lets you
*navigate* a codebase, not just locate a string.

The point of this skill is **how to chain those capabilities into real
investigation tasks** — not to restate the tool's parameters (the MCP schema
already documents those).

## How to query (this model rewards intent)

Because the embedding model is trained for code, describe **what the code does**,
not a guessed identifier:

- Good: `"where the login session is refreshed after token expiry"`
- Weak: `"refresh"` / `"session"` (use those only in `keyword`/`bm25` mode)

If the top result is weak, **re-query with different wording** rather than giving
up — the response suggests follow-up phrasings. Queries work in English or
Japanese (`"埋め込みモデルをロードしている箇所"`).

`search_mode`: `semantic` (default, intent) · `hybrid` (intent + lexical, good
all-rounder) · `bm25` / `keyword` (when you actually know the literal token).

## Recipe 1 — Trace a flow without reading whole files

This is OwlSpotlight's signature move. Each result lists `calls=…` and, for web
handlers, `route=METHOD /path`. Use them to walk the code structure:

1. `search_code` for the entry behavior — e.g. `"handle an incoming search request"`.
2. In the result, read `route=` to confirm the endpoint and `calls=` to see what
   it delegates to.
3. **Search for the next hop by name** instead of opening the file: feed a callee
   from `calls=` back into `search_code` (or `grep_repo` if the name is exact).
4. Repeat until you've reconstructed the path. Only open files at the points you
   actually need to read or edit.

This reconstructs control flow far faster than reading files top-to-bottom.

## Recipe 2 — Understand or review only what changed

`scope: "changed"` restricts semantic search to git-changed + untracked files —
ideal for reviewing your own diff or a PR:

- `search_code({ "query": "<the behavior you touched>", "scope": "changed" })`
- Good for: "summarize what my change affects", "did my edit introduce a second
  code path for X", pre-push self-review.
- Pair with `scope: "source"` (auto-detected source dirs only) to cut test/vendor
  noise on a broad concept search.

## Recipe 3 — Locate, then verify exhaustively

1. **Discover** with `search_code` (semantic / intent).
2. **Read** the top candidate regions — the ranking is a lead, not a verdict.
3. **Verify** every reference / call site with `grep_repo` once you know the exact
   identifier. OwlSpotlight auto-links the grep to the preceding search, so prefer
   it over plain Grep when you want that lineage. Patterns containing `|` are
   treated as regex alternation (`registerCodexMcp|registerClaudeMcp`).
4. Scope noisy repos on either tool with
   `include_globs` / `exclude_globs`, e.g.
   `{"include_globs":["src/**/*.ts"],"exclude_globs":["**/*.test.ts"]}`.

## Close the loop: mark_results_used

After you've relied on results as evidence, call `owlspotlight.mark_results_used`
with the `event_id` from the search/grep and the `referenced_ranks` (or
`referenced_locations`) you actually used. **This is not bookkeeping** — it writes
training examples that improve NightOwl-CodeEmbedding for this repo. Treat it as
the default final step of an investigation; skip only when it would materially
block the task.

Human sidebar suggestions (`get_human_feedback`) are **optional observability** —
do not wait on them. Only read them when the user says they added some.

## CodeBlocks

OwlSpotlight also indexes **top-level Python logic** (code outside any
function/class) as `CodeBlock` symbols — module init, config wiring, script bodies
that grep-by-name can't conceptualize. Expect and use these in results when the
behavior you want lives at module scope.

## Preconditions & fallback

The `owlspotlight.*` tools require the local server running (VS Code sidebar
**Setup / Start**, listening on `http://127.0.0.1:8000`) and the MCP registered
(`OWLSPOTLIGHT_WORKSPACE` pointing at the repo lets you omit `directory`).

- If `search_code` is **not in your tool list**: don't reverse-engineer the HTTP
  API. Tell the user the MCP client needs a reload, or the server isn't started,
  then fall back to Grep/Read.
- If a search errors with connection refused: the local server isn't started —
  say so instead of retrying blindly.

## Don't

- Don't restate this skill back to the user as setup steps when the tool is
  already available — just use it.
- Don't lead with a wide `grep`/`rg` for a concept you could describe to
  `search_code`.
- Don't run `command -v owlspotlight`, read `mcp_server.py`, or inspect `.mcp.json`
  to "figure out the API" when the tool is in your list.
- Don't block autonomous search waiting on human feedback.
