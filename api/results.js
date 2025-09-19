// /api/results.js
// Saves a full quiz attempt (summary + per-question rows) to Vercel Blob.
// Writes two copies for easy browsing: 
//   - results/<test_id>/<id>.json
//   - results/<id>.json
// Uses PUBLIC access because your token requires it.

import { put } from '@vercel/blob';

// Stream-safe JSON body reader (Node runtime)
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  let payload;
  try {
    payload = await readBody(req);
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid JSON' });
  }

  // Expecting payload to include at least: test_id, title, user_name (optional),
  // plus summary (correct, total, scorePct) and rows[] with per-question details.
  const id =
    typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const entry = {
    // server metadata
    id,
    received_at: new Date().toISOString(),
    // client data (quiz summary + rows)
    ...payload,
  };

  // Normalize a few things defensively so admin never breaks
  if (!Array.isArray(entry.rows)) entry.rows = [];
  if (typeof entry.scorePct !== 'number' && Number.isFinite(entry.correct) && Number.isFinite(entry.total) && entry.total > 0) {
    entry.scorePct = Math.round((entry.correct / entry.total) * 100);
  }

  let persisted = false;
  let error = null;

  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      error = 'BLOB_READ_WRITE_TOKEN_NOT_VISIBLE';
    } else {
      const safeTestId = String(entry.test_id || 'unknown').replace(/[^a-z0-9_-]/gi, '_');

      const body = JSON.stringify(entry);

      // Write nested copy
      await put(`results/${safeTestId}/${id}.json`, body, {
        access: 'public', // IMPORTANT: your token requires public access
        contentType: 'application/json; charset=utf-8',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });

      // Write flat copy (easy to find by id)
      await put(`results/${id}.json`, body, {
        access: 'public', // IMPORTANT
        contentType: 'application/json; charset=utf-8',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });

      persisted = true;
    }
  } catch (e) {
    error = String(e?.message || e);
    console.warn('Blob write failed:', e);
  }

  // Always OK to the client so the user sees their results,
  // but include persisted + error for admin/debug
  return res.status(200).json({ ok: true, id, persisted, error });
}
