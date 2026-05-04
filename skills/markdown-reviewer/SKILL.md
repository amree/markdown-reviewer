---
name: markdown-reviewer
description: Push a markdown plan to the local Markdown Reviewer app for human comments, then pull it back and resolve them. Use when the user asks to "send for review", "open in markdown reviewer", "pull my comments", "address my feedback in the reviewer", or after generating any plan/spec/design doc you want comments on.
---

# Markdown Reviewer

A local web app at http://127.0.0.1:5173 where the user reviews markdown plans and adds threaded comments anchored to specific spans of text. Use the `mdr` CLI (or raw `curl`) to push docs in and pull them out with comments attached.

## When to use

- The user asks to "send this for review", "open in markdown reviewer", or similar.
- You just produced a long plan / spec / design doc and the user wants to comment on it before you proceed.
- The user says they have comments waiting for you in the reviewer.

## Workflow

### 1. Push the doc

**You do this yourself via Bash — do not ask the user to run mdr.** They asked you to send it; sending it is your job.

If the plan already exists as a file:

```bash
mdr push plan.md
# slug defaults to the filename without extension; override with --slug NAME
```

If the plan only exists in this conversation (you just generated it and there is no file yet), pipe it to stdin — pick a slug yourself from the topic:

```bash
mdr push - --slug api-migration-v2 <<'PLAN_EOF'
# API Migration v2

## Context
...
PLAN_EOF
```

Or, if you need the file on disk for other reasons (the user may want to edit it locally), use the Write tool to save it first, then `mdr push <file>`.

Raw curl works the same way:

```bash
curl -X PUT --data-binary @plan.md \
  -H 'Content-Type: text/markdown' \
  -H 'X-Md-Reviewer-Editor: claude' \
  http://127.0.0.1:5173/api/docs/<slug>
```

The response is JSON `{slug, openComments, updatedAt, lastEditor}`. **Save the `updatedAt` value** — you'll need it to detect concurrent edits when you push back. Note the URL: `http://127.0.0.1:5173`.

Tell the user: "Pushed to the reviewer at http://127.0.0.1:5173 — let me know when you're done commenting." Then stop and wait, OR if they want you to block:

```bash
mdr watch <slug>     # exits 0 when openComments == 0
```

### 2. Pull the doc with comments — ALWAYS pull to a file

The comment footer is **only in the API response**, never in any file on disk. So if you need to Edit the doc to address comments, you must first save the pulled response to a file and operate on that file. Don't try to Edit the original source file the user gave you — it doesn't have the footer.

Always use `--out` (or shell redirect) to land it on disk:

```bash
mdr pull <slug> --out /tmp/<slug>.md
# or:  mdr pull <slug> > /tmp/<slug>.md
```

Then `Read` `/tmp/<slug>.md` to see the body + footer. The output looks like:

```
<the original markdown body>

--- THIS IS A COMMENT FROM MARKDOWN REVIEWER, DO NOT MODIFY ---

5/61:5/101: UNRESOLVED

Me: <reader's comment>

-----

12/36:12/61: RESOLVED

Me: <comment>

Claude: <previous reply if any>

-----
```

Coordinates are vi-style: `startLine/startCol:endLine/endCol`, 1-based. The `Last-Modified:` header that `mdr pull` prints to stderr is the timestamp to pass to `--if-unmodified-since` on push.

**Doc-level (global) comments** use the sentinel anchor `0/0:0/0` — a deliberate non-coordinate since real markdown is 1-based. The reader emits these for feedback that doesn't tie to a specific span ("the overall structure is wrong", "this whole section is missing X"). Treat them like any other comment: reply by appending a `Claude:` line, or address the feedback in the body and mark `RESOLVED`. You can also author a global comment yourself by adding a block with header `0/0:0/0: UNRESOLVED` and a `Claude:` body.

### 3. Address every UNRESOLVED comment first

Edit the file you just wrote (`/tmp/<slug>.md`) using the Edit tool. For each `UNRESOLVED` block, choose ONE:

a) **Reply only**: append a new `Claude: <your reply>` line to that block, separated from the previous message by a blank line. Keep status `UNRESOLVED` so the reader can respond.

b) **Apply the change**: edit the document body above the footer to address the comment, then update that comment's header from `UNRESOLVED` to `RESOLVED`. Do not delete the comment block.

Only after every UNRESOLVED comment is handled should you make additional edits to the document body.

**Format rules — preserve exactly**:
- The sentinel line `--- THIS IS A COMMENT FROM MARKDOWN REVIEWER, DO NOT MODIFY ---`
- The `<line>/<col>:<line>/<col>: <UNRESOLVED|RESOLVED>` headers
- The `-----` separators between blocks
- All existing `Me:` lines (do not edit or remove)
- Existing `Claude:` lines from prior turns (do not edit; you may add new ones)

### 4. Push the updated doc back

```bash
mdr push /tmp/<slug>.md --slug <slug> --if-unmodified-since "<Last-Modified-from-step-2>"
```

Pass `--slug <slug>` explicitly if the file is in `/tmp` and its filename doesn't match the slug. The `If-Unmodified-Since` header tells the server "fail if the user added more comments since I pulled". On success, the JSON response shows the new `openComments` count. On `409 Conflict`, the user added more comments while you were thinking — re-pull, merge in their additions, and push again.

## Discovering existing docs

```bash
mdr ls                # tabular list: slug, open count, total count, last editor, title
mdr status <slug>     # JSON status for one doc
```

## Slug rules

- Default slug: filename without extension, kebab-cased (`API Migration v2.md` → `api-migration-v2`).
- Pass `--slug foo` on push to override.
- Slugs are URL-safe identifiers and the persistent file key.

## Environment

- App URL: `http://127.0.0.1:5173` (override with `MDR_BASE`).
- Data directory: `~/.markdown-reviewer/docs/<slug>.json`.
- App must be running (`pnpm dev` from the `markdown-reviewer` repo).

## What NOT to do

- Don't modify or delete `Me:` lines — those are the reader's words.
- Don't change line/col numbers in comment headers (they're the anchor; the app re-snaps to text via snippet matching, but only if structure is intact).
- Don't wrap your push payload in code fences. Push raw markdown.
- Don't push a doc you haven't pulled at least once if it already exists — you'd overwrite the user's comments. Pull first, then push.
