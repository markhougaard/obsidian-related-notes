# CLAUDE.md — obsidian-relevant-notes

## What this is

A patched fork of [obsidian-related-notes](https://github.com/dlnorman/obsidian-related-notes), an Obsidian plugin that finds semantically related notes using local AI embeddings via Ollama.

The upstream plugin only supports unauthenticated local Ollama. This fork adds:
- Bearer token auth so it can reach a remote, token-protected Ollama instance
- Live settings propagation (URL / model / token changes apply without reloading the plugin)
- HTML stripping in preprocessing to handle heavy web-clipping notes
- Better Safe Mode fallback for notes that exceed the model's context window

## Target setup

| Component | Value |
|---|---|
| Obsidian vault | `/Users/markhougaard/Library/Mobile Documents/iCloud~md~obsidian/Documents/marks/` |
| Ollama endpoint | `https://ollama.marks.dk` |
| Embedding model | `nomic-embed-text` |
| Auth | Bearer token (stored in Obsidian plugin settings, not here) |

The Ollama instance runs on the same Hetzner VPS (in Docker), fronted by Caddy which enforces bearer-token auth on all `/api/*` routes.

## File layout

```
obsidian-relevant-notes/
  main.ts              ← plugin entry point + settings UI
  ollama_client.ts     ← HTTP calls to Ollama (auth, safe-mode fallback)
  semantic_search.ts   ← vector store, preprocessing, indexing, similarity
  view.ts              ← sidebar panel UI (upstream, unmodified)
  esbuild.config.mjs   ← build config (outfile changed to main.js at root)
  package.json
  tsconfig.json
  main.js              ← built plugin (deploy this)
  manifest.json        ← deploy this alongside main.js
```

## Building

```bash
cd /root/obsidian-relevant-notes
npm install          # first time only
npm run build        # produces main.js in this directory
```

## Deploying to Obsidian

From your laptop, SCP the two plugin files:

```bash
mkdir -p "/Users/markhougaard/Library/Mobile Documents/iCloud~md~obsidian/Documents/marks/.obsidian/plugins/obsidian-related-notes/"

scp root@<server-ip>:/root/obsidian-relevant-notes/{main.js,manifest.json} \
  "/Users/markhougaard/Library/Mobile Documents/iCloud~md~obsidian/Documents/marks/.obsidian/plugins/obsidian-related-notes/"
```

Then in Obsidian: disable → re-enable the plugin (or reload Obsidian) to pick up the new build.

## Changes from upstream

### `ollama_client.ts`
- `OllamaConfig` gains `bearerToken?: string`
- Constructor strips trailing slashes from `baseUrl`
- `authHeaders()` helper builds `Content-Type` + optional `Authorization` header
- `setBearerToken()`, `setBaseUrl()`, `setModel()` setters for live updates
- All POST `requestUrl` calls use `authHeaders()`
- `testConnection()` includes auth header on GET
- Context-length 500 errors now trigger Safe Mode immediately (no retry delay)
- Safe Mode strips HTML tags before truncating to 2 000 chars

### `semantic_search.ts`
- `setBearerToken()`, `setBaseUrl()`, `setModel()` passthroughs to `OllamaClient`
- `preprocessContent()` strips HTML tags and decodes common HTML entities — web clippings can be extremely token-dense raw HTML; stripping reduces token count without losing readable text

### `main.ts`
- `RelatedNotesSettings` gains `bearerToken: string` (default `''`)
- `bearerToken` passed into `OllamaConfig` at startup
- Settings UI: Bearer token field added between Ollama URL and Embedding Model
- Ollama URL and Embedding Model `onChange` handlers call `setBaseUrl()` / `setModel()` for live propagation (upstream saved to disk but didn't update the running client)

### `esbuild.config.mjs`
- `outfile` changed from `dist/main.js` to `main.js` so the build drops next to `manifest.json`

## Known issues / future work

- The upstream repo uses `nomic-embed-text` against the `/api/embeddings` endpoint. Newer Ollama versions prefer `/api/embed` with a different request/response shape. If the model is upgraded, the endpoint and response parsing may need updating.
- Notes that fail all three embedding attempts (full → safe mode → title only) are skipped silently (logged to console). There is no UI indication of which notes were not indexed.
