import { incrementPair, validateEvent } from './counter.js';

export default async ({ req, res, error }) => {
  let body;
  try { body = req.bodyJson ?? (typeof req.body === 'string' ? JSON.parse(req.body) : req.body); }
  catch { return res.json({ error: 'Invalid event' }, 400); }
  const event = validateEvent(body);
  if (!event || req.method !== 'POST') return res.json({ error: 'Invalid event' }, 400);
  const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT;
  const project = process.env.APPWRITE_FUNCTION_PROJECT_ID;
  const key = req.headers['x-appwrite-key'];
  if (!endpoint || !project || !key) return res.json({ error: 'Analytics unavailable' }, 503);
  const root = `${endpoint.replace(/\/$/, '')}/databases/medicine_support_hub/collections/pair_interest/documents`;
  const api = async (path, method = 'GET', data) => {
    const response = await fetch(root + path, {
      method,
      headers: { 'X-Appwrite-Project': project, 'X-Appwrite-Key': key, 'Content-Type': 'application/json' },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error('Analytics database request failed'), { status: response.status });
    return result;
  };
  try {
    await incrementPair(api, event);
    return res.json({ accepted: true });
  } catch {
    error('Pair counter update failed'); // Do not log browsing data or credentials.
    return res.json({ error: 'Analytics unavailable' }, 503);
  }
};
