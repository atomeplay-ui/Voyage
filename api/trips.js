import { list, put, del, issueSignedToken, presignUrl } from '@vercel/blob';

// Un voyage = un "dossier" trips/<nom>/ dans Vercel Blob (store privé). Pas de base de données.
// ponytail: pas d'authentification pour l'instant, n'importe qui avec l'URL peut lire/modifier.
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
  const { trip, url } = req.query;

  if (req.method === 'GET') {
    if (!trip) {
      const { folders } = await listAll({ prefix: 'trips/', mode: 'folded' });
      return res.json(folders.map(f => f.slice('trips/'.length, -1)));
    }
    const blobs = (await listAll({ prefix: `trips/${trip}/` })).blobs.filter(b => !b.pathname.endsWith('/.keep'));
    // Store privé : liens de lecture signés, valables 1 h.
    const token = await issueSignedToken({ pathname: '*', operations: ['get'] });
    for (const b of blobs) b.src = (await presignUrl(token, { operation: 'get', pathname: b.pathname, access: 'private' })).presignedUrl;
    return res.json(blobs);
  }

  if (req.method === 'POST') {
    const name = String(req.body?.name || '').trim();
    if (!name || name.includes('/')) return res.status(400).json({ error: 'Nom invalide' });
    await put(`trips/${name}/.keep`, '.', { access: 'private', addRandomSuffix: false, allowOverwrite: true });
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
