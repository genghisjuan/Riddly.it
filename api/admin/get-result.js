// /api/admin/get-result.js
// Minimal detail endpoint: looks up one attempt saved at results/<id>.json (public blob).
// Does NOT touch your existing get-results.js.

import { list } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end('Method Not Allowed');
  }

  // Admin auth
  const token = req.headers['x-admin-token'];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  // Blob token (used for listing); results are saved PUBLIC so fetch doesn't need auth
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ ok: false, error: 'Missing BLOB_READ_WRITE_TOKEN' });
  }

  const id = String(req.query.id || '').trim();
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Missing id' });
  }

  // Helper: fetch JSON with a cache-buster to avoid CDN caching
  async function fetchJson(url) {
    const u = url + (url.includes('?') ? '&' : '?') + 'ts=' + Date.now();
    const r = await fetch(u, { cache: 'no-store' });
    if (!r.ok) return null;
    try { return await r.json(); } catch { return null; }
  }

  try {
    // Look for the exact flat path: results/<id>.json
    // (This matches how your get-results.js lists/normalizes rows.)
    let cursor;
    let found = null;

    do {
      const resp = await list({
        prefix: 'results/',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        cursor
      });

      found = resp.blobs.find(b => b.pathname === `results/${id}.json`);
      if (found) break;

      cursor = resp.cursor;
    } while (cursor);

    if (!found) {
      // Optional: try legacy nested */<id>.json in case some old attempts only exist nested
      cursor = undefined;
      do {
        const resp = await list({
          prefix: 'results/',
          token: process.env.BLOB_READ_WRITE_TOKEN,
          cursor
        });

        found = resp.blobs.find(b => b.pathname.endsWith(`/${id}.json`));
        if (found) break;

        cursor = resp.cursor;
      } while (cursor);
    }

    if (!found) {
      return res.status(404).json({ ok: false, error: 'Result not found' });
    }

    // Blob is public; fetch JSON directly
    const json = await fetchJson(found.url);
    if (!json) {
      return res.status(500).json({ ok: false, error: 'Failed to load result JSON' });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, result: json });
  } catch (e) {
    console.error('get-result error:', e);
    return res.status(500).json({ ok: false, error: 'Unexpected error loading result' });
  }
}
