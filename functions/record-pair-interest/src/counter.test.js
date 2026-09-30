import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEvent, incrementPair } from './counter.js';

test('rejects arbitrary counts, unknown events and malformed pairs', () => {
  for (const body of [null, [], {}, { pairKey: 'a||b', kind: 'click', clicks: 100 },
    { pairKey: 'a||b', kind: '__proto__' }, { pairKey: 'a||a', kind: 'click' },
    { pairKey: 'a||b||c', kind: 'click' }, { pairKey: ' a||b', kind: 'click' }]) {
    assert.equal(validateEvent(body), null);
  }
  assert.deepEqual(validateEvent({ pairKey: 'b||a', kind: 'openBoth' }), { pairKey: 'a||b', field: 'open_both' });
});
for (const existing of [false, true]) {
  test(`concurrent events preserve every increment (existing=${existing})`, async () => {
    let doc = existing ? { $id: 'legacy', clicks: 10 } : null;
    const api = async (path, method = 'GET', data) => {
      if (method === 'GET') return { documents: doc ? [{ ...doc }] : [] };
      if (method === 'POST') {
        if (doc) throw Object.assign(new Error('Conflict'), { status: 409 });
        doc = { $id: data.documentId, ...data.data };
      } else {
        assert.equal(method, 'PATCH');
        assert.equal(path, `/${doc.$id}/clicks/increment`);
        assert.deepEqual(data, { value: 1 });
        doc.clicks += data.value;
      }
      return doc;
    };
    await Promise.all(Array.from({ length: 30 }, () => incrementPair(api, { pairKey: 'a||b', field: 'clicks' })));
    assert.equal(doc.clicks, existing ? 40 : 30);
  });
}
