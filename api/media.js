import { del } from '@vercel/blob';
import { sql, schema, num, requireUser } from './_db.js';

// Médias d'un voyage de l'utilisateur connecté : ajout après l'envoi du fichier (ou note seule), et suppression
export default async function handler(req, res) {
  await schema();
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === 'POST') {
    const { trip, kind, pathname = null, text = null } = req.body || {};
    const ok = kind === 'note' ? typeof text === 'string' && text.trim()
      : ['img', 'vid', 'aud'].includes(kind) && typeof pathname === 'string' && pathname.startsWith(`trips/${trip}/`);
    if (!ok) return res.status(400).json({ error: 'Média invalide' });
    const [row] = await sql`
      insert into media (trip_id, kind, pathname, text, lat, lng)
      select id, ${kind}, ${pathname}, ${text}, ${num(req.body.lat)}, ${num(req.body.lng)}
      from trips where user_id = ${user.id} and name = ${trip}
      returning *`;
    if (!row) return res.status(404).json({ error: 'Voyage introuvable' });
    return res.json(row);
  }

  if (req.method === 'DELETE') {
    const [row] = await sql`
      delete from media m using trips t
      where m.id = ${num(req.query.id)} and t.id = m.trip_id and t.user_id = ${user.id}
      returning m.pathname`;
    if (row?.pathname) await del(row.pathname);
    return res.json({ ok: true });
  }

  res.status(405).end();
}
