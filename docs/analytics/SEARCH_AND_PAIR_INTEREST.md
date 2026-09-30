# Search and pair analytics

`search_logs` stores best-effort search click events. Platform operators can inspect
these in Appwrite Console → Databases → medicine_support_hub → search_logs.
These are click events, not a complete count of every search or searches returning
zero results. Use aggregate trends to identify medicines needing better catalog
coverage, synonyms, price updates, or availability information; do not infer an
individual's diagnosis from their searches.

Live collection permissions applied on 2026-09-23:

- search_logs: create("any"), documentSecurity=false. No public read, update, or delete.
- pair_interest: read("any"), documentSecurity=false. No client create, update, or delete.

Raw search logs remain accessible to authorized Appwrite project operators/server
integrations. These permissions do not grant in-app admin users access. A future
admin dashboard should expose server-generated aggregates, not public raw logs.
Guest-created search events are untrusted analytics inputs.

The browser sends `{pairKey, kind}` to `record-pair-interest` via Functions execution.
The function accepts one impression, click, or openBoth event, validates the shape,
and uses a database atomic increment. Deterministic IDs and the unique pair_key index
handle concurrent first events, including existing rows with legacy document IDs.
Dynamic execution keys need documents.read and documents.write scopes; no key ships
in the client. Deploy the function before releasing its browser caller.

Pair counts are aggregate behavioral signals, not clinical recommendations. The
public event endpoint and client session cap do not prevent automated event spam
or provide exactly-once delivery. Existing totals were not reset or certified.
Older installed Android builds retain local counts but their direct remote writes
are denied until they upgrade to the new caller.

Regression command:

```sh
node --experimental-strip-types --test apps/web/src/lib/collection-results.test.ts functions/record-pair-interest/src/counter.test.js
```
