import { randomBytes } from 'node:crypto';
import { del } from '@vercel/blob';
import { sql, schema, withSrc, requireUser, tripFor, namesOf } from './_db.js';

// Voyages (base Neon). Les fichiers restent dans Vercel Blob.
// Rôles : propriétaire (tout), participant invité (voir, ajouter, supprimer ses médias), lien de lecture seule (voir).
export default async function handler(req, res) {
  await schema();
  const { id, all, token, link, join, members, member } = req.query;

  // Lien de lecture seule : voir un voyage sans compte. C'est la seule route ouverte sans connexion,
  // et elle ne permet que de lire ce voyage-là.
  if (req.method === 'GET' && token) {
    const [t] = await sql`select id, name, user_id from trips where share_token = ${token}`;
    if (!t) return res.status(404).json({ error: 'Lien de partage invalide ou désactivé' });
    const owner = (await namesOf([t.user_id]))[t.user_id] ?? null;
    const media = await withSrc(await sql`
      select id, kind, pathname, text, lat, lng, created_at from media where trip_id = ${t.id} order by created_at desc`);
    return res.json({ name: t.name, owner, media });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  // Rejoindre un voyage par un lien d'invitation à participer
  if (req.method === 'POST' && join) {
    const [t] = await sql`select id, name, user_id from trips where invite_token = ${join}`;
    if (!t) return res.status(404).json({ error: 'Invitation invalide ou désactivée' });
    if (t.user_id !== user.id) await sql`insert into trip_members (trip_id, user_id) values (${t.id}, ${user.id}) on conflict do nothing`;
    return res.json({ id: t.id, name: t.name });
  }

  if (req.method === 'GET' && !id) {
    // Carte de l'accueil : tous les médias localisés des voyages accessibles, avec leur voyage
    if (all) return res.json(await withSrc(await sql`
      select m.*, t.name as trip, t.id as trip_id from media m join trips t on t.id = m.trip_id
      where m.lat is not null and (t.user_id = ${user.id}
        or exists (select 1 from trip_members x where x.trip_id = t.id and x.user_id = ${user.id}))
      order by m.created_at desc`));
    // ponytail: les voyages créés avant l'ajout des comptes (sans propriétaire) vont au premier compte qui se connecte
    await sql`update trips set user_id = ${user.id} where user_id is null`;
    const trips = await sql`
      select t.id, t.name, t.user_id, case when t.user_id = ${user.id} then 'owner' else 'member' end as role from trips t
      where t.user_id = ${user.id} or exists (select 1 from trip_members x where x.trip_id = t.id and x.user_id = ${user.id})
      order by t.created_at`;
    const names = await namesOf([...new Set(trips.filter(t => t.role === 'member').map(t => t.user_id))]);
    return res.json(trips.map(t => ({ id: t.id, name: t.name, role: t.role, owner: names[t.user_id] ?? null })));
  }

  if (req.method === 'POST' && !id) {
    const name = String(req.body?.name || '').trim();
    if (!name || name.includes('/')) return res.status(400).json({ error: 'Nom invalide' });
    const [t] = await sql`
      insert into trips (user_id, name) values (${user.id}, ${name})
      on conflict (user_id, name) do update set name = excluded.name returning id, name`;
    return res.json(t);
  }

  // Tout le reste porte sur un voyage précis, auquel il faut avoir accès
  const trip = await tripFor(user, id);
  if (!trip) return res.status(404).json({ error: 'Voyage introuvable' });
  const owner = trip.role === 'owner';

  // Participants : liste (tous), retrait d'un participant (propriétaire)
  if (members) {
    const rows = await sql`select user_id from trip_members where trip_id = ${trip.id} order by created_at`;
    const names = await namesOf(rows.map(r => r.user_id));
    return res.json(rows.map(r => ({ id: r.user_id, name: names[r.user_id] ?? 'Participant' })));
  }
  if (member && req.method === 'DELETE') {
    if (!owner) return res.status(403).json({ error: 'Réservé au propriétaire du voyage' });
    await sql`delete from trip_members where trip_id = ${trip.id} and user_id = ${member}`;
    return res.json({ ok: true });
  }

  // Liens du voyage (propriétaire) : link=share (lecture seule, sans compte) ou link=invite (participer, avec compte).
  // POST = créer ou retrouver le lien, DELETE = le désactiver.
  if (link === 'share' || link === 'invite') {
    if (!owner) return res.status(403).json({ error: 'Réservé au propriétaire du voyage' });
    if (!['POST', 'DELETE'].includes(req.method)) return res.status(405).end();
    const col = link === 'share' ? 'share_token' : 'invite_token';
    const value = req.method === 'POST' ? trip[col] || randomBytes(24).toString('base64url') : null;
    if (link === 'share') await sql`update trips set share_token = ${value} where id = ${trip.id}`;
    else await sql`update trips set invite_token = ${value} where id = ${trip.id}`;
    return res.json({ token: value });
  }

  if (req.method === 'GET') {
    return res.json(await withSrc(await sql`select * from media where trip_id = ${trip.id} order by created_at desc`));
  }

  if (req.method === 'DELETE') {
    // Un participant quitte le voyage ; le propriétaire le supprime (avec ses fichiers et ses médias, en cascade)
    if (!owner) {
      await sql`delete from trip_members where trip_id = ${trip.id} and user_id = ${user.id}`;
      return res.json({ ok: true });
    }
    const files = (await sql`select pathname from media where trip_id = ${trip.id} and pathname is not null`).map(r => r.pathname);
    if (files.length) await del(files);
    await sql`delete from trips where id = ${trip.id}`;
    return res.json({ ok: true });
  }

  res.status(405).end();
}
