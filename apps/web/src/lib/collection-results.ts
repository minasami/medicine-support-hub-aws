type Page<T> = { items: T[]; hasMore: boolean; nextCursor: string | null };

/** Follow server cursors even when a page has no visible matching rows. */
export async function collectPages<T>(
  fetchPage: (cursor: string | null) => Promise<Page<T>>,
  keyOf: (item: T) => string,
  cancelled: () => boolean = () => false,
): Promise<T[]> {
  const rows: T[] = [];
  const keys = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  while (!cancelled()) {
    const page = await fetchPage(cursor);
    if (cancelled()) return [];
    for (const row of page.items) {
      const key = keyOf(row);
      if (!keys.has(key)) { keys.add(key); rows.push(row); }
    }
    if (!page.hasMore) return rows;
    if (!page.nextCursor || cursors.has(page.nextCursor)) {
      throw new Error("Collection pagination stopped advancing");
    }
    cursor = page.nextCursor;
    cursors.add(cursor);
  }
  return [];
}

export function comparePrices(a: number, b: number, descending: boolean): number {
  if (a === b) return 0;
  if (!Number.isFinite(a)) return 1;
  if (!Number.isFinite(b)) return -1;
  return descending ? b - a : a - b;
}
