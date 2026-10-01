// Notifications push (Web Push), partagé par api/push.js et api/media.js
import webpush from 'web-push';
import { sql } from './_db.js';

// ponytail: clés VAPID générées au premier appel et gardées en base (aucune variable à configurer sur Vercel).
// Les passer en variables d'environnement si la base devait un jour être lisible par d'autres.
let keys;
export function vapid() {
  return keys ??= (async () => {
    await sql`create table if not exists settings (key text primary key, value jsonb not null)`;
    await sql`create table if not exists push_subs (endpoint text primary key, user_id text not null, sub jsonb not null)`;
    await sql`insert into settings (key, value) values ('vapid', ${JSON.stringify(webpush.generateVAPIDKeys())}) on conflict do nothing`;
    const [{ value }] = await sql`select value from settings where key = 'vapid'`;
    webpush.setVapidDetails('https://voyage-ten-rho.vercel.app', value.publicKey, value.privateKey);
    return value;
  })().catch(e => { keys = null; throw e; });
}

// Prévient tous les téléphones abonnés des personnes du voyage (propriétaire et participants), sauf l'auteur.
// Ne fait jamais échouer l'ajout du média : les erreurs d'envoi sont ignorées, les abonnements morts supprimés.
export async function notifyTrip(trip, author, kind) {
  try {
    await vapid();
    const subs = await sql`
      select endpoint, sub from push_subs where user_id <> ${author.id} and (user_id = ${trip.user_id}
        or user_id in (select user_id from trip_members where trip_id = ${trip.id}))`;
    const what = { img: 'une photo', vid: 'une vidéo', aud: 'un audio', note: 'une note' }[kind];
    const payload = JSON.stringify({ title: trip.name, body: `${author.name || 'Quelqu’un'} a ajouté ${what}`, tripId: trip.id });
    await Promise.all(subs.map(s => webpush.sendNotification(s.sub, payload, { TTL: 86400 }).catch(e =>
      [404, 410].includes(e.statusCode) && sql`delete from push_subs where endpoint = ${s.endpoint}`)));
  } catch (e) { console.error('push', e); }
}
