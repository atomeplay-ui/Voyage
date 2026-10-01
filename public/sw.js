// Service worker : affiche les notifications push et ouvre le voyage au toucher
self.addEventListener('push', e => {
  const d = e.data?.json() ?? {};
  // tag : une seule notification par voyage (un import de 20 photos ne fait pas 20 notifications empilées)
  e.waitUntil(self.registration.showNotification(d.title || 'Mes voyages', { body: d.body, tag: `trip-${d.tripId}`, data: d.tripId, icon: '/icon.svg' }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = `/#${e.notification.data ?? ''}`;
  e.waitUntil(clients.matchAll({ type: 'window' }).then(ws => ws[0] ? ws[0].navigate(url).then(w => w.focus()) : clients.openWindow(url)));
});
