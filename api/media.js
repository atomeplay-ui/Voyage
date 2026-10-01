import { del } from '@vercel/blob';
import { sql, schema, num, requireUser, tripFor } from './_db.js';
import { notifyTrip } from './_push.js';

// Médias d'un voyage : ajout (propriétaire et participants) après l'envoi du fichier, ou note seule ; suppression.
export default async function handler(req, res) {
  await schema();
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === 'POST') {
    const { tripId, kind, pathname = null, text = null } = req.body || {};
    const trip = await tripFor(user, tripId);
    if (!trip) return res.status(404).json({ error: 'Voyage introuvable' });
    if (trip.role === 'viewer') return res.status(403).json({ error: 'Voyage en lecture seule' });
    // Un fichier doit avoir été envoyé dans le dossier de ce voyage (voir send() côté appli)
    const ok = kind === 'note' ? typeof text === 'string' && text.trim()
      : ['img', 'vid', 'aud'].includes(kind) && typeof pathname === 'string' && pathname.startsWith(`trips/id-${trip.id}/`);
    if (!ok) return res.status(400).json({ error: 'Média invalide' });
    const [row] = await sql`
      insert into media (trip_id, user_id, kind, pathname, text, lat, lng)
      values (${trip.id}, ${user.id}, ${kind}, ${pathname}, ${text}, ${num(req.body.lat)}, ${num(req.body.lng)})
      returning *`;
    await notifyTrip(trip, user, kind);
    return res.json(row);
  }

  if (req.method === 'DELETE') {
    // Le propriétaire du voyage peut tout supprimer ; un participant seulement ce qu'il a ajouté
    const [row] = await sql`
      delete from media m using trips t
      where m.id = ${num(req.query.id)} and t.id = m.trip_id and (t.user_id = ${user.id} or m.user_id = ${user.id})
      returning m.pathname`;
    if (!row) return res.status(403).json({ error: 'Suppression non autorisée' });
    if (row.pathname) await del(row.pathname);
    return res.json({ ok: true });
  }

  res.status(405).end();
}
