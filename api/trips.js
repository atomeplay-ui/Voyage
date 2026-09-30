import { list, createFolder, del, issueSignedToken, presignUrl } from '@vercel/blob';

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

// Store privé : ajoute à chaque média un lien de lecture signé, valable 1 h.
async function withSrc(blobs) {
  const token = await issueSignedToken({ pathname: '*', operations: ['get'] });
  for (const b of blobs) b.src = (await presignUrl(token, { operation: 'get', pathname: b.pathname, access: 'private' })).presignedUrl;
  return blobs;
}

export default async function handler(req, res) {
  const { trip, url, all } = req.query;

  if (req.method === 'GET') {
    // Carte de l'accueil : tous les médias localisés (« …@lat,lng… » dans le nom), avec leur voyage
    if (all) {
      const blobs = (await listAll({ prefix: 'trips/' })).blobs.filter(b => b.pathname.includes('@'));
      for (const b of blobs) b.trip = b.pathname.split('/')[1];
      return res.json(await withSrc(blobs));
    }
    if (!trip) {
      const { folders } = await listAll({ prefix: 'trips/', mode: 'folded' });
      return res.json(folders.map(f => f.slice('trips/'.length, -1)));
    }
    // Ignore le dossier lui-même (et les anciens fichiers .keep des premiers voyages)
    const blobs = (await listAll({ prefix: `trips/${trip}/` })).blobs.filter(b => !/\/(\.keep)?$/.test(b.pathname));
    return res.json(await withSrc(blobs));
  }

  if (req.method === 'POST') {
    const name = String(req.body?.name || '').trim();
    if (!name || name.includes('/')) return res.status(400).json({ error: 'Nom invalide' });
    // Un voyage du même nom existe déjà : rien à créer
    await createFolder(`trips/${name}/`, { access: 'private' }).catch(e => { if (!/exist/i.test(e.message)) throw e; });
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
