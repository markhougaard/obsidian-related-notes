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
| Chat model | `llama3.2:3b` (swapped from `llama3.1:8b` 2026-02-18) |
| Auth | Bearer token (stored in Obsidian plugin settings, not here) |

The Ollama instance runs on the same Hetzner VPS (in Docker), fronted by Caddy which enforces bearer-token auth on all `/api/*` routes.

**Claude Code runs directly on the VPS** (`/home/mark/obsidian-related-notes`), so `docker exec` commands work without SSH. The Ollama container is named `ollama`.

## File layout

```
obsidian-relevant-notes/
  main.ts              ← plugin entry point + settings UI
  ollama_client.ts     ← HTTP calls to Ollama (auth, safe-mode fallback)
  semantic_search.ts   ← vector store, preprocessing, indexing, similarity
  view.ts              ← sidebar panel UI (explain button streams live)
  esbuild.config.mjs   ← build config (outfile changed to main.js at root)
  package.json
  tsconfig.json
  main.js              ← built plugin (deploy this)
  manifest.json        ← deploy this alongside main.js
```

## Building

```bash
cd /home/mark/obsidian-related-notes
npm install          # first time only
npm run build        # produces main.js in this directory
```

## Deploying to Obsidian

From your laptop, SCP the two plugin files:

```bash
mkdir -p "/Users/markhougaard/Library/Mobile Documents/iCloud~md~obsidian/Documents/marks/.obsidian/plugins/obsidian-related-notes/"

scp root@188.245.250.0:/home/mark/obsidian-related-notes/{main.js,manifest.json} \
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
- `generateCompletion()` uses native `fetch()` + SSE `ReadableStream` instead of `requestUrl()`
  so the chat endpoint can stream. `onChunk?(accumulated)` callback receives the full text so
  far after each token so callers can call `element.setText(text)` without their own buffer.

### `semantic_search.ts`
- `setBearerToken()`, `setBaseUrl()`, `setModel()` passthroughs to `OllamaClient`
- `preprocessContent()` strips HTML tags and decodes common HTML entities — web clippings can be extremely token-dense raw HTML; stripping reduces token count without losing readable text
- `explainRelationship()` accepts optional `onChunk` and threads it through to `generateCompletion`

### `view.ts`
- Explain button passes `(text) => explanationEl.setText(text)` as `onChunk`; text streams live
  into the sidebar as tokens arrive instead of waiting for the full response

### `main.ts`
- `RelatedNotesSettings` gains `bearerToken: string` (default `''`)
- `bearerToken` passed into `OllamaConfig` at startup
- Settings UI: Bearer token field added between Ollama URL and Embedding Model
- Ollama URL and Embedding Model `onChange` handlers call `setBaseUrl()` / `setModel()` for live propagation (upstream saved to disk but didn't update the running client)

### `esbuild.config.mjs`
- `outfile` changed from `dist/main.js` to `main.js` so the build drops next to `manifest.json`

## Gotchas

### Obsidian fetch vs requestUrl — CORS
Obsidian's `requestUrl()` runs in Electron's **main process** (Node.js) and is never subject to
CORS. Native `fetch()` runs in the **renderer** and IS subject to CORS — the browser enforces
preflight checks even for localhost-like origins.

Rule: use `requestUrl` for all fire-and-forget calls; use `fetch` only when you need streaming
(ReadableStream). Any `fetch` call to a remote host requires CORS headers on the server.

### Caddy CORS for Obsidian streaming
When adding CORS support to a Caddy reverse proxy that also enforces bearer-token auth:

1. **Preflight must bypass auth** — browsers strip `Authorization` from OPTIONS requests by
   design. The `@preflight method OPTIONS` block must appear *before* the `@unauthorized` check.

2. **Strip the upstream header to avoid duplicates** — Ollama returns its own
   `Access-Control-Allow-Origin`. Add `header_down -Access-Control-Allow-Origin` inside the
   `reverse_proxy` block so Caddy's site-level header is the only one.

3. **Origin must be `app://obsidian.md`** — that is the Electron origin Obsidian uses; `*`
   also works but is less precise.

Verified working config snippet in `/opt/multisite/caddy/Caddyfile` (ollama.marks.dk block).

### Ollama model management
The Ollama Docker container (`ollama`) can hold **two models at once** given current VPS RAM:
`nomic-embed-text` (274 MB) + one chat model. To swap the chat model, remove the old one
first to stay within the limit, then pull the new one:

```bash
docker exec ollama ollama rm <old-model>
docker exec ollama ollama pull <new-model>
docker exec ollama ollama list   # verify
```

Then update **Chat Model** in Obsidian → Settings → Related Notes (propagates live, no reload).

### Docker access for Caddy reloads
`/opt/multisite/caddy/Caddyfile` is owned by root. Mark is in the `docker` group (added via
`sudo usermod -aG docker mark`). To reload Caddy after editing the Caddyfile:
```bash
docker compose -f /opt/multisite/caddy/docker-compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
```

## Known issues

- The upstream repo uses `nomic-embed-text` against `/api/embeddings`. Newer Ollama versions
  prefer `/api/embed` with a different request/response shape. If the model is upgraded, the
  endpoint and response parsing may need updating.
- Notes that fail all three embedding attempts (full → safe mode → title only) are skipped
  silently (logged to console). There is no UI indication of which notes were not indexed.

## Feature ideas

### Non-obvious connection surfacing (high interest)
- **Sentiment/tone contrast** — embed an LLM call that scores each note's emotional valence
  (positive / negative / mixed). Surface pairs where two semantically similar notes take
  opposite stances (e.g. one optimistic, one cautionary about the same topic).
- **Concept bridging** — a second-pass LLM prompt that looks for *latent shared concepts*
  between two notes that share a high cosine score but low lexical overlap. The existing
  `explainRelationship` prompt is close; a dedicated "what hidden concept links these?" prompt
  would be more targeted.
- **Contradiction detection** — prompt the LLM with both note excerpts and ask: "Do these
  notes make conflicting claims?" Flag pairs where the model says yes.
- **Multi-hop chains** — for a note A, find B most related to A, then C most related to B but
  NOT closely related to A. Surface A→B→C as an indirect/surprising connection.

### Discoverability improvements
- **Cluster view** — project embeddings to 2D (t-SNE or UMAP via a small WASM lib) and render
  an interactive scatter plot in the sidebar so users can see how the whole vault clusters.
- **Knowledge gap detection** — find topics that appear frequently across many notes but have
  no dedicated note of their own; prompt the LLM to name the concept.
- **"Why diverge" explanation** — companion to "why related": for two notes the user expects
  to be related but which score low, explain what makes them different.

### UX
- **Explain on hover** — generate the explanation preemptively when the user hovers over a
  related note (with a short delay) so clicking "···" is instant.
- **Cached explanations** — store generated explanations in a sidecar JSON file keyed by
  `(fileA.path, fileB.path, mtime pair)` so re-opening the same note doesn't re-generate.
- **Indexing failure UI** — show a small warning badge on notes that failed all embedding
  attempts, linking to the console error.
