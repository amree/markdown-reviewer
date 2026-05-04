export interface OutlineItem {
  level: number;
  text: string;
  line: number;
  srcStart: number;
}

/**
 * Parse ATX headings (`#` … `######`) from a markdown source.
 *
 * `srcStart` is the byte offset of the leading `#`, matching the
 * `data-src-start` attribute that `rehype-positions` sets on the rendered
 * heading element — so callers can scroll to it with a single querySelector.
 *
 * Setext headings (===/---) are intentionally not supported; plans use ATX.
 */
export function parseOutline(body: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const lines = body.split("\n");
  let inFence = false;
  let fenceChar = "";
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const ch = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = ch;
      } else if (ch === fenceChar) {
        inFence = false;
      }
    } else if (!inFence) {
      const m = /^( {0,3})(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (m) {
        items.push({
          level: m[2].length,
          text: stripInline(m[3]),
          line: i + 1,
          srcStart: offset + m[1].length,
        });
      }
    }
    offset += line.length + 1;
  }
  return items;
}

function stripInline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}
