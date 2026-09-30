// ponytail: route temporaire, à supprimer après la migration des anciens fichiers vers la base.
// Reprend les voyages et médias déjà dans Vercel Blob (type et position lus dans les noms de fichiers).
// Sans risque de doublon : relancer ne recrée rien.
import { list } from '@vercel/blob';
import { sql, schema, withSrc } from './_db.js';

const kindOf = path => {
  const ext = path.split('.').pop().toLowerCase();
  return /^(jpe?g|png|gif|webp|avif|heic)$/.test(ext) ? 'img' : /^(mp4|mov|webm|m4v)$/.test(ext) ? 'vid'
    : /^(weba|m4a|mp3|wav|ogg|aac|opus)$/.test(ext) ? 'aud' : ext === 'txt' ? 'note' : null;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  await schema();
  const blobs = [];
  let cursor;
  do {
    const r = await list({ prefix: 'trips/', cursor });
    blobs.push(...r.blobs);
    cursor = r.cursor;
  } while (cursor);

  const trips = [...new Set(blobs.map(b => b.pathname.split('/')[1]).filter(Boolean))];
  for (const t of trips) await sql`insert into trips (name) values (${t}) on conflict (name) do nothing`;

  let added = 0;
  const files = blobs.filter(b => kindOf(b.pathname) && !/\/(\.keep)?$/.test(b.pathname));
  for (const b of await withSrc(files)) {
    const kind = kindOf(b.pathname);
    const g = decodeURIComponent(b.pathname).match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    const text = kind === 'note' ? await fetch(b.src).then(r => r.text()) : null;
    const rows = await sql`
      insert into media (trip_id, kind, pathname, text, lat, lng, created_at)
      select id, ${kind}, ${b.pathname}, ${text}, ${g ? +g[1] : null}, ${g ? +g[2] : null}, ${b.uploadedAt}
      from trips where name = ${b.pathname.split('/')[1]}
      on conflict (pathname) do nothing returning id`;
    added += rows.length;
  }
  res.json({ trips, files: files.length, added });
}
