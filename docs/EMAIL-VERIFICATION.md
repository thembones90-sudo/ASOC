# ASOC Player Email Verification

## Current production status — 2026-09-20 handoff

Production uses https://asocengine.com and https://asocengine.com/join.html.
Postmark sender domain asocengine.com has verified DKIM and Return-Path.
API connectivity and delivery from verify@asocengine.com to the forwarded admin
inbox succeeded. External recipient approval is STILL pending; external Gmail
was explicitly rejected. This records the latest handoff, not a new provider check.

Keep `ASOC_EMAIL_VERIFICATION=0` until Postmark permits external recipients and
external delivery has been tested. Verified sender DNS alone is insufficient.
Current non-secret configuration:

- `ASOC_EMAIL_VERIFICATION=0`
- `ASOC_EMAIL_PROVIDER=postmark`
- `ASOC_EMAIL_FROM=ASOC <verify@asocengine.com>`
- `ASOC_PUBLIC_BASE_URL=https://asocengine.com`
- `ASOC_POSTMARK_SERVER_TOKEN` is configured privately; never print or commit it.

When verification is disabled, registration accepts email or legacy identity IDs
and records accounts as verified. Existing legacy accounts remain compatible.
Enabling verification later does not retroactively verify those email addresses.
WebSocket joining rechecks the current account before entering MASTER. With
verification enabled, pending accounts are rejected and their presented tokens
invalidated, including persisted tokens issued while the toggle was off. Legacy
accounts and accounts registered with verification disabled remain eligible under
auth-store semantics; this does not prove email ownership. Missing accounts are
rejected; unavailable storage fails closed without revoking sessions during an outage.

## Enabled flow (after delivery readiness)

With `ASOC_EMAIL_VERIFICATION=1`, new accounts require a real email address.
Registration stores salted PBKDF2 credentials and only a SHA-256 digest of a
random verification token. No session is issued until verification and login.
The email link uses `/api/auth/player/verify?token=...`, then redirects to
`/join.html?verified=1`. Pending login returns `EMAIL_NOT_VERIFIED`; the UI
supports resend. Missing provider configuration fails registration closed with
`EMAIL_SERVICE_UNAVAILABLE`.

Token lifetime defaults to 60 minutes (`ASOC_EMAIL_VERIFY_TTL_MS`); resend cooldown
defaults to 60 seconds (`ASOC_EMAIL_RESEND_COOLDOWN_MS`). Resend is an alternative
implemented transport, not the current production provider.

## Storage and tests

Auth writes use private temporary files, fsync and atomic rename, retaining a
validated one-write-behind `.bak`. Missing/corrupt main data can recover from a
validated backup; corrupt data is quarantined before replacement. Unreadable
storage or unusable main/backup data fails explicitly without overwriting it.
Recovery can lose the latest write; preserve files and restore a known-good copy
when manual repair is needed. Do not delete both files to bypass protection.

`tests/auth-store-protection.js` covers durability and compatibility.
`tests/email-verification.js` uses an isolated test transport to cover registration,
blocked login, verification, successful login, and persisted WebSocket sessions
across disabled/enabled verification transitions, including legacy compatibility.
No real email is sent by tests.

## Forgot password

The Little Hero login has **FORGOT PASSWORD?**. It uses the same email provider as verification.

- `POST /api/auth/player/forgot-password` `{ email }` always answers the same generic message (no account enumeration). Unknown emails send nothing; one request per account per resend cooldown.
- The email links to `/join.html?reset=<token>`; the page scrubs the token from the address bar and shows NEW PASSWORD / CONFIRM.
- `POST /api/auth/player/reset-password` `{ token, password }`: tokens are single-use, stored only as a SHA-256 digest, and expire after 30 minutes (`ASOC_PASSWORD_RESET_TTL_MS`, minimum 5 minutes). A reset signs out every existing session of that account and completes a pending email verification.
- Both endpoints are throttled per client (6 link requests / 12 attempts per 15 minutes).
- `ASOC_PUBLIC_BASE_URL` must be set in production so reset links are never built from a spoofable Host header.
