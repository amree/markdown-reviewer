const KEY = "mdr:docOrder";

export function loadOrder(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === "string")
      : [];
  } catch {
    return [];
  }
}

export function saveOrder(order: string[]): void {
  localStorage.setItem(KEY, JSON.stringify(order));
}

// Render order: docs not in `order` first (sorted by updatedAt DESC, so fresh
// arrivals surface at the top), followed by the user's saved sequence with
// missing slugs silently dropped.
export function applyOrder<T extends { slug: string; updatedAt: string }>(
  docs: T[],
  order: string[],
): T[] {
  const bySlug = new Map(docs.map((d) => [d.slug, d]));
  const ordered: T[] = [];
  const seen = new Set<string>();
  for (const slug of order) {
    const doc = bySlug.get(slug);
    if (doc) {
      ordered.push(doc);
      seen.add(slug);
    }
  }
  const unordered = docs
    .filter((d) => !seen.has(d.slug))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return [...unordered, ...ordered];
}
