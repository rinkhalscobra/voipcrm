# Implementation status

The application is functional where a workflow is listed as implemented. Data-dependent pages show persisted database values. At the user's request, the connected project now uses live TelTel data in EUR. All tagged synthetic records and sample authentication identities have been permanently removed, while both Super Admin accounts remain.

## Implemented

- Platform-wide Light, Dark, and System appearance modes. Header/login controls and **Settings → Appearance** update public pages, all workspaces, dialogs, forms, tables, badges, charts, and loading/error states. Preferences persist in the browser, synchronize across tabs, follow OS changes in System mode, and apply before hydration to prevent a theme flash. Theme controls also work without browser storage.
- Next.js App Router, TypeScript, Tailwind, Radix/shadcn-style UI primitives, Lucide, TanStack Query, Recharts.
- Supabase email/password authentication, isolated new-company registration, staff invitations, recovery, password change, and session refresh. Authenticator enrollment and verification are disabled, and existing enrolled factors have been removed at the user's request.
- Nineteen SQL migrations, 57 public application tables, RLS, private credential/payload tables, and server-side permission checks.
- Database-enforced demo/live isolation and an atomic cleanup migration that permanently removes tagged synthetic data, checks live-row preservation, and retains immutable-ledger protections.
- Super Admin/company/client/manager/team leader/agent routes and scoped navigation.
- Companies contain clients as separate entities and roles. Hinvest Berlin contains Client1; Company 2 and Company 3 are empty. The company's TelTel email and the client's login email are independent. Client1 keeps its current number and calls. Number assignment is manual through **Assign client**; shared company account users never automatically confer client ownership. Company/client rename controls, client login creation, and client suspension are available; staff are listed separately.
- Platform administrators with `users.manage` can edit client names, login emails, passwords, and login status. Auth credentials, profile details, membership status, and the audit event commit together through a trusted Auth update trigger. Empty password fields preserve the existing password. Suspended clients are banned in Auth and blocked from application access, including existing sessions. No plaintext passwords appear in profiles, metadata, responses, or audit records. The editor links to company, number, and balance/rate management.
- Company creation, activation/suspension, user invitations, departments, teams, employee moves, and scoped lists.
- Encrypted provider configuration, credential replacement, connection test, sync queue, worker, independent resource synchronization, and sync activity logs.
- First live TelTel connection verified for balance, users, devices, DIDs, calls, and status definitions, with EUR confirmed by the owner.
- Verified upstream-email linking for company staff, time-aware client number assignments, inbound `caller.dnid` matching, company inventory containing unassigned numbers, and preservation of existing call snapshots. The first real client can sign in and see its own calls and allocated DID.
- DID inventory, exclusive company allocations, employee assignments, preserved allocation history, and captured call scope.
- Call import, account-scoped deduplication, unresolved-ownership exceptions, filtered call history, details, and authorized CSV/XLSX exports.
- Callback request validation, account/tenant/device/allocation/country/wallet gates, idempotency, request feedback, and private favorite contacts.
- Atomic customer credits/debits, immutable ledger, reversal RPC, decimal-safe rating, pricing snapshots, one charge per call, invoice issuance, payment recording, and PDF generation.
- Separate per-client retail wallets, administrator credit/set-balance controls, own-client ledger visibility, versioned Germany rates, and automatic billing of new completed outbound calls by actual talk seconds at EUR 0.0442/minute. Pre-activation history is excluded. Duplicate imports do not duplicate charges; duration corrections append debit/refund differences. Unpaid usage settles from later credit without making available balances negative. TelTel/company wallets are unaffected.
- Synchronized dashboards and bounded-sample reports; sample limits are labeled.
- In-app synchronization failure notifications and immutable audit events for implemented sensitive workflows.
- White-label platform-name/support settings and dedicated deployment/verification scripts.

## Needs credentials or operator configuration

- Client credit top-ups and verified caller-ID permissions before callbacks are enabled; rates for destinations beyond the configured Germany plan, and additional customer mappings beyond the first provisioned client.
- Deployment URL, Vercel project, persistent worker host, production email delivery settings, and production backup/monitoring ownership.

## Further implementation required

- Additional provider-finality/reconciliation policies, wholesale adjustments, rental/subscription billing, credit notes, invoice charge grouping, automated billing cycles, payment gateway integration, and full financial reporting. The configured client policy bills completed answered Germany calls after a 60-second settling interval; legacy company/staff rating remains explicit.
- Rich pricing-plan version editing, volume tiers, full destination-rate import, fees beyond the implemented connection/per-minute rules, and FX policy. Each current pricing-plan creation produces an immutable first version.
- A supported DID order ID/reconciliation contract and the upstream purchasing workflow; customer number requests are internal drafts only.
- Paid HLR workflow and quota/retail charging; provider status-definition CRUD; upstream user/group assignment controls; device/identity provisioning UI.
- Signed provider webhooks, live event handling, browser WebPhone, additional call control, and recording playback/retention permissions.
- Full analytics dimensions, unbounded database aggregates, asynchronous large exports, and historical call backfill beyond the rolling seven-day window.
- Configurable alert evaluation, wallet/provider balance thresholds, fraud detection, transactional operational emails, and external error monitoring/alert delivery.
- Full permission-configuration UI, platform-operator invitation workflow, optional IP restrictions, and read-only audited support impersonation.
- Configurable data-retention jobs, deletion/anonymization procedures, legal/consent review, and non-Latin invoice fonts.
- Multi-connection concurrency and load tests, 100–500-company capacity measurements, independent migration/security review, restore drills, and deployment verification.

The completed tests establish the documented checks, not a blanket claim of production readiness or regulatory compliance.
