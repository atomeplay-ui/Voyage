// Fichier partagé par les API (le « _ » empêche Vercel d'en faire une route)
import { neon } from '@neondatabase/serverless';
import { issueSignedToken, presignUrl } from '@vercel/blob';

export const sql = neon(process.env.DATABASE_URL);
// Service de connexion Neon Auth (variable ajoutée par l'intégration Neon, préfixe DATABASE_)
export const AUTH_URL = process.env.DATABASE_NEON_AUTH_BASE_URL;

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
    // Comptes : chaque voyage appartient à un utilisateur (identifiant Neon Auth) ; nom unique par utilisateur
    await sql`alter table trips add column if not exists user_id text`;
    await sql`alter table trips drop constraint if exists trips_name_key`;
    await sql`create unique index if not exists trips_user_name on trips (user_id, name)`;
    // Partage : jeton secret du lien d'invitation en lecture seule (null = pas de lien actif)
    await sql`alter table trips add column if not exists share_token text unique`;
    // Collaboration : lien d'invitation à participer (compte obligatoire), participants, et auteur de chaque média
    await sql`alter table trips add column if not exists invite_token text unique`;
    await sql`create table if not exists trip_members (
      trip_id int not null references trips(id) on delete cascade,
      user_id text not null,
      created_at timestamptz not null default now(),
      primary key (trip_id, user_id))`;
    await sql`alter table media add column if not exists user_id text`;
  })().catch(e => { ready = null; throw e; });
}

// Utilisateur connecté, ou null : on demande à Neon Auth à qui appartient le cookie de session.
// ponytail: cache mémoire de 60 s par instance (évite un appel à Neon Auth par requête) ; une déconnexion
// peut donc rester valable jusqu'à 60 s côté serveur. Passer à la vérification JWT (JWKS) si ça gêne.
const seen = new Map();
export async function userOf(req) {
  const cookie = req.headers.cookie || '';
  if (!cookie.includes('neon-auth')) return null;
  const hit = seen.get(cookie);
  if (hit && hit.until > Date.now()) return hit.user;
  const r = await fetch(`${AUTH_URL}/get-session`, {
    headers: { cookie, origin: `https://${req.headers.host}`, 'x-neon-auth-middleware': 'true' },
  });
  const user = r.ok ? (await r.json().catch(() => null))?.user ?? null : null;
  if (seen.size > 500) seen.clear();
  seen.set(cookie, { user, until: Date.now() + 60000 });
  return user;
}

// À appeler en tête de chaque API : renvoie l'utilisateur, ou répond 401 et renvoie null
export async function requireUser(req, res) {
  const user = await userOf(req);
  if (!user) res.status(401).json({ error: 'Connexion requise' });
  return user;
}

// Store Blob privé : lien de lecture signé (1 h) pour chaque média qui a un fichier
export async function withSrc(rows) {
  const token = await issueSignedToken({ pathname: '*', operations: ['get'] });
  for (const r of rows) if (r.pathname) r.src = (await presignUrl(token, { operation: 'get', pathname: r.pathname, access: 'private' })).presignedUrl;
  return rows;
}

// Voyage auquel l'utilisateur a accès, avec son rôle : 'owner' (propriétaire) ou 'member' (participant invité). Sinon null.
export async function tripFor(user, id) {
  const [t] = await sql`
    select t.*, case when t.user_id = ${user.id} then 'owner' else 'member' end as role from trips t
    where t.id = ${num(id)} and (t.user_id = ${user.id}
      or exists (select 1 from trip_members m where m.trip_id = t.id and m.user_id = ${user.id}))`;
  return t || null;
}

// Noms des comptes (table Neon Auth) : { identifiant: nom }. Facultatif : objet vide si la table n'est pas lisible.
export async function namesOf(ids) {
  if (!ids.length) return {};
  const rows = await sql`select id::text as id, name from neon_auth."user" where id::text = any(${ids})`.catch(() => []);
  return Object.fromEntries(rows.map(r => [r.id, r.name]));
}

// Nombre valide ou null (coordonnées envoyées par le navigateur)
export const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(+v)) ? null : +v;
