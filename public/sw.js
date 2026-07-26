/*
 * Minimaler Service Worker — der einzige Grund für seine Existenz sind
 * Benachrichtigungen auf iOS: Safari kennt den `new Notification(...)`-
 * Konstruktor nicht und zeigt Benachrichtigungen ausschließlich über
 * ServiceWorkerRegistration.showNotification(). Dafür braucht es eine
 * registrierte Service Worker.
 *
 * Bewusst OHNE Caching. Ein Cache würde am Spieltag mehr Ärger machen als
 * Nutzen bringen: Eine kurzfristige Korrektur an der Story oder den
 * Koordinaten käme auf den Geräten schlicht nicht an.
 */

self.addEventListener('install', () => {
  // Sofort übernehmen, statt auf das Schließen aller Tabs zu warten.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Läuft die App schon irgendwo, dorthin wechseln statt neu öffnen —
      // ein zweiter Tab hätte denselben Spielstand, aber die Ortung liefe
      // doppelt.
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(self.registration.scope);
      }
      return undefined;
    })(),
  );
});
