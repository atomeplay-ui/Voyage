// Proxy vers Neon Auth : /api/auth/<chemin> (réécrit par vercel.json) → <NEON_AUTH_BASE_URL>/<chemin>.
// En passant par notre domaine, le cookie de session est « de première partie » : Safari (iPhone) ne le bloque pas.
// Même principe que le SDK Neon pour Next.js (en-tête x-neon-auth-middleware, cookies réécrits en SameSite=Lax).
import { AUTH_URL } from './_db.js';

export default async function handler(req, res) {
  const { path = '', ...query } = req.query;
  const url = new URL(`${AUTH_URL}/${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  const headers = {
    origin: req.headers.origin || `https://${req.headers.host}`,
    cookie: req.headers.cookie || '',
    'x-neon-auth-middleware': 'true',
  };
  for (const h of ['user-agent', 'authorization', 'referer', 'content-type']) if (req.headers[h]) headers[h] = req.headers[h];
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  if (hasBody) headers['content-type'] = 'application/json';

  const up = await fetch(url, { method: req.method, headers, body: hasBody ? JSON.stringify(req.body ?? {}) : undefined, redirect: 'manual' });

  res.status(up.status);
  for (const h of ['content-type', 'location', 'set-auth-jwt', 'set-auth-token']) if (up.headers.get(h)) res.setHeader(h, up.headers.get(h));
  // Cookies posés sur notre domaine : pas de Domain ni Partitioned, SameSite=Lax
  const cookies = up.headers.getSetCookie().map(c =>
    c.replace(/;\s*(Partitioned|Domain=[^;]*|SameSite=[^;]*)/gi, '') + '; SameSite=Lax');
  if (cookies.length) res.setHeader('set-cookie', cookies);
  res.send(Buffer.from(await up.arrayBuffer()));
}
