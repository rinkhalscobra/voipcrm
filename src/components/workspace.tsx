"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowRight,
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  CreditCard,
  Database,
  FileClock,
  FileText,
  Globe2,
  Headphones,
  LayoutDashboard,
  ListOrdered,
  LoaderCircle,
  LogOut,
  Menu,
  Network,
  Phone,
  PhoneCall,
  Radio,
  Search,
  Server,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { UserContext } from "@/lib/types";
import { hasPermission } from "@/lib/auth/permissions";
import { Button } from "./ui/button";
import { Select } from "./ui/select";
import { Dialog, DialogContent } from "./ui/dialog";
import { ActionDialog, type Action } from "./action-dialog";
import { Dashboard } from "./dashboard";
import { ResourcePage, companyAction } from "./resource-page";
import { ProvidersPage } from "./providers-page";
import { WalletsPage } from "./wallets-page";
import { ClientBalancesPage } from "./client-balances-page";
import { Brand, BrandLogo } from "./brand";
import { ThemeToggle } from "./theme-controls";
import { SettingsPage } from "./settings-page";
import { Dialer } from "./dialer";
import { ErrorBanner, Toast, str, type Row } from "./shared";
import { browserDatabase } from "@/lib/supabase/browser";

interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  permission?: Parameters<typeof hasPermission>[1];
}
const adminNav: NavItem[] = [
  {
    label: "Overview",
    path: "",
    icon: LayoutDashboard,
    permission: "calls.read",
  },
  {
    label: "Companies",
    path: "companies",
    icon: Building2,
    permission: "companies.manage",
  },
  {
    label: "Provider accounts",
    path: "providers",
    icon: Server,
    permission: "providers.manage",
  },
  {
    label: "Clients",
    path: "clients",
    icon: Users,
    permission: "users.manage",
  },
  {
    label: "Phone numbers",
    path: "numbers",
    icon: Phone,
    permission: "numbers.manage",
  },
  {
    label: "Number orders",
    path: "number-orders",
    icon: ListOrdered,
    permission: "numbers.manage",
  },
  {
    label: "Call history",
    path: "calls",
    icon: PhoneCall,
    permission: "calls.read",
  },
  {
    label: "Staff & access",
    path: "users",
    icon: Users,
    permission: "users.manage",
  },
  { label: "Teams", path: "teams", icon: Network, permission: "teams.manage" },
  {
    label: "Pricing plans",
    path: "pricing",
    icon: SlidersHorizontal,
    permission: "pricing.manage",
  },
  {
    label: "Client balances",
    path: "client-balances",
    icon: Wallet,
    permission: "finance.read",
  },
  {
    label: "Billing & invoices",
    path: "billing",
    icon: CreditCard,
    permission: "finance.read",
  },
  {
    label: "Reports",
    path: "reports",
    icon: ChartNoAxesCombined,
    permission: "calls.read",
  },
];
const companyNav: NavItem[] = [
  { label: "Overview", path: "", icon: LayoutDashboard },
  {
    label: "Clients",
    path: "clients",
    icon: Users,
    permission: "users.manage",
  },
  { label: "Phone numbers", path: "numbers", icon: Phone },
  { label: "Call history", path: "calls", icon: PhoneCall },
  { label: "Dialer", path: "dialer", icon: Headphones },
  {
    label: "Staff",
    path: "users",
    icon: Users,
    permission: "users.manage",
  },
  {
    label: "Departments",
    path: "departments",
    icon: Network,
    permission: "teams.manage",
  },
  {
    label: "Number requests",
    path: "number-orders",
    icon: ListOrdered,
    permission: "users.manage",
  },
  { label: "Wallet", path: "wallet", icon: Wallet, permission: "finance.read" },
  {
    label: "Billing",
    path: "billing",
    icon: CreditCard,
    permission: "finance.read",
  },
  { label: "Reports", path: "reports", icon: ChartNoAxesCombined },
];
const agentNav: NavItem[] = [
  { label: "Overview", path: "", icon: LayoutDashboard },
  { label: "Dialer", path: "dialer", icon: Headphones },
  { label: "My numbers", path: "numbers", icon: Phone },
  { label: "My calls", path: "calls", icon: PhoneCall },
  { label: "My status", path: "profile", icon: Radio },
];
const clientNav: NavItem[] = [
  { label: "Overview", path: "", icon: LayoutDashboard },
  { label: "My balance", path: "wallet", icon: Wallet },
  { label: "My numbers", path: "numbers", icon: Phone },
  { label: "My calls", path: "calls", icon: PhoneCall },
  { label: "Dialer", path: "dialer", icon: Headphones },
  { label: "Reports", path: "reports", icon: ChartNoAxesCombined },
  { label: "My profile", path: "profile", icon: UserRound },
];
const descriptions: Record<string, { title: string; description: string }> = {
  "": {
    title: "Operations overview",
    description: "Your network, customers, and business. All in one place.",
  },
  companies: {
    title: "Companies",
    description:
      "Manage your companies, then open a company to manage its clients.",
  },
  clients: {
    title: "Clients",
    description: "Client logins, assigned numbers, and company membership.",
  },
  "client-balances": {
    title: "Client balances",
    description:
      "Set each client’s available credit and retail rates. TelTel funds stay separate.",
  },
  providers: {
    title: "Provider accounts",
    description:
      "Secure, independent connections. One unified view of your network.",
  },
  numbers: {
    title: "Phone numbers",
    description:
      "Your complete DID inventory, allocation history, and number assignments.",
  },
  "number-orders": {
    title: "Number orders",
    description: "Review number requests and manage your inventory pipeline.",
  },
  calls: {
    title: "Call history",
    description:
      "Trace every call, from its source to its authorized customer.",
  },
  users: {
    title: "Staff & access",
    description:
      "Manage company staff. Customer logins are listed under Clients.",
  },
  teams: {
    title: "Teams",
    description:
      "Organize your people without losing historical call attribution.",
  },
  departments: {
    title: "Departments",
    description: "Structure your company into focused operational departments.",
  },
  pricing: {
    title: "Pricing plans",
    description:
      "Your retail rates. Versioned, independent, and fully traceable.",
  },
  wallets: {
    title: "Customer wallets",
    description:
      "Manage prepaid funds with an atomic, immutable transaction ledger.",
  },
  wallet: {
    title: "Company wallet",
    description: "A clear view of your prepaid balance and every transaction.",
  },
  billing: {
    title: "Billing & invoices",
    description: "Transparent invoices and verified payment records.",
  },
  reports: {
    title: "Reports & analytics",
    description:
      "Understand calling performance from synchronized operational records.",
  },
  notifications: {
    title: "Notifications",
    description: "Keep track of account alerts and operational events.",
  },
  "audit-logs": {
    title: "Audit history",
    description:
      "An immutable record of sensitive actions across your platform.",
  },
  settings: {
    title: "Workspace settings",
    description: "Your brand, operational defaults, and account security.",
  },
  dialer: {
    title: "Dialer",
    description: "Connect through an authorized calling identity.",
  },
  profile: {
    title: "My profile & status",
    description: "Manage your profile and declared availability.",
  },
};
export function Workspace({
  configured,
  demo,
  context,
  workspace,
  section,
}: {
  configured: boolean;
  demo: boolean;
  context: UserContext | null;
  workspace: string;
  section: string[];
}) {
  const admin = workspace === "admin",
    base =
      workspace === "dialer"
        ? context?.platform_role
          ? "admin"
          : context?.membership?.role === "company_admin"
            ? "company"
            : (context?.membership?.role.replaceAll("_", "-") ?? "agent")
        : workspace;
  const resource = section[0] ?? "",
    [days, setDays] = useState(7),
    [action, setAction] = useState<Action | null>(null),
    [toast, setToast] = useState(""),
    [setup, setSetup] = useState(false),
    [mobile, setMobile] = useState(false),
    [command, setCommand] = useState(false),
    [search, setSearch] = useState("");
  const settings = useQuery({
    queryKey: ["public-branding"],
    queryFn: () => api<{ platform_name?: string }>("branding"),
    enabled: configured,
  });
  const nav = (
    admin
      ? adminNav
      : context?.membership?.role === "client"
        ? clientNav
        : context?.membership?.role === "agent"
          ? agentNav
          : companyNav
  ).filter(
    (n) => !context || !n.permission || hasPermission(context, n.permission),
  );
  const info =
    resource === "" && context?.client
      ? {
          title: "Client overview",
          description: `${context.client.name} · ${context.client.company_name}. Your assigned numbers and calls.`,
        }
      : resource === "wallet" && context?.client
        ? {
            title: "My balance",
            description: `${context.client.name} · Your separate client credit and calling charges.`,
          }
        : (descriptions[resource] ?? {
            title: "Page unavailable",
            description: "Choose a page from the sidebar.",
          });
  const bottom: NavItem[] = (
    [
      { label: "Notifications", path: "notifications", icon: Bell },
      {
        label: "Audit history",
        path: "audit-logs",
        icon: FileClock,
        permission: "audit.read",
      },
      { label: "Settings", path: "settings", icon: Settings2 },
    ] satisfies NavItem[]
  ).filter(
    (n) => !context || !n.permission || hasPermission(context, n.permission),
  );
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "k") {
        event.preventDefault();
        setCommand((v) => !v);
      }
      if (event.key === "Escape") setMobile(false);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
  const initials = (context?.full_name ?? "Workspace owner")
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const signOut = async () => {
    if (configured) await browserDatabase().auth.signOut();
    window.location.assign("/login");
  };
  const renderNav = (item: NavItem) => (
    <Link
      key={item.path}
      onClick={() => setMobile(false)}
      className={`nav-link ${resource === item.path ? "active" : ""}`}
      href={
        item.path === "dialer"
          ? "/dialer"
          : `/${base}${item.path ? `/${item.path}` : ""}`
      }
    >
      <item.icon size={16} strokeWidth={1.7} />
      <span>{item.label}</span>
      {resource === item.path && <i className="nav-dot" />}
    </Link>
  );
  return (
    <div className="app-shell">
      {mobile && (
        <div className="sidebar-backdrop" onClick={() => setMobile(false)} />
      )}
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <Link href={`/${base}`}>
          <Brand name={settings.data?.data.platform_name} size={80} />
        </Link>
        <Link
          className="workspace-context"
          href={`/${base}`}
          onClick={() => setMobile(false)}
          aria-label="Open workspace overview"
        >
          <span className="workspace-context-icon" aria-hidden="true">
            {admin ? <Globe2 size={15} /> : <Building2 size={15} />}
          </span>
          <span className="workspace-context-copy">
            <strong>
              {admin
                ? "Platform workspace"
                : (context?.client?.name ?? "Company workspace")}
            </strong>
            <small>
              {admin
                ? context?.platform_role === "platform_admin"
                  ? "Admin console"
                  : "Super Admin console"
                : (context?.client?.company_name ??
                  context?.membership?.role.replaceAll("_", " ") ??
                  "Authorized workspace")}
            </small>
          </span>
          <ChevronRight size={12} aria-hidden="true" />
        </Link>
        <div className="nav-section-label">
          {admin ? "WORKSPACE" : "YOUR WORKSPACE"}
        </div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {nav.map(renderNav)}
          <div className="nav-spacer" />
          <div className="nav-section-label">MANAGEMENT</div>
          {bottom.map(renderNav)}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile-button">
            <Link
              href={`/${base}/profile`}
              className="avatar"
              aria-label="Open profile"
            >
              {initials}
            </Link>
            <div>
              <strong>{context?.full_name || "Workspace owner"}</strong>
              <small>
                {configured
                  ? (
                      context?.platform_role ??
                      context?.membership?.role ??
                      "Member"
                    ).replaceAll("_", " ")
                  : "Setup required"}
              </small>
            </div>
            <button
              className="icon-button"
              style={{ marginLeft: "auto" }}
              aria-label="Sign out"
              onClick={signOut}
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-toggle"
              aria-label="Open navigation"
              onClick={() => setMobile((v) => !v)}
            >
              <Menu size={18} />
            </button>
            <Link
              className="mobile-brand"
              href={`/${base}`}
              aria-label="Voixel home"
            >
              <BrandLogo name={settings.data?.data.platform_name} size={42} />
            </Link>
            <span>{admin ? "Platform" : "Workspace"}</span>
            <ChevronRight size={11} />
            <strong>{info.title}</strong>
          </div>
          <div className="topbar-actions">
            <button className="command-search" onClick={() => setCommand(true)}>
              <Search size={14} />
              <span>Search workspace</span>
              <kbd>Ctrl K</kbd>
            </button>
            <div className="topbar-divider" />
            <ThemeToggle />
            <Link
              className="icon-button"
              href={`/${base}/notifications`}
              aria-label="Notifications"
            >
              <Bell size={16} />
            </Link>
            <Link
              className="icon-button"
              href={`/${base}/settings`}
              aria-label="Workspace settings"
            >
              <CircleHelp size={16} />
            </Link>
            <Link
              className="avatar"
              href={`/${base}/profile`}
              aria-label="Profile"
            >
              {initials}
            </Link>
          </div>
        </header>
        <main className="page-content">
          {demo && (
            <div className="demo-banner" role="status">
              <span className="badge purple">
                <Sparkles size={11} /> DEMO DATA
              </span>
              <div>
                <strong>Explore your telecom workspace</strong>
                <p>
                  Companies, calls, balances, and invoices are synthetic.
                  External provider requests and real calling are disabled.
                </p>
              </div>
              <span className="demo-banner-note">Live data stays separate</span>
            </div>
          )}
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {admin ? "CONTROL CENTER" : "YOUR CONNECTED WORKSPACE"}
              </span>
              <h1>{info.title}</h1>
              <p>{info.description}</p>
            </div>
            <div className="heading-actions">
              {resource === "" ? (
                <>
                  <Select
                    size="compact"
                    value={String(days)}
                    onValueChange={(value) => setDays(Number(value))}
                    aria-label="Dashboard date range"
                    options={[7, 30, 90].map((value) => ({
                      value: String(value),
                      label: `Last ${value} days`,
                    }))}
                  />
                  <Button
                    className="export-button"
                    size="sm"
                    variant="outline"
                    asChild
                  >
                    <Link href={`/${base}/reports`}>
                      <ArrowDownToLine size={13} />
                      Reports
                    </Link>
                  </Button>
                </>
              ) : (
                <span className={`badge ${configured ? "green" : "amber"}`}>
                  <span
                    className="status-dot"
                    style={
                      configured ? { background: "var(--success)" } : undefined
                    }
                  />
                  {demo
                    ? "Demo workspace"
                    : configured
                      ? "Configured workspace"
                      : "Setup required"}
                </span>
              )}
            </div>
          </div>
          {resource === "" ? (
            <Dashboard
              configured={configured}
              demo={demo}
              base={base}
              days={days}
              openSetup={() => setSetup(true)}
              admin={admin}
              client={context?.membership?.role === "client"}
            />
          ) : resource === "providers" && admin ? (
            <ProvidersPage
              configured={configured}
              demo={demo}
              openAction={setAction}
              notify={setToast}
            />
          ) : resource === "companies" && section[1] && admin ? (
            <CompanyDetail
              id={section[1]}
              configured={configured}
              context={context}
              openAction={setAction}
              notify={setToast}
            />
          ) : resource === "client-balances" ||
            (resource === "wallet" && context?.client) ? (
            <ClientBalancesPage
              configured={configured}
              base={base}
              clientFilter={section[1]}
              canWrite={Boolean(
                admin && context && hasPermission(context, "finance.write"),
              )}
              canSetRate={Boolean(
                admin && context && hasPermission(context, "pricing.manage"),
              )}
              openAction={setAction}
            />
          ) : resource === "wallets" || resource === "wallet" ? (
            <WalletsPage
              configured={configured}
              base={base}
              canWrite={Boolean(
                context && admin && hasPermission(context, "finance.write"),
              )}
              openAction={setAction}
            />
          ) : resource === "settings" ? (
            <SettingsPage
              configured={configured}
              admin={admin}
              notify={setToast}
              openSetup={() => setSetup(true)}
            />
          ) : resource === "dialer" ? (
            <Dialer
              configured={configured}
              base={base}
              notify={setToast}
              openAction={setAction}
            />
          ) : resource === "profile" ? (
            <Profile
              configured={configured}
              context={context}
              notify={setToast}
            />
          ) : resource === "reports" ? (
            <Reports configured={configured} base={base} />
          ) : descriptions[resource] ? (
            <ResourcePage
              resource={resource}
              base={base}
              configured={configured}
              admin={admin}
              openAction={setAction}
              notify={setToast}
              context={context}
            />
          ) : (
            <div className="notice">
              This page is unavailable. Select a workspace module from the
              sidebar.
            </div>
          )}
          <footer className="page-footer">
            <span>
              <BrandLogo size={42} decorative />
              {settings.data?.data.platform_name ??
                process.env.NEXT_PUBLIC_PLATFORM_NAME ??
                "Voixel"}{" "}
              · Secure telecom operations
            </span>
            <span>
              {demo
                ? "Synthetic demo dataset · Europe/Berlin"
                : configured
                  ? "Synchronized data · Europe/Berlin"
                  : "Configuration pending · No operational data loaded"}
            </span>
          </footer>
        </main>
      </div>
      {action && (
        <ActionDialog
          key={action.endpoint + action.title}
          action={action}
          close={() => setAction(null)}
          notify={setToast}
        />
      )}
      {toast && <Toast message={toast} dismiss={() => setToast("")} />}
      <Dialog open={setup} onOpenChange={setSetup}>
        <DialogContent
          title="Connect your workspace"
          description="Complete the secure setup before importing live data or inviting customers."
        >
          <div className="onboarding-steps">
            {[
              {
                label: "Configure Supabase",
                detail:
                  "Set the URL, anonymous key, and server service key in your environment.",
                done: configured,
              },
              {
                label: "Apply the SQL migrations",
                detail:
                  "Use the migrations in supabase/migrations with the Supabase CLI.",
                done: false,
              },
              {
                label: "Create your owner account",
                detail:
                  "Run the bootstrap script once, then sign in with your email and password.",
                done: false,
              },
              {
                label: "Set the credential encryption key",
                detail:
                  "Generate 32 random bytes and store the key in server and worker secret settings.",
                done: false,
              },
              {
                label: "Connect your first provider",
                detail:
                  "Test the connection, queue synchronization, and run the dedicated worker.",
                done: false,
              },
            ].map((s, i) => (
              <div
                className={`onboarding-step ${s.done ? "done" : ""}`}
                key={s.label}
              >
                <span className="step-number">
                  {s.done ? <Check size={12} /> : i + 1}
                </span>
                <div>
                  <strong>{s.label}</strong>
                  <small>{s.detail}</small>
                </div>
              </div>
            ))}
          </div>
          <div className="notice" style={{ marginTop: 18, marginBottom: 0 }}>
            <BookOpen size={15} />
            Local installation, Vercel deployment, worker hosting, and recovery
            steps are documented in README.md.
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={command} onOpenChange={setCommand}>
        <DialogContent
          title="Search workspace"
          description="Jump to a module in your authorized workspace."
        >
          <div className="search-box" style={{ marginBottom: 18 }}>
            <Search size={16} />
            <input
              autoFocus
              aria-label="Search navigation"
              placeholder="Companies, calls, billing…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="command-results">
            {[...nav, ...bottom]
              .filter((n) =>
                n.label.toLowerCase().includes(search.toLowerCase()),
              )
              .map((n) => (
                <Link
                  key={n.path}
                  href={n.path === "dialer" ? "/dialer" : `/${base}/${n.path}`}
                  onClick={() => setCommand(false)}
                >
                  <n.icon size={16} />
                  {n.label}
                  <ArrowRight size={14} style={{ marginLeft: "auto" }} />
                </Link>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function CompanyDetail({
  id,
  configured,
  context,
  openAction,
  notify,
}: {
  id: string;
  configured: boolean;
  context: UserContext | null;
  openAction: (a: Action) => void;
  notify: (s: string) => void;
}) {
  const [tab, setTab] = useState("Clients");
  const query = useQuery({
    queryKey: ["company", id],
    queryFn: () => api<Row>(`admin/companies/${id}`),
    enabled: configured,
  });
  const resources: Record<string, string> = {
    Clients: "clients",
    Staff: "users",
    Departments: "departments",
    Numbers: "numbers",
    Calls: "calls",
    Billing: "billing",
    "Audit logs": "audit-logs",
  };
  return (
    <>
      {query.error && <ErrorBanner error={query.error} />}
      <div className="notice">
        <Building2 size={15} />
        <span>
          <strong>{(query.data?.data.name as string) ?? "Company"}</strong> ·
          {query.data?.data.contact_email
            ? ` Company account: ${query.data.data.contact_email}`
            : " Clients, numbers, and calls"}
        </span>
      </div>
      <div className="tabs">
        {[
          "Overview",
          "Balances",
          "Clients",
          "Staff",
          "Departments",
          "Numbers",
          "Calls",
          "Billing",
          "Reports",
          "Settings",
          "Audit logs",
        ].map((t) => (
          <button
            className={t === tab ? "active" : ""}
            key={t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Overview" || tab === "Balances" ? (
        <ClientBalancesPage
          configured={configured}
          base="admin"
          companyFilter={id}
          canWrite={Boolean(context && hasPermission(context, "finance.write"))}
          canSetRate={Boolean(
            context && hasPermission(context, "pricing.manage"),
          )}
          openAction={openAction}
        />
      ) : resources[tab] ? (
        <ResourcePage
          resource={resources[tab]}
          base="admin"
          configured={configured}
          admin
          context={context}
          companyFilter={id}
          openAction={openAction}
          notify={notify}
        />
      ) : tab === "Reports" ? (
        <Reports configured={configured} base="admin" companyFilter={id} />
      ) : (
        <section className="panel settings-panel">
          <h2>Calling destination policy</h2>
          <p>
            No destinations are allowed by default. Enter the country calling
            prefixes this company is authorized to call.
          </p>
          <Button
            disabled={!configured}
            onClick={() =>
              openAction({
                title: "Set allowed destinations",
                description:
                  "Comma-separated calling country prefixes, without a leading +. An empty list blocks all callback destinations.",
                endpoint: `admin/companies/${id}`,
                method: "PATCH",
                fields: [
                  {
                    name: "prefixes",
                    label: "Allowed calling prefixes",
                    placeholder: "49, 39, 44",
                    required: false,
                  },
                ],
                transform: (d) => ({
                  allowed_country_prefixes: d.prefixes
                    .split(",")
                    .map((p) => p.trim())
                    .filter(Boolean),
                }),
              })
            }
          >
            Configure destinations
          </Button>
        </section>
      )}
    </>
  );
}
function Reports({
  configured,
  base,
  companyFilter,
}: {
  configured: boolean;
  base: string;
  companyFilter?: string;
}) {
  const query = useQuery({
    queryKey: [base, "reports", companyFilter],
    queryFn: () =>
      api<{ calls: Row[]; sampled: boolean; total: number }>(
        `${base}/reports${companyFilter ? `?company=${companyFilter}` : ""}`,
      ),
    enabled: configured,
  });
  const rows = query.data?.data.calls ?? [],
    total = query.data?.data.total ?? 0;
  return (
    <>
      {query.error && <ErrorBanner error={query.error} />}
      <div className="notice">
        <Clock3 size={15} />
        Reports use synchronized records.{" "}
        {query.data?.data.sampled
          ? "Statistics show the latest 1,000 calls; narrow the period for complete results."
          : "No live call count or agent presence is inferred."}
      </div>
      <div className="metrics-grid">
        {[
          { label: "Total calls", value: configured ? String(total) : "—" },
          {
            label: "Talk minutes",
            value: rows.length
              ? String(
                  Math.round(
                    rows.reduce(
                      (s, r) => s + Number(r.duration_seconds ?? 0),
                      0,
                    ) / 60,
                  ),
                )
              : "—",
          },
          {
            label: "Answered calls",
            value: rows.length
              ? String(rows.filter((r) => r.status === "answer").length)
              : "—",
          },
          {
            label: "Awaiting rating",
            value: rows.length
              ? String(rows.filter((r) => r.billing_status === "review").length)
              : "—",
          },
        ].map((m) => (
          <div className="metric-card" key={m.label}>
            <span className="metric-title">{m.label}</span>
            <div className="metric-value">{m.value}</div>
            <span className="metric-footer">
              {configured
                ? "From authorized call records"
                : "Awaiting connection"}
            </span>
          </div>
        ))}
      </div>
      <section className="panel" style={{ marginTop: 22 }}>
        <div className="panel-heading">
          <div>
            <h2>Export call reports</h2>
            <p>
              Filter records by date and status, then export the authorized
              results.
            </p>
          </div>
          <Button size="sm" asChild variant="outline">
            <Link href={`/${base}/calls`}>
              Open call history
              <ArrowRight size={12} />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}
function Profile({
  configured,
  context,
  notify,
}: {
  configured: boolean;
  context: UserContext | null;
  notify: (s: string) => void;
}) {
  const [name, setName] = useState(context?.full_name ?? ""),
    [status, setStatus] = useState("offline"),
    [pending, setPending] = useState(false),
    [error, setError] = useState<Error | null>(null);
  return (
    <div className="settings-grid">
      <div className="notice">
        <Radio size={15} />
        This is your locally declared status. Provider-defined status and
        verified live presence are separate features.
      </div>
      <section className="panel settings-panel">
        <h2>Your profile</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            setError(null);
            try {
              await api("profile", {
                method: "POST",
                data: { full_name: name, local_status: status },
              });
              notify("Profile and local status saved.");
            } catch (err) {
              setError(err as Error);
            } finally {
              setPending(false);
            }
          }}
        >
          {error && <ErrorBanner error={error} />}
          <div className="form-grid">
            <label className="form-field">
              Full name
              <input
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={2}
                required
              />
            </label>
            <label className="form-field">
              Local availability
              <Select
                aria-label="Local availability"
                value={status}
                onValueChange={setStatus}
                options={[
                  "available",
                  "busy",
                  "break",
                  "lunch",
                  "meeting",
                  "offline",
                ].map((value) => ({ value, label: value }))}
              />
            </label>
          </div>
          <div className="form-actions">
            <Button disabled={!configured || pending} type="submit">
              {pending ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
