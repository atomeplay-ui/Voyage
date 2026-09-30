import { del } from '@vercel/blob';
import { sql, schema, num } from './_db.js';

// Médias d'un voyage : ajout après l'envoi du fichier (ou note seule), et suppression
export default async function handler(req, res) {
  await schema();

  if (req.method === 'POST') {
    const { trip, kind, pathname = null, text = null } = req.body || {};
    const ok = kind === 'note' ? typeof text === 'string' && text.trim()
      : ['img', 'vid', 'aud'].includes(kind) && typeof pathname === 'string' && pathname.startsWith(`trips/${trip}/`);
    if (!ok) return res.status(400).json({ error: 'Média invalide' });
    const [row] = await sql`
      insert into media (trip_id, kind, pathname, text, lat, lng)
      select id, ${kind}, ${pathname}, ${text}, ${num(req.body.lat)}, ${num(req.body.lng)} from trips where name = ${trip}
      returning *`;
    if (!row) return res.status(404).json({ error: 'Voyage introuvable' });
    return res.json(row);
  }

  if (req.method === 'DELETE') {
    const [row] = await sql`delete from media where id = ${num(req.query.id)} returning pathname`;
    if (row?.pathname) await del(row.pathname);
    return res.json({ ok: true });
  }

  res.status(405).end();
}
