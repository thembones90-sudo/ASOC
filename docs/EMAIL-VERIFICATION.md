# ASOC Player Email Verification

New Little Hero accounts require a real email address and must confirm it before login.
Existing legacy identities remain valid and are treated as already verified.

## Production variables

- `ASOC_EMAIL_VERIFICATION=1`
- `ASOC_EMAIL_PROVIDER=postmark` or `resend`
- Postmark: `ASOC_POSTMARK_SERVER_TOKEN=<secret>`
- Resend: `ASOC_RESEND_API_KEY=<secret>`
- `ASOC_EMAIL_FROM=ASOC <verified-sender@example.com>`
- `ASOC_PUBLIC_BASE_URL=https://asoc-live-production.up.railway.app`

Postmark is the quickest path when no custom mail domain exists: confirm one sender
signature address in Postmark, then use that exact address in `ASOC_EMAIL_FROM`.
Resend is also supported, but real-user delivery normally requires a verified sending domain.

Optional:
- `ASOC_EMAIL_VERIFY_TTL_MS` defaults to 60 minutes.
- `ASOC_EMAIL_RESEND_COOLDOWN_MS` defaults to 60 seconds.
## Flow

1. Player chooses NEW HERO? CREATE ID.
2. Registration accepts email, password, and Little Hero designation.
3. Server stores a salted PBKDF2 password hash and only a SHA-256 digest of the verification token.
4. No player session token is issued yet.
5. Verification email links to `/api/auth/player/verify?token=...`.
6. Successful verification redirects to `/join.html?verified=1`.
7. Player signs in normally and receives the persistent player session token.

Unverified login returns `EMAIL_NOT_VERIFIED`. The UI exposes RESEND VERIFICATION.
Registration fails closed with `EMAIL_SERVICE_UNAVAILABLE` when verification is required
but no mail provider is configured.

## Tests

`tests/email-verification.js` uses the isolated test mail transport and covers:
register -> blocked login -> emitted verification link -> verification -> successful login.
The normal regression suite disables email verification only for its pre-existing fixture identities.
