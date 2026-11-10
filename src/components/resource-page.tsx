"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowRight,
  Building2,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Info,
  Plus,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { formatDate, formatMoney, formatCredit } from "@/lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import {
  Badge,
  EmptyState,
  ErrorBanner,
  LoadingRows,
  relation,
  str,
  type Row,
} from "./shared";
import type { Action, Field } from "./action-dialog";
import type { UserContext } from "@/lib/types";
import { hasPermission } from "@/lib/auth/permissions";

export const companyFields: Field[] = [
  {
    name: "name",
    label: "Company name",
    placeholder: "Registered company name",
  },
  {
    name: "slug",
    label: "Workspace identifier",
    placeholder: "company-name",
    hint: "Lowercase letters, numbers, and hyphens.",
  },
  {
    name: "contact_email",
    label: "Company contact email",
    type: "email",
    required: false,
  },
  { name: "country", label: "Country", required: false },
  {
    name: "currency",
    label: "Billing currency",
    placeholder: "EUR",
    hint: "ISO currency code. Each currency has a separate wallet.",
  },
];
export const companyAction: Action = {
  title: "Create a company",
  description:
    "Create a company with no clients. Add client logins and assign their numbers from the company page.",
  endpoint: "admin/companies",
  fields: companyFields,
  submit: "Create company",
  transform: (data) => ({
    name: data.name,
    slug: data.slug,
    currency: data.currency,
    contact_email: data.contact_email || null,
    country: data.country || null,
  }),
};
interface Column {
  label: string;
  key: string;
  render?: (row: Row) => React.ReactNode;
}
const dateColumn: Column = {
  label: "Date & time",
  key: "started_at",
  render: (row) => formatDate(str(row, "started_at")),
};
const statusColumn: Column = {
  label: "Status",
  key: "status",
  render: (row) => <Badge value={row.status} />,
};
const companyColumn: Column = {
  label: "Company",
  key: "companies",
  render: (row) => str(relation(row, "companies"), "name"),
};
const configs: Record<
  string,
  { title: string; description: string; columns: Column[] }
> = {
  companies: {
    title: "companies",
    description:
      "Companies group your clients. Open a company to manage its client logins and numbers.",
    columns: [
      {
        label: "Company",
        key: "name",
        render: (row) => (
          <Link className="cell-primary" href={`/admin/companies/${row.id}`}>
            {str(row, "name")}
          </Link>
        ),
      },
      { label: "Company email", key: "contact_email" },
      {
        label: "Clients",
        key: "clients",
        render: (row) =>
          String(
            (row.clients as { count: number }[] | undefined)?.[0]?.count ?? 0,
          ),
      },
      { label: "Country", key: "country" },
      { label: "Currency", key: "currency" },
      statusColumn,
    ],
  },
  clients: {
    title: "clients",
    description:
      "This company has no clients yet. Create a client login, then assign its number and provider identity.",
    columns: [
      { label: "Client", key: "name" },
      { label: "Login email", key: "email" },
      { label: "Company", key: "company_name" },
      {
        label: "Phone numbers",
        key: "numbers",
        render: (row) =>
          (row.numbers as string[] | undefined)?.join(", ") || "Unassigned",
      },
      statusColumn,
    ],
  },
  numbers: {
    title: "phone numbers",
    description:
      "Allocate provider numbers to a company, then assign each number to its client or staff member.",
    columns: [
      {
        label: "Phone number",
        key: "number",
        render: (r) => <span className="cell-primary">{str(r, "number")}</span>,
      },
      { label: "Country", key: "country" },
      {
        label: "Company",
        key: "company",
        render: (r) => {
          const a = (r.did_allocations as Row[] | undefined)?.find(
            (a) => !a.valid_to,
          );
          return a ? (
            str(relation(a, "companies"), "name")
          ) : r.company_id ? (
            String(r.company_name ?? "Your company")
          ) : (
            <Badge value="unassigned" />
          );
        },
      },
      {
        label: "Provider status",
        key: "provider_status",
        render: (r) => <Badge value={r.provider_status ?? r.status} />,
      },
      {
        label: "Last synchronized",
        key: "synced_at",
        render: (r) => formatDate(str(r, "synced_at")),
      },
    ],
  },
  calls: {
    title: "call records",
    description:
      "Call records appear after provider synchronization. Only calls attributed to your authorized scope are shown.",
    columns: [
      dateColumn,
      { label: "Origin", key: "origin" },
      { label: "Destination", key: "destination" },
      { label: "Direction", key: "direction" },
      {
        label: "Talk time",
        key: "talk_seconds",
        render: (r) =>
          (r.talk_seconds ?? r.duration_seconds) == null
            ? "Pending"
            : `${Math.floor(Number(r.talk_seconds ?? r.duration_seconds) / 60)}m ${Number(r.talk_seconds ?? r.duration_seconds) % 60}s`,
      },
      statusColumn,
      {
        label: "Retail charge",
        key: "customer_charge",
        render: (r) =>
          r.customer_charge == null ? (
            <Badge
              value={
                r.billing_status === "before_billing_start"
                  ? "not billed"
                  : r.billing_status === "unpriced"
                    ? "rate needed"
                    : r.client_billing
                      ? "pending"
                      : "review"
              }
            />
          ) : (
            formatCredit(String(r.customer_charge), str(r, "currency"))
          ),
      },
    ],
  },
  users: {
    title: "employees",
    description:
      "Invite employees to their company workspace. Application accounts and upstream SIP users are managed separately.",
    columns: [
      {
        label: "Name",
        key: "name",
        render: (r) => str(relation(r, "profiles"), "full_name"),
      },
      companyColumn,
      { label: "Role", key: "role", render: (r) => <Badge value={r.role} /> },
      {
        label: "Local status",
        key: "local_status",
        render: (r) => <Badge value={relation(r, "profiles").local_status} />,
      },
      {
        label: "Membership",
        key: "active",
        render: (r) => <Badge value={r.active ? "active" : "disabled"} />,
      },
    ],
  },
  teams: {
    title: "teams",
    description:
      "Organize employees into teams. Historical call attribution stays intact when you change the current hierarchy.",
    columns: [
      { label: "Team name", key: "name" },
      { label: "Company ID", key: "company_id" },
      { label: "Department ID", key: "department_id" },
      { label: "Team leader ID", key: "leader_id" },
    ],
  },
  departments: {
    title: "departments",
    description:
      "Create departments to organize your company’s managers, team leaders, and agents.",
    columns: [
      { label: "Department", key: "name" },
      { label: "Company ID", key: "company_id" },
      { label: "Manager ID", key: "manager_id" },
    ],
  },
  billing: {
    title: "invoices",
    description:
      "Create an invoice for a customer. Payment status changes only after an authorized payment record is entered.",
    columns: [
      { label: "Invoice", key: "number" },
      companyColumn,
      { label: "Period start", key: "period_start" },
      { label: "Due date", key: "due_at" },
      {
        label: "Total",
        key: "total",
        render: (r) => formatMoney(String(r.total), str(r, "currency")),
      },
      statusColumn,
    ],
  },
  "number-orders": {
    title: "number orders",
    description:
      "Customer requests are saved as drafts for review. Upstream purchasing remains disabled until order reconciliation is confirmed.",
    columns: [
      {
        label: "Request ID",
        key: "id",
        render: (r) => str(r, "id").slice(0, 8),
      },
      { label: "Country", key: "country" },
      { label: "Quantity", key: "quantity" },
      statusColumn,
      {
        label: "Requested",
        key: "created_at",
        render: (r) => formatDate(str(r, "created_at")),
      },
    ],
  },
  "audit-logs": {
    title: "audit events",
    description:
      "Sensitive actions are recorded with actor, resource, and timestamp. Audit records cannot be edited or deleted.",
    columns: [
      {
        label: "Timestamp",
        key: "created_at",
        render: (r) => formatDate(str(r, "created_at")),
      },
      { label: "Action", key: "action" },
      {
        label: "Actor ID",
        key: "actor_id",
        render: (r) =>
          r.actor_id ? str(r, "actor_id").slice(0, 8) : "System worker",
      },
      {
        label: "Resource",
        key: "resource_id",
        render: (r) => str(r, "resource_id").slice(0, 8),
      },
      {
        label: "Company ID",
        key: "company_id",
        render: (r) => str(r, "company_id").slice(0, 8),
      },
    ],
  },
  notifications: {
    title: "notifications",
    description:
      "Provider failures, billing exceptions, and account alerts will appear here when generated.",
    columns: [
      { label: "Notification", key: "title" },
      { label: "Details", key: "message" },
      {
        label: "Severity",
        key: "severity",
        render: (r) => <Badge value={r.severity} />,
      },
      {
        label: "Received",
        key: "created_at",
        render: (r) => formatDate(str(r, "created_at")),
      },
    ],
  },
  pricing: {
    title: "pricing plans",
    description:
      "Configure customer-specific retail rates. Pricing versions are immutable and retained with each rated call.",
    columns: [
      { label: "Plan name", key: "name" },
      companyColumn,
      { label: "Currency", key: "currency" },
      {
        label: "Versions",
        key: "versions",
        render: (r) =>
          String((r.pricing_plan_versions as Row[] | undefined)?.length ?? 0),
      },
      {
        label: "Created",
        key: "created_at",
        render: (r) => formatDate(str(r, "created_at")),
      },
    ],
  },
};
export function ResourcePage({
  resource,
  base,
  configured,
  admin,
  openAction,
  notify,
  context,
  companyFilter,
}: {
  resource: string;
  base: string;
  configured: boolean;
  admin: boolean;
  openAction: (action: Action) => void;
  notify: (message: string) => void;
  context: UserContext | null;
  companyFilter?: string;
}) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [detail, setDetail] = useState<Row | null>(null),
    [status, setStatus] = useState(""),
    [date, setDate] = useState("");
  const config = configs[resource] ?? configs.calls;
  const queryString = new URLSearchParams({
    page: String(page),
    search,
    ...(companyFilter ? { company: companyFilter } : {}),
    ...(status ? { status } : {}),
    ...(date ? { from: new Date(`${date}T00:00:00Z`).toISOString() } : {}),
  });
  const query = useQuery({
    queryKey: [base, resource, search, page, status, date, companyFilter],
    queryFn: () => api<Row[]>(`${base}/${resource}?${queryString}`),
    enabled: configured,
  });
  const companies = useQuery({
    queryKey: ["company-options"],
    queryFn: () => api<Row[]>("admin/companies?limit=500"),
    enabled:
      configured &&
      admin &&
      [
        "users",
        "clients",
        "teams",
        "departments",
        "numbers",
        "pricing",
        "billing",
      ].includes(resource),
  });
  const employees = useQuery({
    queryKey: [base, "employee-options", companyFilter],
    queryFn: () =>
      api<Row[]>(
        `${base}/${resource === "numbers" ? "assignees" : "users"}?limit=500${companyFilter ? `&company=${companyFilter}` : ""}`,
      ),
    enabled: configured && ["users", "numbers"].includes(resource),
  });
  const clients = useQuery({
    queryKey: ["number-client-options", companyFilter],
    queryFn: () =>
      api<Row[]>(
        `admin/clients?limit=500${companyFilter ? `&company=${companyFilter}` : ""}`,
      ),
    enabled: configured && admin && resource === "numbers",
  });
  const companyOptions = (companies.data?.data ?? []).map((c) => ({
    value: str(c, "id"),
    label: str(c, "name"),
  }));
  const companyField: Field = {
    name: "company_id",
    label: "Company",
    type: "select",
    options: companyOptions,
    defaultValue: companyFilter,
  };
  const permitted = (permission: Parameters<typeof hasPermission>[1]) =>
    configured && Boolean(context && hasPermission(context, permission));
  const createAction = (): Action | null => {
    if (resource === "companies" && permitted("companies.manage"))
      return companyAction;
    if (resource === "clients" && permitted("users.manage"))
      return {
        title: "Create a client login",
        description:
          "Add a client to this company. Share the initial password with the client after creation.",
        endpoint: `${base}/clients`,
        fields: [
          ...(admin ? [companyField] : []),
          { name: "name", label: "Client name" },
          { name: "email", label: "Login email", type: "email" },
          {
            name: "password",
            label: "Initial password",
            type: "password",
            hint: "At least 8 characters.",
          },
        ],
        submit: "Create client",
      };
    if (resource === "users" && permitted("users.manage"))
      return {
        title: "Invite an employee",
        description:
          "A verified invitation will be sent to the employee. They must accept it before signing in.",
        endpoint: `${base}/users/invite`,
        fields: [
          ...(admin ? [companyField] : []),
          { name: "full_name", label: "Full name" },
          { name: "email", label: "Email", type: "email" },
          {
            name: "role",
            label: "Role",
            type: "select",
            options: ["company_admin", "manager", "team_leader", "agent"].map(
              (r) => ({ value: r, label: r.replaceAll("_", " ") }),
            ),
          },
        ],
        submit: "Send invitation",
      };
    if (
      ["teams", "departments"].includes(resource) &&
      permitted("teams.manage")
    )
      return {
        title: `Create a ${resource === "teams" ? "team" : "department"}`,
        description: "Add a group within the selected company.",
        endpoint: `${base}/${resource}`,
        fields: [
          ...(admin ? [companyField] : []),
          { name: "name", label: "Name" },
        ],
      };
    if (resource === "pricing" && permitted("pricing.manage"))
      return {
        title: "Create a retail pricing plan",
        description:
          "Creates an immutable first version for this customer. Amounts use six decimal places; no wholesale rate is assumed.",
        endpoint: "admin/pricing",
        fields: [
          companyField,
          { name: "name", label: "Plan name" },
          { name: "currency", label: "Currency", placeholder: "EUR" },
          { name: "prefix", label: "Destination prefix", placeholder: "49" },
          {
            name: "per_minute",
            label: "Price per minute",
            type: "number",
            min: "0",
            step: "0.000001",
          },
          {
            name: "connection_fee",
            label: "Connection fee",
            type: "number",
            min: "0",
            step: "0.000001",
          },
          {
            name: "minimum_seconds",
            label: "Minimum billable seconds",
            type: "number",
            min: "0",
            step: "1",
          },
          {
            name: "increment_seconds",
            label: "Billing increment in seconds",
            type: "number",
            min: "1",
            step: "1",
          },
        ],
        transform: (d) => ({
          company_id: d.company_id,
          name: d.name,
          currency: d.currency,
          rates: [
            {
              prefix: d.prefix,
              per_minute: d.per_minute,
              connection_fee: d.connection_fee,
              minimum_seconds: Number(d.minimum_seconds),
              increment_seconds: Number(d.increment_seconds),
            },
          ],
        }),
      };
    if (resource === "billing" && admin && permitted("finance.write"))
      return {
        title: "Issue an invoice",
        description:
          "Review the billing period and line item. The invoice is issued as unpaid; recording a payment requires a separate confirmation.",
        endpoint: "admin/billing",
        fields: [
          companyField,
          { name: "currency", label: "Currency", placeholder: "EUR" },
          { name: "period_start", label: "Period start", type: "date" },
          { name: "period_end", label: "Period end", type: "date" },
          { name: "due_at", label: "Payment due", type: "date" },
          { name: "description", label: "Line description" },
          {
            name: "quantity",
            label: "Quantity",
            type: "number",
            min: "0.000001",
            step: "0.000001",
          },
          {
            name: "unit_price",
            label: "Unit price",
            type: "number",
            min: "0",
            step: "0.000001",
          },
          {
            name: "tax_percent",
            label: "Tax percentage",
            type: "number",
            min: "0",
            step: "0.000001",
          },
        ],
        transform: (d) => ({
          company_id: d.company_id,
          currency: d.currency,
          period_start: d.period_start,
          period_end: d.period_end,
          due_at: d.due_at,
          items: [
            {
              description: d.description,
              quantity: d.quantity,
              unit_price: d.unit_price,
              tax_percent: d.tax_percent,
            },
          ],
        }),
        submit: "Issue invoice",
      };
    if (
      resource === "number-orders" &&
      !admin &&
      context?.membership?.role === "company_admin"
    )
      return {
        title: "Request phone numbers",
        description:
          "Send an internal request for approval. This does not purchase numbers from the provider.",
        endpoint: "numbers/requests",
        fields: [
          { name: "country", label: "Country" },
          {
            name: "quantity",
            label: "Number of DIDs",
            type: "number",
            min: "1",
            step: "1",
          },
        ],
        transform: (d) => ({
          country: d.country,
          quantity: Number(d.quantity),
        }),
        submit: "Submit request",
      };
    return null;
  };
  const action = createAction();
  const allRows = query.data?.data ?? [];
  const filteredRows = query.data?.meta
    ? allRows
    : allRows.filter(
        (r) =>
          !search ||
          JSON.stringify(r).toLowerCase().includes(search.toLowerCase()),
      );
  const rows = query.data?.meta
    ? filteredRows
    : filteredRows.slice((page - 1) * 25, page * 25);
  const total = query.data?.meta?.total ?? filteredRows.length;
  const confirmAction = (row: Row, unassign = false) =>
    openAction(
      unassign
        ? {
            title: "Remove internal allocation",
            description:
              "This ends the current allocation and disables calling permissions. The number stays in your upstream account, and historical call ownership is preserved.",
            endpoint: `admin/numbers/${row.id}/unassign`,
            fields: [],
            submit: "Remove allocation",
          }
        : {
            title: `Allocate ${row.number}`,
            description:
              "Allocate this DID exclusively to one company. This is an internal allocation; upstream routing is configured separately.",
            endpoint: `admin/numbers/${row.id}/assign`,
            fields: [
              companyField,
              {
                name: "monthly_price",
                label: "Customer monthly price",
                type: "number",
                min: "0",
                step: "0.000001",
              },
            ],
            transform: (d) => ({
              company_id: d.company_id,
              user_id: null,
              monthly_price: d.monthly_price,
            }),
            submit: "Allocate number",
          },
    );
  return (
    <>
      {resource === "number-orders" && (
        <div className="notice">
          <Info size={15} />
          <span>
            Upstream purchasing is disabled. The published order-creation
            response does not include an order ID, so reliable reconciliation
            must be confirmed before enabling purchases. Customer requests can
            be saved for review.
          </span>
        </div>
      )}
      {resource === "users" && (
        <div className="notice">
          <ShieldCheck size={15} />
          Statuses are local declarations. They do not indicate verified live
          SIP presence.
        </div>
      )}
      {query.error && (
        <ErrorBanner error={query.error} retry={() => query.refetch()} />
      )}
      <div className="toolbar">
        <div className="search-box">
          <Search size={15} />
          <input
            aria-label={`Search ${config.title}`}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={`Search ${config.title}…`}
          />
        </div>
        {resource === "calls" && (
          <>
            <select
              aria-label="Filter call status"
              className="date-select"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {["answer", "busy", "noanswer", "cancel", "failed"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              aria-label="Calls starting from"
              className="date-select"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setPage(1);
              }}
            />
          </>
        )}
        <div className="toolbar-right">
          {resource === "calls" &&
            context &&
            hasPermission(context, "reports.export") && (
              <>
                <Button asChild variant="outline" size="sm">
                  <a
                    href={`/api/${base}/calls/export?${queryString}&format=csv`}
                  >
                    <ArrowDownToLine size={13} />
                    CSV
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a
                    href={`/api/${base}/calls/export?${queryString}&format=xlsx`}
                  >
                    Excel
                  </a>
                </Button>
              </>
            )}
          {action && (
            <Button size="sm" onClick={() => openAction(action)}>
              <Plus size={14} />
              {resource === "clients"
                ? "Add client"
                : resource === "users"
                  ? "Invite employee"
                  : resource === "billing"
                    ? "Issue invoice"
                    : `Add ${resource === "companies" ? "company" : resource === "pricing" ? "plan" : resource === "teams" ? "team" : resource === "number-orders" ? "request" : "department"}`}
            </Button>
          )}
        </div>
      </div>
      <section className="panel">
        {query.isPending && configured ? (
          <LoadingRows />
        ) : rows.length ? (
          <>
            <div className="data-table-scroll">
              <table className="mini-table data-table">
                <thead>
                  <tr>
                    {config.columns.map((c) => (
                      <th key={c.key}>{c.label.toUpperCase()}</th>
                    ))}
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={String(row.id ?? index)}>
                      {config.columns.map((c) => (
                        <td key={c.key}>
                          {c.render ? c.render(row) : str(row, c.key)}
                        </td>
                      ))}
                      <td>
                        <div className="cell-actions">
                          {resource === "companies" && (
                            <>
                              <Button size="sm" variant="ghost" asChild>
                                <Link href={`/admin/companies/${row.id}`}>
                                  <ArrowRight size={13} />
                                </Link>
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  openAction({
                                    title: `Update ${row.name}`,
                                    description:
                                      "Rename the company or change its workspace status. Client names and login details are managed separately.",
                                    endpoint: `admin/companies/${row.id}`,
                                    method: "PATCH",
                                    fields: [
                                      {
                                        name: "name",
                                        label: "Company name",
                                        defaultValue: str(row, "name"),
                                      },
                                      {
                                        name: "contact_email",
                                        label: "Company account email",
                                        type: "email",
                                        required: false,
                                        defaultValue: String(
                                          row.contact_email ?? "",
                                        ),
                                      },
                                      {
                                        name: "status",
                                        label: "Company status",
                                        type: "select",
                                        defaultValue: str(row, "status"),
                                        options: [
                                          "active",
                                          "trial",
                                          "suspended",
                                          "closed",
                                        ].map((s) => ({ value: s, label: s })),
                                      },
                                    ],
                                    transform: (data) => ({
                                      name: data.name,
                                      status: data.status,
                                      contact_email: data.contact_email || null,
                                    }),
                                  })
                                }
                              >
                                Edit
                              </Button>
                            </>
                          )}
                          {resource === "clients" &&
                            permitted("finance.read") && (
                              <Button size="sm" variant="ghost" asChild>
                                <Link href={`/admin/client-balances/${row.id}`}>
                                  Balance
                                </Link>
                              </Button>
                            )}
                          {resource === "clients" &&
                            permitted("users.manage") && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  openAction({
                                    title: "Edit client",
                                    description: admin
                                      ? "Update this client's details and login credentials. Email and password changes take effect immediately."
                                      : "Update the client name and login status.",
                                    endpoint: `${base}/clients/${row.id}`,
                                    method: "PATCH",
                                    links: admin
                                      ? [
                                          ...(permitted("companies.manage")
                                            ? [
                                                {
                                                  href: `/admin/companies/${row.company_id}`,
                                                  label: str(
                                                    row,
                                                    "company_name",
                                                  ),
                                                },
                                              ]
                                            : []),
                                          ...(permitted("numbers.manage")
                                            ? [
                                                {
                                                  href: "/admin/numbers",
                                                  label: "Manage numbers",
                                                },
                                              ]
                                            : []),
                                          ...(permitted("finance.read")
                                            ? [
                                                {
                                                  href: `/admin/client-balances/${row.id}`,
                                                  label: "Balance and rate",
                                                },
                                              ]
                                            : []),
                                        ]
                                      : undefined,
                                    fields: [
                                      {
                                        name: "name",
                                        label: "Client name",
                                        defaultValue: str(row, "name"),
                                        minLength: 2,
                                        maxLength: 160,
                                      },
                                      ...(admin
                                        ? [
                                            {
                                              name: "email",
                                              label: "Login email",
                                              type: "email" as const,
                                              defaultValue: str(row, "email"),
                                            },
                                            {
                                              name: "password",
                                              label: "New password",
                                              type: "password" as const,
                                              required: false,
                                              minLength: 8,
                                              maxLength: 128,
                                              placeholder:
                                                "Leave blank to keep current password",
                                              hint: "At least 8 characters. The current password is never displayed.",
                                            },
                                          ]
                                        : []),
                                      {
                                        name: "active",
                                        label: "Login status",
                                        type: "select",
                                        defaultValue: String(
                                          row.status === "active",
                                        ),
                                        options: [
                                          { value: "true", label: "Active" },
                                          {
                                            value: "false",
                                            label: "Suspended",
                                          },
                                        ],
                                      },
                                    ],
                                    transform: (data) => ({
                                      name: data.name,
                                      active: data.active === "true",
                                      ...(admin
                                        ? {
                                            email: data.email,
                                            ...(data.password
                                              ? { password: data.password }
                                              : {}),
                                          }
                                        : {}),
                                    }),
                                  })
                                }
                              >
                                Edit client
                              </Button>
                            )}
                          {resource === "numbers" &&
                            admin &&
                            permitted("numbers.manage") && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={
                                  clients.isPending || Boolean(clients.error)
                                }
                                onClick={() => {
                                  const active = (
                                    row.did_allocations as Row[] | undefined
                                  )?.find((a) => !a.valid_to);
                                  const owningCompany =
                                    active?.company_id ??
                                    row.company_id ??
                                    relation(row, "provider_accounts")
                                      .company_id;
                                  const options = (
                                    clients.data?.data ?? []
                                  ).filter(
                                    (c) =>
                                      (!owningCompany ||
                                        c.company_id === owningCompany) &&
                                      c.active,
                                  );
                                  openAction({
                                    title: `Assign ${row.number} to a client`,
                                    description:
                                      "Future calls follow this assignment. Existing call history keeps its recorded owner. Choose None to leave the number without a client.",
                                    endpoint: `admin/numbers/${row.id}/client`,
                                    fields: [
                                      {
                                        name: "client_id",
                                        label: "Client",
                                        type: "select",
                                        required: false,
                                        defaultValue: String(
                                          options.find(
                                            (c) =>
                                              c.user_id === active?.user_id,
                                          )?.id ?? "",
                                        ),
                                        options: options.map((c) => ({
                                          value: str(c, "id"),
                                          label: `${c.name} · ${c.email}`,
                                        })),
                                      },
                                    ],
                                    transform: (data) => ({
                                      client_id: data.client_id || null,
                                    }),
                                    submit: "Save assignment",
                                  });
                                }}
                              >
                                Assign client
                              </Button>
                            )}
                          {resource === "numbers" &&
                            admin &&
                            permitted("numbers.manage") && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  confirmAction(
                                    row,
                                    Boolean(
                                      (
                                        row.did_allocations as Row[] | undefined
                                      )?.some((a) => !a.valid_to),
                                    ),
                                  )
                                }
                              >
                                {(
                                  row.did_allocations as Row[] | undefined
                                )?.some((a) => !a.valid_to)
                                  ? "Unassign"
                                  : "Allocate"}
                              </Button>
                            )}
                          {resource === "numbers" &&
                            permitted("numbers.manage") &&
                            (Boolean(
                              (row.did_allocations as Row[] | undefined)?.some(
                                (a) => !a.valid_to,
                              ),
                            ) ||
                              !admin) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  const active = (
                                    row.did_allocations as Row[] | undefined
                                  )?.find((a) => !a.valid_to);
                                  const assignedCompany = String(
                                    active?.company_id ?? row.company_id,
                                  );
                                  openAction({
                                    title:
                                      "Assign number to a client or staff member",
                                    description:
                                      "This preserves the previous assignment as history and disables old callback permissions. Upstream routing is verified separately.",
                                    endpoint: `${base}/numbers/${row.id}/employee`,
                                    fields: [
                                      {
                                        name: "user_id",
                                        label: "Client or staff member",
                                        type: "select",
                                        options: (employees.data?.data ?? [])
                                          .filter(
                                            (e) =>
                                              e.company_id ===
                                                assignedCompany && e.active,
                                          )
                                          .map((e) => ({
                                            value: str(e, "user_id"),
                                            label: `${str(relation(e, "profiles"), "full_name")} · ${str(e, "role")}`,
                                          })),
                                      },
                                    ],
                                    submit: "Assign employee",
                                  });
                                }}
                              >
                                Employee
                              </Button>
                            )}
                          {resource === "users" &&
                            permitted("users.manage") && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  openAction({
                                    title: "Reassign employee",
                                    description:
                                      "New calls use the new hierarchy. Existing call ownership remains unchanged. Optional IDs must belong to the employee’s company.",
                                    endpoint: `${base}/users/${row.user_id}`,
                                    method: "PATCH",
                                    fields: [
                                      {
                                        name: "department_id",
                                        label: "Department UUID",
                                        required: false,
                                        defaultValue: row.department_id
                                          ? str(row, "department_id")
                                          : "",
                                      },
                                      {
                                        name: "team_id",
                                        label: "Team UUID",
                                        required: false,
                                        defaultValue: row.team_id
                                          ? str(row, "team_id")
                                          : "",
                                      },
                                      {
                                        name: "manager_id",
                                        label: "Manager",
                                        type: "select",
                                        required: false,
                                        options: (employees.data?.data ?? [])
                                          .filter(
                                            (e) =>
                                              e.company_id === row.company_id &&
                                              e.role === "manager",
                                          )
                                          .map((e) => ({
                                            value: str(e, "user_id"),
                                            label: str(
                                              relation(e, "profiles"),
                                              "full_name",
                                            ),
                                          })),
                                        defaultValue: row.manager_id
                                          ? str(row, "manager_id")
                                          : "",
                                      },
                                      {
                                        name: "team_leader_id",
                                        label: "Team leader",
                                        type: "select",
                                        required: false,
                                        options: (employees.data?.data ?? [])
                                          .filter(
                                            (e) =>
                                              e.company_id === row.company_id &&
                                              e.role === "team_leader",
                                          )
                                          .map((e) => ({
                                            value: str(e, "user_id"),
                                            label: str(
                                              relation(e, "profiles"),
                                              "full_name",
                                            ),
                                          })),
                                        defaultValue: row.team_leader_id
                                          ? str(row, "team_leader_id")
                                          : "",
                                      },
                                      {
                                        name: "active",
                                        label: "Membership",
                                        type: "select",
                                        defaultValue: String(
                                          Boolean(row.active),
                                        ),
                                        options: [
                                          { value: "true", label: "Active" },
                                          { value: "false", label: "Disabled" },
                                        ],
                                      },
                                    ],
                                    transform: (d) => ({
                                      ...(admin
                                        ? { company_id: row.company_id }
                                        : {}),
                                      department_id: d.department_id || null,
                                      team_id: d.team_id || null,
                                      manager_id: d.manager_id || null,
                                      team_leader_id: d.team_leader_id || null,
                                      active: d.active === "true",
                                    }),
                                  })
                                }
                              >
                                Manage
                              </Button>
                            )}
                          {resource === "billing" && (
                            <>
                              <Button size="sm" variant="ghost" asChild>
                                <a
                                  href={`/api/${base}/billing/${row.id}/pdf`}
                                  aria-label="Download invoice PDF"
                                >
                                  <FileText size={14} />
                                </a>
                              </Button>
                              {admin &&
                                str(row, "status") === "issued" &&
                                permitted("finance.write") && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      openAction({
                                        title: "Record a received payment",
                                        description:
                                          "Only record a payment after confirming receipt in your bank or payment provider. This action creates an auditable manual payment record.",
                                        endpoint: `admin/billing/${row.id}/payment`,
                                        fields: [
                                          {
                                            name: "amount",
                                            label: `Received amount (${row.currency})`,
                                            type: "number",
                                            min: "0.000001",
                                            step: "0.000001",
                                          },
                                          {
                                            name: "reference",
                                            label:
                                              "Unique bank or payment reference",
                                          },
                                          {
                                            name: "confirmation",
                                            label:
                                              "Type RECEIVED to confirm actual receipt",
                                          },
                                        ],
                                        transform: (d) => ({
                                          amount: d.amount,
                                          currency: row.currency,
                                          reference: d.reference,
                                          confirmed_received:
                                            d.confirmation === "RECEIVED",
                                        }),
                                        submit: "Confirm received payment",
                                      })
                                    }
                                  >
                                    Payment
                                  </Button>
                                )}
                            </>
                          )}
                          {["calls", "pricing", "audit-logs"].includes(
                            resource,
                          ) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDetail(row)}
                              aria-label="View record"
                            >
                              <Eye size={14} />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                {total.toLocaleString()} records
                {total > 25 ? ` · Page ${page}` : ""}
              </span>
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft size={13} />
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={page * 25 >= total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight size={13} />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            title={`No ${config.title} yet`}
            description={
              configured
                ? config.description
                : `Connect your database to manage ${config.title}. No operational records have been loaded.`
            }
            icon={
              resource === "companies"
                ? Building2
                : resource === "users" || resource === "clients"
                  ? Users
                  : undefined
            }
            action={
              action ? (
                <Button size="sm" onClick={() => openAction(action)}>
                  <Plus size={13} />
                  Get started
                </Button>
              ) : resource === "numbers" && admin ? (
                <Button size="sm" variant="outline" asChild>
                  <Link href="/admin/providers">
                    Connect a provider <ArrowRight size={12} />
                  </Link>
                </Button>
              ) : undefined
            }
          />
        )}
      </section>
      <Dialog
        open={Boolean(detail)}
        onOpenChange={(v) => {
          if (!v) setDetail(null);
        }}
      >
        {detail && (
          <DialogContent
            title={resource === "calls" ? "Call record" : "Record details"}
            description="Persisted values from the database. Unavailable fields are left empty."
          >
            <dl className="detail-grid">
              {Object.entries(detail)
                .filter(([, v]) => v == null || typeof v !== "object")
                .map(([key, value]) => (
                  <div key={key}>
                    <dt>{key.replaceAll("_", " ")}</dt>
                    <dd>{value == null ? "Unavailable" : String(value)}</dd>
                  </div>
                ))}
            </dl>
            {resource === "calls" &&
              admin &&
              !detail.client_billing &&
              permitted("finance.write") &&
              str(detail, "billing_status") === "review" && (
                <div className="form-actions">
                  <Button
                    variant="outline"
                    onClick={() => {
                      const row = detail;
                      setDetail(null);
                      openAction({
                        title: "Finalize and rate call",
                        description:
                          "Confirm the provider record is final before charging. Ownership, effective pricing, and wallet balance are checked transactionally. A call can be charged only once.",
                        endpoint: `admin/calls/${row.id}/rate`,
                        fields: [
                          {
                            name: "version_id",
                            label: "Effective pricing version UUID",
                          },
                          {
                            name: "confirmation",
                            label:
                              "Type FINAL to confirm the provider record is final",
                          },
                        ],
                        transform: (d) => ({
                          version_id: d.version_id,
                          confirmed_final: d.confirmation === "FINAL",
                        }),
                        submit: "Finalize and charge",
                      });
                    }}
                  >
                    Review billing
                  </Button>
                </div>
              )}
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
