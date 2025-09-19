// /api/admin/get-results.js
import { list } from '@vercel/blob';

function normalize(entry){
  const user_name = entry.user_name ?? entry.name ?? entry.raw?.user_name ?? entry.raw?.name ?? '';
  const correct = entry.correct ?? entry.score ?? entry.raw?.correct ?? entry.raw?.score ?? null;
  const total = entry.total ?? entry.total_questions ?? entry.raw?.total ?? entry.raw?.total_questions ?? null;
  const scorePct = entry.scorePct ?? (Number.isFinite(correct) && Number.isFinite(total) && total > 0
    ? Math.round((correct / total) * 100) : null);
  const title = entry.title ?? entry.raw?.title ?? '';
  return {
    id: entry.id || '',
    received_at: entry.received_at || entry.timestamp || '',
    user_name, correct, total, scorePct, title
  };
}

export default async function handler(req, res){
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end('Method Not Allowed');
  }

  const token = req.headers['x-admin-token'];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ ok:false, error:'Unauthorized' });
  }

  // 🚫 Make the endpoint itself uncacheable
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(200).json({ ok:true, count:0, page:1, page_size:20, total_pages:0, results:[] });
  }

  const since    = req.query.since ? new Date(req.query.since) : null;
  const page     = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.max(1, Math.min(100, parseInt(req.query.page_size || '20', 10)));

  try {
    // List from root; we save both flat and nested, we'll read flat below.
    const { blobs } = await list({
      prefix: 'results/',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    // Only flat files: results/<uuid>.json
    const flat = blobs.filter(b => /^results\/[0-9a-z-]+\.json$/i.test(b.pathname));

    const items = [];
    for (const b of flat) {
      // ⛔️ Bypass any edge cache for the blob JSON
      const url = b.url + (b.url.includes('?') ? '&' : '?') + 'ts=' + Date.now();
      const r = await fetch(url, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` }
      });
      if (!r.ok) continue;
      items.push(await r.json());
    }

    let normalized = items.map(normalize);
    if (since) normalized = normalized.filter(x => x.received_at && new Date(x.received_at) >= since);

    // newest first
    normalized.sort((a,b)=> new Date(b.received_at) - new Date(a.received_at));

    const count = normalized.length;
    const totalPages = Math.max(1, Math.ceil(count / pageSize));
    const current = Math.min(page, totalPages);
    const start = (current - 1) * pageSize;
    const slice = normalized.slice(start, start + pageSize);

    return res.status(200).json({
      ok:true,
      count,
      page: current,
      page_size: pageSize,
      total_pages: totalPages,
      results: slice
    });
  } catch (e) {
    console.error('Admin list error:', e);
    return res.status(500).json({ ok:false, error:'Failed to list results' });
  }
}
