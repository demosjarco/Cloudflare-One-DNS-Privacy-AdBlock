# Cloudflare One DNS Privacy AdBlock

Pi-Hole Style Privacy/Ad blocking in the cloud leveraging CF ZT DNS

This is a configuration webapp that allows you to import pi-hole compatible lists and it will create the matching policies (DNS and/or HTTP) and reusable list(s) in your [Cloudflare One](https://dash.cloudflare.com/?to=/:account/one) account (You can take advantage of this tool within CF's free tier plan). This webapp stores nothing server-side, only in your Cloudflare account and cron runs locally in your browser (via Service Worker's Web Periodic Background Synchronization).
