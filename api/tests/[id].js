import fs from 'fs';
import path from 'path';

export default async function handler(req, res){
  const { id } = req.query || {}; // Vercel provides req.query
  const safe = String(id||'').replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(process.cwd(), 'tests', `${safe}.json`);
  if(!fs.existsSync(filePath)){
    res.status(404).json({ error: 'Test not found' });
    return;
  }
  try{
    const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(json);
  } catch(e){
    res.status(500).json({ error: 'Failed to read test' });
  }
}
