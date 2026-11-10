"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Building2,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  Clock3,
  Database,
  Headphones,
  Layers3,
  Phone,
  PhoneCall,
  PlugZap,
  Radio,
  Server,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { formatDate, formatMoney, formatCredit } from "@/lib/utils";
import { Button } from "./ui/button";
import { Badge, ErrorBanner, LoadingRows } from "./shared";
import type { ProviderAccount } from "@/lib/types";
import Decimal from "decimal.js";
interface Call {
  id: string;
  company_id: string;
  started_at: string;
  duration_seconds: number | null;
  talk_seconds?: number | null;
  status: string;
  direction: string;
  customer_charge: number | string | null;
  currency: string | null;
}
interface DashboardData {
  companies: { id: string; name: string; status: string; currency: string }[];
  numberCount: number;
  calls: Call[];
  callCount: number;
  callsTruncated: boolean;
  providers: ProviderAccount[];
  wallets: { currency: string; balance: string | number }[];
  userCount: number;
  jobs: { status: string }[];
  invoices: { currency: string; total: number | string; status: string }[];
  generatedAt: string;
  periodDays: number;
  clientBilling?: {
    wallets: {
      balance: number | string;
      currency: string;
      germany_rate: number | string | null;
      pending_usage: number | string;
      billing_from: string;
    }[];
  } | null;
}
export function sumCurrencies(
  rows: { currency: string; amount: string | number }[],
) {
  const totals = new Map<string, Decimal>();
  for (const row of rows)
    totals.set(
      row.currency,
      (totals.get(row.currency) ?? new Decimal(0)).add(row.amount),
    );
  return (
    [...totals]
      .map(([currency, value]) => formatCredit(value.toString(), currency))
      .join(" · ") || "No balances"
  );
}
export function Dashboard({
  configured,
  demo,
  base,
  days,
  openSetup,
  admin,
  client = false,
}: {
  configured: boolean;
  demo: boolean;
  base: string;
  days: number;
  openSetup: () => void;
  admin: boolean;
  client?: boolean;
}) {
  const query = useQuery({
    queryKey: [base, "dashboard", days],
    queryFn: () => api<DashboardData>(`${base}/dashboard?days=${days}`),
    enabled: configured,
  });
  const data = query.data?.data,
    available = Boolean(data);
  const credit = data?.clientBilling?.wallets[0];
  const minutes = data
    ? (
        data.calls.reduce(
          (sum, c) => sum + (c.talk_seconds ?? c.duration_seconds ?? 0),
          0,
        ) / 60
      ).toLocaleString("en-GB", { maximumFractionDigits: 2 })
    : "—";
  const answered = data?.calls.filter((c) => c.status === "answer").length ?? 0;
  const dates = Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days + i + 1);
    return { date: d.toISOString().slice(0, 10), calls: 0, minutes: 0 };
  });
  for (const call of data?.calls ?? []) {
    const day = dates.find((d) => d.date === call.started_at.slice(0, 10));
    if (day) {
      day.calls++;
      day.minutes += (call.talk_seconds ?? call.duration_seconds ?? 0) / 60;
    }
  }
  const walletText = data
    ? sumCurrencies(
        data.wallets.map((w) => ({ currency: w.currency, amount: w.balance })),
      )
    : "—";
  const revenue = data
    ? client && !data.calls.some((c) => c.customer_charge != null)
      ? "Not rated"
      : sumCurrencies(
          data.calls
            .filter((c) => c.currency && c.customer_charge != null)
            .map((c) => ({
              currency: c.currency!,
              amount: c.customer_charge!,
            })),
        )
    : "—";
  const metrics = [
    {
      title: admin
        ? "Active companies"
        : client
          ? "Available balance"
          : "Assigned phone numbers",
      value: client
        ? credit
          ? formatCredit(credit.balance, credit.currency)
          : "—"
        : data
          ? (admin
              ? data.companies.filter((c) => c.status === "active").length
              : data.numberCount
            ).toLocaleString()
          : "—",
      icon: admin ? Building2 : Phone,
      footer: admin
        ? "Across your platform"
        : client
          ? credit?.germany_rate != null
            ? `Germany ${formatCredit(credit.germany_rate, credit.currency)}/min · talk seconds`
            : "Your separate client credit"
          : "In your authorized workspace",
    },
    {
      title: admin
        ? "Active phone numbers"
        : client
          ? "Assigned phone numbers"
          : "Team members",
      value: data
        ? (admin
            ? data.numberCount
            : client
              ? data.numberCount
              : data.userCount
          ).toLocaleString()
        : "—",
      icon: admin ? Phone : Users,
      footer: admin
        ? "Synchronized DID inventory"
        : "Within your authorized scope",
    },
    {
      title: `Calls · ${days} days`,
      value: data ? data.callCount.toLocaleString() : "—",
      icon: PhoneCall,
      footer: data?.callsTruncated
        ? "Chart limited to latest 1,000 calls"
        : "From synchronized call records",
    },
    {
      title: admin ? "Provider accounts" : "Answer rate",
      value: data
        ? admin
          ? `${data.providers.length}`
          : data.calls.length
            ? `${Math.round((answered / data.calls.length) * 100)}%`
            : "—"
        : "—",
      icon: admin ? Server : ChartNoAxesCombined,
      footer: admin
        ? demo
          ? "Three synthetic source accounts"
          : `${data?.providers.filter((p) => p.status === "active").length ?? 0} verified connections`
        : "Based on imported call statuses",
    },
  ];
  return (
    <>
      {query.error && (
        <ErrorBanner error={query.error} retry={() => query.refetch()} />
      )}
      {!configured && (
        <div className="setup-banner">
          <span className="setup-icon">
            <PlugZap size={20} />
          </span>
          <div>
            <strong>Your operations center is ready to connect</strong>
            <p>
              Configure your database, then securely connect your first provider
              account.
            </p>
          </div>
          <Button size="sm" onClick={openSetup}>
            Set up workspace <ArrowRight size={13} />
          </Button>
        </div>
      )}
      <div className="metrics-grid">
        {metrics.map((m) => (
          <div className="metric-card" key={m.title}>
            <div className="metric-title">
              {m.title}
              <span className="metric-icon">
                <m.icon size={15} />
              </span>
            </div>
            <div className={`metric-value ${available ? "" : "unavailable"}`}>
              {query.isFetching && !data ? "···" : m.value}
            </div>
            <div className="metric-footer">
              {available ? (
                <span className="positive">
                  <ArrowUpRight size={11} />
                </span>
              ) : (
                <span className="status-dot" />
              )}
              {available ? m.footer : "Awaiting connection"}
            </div>
            <div className="metric-bottom-line" />
          </div>
        ))}
      </div>
      <div className="secondary-metrics">
        {[
          {
            icon: Clock3,
            value: minutes,
            label: `Talk minutes · ${days} days`,
          },
          ...(!client
            ? [
                {
                  icon: Users,
                  value: data ? data.userCount.toLocaleString() : "—",
                  label: "Workspace users",
                },
                {
                  icon: Wallet,
                  value: walletText,
                  label: "Customer wallets · by currency",
                },
              ]
            : []),
          {
            icon: ChartNoAxesCombined,
            value: revenue,
            label: `Rated retail usage · ${days} days`,
          },
        ].map((m) => (
          <div className="secondary-metric" key={m.label}>
            <m.icon size={16} />
            <div>
              <strong
                style={{
                  fontSize:
                    m.value.length > 15 ? "var(--type-body)" : undefined,
                }}
              >
                {m.value}
              </strong>
              <small>{m.label}</small>
            </div>
          </div>
        ))}
      </div>
      <div className="content-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Call activity</h2>
              <p>Your network’s calling volume over time</p>
            </div>
            <div className="legend">
              <span>
                <i /> Calls
              </span>
              <span>
                <i /> Minutes
              </span>
            </div>
          </div>
          <div className="chart-stats">
            <div>
              <small>Total calls</small>
              <strong>{data ? data.callCount.toLocaleString() : "—"}</strong>
            </div>
            <div>
              <small>Talk minutes</small>
              <strong>{minutes}</strong>
            </div>
            <div>
              <small>Answer rate</small>
              <strong>
                {data?.calls.length
                  ? `${Math.round((answered / data.calls.length) * 100)}%`
                  : "—"}
              </strong>
            </div>
          </div>
          <div className="chart">
            {data?.calls.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dates}>
                  <defs>
                    <linearGradient
                      id="callGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="var(--chart-primary)"
                        stopOpacity={0.25}
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--chart-primary)"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    stroke="var(--chart-grid)"
                    strokeDasharray="3 4"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) =>
                      new Date(`${v}T12:00:00Z`).toLocaleDateString("en-GB", {
                        month: "short",
                        day: "numeric",
                      })
                    }
                    tick={{
                      fill: "var(--muted)",
                      fontSize: "var(--type-caption)",
                    }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={25}
                  />
                  <YAxis
                    tick={{
                      fill: "var(--muted)",
                      fontSize: "var(--type-caption)",
                    }}
                    axisLine={false}
                    tickLine={false}
                    width={30}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--dialog-bg)",
                      border: "1px solid var(--border-strong)",
                      color: "var(--foreground)",
                      borderRadius: 8,
                      fontSize: "var(--type-label)",
                    }}
                  />
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey="calls"
                    stroke="var(--chart-primary)"
                    strokeWidth={2}
                    fill="url(#callGradient)"
                  />
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey="minutes"
                    stroke="var(--chart-secondary)"
                    strokeWidth={1.5}
                    fill="transparent"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <>
                <div className="chart-empty">
                  <ChartNoAxesCombined size={25} />
                  <strong>
                    {configured
                      ? "Your call activity will appear here"
                      : "Connect your network to see call activity"}
                  </strong>
                  <span>Only verified, synchronized records are shown.</span>
                </div>
                <div className="chart-labels">
                  {dates
                    .filter(
                      (_, i) => i % Math.max(1, Math.floor(days / 7)) === 0,
                    )
                    .slice(0, 7)
                    .map((d) => (
                      <span key={d.date}>
                        {new Date(`${d.date}T12:00:00Z`).toLocaleDateString(
                          "en-GB",
                          { month: "short", day: "numeric" },
                        )}
                      </span>
                    ))}
                </div>
              </>
            )}
          </div>
          {data?.callsTruncated && (
            <div className="provider-bottom">
              Chart and derived statistics cover the latest 1,000 records.
              Narrow the date range for complete results.
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>{admin ? "Provider connections" : "Workspace health"}</h2>
              <p>
                {admin
                  ? "A unified view of your upstream accounts"
                  : "Your account and service overview"}
              </p>
            </div>
            {admin && (
              <Link href="/admin/providers">
                Manage <ArrowUpRight size={12} />
              </Link>
            )}
          </div>
          <div className="provider-summary">
            {admin ? (
              data?.providers.length ? (
                data.providers.map((provider) => (
                  <div className="provider-row" key={provider.id}>
                    <div className="provider-icon">
                      <Server size={17} />
                    </div>
                    <div>
                      <strong>{provider.name}</strong>
                      <small>
                        {provider.balance_updated_at
                          ? `Updated ${formatDate(provider.balance_updated_at)}`
                          : demo
                            ? "Synthetic sample balance"
                            : "Not synchronized"}
                      </small>
                    </div>
                    <div className="provider-end">
                      <strong>
                        {provider.balance == null
                          ? "—"
                          : formatMoney(provider.balance, provider.currency)}
                      </strong>
                      <div style={{ marginTop: 5 }}>
                        <Badge value={demo ? "demo" : provider.status} />
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                [1, 2, 3].map((n) => (
                  <div className="provider-row" key={n}>
                    <div className="provider-icon">
                      <Server size={17} />
                    </div>
                    <div>
                      <strong>Provider account {n}</strong>
                      <small>
                        {n === 1
                          ? "Connect your primary account"
                          : "Verify primary account first"}
                      </small>
                    </div>
                    <div className="provider-end">
                      <Badge value="not connected" />
                    </div>
                  </div>
                ))
              )
            ) : (
              <>
                <div className="provider-row">
                  <ShieldCheck size={18} />
                  <div>
                    <strong>Tenant isolation</strong>
                    <small>Resources scoped to your permissions</small>
                  </div>
                </div>
                <div className="provider-row">
                  <Radio size={18} />
                  <div>
                    <strong>Synchronized call records</strong>
                    <small>Live presence requires event integration</small>
                  </div>
                </div>
                <div className="provider-row">
                  {client ? <Phone size={18} /> : <Wallet size={18} />}
                  <div>
                    <strong>
                      {client ? "Your phone numbers" : "Account balance"}
                    </strong>
                    <small>
                      {client
                        ? `${data?.numberCount ?? 0} assigned`
                        : walletText}
                    </small>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="provider-bottom">
            <ShieldCheck size={12} />
            {admin
              ? "Credentials encrypted · Server-side connections"
              : "Your workspace is private and access controlled"}
          </div>
        </section>
      </div>
      <div className="bottom-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>{admin ? "Company overview" : "Recent call activity"}</h2>
              <p>
                {admin
                  ? "Your customers, connected in one workspace"
                  : "Latest synchronized calls in your scope"}
              </p>
            </div>
            <Link href={`/${base}/${admin ? "companies" : "calls"}`}>
              View all <ArrowRight size={12} />
            </Link>
          </div>
          {query.isPending && configured ? (
            <LoadingRows />
          ) : (
            <table className="mini-table">
              <thead>
                <tr>
                  {(admin
                    ? ["COMPANY", "STATUS", "CURRENCY"]
                    : ["DATE", "DIRECTION", "STATUS"]
                  ).map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {admin ? (
                  data?.companies.length ? (
                    data.companies.slice(0, 4).map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/admin/companies/${c.id}`}>
                            <span className="cell-primary">{c.name}</span>
                          </Link>
                        </td>
                        <td>
                          <Badge value={c.status} />
                        </td>
                        <td>{c.currency}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="table-empty">
                        <Building2
                          size={22}
                          style={{
                            margin: "0 auto 12px",
                            color: "var(--text-faint)",
                          }}
                        />
                        {configured
                          ? "Create your first company to get started."
                          : "Your connected companies will appear here."}
                      </td>
                    </tr>
                  )
                ) : data?.calls.length ? (
                  data.calls.slice(0, 4).map((c) => (
                    <tr key={c.id}>
                      <td>{formatDate(c.started_at)}</td>
                      <td>{c.direction}</td>
                      <td>
                        <Badge value={c.status} />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="table-empty">
                      No synchronized calls yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>{admin ? "Launch checklist" : "Quick access"}</h2>
              <p>
                {admin
                  ? "A secure foundation for your operations"
                  : "Your everyday calling tools"}
              </p>
            </div>
            <Layers3 size={15} color="var(--muted)" />
          </div>
          <div className="onboarding-steps">
            {(admin
              ? [
                  {
                    label: "Configure your workspace",
                    detail: "Database, authentication & permissions",
                    done: configured,
                    href: "/admin/settings",
                  },
                  {
                    label: "Connect your first provider",
                    detail: "Verify balance, users, numbers & calls",
                    done: Boolean(
                      data?.providers.some((p) => p.status === "active"),
                    ),
                    href: "/admin/providers",
                  },
                  {
                    label: "Onboard your first company",
                    detail: "Allocate numbers and fund a wallet",
                    done: Boolean(data?.companies.length),
                    href: "/admin/companies",
                  },
                ]
              : [
                  {
                    label: "Open your dialer",
                    detail: "Use an authorized calling identity",
                    done: false,
                    href: "/dialer",
                  },
                  {
                    label: "Review your numbers",
                    detail: "Your allocated calling resources",
                    done: false,
                    href: `/${base}/numbers`,
                  },
                  {
                    label: "Review call history",
                    detail: "Your synchronized call records",
                    done: false,
                    href: `/${base}/calls`,
                  },
                ]
            ).map((s, i) => (
              <Link
                className={`onboarding-step ${s.done ? "done" : ""}`}
                href={s.href}
                key={s.label}
              >
                <span className="step-number">
                  {s.done ? <Check size={12} /> : i + 1}
                </span>
                <div>
                  <strong>{s.label}</strong>
                  <small>{s.detail}</small>
                </div>
                <ChevronRight size={13} />
              </Link>
            ))}
          </div>
        </section>
      </div>
      <div className="sync-label">
        <Clock3 size={11} />
        {data
          ? `Snapshot generated ${formatDate(data.generatedAt)} · ${demo ? "Synthetic demo records; no provider connection" : "Provider records are synchronized, not live"}`
          : "No provider data connected · Metrics are unavailable"}
      </div>
    </>
  );
}
