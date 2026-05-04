import { nanoid } from "nanoid";
import type {
  Comment,
  CommentAnchor,
  CommentStatus,
  Message,
} from "../types";
import {
  buildLineStarts,
  isGlobalAnchor,
  lineColToOffset,
  offsetToLineCol,
  snippetFromSource,
} from "./positions";
import { COMMENT_SENTINEL, COMMENT_SEPARATOR } from "./prompt";

const HEADER_RE = /^(\d+)\/(\d+):(\d+)\/(\d+):\s*(UNRESOLVED|RESOLVED)\s*$/;
const MSG_PREFIX_RE = /^(Me|Claude):\s?(.*)$/;

export interface ImportResult {
  body: string;
  comments: Comment[];
  orphanedCount: number;
}

export function deriveTitle(body: string): string {
  for (const line of body.split("\n", 30)) {
    const m = /^#\s+(.*\S)\s*$/.exec(line);
    if (m) return m[1];
  }
  const first = body.split("\n").find((l) => l.trim());
  return first?.trim().slice(0, 60) || "Untitled";
}

export function parseImport(
  input: string,
  docId: string,
  existingComments: Comment[],
): ImportResult {
  const sentinelIdx = input.indexOf(COMMENT_SENTINEL);
  const body =
    sentinelIdx === -1
      ? input.replace(/\s+$/, "")
      : input.slice(0, sentinelIdx).replace(/\s+$/, "");
  const footer = sentinelIdx === -1 ? "" : input.slice(sentinelIdx + COMMENT_SENTINEL.length);

  const blocks = splitBlocks(footer);
  const lineStarts = buildLineStarts(body);

  const existingByCoords = new Map<string, Comment>();
  for (const c of existingComments) {
    existingByCoords.set(coordKey(c.anchor), c);
  }

  let orphaned = 0;
  const out: Comment[] = [];
  for (const block of blocks) {
    const parsed = parseBlock(block);
    if (!parsed) continue;

    const { rawAnchor, headerStatus, messages } = parsed;
    const existing = existingByCoords.get(coordKey(rawAnchor));
    const priorAnchor = existing?.anchor;
    let status: CommentStatus = headerStatus === "RESOLVED" ? "resolved" : "open";

    const located = relocate(body, lineStarts, rawAnchor, priorAnchor);
    let anchor: CommentAnchor;

    if (located) {
      anchor = located;
    } else if (priorAnchor?.snippet) {
      // Snippet existed but couldn't be found anywhere meaningful.
      anchor = {
        ...rawAnchor,
        snippet: priorAnchor.snippet,
        contextBefore: priorAnchor.contextBefore,
        contextAfter: priorAnchor.contextAfter,
      };
      if (status === "resolved") {
        status = "applied";
      } else {
        status = "orphaned";
        orphaned++;
      }
    } else {
      // No prior history — populate from body at coords.
      const startOff = lineColToOffset(rawAnchor.startLine, rawAnchor.startCol, lineStarts, body);
      const endOff = lineColToOffset(rawAnchor.endLine, rawAnchor.endCol, lineStarts, body);
      anchor = {
        ...rawAnchor,
        snippet: snippetFromSource(body, startOff, endOff),
        contextBefore: body.slice(Math.max(0, startOff - 30), startOff),
        contextAfter: body.slice(endOff, Math.min(body.length, endOff + 30)),
      };
    }

    const now = new Date().toISOString();
    out.push({
      id: existing?.id ?? nanoid(),
      docId,
      anchor,
      status,
      messages,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  return { body, comments: out, orphanedCount: orphaned };
}

/**
 * Try to find where `priorAnchor`'s snippet now lives in `body`. Strategy:
 *   1. If the snippet is still verbatim at the requested coords, accept.
 *   2. If the snippet appears exactly once anywhere in body, use that.
 *   3. If the snippet appears multiple times, score each by how well its
 *      surrounding text matches the stored contextBefore/contextAfter and
 *      pick the best.
 *   4. If the snippet is gone but we have context, anchor by the nearest
 *      occurrence of the contextBefore tail (or contextAfter head) and
 *      treat the slice between them as the new snippet text.
 * Returns null if nothing meaningful matched.
 */
function relocate(
  body: string,
  lineStarts: number[],
  rawAnchor: { startLine: number; startCol: number; endLine: number; endCol: number },
  priorAnchor: CommentAnchor | undefined,
): CommentAnchor | null {
  // Doc-level (global) comments don't anchor to any selection — the 0/0:0/0
  // sentinel is preserved verbatim with empty snippet/context. Skipping the
  // snippet logic also prevents the body-derived fallback from leaking the
  // first 30 chars of the doc into contextAfter.
  if (isGlobalAnchor(rawAnchor)) {
    return {
      startLine: 0,
      startCol: 0,
      endLine: 0,
      endCol: 0,
      snippet: "",
      contextBefore: "",
      contextAfter: "",
    };
  }

  const startOff = lineColToOffset(rawAnchor.startLine, rawAnchor.startCol, lineStarts, body);
  const endOff = lineColToOffset(rawAnchor.endLine, rawAnchor.endCol, lineStarts, body);
  const sliceAtCoords = body.slice(startOff, endOff);

  // No prior snippet to chase — caller will fall back to body-derived defaults.
  if (!priorAnchor?.snippet) return null;
  const snippet = priorAnchor.snippet;
  const contextBefore = priorAnchor.contextBefore ?? "";
  const contextAfter = priorAnchor.contextAfter ?? "";

  // 1: original coords still hold.
  if (snippetMatches(sliceAtCoords, snippet)) {
    return {
      ...rawAnchor,
      snippet,
      contextBefore,
      contextAfter,
    };
  }

  // 2 & 3: snippet still in body somewhere.
  if (!snippet.endsWith("…")) {
    const occurrences = findAllOccurrences(body, snippet, 25);
    if (occurrences.length === 1) {
      return makeAnchor(occurrences[0], occurrences[0] + snippet.length, snippet, body, lineStarts);
    }
    if (occurrences.length > 1) {
      let bestOff = -1;
      let bestScore = -1;
      for (const off of occurrences) {
        const score = scoreContext(body, off, snippet.length, contextBefore, contextAfter);
        if (score > bestScore) {
          bestScore = score;
          bestOff = off;
        }
      }
      if (bestOff >= 0) {
        return makeAnchor(bestOff, bestOff + snippet.length, snippet, body, lineStarts);
      }
    }
  }

  // 4: snippet gone, anchor by surrounding context.
  const beforeAnchor = contextBefore.slice(-20).trimStart();
  const afterAnchor = contextAfter.slice(0, 20).trimEnd();

  if (beforeAnchor.length >= 6) {
    const occ = findAllOccurrences(body, beforeAnchor, 5);
    if (occ.length >= 1) {
      // Prefer the occurrence closest to the original startOff.
      const at = nearest(occ, startOff);
      const candidateStart = at + beforeAnchor.length;
      let candidateEnd = candidateStart + snippet.length;
      if (afterAnchor.length >= 6) {
        const tailAt = body.indexOf(afterAnchor, candidateStart);
        if (tailAt !== -1 && tailAt - candidateStart < snippet.length * 4 + 40) {
          candidateEnd = tailAt;
        }
      }
      candidateEnd = Math.min(body.length, Math.max(candidateStart + 1, candidateEnd));
      const newSnippet = snippetFromSource(body, candidateStart, candidateEnd);
      return makeAnchor(candidateStart, candidateEnd, newSnippet, body, lineStarts);
    }
  }

  if (afterAnchor.length >= 6) {
    const occ = findAllOccurrences(body, afterAnchor, 5);
    if (occ.length >= 1) {
      const at = nearest(occ, endOff);
      const candidateEnd = at;
      const candidateStart = Math.max(0, at - snippet.length);
      const newSnippet = snippetFromSource(body, candidateStart, candidateEnd);
      return makeAnchor(candidateStart, candidateEnd, newSnippet, body, lineStarts);
    }
  }

  return null;
}

function makeAnchor(
  start: number,
  end: number,
  snippet: string,
  body: string,
  lineStarts: number[],
): CommentAnchor {
  const sLC = offsetToLineCol(start, lineStarts);
  const eLC = offsetToLineCol(end, lineStarts);
  return {
    startLine: sLC.line,
    startCol: sLC.col,
    endLine: eLC.line,
    endCol: eLC.col,
    snippet,
    contextBefore: body.slice(Math.max(0, start - 30), start),
    contextAfter: body.slice(end, Math.min(body.length, end + 30)),
  };
}

function scoreContext(
  body: string,
  snippetOffset: number,
  snippetLen: number,
  contextBefore: string,
  contextAfter: string,
): number {
  if (!contextBefore && !contextAfter) return 0;
  const beforeWindow = body.slice(
    Math.max(0, snippetOffset - contextBefore.length),
    snippetOffset,
  );
  const afterWindow = body.slice(
    snippetOffset + snippetLen,
    Math.min(body.length, snippetOffset + snippetLen + contextAfter.length),
  );
  return (
    commonSuffixLength(beforeWindow, contextBefore) +
    commonPrefixLength(afterWindow, contextAfter)
  );
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

function commonSuffixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

function nearest(offsets: number[], target: number): number {
  let best = offsets[0];
  let bestDist = Math.abs(best - target);
  for (let i = 1; i < offsets.length; i++) {
    const d = Math.abs(offsets[i] - target);
    if (d < bestDist) {
      bestDist = d;
      best = offsets[i];
    }
  }
  return best;
}

function coordKey(a: { startLine: number; startCol: number; endLine: number; endCol: number }): string {
  return `${a.startLine}/${a.startCol}:${a.endLine}/${a.endCol}`;
}

function splitBlocks(footer: string): string[] {
  if (!footer.trim()) return [];
  const out: string[] = [];
  let buf: string[] = [];
  for (const line of footer.split("\n")) {
    if (line.trim() === COMMENT_SEPARATOR) {
      if (buf.some((l) => l.trim())) out.push(buf.join("\n"));
      buf = [];
    } else {
      buf.push(line);
    }
  }
  if (buf.some((l) => l.trim())) out.push(buf.join("\n"));
  return out;
}

interface ParsedBlock {
  rawAnchor: { startLine: number; startCol: number; endLine: number; endCol: number };
  headerStatus: "UNRESOLVED" | "RESOLVED";
  messages: Message[];
}

function parseBlock(block: string): ParsedBlock | null {
  const lines = block.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length) return null;

  const headerMatch = HEADER_RE.exec(lines[i].trim());
  if (!headerMatch) return null;
  const [, sl, sc, el, ec, status] = headerMatch;
  i++;

  const messages: Message[] = [];
  let author: "Me" | "Claude" | null = null;
  let buf: string[] = [];
  const now = new Date().toISOString();

  const flush = () => {
    if (author && buf.length) {
      const text = buf.join("\n").trim();
      if (text) {
        messages.push({ id: nanoid(), author, text, createdAt: now });
      }
    }
    buf = [];
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    const m = MSG_PREFIX_RE.exec(line);
    if (m) {
      flush();
      author = m[1] as "Me" | "Claude";
      buf = [m[2]];
    } else if (author != null) {
      buf.push(line);
    }
  }
  flush();

  return {
    rawAnchor: {
      startLine: Number(sl),
      startCol: Number(sc),
      endLine: Number(el),
      endCol: Number(ec),
    },
    headerStatus: status as "UNRESOLVED" | "RESOLVED",
    messages,
  };
}

function snippetMatches(slice: string, snippet: string): boolean {
  if (snippet.endsWith("…")) {
    return slice.startsWith(snippet.slice(0, -1));
  }
  return slice === snippet;
}

function findAllOccurrences(haystack: string, needle: string, max: number): number[] {
  const out: number[] = [];
  let i = haystack.indexOf(needle);
  while (i !== -1 && out.length < max) {
    out.push(i);
    i = haystack.indexOf(needle, i + 1);
  }
  return out;
}
