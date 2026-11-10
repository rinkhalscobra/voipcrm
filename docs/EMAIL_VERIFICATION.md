# Registration email verification

New registrations receive a six-digit, single-use code from **Voixel <support@voixel.xyz>**, with the subject **Verify your email address | Voixel**. Verification, recovery, and invitation emails share the same branded layout, clear action, inbox preview text, and account-security footer. Entering the code at `/auth/verify` confirms the address and creates the browser session. Unverified users cannot sign in with their password. Existing confirmed accounts continue to use password login.

The verification page can be reopened from **Verify email** on the login page. It supports requesting another signup code, correcting the email being verified, and returning to registration when a different account address is needed. Only the pending email and resend deadline are retained in session storage; passwords and codes are never stored there.

## SMTP configuration

The ignored `.env` contains `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`, and `SMTP_RATE_LIMIT_PER_HOUR`. The configured service uses authenticated TLS on port 465. Credentials remain on the server and in Supabase Auth settings.

Run `npm run configure:auth` after changing SMTP settings or `APP_URL`. This applies the mailbox, sender, signup code template, existing recovery/invitation templates, email confirmation requirement, and sending limits to the connected Supabase project. A hosting deployment uses its actual origin in `APP_URL`.

Supabase sends the emails and owns code generation, expiry, confirmation state, and single-use consumption. Application code never generates or records verification codes. Shared code settings are in `src/lib/auth/email-verification-settings.json`: six digits, ten-minute expiry, and a sixty-second resend cooldown. `supabase/config.toml` and `supabase/templates/confirmation.html` provide equivalent local-development behavior.

## API and checks

- `POST /api/auth/register`: existing isolated workspace registration followed by the verification step.
- `POST /api/auth/verify-email`: strict email/code validation, bounded attempts by hashed email and IP, Supabase verification, and session cookies.
- `POST /api/auth/resend-verification`: existing signup confirmations only, sixty-second cooldown, hourly email/IP limits, and a generic response that does not disclose account existence.

All endpoints enforce the existing origin check. Codes and SMTP details are absent from responses and application logs. Invalid, expired, or reused codes do not grant a session. Delivery and throttling errors are shown in the form.

`npm test` covers input validation, code handling, response confidentiality, delivery failures, resend limits, and signup integration. Browser checks cover both themes, mobile layouts, pending-email restoration, and closed access without configuration. `npm run verify:secrets -- .next-browser-tests` checks the production browser-test build for the SMTP password and other configured server secrets.
