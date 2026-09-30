// Fichier partagé par les API (le « _ » empêche Vercel d'en faire une route)
import { neon } from '@neondatabase/serverless';
import { issueSignedToken, presignUrl } from '@vercel/blob';

export const sql = neon(process.env.DATABASE_URL);

// Crée les tables au premier appel (une fois par démarrage de fonction)
let ready;
export function schema() {
  return ready ??= (async () => {
    await sql`create table if not exists trips (
      id serial primary key,
      name text not null unique,
      created_at timestamptz not null default now())`;
    // pathname : fichier dans Vercel Blob (null pour les notes, dont le texte est ici)
    await sql`create table if not exists media (
      id serial primary key,
      trip_id int not null references trips(id) on delete cascade,
      kind text not null check (kind in ('img', 'vid', 'aud', 'note')),
      pathname text unique,
      text text,
      lat double precision,
      lng double precision,
      created_at timestamptz not null default now())`;
    await sql`create index if not exists media_trip on media (trip_id)`;
  })().catch(e => { ready = null; throw e; });
}

// Store Blob privé : lien de lecture signé (1 h) pour chaque média qui a un fichier
export async function withSrc(rows) {
  const token = await issueSignedToken({ pathname: '*', operations: ['get'] });
  for (const r of rows) if (r.pathname) r.src = (await presignUrl(token, { operation: 'get', pathname: r.pathname, access: 'private' })).presignedUrl;
  return rows;
}

// Nombre valide ou null (coordonnées envoyées par le navigateur)
export const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(+v)) ? null : +v;
