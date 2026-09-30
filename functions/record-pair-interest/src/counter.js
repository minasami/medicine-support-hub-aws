import { createHash } from 'node:crypto';

const FIELDS = { impression: 'impressions', click: 'clicks', openBoth: 'open_both' };
export function validateEvent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (Object.keys(body).some(k => !['pairKey', 'kind'].includes(k))) return null;
  if (!Object.hasOwn(FIELDS, body.kind)) return null;
  const key = body.pairKey;
  if (typeof key !== 'string' || key.length > 128 || /[\u0000-\u001f]/.test(key)) return null;
  const parts = key.split('||');
  if (parts.length !== 2 || parts.some(p => !p.trim() || p !== p.trim()) || parts[0] === parts[1]) return null;
  return { pairKey: parts.sort().join('||'), field: FIELDS[body.kind] };
}

// api is injectable so concurrency and malformed requests can be tested offline.
export async function incrementPair(api, event) {
  const query = encodeURIComponent(JSON.stringify({ method: 'equal', attribute: 'pair_key', values: [event.pairKey] }));
  const find = () => api(`?queries[]=${query}&queries[]=${encodeURIComponent(JSON.stringify({ method: 'limit', values: [1] }))}`);
  let doc = (await find()).documents[0];
  if (!doc) {
    try {
      // Unique pair_key index + deterministic id make simultaneous first events safe.
      await api('', 'POST', {
        documentId: createHash('sha256').update(event.pairKey).digest('hex').slice(0, 36),
        permissions: [],
        data: { pair_key: event.pairKey, impressions: 0, clicks: 0, open_both: 0, [event.field]: 1 },
      });
      return;
    } catch (err) {
      if (err.status !== 409) throw err;
      doc = (await find()).documents[0];
      if (!doc) throw err;
    }
  }
  // Atomic database increment, never a read/modify/write of the previous total.
  await api(`/${encodeURIComponent(doc.$id)}/${event.field}/increment`, 'PATCH', { value: 1 });
}
