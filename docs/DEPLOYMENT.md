# Deployment and recovery

## Supabase

The supplied project uses `DATA_MODE=live` in `.env` and the matching database setting, with one verified TelTel account in owner-confirmed EUR. Migration `202611090012_remove_demo_data.sql` permanently removed all tagged synthetic data and the thirty sample authentication users, preserving both Super Admin accounts. `switch-data-mode.mjs` changes modes while preserving records; it does not perform this cleanup. Restart processes and fully refresh the browser after mode changes.

1. Use an isolated project for development. Production migrations run against the configured project and record their versions in `supabase_migrations.schema_migrations`.
2. Store the project URL, publishable key, secret key, management token, and encryption key in the ignored root `.env`. Use `npm run migrate` for this workspace; it applies unapplied local migration files transactionally and reloads PostgREST schema metadata.
3. `node --env-file=.env scripts/configure-auth.mjs` enables new-company registration, an eight-character minimum password length, password-only authentication, and the canonical origin. With custom SMTP configured, it also applies Voixel email subjects, sender name, and SSR-compatible templates; the default Supabase email provider retains its built-in templates. Authenticator enrollment and verification remain disabled. Demo mode permits immediate sign-in; live mode requires email confirmation. The data-mode switch reapplies these auth settings. Changes may take several seconds to propagate.
4. Set `BOOTSTRAP_EMAIL` and run `npm run bootstrap`. Without a bootstrap password, Supabase sends an invitation. The owner signs in using email and password.
5. Configure a production SMTP provider in Supabase before inviting customers at scale. Confirm delivery, invite and recovery links, rate limits, and domain authentication using an actual mailbox.

## Vercel web application

1. Import the repository as a Next.js project. Use Node.js 22 or a compatible newer runtime, install with `npm ci`, and build with `npm run build`.
2. Set the two `NEXT_PUBLIC_SUPABASE_*` values, the server-only `SUPABASE_SERVICE_ROLE_KEY`, `PROVIDER_ENCRYPTION_KEY`, canonical HTTPS `APP_URL`, and default platform name. Public variables are embedded at build time.
3. Do not supply the management access token to the web deployment; it is only needed for operator-side migration/configuration tasks.
4. Apply reviewed migrations before serving the matching application version. Build with the deployment environment and check that `npm run verify:secrets` finds no server secrets in browser artifacts.
5. Run `configure-auth.mjs` with the deployed `APP_URL` and verify invitation, recovery, password login, and role-based redirects from the deployed origin.
6. Test tenant isolation and critical workflows in staging before admitting production traffic. Do not treat a local build as evidence of a deployed service.

The web app is not deployed to Vercel by this repository setup; Vercel account/project access has not been configured.

## Persistent worker

Run one or more persistent Node.js processes outside Vercel functions:

```text
npm ci
npm run worker
```

Supply `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, the same `PROVIDER_ENCRYPTION_KEY` and `DATA_MODE` as the web app, plus the polling/schedule intervals. The worker pauses synchronization in demo mode, and the database separately blocks secret retrieval and job claims. The npm command reads `.env`; a managed host can provide that file from a secret store or run `npx tsx worker/index.ts` with environment variables injected directly. The management token and public publishable key are not required by the worker.

Use a process supervisor with restart-on-failure and graceful SIGTERM. Monitor heartbeat absence, queue age, expired leases, failed resources, job attempts, and provider latency. Jobs are at-least-once; account/resource keys and call composite keys make imports idempotent. Global provider throttling and measured worker concurrency should be configured after the provider's actual account limits are confirmed.

The current Windows workstation runs a local background worker with a five-minute synchronization interval. Its process ID is recorded in `.runtime/worker.pid`, with output in `.runtime/worker.stdout.log` and `.runtime/worker.stderr.log`; this directory is ignored by Git. This local process is separate from a managed production worker deployment.

`Dockerfile.worker` also builds a non-root Node.js worker image with runtime dependencies only. Inject the three required secrets as runtime environment variables; `.dockerignore` excludes environment files from the image build context. No application credentials are baked into that image.

The present scheduler imports the last seven days of calls. Establish a reviewed historical backfill procedure before relying on complete historical reporting. Failed imports and billing exceptions require operator review; no failed provider operation is silently converted into success.

## Backups and key recovery

- Configure database backups/PITR appropriate to the Supabase plan and perform a restore drill in a separate project.
- Back up the provider encryption key in a separate secret store. Database ciphertext cannot be recovered without it.
- Restore the database and matching migration history, configure the original encryption key, verify authentication configuration and email templates, then test one upstream connection before resuming workers.
- Pause workers during coordinated restores and billing reconciliation. Inspect durable jobs and idempotency records before resuming uncertain callbacks or financial requests.
- Correct financial mistakes with reversal/correction records; do not delete ledger history. A reversal that would overdraw a wallet is rejected and requires reconciliation.
- Add and verify retention/anonymization policies before storing real recording URLs or customer data at operational scale.

## Observability

Application logs are structured JSON with allowlisted IDs, resource names, counts, durations, and error codes. API failures include a request ID. Raw provider errors, credentials, headers, recording URLs, and destinations are not logged. Connect web and worker logs to an external monitoring service and establish alert routing before production use; an external monitoring account is not configured by this codebase.

## Release verification

- Unit/database/document tests, typecheck, production build, dependency audit, browser tests, and bundle-secret scan.
- Actual Supabase password-only login and each authenticated admin API module.
- First TelTel balance, users, devices, DIDs, and calls against genuine credentials, followed by account-specific error and retry verification.
- Separate-company isolation through direct REST access and API exports, historical reassignment, financial idempotency, multi-connection competing debits, and invoice/payment reconciliation.
- Worker recovery after termination, queue retry behavior, provider downtime, missing mappings, and unresolved billing records.
- SMTP delivery, backups, restore procedures, HTTPS origin checks, and an appropriate independent security/load review.
