import { del } from '@vercel/blob';
import { sql, schema, withSrc } from './_db.js';

// Voyages (base Neon). Les fichiers restent dans Vercel Blob, la base garde leurs informations.
// ponytail: pas d'authentification pour l'instant, n'importe qui avec l'URL peut lire/modifier.
export default async function handler(req, res) {
  await schema();
  const { trip, all } = req.query;

  if (req.method === 'GET') {
    // Carte de l'accueil : tous les médias localisés, avec leur voyage
    if (all) return res.json(await withSrc(await sql`
      select m.*, t.name as trip from media m join trips t on t.id = m.trip_id
      where m.lat is not null order by m.created_at desc`));
    if (!trip) return res.json((await sql`select name from trips order by created_at`).map(r => r.name));
    return res.json(await withSrc(await sql`
      select m.* from media m join trips t on t.id = m.trip_id
      where t.name = ${trip} order by m.created_at desc`));
  }

  if (req.method === 'POST') {
    const name = String(req.body?.name || '').trim();
    if (!name || name.includes('/')) return res.status(400).json({ error: 'Nom invalide' });
    await sql`insert into trips (name) values (${name}) on conflict (name) do nothing`;
    return res.json({ name });
  }

  if (req.method === 'DELETE') {
    if (!trip) return res.status(400).json({ error: 'trip requis' });
    const files = (await sql`
      select m.pathname from media m join trips t on t.id = m.trip_id
      where t.name = ${trip} and m.pathname is not null`).map(r => r.pathname);
    if (files.length) await del(files);
    await sql`delete from trips where name = ${trip}`; // supprime aussi ses médias (cascade)
    return res.json({ ok: true });
  }

  res.status(405).end();
}
