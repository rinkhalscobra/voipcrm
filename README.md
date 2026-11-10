# Voixel telecom workspace

A working Next.js application for a multi-tenant VoIP reseller, backed by Supabase Auth and PostgreSQL. The web application targets Vercel; a separate Node.js process runs the persistent synchronization queue.

The initial foundation, administration, multi-account read integration, allocation workflows, and financial primitives are implemented. The connected project runs in **live mode** with a verified TelTel account in EUR. The synthetic dataset, including its companies, employees, calls, and financial records, has been permanently removed. Remaining integration and production work is tracked in [Implementation status](docs/IMPLEMENTATION_STATUS.md).

## Run locally

Requirements: Node.js 22 or newer, npm, and a Supabase project.

```powershell
npm install
# For a new checkout only; preserve an existing configured .env.
Copy-Item .env.example .env
# Fill in .env, then:
npm run migrate
npm run bootstrap
npm run dev
```

Open **http://127.0.0.1:3000**. In another terminal:

```powershell
npm run worker
```

The current workspace already has a configured, ignored `.env` and applied migrations. Do not replace that file with the example. An owner invitation has been issued to the email recorded in `BOOTSTRAP_EMAIL`. Bootstrap refuses to overwrite an existing Super Admin. Invitation and recovery email templates use `/auth/confirm`; `/auth/complete` also handles older fragment-based invitation links.

Sign in with your email and password to view synchronized TelTel inventory, balance, and calls. Companies contain separate client identities. The configured structure is Hinvest Berlin with Client1, plus Company 2 and Company 3 with no clients, staff, numbers, or calls. The company TelTel account email is separate from the client's independent login email. Client1 keeps its current assigned number and call history, and signs in to `/client` with access only to its own records. Assign future numbers through the company's Numbers tab using **Assign client**. Company and client names can be edited independently.

From **Admin → Clients → Edit client**, authorized platform administrators can change the client name, login email, password, and login status. Email/password changes apply immediately in Supabase Auth. Leave **New password** blank to retain it. Suspending a client blocks both new logins and application access from existing sessions; reactivation restores access. The editor also links to number assignment and balance/rate controls. Auth and application account changes are atomic, and audit events never contain plaintext passwords.

Use the sun/moon button in the header or on the login screen to switch themes. **Settings ? Appearance** offers **Light**, **Dark**, and **System**. The choice is saved in this browser, shared across tabs, and applied before the page renders. System mode follows device appearance changes. Public pages, every workspace, dialogs, forms, charts, and feedback states use the same palette.

**Client balances** are separate retail credit accounts, starting at zero. Administrators can set available balances, add/remove credit, and set the Germany rate. Clients see only their own balance and ledger. New completed outbound Germany calls cost **EUR 0.0442/minute**, prorated by TelTel `handle_sec` talk time, with no ringing-time charge or connection fee. Each call rounds to six decimal places; an hour costs EUR 2.652. Billing starts at each wallet's activation timestamp, so previous history is not charged. The worker waits 60 seconds after completion, preserves recorded rates, and appends differences/refunds for duration corrections without charging a call twice. Insufficient credit leaves unpaid usage visible and available credit non-negative; later credit settles it. TelTel funds remain visible only to platform administrators and are never changed by retail credit operations.

**Registration is available at `/register` and from the login page.** Each registration creates a separate trial company, an empty wallet, and a company-admin membership. An invitation is required to join an existing company. Demo registrations can sign in immediately; live registrations require email confirmation. Authentication uses email and password; authenticator enrollment and verification are disabled.

The requested additional Super Admin can be provisioned with `npm run admin:demo`, which reads `DEMO_ADMIN_EMAIL` and `DEMO_ADMIN_PASSWORD` from the ignored `.env`. The initializer verifies the password and full platform role.

The requested transition has been completed with migration `202611090012_remove_demo_data.sql` and matching environment/authentication configuration. The live provider stores its API key encrypted in Supabase. The ignored `.env` also retains the server-only onboarding key and confirmed currency.

For subsequent data-mode maintenance, the operator can use:

```powershell
node --env-file=.env scripts/switch-data-mode.mjs live
```

Restart the web app and worker and fully refresh the browser after changing modes. The mode-switch script preserves data; the separately applied cleanup migration permanently removed the previous synthetic dataset. The first real provider has verified balance, users, devices, DIDs, calls, and status definitions. Call synchronization covers a rolling seven-day window.

## Environment

All values belong in the project-root `.env`; it is excluded from Git. `DATA_MODE=demo` selects synthetic records; `DATA_MODE=live` selects operational records. The data-mode script keeps the environment and database settings aligned.

| Variable                        | Use                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL                                                             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable key; the variable retains the SDK's legacy naming           |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase secret key, server and worker only                                      |
| `SUPABASE_ACCESS_TOKEN`         | Management API token for local migration and verification scripts only           |
| `PROVIDER_ENCRYPTION_KEY`       | 32 random bytes encoded as base64; identical on web and worker                   |
| `TELTEL_API_KEY`                | Server-only local onboarding source; runtime uses encrypted database credentials |
| `TELTEL_ACCOUNT_CURRENCY`       | Confirmed upstream account currency, currently EUR                               |
| `TELTEL_PROVIDER_ACCOUNT_ID`    | Identifier of the configured live upstream account                               |
| `APP_URL`                       | Canonical origin, such as `http://127.0.0.1:3000` or the deployed HTTPS origin   |
| `NEXT_PUBLIC_PLATFORM_NAME`     | Default white-label platform name                                                |
| `BOOTSTRAP_EMAIL`               | Initial owner email                                                              |
| `BOOTSTRAP_PASSWORD`            | Optional initial password; omission sends an invitation                          |
| `WORKER_POLL_MS`                | Persistent queue poll interval, default 5000                                     |
| `WORKER_SYNC_INTERVAL_SECONDS`  | Provider sync schedule, default 300                                              |

Generate an encryption key once with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Preserve it across deployments and backups; replacing it without re-encrypting stored credentials makes the old ciphertext unreadable.

## Project structure

```text
src/
  app/
    [workspace]/[[...section]]/  Role-specific operational pages
    api/[...path]/              Authenticated REST routes
    auth/                      Email verification, password reset, and legacy redirects
    login/                     Invitation-only login
  components/
    ui/                        shadcn-style Radix/cva primitives
    dashboard.tsx              Synchronized operational dashboard
    resource-page.tsx          Companies, calls, numbers, users, pricing, billing
    providers-page.tsx         Encrypted account configuration and sync activity
    wallets-page.tsx           Prepaid wallets and immutable ledger
    dialer.tsx                 Controlled callback interface
  lib/
    auth/                      Server authorization and role scopes
    api/                       Validation, response contracts, scoped queries
    billing/                   Decimal-safe rating and invoice calculations
    providers/                 TelTel contracts, client, synchronization
    reports/                   CSV, XLSX, and PDF generation
    security/                  AES-GCM credentials and payload redaction
    supabase/                  Browser and request-scoped server clients
  proxy.ts                     Supabase session refresh
supabase/
  migrations/                  Versioned schema, policies, transactional RPCs
  config.toml                  Local Supabase configuration
worker/index.ts                Persistent queue consumer and scheduler
scripts/                       Migration, bootstrap, verification, dev-only seed
tests/                         PostgreSQL, authorization, provider, billing, browser
docs/provider/                 Downloaded official OpenAPI snapshot
```

## Data and security model

- Server routes verify the authenticated user and permissions using the password session. Session refresh alone never grants access. Authenticator checks are removed from the app and database policies; role, tenant, and suspension checks remain enforced.
- Every public application table has RLS enabled. Tables without an explicit client grant remain inaccessible to client tokens.
- Companies are administrative containers; clients are named end users inside them. The `clients` table and `client` role are separate from company staff and administrators. Company pages open to their client list, and clients use a restricted workspace with their own numbers, calls, and exports. Company 2 and Company 3 are intentionally empty placeholders requested by the owner.
- Provider credentials are kept in a private table, encrypted with AES-256-GCM and authenticated to their account UUID. Worker secret retrieval is restricted to the service role.
- Customer call responses exclude upstream account IDs, wholesale cost, raw provider metadata, and recording references. Provider user payloads are recursively stripped of API keys and passwords before persistence.
- Managers and team leaders see only their captured call scope; agents see their own calls. Historical allocation and call ownership survive employee moves and DID reassignment.
- Provider balances and customer wallets are separate funds. Amounts use PostgreSQL `numeric(20,6)` and decimal arithmetic. No automatic foreign exchange is performed.
- Wallet operations and number allocations are PostgreSQL transactions. Wallet retries use idempotency keys; active DID allocation is exclusive. Ledger entries, audit events, pricing versions, and rated charges cannot be edited.
- A call is imported once per `(provider_account_id, provider_resource_id)`. Unresolved ownership creates a billing exception. Imported call costs are not automatically treated as final.
- Client ownership uses explicit number assignments within their effective dates. Incoming calls match TelTel's original dialed DID (`caller.dnid`) even when the destination is a shared SIP device. Company email/user identities never grant a client access to the entire TelTel account. Legacy verified provider-user links remain available for staff; client number reassignment preserves already recorded ownership.
- Call exports enforce row scope and export permission in a database RPC, avoiding silent truncation by the REST row limit. CSV and XLSX values are protected against spreadsheet formula injection.
- Demo/live markers are inherited from resource ownership. Database triggers reject cross-mode writes and mixed allocations. The database blocks provider-secret retrieval and job claiming in demo mode, including for a stale worker process.
- State-changing routes require the configured origin, JSON input, Zod validation, and a database-backed rate limit. Provider failures return sanitized codes and correlation IDs.

No browser softphone, live call presence, or guaranteed SIP-call cutoff is claimed.

## Daily workflows

1. Create a company; an empty wallet is created in the same transaction.
2. Invite its administrator and employees. Employees belong to one company; department/team membership defines their scope.
3. Import numbers from a verified upstream account and allocate them to the company. Removing an allocation never releases the upstream DID.
4. Assign employees, configure allowed calling prefixes, then verify the upstream identity mapping before enabling callbacks. The callback path remains closed unless all stored authorization prerequisites exist.
5. Add customer credit only after checking the actual payment. This changes the customer ledger, never the upstream balance.
6. Create a retail pricing plan, then review complete call records and select **Review billing** to confirm finality and charge them. No rate is inferred from the provider's wholesale cost.
7. Issue invoices and record payments with their real bank/payment reference. Partial payments do not mark an invoice paid.

## Validation

```powershell
npm run typecheck
npm test
npm run test:browser
npm run build
npm run verify:secrets
npm run verify:live
```

Browser tests start a separate unconfigured server on port 3100 and do not contact the live Supabase database. `verify:live` runs actual PostgreSQL tenant and finance checks inside a transaction and rolls all fixture records back. `scripts/verify-browser-live.mjs` tests actual Supabase password-only login and the admin API against a running port-3000 app, then removes its temporary identity. `scripts/verify-password-login.mjs` verifies the configured Big Boss account and confirms that the old authenticator route redirects to the dashboard.

The PostgreSQL unit suite uses PGlite. Concurrent promise tests verify serialization and idempotency in that engine; they do not replace a multi-connection PostgreSQL load test. Synthetic fixtures run in the isolated test database. The connected Supabase project contains live data only; `npm run seed:demo` refuses to initialize a project containing live providers or companies. Cleanup tests verify permanent removal of synthetic records, preservation of live wallets and administrator identities, and restoration of immutable-record protections.

## Deploy

See [Deployment and recovery](docs/DEPLOYMENT.md) for Vercel, worker hosting, mail setup, backup, and migration procedures. See [Provider contract notes](docs/PROVIDER_CONTRACT.md) for confirmed schemas, limits, and disabled capabilities.
#   v o i p c r m  
 