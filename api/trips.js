import { randomBytes } from 'node:crypto';
import { del } from '@vercel/blob';
import { sql, schema, withSrc, requireUser } from './_db.js';

// Voyages de l'utilisateur connecté (base Neon). Les fichiers restent dans Vercel Blob.
export default async function handler(req, res) {
  await schema();
  const { trip, all, token } = req.query;

  // Lien d'invitation : lecture seule d'un voyage, sans compte. C'est la seule route ouverte sans connexion,
  // et elle ne permet que de lire ce voyage-là (ajouts et suppressions exigent toujours le propriétaire).
  if (req.method === 'GET' && token) {
    const [t] = await sql`select id, name, user_id from trips where share_token = ${token}`;
    if (!t) return res.status(404).json({ error: 'Lien de partage invalide ou désactivé' });
    // Nom du propriétaire (table des comptes Neon Auth) ; facultatif
    const owner = await sql`select name from neon_auth."user" where id::text = ${t.user_id}`.then(r => r[0]?.name ?? null, () => null);
    const media = await withSrc(await sql`
      select id, kind, pathname, text, lat, lng, created_at from media where trip_id = ${t.id} order by created_at desc`);
    return res.json({ name: t.name, owner, media });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  // Gestion du lien de partage par le propriétaire : POST = créer (ou retrouver) le lien, DELETE = le désactiver
  if (req.query.share !== undefined) {
    if (!trip) return res.status(400).json({ error: 'trip requis' });
    const next = req.method === 'POST' ? randomBytes(24).toString('base64url') : null;
    const [row] = req.method === 'POST'
      ? await sql`update trips set share_token = coalesce(share_token, ${next}) where user_id = ${user.id} and name = ${trip} returning share_token`
      : req.method === 'DELETE'
        ? await sql`update trips set share_token = null where user_id = ${user.id} and name = ${trip} returning share_token`
        : [];
    if (!row) return res.status(404).json({ error: 'Voyage introuvable' });
    return res.json({ token: row.share_token });
  }

  if (req.method === 'GET') {
    // Carte de l'accueil : tous les médias localisés, avec leur voyage
    if (all) return res.json(await withSrc(await sql`
      select m.*, t.name as trip from media m join trips t on t.id = m.trip_id
      where t.user_id = ${user.id} and m.lat is not null order by m.created_at desc`));
    if (!trip) {
      // ponytail: les voyages créés avant l'ajout des comptes (sans propriétaire) vont au premier compte qui se connecte
      await sql`update trips set user_id = ${user.id} where user_id is null`;
      return res.json((await sql`select name from trips where user_id = ${user.id} order by created_at`).map(r => r.name));
    }
    return res.json(await withSrc(await sql`
      select m.* from media m join trips t on t.id = m.trip_id
      where t.user_id = ${user.id} and t.name = ${trip} order by m.created_at desc`));
  }

  if (req.method === 'POST') {
    const name = String(req.body?.name || '').trim();
    if (!name || name.includes('/')) return res.status(400).json({ error: 'Nom invalide' });
    await sql`insert into trips (user_id, name) values (${user.id}, ${name}) on conflict (user_id, name) do nothing`;
    return res.json({ name });
  }

  if (req.method === 'DELETE') {
    if (!trip) return res.status(400).json({ error: 'trip requis' });
    const files = (await sql`
      select m.pathname from media m join trips t on t.id = m.trip_id
      where t.user_id = ${user.id} and t.name = ${trip} and m.pathname is not null`).map(r => r.pathname);
    if (files.length) await del(files);
    await sql`delete from trips where user_id = ${user.id} and name = ${trip}`; // supprime aussi ses médias (cascade)
    return res.json({ ok: true });
  }

  res.status(405).end();
}
