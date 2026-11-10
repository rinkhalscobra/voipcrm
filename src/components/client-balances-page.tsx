"use client";
import { useQuery } from "@tanstack/react-query";
import { Plus, Settings2, Wallet } from "lucide-react";
import Decimal from "decimal.js";
import { api } from "@/lib/api/client";
import { formatCredit, formatDate } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  Badge,
  EmptyState,
  ErrorBanner,
  LoadingRows,
  str,
  type Row,
} from "./shared";
import type { Action } from "./action-dialog";

export function ClientBalancesPage({
  configured,
  base,
  canWrite = false,
  canSetRate = false,
  companyFilter,
  clientFilter,
  openAction,
}: {
  configured: boolean;
  base: string;
  canWrite?: boolean;
  canSetRate?: boolean;
  companyFilter?: string;
  clientFilter?: string;
  openAction: (action: Action) => void;
}) {
  const admin = base === "admin";
  const query = useQuery({
    queryKey: [base, "client-balances", companyFilter, clientFilter],
    queryFn: () =>
      api<{ wallets: Row[]; transactions: Row[] }>(
        `${base}/${admin ? "client-balances" : "wallet"}?${new URLSearchParams({ ...(companyFilter ? { company: companyFilter } : {}), ...(clientFilter ? { client: clientFilter } : {}) })}`,
      ),
    enabled: configured,
  });
  const wallets = query.data?.data.wallets ?? [],
    entries = query.data?.data.transactions ?? [];
  function adjust(wallet: Row, type: "set" | "credit" | "debit") {
    const key = crypto.randomUUID();
    openAction({
      title:
        type === "set"
          ? "Set client balance"
          : type === "credit"
            ? "Add client credit"
            : "Remove client credit",
      description:
        type === "set"
          ? "Sets the final available balance exactly and covers any unpaid usage. Use Add credit to allocate a fixed amount. Your TelTel balance is separate."
          : "Changes only this client’s credit. Recorded unpaid calling usage is settled from available credit.",
      endpoint: `admin/client-balances/${wallet.client_id}/adjust`,
      fields: [
        {
          name: "amount",
          label: `${type === "set" ? "Available balance" : "Amount"} (${wallet.currency})`,
          type: "number",
          min: type === "set" ? "0" : "0.000001",
          step: "0.000001",
          ...(type === "set" ? { defaultValue: str(wallet, "balance") } : {}),
        },
        {
          name: "reason",
          label: "Reason",
          defaultValue:
            type === "set"
              ? "Manual balance allocation"
              : "Manual client credit",
        },
      ],
      transform: (values) => ({
        type,
        amount: values.amount,
        reason: values.reason,
        idempotency_key: key,
      }),
      submit:
        type === "set"
          ? "Set balance"
          : type === "credit"
            ? "Add credit"
            : "Remove credit",
    });
  }
  return (
    <>
      <div className="notice">
        <Wallet size={15} />
        <span>
          {admin
            ? "You control each client’s credit independently. TelTel account funds are separate and visible only to platform administrators."
            : "Your balance is separate from your company’s TelTel account."}{" "}
          Completed outbound calls to Germany are charged by actual talk
          seconds.
        </span>
      </div>
      {query.error && <ErrorBanner error={query.error} />}
      {query.isPending && configured ? (
        <LoadingRows />
      ) : wallets.length ? (
        <div className="wallet-summary">
          {wallets.map((wallet) => (
            <section className="panel wallet-card" key={str(wallet, "id")}>
              <div className="metric-title">
                <Wallet size={15} />
                {admin ? str(wallet, "client_name") : "Your balance"}
                <span style={{ marginLeft: "auto" }}>
                  <Badge value={wallet.suspended ? "suspended" : "active"} />
                </span>
              </div>
              {admin && (
                <p className="muted" style={{ fontSize: 12 }}>
                  {str(wallet, "client_email")} · {str(wallet, "company_name")}
                </p>
              )}
              <div className="metric-value">
                {formatCredit(String(wallet.balance), str(wallet, "currency"))}
              </div>
              <span className="subtle-label">Available client credit</span>
              <p style={{ marginTop: 18, fontSize: 13 }}>
                Germany:{" "}
                <strong>
                  {wallet.germany_rate == null
                    ? "Rate not configured"
                    : `${formatCredit(String(wallet.germany_rate), str(wallet, "currency"))} / minute`}
                </strong>
              </p>
              {wallet.germany_rate != null && (
                <p className="muted" style={{ fontSize: 12 }}>
                  1 hour costs{" "}
                  {formatCredit(
                    new Decimal(String(wallet.germany_rate))
                      .times(60)
                      .toString(),
                    str(wallet, "currency"),
                  )}
                  . Partial minutes are charged by the second.
                </p>
              )}
              <p className="muted" style={{ fontSize: 12 }}>
                New calls from {formatDate(str(wallet, "billing_from"))}.
                Earlier history is not charged.
              </p>
              {Number(wallet.pending_usage) > 0 && (
                <div className="notice">
                  Unpaid usage:{" "}
                  {formatCredit(
                    String(wallet.pending_usage),
                    str(wallet, "currency"),
                  )}
                  {canWrite
                    ? ". Add credit to settle it."
                    : ". Your administrator can add credit to settle it."}
                </div>
              )}
              {canWrite && (
                <div className="heading-actions" style={{ flexWrap: "wrap" }}>
                  <Button size="sm" onClick={() => adjust(wallet, "credit")}>
                    <Plus size={13} />
                    Add credit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => adjust(wallet, "set")}
                  >
                    Set balance
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => adjust(wallet, "debit")}
                  >
                    Remove credit
                  </Button>
                </div>
              )}
              {canSetRate && (
                <Button
                  size="sm"
                  variant="ghost"
                  style={{ marginTop: 12 }}
                  onClick={() =>
                    openAction({
                      title: "Germany retail rate",
                      description:
                        "The new per-minute rate applies to calls starting after this change. Existing charges keep their recorded rate.",
                      endpoint: `admin/client-balances/${wallet.client_id}/rate`,
                      fields: [
                        {
                          name: "per_minute",
                          label: `Price per minute (${wallet.currency})`,
                          type: "number",
                          min: "0",
                          step: "0.000001",
                          defaultValue: String(wallet.germany_rate ?? "0.0442"),
                        },
                      ],
                      submit: "Save rate",
                    })
                  }
                >
                  <Settings2 size={13} />
                  Change rate
                </Button>
              )}
            </section>
          ))}
        </div>
      ) : (
        <section className="panel">
          <EmptyState
            title="No client balances yet"
            description="Create a client inside a company. Its separate balance starts at zero."
            icon={Wallet}
          />
        </section>
      )}
      <section className="panel" style={{ marginTop: 22 }}>
        <div className="panel-heading">
          <div>
            <h2>Client balance history</h2>
            <p>
              Manual credit and automatic call deductions. Charges use up to six
              decimal places.
            </p>
          </div>
        </div>
        {entries.length ? (
          <div className="data-table-scroll">
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Date</th>
                  {admin && <th>Client</th>}
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Balance after</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={str(entry, "id")}>
                    <td>{formatDate(str(entry, "created_at"))}</td>
                    {admin && <td>{str(entry, "client_name")}</td>}
                    <td>
                      <Badge value={entry.type} />
                    </td>
                    <td>
                      {formatCredit(
                        String(entry.amount),
                        str(entry, "currency"),
                      )}
                    </td>
                    <td>
                      {formatCredit(
                        String(entry.balance_after),
                        str(entry, "currency"),
                      )}
                    </td>
                    <td>
                      {entry.talk_seconds != null
                        ? `${entry.talk_seconds}s talk · ${formatCredit(String(entry.per_minute ?? 0), str(entry, "currency"))}/min`
                        : str(entry, "reason")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No balance changes yet"
            description="Manual credits and new completed call charges will appear here."
          />
        )}
      </section>
    </>
  );
}
