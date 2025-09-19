import fs from 'fs';
import path from 'path';
import { kv } from '@vercel/kv';

function readBody(req){
  return new Promise((resolve, reject)=>{
    let data = '';
    req.on('data', chunk=> data += chunk);
    req.on('end', ()=>{ try{ resolve(data ? JSON.parse(data) : {}); } catch(e){ reject(e); } });
    req.on('error', reject);
  });
}

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  let body;
  try{
    body = await readBody(req);
  } catch(e){
    return res.status(400).json({ ok:false, error:'Invalid JSON' });
  }

  const testIdHint = String(body.test_id||'').trim();  // may be empty; keep backward compat
  const otp = String(body.otp||'').trim();
  if(!otp){ return res.status(400).json({ ok:false, error:'Missing otp' }); }

  // ---------------------------
  // KV path (unchanged semantics, with a small extension)
  // ---------------------------
  if(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN){
    try{
      // 1) Original behavior: require a pre-seeded one-time key "otp:<test_id>:<otp>"
      //    If you continue seeding this way, nothing changes for you.
      if (testIdHint) {
        const strictKey = `otp:${testIdHint}:${otp}`;
        const strictVal = await kv.get(strictKey);
        if(strictVal && !strictVal.used){
          await kv.set(strictKey, { ...(strictVal||{}), used:true, used_at:new Date().toISOString() });
          return res.status(200).json({ ok:true, test_id:testIdHint, title: strictVal.title || testIdHint });
        }
      }

      // 2) NEW (optional): allow a global mapping "otpmap:<otp>" -> { test_id, title, one_time?:true }
      //    Use this if you don't want to seed per-test keys. Still one-time if you want it.
      const mapKey = `otpmap:${otp}`;
      const mapped = await kv.get(mapKey);
      if (mapped && mapped.test_id) {
        const tId = String(mapped.test_id);
        const title = mapped.title || tId;

        // Enforce one-time if you set one_time true (or seed a separate strictKey)
        const strictKey = `otp:${tId}:${otp}`;
        const strictVal = await kv.get(strictKey);
        if (strictVal && strictVal.used) {
          return res.status(200).json({ ok:false });
        }

        // Mark used (either create or update)
        await kv.set(strictKey, { ...(strictVal||{}), used:true, used_at:new Date().toISOString(), title });

        return res.status(200).json({ ok:true, test_id: tId, title });
      }

      // No KV match
      return res.status(200).json({ ok:false });
    } catch(e){
      console.error('KV OTP verify error:', e);
      // fall through to file-based as a safe fallback
    }
  }

  // ---------------------------
  // File-based fallback (multi-use demo)
  // Supports BOTH:
  //   A) legacy: { "quiz_test:123456": { "title": "Old title" } }
  //   B) new:    { "quiz_test": { "otp":"123456", "title":"Server Fundamentals — Cohort A" } }
  // ---------------------------
  const filePath = path.join(process.cwd(), 'tests', 'otps.json');
  try{
    if(!fs.existsSync(filePath)) return res.status(200).json({ ok:false });

    const store = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // Helper to build response quickly
    const okResp = (tid, title, demo=true) =>
      res.status(200).json({ ok:true, test_id: tid, title: title || tid, demo });

    // 1) Legacy exact key first (preserves your original behavior exactly)
    if (testIdHint) {
      const legacyKey = `${testIdHint}:${otp}`;
      if (store[legacyKey]) {
        return okResp(testIdHint, store[legacyKey]?.title);
      }
    }

    // 2) New shape: { "<test_id>": { otp, title } } — check hinted test_id match
    if (testIdHint && store[testIdHint] && typeof store[testIdHint] === 'object') {
      const cfg = store[testIdHint];
      if (cfg.otp && String(cfg.otp) === otp) {
        return okResp(testIdHint, cfg.title);
      }
    }

    // 3) New shape — discover the test_id by OTP alone
    for (const [tid, cfg] of Object.entries(store)) {
      if (cfg && typeof cfg === 'object' && 'otp' in cfg) {
        if (String(cfg.otp) === otp) {
          return okResp(tid, cfg.title);
        }
      }
    }

    // 4) Legacy keys: "<test_id>:<otp>" without a hint — try to find one that matches this otp
    for (const [key, val] of Object.entries(store)) {
      if (key.includes(':')) {
        const [tid, kOtp] = key.split(':');
        if (String(kOtp) === otp) {
          return okResp(tid, val?.title);
        }
      }
    }

    // No match
    return res.status(200).json({ ok:false });
  } catch(e){
    console.error('File OTP read error:', e);
    return res.status(500).json({ ok:false, error:'OTP read error' });
  }
}
