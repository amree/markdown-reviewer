import type { Comment, DocSummary, Editor, FullDoc } from "../types";

export interface VersionSummary {
  version: number;
  savedAt: string;
  editor: Editor;
}

async function ok<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`${r.status} ${r.statusText}${text ? ` — ${text}` : ""}`);
  }
  return r.json() as Promise<T>;
}

export async function listDocs(): Promise<DocSummary[]> {
  return ok<DocSummary[]>(await fetch("/api/docs"));
}

export async function getDoc(slug: string): Promise<FullDoc> {
  return ok<FullDoc>(
    await fetch(`/api/docs/${encodeURIComponent(slug)}`, {
      headers: { Accept: "application/json" },
    }),
  );
}

export async function getDocMarkdown(slug: string): Promise<string> {
  const r = await fetch(`/api/docs/${encodeURIComponent(slug)}`, {
    headers: { Accept: "text/markdown" },
  });
  if (!r.ok) throw new Error(`getDocMarkdown ${r.status}`);
  return r.text();
}

export async function createDoc(
  markdown: string,
  slug?: string,
): Promise<DocSummary> {
  const url = slug ? `/api/docs?slug=${encodeURIComponent(slug)}` : "/api/docs";
  return ok<DocSummary>(
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/markdown",
        "X-Md-Reviewer-Editor": "me",
      },
      body: markdown,
    }),
  );
}

export async function putDocMarkdown(
  slug: string,
  markdown: string,
): Promise<DocSummary> {
  return ok<DocSummary>(
    await fetch(`/api/docs/${encodeURIComponent(slug)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "text/markdown",
        "X-Md-Reviewer-Editor": "me",
      },
      body: markdown,
    }),
  );
}

export async function patchDoc(
  slug: string,
  patch: { body?: string; title?: string; comments?: Comment[] },
): Promise<FullDoc> {
  return ok<FullDoc>(
    await fetch(`/api/docs/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Md-Reviewer-Editor": "me",
      },
      body: JSON.stringify(patch),
    }),
  );
}

export async function listVersions(slug: string): Promise<VersionSummary[]> {
  return ok<VersionSummary[]>(
    await fetch(`/api/docs/${encodeURIComponent(slug)}/versions`),
  );
}

export async function getVersionBody(
  slug: string,
  n: number,
): Promise<string> {
  const r = await fetch(
    `/api/docs/${encodeURIComponent(slug)}/versions/${n}`,
    { headers: { Accept: "text/markdown" } },
  );
  if (!r.ok) throw new Error(`getVersionBody ${r.status}`);
  return r.text();
}

export async function deleteDoc(slug: string): Promise<void> {
  const r = await fetch(`/api/docs/${encodeURIComponent(slug)}`, {
    method: "DELETE",
  });
  if (!r.ok) throw new Error(`deleteDoc ${r.status}`);
}

export interface DocEvent {
  type: "created" | "updated" | "deleted";
  slug: string;
  updatedAt: string;
  lastEditor: "me" | "claude";
}

export function subscribeDocEvents(
  onEvent: (e: DocEvent) => void,
): () => void {
  const es = new EventSource("/api/events");
  es.onmessage = (msg) => {
    if (!msg.data) return;
    try {
      onEvent(JSON.parse(msg.data) as DocEvent);
    } catch {
      // ignore malformed events
    }
  };
  return () => es.close();
}
