// service worker mínimo: permite "Adicionar à tela inicial" (PWA). Sem cache de API.
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => self.clients.claim());
self.addEventListener('fetch', e => {});
