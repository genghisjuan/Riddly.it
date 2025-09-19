// /api/admin/debug-blob.js  — TEMP Endpoint to test Blob writes directly
import { put } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET'); return res.status(405).end('Method Not Allowed');
  }

  // simple auth via header or ?token=
  const tokenHeader = req.headers['x-admin-token'];
  const tokenQuery  = req.query?.token;
  if (!process.env.ADMIN_TOKEN || (tokenHeader !== process.env.ADMIN_TOKEN && tokenQuery !== process.env.ADMIN_TOKEN)) {
    return res.status(401).json({ ok:false, error:'Unauthorized' });
  }

  const hasToken = !!process.env.BLOB_READ_WRITE_TOKEN;
  if (!hasToken) {
    return res.status(200).json({ ok:false, reason:'NO_ENV', detail:'BLOB_READ_WRITE_TOKEN not visible to function' });
  }

  const id = (typeof crypto?.randomUUID === 'function') ? crypto.randomUUID() : Date.now().toString(36);
  const path = `results/debug-${id}.json`;

  try {
    const payload = { probe: 'blob-write-test', id, at: new Date().toISOString() };
    const resp = await put(path, JSON.stringify(payload), {
      access: 'private',
      contentType: 'application/json; charset=utf-8',
      token: process.env.BLOB_READ_WRITE_TOKEN
    });
    return res.status(200).json({ ok:true, wrote:path, resp });
  } catch (e) {
    return res.status(200).json({ ok:false, reason:'PUT_FAILED', error: String(e?.message || e) });
  }
}
