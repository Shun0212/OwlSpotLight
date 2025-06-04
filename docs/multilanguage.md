# Multi-language Project Strategy

This project currently has documentation in both English and Japanese. To keep translations organized and easier to maintain as we add more languages, use the following structure:

```
├── docs
│   ├── en
│   │   └── README.md       # English documentation
│   ├── ja
│   │   └── README.md       # Japanese documentation
│   └── ... (other languages)
```

Each language gets its own folder under `docs/` where language-specific files live. Additional resources (images, diagrams) referenced from these documents should go in the same language folder.

For small pieces of text that appear in the UI (for example, messages shown in the extension), store translations in JSON files under `locales/<language>.json`. Loading localized strings at runtime allows us to keep the codebase language-agnostic.

By separating language assets, we avoid mixing content and make it easier for contributors to update translations without affecting other languages.

## Language-specific Indexes

When your workspace contains source files from multiple languages (e.g. both Python and Java), OwlSpotlight keeps a separate search index for each language. These indexes are stored under:

```
.owl_index/<workspace>/<language>
```

where `<language>` is `py` or `java`. This prevents the embeddings from one language from overwriting the other. If you switch languages in the sidebar, the server automatically loads the correct index from this directory.
