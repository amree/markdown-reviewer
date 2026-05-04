import type { CommentAnchor, LineCol } from "../types";

/**
 * A "global" anchor — a doc-level comment not tied to any selection.
 * Encoded as 0/0:0/0 in the round-trip footer, which is unambiguous because
 * real markdown coordinates are 1-based.
 */
export function globalAnchor(): CommentAnchor {
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

export function isGlobalAnchor(a: {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}): boolean {
  return (
    a.startLine === 0 && a.startCol === 0 && a.endLine === 0 && a.endCol === 0
  );
}

/**
 * Build a table of character offsets where each line begins.
 * lineStarts[0] is always 0 (line 1, col 1).
 * Lines and cols are 1-based to match vi/editor conventions.
 */
export function buildLineStarts(source: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) {
      starts.push(i + 1);
    }
  }
  return starts;
}

export function offsetToLineCol(offset: number, lineStarts: number[]): LineCol {
  if (offset < 0) return { line: 1, col: 1 };
  // Binary search for the largest lineStart <= offset.
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: offset - lineStarts[lo] + 1 };
}

export function lineColToOffset(
  line: number,
  col: number,
  lineStarts: number[],
  source: string,
): number {
  const idx = Math.max(0, Math.min(lineStarts.length - 1, line - 1));
  const lineStart = lineStarts[idx];
  const nextLineStart =
    idx + 1 < lineStarts.length ? lineStarts[idx + 1] : source.length + 1;
  // Cap col so we don't fly past the end of the line.
  const maxCol = nextLineStart - lineStart;
  const safeCol = Math.max(1, Math.min(maxCol, col));
  return lineStart + safeCol - 1;
}

export function snippetFromSource(
  source: string,
  startOffset: number,
  endOffset: number,
  maxLen = 80,
): string {
  const slice = source.slice(startOffset, endOffset);
  if (slice.length <= maxLen) return slice;
  return slice.slice(0, maxLen - 1) + "…";
}
