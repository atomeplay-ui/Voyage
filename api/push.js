import { sql, requireUser } from './_db.js';
import { vapid } from './_push.js';

// Abonnement de ce téléphone aux notifications : GET = clé publique, POST = s'abonner, DELETE = se désabonner
export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const { publicKey } = await vapid();
  if (req.method === 'GET') return res.json({ key: publicKey });
  const endpoint = req.body?.endpoint;
  // Seuls les services de push des navigateurs (https) sont acceptés : le serveur enverra des requêtes à cette adresse
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) return res.status(400).json({ error: 'Abonnement invalide' });
  if (req.method === 'POST') {
    if (!req.body.keys?.p256dh || !req.body.keys?.auth) return res.status(400).json({ error: 'Abonnement invalide' });
    const sub = JSON.stringify({ endpoint, keys: { p256dh: req.body.keys.p256dh, auth: req.body.keys.auth } });
    await sql`insert into push_subs (endpoint, user_id, sub) values (${endpoint}, ${user.id}, ${sub})
      on conflict (endpoint) do update set user_id = excluded.user_id, sub = excluded.sub`;
    return res.json({ ok: true });
  }
  if (req.method === 'DELETE') {
    await sql`delete from push_subs where endpoint = ${endpoint} and user_id = ${user.id}`;
    return res.json({ ok: true });
  }
  res.status(405).end();
}
