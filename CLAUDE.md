# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For end-user documentation (what it is, install, workflow, CLI reference, skill setup), see [README.md](./README.md). This file focuses on the architecture and conventions you need to be productive editing the code.

## Setup and commands

Toolchain pinned via `mise.toml` (Node 22, pnpm 10).

```bash
mise install            # one-time
pnpm install
pnpm dev                # starts Vite + the API middleware on 127.0.0.1:5173
pnpm typecheck          # tsc --noEmit
pnpm build              # tsc --noEmit && vite build
pnpm preview            # serve dist/
```

The CLI lives at `bin/mdr`. See README.md for installation; full command reference is in `mdr --help`.

## Architecture

### The single tricky problem: anchoring comments to source coordinates

Comments are stored as vi-style line/col coords on the *original markdown source*, but selection happens on the *rendered HTML*. The bridge:

1. **`src/lib/rehype-positions.ts`** — rehype plugin that walks the hast tree. It tags every Element that has source `position` info with `data-src-start` / `data-src-end` attributes (character offsets into the markdown source) and wraps every Text node outside `<pre>` blocks with `<span class="mdr-text" data-src-start data-src-end>`.
2. **`src/lib/selection.ts`** — converts a `window.getSelection()` Range to `{startLine, startCol, endLine, endCol, snippet}` by walking up to the nearest data-src-start ancestor and adding the offset within the text node.
3. **`src/lib/positions.ts`** — pure helpers: `buildLineStarts`, `offsetToLineCol`, `lineColToOffset`. The line-starts table is built per-render and reused for O(log n) coord conversion.
4. **`src/components/MarkdownRenderer.tsx`** — uses the **CSS Custom Highlight API** (`CSS.highlights.set(...)`) to paint precise sub-span highlights without DOM mutation. Wrapping spans only get `data-comment-ids` for click handling. Highlight names are `mdr-comment-open`, `mdr-comment-resolved`, `mdr-comment-orphan`, `mdr-comment-active`; styles are in `src/styles.css` under `::highlight(...)`.

If you need to change selection or highlight behavior, those four files are the entire surface.

### Round-trip format

`src/lib/export.ts` and `src/lib/import.ts` are the canonical implementations of the comment-footer format. Both the React app *and* the API middleware import them — do not duplicate the parser or you'll drift. The footer format:

```
<doc body>

--- THIS IS A COMMENT FROM MARKDOWN REVIEWER, DO NOT MODIFY ---

<startLine>/<startCol>:<endLine>/<endCol>: UNRESOLVED|RESOLVED

Me: <text>

Claude: <text>

-----
```

`parseImport` takes the round-trip markdown plus an array of existing comments. It diffs by `(startLine,startCol,endLine,endCol)` to preserve comment IDs across rounds. The re-anchor algorithm in `relocate()` walks several strategies in order:

1. Snippet still at original coords → keep.
2. Snippet appears uniquely in body → use it.
3. Snippet appears multiple times → score each occurrence by common-affix length with stored `contextBefore`/`contextAfter` (each up to ~30 chars), pick best.
4. Snippet missing but contextBefore tail or contextAfter head still locates uniquely → anchor by context, treat the slice between as the new snippet text.
5. Nothing matches → status becomes `"orphaned"` if the comment was UNRESOLVED, or `"applied"` if it was RESOLVED (so the rendered highlight is suppressed instead of pointing at unrelated text).

### Backend: Vite middleware + flat-file storage

`vite-api.ts` is a Vite plugin (`apiPlugin()`) added to `vite.config.ts`. There is no separate backend process — the API runs inside the Vite dev server. Data lives at `~/.markdown-reviewer/docs/<slug>.json` (override with `MARKDOWN_REVIEWER_DATA_DIR`), one file per doc containing the full `FullDoc` shape.

Routes:
- `GET /api/docs` — list (returns `DocSummary[]`)
- `POST /api/docs?slug=<optional>` — create from raw markdown (body in request body)
- `GET /api/docs/:slug` — content negotiation: returns `text/markdown` (body + footer) by default, or JSON `FullDoc` with `Accept: application/json`
- `PUT /api/docs/:slug` — replace from raw markdown; respects `If-Unmodified-Since` for optimistic locking
- `PATCH /api/docs/:slug` — JSON `{body?, title?, comments?}` for granular React-app edits
- `DELETE /api/docs/:slug`
- `GET /api/docs/:slug/status` — cheap polling endpoint
- `GET /api/events` — Server-Sent Events stream of `{type: created|updated|deleted, slug, updatedAt, lastEditor}`

`X-Md-Reviewer-Editor` request header (`me` | `claude`) records who last touched the doc. The React app sends `me`; PUT defaults to `claude`; PATCH defaults to `me`. The soft lock fires only when `existing.lastEditor === "me"` AND the current PUT is from claude AND the doc was edited after `If-Unmodified-Since` — returns `409` with the current state in the body so the caller can re-pull and merge.

### Frontend: API-driven, SSE-refreshed

`src/lib/api-client.ts` wraps fetch. `src/App.tsx` holds `docs: DocSummary[]`, `activeSlug`, `activeDoc: FullDoc`, subscribes to `/api/events` via `EventSource`, and re-fetches the active doc on any matching event. Comment mutations from the UI go through `patchDoc()`.

`localStorage` keys (UI preferences only — never doc data):
- `mdr:sidebarWidth` / `mdr:sidebarVisible` — left panel
- `mdr:docOrder` — JSON `string[]` of slugs, the user's manual sidebar order; missing slugs render at the top in `updatedAt` DESC fallback
- `mdr:railWidth` / `mdr:railVisible` — right comment panel
- `mdr:viewMode` — `"rendered"` or `"raw"`
- `mdr:collapsed:<slug>` — `Record<commentId, boolean>` per doc
- `mdr:commentFilter` — single-select rail filter tab (`"all"` | `CommentStatus`)

### Routing

The app uses path-based routing without any router library. `src/App.tsx`:
- Reads `window.location.pathname` on mount; URL slug wins, otherwise the most-recently-updated doc is opened (root URL always lands on the latest)
- `pushState`s the path whenever `activeSlug` changes
- Listens to `popstate` so browser back/forward switches docs

Sidebar entries are real `<a href="/<slug>">` anchors with a modifier-aware onClick — plain clicks stay SPA, but cmd / ctrl / shift / alt / middle clicks pass through to the browser so docs open in new tabs naturally.

Vite's dev server's SPA fallback handles `/api/`-not-prefixed unknown paths by serving `index.html`.

### Build version

`vite.config.ts` runs `git rev-parse --short HEAD` at startup and exposes the result as the global `__MDR_VERSION__` via Vite's `define`. The toolbar renders it as a link to the GitHub commit so any browser tab tells you which build it's running. Falls back to `"dev"` if git isn't available.

### Mobile and responsive layout

`src/lib/use-media-query.ts` provides `useIsDesktop()` (≥ 768px). Below that, both side panels are rendered as fixed drawers (`translate-x-full` / `-translate-x-full` when closed) instead of inline flex children. The Resizer component is hidden. The selection-to-comment popover is replaced by a bottom-anchored `MobileSelectionBar` that doesn't fight the OS context menu for screen space. Visibility persistence is desktop-only — mobile drawer toggles never overwrite the persisted desktop preference.

### Type vocabulary

`src/types.ts` defines three doc shapes — be careful which one a function consumes:
- `Doc` — id, slug, title, body, timestamps. The bare doc.
- `FullDoc extends Doc` — adds `comments: Comment[]` and `lastEditor`. What `getDoc` and `patchDoc` return.
- `DocSummary` — slug, title, comment counts, lastEditor, updatedAt. What `listDocs` returns.

`Editor` is `"me" | "claude"`. `CommentStatus` is `"open" | "resolved" | "applied" | "orphaned"`.

A `CommentAnchor` carries `startLine` / `startCol` / `endLine` / `endCol` (1-based, vi-style), the `snippet` string, and optional `contextBefore` / `contextAfter` (each up to ~30 chars) used for re-anchoring across edits.

### Skill

The Claude Code skill is the source of truth at `skills/markdown-reviewer/SKILL.md` in this repo. Users symlink it into `~/.claude/skills/markdown-reviewer` (see README). **If you change the API surface or the round-trip footer format, update this skill in the same commit** — anyone with the symlink installed picks up the new instructions immediately.

## Things that are deliberately simple

- No tests yet. Add them only if a regression actually bites.
- No backend process. The Vite plugin owns both routing and persistence.
- No router. Single-page app, single active doc at a time.
- Auth = none. The server binds `127.0.0.1` (in `vite.config.ts`); do not change that to `0.0.0.0` without adding auth.
- Data is plain JSON files. `cat ~/.markdown-reviewer/docs/<slug>.json` to debug state.

## Editing-related conventions

- Don't introduce abstractions ahead of need (YAGNI). The codebase has had multiple successful "add an X column to Y endpoint" changes done in 5–20 lines; resist refactors that don't buy something concrete.
- Comments in code: only when the *why* is non-obvious (a hidden constraint, a workaround). Don't narrate the *what* — the names already do that.
- The user prefers to drive their own browser verification — do not invoke Playwright MCP tools for testing UI changes without explicit consent.

## Gotchas worth remembering

- **`vite-api.ts` is plugin code** — Vite loads it once at server boot, not via HMR. Any change to the middleware requires the user to restart `pnpm dev`.
- **Remark plugins that synthesize new nodes can drop `position` metadata.** We learned this with `remark-breaks` (uses `mdast-util-find-and-replace`, which creates split text fragments without `position`). The `rehype-positions` plugin then skips wrapping those fragments → highlights clip to the first source line of multi-line paragraphs. Before adding any new remark plugin, verify it preserves `position` on synthesized nodes, or write a position-patch step that runs before `rehype-positions`.
- **HTTP `Last-Modified` is second-precision only (RFC 7232).** `If-Unmodified-Since` round-trips therefore lose the millisecond. The 409 lock comparison in `vite-api.ts` floors both sides to seconds — don't change that without re-introducing the false-positive bug.
- **`mdr backfill <slug>`** is the rescue command for legacy comments without `contextBefore`/`contextAfter`. It populates context from the current body and re-PUTs to give orphans another shot at re-anchoring.
