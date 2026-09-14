addEventListener('install', () => self.skipWaiting());

addEventListener('activate', () => self.clients.claim());

declare const self: ServiceWorkerGlobalScope;

export {};
