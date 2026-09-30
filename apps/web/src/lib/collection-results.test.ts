import assert from "node:assert/strict";
import { test } from "node:test";
import { collectPages, comparePrices } from "./collection-results.ts";

test("loads matches beyond 500 rows and continues through filtered empty pages", async () => {
  const rows = await collectPages(async cursor => {
    const page = Number(cursor || 0);
    return { items: page === 2 ? [] : Array.from({ length: 100 }, (_, i) => page * 100 + i),
      hasMore: page < 6, nextCursor: page < 6 ? String(page + 1) : null };
  }, String);
  assert.equal(rows.length, 600);
  assert.equal(rows.at(-1), 699);
});
test("rejects cursor cycles instead of returning a partial collection", async () => {
  await assert.rejects(collectPages(async cursor => ({ items: [], hasMore: true,
    nextCursor: cursor === "a" ? "b" : "a" }), String), /stopped advancing/);
});
test("cancellation stops further requests and suppresses stale results", async () => {
  let cancelled = false;
  const rows = await collectPages(async () => {
    cancelled = true;
    return { items: [1], hasMore: true, nextCursor: "2" };
  }, String, () => cancelled);
  assert.deepEqual(rows, []);
});
test("unpriced rows stay last in either price direction", () => {
  for (const descending of [false, true]) {
    const sorted = [Infinity, 10, 40, Infinity, 20].sort((a, b) => comparePrices(a, b, descending));
    assert.deepEqual(sorted, descending ? [40, 20, 10, Infinity, Infinity] : [10, 20, 40, Infinity, Infinity]);
  }
});
