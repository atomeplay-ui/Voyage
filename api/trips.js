import { list, put, del } from '@vercel/blob';

// Un voyage = un "dossier" trips/<nom>/ dans Vercel Blob. Pas de base de données.
async function listAll(opts) {
  const blobs = [], folders = [];
  let cursor;
  do {
    const r = await list({ ...opts, cursor });
    blobs.push(...r.blobs);
    folders.push(...(r.folders || []));
    cursor = r.cursor;
  } while (cursor);
  return { blobs, folders };
}

export default async function handler(req, res) {
  if (!process.env.APP_PASSWORD || req.headers['x-password'] !== process.env.APP_PASSWORD)
    return res.status(401).json({ error: 'Mot de passe incorrect' });

  const { trip, url } = req.query;

  if (req.method === 'GET') {
    if (!trip) {
      const { folders } = await listAll({ prefix: 'trips/', mode: 'folded' });
      return res.json(folders.map(f => f.slice('trips/'.length, -1)));
    }
    const { blobs } = await listAll({ prefix: `trips/${trip}/` });
    return res.json(blobs.filter(b => !b.pathname.endsWith('/.keep')));
  }

  if (req.method === 'POST') {
    const name = String(req.body?.name || '').trim();
    if (!name || name.includes('/')) return res.status(400).json({ error: 'Nom invalide' });
    await put(`trips/${name}/.keep`, '.', { access: 'public', addRandomSuffix: false, allowOverwrite: true });
    return res.json({ name });
  }

  if (req.method === 'DELETE') {
    if (!trip && !url) return res.status(400).json({ error: 'trip ou url requis' });
    const urls = url ? [url] : (await listAll({ prefix: `trips/${trip}/` })).blobs.map(b => b.url);
    if (urls.length) await del(urls);
    return res.json({ ok: true });
  }

  res.status(405).end();
}
