/** `event.fail` error code for an account that has never been through Cloudflare's Zero Trust onboarding - the UI swaps the raw API message for a link to finish it. Client-safe on purpose (no `cloudflare` import); the server-side detection is `isZeroTrustUninitialized` in `list-sync.ts`. */
export const ZERO_TRUST_UNINITIALIZED = 'zero-trust-uninitialized';
