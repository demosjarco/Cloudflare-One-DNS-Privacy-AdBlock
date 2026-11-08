# Cloudflare One DNS Privacy AdBlock

Pi-hole style privacy/ad blocking in the cloud, powered by Cloudflare One.

## What this is

A configuration webapp that imports blocklists (Pi-hole compatible lists to start, more list formats planned) and turns them into [Cloudflare One](https://dash.cloudflare.com/?to=/:account/one) Gateway [Lists](https://developers.cloudflare.com/cloudflare-one/policies/gateway/lists/), plus the matching DNS and/or HTTP policies to enforce them. Point your device's DNS (plain DNS, DoH, or DoT) at your own Cloudflare Zero Trust account for DNS-level blocking; HTTP policies additionally require the [WARP client](https://developers.cloudflare.com/cloudflare-one/connections/connect-devices/warp/) so Gateway can see and filter HTTP(S) traffic. Either way you get Pi-hole style blocking without running or maintaining a Pi-hole yourself - enforced on Cloudflare's network instead of a box on your LAN, and you can take advantage of this tool within Cloudflare's free tier.

## Cloudflare account limits

Gateway [Lists](https://developers.cloudflare.com/cloudflare-one/account-limits/) are an account-wide resource, so the limits below are shared across every list on the account - including any you already have outside this tool, not just the ones it creates.

| Limit             | Free  | Pay-as-you-go | Enterprise |
| ----------------- | ----- | ------------- | ---------- |
| Lists per account | 100   | 100           | 100[^1]    |
| Entries per list  | 1,000 | 1,000         | 5,000[^1]  |

[^1]: These limits may be increased on Enterprise accounts. To request a limit increase, contact your account team.

## Privacy model

This app has no backend database and no server-side storage for your lists or policies - those live entirely in **your own** Cloudflare One account. Sign-in is handled via Cloudflare OAuth with a JWT session strategy, so your session and the Zero Trust API token used on your behalf are held only in an encrypted session cookie in your browser, never written to a database. Local settings/state stay on-device. Nothing about your lists or policies is retained by any server run by this project.

## Keeping lists in sync

Once imported, lists need to stay current. There are two update paths:

- **Automatic**: a service worker using the [Web Periodic Background Sync API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API) re-syncs each list in the background, without you needing the tab open. Every list has its own **Auto refresh** switch (on the lists table and on the list's page); a list is switched on in the browser that created it, and each browser keeps its own set - the switch is the browser's periodic-sync registration itself, nothing else stores it. Support is feature-detected: the app tells you when your browser lacks the API, or has it but needs the app installed as a PWA first (as of writing, only Chromium-based browsers implement it, and only for installed apps). How often it runs is up to the browser: the app asks for once a day, and Chrome spaces the runs by at least 12 hours multiplied by a site-engagement factor, pauses them for sites you stop using, and on desktop only runs them while the browser is open.
- **Manual**: **Refresh all** on the lists table, or **Refresh** on a list's page, for whenever you don't want to wait on the schedule, or on browsers without periodic sync support.

> **Status**: early development. Progress is tracked on the [project board](https://github.com/users/demosjarco/projects/2).

## Legal

This site is not affiliated with, sponsored by, or endorsed by Cloudflare, Inc. This is an independent, unofficial tool that uses the public Cloudflare API on your behalf, under your own Cloudflare account and API credentials.

Licensed under the [MIT License](./LICENSE).
